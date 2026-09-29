/**
 * اختبارات طبقة HTTP: التوجيه، الترويسة، التسمية على السلك، ورموز الفشل.
 *
 * `auth.test.ts` و`sync.test.ts` يختبران الوحدات مباشرة. هذا الملف يختبر
 * ما لا يظهر فيهما: أن `createApp` يربط المسار الصحيح بالحالة الصحيحة،
 * وأن ما يخرج على السلك `snake_case` كما يقتضي عقد المستودع، وأن الفشل
 * رمز ثابت لا نصّ حرّ، وأن طبقة HTTP لا تنفّذ منطقاً من عندها.
 *
 * ## ميزانية حدّ المعدّل
 *
 * `index.ts` يحتفظ بدلو في الذاكرة على مستوى الوحدة: 20 طلباً لكل
 * `req.ip` كل خمس دقائق، على **أربعة** مسارات فقط:
 * `signup/start` و`signup/confirm` و`login` و`refresh`. وما عداها — كل
 * مسارات المزامنة، و`logout`، و`sessions`، و`/healthz`، و404 — خارج الحدّ.
 *
 * عنوان كل الطلبات واحد (127.0.0.1) والدلو واحد لكل العملية، فميزانية
 * واحدة للملف كله. نبقيها تحت 20 هكذا:
 *
 * - المسار السليم عبر HTTP: 3 (بدء، تأكيد، دخول).
 * - اختبار بيئة الإنتاج: 1.
 * - اختبار عدم التسريب: 3 (نفس الثلاثة).
 * - طلب بجسم JSON تالف إلى `login`: 1، وهو لا يبلغ البوابة أصلاً لأن
 *   `express.json` يرمي قبل المسارات. عدّاه احتياطاً.
 *
 * المجموع ثمانية، والحدّ عشرون. أما ما يحتاج جلسة (إنشاء ملف، تعارض،
 * حذف، خروج) فنحضّر الجلسة باستدعاء `login` مباشرة بعد `seedUser`، فلا
 * يستهلك من ميزانية HTTP؛ والمسار نفسه للـ`login` يغطيه اختبار المسار
 * السليم. ودالة `after` في آخر الملف تفشل إن تجاوزنا الحدّ، فيظهر السبب
 * مدلولاً بدل 429 غامض يفوح منه أنه ضربة حظ لا خلل.
 */

import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, describe, test, type TestContext } from "node:test";
import { login } from "../src/auth.js";
import type { Config } from "../src/config.js";
import { emailHash, hashPin } from "../src/crypto.js";
import { closeDb, type Ctx } from "../src/db.js";
import { createApp } from "../src/index.js";
import { FakeDb } from "./fake-db.js";

const config: Config = {
  env: "test",
  port: 0,
  databaseUrl: "postgres://test",
  emailPepper: "p".repeat(40),
  sessionPepper: "s".repeat(40),
  emailKey: Buffer.alloc(32, 7).toString("base64"),
  mailFrom: null,
  publicUrl: "http://localhost",
  sessionTtlDays: 30,
  accessTtlSeconds: 900,
  codeTtlMinutes: 10,
  maxFailedLogins: 5,
  lockoutMinutes: 15,
  argon2: { memoryKiB: 4096, iterations: 1, parallelism: 1 },
};

const EMAIL = "user@example.com";
const PIN = "123456";

/** المسارات التي عليها بوابة حدّ المعدّل. انظر العليق في رأس الملف. */
const GATED = new Set([
  "/v1/auth/signup/start",
  "/v1/auth/signup/confirm",
  "/v1/auth/login",
  "/v1/auth/refresh",
]);

/** عدّاد ميزانية حدّ المعدّل. `after` في آخر الملف يفحصه. */
let gatedCounted = 0;

/** تجزئة واحدة للـPIN. `scrypt` غالٍ، فلا نعيده لكل اختبار. */
const pinHash = hashPin(config, PIN);

/** ملف صالح وفق `types.ts`: الحقول الإلزامية فقط. */
const content = { rules: [] };

/* ------------------------------------------------------------- أدوات HTTP */

