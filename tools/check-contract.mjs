// فحص تطابق العقد: يقارن مخططات JSON مع أسماء `types.ts` وبنية Rust،
// ويقارن عقد HTTP السحابي مع نسخته في `server/src/api.ts`.
//
// الغرض كشف الانحراف قبل تشغيل التطبيق، لأن اختلاف اسم حقل بين Rust
// و TypeScript لا يوقف البناء: الواجهة تقرأ `undefined` بصمت. والشيء
// نفسه في السحابة: اختلاف اسم بين المخطط و`api.ts` لا يوقف `tsc`.
//
// هذا فحص بنيوي فقط. لا يثبت تطابق القيم، ولا يبقى بديلاً عن
// `cargo test` الذي يقرأ `crates/lansher-core/src/contract.rs`.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const schemasDir = join(root, "schemas");
const typesPath = join(root, "UI", "src", "types.ts");
const eventRsPath = join(root, "crates", "lansher-core", "src", "event.rs");
const ruleRsPath = join(root, "crates", "lansher-core", "src", "rule.rs");
const serverRsPath = join(root, "crates", "lansher-server", "src", "lib.rs");
const cloudApiPath = join(root, "server", "src", "api.ts");
const cloudDocPath = join(root, "docs", "cloud-api.md");

const types = readFileSync(typesPath, "utf8");
const eventRs = readFileSync(eventRsPath, "utf8");
const ruleRs = readFileSync(ruleRsPath, "utf8");
const serverRs = readFileSync(serverRsPath, "utf8");
const cloudApi = readFileSync(cloudApiPath, "utf8");
const cloudDoc = readFileSync(cloudDocPath, "utf8");
const failures = [];
const checks = [];

function check(label, condition) {
  checks.push(label);
  if (!condition) failures.push(label);
}

function loadSchema(name) {
  return JSON.parse(readFileSync(join(schemasDir, name), "utf8"));
}

/**
 * أسماء متغيرات `enum` معرَّفة في Rust، بصيغة `PascalCase` كما تُكتب في
 * المصدر. نستخدمها للمقارنة مع `snake_case` في المخطط و TypeScript.
 */
function rustEnumVariants(source, enumName) {
  const declaration = new RegExp(
    `pub enum ${enumName}\\s*\\{([\\s\\S]*?)\\n\\}`,
  ).exec(source);
  if (!declaration) return null;
  return [...declaration[1].matchAll(/^\s{4}([A-Z][A-Za-z0-9]*)/gm)].map((m) => m[1]);
}

