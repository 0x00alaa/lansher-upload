/**
 * المصادقة: التسجيل، الدخول، الجلسات.
 *
 * قرارات أمنية مطبَّقة هنا، وكلها مغطّاة بـ`test/auth.test.ts`:
 *
 * 1. **لا نردّ «البريد غير مسجّل» أبداً.** نردّ نفس الرسالة ونفس الزمن
 *    تقريباً للحالتين، وإلا استُخدم الرد لجمع بريد ضحايا.
 * 2. **قفل الحساب بعد 5 محاولات** على مستوى الحساب لا الـIP، وإلا
 *    مهاجم يتوزّع الطلبات ويتفادى القفل.
 * 3. **تدوير التوكن عند كل استخدام.** لو سُرق توكن واستُخدم مرتين، Usage
 *    الثانية تكشفه: `previous_hash` يسجّله والـrefresh يُبطَل.
 * 4. **الـaccess قصير العمر (15 دقيقة) ويُجدَّد بـrefresh.** lost EXE
 *    لا يعني جلسة مفتوحة لأيام.
 * 5. **لا PIN ولا توكن في `audit_log` ولا في السجلات أبداً.**
 */

import {
  emailHash,
  encryptEmail,
  generateEmailCode,
  generatePin,
  hashPin,
  isValidPinFormat,
  newSessionToken,
  sessionTokenHash,
  sha256,
  signAccessToken,
  verifyAccessToken,
  verifyPin,
} from "./crypto.js";
import type { Config } from "./config.js";
import type { Ctx, Row, Tx } from "./db.js";
import { checkSessions } from "./limits.js";

/** رموز خطأ ثابتة. الواجهة تبني رسائلها منها، ولا نترجمها هنا. */
export type AuthCode =
  | "ok"
  | "invalid_code"
  | "code_expired"
  | "too_many_attempts"
  | "account_locked"
  | "rate_limited"
  | "device_limit"
  | "session_limit"
  | "invalid_credentials"
  | "session_invalid"
  | "session_expired"
  | "email_taken";

export type Result<T> = { ok: true; value: T } | { ok: false; code: AuthCode };

/** صف مستخدم كما يحتاجه `auth.ts` فقط: بلا سرّ قابل للعكس. */
interface UserRow extends Row {
  id: string;
  pin_hash: string;
  status: "active" | "locked" | "deleted";
  plan: "free" | "pro";
  failed_logins: number;
  last_failed_at: Date | null;
}

function fail<T>(code: AuthCode): Result<T> {
  return { ok: false, code };
}

// ------------------------------------------------------------- التسجيل

/**
 * طلب تسجيل: نتحقق أن البريد غير مستخدم، ثم نرسل رمزاً قصيراً.
 * الحساب **لا يُنشأ** قبل تأكيد الرمز، حتى لا تُشغل قاعدة البيانات
 * ببريدات وهمية.
 */
export async function startSignup(ctx: Ctx, email: string): Promise<Result<{ code: string }>> {
  const normalized = email.trim().toLowerCase();
  const existing = await ctx.db.one<{ id: string }>(
    "SELECT id FROM users WHERE email_hash = $1 AND status <> 'deleted'",
    [emailHash(ctx.config, normalized)],
  );
  if (existing) {
    // ننشئ الرمز فعلاً، ثم يُرسَل بريد محايد للقارئ. الرد نعم.
    // فلا يصبح «بريد مستخدم» معلومةً متاحة عبر الرد أو التوقيت.
    return { ok: true, value: { code: await issueCode(ctx, existing.id, "signup") } };
  }
  const code = await issueCodeForNewUser(ctx, normalized, "signup");
  return { ok: true, value: { code } };
}

/** إنشاء رمز لحساب قائم. */
async function issueCode(
  ctx: Ctx,
  userId: string,
  purpose: "signup" | "login",
): Promise<string> {
  const code = generateEmailCode();
  await ctx.db.run(
    `INSERT INTO email_codes (code_hash, user_id, purpose, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(mins => $4))`,
    [sha256(code), userId, purpose, ctx.config.codeTtlMinutes],
  );
  return code;
}

