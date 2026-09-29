/**
 * اختبارات المزامنة.
 *
 * تركيزها على ما لا يجوز أن يخطئ:
 *
 * - تعارض المراجعة لا يُكتب فوق تعديل جهاز آخر.
 * - الحذف يطلب المراجعة، فحذف متأخر يفشل ولا يمحو تعديلاً.
 * - الحدود (ملفات/قواعد/حجم) تُفحص قبل أي كتابة.
 * - ملف مستخدم لا يُكشف لغيره.
 * - كل كتابة تترك نسخة في `profile_revisions`.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Config } from "../src/config.js";
import type { Ctx } from "../src/db.js";
import {
  changedSince,
  createProfile,
  deleteProfile,
  listProfiles,
  pullProfile,
  validateContent,
  writeProfile,
} from "../src/sync.js";
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

function setup(plan: "free" | "pro" = "pro"): { ctx: Ctx; db: FakeDb; userId: string } {
  const db = new FakeDb();
  const userId = db.seedUser("hash", plan);
  return { ctx: { db, config }, db, userId };
}

/** قاعدة صالحة وفق `types.ts`: الحقول الإلزامية فقط. */
function rule(id: string): Record<string, unknown> {
  return {
    id,
    name: `قاعدة ${id}`,
    enabled: true,
    priority: 1,
    conditions: [],
    actions: [{ type: "tts", text: "شكراً" }],
  };
}

const content = (n: number) => ({ rules: Array.from({ length: n }, (_, i) => rule(`r${i}`)) });

async function seedProfile(ctx: Ctx, userId: string, slug: string, rules = 1) {
  const created = await createProfile(ctx, userId, {
    slug,
    name: "ملف",
    content: content(rules),
    deviceId: "device-a",
  });
  assert.equal(created.ok, true);
  return created.ok ? created.value : null;
}