/** `PascalCase` إلى `snake_case`، مطابقة `rename_all = "snake_case"`. */
function toSnake(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

/** أسماء حقول الصيغة `Variant { field: Type }` في Rust. */
function rustVariantFields(source, enumName, variant) {
  const pattern = new RegExp(`pub enum ${enumName}[\\s\\S]*?\\n    ${variant} \\{([\\s\\S]*?)\\n    \\}`);
  const match = pattern.exec(source);
  if (!match) return null;
  return [...match[1].matchAll(/^\s{8}(?:pub\s+)?([a-z_][a-z0-9_]*)\s*:/gm)].map((m) => m[1]);
}

function collectEnumValues(node, out = new Set()) {
  if (Array.isArray(node)) {
    for (const item of node) collectEnumValues(item, out);
    return out;
  }
  if (node && typeof node === "object") {
    if (Array.isArray(node.enum)) {
      for (const value of node.enum) {
        if (typeof value === "string") out.add(value);
      }
    }
    for (const value of Object.values(node)) collectEnumValues(value, out);
  }
  return out;
}

function collectKinds(node, out = new Set()) {
  if (Array.isArray(node)) {
    for (const item of node) collectKinds(item, out);
    return out;
  }
  if (node && typeof node === "object") {
    const kind = node.properties?.kind;
    if (typeof kind?.const === "string") {
      out.add(kind.const);
    }
    if (Array.isArray(kind?.enum)) {
      for (const value of kind.enum) {
        if (typeof value === "string") out.add(value);
      }
    }
    for (const value of Object.values(node)) collectKinds(value, out);
  }
  return out;
}

/** أسماء المتغيرات والـ string literals من نوع في `types.ts`. */
function unionMembers(typeName) {
  const declaration = new RegExp(
    `export type ${typeName}\\b[\\s\\S]*?(?=\\nexport |\\nfunction |\\nconst |\\ninterface |\\z)`,
  ).exec(types);
  if (!declaration) return null;
  const body = declaration[0];
  const literals = [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const identifiers = [...body.matchAll(/\b([A-Z][A-Za-z0-9]*)\b/g)].map((m) => m[1]);
  return { literals, identifiers, body };
}

/**
 * سلاسل حرفية من نوع مُصدَّر في `api.ts`. قراءة نصية كـ`unionMembers`
 * أعلاه، لا مُحلّل TypeScript: الغرض كشف الانحراف أثناء البناء.
 */
function apiUnionLiterals(typeName) {
  const declaration = new RegExp(
    `export type ${typeName}\\b[\\s\\S]*?(?=\\nexport |\\nfunction |\\nconst |\\ninterface |$)`,
  ).exec(cloudApi);
  if (!declaration) return null;
  return [...declaration[0].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** أزواج `الطريقة والمسار` من `CloudRoute`، بصيغة `GET /healthz`. */
function apiRouteKeys() {
  return [
    ...cloudApi.matchAll(/method:\s*"(\w+)";\s*(?:readonly\s+)?path:\s*"([^"]+)"/g),
  ].map((m) => `${m[1]} ${m[2]}`);
}

/** `code: number` من خريطة `CLOUD_ERROR_STATUS` في `api.ts`. */
function apiErrorStatus() {
  const declaration = /export const CLOUD_ERROR_STATUS[\s\S]*?=\s*\{([\s\S]*?)\n\};/.exec(
    cloudApi,
  );
  if (!declaration) return null;
  return [...declaration[1].matchAll(/([a-z_]+):\s*(\d+)/g)].map((m) => [
    m[1],
    Number(m[2]),
  ]);
}

/**
 * أسماء حقول كل `export interface` في `api.ts`، مع حقول ما ترث منه.
 * فهرس السلسلة `[key: string]` ليس حقلاً، فنستبعده صراحةً.
 */
function apiInterfaceFields() {
  const byName = new Map();
  for (const match of cloudApi.matchAll(
    /export interface (\w+)(?: extends ([\w, ]+))? \{([\s\S]*?)\n\}/g,
  )) {
    const fields = new Set();
    for (const field of match[3].matchAll(/^\s{2}(?:readonly\s+)?(\[)?(\w+)\??\s*:/gm)) {
      if (field[1] === "[") continue;
      fields.add(field[2]);
    }
    byName.set(match[1], { fields, parents: match[2] ?? "" });
  }
  const all = new Set();
  for (const entry of byName.values()) {
    for (const field of entry.fields) all.add(field);
    for (const parent of entry.parents.split(",").map((name) => name.trim())) {
      for (const field of byName.get(parent)?.fields ?? []) all.add(field);
    }
  }
  return all;
}

const event = loadSchema("event.schema.json");
const rule = loadSchema("rule.schema.json");
const request = loadSchema("request.schema.json");
const response = loadSchema("response.schema.json");

// 1. أنواع الأحداث: Rust و TypeScript و JSON Schema.
// `collectKinds` لا `collectEnumValues`: الوحدات تجمع في `enum` واحد،
// بينما `Custom` له `const` مع `name`، وكلاهما نوع حدث صالح.
const schemaEventTypes = collectKinds(event.$defs.eventType);
const rustEventTypes = rustEnumVariants(eventRs, "EventType");
check("event.rs يعرّف EventType", rustEventTypes !== null);
if (rustEventTypes) {
  // `Custom(String)` يُصدَّر بصيغة `{"kind":"Custom","name":...}`، فلا
  // بد من مقارنة المجموعتين ككل: كل نوع Rust موجود في المخطط، والعكس.
  const missingInSchema = rustEventTypes.filter((name) => !schemaEventTypes.has(name));
  check(
    `EventType في Rust مغطى بالمخطط (ناقص: ${missingInSchema.join(", ") || "لا شيء"})`,
    missingInSchema.length === 0,
  );
  const missingInRust = [...schemaEventTypes].filter((name) => !rustEventTypes.includes(name));
  check(
    `المخطط بلا نوع بلا Rust (ناقص: ${missingInRust.join(", ") || "لا شيء"})`,
    missingInRust.length === 0,
  );
}
check(
  "event.schema.json لا يحتوي ViewerCount (ليس حدثاً)",
  !schemaEventTypes.has("ViewerCount"),
);
const tsEvent = unionMembers("EventTypeName");
check("types.ts يعرّف EventTypeName", tsEvent !== null);
if (tsEvent) {
  // `EventTypeName` هي أسماء الأنواع الثابتة فقط. `Custom` ليس اسماً:
  // اسمه يأتي من `name` وقت التشغيل، ويمر عبر `eventTypeName()`. لذلك
  // نتحقق أن `Custom` غائب عن القائمة، لا غائب عن العقد.
  const namedTypes = [...schemaEventTypes].filter((name) => name !== "Custom");
  const missing = namedTypes.filter((name) => !tsEvent.literals.includes(name));
  check(
    `EventTypeName يغطي أنواع المخطط (ناقص: ${missing.join(", ") || "لا شيء"})`,
    missing.length === 0,
  );
  const extra = tsEvent.literals.filter((name) => !schemaEventTypes.has(name));
  check(
    `EventTypeName بلا زيادة على المخطط (زائد: ${extra.join(", ") || "لا شيء"})`,
    extra.length === 0,
  );
  check(
    "types.ts يفرّق Custom عن الأنواع الثابتة",
    /kind:\s*"Custom";\s*name:\s*string/.test(types),
  );
}

// 2. أنواع الحمولات: الوحدة بلا data، وذات البيانات مع data إلزامياً.
const schemaPayloads = collectKinds(event.$defs.payload);
const rustPayloads = rustEnumVariants(eventRs, "Payload");
check("event.rs يعرّف Payload", rustPayloads !== null);
const expectedPayloads = [
  "Chat",
  "Like",
  "Gift",
  "Follow",
  "Share",
  "Join",
  "Subscribe",
  "StreamStart",
  "StreamEnd",
  "Custom",
];
const missingPayloads = expectedPayloads.filter((kind) => !schemaPayloads.has(kind));
check(
  `مخطط الحمولة يغطي كل الأنواع (ناقص: ${missingPayloads.join(", ") || "لا شيء"})`,
  missingPayloads.length === 0,
);
const extraPayloads = [...schemaPayloads].filter((kind) => !expectedPayloads.includes(kind));
check(
  `لا حمولة زائدة في المخطط (زائد: ${extraPayloads.join(", ") || "لا شيء"})`,
  extraPayloads.length === 0,
);
if (rustPayloads) {
  const missingInSchema = rustPayloads.filter((name) => !schemaPayloads.has(name));
  check(
    `Payload في Rust مغطى بالمخطط (ناقص: ${missingInSchema.join(", ") || "لا شيء"})`,
    missingInSchema.length === 0,
  );
  // حمولة بلا حقول تُسلسل كوحدة: `{"kind":"Follow"}` بلا `data`.
  // حمولة ذات حقول تتطلب `data`، إلا إذا كان كل حقلها `#[serde(default)]`
  // اختيارياً — عندها يقبل serde حذف `data` كاملاً، فيجب أن يقبله المخطط.
  // Rust لا يوسم الاختياري في نص التعداد، فنستثني `Subscribe` صراحةً:
  // حقلها الوحيد `tier` اختياري.
  const optionalData = new Set(["Subscribe"]);
  for (const variant of rustPayloads) {
    const fields = rustVariantFields(eventRs, "Payload", variant);
    if (fields === null) continue;
    const schemaVariant = event.$defs.payload.oneOf.find(
      (entry) => entry.properties?.kind?.const === variant,
    );
    if (!schemaVariant) {
      check(`${variant} معرّف في مخطط الحمولة`, false);
      continue;
    }
    const requiresData = (schemaVariant.required ?? []).includes("data");
    if (fields.length === 0) {
      check(`${variant} وحدة فلا تحمل data`, !requiresData);
    } else if (optionalData.has(variant)) {
      check(`${variant} يحتمل data اختيارياً`, !requiresData);
    } else {
      check(`${variant} يتطلب data`, requiresData);
    }
  }
}

// 3. أوامر الجسر: Rust و TypeScript و المخطط.
const schemaCommands = collectEnumValues(request.properties.cmd);
const rustCommands = rustEnumVariants(serverRs, "Request");
check("lib.rs يعرّف Request", rustCommands !== null);
if (rustCommands) {
  const rustSnake = rustCommands.map(toSnake);
  const missingInSchema = rustSnake.filter((cmd) => !schemaCommands.has(cmd));
  check(
    `أوامر Rust مغطاة بالمخطط (ناقص: ${missingInSchema.join(", ") || "لا شيء"})`,
    missingInSchema.length === 0,
  );
  const missingInRust = [...schemaCommands].filter((cmd) => !rustSnake.includes(cmd));
  check(
    `مخطط بلا أمر بلا Rust (ناقص: ${missingInRust.join(", ") || "لا شيء"})`,
    missingInRust.length === 0,
  );
  // كل أمر يحمل حقولاً في Rust يجب أن يطلبها المخطط في فرع `oneOf` الخاص به.
  const branches = request.oneOf ?? [];
  check("request.schema.json يفرّق بين الأوامر بـ oneOf", branches.length > 0);
  for (const variant of rustCommands) {
    const cmd = toSnake(variant);
    const fields = rustVariantFields(serverRs, "Request", variant);
    if (fields === null) continue;
    const branch = branches.find(
      (entry) => entry.properties?.cmd?.const === cmd,
    ) ?? branches.find((entry) => entry.properties?.cmd?.enum?.includes(cmd));
    if (!branch) {
      check(`${cmd}: له فرع في oneOf`, false);
      continue;
    }
    const required = new Set(branch.required ?? []);
    for (const field of fields) {
      check(`${cmd} يتطلب الحقل ${field} في المخطط`, required.has(field));
    }
  }
}
const tsRequest = unionMembers("Request");
check("types.ts يعرّف Request", tsRequest !== null);
if (tsRequest) {
  const missing = [...schemaCommands].filter((cmd) => !tsRequest.literals.includes(cmd));
  check(
    `Request في TypeScript يغطي كل أوامر المخطط (ناقص: ${missing.join(", ") || "لا شيء"})`,
    missing.length === 0,
  );
  const extra = tsRequest.literals.filter((cmd) => !schemaCommands.has(cmd));
  check(
    `لا أمر في TypeScript بلا مخطط (زائد: ${extra.join(", ") || "لا شيء"})`,
    extra.length === 0,
  );
}

// 4. أنواع الشروط والإجراءات متطابقة بين rule.rs و types.ts و المخطط.
// Rust يكتب `PascalCase` والمخطط و TypeScript يكتبان `snake_case`
// بحكم `rename_all = "snake_case"`، فنطبّع بمفتاح واحد قبل المقارنة.
const schemaConditionKinds = collectKinds(rule.$defs.condition);
const rustConditionKinds = rustEnumVariants(ruleRs, "Condition");
check("rule.rs يعرّف Condition", rustConditionKinds !== null);
if (rustConditionKinds) {
  const missing = rustConditionKinds.map(toSnake).filter((kind) => !schemaConditionKinds.has(kind));
  check(
    `Condition في Rust مغطى بالمخطط (ناقص: ${missing.join(", ") || "لا شيء"})`,
    missing.length === 0,
  );
  const extra = [...schemaConditionKinds].filter(
    (kind) => !rustConditionKinds.map(toSnake).includes(kind),
  );
  check(
    `المخطط بلا شرط بلا Rust (زائد: ${extra.join(", ") || "لا شيء"})`,
    extra.length === 0,
  );
}
const schemaActionKinds = collectKinds(rule.$defs.action);
const rustActionKinds = rustEnumVariants(ruleRs, "Action");
check("rule.rs يعرّف Action", rustActionKinds !== null);
if (rustActionKinds) {
  const missing = rustActionKinds.map(toSnake).filter((kind) => !schemaActionKinds.has(kind));
  check(
    `Action في Rust مغطى بالمخطط (ناقص: ${missing.join(", ") || "لا شيء"})`,
    missing.length === 0,
  );
  const extra = [...schemaActionKinds].filter(
    (kind) => !rustActionKinds.map(toSnake).includes(kind),
  );
  check(
    `المخطط بلا إجراء بلا Rust (زائد: ${extra.join(", ") || "لا شيء"})`,
    extra.length === 0,
  );
}
const tsCondition = unionMembers("Condition");
if (tsCondition) {
  const missing = [...schemaConditionKinds].filter(
    (kind) => !tsCondition.literals.includes(kind),
  );
  check(
    `Condition في TypeScript يغطي المخطط (ناقص: ${missing.join(", ") || "لا شيء"})`,
    missing.length === 0,
  );
}
const tsAction = unionMembers("Action");
if (tsAction) {
  const missing = [...schemaActionKinds].filter((kind) => !tsAction.literals.includes(kind));
  check(
    `Action في TypeScript يغطي المخطط (ناقص: ${missing.join(", ") || "لا شيء"})`,
    missing.length === 0,
  );
}

// 5. حقول BaseRule الأساسية في المخطط و TypeScript.
const ruleProps = new Set(Object.keys(rule.properties));
for (const field of ["id", "name", "enabled", "priority", "trigger", "group_op", "conditions", "actions", "rate", "queue"]) {
  check(`rule.schema.json يعرّف ${field}`, ruleProps.has(field));
  check(`types.ts يعرّف ${field}`, new RegExp(`\\b${field}[?]?\\s*:`).test(types));
}

// 6. رمز الخطأ ثابت في Rust و TypeScript و المخطط.
const errorCodes = collectEnumValues(response.$defs.bridgeError.properties.code);
check(
  `أكواد الخطأ في TypeScript مطابقة للمخطط (${[...errorCodes].join(", ")})`,
  errorCodes.size > 0 &&
    [...errorCodes].every((code) => new RegExp(`"${code}"`).test(types)),
);

// 7. EventType و Payload كائنان لا نص: حارس ضد regress إلى سلسلة.
check("event.schema.json لا يعرّف EventType كنص", event.$defs.eventType.type === undefined);
check(
  "event.schema.json يعرّف EventType كـ oneOf لا كـ قائمة نصوص",
  Array.isArray(event.$defs.eventType.oneOf) && event.$defs.eventType.enum === undefined,
);
check(
  "types.ts لا يعرّف EventType كسلسلة",
  /export type EventType\s*=/.test(types) &&
    !/export type EventType\s*=\s*"/.test(types) &&
    !/export type EventType\s*=\s*[A-Za-z]+Name\b/.test(types),
);
check("types.ts يعرّف EventType كائناً له kind", /\{ kind:/.test(types));

// 8. كل مخطط يشير إلى ملفات موجودة.
for (const name of readdirSync(schemasDir)) {
  if (!name.endsWith(".json")) continue;
  const text = readFileSync(join(schemasDir, name), "utf8");
  for (const match of text.matchAll(/"([a-z]+\.schema\.json)"/g)) {
    const target = match[1];
    check(`${name} يشير إلى ${target} موجود`, readdirSync(schemasDir).includes(target));
  }
}

// 9. عقد HTTP السحابي: المخطط و server/src/api.ts وجهان لعقد واحد.
// الفحص بينهما لا نحو `index.ts`: التنفيذ يتحرك تحتنا، والعقد هو
// الذي نمنع انحرافه.
const cloud = loadSchema("cloud.schema.json");
const cloudCodes = collectEnumValues(cloud.$defs.cloud_error.properties.code);
check("cloud.schema.json يعرّف cloud_error برموز خطأ", cloudCodes.size > 0);

// 9.1 رموز الخطأ: المخطط و الأجزاء الثلاثة في api.ts.
const codeParts = ["AuthErrorCode", "SyncErrorCode", "TransportErrorCode"];
const apiCodes = new Set();
for (const part of codeParts) {
  const literals = apiUnionLiterals(part);
  check(`api.ts يعرّف ${part}`, literals !== null);
  for (const literal of literals ?? []) apiCodes.add(literal);
}
check(
  "CloudErrorCode في api.ts هو اتحاد النطاقات الثلاثة لا سواها",
  /export type CloudErrorCode\s*=\s*AuthErrorCode\s*\|\s*SyncErrorCode\s*\|\s*TransportErrorCode/.test(
    cloudApi,
  ),
);
const missingInApi = [...cloudCodes].filter((code) => !apiCodes.has(code));
check(
  `أكواد خطأ المخطط مغطاة في api.ts (ناقص: ${missingInApi.join(", ") || "لا شيء"})`,
  missingInApi.length === 0,
);
const extraInApi = [...apiCodes].filter((code) => !cloudCodes.has(code));
check(
  `api.ts بلا رمز خطأ بلا مخطط (زائد: ${extraInApi.join(", ") || "لا شيء"})`,
  extraInApi.length === 0,
);

// 9.2 حالة HTTP لكل رمز، في المخطط و api.ts.
const cloudStatus = cloud.$defs.error_status.properties;
const missingStatus = [...cloudCodes].filter((code) => typeof cloudStatus[code] !== "number");
check(
  `error_status يعرّف حالة لكل رمز (ناقص: ${missingStatus.join(", ") || "لا شيء"})`,
  missingStatus.length === 0,
);
const extraStatus = Object.keys(cloudStatus).filter((code) => !cloudCodes.has(code));
check(
  `error_status بلا رمز بلا cloud_error (زائد: ${extraStatus.join(", ") || "لا شيء"})`,
  extraStatus.length === 0,
);
const apiStatus = apiErrorStatus();
check("api.ts يعرّف CLOUD_ERROR_STATUS", apiStatus !== null);
const statusMismatched = (apiStatus ?? []).filter(
  ([code, status]) => code in cloudStatus && cloudStatus[code] !== status,
);
const statusMissing = [...cloudCodes].filter(
  (code) => !(apiStatus ?? []).some(([known]) => known === code),
);
check(
  `CLOUD_ERROR_STATUS مطابقة للمخطط (مختلف: ${statusMismatched.map(([code]) => code).join(", ") || "لا شيء"})`,
  statusMismatched.length === 0,
);
check(
  `CLOUD_ERROR_STATUS تغطي كل الرموز (ناقص: ${statusMissing.join(", ") || "لا شيء"})`,
  statusMissing.length === 0,
);

// 9.3 جدول المسارات: كل مسار في المخطط موجود في CloudRoute والعكس.
const cloudRoutes = cloud["x-routes"] ?? [];
const routeKeys = new Set(cloudRoutes.map((route) => `${route.method} ${route.path}`));
check("cloud.schema.json يسرد المسارات في x-routes", cloudRoutes.length > 0);
check("لا مسار مكرر في x-routes", routeKeys.size === cloudRoutes.length);
const apiRoutes = apiRouteKeys();
const missingRoutes = [...routeKeys].filter((key) => !apiRoutes.includes(key));
check(
  `مسارات المخطط موجودة في CloudRoute (ناقص: ${missingRoutes.join(", ") || "لا شيء"})`,
  missingRoutes.length === 0,
);
const extraRoutes = apiRoutes.filter((key) => !routeKeys.has(key));
check(
  `CloudRoute بلا مسار بلا مخطط (زائد: ${extraRoutes.join(", ") || "لا شيء"})`,
  extraRoutes.length === 0,
);

// 9.4 كل رمز تردّ به حالة خطأ مسجَّلة، وكل رمز إما يردّ من مسار أو
// من ردّ احتياطي أو محجوز صراحةً. الرمز بلا موضع ردّ تسرّب معلومة
// عن نية الخادم، والمحجوز بلا سبب يصبح وعداً لا أحد ينتظره.
const emitted = new Set();
const unknownCodes = [];
const wrongStatus = [];
for (const route of cloudRoutes) {
  for (const response of route.responses ?? []) {
    for (const code of response.codes ?? []) {
      emitted.add(code);
      if (!cloudCodes.has(code)) unknownCodes.push(`${route.method} ${route.path}: ${code}`);
      else if (cloudStatus[code] !== response.status) {
        wrongStatus.push(`${route.method} ${route.path}: ${code} ${response.status}`);
      }
    }
  }
}
const fallbacks = cloud["x-fallbacks"] ?? [];
for (const entry of fallbacks) {
  emitted.add(entry.code);
  if (!cloudCodes.has(entry.code)) unknownCodes.push(`fallback: ${entry.code}`);
  else if (cloudStatus[entry.code] !== entry.status) {
    wrongStatus.push(`fallback: ${entry.code} ${entry.status}`);
  }
}
const reserved = (cloud["x-reserved"] ?? []).map((entry) => entry.code);
check(
  `كل رمز في ردّ خطأ معرّف في cloud_error (مجهول: ${unknownCodes.join(", ") || "لا شيء"})`,
  unknownCodes.length === 0,
);
check(
  `حالة كل رمز تطابق error_status (مختلف: ${wrongStatus.join(", ") || "لا شيء"})`,
  wrongStatus.length === 0,
);
const unreachable = [...cloudCodes].filter(
  (code) => !emitted.has(code) && !reserved.includes(code),
);
check(
  `كل رمز خطأ يردّ من مسار أو ردّ احتياطي أو محجوز (بلا موضع: ${unreachable.join(", ") || "لا شيء"})`,
  unreachable.length === 0,
);
const wronglyEmitted = reserved.filter((code) => emitted.has(code));
check(
  `لا رمز محجوز يردّ فعلاً (زائد: ${wronglyEmitted.join(", ") || "لا شيء"})`,
  wronglyEmitted.length === 0,
);
const unknownReserved = reserved.filter((code) => !cloudCodes.has(code));
check(
  `كل رمز محجوز معرّف في cloud_error (مجهول: ${unknownReserved.join(", ") || "لا شيء"})`,
  unknownReserved.length === 0,
);

// 9.5 أسماء الحقول: كل حقل في جسم طلب أو ردّ موجود في api.ts، والعكس.
// الاتجاهان معاً: الأول يمنع حقلاً في المخطط بلا-port في TypeScript،
// والثاني يمنع حقلاً في TypeScript لا يعرفه المخطط، وكلاهما ينقص.
const contractFields = new Map();
for (const [name, def] of Object.entries(cloud.$defs)) {
  if (def["x-contract"] !== true) continue;
  for (const field of Object.keys(def.properties ?? {})) contractFields.set(field, name);
}
check(
  "cloud.schema.json يعرّف أجسام HTTP تحمل x-contract",
  contractFields.size > 0,
);
const apiFields = apiInterfaceFields();
const missingFields = [...contractFields.keys()].filter((field) => !apiFields.has(field));
check(
  `حقول المخطط مغطاة في api.ts (ناقص: ${missingFields.join(", ") || "لا شيء"})`,
  missingFields.length === 0,
);
const extraFields = [...apiFields].filter((field) => !contractFields.has(field));
check(
  `api.ts بلا حقل بلا مخطط (زائد: ${extraFields.join(", ") || "لا شيء"})`,
  extraFields.length === 0,
);

// 9.5b التسمية نفسها، لا مجرد التطابق. فاحص 9.5 يكتفي أن يتفق
// المخطط وapi.ts، فلو غيّر أحدهما حقلاً إلى `camelCase` لافتقق 둘هما
// ف 통과. هنا نفرض القاعدة نفسها على الاسم: أسماء حقول JSON لا تُترجم
// ولا تُختصر، و`snake_case` في كل اللغات. ووحدات المجال في auth.ts
// وsync.ts تكتب `camelCase` لأنها داخل عملية، فليس هذا الفحص خطأً عليها
// بل تذكير بأن أسماء المجال لا تسرّب إلى السلك.
const SNAKE_FIELD = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const nonSnakeSchema = [...contractFields.keys()].filter((field) => !SNAKE_FIELD.test(field));
check(
  `حقول cloud.schema.json snake_case (مخالف: ${nonSnakeSchema.join(", ") || "لا شيء"})`,
  nonSnakeSchema.length === 0,
);
const nonSnakeApi = [...apiFields].filter((field) => !SNAKE_FIELD.test(field));
check(
  `حقول api.ts snake_case (مخالف: ${nonSnakeApi.join(", ") || "لا شيء"})`,
  nonSnakeApi.length === 0,
);

// 9.6 كل $ref داخلي في مخطط السحابة يشير إلى تعريف موجود.
const cloudRefs = [...JSON.stringify(cloud).matchAll(/"\$ref":"#\/\$defs\/([a-z_]+)"/g)].map(
  (m) => m[1],
);
const unresolvedRefs = cloudRefs.filter((name) => cloud.$defs[name] === undefined);
check(
  `مراجع cloud.schema.json داخلية موجهة (مجهول: ${unresolvedRefs.join(", ") || "لا شيء"})`,
  unresolvedRefs.length === 0,
);

// 9.7 الوثيقة التنفيذية: رموز الخطأ والمسارات المسرودة فيها. الوثيقة
// رابع أوجه العقد، والانحراف فيها أخطر: هي ما يقرأه من يوثّق عميل، ولا
// شيء يوقف اختلافه. نفحص البنية لا الصياغة: الوثيقة عربية، ودقّة النص
// من شأن القارئ لا الفاحص.
const cloudDocPlain = cloudDoc.replace(/`/g, "");
const undocumentedCodes = [...cloudCodes].filter((code) => !cloudDocPlain.includes(code));
check(
  `رموز الخطأ مسرودة في cloud-api.md (مجهول: ${undocumentedCodes.join(", ") || "لا شيء"})`,
  undocumentedCodes.length === 0,
);
const undocumentedRoutes = [...routeKeys].filter(
  (key) => !cloudDocPlain.includes(key.replace(" ", " | ")),
);
check(
  `المسارات مسرودة في cloud-api.md (مجهول: ${undocumentedRoutes.join(", ") || "لا شيء"})`,
  undocumentedRoutes.length === 0,
);

// جدول الرموز في الوثيقة: العمود الأول رمز والثاني الحالة. نفحصه في
// الاتجاهين، فالرمز الموثَّق بلا وجود في العقد أسوأ من الغائب: يوهم
// القارئ أن الخادم يردّ رمزاً لا يردّه.
const docTable = [...cloudDoc.matchAll(/^\| `([a-z_]+)` \| (\d{3}) \|/gm)].map((m) => [
  m[1],
  Number(m[2]),
]);
check("cloud-api.md يسرد جدول رموز الخطأ بالحالة", docTable.length > 0);
const docMissing = [...cloudCodes].filter((code) => !docTable.some(([known]) => known === code));
check(
  `كل رمز خطأ في cloud-api.md (مجهول: ${docMissing.join(", ") || "لا شيء"})`,
  docMissing.length === 0,
);
const docExtra = docTable.filter(([code]) => !cloudCodes.has(code)).map(([code]) => code);
check(
  `cloud-api.md بلا رمز بلا عقد (زائد: ${docExtra.join(", ") || "لا شيء"})`,
  docExtra.length === 0,
);
const docWrongStatus = docTable
  .filter(([code, status]) => cloudStatus[code] !== undefined && cloudStatus[code] !== status)
  .map(([code, status]) => `${code} ${status}`);
check(
  `حالة كل رمز في cloud-api.md تطابق error_status (مختلف: ${docWrongStatus.join(", ") || "لا شيء"})`,
  docWrongStatus.length === 0,
);

if (failures.length > 0) {
  console.error(`فشل ${failures.length} من ${checks.length} فحصاً:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`نجحت ${checks.length} فحص تطابق عقد.`);
