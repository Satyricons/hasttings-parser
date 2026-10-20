const fs = require("fs");
const { XMLParser } = require("fast-xml-parser");

let XLSX;
try {
  XLSX = require("xlsx-js-style");
} catch (e) {
  console.error("❌ ОШИБКА: Не установлена библиотека для стилей!");
  console.error("Выполните в терминале: npm install xlsx-js-style");
  process.exit(1);
}

// ---------- 1. Конфигурация ----------
const GROUPS = [
  {
    title: "Общие характеристики",
    fields: [
      "Наименование",
      "Артикул",
      "Торговая марка",
      "Производитель",
      "Сборка",
      "Тип",
      "Упражнения",
      "Вес стека (кг)",
      "Механизм регулировки сиденья и спинки",
    ],
  },
  {
    title: "Качество",
    fields: [
      "Сертификат международного качества",
      "Фирменная гарантия",
    ],
  },
  {
    title: "Транспортировочные габариты и вес",
    fields: [
      "Размеры в рабочем состоянии (Д х Ш х В) (см)",
      "Размеры в упаковке (Д х Ш х В) (см)",
      "Вес нетто (кг)",
      "Вес брутто (кг)",
      "Объём упаковки (м3)",
    ],
  },
];

const KNOWN_FIELDS = new Set(GROUPS.flatMap(g => g.fields));
const IGNORED_PARAMS = new Set(["Наименование", "Артикул"]);

// ---------- 2. Парсинг XML ----------
const inputFile = process.argv[2] || "feed.xml";
const xml = fs.readFileSync(inputFile, "utf8");

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => name === "offer" || name === "param" || name === "picture",
});

const doc = parser.parse(xml);

let offers = [];
function findOffers(obj) {
  if (!obj || typeof obj !== "object") return;
  if (obj.offer) offers = offers.concat(Array.isArray(obj.offer) ? obj.offer : [obj.offer]);
  for (const key in obj) {
    if (key !== "offer") findOffers(obj[key]);
  }
}
findOffers(doc);

// ---------- 3. Нормализация ----------
function normalizeOffer(offer) {
  const name = offer.name ?? "";
  const url = offer.url ?? "";
  const marking = offer.marking ?? ""; 

  const paramMap = new Map();
  const paramList = Array.isArray(offer.param) ? offer.param : offer.param ? [offer.param] : [];
  for (const p of paramList) {
    const key = p["@_name"];
    if (!key || IGNORED_PARAMS.has(key)) continue;
    let value = p["#text"];
    if (value && typeof value === "object") value = value["#text"] ?? "";
    value = String(value ?? "").trim();
    if (!value) continue;
    if (!paramMap.has(key)) paramMap.set(key, []);
    paramMap.get(key).push(value);
  }

  const row = {};
  row["Наименование"] = name;
  row["Артикул"] = String(marking).trim();

  for (const field of KNOWN_FIELDS) {
    if (field === "Наименование" || field === "Артикул") continue;
    const values = paramMap.get(field);
    row[field] = values ? values.join("\n") : "";
  }

  const extraFields = [];
  for (const [key, values] of paramMap.entries()) {
    if (KNOWN_FIELDS.has(key)) continue;
    row[key] = values.join("\n");
    extraFields.push(key);
  }

  row.__url = url;
  row.__extraFields = extraFields;
  return row;
}

const products = offers.map(normalizeOffer);

// ---------- 4. Сборка данных ----------
const aoa = [];
const merges = [];
const hyperlinks = [];

aoa.push(["Характеристика", "Значение"]);
let rowIndex = 1;

for (const product of products) {
  aoa.push(["", ""]); rowIndex++; 

  aoa.push([product["Наименование"], ""]);
  merges.push({ s: { r: rowIndex, c: 0 }, e: { r: rowIndex, c: 1 } });
  rowIndex++;

  for (const group of GROUPS) {
    aoa.push([group.title, ""]);
    merges.push({ s: { r: rowIndex, c: 0 }, e: { r: rowIndex, c: 1 } });
    rowIndex++;

    for (const field of group.fields) {
      aoa.push([field, product[field] ?? ""]);
      if (field === "Наименование" && product["__url"]) {
        hyperlinks.push({ r: rowIndex, c: 1, url: product["__url"] });
      }
      rowIndex++;
    }

    if (group.title === "Общие характеристики" && product.__extraFields.length > 0) {
      for (const field of product.__extraFields) {
        aoa.push([field, product[field] ?? ""]);
        rowIndex++;
      }
    }
  }
}

