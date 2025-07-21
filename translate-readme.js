// translate-readme.js
import fs from "fs/promises";
import fetch from "node-fetch"; // Omit this line if using Node 18+ (has native fetch)
import "dotenv/config";
import parserConfig from "./i18next-parser.config.js";

const LOCALES = parserConfig.locales || [];
const TARGET_LANGS = LOCALES.filter((l) => l !== "en").map((l) =>
  l.toUpperCase(),
);

// eslint-disable-next-line no-undef
const DEEPL_TOKEN = process.env.DEEPL_TOKEN;
if (!DEEPL_TOKEN) throw new Error("Set DEEPL_TOKEN env variable!");

const SRC_FILE = "README.md";

async function translate(text, targetLang) {
  const response = await fetch("https://api-free.deepl.com/v2/translate", {
    method: "POST",
    headers: { Authorization: `DeepL-Auth-Key ${DEEPL_TOKEN}` },
    body: new URLSearchParams({
      text,
      target_lang: targetLang,
      preserve_formatting: "1",
    }),
  });
  const result = await response.json();
  if (result.translations && result.translations.length) {
    return result.translations[0].text;
  }
  throw new Error("DeepL API error: " + JSON.stringify(result));
}

async function main() {
  const text = await fs.readFile(SRC_FILE, "utf8");
  for (const lang of TARGET_LANGS) {
    const translated = await translate(text, lang);
    const langFile = `README.${lang.toLowerCase()}.md`;
    const fixed = translated.replace(/] \(/g, "](");
    await fs.writeFile(langFile, fixed, "utf8");
    console.log(`Translated ${SRC_FILE} -> ${langFile}`);
  }
}

main().catch((e) => {
  console.error(e);
  // eslint-disable-next-line no-undef
  process.exit(1);
});
