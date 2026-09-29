/**
 * نقطة تشغيل الخادم السحابي.
 *
 * مسؤوليات هذا الملف ثلاثة لا غير: parsing الطلب، وربط المسارات، وتحويل
 * نتيجة `auth`/`sync` إلى HTTP. كل منطق فيها في وحدته ومختبراً:
 * `auth.ts` و`sync.ts`. لا قرار عمل هنا.
 *
 * المسارات تحت `/v1` ليبقى هناك مجال لإصدار ثانٍ.
 */

import express, { type NextFunction, type Request, type Response } from "express";
import { authenticate, confirmSignup, listSessions, login, refresh, revoke, startSignup } from "./auth.js";
import type { AuthCode, Result as AuthResult } from "./auth.js";
import { type Config, config } from "./config.js";
import { closeDb, type Ctx, liveCtx, ping } from "./db.js";
import {
  changedSince,
  createProfile,
  deleteProfile,
  listProfiles,
  pullProfile,
  type SyncCode,
  writeProfile,
} from "./sync.js";

/** أقصى حجم لطلب. أكبر من حد المحتوى 2MiB برأس وترويسة. */
const BODY_LIMIT = "3mb";

/**
 * حدّ معدّل بسيط على مسارات المصادقة، في الذاكرة.
 *
 * قفل الحساب بعد 5 محاولات يوقف كسر PIN، لكنه لا يوقف إغراق الخادم.
 * الحدّ بالـIP هنا لا يلغي قفل الحساب: الأول يخفّف الحمل، والثاني يمنع
 * التوزّع على الضحايا. في نسخ متعددة الخوابع يلزم حدّ مشترك، وعندها
 * يصبح هذا ساقطاً لا عناء.
 */
const AUTH_WINDOW_MS = 5 * 60_000;
const AUTH_MAX_PER_WINDOW = 20;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + AUTH_WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > AUTH_MAX_PER_WINDOW;
}

/** تنظيف دوري، وإلا نمت بلا حدّ مع كل عنوان IP. */
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now > bucket.resetAt) buckets.delete(key);
  }
}, AUTH_WINDOW_MS);
sweeper.unref();

/** ترجمة رموز المجال إلى HTTP. الرمز يبقى كما هو في الرد. */
const STATUS: Record<string, number> = {
  // مصادقة
  invalid_credentials: 401,
  session_invalid: 401,
  session_expired: 401,
  invalid_code: 400,
  code_expired: 410,
  account_locked: 423,
  email_taken: 409,
  rate_limited: 429,
  too_many_attempts: 429,
  // حدود
  device_limit: 409,
  session_limit: 409,
  profile_limit: 409,
  rule_limit: 409,
  storage_limit: 409,
  // مزامنة
  invalid_slug: 400,
  invalid_name: 400,
  invalid_content: 400,
  slug_taken: 409,
  revision_conflict: 409,
  not_found: 404,
};

function statusOf(code: AuthCode | SyncCode): number {
  return STATUS[code] ?? 500;
}

/**
 * نتيجة المجال إلى HTTP. عند نجاح يعيد `value` كما هو، وعند فشل يعيد
 * `{ code }` بحالة مناسبة. لا نُفصح عن تفاصيل داخلية: `code` ثابت
 * مُعرَّف في وحدة المجال، لا نص عشوائي.
 */
function fail(res: Response, code: AuthCode | SyncCode): void {
  res.status(statusOf(code)).json({ code });
}

type Outcome<T> = AuthResult<T> | { ok: true; value: T } | { ok: false; code: SyncCode };

/** النتيجة إلى HTTP. successes تحتاج تحويل تسمية، فيمرّ عبر `wire`. */
function send<T>(res: Response, result: Outcome<T>, wire: (value: T) => unknown): void {
  if (!result.ok) {
    fail(res, result.code);
    return;
  }
  res.status(200).json(wire(result.value));
}

/* ----------------------------------------------------------- تسمية السلك
 *
 * وحدات المجال (`auth.ts`, `sync.ts`) تكتب camelCase لأنه عُرف TypeScript،
 * لكن قاعدة المستودع تشترط `snake_case` في كل اللغات وأسماء حقول JSON
 * لا تُختصر ولا تُترجم. فالتويل على السلك يتم هنا، عند نقطة الخياطة
 * الوحيدة: `auth.ts` و`sync.ts` لا يعرفان HTTP.
 */

function wireTokens(tokens: {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}): Record<string, unknown> {
  return {
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    expires_in: tokens.expiresIn,
  };
}