interface Reply {
  readonly status: number;
  /** الجسم خاماً كما وصل، والفارغ سلسلة وحيدة. */
  readonly text: string;
  /** `JSON.parse` إن كان الرد JSON، وإلا `null`. */
  readonly body: unknown;
}

async function call(base: string, path: string, init: RequestInit = {}): Promise<Reply> {
  if (GATED.has(path) && (init.method ?? "GET") === "POST") gatedCounted += 1;
  const res = await fetch(`${base}${path}`, init);
  const text = await res.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  return { status: res.status, text, body };
}

/** جسم JSON مع ترويسة `Authorization` اختيارية. */
function withBody(method: "POST" | "PUT" | "DELETE", payload: unknown, access?: string): RequestInit {
  return {
    method,
    headers: {
      "content-type": "application/json",
      ...(access === undefined ? {} : { authorization: `Bearer ${access}` }),
    },
    body: JSON.stringify(payload),
  };
}

const post = (payload: unknown, access?: string): RequestInit => withBody("POST", payload, access);
const bearer = (access: string): RequestInit => ({ headers: { authorization: `Bearer ${access}` } });

function as<T>(reply: Reply): T {
  return reply.body as T;
}

/** يبدأ التطبيق على منفذ عشوائي ويعيد بادئة العنوان ودالة إغلاق. */
async function listen(appConfig: Config, db: FakeDb): Promise<{ base: string; close: () => Promise<void> }> {
  const ctx: Ctx = { db, config: appConfig };
  // `createApp` يحوي الدلو ومؤقّت التنظيف على مستوى وحدته، فكل تطبيق
  // جديد في هذا الملف يشارك الدلو نفسه. لذلك ميزانية حدّ المعدّل واحدة
  // للملف كله لا لكل اختبار.
  const app = createApp(ctx, appConfig);
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("لم يُعطَ عنوان الاستماع");
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        // `fetch` يبقي اتصالاً مفتوحاً للاحتفاظ به. بلا إغلاق الاتصالات
        // الخاملة ينتظر `close` انتهاء المهلة، فلا تنتهي عملية الاختبار.
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeIdleConnections();
      }),
  };
}

interface Harness {
  readonly ctx: Ctx;
  readonly db: FakeDb;
  readonly base: string;
  close: () => Promise<void>;
}

async function setup(t: TestContext, appConfig: Config = config): Promise<Harness> {
  const db = new FakeDb();
  const { base, close } = await listen(appConfig, db);
  // الإغلاق في `t.after` لا في جسم الاختبار: ينفَّذ حتى لو فشل التأكيد.
  t.after(close);
  return { ctx: { db, config: appConfig }, db, base, close };
}

interface SignedIn extends Harness {
  readonly access: string;
  readonly refresh: string;
  readonly userId: string;
}

/**
 * جلسة صالحة جاهزة، بلا مرور بمسار `login` على HTTP.
 *
 * `seedUser` ثم `login` مباشرة: الجلسة حالة تهيئة لا موضوع اختبار في
 * أغلب هذه الملفات. مسار `login` نفسه يغطيه «المسار السليم» أعلاه.
 */
async function signedIn(t: TestContext): Promise<SignedIn> {
  const harness = await setup(t);
  harness.db.seedUser(await pinHash, "pro", emailHash(config, EMAIL));
  const session = await login(harness.ctx, EMAIL, PIN, "device-a", "جهاز الاختبار", null);
  assert.ok(session.ok, "تحضير الجلسة");
  return {
    ...harness,
    access: session.value.accessToken,
    refresh: session.value.refreshToken,
    userId: session.value.userId,
  };
}

/* -------------------------------------------------- أشكال الردّ على السلك */

interface StartBody {
  readonly sent: boolean;
  readonly code?: string;
}
interface ConfirmBody {
  readonly pin: string;
}
interface LoginBody {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly expires_in: number;
  readonly user_id: string;
  readonly plan: string;
}
interface ProfileBody {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly revision: number;
  readonly updated_at: string;
  readonly content?: unknown;
}
interface CodeBody {
  readonly code: string;
}

/* ------------------------------------------------------------------ الفحص */