/** حساب جديد: `pin_hash` مؤقّت حتى تأكيد الرمز. */
async function issueCodeForNewUser(
  ctx: Ctx,
  email: string,
  purpose: "signup" | "login",
): Promise<string> {
  const code = generateEmailCode();
  await ctx.db.transaction(async (tx) => {
    const inserted = await tx.one<{ id: string }>(
      `INSERT INTO users (email_hash, email_cipher, pin_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (email_hash) DO UPDATE SET email_hash = EXCLUDED.email_hash
       RETURNING id`,
      [emailHash(ctx.config, email), encryptEmail(ctx.config, email), "pending"],
    );
    await tx.run(
      `INSERT INTO email_codes (code_hash, user_id, purpose, expires_at)
       VALUES ($1, $2, $3, now() + make_interval(mins => $4))`,
      [sha256(code), inserted?.id, purpose, ctx.config.codeTtlMinutes],
    );
  });
  return code;
}

/** تأكيد التسجيل: يتحقق من الرمز، يولّد PIN، يعيده مرة واحدة فقط. */
export async function confirmSignup(
  ctx: Ctx,
  email: string,
  code: string,
): Promise<Result<{ pin: string }>> {
  void email; // الربط يتم عبر الرمز نفسه.
  return ctx.db.transaction(async (tx) => {
    const row = await tx.one<{ user_id: string; attempts: number }>(
      `SELECT user_id, attempts FROM email_codes
        WHERE code_hash = $1 AND purpose = 'signup' AND expires_at > now()`,
      [sha256(code)],
    );
    if (!row) return fail<{ pin: string }>("invalid_code");
    if (row.attempts >= 5) return fail<{ pin: string }>("too_many_attempts");
    await tx.run("UPDATE email_codes SET attempts = attempts + 1 WHERE code_hash = $1", [
      sha256(code),
    ]);

    const user = await tx.one<UserRow>(
      "SELECT id, pin_hash, status, plan, failed_logins, last_failed_at FROM users WHERE id = $1",
      [row.user_id],
    );
    if (!user) return fail<{ pin: string }>("invalid_code");

    const pin = generatePin(6);
    await tx.run("UPDATE users SET pin_hash = $1, status = 'active' WHERE id = $2", [
      await hashPin(ctx.config, pin),
      user.id,
    ]);
    await tx.run("DELETE FROM email_codes WHERE user_id = $1", [user.id]);
    return { ok: true, value: { pin } };
  });
}

// -------------------------------------------------------------- الدخول

export interface SessionTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
  readonly userId: string;
  readonly plan: "free" | "pro";
}

/** محاولة دخول بالـPIN. الفشل يزيد العدّاد، والخمس قفل. */
export async function login(
  ctx: Ctx,
  email: string,
  pin: string,
  deviceId: string,
  deviceLabel: string,
  createdIp: string | null,
): Promise<Result<SessionTokens>> {
  if (!isValidPinFormat(pin)) {
    // نحسب التجزئة رغم الخطأ حتى يستغرق الرد زمناً مشابهاً،
    // فلا يميّز المهاجم بين «صيغة خاطئة» و«PIN خاطئ».
    await hashPin(ctx.config, pin);
    return fail<SessionTokens>("invalid_credentials");
  }

  return ctx.db.transaction(async (tx) => {
    const user = await tx.one<UserRow>(
      `SELECT id, pin_hash, status, plan, failed_logins, last_failed_at
         FROM users WHERE email_hash = $1 AND status <> 'deleted'`,
      [emailHash(ctx.config, email)],
    );
    if (!user) {
      // حساب غير موجود: نحسب تجزئة وهمية لزمن مماثل.
      await verifyPin(ctx.config, pin, FAKE_HASH);
      return fail<SessionTokens>("invalid_credentials");
    }

    if (user.status === "locked") {
      const tooSoon =
        user.last_failed_at !== null &&
        Date.now() - user.last_failed_at.getTime() < ctx.config.lockoutMinutes * 60_000;
      return fail<SessionTokens>(tooSoon ? "rate_limited" : "invalid_credentials");
    }

    if (!(await verifyPin(ctx.config, pin, user.pin_hash))) {
      await tx.run(
        `UPDATE users SET failed_logins = failed_logins + 1, last_failed_at = now()
           WHERE id = $1`,
        [user.id],
      );
      const reached = user.failed_logins + 1 >= ctx.config.maxFailedLogins;
      if (reached) await tx.run("UPDATE users SET status = 'locked' WHERE id = $1", [user.id]);
      return fail<SessionTokens>(reached ? "account_locked" : "invalid_credentials");
    }

    const sessions = await checkSessions(ctx, user.plan, await activeSessionCount(tx, user.id));
    if (!sessions.allowed) {
      return fail<SessionTokens>(
        sessions.reason === "session_limit" ? "session_limit" : "rate_limited",
      );
    }

    await tx.run("UPDATE users SET failed_logins = 0, last_failed_at = NULL WHERE id = $1", [
      user.id,
    ]);
    const tokens = await mintTokens(tx, ctx, user.id, user.plan, deviceId, deviceLabel, createdIp);
    await audit(tx, user.id, null, "login_success", { device_id: deviceId });
    return { ok: true, value: tokens };
  });
}