function wireProfile(profile: {
  id: string;
  slug: string;
  name: string;
  revision: number;
  updatedAt: string;
}): Record<string, unknown> {
  return {
    id: profile.id,
    slug: profile.slug,
    name: profile.name,
    revision: profile.revision,
    updated_at: profile.updatedAt,
  };
}

/** حقل نصي من جسم الطلب. لا نثق بأي مفتاح غائب. */
function str(body: unknown, field: string): string {
  if (typeof body !== "object" || body === null) return "";
  const value = (body as Record<string, unknown>)[field];
  return typeof value === "string" ? value : "";
}

function optionalStr(body: unknown, field: string): string | null {
  const value = str(body, field).trim();
  return value === "" ? null : value;
}

function num(body: unknown, field: string): number {
  if (typeof body !== "object" || body === null) return Number.NaN;
  const value = (body as Record<string, unknown>)[field];
  return typeof value === "number" ? value : Number.NaN;
}

/** محتوى الملف كما وصل. نمرّره خاماً إلى `validateContent`. */
function content(body: unknown): unknown {
  if (typeof body !== "object" || body === null) return null;
  return (body as Record<string, unknown>)["content"];
}

interface Authed {
  userId: string;
  sessionId: string;
}

type Handler = (req: Request, res: Response) => Promise<void>;

/**
 * حارس التوكن. كل `/v1/sync` يمرّ منه.
 *
 * نردّ `401` بلا تفصيل: توكن غائب، مزيّف، منتهٍ، أو جلسة ملغاة تعطي
 * الرد نفسه. غير ذلك يردّ الرد على وجود الجلسة.
 */
function requireAuth(ctx: Ctx, handler: (req: Request, res: Response, auth: Authed) => Promise<void>): Handler {
  return async (req: Request, res: Response) => {
    const header = req.header("authorization") ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match?.[1]) {
      res.status(401).json({ code: "session_invalid" });
      return;
    }
    const who = await authenticate(ctx, match[1]);
    if (!who.ok) {
      res.status(401).json({ code: "session_invalid" });
      return;
    }
    await handler(req, res, who.value);
  };
}