describe("فحص الصحة", () => {
  test("`/healthz` يردّ 503 و`ok:false` حين لا قاعدة بيانات", async (t) => {
    // `ping()` في `db.ts` يتصل بقاعدة حقيقية عبر `config()` من البيئة، ولا
    // يمرّ بالـ`Ctx` الذي نمرّره إلى `createApp`. فمع `DATABASE_URL` غائبة
    // يرمي `ConfigError` و`ping` يبتلعه في `try/catch` ويعيد `false`. ومع
    // `DATABASE_URL` حاضرة يردّ المسار 200 بصدق، فالقيمة الثابتة لا تنطبق
    // على تلك البيئة: نتخطى بدل أن نثبّت رقماً يكذب عليها.
    const url = process.env["DATABASE_URL"];
    if (url !== undefined && url.trim() !== "") {
      t.skip("DATABASE_URL في البيئة: /healthz يفحص قاعدة حقيقية لا FakeDb");
    }
    // `ping()` قد ينشئ بركة اتصال قبل الفشل، فنغلقها حتى تنتهي العملية.
    t.after(() => closeDb());

    const harness = await setup(t);
    const res = await call(harness.base, "/healthz");
    assert.equal(res.status, 503);
    assert.deepEqual(res.body, { ok: false });
    assert.equal("ok" in (res.body as object), true, "الجسم يحمل `ok`");
  });
});

/* ------------------------------------------------------------ حارس التوكن */

describe("حارس التوكن", () => {
  test("مسار محمي بلا ترويسة `Authorization` يعيد 401 `session_invalid`", async (t) => {
    const harness = await setup(t);
    const res = await call(harness.base, "/v1/sync/profiles");
    assert.equal(res.status, 401);
    assert.deepEqual(res.body, { code: "session_invalid" });
  });

  test("توكن مزيّف يعيد الرد نفسه تماماً: الغائب والمزيّف غير قابلين للتمييز", async (t) => {
    const harness = await setup(t);
    const missing = await call(harness.base, "/v1/sync/profiles");

    // ثلاثة أشكال من الخداع: نص بلا صيغة توكن، وصيغة صحيحة بتوقيع بسرّ
    // آخر، وحمولة موقَّعة بمفتاح غريب. لا يميّز بينها الردّ.
    for (const token of ["garbage", "tok.zzz", "eyJzaWQiOiJzMSJ9.b3RoZXItc2lnbmF0dXJl"]) {
      const forged = await call(harness.base, "/v1/sync/profiles", bearer(token));
      assert.equal(forged.status, 401, `توكن ${token}`);
      // تطابق حرفي: أي فرق — حالة، رمز، أو حقل زائد — يخبر المهاجم أن
      // التوكن أُخضع لشيء، فيحوّل تجربة إلى محادثة.
      assert.equal(forged.status, missing.status, `حالة مختلفة للتوكن ${token}`);
      assert.deepEqual(forged.body, missing.body, `جسم مختلف للتوكن ${token}`);
    }
  });

  test("ترويسة غير `Bearer` تُعامل كغيابها", async (t) => {
    const harness = await setup(t);
    const res = await call(harness.base, "/v1/sync/profiles", {
      headers: { authorization: "Basic dXNlcjpwYXNz" },
    });
    assert.equal(res.status, 401);
    assert.deepEqual(res.body, { code: "session_invalid" });
  });
});

/* ------------------------------------------------------ المسار السليم */

