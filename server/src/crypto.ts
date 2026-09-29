/**
 * عمليات التشفير والاشتقاق.
 *
 * القاعدة الحاكمة: **ما نخزّن أي سرّ، ولا حتى مشتقّه القابل للعكس.**
 * لكل قيمة «يجب أن نطابقها لاحقاً» نخزّن digest، ونقارن بـconstant-time.
 *
 * لماذا Argon2id للـPIN وSHA-256 لتوكن الجلسة:
 * الـPIN مدخل بشري قصير (4-8 أرقام)، فالهجوم بالقوة الغاشمة رخيص بدون
 * دالة غالية. الـPIN صحيح أو PIN خاطئ: Argon2id يجعل كل محاولة غالية.
 * توكن الجلسة 32 بايت عشوائية: فضول attackers لا يجرّب Guessing، بل
 * انسخ من الجدول. SHA-256 يكفي، والـpepper يُبطل كل شيء بتغيير قيمة.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import type { Config } from "./config.js";

const PIN_ALPHABET = "0123456789";

/** SHA-256. تُستخدم لتخزين رموز الجلسة والأكواد، لا للمدخلات البشرية. */
export function sha256(data: string | Buffer): Buffer {
  return createHash("sha256").update(data).digest();
}

/** HMAC-SHA256 بمفتاح، مع فصل النطاقات لمنع إعادة استخدام نفس التوقيع. */
export function hmac(pepper: string, domain: string, value: string): Buffer {
  return createHmac("sha256", pepper).update(`${domain}:${value}`).digest();
}

/** تجزئة البريد للـDedup. المفتاح `EMAIL_PEPPER` يفصلها عن أي تجزئة أخرى. */
export function emailHash(config: Config, email: string): Buffer {
  return hmac(config.emailPepper, "email", email.trim().toLowerCase());
}