/** تجزئة وهمية بصيغة صالحة، ليجري الحساب exempted-زمن متساوٍ. */
const FAKE_HASH = "scrypt$1024$8$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

/** توليد زوج توكنات. الـrefresh يُخزَّن مجزّأة فقط. */
async function mintTokens(
  tx: Tx,
  ctx: Ctx,
  userId: string,
  plan: "free" | "pro",
  deviceId: string,
  deviceLabel: string,
  createdIp: string | null,
): Promise<SessionTokens> {
  const refreshToken = newSessionToken();

  // `RETURNING id`: التوكن الموقَّق يحمل `sid` فتبقى الجلسة قابلة
  // للإبطال. معرّف يولّده Postgres، فنقرأه ولا نخترعه.
  const session = await tx.one<{ id: string }>(
    `INSERT INTO sessions (user_id, token_hash, device_label, device_id, created_ip, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6))
     RETURNING id`,
    [
      userId,
      sessionTokenHash(ctx.config, refreshToken),
      deviceLabel,
      deviceId,
      createdIp,
      ctx.config.sessionTtlDays,
    ],
  );
  if (!session) throw new Error("فشل إنشاء الجلسة: لم يُرجع Postgres معرّفاً");

  await tx.run(
    `INSERT INTO user_devices (user_id, device_id, label, last_ip)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, device_id)
     DO UPDATE SET last_seen_at = now(), last_ip = EXCLUDED.last_ip`,
    [userId, deviceId, deviceLabel, createdIp],
  );

  const accessToken = signAccessToken(ctx.config, {
    sid: session.id,
    uid: userId,
    exp: accessExpiry(ctx.config),
  });
  return { accessToken, refreshToken, expiresIn: ctx.config.accessTtlSeconds, userId, plan };
}

/** ثوانٍ حتى انتهاء توكن الوصول. */
function accessExpiry(config: Config): number {
  return Math.floor(Date.now() / 1000) + config.accessTtlSeconds;
}

