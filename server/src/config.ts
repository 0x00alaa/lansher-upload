/**
 * قراءة بيئة التشغيل والتحقق منها.
 *
 * مبدأ: **الخادم يرفض الإقلاع ببيئة ناقصة.** البديل-started رغم مفتاح
 * مفقود يعني افتراضاً هادئاً ثم فشلاً صامتاً بعد ساعات. هنا نفشل سريعاً
 * وواضحاً قبل أي اتصال.
 *
 * لا قيم افتراضية لأسرار. `SESSION_PEPPER` و`EMAIL_KEY` بلا قيمة
 * افتراضية: مفتاح ضعيف مكتوب في المستودع أسوأ من انقطاع الخدمة، لأنه
 * يبدو أنه يعمل.
 */

export class ConfigError extends Error {
  constructor(readonly missing: readonly string[]) {
    super(
      `متغيرات البيئة الناقصة: ${missing.join(", ")}. ` +
        "النسخة لا تُقلع ببيئة ناقصة؛ راجع .env.example.",
    );
    this.name = "ConfigError";
  }
}

export interface Config {
  readonly env: "development" | "production" | "test";
  readonly port: number;
  readonly databaseUrl: string;
  /**
   * مفتاح لـHMAC-SHA256 فوق تجزئة البريد.pepper سري ولا يُدوّر إلا
   * بتغيير كل `email_hash`، فتدويره بهدوء يبطل كل بريد مسجّل.
   */
  readonly emailPepper: string;
  /**
   * سر عالي العشوائية يُضاف إلى `session token` قبل التجزئة. بخلاف
   * `pin_hash` التوكن عشوائي أصلاً، لكن الـpepper يفرض إبطال فوري لكل
   * الجلسات عند التسريب بتغيير قيمة واحدة.
   */
  readonly sessionPepper: string;
  /** مفتاح تشفير البريد المخزَّن (AES-256-GCM). 32 بايت base64. */
  readonly emailKey: string;
  /** عنوان مزوّد إرسال البريد. غائب في التطوير: نطبع الرمز بدل إرساله. */
  readonly mailFrom: string | null;
  /** رابط الواجهة، للتحويل في رسائل البريد. */
  readonly publicUrl: string;
  readonly sessionTtlDays: number;
  readonly accessTtlSeconds: number;
  readonly codeTtlMinutes: number;
  readonly maxFailedLogins: number;
  readonly lockoutMinutes: number;
  /** Bcrypt لا، فنستعمل Argon2id عبر مكتبة خفيفة. */
  readonly argon2: { memoryKiB: number; iterations: number; parallelism: number };
}

function required(name: string, missing: string[]): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    missing.push(name);
    return "";
  }
  return value;
}

function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function load(): Config {
  const missing: string[] = [];
  const databaseUrl = required("DATABASE_URL", missing);
  const emailPepper = required("EMAIL_PEPPER", missing);
  const sessionPepper = required("SESSION_PEPPER", missing);
  const emailKey = required("EMAIL_ENCRYPTION_KEY", missing);

  if (missing.length > 0) throw new ConfigError(missing);

  const env = (process.env["NODE_ENV"] ?? "development") as Config["env"];
  if (env !== "development" && env !== "production" && env !== "test") {
    throw new ConfigError([`NODE_ENV غير معروف: ${env}`]);
  }

  // حماية إضافية في الإنتاج:Pepper قصير أو مفتاح 32 بايت خطأ تنSiege.
  if (env === "production") {
    if (emailPepper.length < 32) {
      throw new ConfigError(["EMAIL_PEPPER (يجب 32 محرفاً على الأقل في الإنتاج)"]);
    }
    if (sessionPepper.length < 32) {
      throw new ConfigError(["SESSION_PEPPER (يجب 32 محرفاً على الأقل في الإنتاج)"]);
    }
  }
  const keyBytes = Buffer.from(emailKey, "base64");
  if (keyBytes.length !== 32) {
    throw new ConfigError([
      `EMAIL_ENCRYPTION_KEY (يجب فكّها 32 بايت، وُجد ${keyBytes.length})`,
    ]);
  }

  return {
    env,
    port: optionalInt("PORT", 8080),
    databaseUrl,
    emailPepper,
    sessionPepper,
    emailKey,
    mailFrom: process.env["MAIL_FROM"] ?? null,
    publicUrl: process.env["PUBLIC_URL"] ?? "http://localhost:8080",
    sessionTtlDays: optionalInt("SESSION_TTL_DAYS", 30),
    accessTtlSeconds: optionalInt("ACCESS_TTL_SECONDS", 900),
    codeTtlMinutes: optionalInt("CODE_TTL_MINUTES", 10),
    maxFailedLogins: optionalInt("MAX_FAILED_LOGINS", 5),
    lockoutMinutes: optionalInt("LOCKOUT_MINUTES", 15),
    argon2: {
      memoryKiB: optionalInt("ARGON2_MEMORY_KIB", 65_536),
      iterations: optionalInt("ARGON2_ITERATIONS", 3),
      parallelism: optionalInt("ARGON2_PARALLELISM", 1),
    },
  };
}

let cached: Config | null = null;

export function config(): Config {
  cached ??= load();
  return cached;
}

/** للاختبارات: تحميل بيئة متغيرة دون إعادة تشغيل العملية. */
export function resetConfigForTests(): void {
  cached = null;
}