describe("مزامنة الملفات", () => {
  test("إنشاء ملف يبدأ من مراجعة 1 ويسجّل نسخة", async () => {
    const { ctx, db, userId } = setup();
    const created = await seedProfile(ctx, userId, "main");

    assert.equal(created?.revision, 1);
    assert.equal(db.revisions.length, 1, "النسخة الأولى مسجَّلة");
    assert.equal(db.revisions[0]?.["device_id"], "device-a");
  });

  test("slug مكرر يُرفض بلا ملف ثانٍ", async () => {
    const { ctx, db, userId } = setup();
    await seedProfile(ctx, userId, "main");
    const second = await createProfile(ctx, userId, {
      slug: "main",
      name: "آخر",
      content: content(1),
      deviceId: "device-a",
    });
    assert.equal(second.ok, false);
    assert.equal(second.ok === false && second.code, "slug_taken");
    assert.equal(db.profilesOf(userId).length, 1);
  });

  test("slug غير صالح واسم فارغ يُرفضان قبل أي كتابة", async () => {
    const { ctx, db, userId } = setup();
    const bad = await createProfile(ctx, userId, {
      slug: "Bad Slug!",
      name: "ملف",
      content: content(1),
      deviceId: null,
    });
    assert.equal(bad.ok === false && bad.code, "invalid_slug");

    const nameless = await createProfile(ctx, userId, {
      slug: "ok",
      name: "   ",
      content: content(1),
      deviceId: null,
    });
    assert.equal(nameless.ok === false && nameless.code, "invalid_name");
    assert.equal(db.profiles.size, 0, "لا أثر لرفض");
  });

  test("كتابة على مراجعة مطابقة تزيد المراجعة وتسجّل نسخة", async () => {
    const { ctx, db, userId } = setup();
    const created = await seedProfile(ctx, userId, "main");
    const written = await writeProfile(ctx, userId, {
      profileId: created!.id,
      expectedRevision: 1,
      name: "ملف معدَّل",
      content: content(2),
      deviceId: "device-b",
    });
    assert.equal(written.ok, true);
    assert.equal(written.ok && written.value.revision, 2);
    assert.equal(written.ok && written.value.name, "ملف معدَّل");
    assert.equal(db.revisions.length, 2, "نسخة ثانية محفوظة");
  });

  test("كتابة بمراجعة قديمة تُرفض ولا تمحو تعديل الجهاز الآخر", async () => {
    const { ctx, db, userId } = setup();
    const created = await seedProfile(ctx, userId, "main");
    // الجهاز B يكتب بنجاح فيرفع المراجعة إلى 2.
    await writeProfile(ctx, userId, {
      profileId: created!.id,
      expectedRevision: 1,
      name: "من B",
      content: content(2),
      deviceId: "device-b",
    });
    // الجهاز A ما زال يحمل 1، فيُرفض.
    const stale = await writeProfile(ctx, userId, {
      profileId: created!.id,
      expectedRevision: 1,
      name: "من A",
      content: content(3),
      deviceId: "device-a",
    });
    assert.equal(stale.ok, false);
    assert.equal(stale.ok === false && stale.code, "revision_conflict");

    const current = await pullProfile(ctx, userId, created!.id);
    assert.equal(current.ok && current.value.name, "من B", "تعديل B باقٍ");
    assert.equal(db.revisions.length, 2, "لا نسخة من الكتابة المرفوضة");
  });

  test("حذف بمراجعة مطابقة ينجح، وبمراجعة قديمة يفشل", async () => {
    const { ctx, db, userId } = setup();
    const created = await seedProfile(ctx, userId, "main");

    const stale = await deleteProfile(ctx, userId, {
      profileId: created!.id,
      expectedRevision: 99,
      deviceId: "device-a",
    });
    assert.equal(stale.ok === false && stale.code, "revision_conflict");
    assert.equal(db.profiles.size, 1, "لم يُحذف شيء");

    const removed = await deleteProfile(ctx, userId, {
      profileId: created!.id,
      expectedRevision: 1,
      deviceId: "device-a",
    });
    assert.equal(removed.ok, true);
    assert.equal(db.profiles.size, 0);
  });

  test("ملف مستخدم آخر غير مرئي", async () => {
    const { ctx, db, userId } = setup();
    const mine = await seedProfile(ctx, userId, "main");
    const other = db.seedUser("hash", "pro");

    const read = await pullProfile(ctx, other, mine!.id);
    assert.equal(read.ok === false && read.code, "not_found");

    const written = await writeProfile(ctx, other, {
      profileId: mine!.id,
      expectedRevision: 1,
      name: "اختراق",
      content: content(1),
      deviceId: null,
    });
    assert.equal(written.ok === false && written.code, "not_found");
  });

  test("حدّ عدد الملفات يُفحص: المجاني 3", async () => {
    const { ctx, db, userId } = setup("free");
    for (const slug of ["a", "b", "c"]) {
      const made = await createProfile(ctx, userId, {
        slug,
        name: slug,
        content: content(1),
        deviceId: null,
      });
      assert.equal(made.ok, true, `الملف ${slug} يُقبل`);
    }
    const fourth = await createProfile(ctx, userId, {
      slug: "d",
      name: "d",
      content: content(1),
      deviceId: null,
    });
    assert.equal(fourth.ok === false && fourth.code, "profile_limit");
    assert.equal(db.profilesOf(userId).length, 3);
  });

  test("حدّ عدد القواعد يُفحص: المجاني 10", async () => {
    const { ctx, db, userId } = setup("free");
    const ok = await createProfile(ctx, userId, {
      slug: "ok",
      name: "ok",
      content: content(10),
      deviceId: null,
    });
    assert.equal(ok.ok, true);

    const tooMany = await createProfile(ctx, userId, {
      slug: "big",
      name: "big",
      content: content(11),
      deviceId: null,
    });
    assert.equal(tooMany.ok === false && tooMany.code, "rule_limit");
    assert.equal(db.profilesOf(userId).length, 1, "الملف المرفوض لم يُنشأ");
  });

  test("القائمة والسحب لا يقرآن من مستخدم آخر", async () => {
    const { ctx, db, userId } = setup();
    await seedProfile(ctx, userId, "main");
    const other = db.seedUser("hash", "pro");
    assert.equal((await listProfiles(ctx, other)).length, 0);
    assert.equal((await listProfiles(ctx, userId)).length, 1);
  });

  test("changedSince بلا حدّ يعيد كل الملفات", async () => {
    const { ctx, userId } = setup();
    await seedProfile(ctx, userId, "a");
    await seedProfile(ctx, userId, "b");
    assert.equal((await changedSince(ctx, userId)).length, 2);
    // حدّ مستقبلي: لا تغيّر بعده شيء.
    const future = new Date(Date.now() + 60_000).toISOString();
    assert.equal((await changedSince(ctx, userId, future)).length, 0);
  });

  test("المحاكي يتراجع عن معاملة أُجهضت، كـPostgreSQL", async () => {
    // هذا اختبار للمحاكي نفسه. لو فقد rollback لأخفى خللاً في `sync.ts`:
    // تعديل الاسم قبل `bump` يبقى ظاهراً بعد تعارض المراجعة، فنقرأه خطأً
    // في `sync.ts` وهو سليم على قاعدة حقيقية.
    const { ctx, db, userId } = setup();
    await assert.rejects(
      ctx.db.transaction(async (tx) => {
        await tx.run("INSERT INTO profiles (user_id, slug, name, content, revision) VALUES ($1, $2, $3, $4::jsonb, 1)", [
          userId,
          "ghost",
          "شبح",
          JSON.stringify(content(1)),
        ]);
        throw new Error("abort");
      }),
      /abort/,
    );
    assert.equal(db.profilesOf(userId).length, 0, "الكتابة المرفوضة لا تبقى");
  });

  test("لا سرّ في سجل التدقيق بعد المزامنة", async () => {
    const { ctx, db, userId } = setup();
    const created = await seedProfile(ctx, userId, "main");
    await writeProfile(ctx, userId, {
      profileId: created!.id,
      expectedRevision: 1,
      name: "x",
      content: content(1),
      deviceId: "device-b",
    });
    await deleteProfile(ctx, userId, {
      profileId: created!.id,
      expectedRevision: 2,
      deviceId: "device-b",
    });
    const dump = JSON.stringify(db.auditLog);
    for (const secret of ["pin", "token", "pin_hash", "password"]) {
      assert.equal(dump.toLowerCase().includes(secret), false, `تسريب ${secret}`);
    }
  });
});

