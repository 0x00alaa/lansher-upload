/**
 * اختبارات الطبقة الحسابية.
 *
 * هذه أول اختبارات في المشروع تعمل **اليوم**، بلا Rust. تغطي vault
 * الأسرار: التجزئة، التشفير، PIN، المقارنة constant-time.
 *
 * التشغيل: `npm test` في `server/`.
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";
import {
  constantTimeEqualHex,
  decryptEmail,
  emailHash,
  encryptEmail,
  generateEmailCode,
  generatePin,
  hashPin,
  isValidPinFormat,
  newSessionToken,
  sessionTokenHash,
  verifyPin,
} from "../src/crypto.js";
import type { Config } from "../src/config.js";

const testConfig: Config = {
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
  argon2: { memoryKiB: 8192, iterations: 2, parallelism: 1 },
};

describe("توليد PIN", () => {
  test("الطول المطلوب ويُرقام فقط", () => {
    for (let i = 0; i < 50; i++) {
      const pin = generatePin();
      assert.equal(pin.length, 6);
      assert.match(pin, /^\d{6}$/);
    }
  });

  test("لا يولّد نفس الرقم مرتين في عيّنة كبيرة", () => {
    // PIN عشوائي 6 أرقام: 1e6 مساحة. 200 عيّنة يجب أن تكون فريدة.
    const seen = new Set(Array.from({ length: 200 }, () => generatePin()));
    assert.equal(seen.size, 200, "تكرار غير متوقع يوحي بعيب في العشوائية");
  });

  test("صيغة مقبولة: 4 إلى 8 أرقام", () => {
    assert.ok(isValidPinFormat("1234"));
    assert.ok(isValidPinFormat("12345678"));
    assert.ok(!isValidPinFormat("123"));
    assert.ok(!isValidPinFormat("123456789"));
    assert.ok(!isValidPinFormat("12a4"));
    assert.ok(!isValidPinFormat(""));
  });
});

describe("تجزئة PIN", () => {
  test("نفس PIN ينتج تجزئة مختلفة كل مرة (ملح جديد)", async () => {
    const a = await hashPin(testConfig, "123456");
    const b = await hashPin(testConfig, "123456");
    assert.notEqual(a, b, "بدون ملح، تسريب جدول يطابق أي PIN");
  });

  test("التحقق ينجح للـPIN الصحيح ويفشل لغيره", async () => {
    const stored = await hashPin(testConfig, "999888");
    assert.ok(await verifyPin(testConfig, "999888", stored));
    assert.ok(!(await verifyPin(testConfig, "999887", stored)));
  });

  test("التجزئة موسومة بالخوارزمية", async () => {
    const stored = await hashPin(testConfig, "1234");
    assert.match(stored, /^scrypt\$\d+\$\d+\$/);
  });

  test("التحقق يقرأ المعاملات من التجزئة لا من الإعدادات", async () => {
    // بعد Deployment قد نرفع الذاكرة. التجزئات القديمة يجب أن تبقى
    // قابلة للتحقق، لذلك المعاملات تُحفظ معها ولا تُقرأ من الإعدادات.
    const weak = { ...testConfig, argon2: { memoryKiB: 4096, iterations: 1, parallelism: 1 } };
    const stored = await hashPin(weak, "424242");
    // نغيّر الإعدادات إلى قيمة مختلفة تماماً بعد التخزين.
    const strong = { ...testConfig, argon2: { memoryKiB: 65_536, iterations: 3, parallelism: 1 } };
    assert.ok(await verifyPin(strong, "424242", stored), "التغيير كسر التحقق عن تجزئات قديمة");
  });

  test("تجزئة تالفة في الجدول تُعامل كـ«لا يطابق» لا كخطأ", async () => {
    assert.ok(!(await verifyPin(testConfig, "1234", "نص-تالف")));
    assert.ok(!(await verifyPin(testConfig, "1234", "scrypt$x$8$c2FsdA==$aGFzaA==")));
  });
});

describe("المقارنة constant-time", () => {
  test("تطابق ولا تطابق", () => {
    assert.ok(constantTimeEqualHex("aabb", "aabb"));
    assert.ok(!constantTimeEqualHex("aabb", "aabc"));
    assert.ok(!constantTimeEqualHex("aabb", "aa"));
  });
});

describe("تشفير البريد", () => {
  test("يعيد نفس النص بالمفتاح نفسه", () => {
    const email = "user@example.com";
    const packed = encryptEmail(testConfig, email);
    assert.equal(decryptEmail(testConfig, packed), email);
  });

  test("IV مختلف لكل تشفير لنفس البريد", () => {
    const a = encryptEmail(testConfig, "a@b.com");
    const b = encryptEmail(testConfig, "a@b.com");
    assert.notDeepEqual(a, b, "IV ثابت يعني نفس النص يُنتج نفس cipher");
  });

  test("البريد غير موجود كنص صريح في الناتج", () => {
    const packed = encryptEmail(testConfig, "secret@example.com");
    assert.ok(!packed.toString("utf8").includes("secret@example.com"));
  });

  test("لا يفك بمفتاح مختلف", () => {
    const other = { ...testConfig, emailKey: Buffer.alloc(32, 9).toString("base64") };
    const packed = encryptEmail(testConfig, "x@y.com");
    assert.throws(() => decryptEmail(other, packed));
  });
});

describe("تجزئة البريد للـDedup", () => {
  test("ثابتة لنفس البريد بعد التطبيع", () => {
    const a = emailHash(testConfig, "User@Example.COM");
    const b = emailHash(testConfig, "  user@example.com  ");
    assert.deepEqual(a, b, "التطبيع لازم: نفس البريد بإملاء مختلف");
  });

  test("مختلفة لبريدين مختلفين", () => {
    assert.notDeepEqual(
      emailHash(testConfig, "a@b.com"),
      emailHash(testConfig, "c@d.com"),
    );
  });
});

describe("توكن الجلسة", () => {
  test("طول كافٍ وفريد", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => newSessionToken()));
    assert.equal(tokens.size, 100);
    assert.ok((tokens.values().next().value as string).length >= 43);
  });

  test("التجزئة ثابتة للتوكن نفسه", () => {
    const token = newSessionToken();
    assert.deepEqual(sessionTokenHash(testConfig, token), sessionTokenHash(testConfig, token));
  });

  test("pepper مختلف يعطي تجزئة مختلفة", () => {
    const token = newSessionToken();
    const a = sessionTokenHash(testConfig, token);
    const b = sessionTokenHash({ ...testConfig, sessionPepper: "x".repeat(40) }, token);
    assert.notDeepEqual(a, b, "تغيير pepper يجب أن يُبطل كل الجلسات");
  });
});

describe("رمز التحقق بالبريد", () => {
  test("8 أرقام", () => {
    for (let i = 0; i < 20; i++) {
      assert.match(generateEmailCode(), /^\d{8}$/);
    }
  });
});