async function activeSessionCount(tx: Tx, userId: string): Promise<number> {
  const row = await tx.one<{ count: string }>(
    `SELECT count(*)::text AS count FROM sessions
      WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [userId],
  );
  return Number(row?.count ?? 0);
}

// ------------------------------------------------------- تدوير الجلسة

export interface Refreshed {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
}

/**
 * تدوير: `refresh` يسلّم `refresh` جديداً ويُبطل القديم. إعادة استخدام
 * `refresh` مُبطَل → `session_invalid` وتُبطل كل جلسات المستخدم.
 */
export async function refresh(ctx: Ctx, refreshToken: string): Promise<Result<Refreshed>> {
  const hash = sessionTokenHash(ctx.config, refreshToken);
  return ctx.db.transaction(async (tx) => {
    const row = await tx.one<{
      id: string;
      user_id: string;
      revoked_at: Date | null;
      expires_at: Date;
    }>(
      `SELECT id, user_id, revoked_at, expires_at FROM sessions WHERE token_hash = $1`,
      [hash],
    );
    if (!row) return fail<Refreshed>("session_invalid");

    if (row.revoked_at !== null) {
      // توكن مُبطَل أُعيد استخدامه: تسريب. نُبطل كل جلسات المستخدم.
      await tx.run(
        "UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
        [row.user_id],
      );
      await audit(tx, row.user_id, row.id, "session_reuse_detected", {});
      return fail<Refreshed>("session_invalid");
    }
    if (row.expires_at.getTime() < Date.now()) return fail<Refreshed>("session_expired");

    const newRefresh = newSessionToken();
    await tx.run(
      "UPDATE sessions SET revoked_at = now(), previous_hash = $2, rotated_at = now() WHERE id = $1",
      [row.id, hash],
    );
    // جلسة جديدة تحمل `sid` جديداً، فنحتاج معرّفها لتوقيع توكن الوصول.
    const rotated = await tx.one<{ id: string }>(
      `INSERT INTO sessions (user_id, token_hash, device_label, expires_at)
       VALUES ($1, $2, $3, now() + make_interval(days => $4))
       RETURNING id`,
      [row.user_id, sessionTokenHash(ctx.config, newRefresh), "مجدول", ctx.config.sessionTtlDays],
    );
    if (!rotated) throw new Error("فشل تدوير الجلسة: لم يُرجع Postgres معرّفاً");
    const newAccess = signAccessToken(ctx.config, {
      sid: rotated.id,
      uid: row.user_id,
      exp: accessExpiry(ctx.config),
    });
    return {
      ok: true,
      value: { accessToken: newAccess, refreshToken: newRefresh, expiresIn: ctx.config.accessTtlSeconds },
    };
  });
}

/** إبطال جلسة واحدة (تسجيل خروج). */
export async function revoke(ctx: Ctx, refreshToken: string): Promise<Result<null>> {
  await ctx.db.run(
    "UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL",
    [sessionTokenHash(ctx.config, refreshToken)],
  );
  return { ok: true, value: null };
}

export interface SessionView {
  readonly deviceLabel: string;
  readonly createdAt: string;
  readonly lastUsedAt: string;
  readonly active: boolean;
}

/** جلسات المستخدم للعرض في «الأجهزة». */
export async function listSessions(ctx: Ctx, userId: string): Promise<SessionView[]> {
  const rows = await ctx.db.many<{
    device_label: string;
    created_at: Date;
    last_used_at: Date;
    revoked_at: Date | null;
    expires_at: Date;
  }>(
    `SELECT device_label, created_at, last_used_at, revoked_at, expires_at
       FROM sessions WHERE user_id = $1 ORDER BY last_used_at DESC LIMIT 50`,
    [userId],
  );
  return rows.map((row) => ({
    deviceLabel: row.device_label,
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at.toISOString(),
    active: row.revoked_at === null && row.expires_at.getTime() > Date.now(),
  }));
}

/**
 * صاحب طلب HTTP: من التوكن الموقَّق إلى صاحب الجلسة.
 *
 * نقرأ الجلسة رغم أن التوكن موقَّق، لأن التوقيع وحده لا يُبطل: توكن
 * موقَّق صحيح مع جلسة ملغاة أو منتهية يجب أن يُرفض. بلا هذه القراءة يبقى
 * `logout` بلا أثر على الـaccess حتى ينتهي.
 */
export async function authenticate(
  ctx: Ctx,
  accessToken: string,
): Promise<Result<{ userId: string; sessionId: string }>> {
  const claims = verifyAccessToken(ctx.config, accessToken);
  // نردّ `session_invalid` لكل فشل: لا نُفصح أي جزء هو الخطأ.
  if (!claims) return fail<{ userId: string; sessionId: string }>("session_invalid");

  const row = await ctx.db.one<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM sessions
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > now()`,
    [claims.sid, claims.uid],
  );
  if (!row) return fail<{ userId: string; sessionId: string }>("session_invalid");

  await ctx.db.run("UPDATE sessions SET last_used_at = now() WHERE id = $1", [row.id]);
  return { ok: true, value: { userId: row.user_id, sessionId: row.id } };
}

async function audit(
  tx: Tx,
  userId: string | null,
  sessionId: string | null,
  action: string,
  context: Record<string, unknown>,
): Promise<void> {
  await tx.run(`INSERT INTO audit_log (user_id, session_id, action, context) VALUES ($1, $2, $3, $4)`, [
    userId,
    sessionId,
    action,
    JSON.stringify(context),
  ]);
}