// ---------- 5. Создание Excel ----------
const ws = XLSX.utils.aoa_to_sheet(aoa);
ws["!cols"] = [{ wch: 50 }, { wch: 70 }];
ws["!merges"] = merges;

// ---------- 5.1. Гиперссылки ----------
for (const l of hyperlinks) {
  const addr = XLSX.utils.encode_cell({ r: l.r, c: l.c });
  if (!ws[addr]) ws[addr] = { t: "s", v: "" };
  ws[addr].l = { Target: l.url, Tooltip: "Перейти на страницу товара" };
}

// ---------- 5.2. Жесткое применение стилей ----------
// Базовое выравнивание: по левому краю + перенос по словам + по верхнему краю
const alignLeftWrap = { alignment: { horizontal: "left", vertical: "top", wrapText: true } };

const styles = {
  header:  { 
    font: { bold: true, sz: 13 }, 
    fill: { patternType: "solid", fgColor: { rgb: "E8E8E8" } },
    alignment: { horizontal: "left", vertical: "center", wrapText: true }
  },
  product: { 
    font: { bold: true, sz: 12, color: { rgb: "000000" } },
    alignment: { horizontal: "left", vertical: "center", wrapText: true }
  }, 
  group:   { 
    font: { bold: true, sz: 11, color: { rgb: "000000" } }, 
    fill: { patternType: "solid", fgColor: { rgb: "D9D9D9" } },
    alignment: { horizontal: "left", vertical: "center", wrapText: true }
  }, 
  linkText:{ 
    font: { color: { rgb: "0563C1" }, underline: true },
    alignment: { horizontal: "left", vertical: "top", wrapText: true }
  },
  // Стиль для обычных ячеек
  wrap: alignLeftWrap
};

function applyStyle(r, c, style) {
  const addr = XLSX.utils.encode_cell({ r, c });
  if (!ws[addr]) ws[addr] = { t: "s", v: "" }; 
  ws[addr].s = style;
}

// Стилизуем шапку
applyStyle(0, 0, styles.header);
applyStyle(0, 1, styles.header);

// Стилизуем ссылки (они должны быть синими и подчеркнутыми, но с левым выравниванием)
for (const l of hyperlinks) {
  applyStyle(l.r, l.c, styles.linkText);
}

let r = 1;
for (const product of products) {
  r++; // пустая строка

  applyStyle(r, 0, styles.product);
  applyStyle(r, 1, styles.product);
  r++;

  for (const group of GROUPS) {
    applyStyle(r, 0, styles.group);
    applyStyle(r, 1, styles.group);
    r++;

    for (const field of group.fields) {
      const cellA = ws[XLSX.utils.encode_cell({ r, c: 0 })];
      const cellB = ws[XLSX.utils.encode_cell({ r, c: 1 })];
      // Применяем стиль, только если там еще нет стиля (чтобы не перезаписать ссылку)
      if (!cellA || !cellA.s) applyStyle(r, 0, styles.wrap);
      if (!cellB || !cellB.s) applyStyle(r, 1, styles.wrap);
      r++;
    }

    if (group.title === "Общие характеристики" && product.__extraFields.length > 0) {
      for (const field of product.__extraFields) {
        const cellA = ws[XLSX.utils.encode_cell({ r, c: 0 })];
        const cellB = ws[XLSX.utils.encode_cell({ r, c: 1 })];
        if (!cellA || !cellA.s) applyStyle(r, 0, styles.wrap);
        if (!cellB || !cellB.s) applyStyle(r, 1, styles.wrap);
        r++;
      }
    }
  }
}

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "Характеристики");
XLSX.writeFile(wb, "hasttings_characteristics.xlsx");
console.log(`✅ Готово: hasttings_characteristics.xlsx (найдено товаров: ${products.length})`);