describe("المسار السليم على السلك", () => {
  test("تسجيل ثم دخول ثم مزامنة: الأسماء snake_case والحقول كاملة", async (t) => {
    const harness = await setup(t);

    const started = await call(harness.base, "/v1/auth/signup/start", post({ email: EMAIL }));
    assert.equal(started.status, 202);
    assert.equal(as<StartBody>(started).sent, true);
    // `env: "test"` لا "production"، فالرمز يعود ونستطيع إكمال التدفق.
    const code = as<StartBody>(started).code;
    assert.equal(typeof code, "string", "رمز التحقق مفقود فلا تكتمل التدفق");

    const confirmed = await call(
      harness.base,
      "/v1/auth/signup/confirm",
      post({ email: EMAIL, code }),
    );
    assert.equal(confirmed.status, 201);
    assert.match(as<ConfirmBody>(confirmed).pin, /^\d{6}$/);

    const logged = await call(
      harness.base,
      "/v1/auth/login",
      post({ email: EMAIL, pin: as<ConfirmBody>(confirmed).pin, device_id: "device-a", device_label: "جهاز" }),
    );
    assert.equal(logged.status, 200);
    // عقد السلك: لا حقل زائد ولا ناقص. `camelCase` ممنوع، والتسمية لا
    // تُختصر، فـ`access_token` لا `accessToken` ولا `token`.
    assert.deepEqual(Object.keys(as<LoginBody>(logged)).sort(), [
      "access_token",
      "expires_in",
      "plan",
      "refresh_token",
      "user_id",
    ]);
    const tokens = as<LoginBody>(logged);
    assert.equal(tokens.expires_in, config.accessTtlSeconds);
    assert.equal(tokens.plan, "free", "الخطة على السلك: العميل يعرض حدودها ولا يخمّنها");
    assert.equal(tokens.user_id.length > 0, true);

    const profiles = await call(harness.base, "/v1/sync/profiles", bearer(tokens.access_token));
    assert.equal(profiles.status, 200);
    assert.deepEqual(profiles.body, { profiles: [] });
  });

  test("في الإنتاج لا يعود رمز التحقق: الرد `{ sent: true }` وحده", async (t) => {
    // هنا الفارق أمني لا تجميلي: الرمز يُسلَّم بالبريد وحده، فرده على السلك
    // يجعل أي قارئ للسجل أو الوسيط يملك حساباً جديداً كاملاً.
    const harness = await setup(t, { ...config, env: "production" });
    const res = await call(harness.base, "/v1/auth/signup/start", post({ email: "prod@example.com" }));

    assert.equal(res.status, 202);
    assert.deepEqual(res.body, { sent: true });
    assert.deepEqual(Object.keys(as<StartBody>(res)), ["sent"], "حقل زائد على السلك");
    // الرمز أُنشئ وسُلّم بالبريد: الغياب من الرد ليس غياباً منه.
    assert.equal(harness.db.codes.size, 1, "الرمز لم يُنشأ، فالرفض سببه لا شيء");
  });
});

/* ------------------------------------------------------ عقد مسارات المزامنة */

