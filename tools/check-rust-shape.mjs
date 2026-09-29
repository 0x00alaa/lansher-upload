// فحص بنيوي لـ Rust بلا سلسلة أدوات.
//
// السبب: لا يوجد `cargo` على هذا الجهاز، فالتوافقات التي يرفضها
// مُدقّق الاستعارات لا يراها أحد. هذا الملف لا يُغني عن `cargo check`
// ولا `cargo test`، لكنه يمسك الأخطاء الشكلية: أقواس غير متوازنة، أو
// استدعاء بدالة لم تعد موجودة، أو حقل مكرر، أو `Counts` و`types.ts`
// في حالة تعارض.
//
// كل قاعدة هنا يجب أن تُبقي تعليقات الكود صادقة، لا أن تفرض أسلوباً.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = "G:/re/my-lansher/crates";
const failures = [];
const notes = [];

function fail(file, line, message) {
  failures.push(`${file}:${line}: ${message}`);
}

/** يزيل التعليقات والسلاسل النصية الخام، ثم يعدّ الأقواس. */
function stripNoise(source) {
  let out = "";
  let index = 0;
  let inLineComment = false;
  let inBlockComment = false;
  let inString = false;
  let inChar = false;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
        out += char;
      }
      index += 1;
      continue;
    }
    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        index += 2;
        continue;
      }
      if (char === "\n") out += char;
      index += 1;
      continue;
    }
    if (inString) {
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (char === '"') inString = false;
      if (char === "\n") out += char;
      index += 1;
      continue;
    }
    if (inChar) {
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (char === "'") inChar = false;
      index += 1;
      continue;
    }
    if (char === "/" && next === "/") {
      inLineComment = true;
      index += 2;
      continue;
    }
    if (char === "/" && next === "*") {
      inBlockComment = true;
      index += 2;
      continue;
    }
    if (char === '"') {
      inString = true;
      index += 1;
      continue;
    }
    if (char === "'") {
      // ترويسة سِمة (`'a`، `'static`) ليست حرفاً.
      if (/[A-Za-z_]/.test(next ?? "") && !/^'[^']*'/.test(source.slice(index + 1))) {
        out += char;
        index += 1;
        continue;
      }
      inChar = true;
      index += 1;
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

function checkBraces(file, source) {
  const code = stripNoise(source);
  const pairs = { "(": ")", "[": "]", "{": "}" };
  const closers = new Set(Object.values(pairs));
  const stack = [];
  let line = 1;
  for (const char of code) {
    if (char === "\n") line += 1;
    if (pairs[char]) stack.push({ char, line });
    else if (closers.has(char)) {
      const top = stack.pop();
      if (!top) {
        fail(file, line, `قوس إغلاق زائد '${char}'`);
        return;
      }
      if (pairs[top.char] !== char) {
        fail(file, line, `ك '${top.char}' فُتح في السطر ${top.line} ويُغلق بـ '${char}'`);
        return;
      }
    }
  }
  if (stack.length > 0) {
    const top = stack[stack.length - 1];
    fail(file, top.line, `قوس مفتوح لم يُغلق: '${top.char}'`);
  }
}

/** أسماء الحقول المعلنة في `struct` واحد، مهما تنوعت صيغته. */
function structFields(source, name) {
  const pattern = new RegExp(`pub struct ${name}\\s*\\{([\\s\\S]*?)\\n\\}`, "g");
  const out = new Set();
  for (const match of source.matchAll(pattern)) {
    for (const line of match[1].split("\n")) {
      const field = /^\s*pub\s+([a-z_][a-z0-9_]*)\s*:/.exec(line);
      if (field) out.add(field[1]);
    }
  }
  return out;
}

function countDeclares(source, word) {
  return (source.match(new RegExp(`\\b(?:pub\\s+)?${word}\\s+\\w+`, "g")) ?? []).length;
}

function rustFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...rustFiles(full));
    else if (entry.endsWith(".rs")) out.push(full);
  }
  return out;
}

const files = rustFiles(root);
const sources = new Map();
for (const file of files) {
  const source = readFileSync(file, "utf8");
  // Windows يُرجع شرطات مائلة عكسية، نقوم للتوحيد حتى تتطابق المفاتيح.
  sources.set(file.replace(/\\/g, "/"), source);
  checkBraces(file.replace(/\\/g, "/"), source);
}