/** يبني التطبيق. `Ctx` يُمرَّن، فيعمل مع `FakeDb` في الاختبارات. */
export function createApp(ctx: Ctx, appConfig: Config): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: BODY_LIMIT }));

  /** فحوص المسارات: هل تجاوز العنوان الحدّ المسموح؟ */
  const authGate: (req: Request, res: Response, next: NextFunction) => void = (req, res, next) => {
    if (rateLimited(req.ip ?? "unknown")) {
      res.status(429).json({ code: "rate_limited" });
      return;
    }
    next();
  };

  // ------------------------------------------------------------- فحص
  app.get("/healthz", async (_req, res) => {
    const ok = await ping();
    res.status(ok ? 200 : 503).json({ ok });
  });

  // ---------------------------------------------------------- المصادقة
  app.post("/v1/auth/signup/start", authGate, async (req, res) => {
    const result = await startSignup(ctx, str(req.body, "email"));
    if (!result.ok) {
      fail(res, result.code);
      return;
    }
    // في الإنتاج يُرسَل الرمز بالبريد ولا يُعاد هنا. في التطوير نعيده
    // وإلا تعذّر اختبار التدفق بلا خدمة بريد.
    const body: Record<string, unknown> = { sent: true };
    if (appConfig.env !== "production") body["code"] = result.value.code;
    res.status(202).json(body);
  });

  app.post("/v1/auth/signup/confirm", authGate, async (req, res) => {
    const result = await confirmSignup(ctx, str(req.body, "email"), str(req.body, "code"));
    if (!result.ok) {
      fail(res, result.code);
      return;
    }
    // الـPIN يُعاد مرة واحدة عند الإنشاء. بعدها لا يُستعاد أبداً.
    res.status(201).json({ pin: result.value.pin });
  });

  app.post("/v1/auth/login", authGate, async (req, res) => {
    const result = await login(
      ctx,
      str(req.body, "email"),
      str(req.body, "pin"),
      str(req.body, "device_id"),
      str(req.body, "device_label"),
      req.ip ?? null,
    );
    if (!result.ok) {
      fail(res, result.code);
      return;
    }
    // `user_id` و`plan` على السلك: العميل يعرض حدود الخطة ولا يخمّنها.
    res.status(200).json({
      ...wireTokens(result.value),
      user_id: result.value.userId,
      plan: result.value.plan,
    });
  });

  app.post("/v1/auth/refresh", authGate, async (req, res) => {
    send(res, await refresh(ctx, str(req.body, "refresh_token")), wireTokens);
  });

  app.post("/v1/auth/logout", async (req, res) => {
    await revoke(ctx, str(req.body, "refresh_token"));
    // نردّ `204` دائماً، حتى لو كان التوكن غير معروف: وجود التوكن
    // معلومة لا نضيف عليها تأكيداً.
    res.status(204).end();
  });

  app.get(
    "/v1/auth/sessions",
    requireAuth(ctx, async (_req, res, auth) => {
      const sessions = await listSessions(ctx, auth.userId);
      res.status(200).json({
        sessions: sessions.map((s) => ({
          device_label: s.deviceLabel,
          created_at: s.createdAt,
          last_used_at: s.lastUsedAt,
          active: s.active,
        })),
      });
    }),
  );

  // ---------------------------------------------------------- المزامنة
  app.get(
    "/v1/sync/profiles",
    requireAuth(ctx, async (_req, res, auth) => {
      const profiles = await listProfiles(ctx, auth.userId);
      res.status(200).json({ profiles: profiles.map(wireProfile) });
    }),
  );

  app.get(
    "/v1/sync/profiles/changed",
    requireAuth(ctx, async (req, res, auth) => {
      const since = optionalStr(req.query, "since");
      const profiles = await changedSince(ctx, auth.userId, since ?? undefined);
      res.status(200).json({ profiles: profiles.map(wireProfile) });
    }),
  );

  app.get(
    "/v1/sync/profiles/:id",
    requireAuth(ctx, async (req, res, auth) => {
      send(res, await pullProfile(ctx, auth.userId, req.params["id"] ?? ""), (view) => ({
        ...wireProfile(view),
        content: view.content,
      }));
    }),
  );

  app.post(
    "/v1/sync/profiles",
    requireAuth(ctx, async (req, res, auth) => {
      const result = await createProfile(ctx, auth.userId, {
        slug: str(req.body, "slug"),
        name: str(req.body, "name"),
        content: content(req.body),
        deviceId: optionalStr(req.body, "device_id"),
      });
      if (!result.ok) {
        fail(res, result.code);
        return;
      }
      res.status(201).json(wireProfile(result.value));
    }),
  );

  app.put(
    "/v1/sync/profiles/:id",
    requireAuth(ctx, async (req, res, auth) => {
      const result = await writeProfile(ctx, auth.userId, {
        profileId: req.params["id"] ?? "",
        expectedRevision: num(req.body, "expected_revision"),
        name: str(req.body, "name"),
        content: content(req.body),
        deviceId: optionalStr(req.body, "device_id"),
      });
      send(res, result, wireProfile);
    }),
  );

  app.delete(
    "/v1/sync/profiles/:id",
    requireAuth(ctx, async (req, res, auth) => {
      const result = await deleteProfile(ctx, auth.userId, {
        profileId: req.params["id"] ?? "",
        expectedRevision: num(req.body, "expected_revision"),
        deviceId: optionalStr(req.body, "device_id"),
      });
      if (!result.ok) {
        fail(res, result.code);
        return;
      }
      res.status(204).end();
    }),
  );

  // ----------------------------------------------------------- أخطاء
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ code: "not_found" });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // جسم ضخم أو JSON تالف: `express.json` يرمي قبل المسارات.
    if (error instanceof SyntaxError) {
      res.status(400).json({ code: "invalid_body" });
      return;
    }
    // خطأ غير متوقع: نردّ رمزاً ثابتاً، ولا نطبع التفاصيل للعميل.
    console.error("خطأ غير معالج:", error instanceof Error ? error.message : error);
    res.status(500).json({ code: "internal" });
  });

  return app;
}

/** يشغّل الخادم. يُستدعى عند تنفيذ الملف مباشرة. */
export async function start(): Promise<void> {
  const appConfig = config();
  const app = createApp(liveCtx(), appConfig);
  const server = app.listen(appConfig.port, () => {
    console.log(`lansher-server يستمع على ${appConfig.port} (${appConfig.env})`);
  });

  // إغلاق نظيف: Cloud Run يرسل SIGTERM قبل الإيقاف.
  const stop = () => {
    server.close(() => {
      void closeDb().then(() => process.exit(0));
    });
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("index.ts") || entry.endsWith("index.js")) {
  void start();
}