describe("عقد مسارات المزامنة", () => {
  test("إنشاء ملف: 201 وحقول `updated_at` لا `updatedAt`", async (t) => {
    const s = await signedIn(t);
    const res = await call(
      s.base,
      "/v1/sync/profiles",
      post({ slug: "main", name: "الملف", content, device_id: "device-a" }, s.access),
    );

    assert.equal(res.status, 201);
    assert.deepEqual(Object.keys(as<ProfileBody>(res)).sort(), [
      "id",
      "name",
      "revision",
      "slug",
      "updated_at",
    ]);
    const created = as<ProfileBody>(res);
    assert.equal(created.slug, "main");
    assert.equal(created.revision, 1);
    assert.equal(Number.isNaN(Date.parse(created.updated_at)), false, "`updated_at` ليس تاريخاً");
    assert.equal("updatedAt" in (res.body as object), false, "camelCase على السلك");
    assert.equal("content" in (res.body as object), false, "القائمة بلا محتوى: الطلب التالي يسحبه");
  });

  test("slug مكرر: 409 `slug_taken` بلا ملف ثانٍ", async (t) => {
    const s = await signedIn(t);
    const first = await call(s.base, "/v1/sync/profiles", post({ slug: "main", name: "أول", content }, s.access));
    assert.equal(first.status, 201);

    const second = await call(s.base, "/v1/sync/profiles", post({ slug: "main", name: "ثان", content }, s.access));
    assert.equal(second.status, 409);
    assert.deepEqual(second.body, { code: "slug_taken" });
    assert.equal(s.db.profilesOf(s.userId).length, 1, "ملف واحد فقط");
  });

  test("slug غير صالح: 400 `invalid_slug` قبل أي كتابة", async (t) => {
    const s = await signedIn(t);
    const res = await call(
      s.base,
      "/v1/sync/profiles",
      post({ slug: "Bad Slug!", name: "الملف", content }, s.access),
    );

    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { code: "invalid_slug" });
    assert.equal(s.db.profiles.size, 0, "الرفض ترك أثراً");
  });

  test("كتابة بمراجعة قديمة: 409 `revision_conflict` ولا تمحو تعديلاً", async (t) => {
    const s = await signedIn(t);
    const created = as<ProfileBody>(
      await call(s.base, "/v1/sync/profiles", post({ slug: "main", name: "الملف", content }, s.access)),
    );
    assert.equal(created.revision, 1);

    // الجهاز B عدّل فليس الجهاز A على المراجعة 1 بعد الآن.
    const stale = await call(
      s.base,
      `/v1/sync/profiles/${created.id}`,
      withBody("PUT", { expected_revision: 99, name: "من جهاز آخر", content }, s.access),
    );
    assert.equal(stale.status, 409);
    assert.deepEqual(stale.body, { code: "revision_conflict" });

    // التعارض لا يكتفِ بالرد: الاسم بقي. هذا ما يحمي عمل المستخدم من
    // آخر كتابة تفوز.
    const after = as<ProfileBody & { name: string }>(
      await call(s.base, `/v1/sync/profiles/${created.id}`, bearer(s.access)),
    );
    assert.equal(after.name, "الملف", "الاسم تغيّر رغم التعارض");
    assert.equal(after.revision, 1, "المراجعة تحرّكت رغم التعارض");
  });

  test("حذف: 204 بجسم فارغ تماماً، ثم الملف غير موجود", async (t) => {
    const s = await signedIn(t);
    const created = as<ProfileBody>(
      await call(s.base, "/v1/sync/profiles", post({ slug: "main", name: "الملف", content }, s.access)),
    );

    const res = await call(
      s.base,
      `/v1/sync/profiles/${created.id}`,
      withBody("DELETE", { expected_revision: 1 }, s.access),
    );
    assert.equal(res.status, 204);
    assert.equal(res.text, "", "جسم مع 204 لا يجوز");
    assert.equal(res.body, null, "لا حتى `{}` فارغاً");
    assert.equal(res.text.length, 0);

    const after = await call(s.base, `/v1/sync/profiles/${created.id}`, bearer(s.access));
    assert.equal(after.status, 404);
    assert.deepEqual(after.body, { code: "not_found" });
  });
});

/* --------------------------------------------------------- الجلسات والأخطاء */

describe("إبطال الجلسة", () => {
  test("`logout` يسري فوراً: التوكن نفسه كان يعمل قبله ويُرفض بعده", async (t) => {
    const s = await signedIn(t);
    // الدليل أن الإبطال للحظة: نفس التوكن، حالتان، بلا انتظار انتهاء.
    const before = await call(s.base, "/v1/sync/profiles", bearer(s.access));
    assert.equal(before.status, 200);

    const out = await call(s.base, "/v1/auth/logout", post({ refresh_token: s.refresh }));
    assert.equal(out.status, 204);
    assert.equal(out.text, "");

    const after = await call(s.base, "/v1/sync/profiles", bearer(s.access));
    assert.equal(after.status, 401);
    assert.deepEqual(after.body, { code: "session_invalid" });
  });
});

describe("أخطاء التوجيه والجسم", () => {
  test("مسار مجهول: 404 `not_found` لا 404 من Express", async (t) => {
    const harness = await setup(t);
    const res = await call(harness.base, "/v1/no-such-route");
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { code: "not_found" });
  });

  test("طريقة على مسار موجود: 404 برمز المشروع نفسه", async (t) => {
    // `login` مسجَّل بـ`POST` فقط. الرد على `GET` رمز المشروع لا صفحة
    // Express الافتراضية، فيعرف العميل أن المسار غير موجود لا أنه خطأ.
    const harness = await setup(t);
    const res = await call(harness.base, "/v1/auth/login");
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { code: "not_found" });
  });

  test("جسم JSON تالف: 400 `invalid_body` بلا تسريب تفاصيل المحرّك", async (t) => {
    const harness = await setup(t);
    const res = await call(harness.base, "/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"email": ',
    });

    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { code: "invalid_body" });
    assert.deepEqual(Object.keys(res.body as object), ["code"], "تفاصيل المحرّك في الرد");
  });
});