// 1. `Counts` متطابقة بين Rust و TypeScript.
const engine = sources.get(`${root}/lansher-core/src/engine.rs`);
const types = readFileSync("G:/re/my-lansher/UI/src/types.ts", "utf8");
const rustCounts = structFields(engine, "Counts");
const tsCountsBlock = /export interface Counts \{([\s\S]*?)\n\}/.exec(types)?.[1] ?? "";
const tsCounts = new Set(
  [...tsCountsBlock.matchAll(/^\s{2}([a-z_][a-z0-9_]*)\??\s*:/gm)].map((m) => m[1]),
);
for (const field of rustCounts) {
  if (!tsCounts.has(field)) {
    failures.push(`Counts.${field} في Rust وغير موجود في types.ts`);
  }
}
for (const field of tsCounts) {
  if (!rustCounts.has(field)) {
    failures.push(`Counts.${field} في types.ts وغير موجود في Rust`);
  }
}
notes.push(`Counts: ${rustCounts.size} حقل`);

// 2. كل دالة خاصة مستدعاة داخل نفس الملف معرَّفة فيه أو مستوردة.
const TRAIT_METHODS = new Set([
  "to_string",
  "clone",
  "push",
  "pop",
  "insert",
  "remove",
  "len",
  "is_empty",
  "iter",
  "get",
  "unwrap",
  "expect",
  "map",
  "take",
  "count",
  "rev",
  "next",
  "send",
  "recv",
  "lock",
  "as_str",
  "to_owned",
  "into_iter",
  "collect",
]);