describe("فحص بنية المحتوى", () => {
  test("يرفض ما ليس كائناً", () => {
    assert.equal(validateContent(null).ok, false);
    assert.equal(validateContent([]).ok, false);
    assert.equal(validateContent("نص").ok, false);
  });

  test("يرفض حقلاً ناقصاً في القاعدة", () => {
    const broken = { rules: [{ id: "r1", name: "x" }] };
    assert.equal(validateContent(broken).ok, false);
  });

  test("يرفض نوعاً خاطئاً لحقل مطلوب", () => {
    const broken = { rules: [{ ...rule("r1"), priority: "أول" }] };
    assert.equal(validateContent(broken).ok, false);
  });

  test("يقبل محتوىاً بحقول لا يعرفها الخادم", () => {
    // عميل أحدث يجب أن يعمل: الحقول الزائدة تُترك، والمحرّك يتجاهلها.
    const future = { rules: [rule("r1")], future_field: { a: 1 } };
    assert.equal(validateContent(future).ok, true);
  });

  test("يقبل محتوى فارغاً، فينشئ ملفاً بلا قواعد", () => {
    assert.equal(validateContent({}).ok, true);
    assert.equal(validateContent({ rules: [] }).ok, true);
  });

  test("يرفض settings ليست كائناً", () => {
    assert.equal(validateContent({ settings: 5 }).ok, false);
  });
});
