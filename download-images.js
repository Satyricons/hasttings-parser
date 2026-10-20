const fs = require("fs");
const path = require("path");
const https = require("https");
const { XMLParser } = require("fast-xml-parser");

// 1. Настройки
const inputFile = process.argv[2] || "feed.xml";
const outputDir = path.join(__dirname, "images"); // Куда сохранять

// Создаем общую папку, если её нет
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

// 2. Парсинг XML
const xml = fs.readFileSync(inputFile, "utf8");
const parser = new XMLParser({
  ignoreAttributes: false,
  isArray: (name) => name === "offer" || name === "picture",
});
const doc = parser.parse(xml);

// Ищем оферы
let offers = [];
function findOffers(obj) {
  if (!obj || typeof obj !== "object") return;
  if (obj.offer) offers = offers.concat(Array.isArray(obj.offer) ? obj.offer : [obj.offer]);
  for (const key in obj) {
    if (key !== "offer") findOffers(obj[key]);
  }
}
findOffers(doc);

console.log(`Найдено товаров: ${offers.length}. Начинаем скачивание...`);

// Вспомогательная функция для очистки имени папки от запрещенных символов
function sanitizeFilename(name) {
  if (!name) return "";
  // Заменяем запрещенные символы \ / : * ? " < > | на нижнее подчеркивание
  let safe = String(name).replace(/[\\/:*?"<>|]/g, "_");
  // Обрезаем до 100 символов, чтобы не превысить лимит Windows
  return safe.substring(0, 100).trim();
}

// 3. Функция скачивания одной картинки
function downloadImage(url, filepath) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return downloadImage(res.headers.location, filepath).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Ошибка ${res.statusCode} при скачивании ${url}`));
      }

      const file = fs.createWriteStream(filepath);
      res.pipe(file);
      
      file.on("finish", () => {
        file.close();
        resolve();
      });
      
      file.on("error", (err) => {
        fs.unlink(filepath, () => reject(err));
      });
    }).on("error", reject);
  });
}

// 4. Обработка всех товаров
async function processOffers() {
  let count = 0;

  for (const offer of offers) {
    const offerId = offer["@_id"];
    const marking = offer.marking ? String(offer.marking).trim() : "";
    const name = offer.name ? String(offer.name).trim() : "";

    // Определяем имя папки: сначала артикул, если нет — название
    let folderName = marking || name;
    folderName = sanitizeFilename(folderName);

    // Запасной вариант, если и артикула, и названия нет
    if (!folderName) {
      folderName = `offer_${offerId}`;
    }

    // Обработка дублей (если у двух товаров одинаковый артикул или название)
    let itemDir = path.join(outputDir, folderName);
    let counter = 1;
    while (fs.existsSync(itemDir)) {
      // Если папка уже есть (например, повторный запуск), проверяем, не дубль ли это.
      // Но проще не плодить папки с суффиксами при повторном запуске, 
      // а просто скачивать туда же. Оставим проверку только для разных оферов.
      break; 
    }

    // Получаем массив картинок
    let pictures = offer.picture || [];
    if (!Array.isArray(pictures)) pictures = [pictures];
    pictures = pictures.filter(p => typeof p === "string" && p.trim() !== "");

    if (pictures.length === 0) continue;

    // Создаем папку
    if (!fs.existsSync(itemDir)) {
      fs.mkdirSync(itemDir, { recursive: true });
    }

    // Скачиваем картинки
    for (let i = 0; i < pictures.length; i++) {
      const url = pictures[i];
      
      let filename = path.basename(new URL(url).pathname);
      if (!filename) filename = `photo_${i + 1}.jpg`;
      
      const filepath = path.join(itemDir, filename);
      
      // Пропускаем уже скачанные
      if (fs.existsSync(filepath)) continue;

      try {
        await downloadImage(url, filepath);
        console.log(`✅ [${folderName}] Скачано: ${filename}`);
        count++;
      } catch (err) {
        console.error(`❌ [${folderName}] Ошибка: ${err.message}`);
      }
    }
  }
  console.log(`\n🎉 Готово! Всего скачано файлов: ${count}`);
}

processOffers();