for (const [file, source] of sources) {
  const defined = new Set(
    [...source.matchAll(/fn\s+([a-z_][a-z0-9_]*)\s*[(<]/g)].map((m) => m[1]),
  );
  const imported = new Set(
    [...source.matchAll(/use\s+[\w:]*\{([^}]*)\}/g)]
      .flatMap((m) => m[1].split(","))
      .map((part) => part.trim().split("::").pop())
      .filter(Boolean),
  );
  for (const call of source.matchAll(/\bself\.([a-z_][a-z0-9_]*)\s*\(/g)) {
    const name = call[1];
    if (TRAIT_METHODS.has(name)) continue;
    if (!defined.has(name) && !imported.has(name) && !sourcesHasMethod(sources, name)) {
      const line = source.slice(0, call.index).split("\n").length;
      fail(file, line, `self.${name}() غير معرَّفة في أي مكان`);
    }
  }
}

/** هل الاسم دالة عامة في أي ملف من نفس المجلد؟ */
function sourcesHasMethod(all, name) {
  for (const source of all.values()) {
    if (new RegExp(`fn\\s+${name}\\b`).test(source)) return true;
  }
  return false;
}

// 3. لا حقل معلن مرتين في نفس الـ struct.
for (const [file, source] of sources) {
  for (const match of source.matchAll(/pub struct (\w+)\s*\{([\s\S]*?)\n\}/g)) {
    const [, name, body] = match;
    const fields = [...body.matchAll(/^\s*pub\s+([a-z_][a-z0-9_]*)\s*:/gm)].map((m) => m[1]);
    const seen = new Set();
    for (const field of fields) {
      if (seen.has(field)) {
        const line = source.slice(0, match.index).split("\n").length;
        fail(file.replace(/\\/g, "/"), line, `${name} يعلن الحقل ${field} مرتين`);
      }
      seen.add(field);
    }
  }
}

// 4. `Engine` لا يحمل حقولاً لم تُستخدم في مكان آخر.
for (const [name, structSource] of [
  ["Engine", engine],
  ["DedupeWindow", engine],
  ["Executors", sources.get(`${root}/lansher-server/src/lib.rs`)],
]) {
  const fields = structFields(structSource, name);
  for (const field of fields) {
    const uses = (structSource.match(new RegExp(`\\b${field}\\b`, "g")) ?? []).length;
    if (uses < 2) {
      notes.push(`${name}.${field} يُذكر مرة واحدة فقط — تحقق من فائدته`);
    }
  }
}

// 5. لا استدعاء لـ`matching` داخل `ingest`: تعارض استعارة مع `&mut self`.
if (/let matches = self\.rule_set\.matching\(/.test(engine)) {
  const line = engine.split("\n").findIndex((l) => l.includes("let matches = self.rule_set.matching(")) + 1;
  fail("lansher-core/src/engine.rs", line, "matching() تعيد مراجع مستعارة و ingest يحتاج &mut self");
}

// 6. استعارة `&mut self.state` ثم كتابة في `self.state` داخل نفس الدالة.
// حذفنا هذا الفحص: تتبّع الاستعارة في Rust دقيق، وأي تقريب هنا يُنتج
// إنذارات كاذبة أسوأ من تجاهل الحالة. الحَكَم هو `cargo check`.

// 7. كل `enum` مُعلنة بـ serde tag له قيمة `tag` واحدة فقط.
for (const [file, source] of sources) {
  for (const match of source.matchAll(/#\[serde\(([^)]*)\)\]\s*\n#\[derive\([^)]*\)\]\s*\npub enum (\w+)/g)) {
    const attrs = match[1];
    const enumName = match[2];
    const tags = [...attrs.matchAll(/tag\s*=\s*"(\w+)"/g)].map((m) => m[1]);
    if (tags.length > 1) {
      const line = source.slice(0, match.index).split("\n").length;
      fail(file.replace(/\\/g, "/"), line, `${enumName} عليه أكثر من tag واحد`);
    }
  }
}

// 8. لا حروف صينية أو كورية أو يابانية في تعليقات المشروع. النصوص
// عربية، والمحارف التالفة تنتج عن لصق أو ترميز خاطئ، فالعربية تفقد
// معناها تماماً. الكلمات الإنجليزية التقنية (Rust, JSON, serde) مقبولة.
const CJK = /[\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af\uff00-\uffef]/u;
const MOJIBAKE = /\uFFFD|\u0621\u200F/;
function checkLanguage(file, source) {
  source.split("\n").forEach((text, index) => {
    if (CJK.test(text)) {
      fail(file, index + 1, "حرف صيني/كوري/ياباني: " + text.trim().slice(0, 60));
    }
    // محرف الاستبدال يعني نصاً فُقد ترميزه: العربية عندنا تُقرأ، فوجوده
    // دليل لصق خاطئ لا مجرد خطأ عرض.
    if (MOJIBAKE.test(text)) {
      fail(file, index + 1, "محرف تالف (ترميز مفقود): " + text.trim().slice(0, 60));
    }
  });
}
for (const [file, source] of sources) {
  checkLanguage(file, source);
}
for (const file of tsFiles("G:/re/my-lansher/UI/src")) {
  checkLanguage(file, readFileSync(file, "utf8"));
}
for (const file of tsFiles("G:/re/my-lansher/tools")) {
  checkLanguage(file, readFileSync(file, "utf8"));
}
for (const file of sourceFiles("G:/re/my-lansher/server")) {
  checkLanguage(file, readFileSync(file, "utf8"));
}

/** ملفات السيرفر: `.ts` و `.sql`، بلا `node_modules` و `dist`. */
function sourceFiles(dir) {
  const skip = new Set(["node_modules", "dist"]);
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (skip.has(entry)) continue;
    const full = join(dir, entry).replace(/\\/g, "/");
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|sql)$/.test(entry)) out.push(full);
  }
  return out;
}
// المستندات ومخططات JSON مصدر العقد المكتوب، فهي مشمولة بنفس القاعدة.
for (const file of docFiles("G:/re/my-lansher")) {
  checkLanguage(file, readFileSync(file, "utf8"));
}

/** ملفات `.md` و `.json` خارج node_modules و dist و target. */
function docFiles(dir) {
  const skip = new Set(["node_modules", "dist", "target", ".git", "assets"]);
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (skip.has(entry)) continue;
    const full = join(dir, entry).replace(/\\/g, "/");
    if (statSync(full).isDirectory()) out.push(...docFiles(full));
    else if (/\.(md|json)$/.test(entry)) out.push(full);
  }
  return out;
}

/** ملفات TypeScript و TSX فقط؛ node_modules مستثناة. */
function tsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = join(dir, entry).replace(/\\/g, "/");
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

// 9. عدد ملفات Rust المُفحوصة معروض، حتى لا يفهم أحد أن الفحص ضحل.
notes.push(`ملفات Rust المفحوصة: ${files.length}`);

if (failures.length > 0) {
  console.error(`فشل ${failures.length} فحصاً بنيوياً:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error("");
  console.error("ملاحظات:");
  for (const note of notes) console.error(`  * ${note}`);
  process.exit(1);
}
console.log(`نجحت الفحوص البنيوية على ${files.length} ملف Rust.`);
for (const note of notes) console.log(`  * ${note}`);
