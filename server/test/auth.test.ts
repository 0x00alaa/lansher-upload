/**
 * اختبارات المصادقة.
 *
 * تركيزها على الخصائص الأمنية، لا على تغطية الأسطر:
 *
 * - قفل الحساب بعد N محاولات، وصفر العدّاد بعد دخول ناجح.
 * - كشف إعادة استخدام توكن مُبطَل، وإبطال كل جلسات المستخدم.
 * - حد الجلسات: Free جلسة واحدة.
 * - عدم كشف وجود الحساب: «غير مسجّل» و«PIN خاطئ» يعطيان الرمز نفسه.
 * - لا PIN ولا توكن صريح في `audit_log`.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { confirmSignup, login, refresh, revoke, startSignup, authenticate } from "../src/auth.js";
import { emailHash, hashPin, sessionTokenHash, signAccessToken, verifyAccessToken } from "../src/crypto.js";
import type { Ctx } from "../src/db.js";
import type { Config } from "../src/config.js";
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

function setup(): { ctx: Ctx; db: FakeDb } {
  const db = new FakeDb();
  return { ctx: { db, config }, db };
}

const EMAIL = "user@example.com";
const PIN = "123456";

describe("توكن الوصول والمصادقة", () => {
  test("توكن موقّع يتحقق منه، والتعديل على أي جزء يُبطله", () => {
    const exp = Math.floor(Date.now() / 1000) + 900;
    const token = signAccessToken(config, { sid: "s1", uid: "u1", exp });
    const claims = verifyAccessToken(config, token);
    assert.equal(claims?.uid, "u1");
    assert.equal(claims?.sid, "s1");

    // تعديل الحمولة: التوقيع لم يعد يطابق.
    const [payload, mac] = token.split(".");
    const forged = Buffer.from('{"sid":"s1","uid":"u2","exp":9999999999}').toString("base64url");
    assert.equal(verifyAccessToken(config, `${forged}.${mac}`), null);
    assert.equal(verifyAccessToken(config, payload!), null, "نصف التوكن");
  });

  test("توكن منتهٍ أو موقّع بسري آخر يُرفض", () => {
    const past = signAccessToken(config, {
      sid: "s1",
      uid: "u1",
      exp: Math.floor(Date.now() / 1000) - 1,
    });
    assert.equal(verifyAccessToken(config, past), null);

    const other: Config = { ...config, sessionPepper: "z".repeat(40) };
    const live = signAccessToken(config, { sid: "s1", uid: "u1", exp: 9999999999 });
    assert.equal(verifyAccessToken(other, live), null, "سري مختلف");
    assert.equal(verifyAccessToken(config, "garbage"), null);
  });

  test("تسجيل كامل يعطي توكناً يقبله authenticate", async () => {
    const { ctx } = setup();
    const started = await startSignup(ctx, EMAIL);
    assert.ok(started.ok);
    const confirmed = await confirmSignup(ctx, EMAIL, started.value.code);
    assert.ok(confirmed.ok);

    const session = await login(ctx, EMAIL, confirmed.value.pin, "device-a", "جهاز", null);
    assert.ok(session.ok);

    const who = await authenticate(ctx, session.value.accessToken);
    assert.ok(who.ok);
    assert.equal(who.value.sessionId.startsWith("s"), true, "sid من قاعدة البيانات");
  });

  test("logout يُبطل التوكن فوراً رغم صحة توقيعه", async () => {
    const { ctx } = setup();
    const started = await startSignup(ctx, EMAIL);
    assert.ok(started.ok);
    const confirmed = await confirmSignup(ctx, EMAIL, started.value.code);
    assert.ok(confirmed.ok);
    const session = await login(ctx, EMAIL, confirmed.value.pin, "device-a", "جهاز", null);
    assert.ok(session.ok);

    assert.equal((await authenticate(ctx, session.value.accessToken)).ok, true);
    await revoke(ctx, session.value.refreshToken);
    // التوقيع ما زال صحيحاً، فالرفض يأتي من قراءة الجلسة لا منه.
    assert.equal(verifyAccessToken(config, session.value.accessToken) !== null, true);
    assert.equal((await authenticate(ctx, session.value.accessToken)).ok, false);
  });
});

describe("قفل الحساب", () => {
  test("يفشل قبل الحدّ، ويقفل عنده", async () => {
    const { ctx, db } = setup();
    db.seedUser(await hashPin(config, PIN), "free", emailHash(config, EMAIL));

    for (let i = 1; i < config.maxFailedLogins; i++) {
      const r = await login(ctx, EMAIL, "999999", "d1", "جهاز", null);
      assert.ok(!r.ok);
      assert.equal(r.code, "invalid_credentials", `المحاولة ${i}`);
    }

    const last = await login(ctx, EMAIL, "999999", "d1", "جهاز", null);
    assert.ok(!last.ok);
    assert.equal(last.code, "account_locked");
    assert.equal(db.users.get("u1")?.status, "locked");
  });

  test("الـPIN الصحيح بعد القفل لا يُدخِل", async () => {
    const { ctx, db } = setup();
    db.seedUser(await hashPin(config, PIN), "free", emailHash(config, EMAIL));
    for (let i = 0; i < config.maxFailedLogins; i++) {
      await login(ctx, EMAIL, "000000", "d1", "جهاز", null);
    }
    const r = await login(ctx, EMAIL, PIN, "d1", "جهاز", null);
    assert.ok(!r.ok);
    assert.equal(r.code, "rate_limited");
  });

  test("العدّاد يصفر بعد دخول ناجح", async () => {
    const { ctx, db } = setup();
    db.seedUser(await hashPin(config, PIN), "pro", emailHash(config, EMAIL));
    await login(ctx, EMAIL, "111111", "d1", "جهاز", null);
    await login(ctx, EMAIL, "111111", "d1", "جهاز", null);
    assert.equal(db.users.get("u1")?.failed_logins, 2);

    const ok = await login(ctx, EMAIL, PIN, "d1", "جهاز", null);
    assert.ok(ok.ok);
    assert.equal(db.users.get("u1")?.failed_logins, 0);
  });
});

describe("تسريب معلومات", () => {
  test("بريد غير مسجّل يعطي نفس رمز خطأ كـPIN خاطئ", async () => {
    const { ctx, db } = setup();
    db.seedUser(await hashPin(config, PIN), "free", emailHash(config, EMAIL));

    const wrongPin = await login(ctx, EMAIL, "999999", "d1", "جهاز", null);
    const noUser = await login(ctx, "ghost@example.com", PIN, "d1", "جهاز", null);

    assert.ok(!wrongPin.ok);
    assert.ok(!noUser.ok);
    assert.equal(wrongPin.code, noUser.code, "رمز مختلف يسرق وجود الحساب");
  });

  test("صيغة PIN خاطئة تعطي نفس الرمز", async () => {
    const { ctx, db } = setup();
    db.seedUser(await hashPin(config, PIN), "free", emailHash(config, EMAIL));
    const badFormat = await login(ctx, EMAIL, "12", "d1", "جهاز", null);
    assert.ok(!badFormat.ok);
    assert.equal(badFormat.code, "invalid_credentials");
  });
});

describe("حد الجلسات", () => {
  test("Free: جلسة واحدة. الثانية مرفوضة", async () => {
    const { ctx, db } = setup();
    db.seedUser(await hashPin(config, PIN), "free", emailHash(config, EMAIL));

    const first = await login(ctx, EMAIL, PIN, "d1", "جهاز", null);
    assert.ok(first.ok);

    const second = await login(ctx, EMAIL, PIN, "d2", "جهاز2", null);
    assert.ok(!second.ok);
    assert.equal(second.code, "session_limit");
  });

  test("Pro: حتى 5 جلسات", async () => {
    const { ctx, db } = setup();
    db.seedUser(await hashPin(config, PIN), "pro", emailHash(config, EMAIL));
    for (let i = 0; i < 5; i++) {
      const r = await login(ctx, EMAIL, PIN, `d${i}`, "جهاز", null);
      assert.ok(r.ok, `الجلسة ${i + 1} يجب أن تنجح`);
    }
    const sixth = await login(ctx, EMAIL, PIN, "d6", "جهاز", null);
    assert.ok(!sixth.ok);
    assert.equal(sixth.code, "session_limit");
  });
});

describe("تدوير الجلسة", () => {
  test("التجديد يسلّم توكناً جديداً ويُبطل القديم", async () => {
    const { ctx, db } = setup();
    db.seedUser(await hashPin(config, PIN), "pro", emailHash(config, EMAIL));
    const first = await login(ctx, EMAIL, PIN, "d1", "جهاز", null);
    assert.ok(first.ok);

    const rotated = await refresh(ctx, first.value.refreshToken);
    assert.ok(rotated.ok);
    assert.notEqual(rotated.value.refreshToken, first.value.refreshToken);
    assert.equal(db.liveSessions("u1"), 1, "الجلسة القديمة أُبطلت والجديدة مكانها");
  });

  test("إعادة استخدام توكن مُبطَل تُبطل كل الجلسات", async () => {
    const { ctx, db } = setup();
    db.seedUser(await hashPin(config, PIN), "pro", emailHash(config, EMAIL));
    const first = await login(ctx, EMAIL, PIN, "d1", "جهاز", null);
    assert.ok(first.ok);
    await refresh(ctx, first.value.refreshToken);

    // إعادة استخدام التوكن القديم: مؤشّر على تسريب.
    const reuse = await refresh(ctx, first.value.refreshToken);
    assert.ok(!reuse.ok);
    assert.equal(reuse.code, "session_invalid");
    assert.equal(db.liveSessions("u1"), 0, "كل الجلسات أُبطلت");
    assert.ok(
      db.auditLog.some((a) => a.action === "session_reuse_detected"),
      "الحادثة لازم تُسجَّل",
    );
  });

  test("تسجيل الخروج يُبطل الجلسة", async () => {
    const { ctx, db } = setup();
    db.seedUser(await hashPin(config, PIN), "pro", emailHash(config, EMAIL));
    const r = await login(ctx, EMAIL, PIN, "d1", "جهاز", null);
    assert.ok(r.ok);

    await revoke(ctx, r.value.refreshToken);
    assert.equal(db.liveSessions("u1"), 0);
  });
});

describe("الصف المقروء لقطة لا مرجع حيّ", () => {
  test("تعديل لاحق لا يغيّر ما قرأه الاستعلام", async () => {
    // هذا الشرط مازم `login` في حساب حدّ القفل. لو انكسر، قفل الحساب
    // في المحاولة الرابعة بدل الخامسة، فيفشل اختبار القفل أعلاه.
    const { db } = setup();
    db.seedUser("hash", "free", "e1");
    const first = await db.peek<{ failed_logins: number }>(
      "SELECT failed_logins FROM users WHERE email_hash = $1",
      ["e1"],
    );
    assert.equal(first?.failed_logins, 0);

    await db.run(
      "UPDATE users SET failed_logins = failed_logins + 1, last_failed_at = now() WHERE id = $1",
      ["u1"],
    );
    assert.equal(first?.failed_logins, 0, "الصف المقروء تغيّر بعد كتابته");
  });
});

describe("عدم تخزين الأسرار", () => {
  test("التوكن يُخزَّن مجزّهاً فقط", async () => {
    const { ctx, db } = setup();
    db.seedUser(await hashPin(config, PIN), "free", emailHash(config, EMAIL));
    const r = await login(ctx, EMAIL, PIN, "d1", "جهاز", null);
    assert.ok(r.ok);

    for (const session of db.sessions.values()) {
      assert.notEqual(session.token_hash, r.value.refreshToken);
      assert.deepEqual(session.token_hash, sessionTokenHash(config, r.value.refreshToken));
    }
  });

  test("`audit_log` لا يحوي PIN ولا توكناً", async () => {
    const { ctx, db } = setup();
    db.seedUser(await hashPin(config, PIN), "pro", emailHash(config, EMAIL));
    const r = await login(ctx, EMAIL, PIN, "d1", "سري-جدا", null);
    assert.ok(r.ok);

    const dump = JSON.stringify(db.auditLog);
    assert.ok(!dump.includes(PIN), "PIN في السجل");
    assert.ok(!dump.includes(r.value.refreshToken), "توكن في السجل");
    assert.ok(!dump.includes(r.value.accessToken), "توكن وصول في السجل");
  });

  test("لا PIN صريح في جدول المستخدمين", async () => {
    const { ctx, db } = setup();
    const started = await startSignup(ctx, EMAIL);
    assert.ok(started.ok);
    const confirmed = await confirmSignup(ctx, EMAIL, started.value.code);
    assert.ok(confirmed.ok);

    for (const user of db.users.values()) {
      assert.ok(!user.pin_hash.includes(confirmed.value.pin), "PIN صريح في قاعدة البيانات");
    }
  });
});

describe("التسجيل", () => {
  test("رمز غير صحيح يُرفض", async () => {
    const { ctx } = setup();
    const r = await confirmSignup(ctx, EMAIL, "00000000");
    assert.ok(!r.ok);
    assert.equal(r.code, "invalid_code");
  });

  test("التأكيد ينشئ PIN ويفعّل الحساب", async () => {    const { ctx, db } = setup();
    const started = await startSignup(ctx, EMAIL);
    assert.ok(started.ok);

    const confirmed = await confirmSignup(ctx, EMAIL, started.value.code);
    assert.ok(confirmed.ok);
    assert.match(confirmed.value.pin, /^\d{6}$/);
    assert.equal([...db.users.values()][0]?.status, "active");
  });

  test("الرمز يُحذف بعد الاستخدام", async () => {
    const { ctx, db } = setup();
    const started = await startSignup(ctx, EMAIL);
    assert.ok(started.ok);
    await confirmSignup(ctx, EMAIL, started.value.code);
    assert.equal(db.codes.size, 0, "إعادة استخدام الرمز ممكنة");
  });
});