/* ---------------------------------------------------------------- الأسرار */

describe("عدم تسريب الأسرار على السلك", () => {
  test("لا PIN ولا توكن تجديد في ردّ لا يحمله عمداً", async (t) => {
    const harness = await setup(t);
    const code = as<StartBody>(
      await call(harness.base, "/v1/auth/signup/start", post({ email: EMAIL })),
    ).code;
    const pin = as<ConfirmBody>(
      await call(harness.base, "/v1/auth/signup/confirm", post({ email: EMAIL, code })),
    ).pin;
    const tokens = as<LoginBody>(
      await call(
        harness.base,
        "/v1/auth/login",
        post({ email: EMAIL, pin, device_id: "device-a", device_label: "جهاز" }),
      ),
    );

    const created = as<ProfileBody>(
      await call(harness.base, "/v1/sync/profiles", post({ slug: "main", name: "الملف", content }, tokens.access_token)),
    );

    // كل ردّ يجب ألا يحمل سرّاً. `confirm` و`login` مستثنيان بالتصميم:
    // الأول يعطي PIN مرة واحدة عند الإنشاء، والثاني يعطي التوكنات، فلا
    // معنى لكون التوكن فيه. نضمّ ردّ `login` رغم ذلك لأن حقل `pin` ليس
    // جزءاً من عقده.
    const clean: Reply[] = [
      await call(harness.base, "/v1/sync/profiles", bearer(tokens.access_token)),
      await call(harness.base, `/v1/sync/profiles/${created.id}`, bearer(tokens.access_token)),
      await call(harness.base, "/v1/sync/profiles/changed", bearer(tokens.access_token)),
      await call(harness.base, "/v1/auth/sessions", bearer(tokens.access_token)),
      await call(harness.base, "/v1/sync/profiles", bearer("forged.token.value")),
      await call(harness.base, "/v1/no-such-route"),
      { status: 200, text: JSON.stringify(tokens), body: tokens },
    ];

    // الخروج يمرّ بـrefresh، والرد بعده 401. نضمّهما أيضاً: الإبطال لا
    // يجوز أن يحوّل الرد إلى منفذ لتسريب التوكن المُبطل.
    const out = await call(harness.base, "/v1/auth/logout", post({ refresh_token: tokens.refresh_token }));
    assert.equal(out.status, 204);
    const afterLogout = await call(harness.base, "/v1/sync/profiles", bearer(tokens.access_token));
    assert.equal(afterLogout.status, 401);
    clean.push(afterLogout);

    // الفحص على الردود فرادى: لو أضفنا ردّاً يحمل التوكن لاحقاً فأردنا
    // كشفه، فالنِّسبية تبيّن أيّها سرّب لا أن «شيئاً» سرّب.
    for (const reply of clean) {
      const where = reply.status;
      if (reply.text === JSON.stringify(tokens)) continue; // ردّ الدخول نفسه
      assert.equal(reply.text.includes(tokens.refresh_token), false, `توكن تجديد في ردّ ${where}`);
      assert.equal(reply.text.includes(pin), false, `PIN في ردّ ${where}`);
      assert.equal(reply.text.includes("pin_hash"), false, `عمود التجزئة في ردّ ${where}`);
    }
    // توكن الوصول لا يجوز أن يخرج في ردّ غير مولِّده: أي ردّ غير ردّ
    // الدخول لا يحمله.
    for (const reply of clean) {
      if (reply.text === JSON.stringify(tokens)) continue;
      assert.equal(reply.text.includes(tokens.access_token), false, `توكن وصول مكرَّر في ردّ ${reply.status}`);
    }
  });
});

/* --------------------------------------------------- ميزانية حدّ المعدّل */

after(() => {
  assert.ok(
    gatedCounted <= 20,
    `تجاوزنا ميزانية حدّ المعدّل: ${gatedCounted} طلباً على مسارات مصادقة، والحدّ 20 لكل IP. ` +
      "اجعل تحضير الجلسة باستدعاء `login` مباشرة بدل مسار HTTP.",
  );
});