/** تشفير البريد المخزَّن بـAES-256-GCM، مع IV جديد لكل قيمة. */
export function encryptEmail(config: Config, email: string): Buffer {
  const key = Buffer.from(config.emailKey, "base64");
  const iv = randomBytes(12); // GCM: 12 بايت هو المعيار الموصى به.
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(email, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // نخزّن IV وTag مع النص: من يخسرهما لا يستطيع فكّ الرسالة.
  return Buffer.concat([iv, tag, ciphertext]);
}

export function decryptEmail(config: Config, packed: Buffer): string {
  const key = Buffer.from(config.emailKey, "base64");
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const ciphertext = packed.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/**
 * توليد PIN عشوائي. **مقصود أن يكون قصيراً** لأن الم المستخدم يقرؤه من
 * بريد. 6 أرقام = مليون احتمال، وهذا مقبول مع قفل الحساب بعد 5 محاولات
 * و TTL قصير. فolate، PIN أطول لا يناسب تجربة البريد.
 */
export function generatePin(length = 6): string {
  // نرفض عيّنات مرفوضة (modulo bias) لأن 256 % 10 != 0.
  const out: string[] = [];
  while (out.length < length) {
    for (const byte of randomBytes(length)) {
      if (byte < 250) {
        out.push(PIN_ALPHABET[byte % 10] as string);
        if (out.length === length) break;
      }
    }
  }
  return out.join("");
}

/** هل الشكل مقبول؟ لا نرفض هنا، نتحقق ونخزّن. الشكل يمنع DOS. */
export function isValidPinFormat(pin: string): boolean {
  return /^\d{4,8}$/.test(pin);
}

/** تجزئة الرمز للتحقق. الخوارزمية موسومة في الناتج نفسها. */
export async function hashPin(config: Config, pin: string): Promise<string> {
  const { memoryKiB, parallelism } = config.argon2;
  const r = 8;
  const targetBytes = memoryKiB * 1024;
  const n = 2 ** Math.max(1, Math.round(Math.log2(targetBytes / (128 * r))));
  return derivePin(pin, randomBytes(16), n, r, Math.max(1, parallelism));
}

/**
 * تحقق constant-time من PIN مقابل التجزئة المخزَّنة.
 *
 * **نقرأ المعاملات من التجزئة نفسها** لا من الإعدادات الحالية. لو غيّرت
 * `ARGON2_MEMORY_KIB` بعد-deployment، تبقى التجزئات القديمة قابلة
 * للتحقق: معاملاتها محفوظة معها. القارئ منها يقرأ الإعدادات فقط.
 */
export async function verifyPin(
  _config: Config,
  pin: string,
  storedHash: string,
): Promise<boolean> {
  const parts = storedHash.split("$");
  // الشكل: `scrypt$N$r$salt$hash`
  if (parts.length !== 5 || parts[0] !== "scrypt") return false;
  const [, nRaw, rRaw, saltRaw, hashRaw] = parts as [string, string, string, string, string];
  const n = Number.parseInt(nRaw, 10);
  const r = Number.parseInt(rRaw, 10);
  if (!Number.isInteger(n) || !Number.isInteger(r) || n < 2 || r < 1) return false;

  let derived: string;
  try {
    derived = await derivePin(pin, Buffer.from(saltRaw, "base64"), n, r, 1);
  } catch {
    // معاملات تالفة في الجدول: نعاملها كـ«لا يطابق» لا كخطأ 500.
    return false;
  }
  return constantTimeEqualB64(derived.split("$")[4] as string, hashRaw);
}

/** اشتقاق واحد. منفصل حتى تُستخدم نفس الصيغة في Hash و Verify. */
async function derivePin(
  pin: string,
  salt: Buffer,
  n: number,
  r: number,
  p: number,
): Promise<string> {
  const maxmem = Math.max(256 * n * r, 32 * 1024 * 1024);
  const derived = await scryptAsync(pin.normalize("NFKC"), salt, 32, { N: n, r, p, maxmem });
  return `scrypt$${n}$${r}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, key) =>
      err ? reject(err) : resolve(key as Buffer),
    );
  });
}

/** مقارنة base64 بطول ثابت. لا تسرّب معلومات عبر التوقيت. */
export function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

/** مقارنة base64 بطول ثابت، لتجزئة PIN. */
export function constantTimeEqualB64(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "base64"), Buffer.from(b, "base64"));
}

/** توكن جلسة جديد: 32 بايت عشوائية، base64url. */
export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** تجزئة توكن الجلسة للتخزين. الـpepper يُضاف قبل التجزئة. */
export function sessionTokenHash(config: Config, token: string): Buffer {
  return hmac(config.sessionPepper, "session", token);
}

/** رمز تحقق قصير: 8 أرقام sufficient لـTTL 10 دق و 5 محاولات. */
export function generateEmailCode(): string {
  const bytes = randomBytes(6);
  let code = 0;
  for (const byte of bytes) code = (code * 256 + byte) % 100_000_000;
  return code.toString().padStart(8, "0");
}

// ----------------------------------------------------------- توكن الوصول

/**
 * توكن وصول موقَّع: `base64url(payload).base64url(hmac)`.
 *
 * لِمَ يُوقَّع ولا يُخزَّن؟ كل طلب مزامنة يحتاج صاحب الجلسة. تخزين كل
 * توكن في جدول يعني قراءة قاعدة لكل طلب، والجدول ينمو بلا حدّ. التوكن
 * الموقَّع يُتحقق منه في الذاكرة، ويبقى `sid` فيه ليبقى الإبطال ممكناً
 * عند غيّر الجهاز أو logout: نقرأ الجلسة مرة عند أول طلب ونقارن.
 */
export interface AccessClaims {
  /** معرّف الجلسة، لمطابقة `sessions.id` عند الحاجة للإبطال. */
  readonly sid: string;
  readonly uid: string;
  /** ثوانٍ منذ epoch. */
  readonly exp: number;
}

const ACCESS_DOMAIN = "access";

function accessMac(config: Config, signingInput: string): Buffer {
  return hmac(config.sessionPepper, ACCESS_DOMAIN, signingInput);
}

export function signAccessToken(config: Config, claims: AccessClaims): string {
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const mac = accessMac(config, payload);
  return `${payload}.${mac.toString("base64url")}`;
}

/**
 * التحقق من توكن وصول. يفشل صامتاً: رمز واحد لكل سبب، فلا نُفصح عن
 * أيها كان: صيغة، توقيع، ادعاء، أو انتهاء.
 */
export function verifyAccessToken(config: Config, token: string): AccessClaims | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, mac] = parts;
  if (payload === undefined || mac === undefined) return null;

  // نقارن قبل فك التوقيع: التوكن المعدَّل يفشل هنا.
  if (!constantTimeEqualB64(mac, accessMac(config, payload).toString("base64url"))) return null;

  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!isClaims(claims)) return null;
  // `exp * 1000`: التوكن بالثواني، و`Date.now()` بالمللي ثانية.
  if (claims.exp * 1000 <= Date.now()) return null;
  return claims;
}

function isClaims(value: unknown): value is AccessClaims {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c["sid"] === "string" &&
    typeof c["uid"] === "string" &&
    typeof c["exp"] === "number" &&
    Number.isFinite(c["exp"])
  );
}
