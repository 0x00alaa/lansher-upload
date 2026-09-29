/**
 * مزامنة الملفات الشخصية: قائمة، سحب، كتابة، حذف.
 *
 * قرارات مطبَّقة هنا:
 *
 * 1. **لا كتابة فوق تعديل جهاز آخر.** كل كتابة تمرّ بـ`bump_profile_revision`
 *    التي تقارن `revision` الذي أرسله العميل بـ`revision` المخزَّن داخل
 *    المعاملة نفسها. الفشل يعني 409 لا حلّ تلقائي، لأن آخر كتابة تفوز
 *    تحذف عمل المستخدم.
 * 2. **لا حذف صامت.** الحذف يطلب `expected_revision`، فحذف جهاز لنسخة
 *    عدّلها جهاز آخر يفشل بدل أن يمحو التعديل.
 * 3. **الحدود قبل الكتابة.** عدد الملفات وعدد القواعد والحجم يُفحص قبل
 *    أي INSERT، فالرفض لا يترك أثراً.
 * 4. **النسخة السابقة محفوظة.** كل كتابة تضيف صفاً في `profile_revisions`
 *    ضمن المعاملة نفسها، فلا توجد نسخة بلا سجل.
 * 5. **أسماء الحقول من العقد لا من الطلب.** `content` يُفحص بنيوياً
 *    مقابل `UI/src/types.ts`. دلالات القاعدة (هل الشرط يطابق)
 *    يجيب عنها المحرك في `lansher-core`، لا هذا الملف.
 */

import type { Ctx, Reader, Row, Tx } from "./db.js";
import { checkProfiles, checkRules, checkStorage, type Plan } from "./limits.js";

/** رموز خطأ ثابتة، تبني منها الواجهة رسائلها بلغتها. */
export type SyncCode =
  | "not_found"
  | "invalid_slug"
  | "slug_taken"
  | "invalid_name"
  | "invalid_content"
  | "profile_limit"
  | "rule_limit"
  | "storage_limit"
  | "revision_conflict";

export type Result<T> = { ok: true; value: T } | { ok: false; code: SyncCode };

function fail<T>(code: SyncCode): Result<T> {
  return { ok: false, code };
}

// ------------------------------------------------------------------ حدود

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const NAME_MAX = 80;
/** حدّ أعلى لحجم JSON الواحد قبل الفحص بالبايت، يمنع طلباً ضخماً. */
const CONTENT_MAX_BYTES = 2 * 1024 * 1024;

/** الحقول الإلزامية في `Rule` بـ`types.ts`. الباقي اختياري أو افتراضي. */
const RULE_REQUIRED: ReadonlyArray<readonly [string, (value: unknown) => boolean]> = [
  ["id", isString],
  ["name", isString],
  ["enabled", isBoolean],
  ["priority", isNumber],
  ["conditions", isArray],
  ["actions", isArray],
];

/** كائن محتوى ملف: قواعد + إعدادات. الحقول الإضافية تُقبل ولا تُرفض. */
export interface ProfileContent {
  rules?: unknown[];
  settings?: unknown;
  [key: string]: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/*
 * فحوص الأنواع دوال لا أسماء `typeof`: `"array"` و`"object"` ليسا اسمي
 * `typeof`، فمقارنة النص تفضح نفس خطأ التسمية وتُسقط محتوى صحيحاً.
 */
function isString(value: unknown): boolean {
  return typeof value === "string";
}

function isBoolean(value: unknown): boolean {
  return typeof value === "boolean";
}

/** `NaN` و`Infinity` ليسا في JSON، فلا يصلان من العميل؛ نتحقق احتياطاً. */
function isNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

function isArray(value: unknown): boolean {
  return Array.isArray(value);
}

/**
 * فحص بنيوي للمحتوى. نتحقق من الأنواع والحقول المطلوبة فقط، ولا نرفض
 * الحقول التي لا نعرفها: عميل أحدث يجب أن يعمل مع خادم أقدم، والمحرّك
 * يتجاهل ما لا يعرفه.
 */
export function validateContent(content: unknown): { ok: true; value: ProfileContent } | { ok: false } {
  if (!isPlainObject(content)) return { ok: false };
  const encoded = Buffer.byteLength(JSON.stringify(content), "utf8");
  if (encoded > CONTENT_MAX_BYTES) return { ok: false };

  const rules = content["rules"];
  if (rules !== undefined) {
    if (!Array.isArray(rules)) return { ok: false };
    for (const rule of rules) {
      if (!isPlainObject(rule)) return { ok: false };
      for (const [field, check] of RULE_REQUIRED) {
        if (!check(rule[field])) return { ok: false };
      }
    }
  }
  const settings = content["settings"];
  if (settings !== undefined && !isPlainObject(settings)) return { ok: false };
  return { ok: true, value: content as ProfileContent };
}

// --------------------------------------------------------------- استعلامات

interface ProfileRow extends Row {
  id: string;
  slug: string;
  name: string;
  revision: number;
  updated_at: Date;
  content: unknown;
}

export interface ProfileSummary {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly revision: number;
  readonly updatedAt: string;
}

export interface ProfileView extends ProfileSummary {
  readonly content: ProfileContent;
}

function summary(row: ProfileRow): ProfileSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    revision: row.revision,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

const COLUMNS = "id, slug, name, revision, updated_at";

/** خطة المستخدم. الحدود تُشتق منها، ولا تُمرَّر من العميل أبداً. */
async function planOf(ctx: Ctx, userId: string): Promise<Plan> {
  const row = await ctx.db.one<{ plan: Plan }>("SELECT plan FROM users WHERE id = $1", [userId]);
  // حساب غير موجود: نعطي `free` تفرض حدوده، ويظهر `not_found` عند أول
  // كتابة. لا نفضّل المتصل بمعرّف.
  return row?.plan ?? "free";
}

/** كل الملفات. بلا محتوى: العميل يحتاج العناوين والمراجعات فقط. */
export async function listProfiles(ctx: Ctx, userId: string): Promise<ProfileSummary[]> {
  const rows = await ctx.db.many<ProfileRow>(
    `SELECT ${COLUMNS} FROM profiles WHERE user_id = $1 ORDER BY updated_at DESC`,
    [userId],
  );
  return rows.map(summary);
}

/** ما تغيّر منذ لحظة. `since` اختياري: بلاه نأخذ كل شيء. */
export async function changedSince(
  ctx: Ctx,
  userId: string,
  since?: string,
): Promise<ProfileSummary[]> {
  if (!since) return listProfiles(ctx, userId);
  const rows = await ctx.db.many<ProfileRow>(
    `SELECT ${COLUMNS} FROM profiles
      WHERE user_id = $1 AND updated_at > $2
      ORDER BY updated_at ASC`,
    [userId, since],
  );
  return rows.map(summary);
}

/** ملف واحد بمحتواه. لا يمرّ الحذف: الملف المحذوف لا وجود له. */
export async function pullProfile(
  ctx: Ctx,
  userId: string,
  profileId: string,
): Promise<Result<ProfileView>> {
  const row = await ctx.db.one<ProfileRow>(
    `SELECT ${COLUMNS}, content FROM profiles WHERE id = $1 AND user_id = $2`,
    [profileId, userId],
  );
  if (!row) return fail<ProfileView>("not_found");
  const content = validateContent(row.content);
  if (!content.ok) return fail<ProfileView>("invalid_content");
  return { ok: true, value: { ...summary(row), content: content.value } };
}

// ------------------------------------------------------------------ كتابة

/**
 * تعارض المراجعة. يرميه `bump_profile_revision` عبر رمز PostgreSQL
 * `40001`، ونترجمه بعد انتهاء المعاملة: استثناء داخل معاملة يُجهضها،
 * فلا يجوز إرجاع نتيجة عادية ثم تنفيذ COMMIT.
 */
class RevisionConflict extends Error {}

function conflict<T>(): Result<T> {
  return { ok: false, code: "revision_conflict" };
}

/** حجم كل ملفات المستخدم بالبايت. `pg_column_size` أدق من `length`. */
async function usedBytes(reader: Reader, userId: string): Promise<number> {
  const row = await reader.one<{ total: string }>(
    "SELECT COALESCE(SUM(pg_column_size(content)), 0)::text AS total FROM profiles WHERE user_id = $1",
    [userId],
  );
  return Number(row?.total ?? "0");
}

export interface CreateInput {
  readonly slug: string;
  readonly name: string;
  readonly content: unknown;
  readonly deviceId: string | null;
}

/** ملف جديد. `revision` يبدأ من 1 ويُسجَّل في `profile_revisions`. */
export async function createProfile(
  ctx: Ctx,
  userId: string,
  input: CreateInput,
): Promise<Result<ProfileSummary>> {
  const slug = input.slug.trim().toLowerCase();
  const name = input.name.trim();
  if (!SLUG_RE.test(slug)) return fail<ProfileSummary>("invalid_slug");
  if (name.length === 0 || name.length > NAME_MAX) return fail<ProfileSummary>("invalid_name");

  const content = validateContent(input.content);
  if (!content.ok) return fail<ProfileSummary>("invalid_content");

  const plan = await planOf(ctx, userId);
  const ruleCount = content.value.rules?.length ?? 0;
  const incoming = Buffer.byteLength(JSON.stringify(content.value), "utf8");

  return ctx.db.transaction(async (tx) => {
    const rules = await checkRules(ctx, plan, ruleCount);
    if (!rules.allowed) return fail<ProfileSummary>("rule_limit");

    const count = await tx.one<{ total: string }>(
      "SELECT COUNT(*)::text AS total FROM profiles WHERE user_id = $1",
      [userId],
    );
    const profiles = await checkProfiles(ctx, plan, Number(count?.total ?? "0"));
    if (!profiles.allowed) return fail<ProfileSummary>("profile_limit");

    const storage = await checkStorage(ctx, plan, await usedBytes(tx, userId), incoming);
    if (!storage.allowed) return fail<ProfileSummary>("storage_limit");

    // `ON CONFLICT DO NOTHING` ثم قراءة: خطآن في طلبين متزامنين يعطيان
    // `slug` واحداً لا ملفين. نميّزه بـ`code = '23505'`.
    const inserted = await tx.one<ProfileRow>(
      `INSERT INTO profiles (user_id, slug, name, content, revision)
            VALUES ($1, $2, $3, $4::jsonb, 1)
         ON CONFLICT (user_id, slug) DO NOTHING
         RETURNING ${COLUMNS}`,
      [userId, slug, name, JSON.stringify(content.value)],
    );
    if (!inserted) return fail<ProfileSummary>("slug_taken");

    await tx.run(
      `INSERT INTO profile_revisions (profile_id, revision, content, device_id, updated_at)
       VALUES ($1, 1, $2::jsonb, $3, now())`,
      [inserted.id, JSON.stringify(content.value), input.deviceId],
    );
    await audit(tx, userId, "profile_written", { slug });
    return { ok: true, value: summary(inserted) };
  });
}

export interface WriteInput {
  readonly profileId: string;
  /** المراجعة التي قرأها العميل. إن اختلفت نبطل العملية. */
  readonly expectedRevision: number;
  readonly name: string;
  readonly content: unknown;
  readonly deviceId: string | null;
}

/**
 * كتابة على ملف قائم. `bump_profile_revision` تقارن وتزيد في معاملة
 * واحدة، فتكافئ طلبين متزامنين بأحدهما فقط.
 */
export async function writeProfile(
  ctx: Ctx,
  userId: string,
  input: WriteInput,
): Promise<Result<ProfileSummary>> {
  const name = input.name.trim();
  if (name.length === 0 || name.length > NAME_MAX) return fail<ProfileSummary>("invalid_name");

  const content = validateContent(input.content);
  if (!content.ok) return fail<ProfileSummary>("invalid_content");

  const payload = JSON.stringify(content.value);
  const incoming = Buffer.byteLength(payload, "utf8");

  try {
    return await ctx.db.transaction(async (tx) => {
      const existing = await tx.one<ProfileRow>(
        "SELECT id, slug, name, revision, updated_at FROM profiles WHERE id = $1 AND user_id = $2",
        [input.profileId, userId],
      );
      if (!existing) return fail<ProfileSummary>("not_found");

      const plan = await planOf(ctx, userId);
      const rules = await checkRules(ctx, plan, content.value.rules?.length ?? 0);
      if (!rules.allowed) return fail<ProfileSummary>("rule_limit");

      // الفرق لا الحجم الكلي: نفس الملف يُكتب مرتين، لا نحتسبه مرتين.
      const before = await tx.one<{ size: string }>(
        "SELECT pg_column_size(content)::text AS size FROM profiles WHERE id = $1",
        [existing.id],
      );
      const storage = await checkStorage(
        ctx,
        plan,
        (await usedBytes(tx, userId)) - Number(before?.size ?? "0"),
        incoming,
      );
      if (!storage.allowed) return fail<ProfileSummary>("storage_limit");

      // الاسم أولاً، فالـbump يُعيد الصف بمراجعة ووقت محدَّثين. لولا
      // الترتيب لردّنا اسماً وقدماً قديمين.
      await tx.run("UPDATE profiles SET name = $1 WHERE id = $2", [name, existing.id]);
      const updated = await tx.one<ProfileRow>(
        "SELECT id, slug, name, revision, updated_at FROM bump_profile_revision($1, $2, $3::jsonb, $4)",
        [existing.id, input.expectedRevision, payload, input.deviceId],
      );
      if (!updated) throw new RevisionConflict("bump returned no row");

      await audit(tx, userId, "profile_written", { slug: updated.slug, revision: updated.revision });
      return { ok: true, value: summary(updated) };
    });
  } catch (error) {
    if (error instanceof RevisionConflict) return conflict<ProfileSummary>();
    // `40001` هو الرمز الذي يرفعه `bump_profile_revision` عند التعارض.
    if (ctx.db.code(error) === "40001") return conflict<ProfileSummary>();
    throw error;
  }
}

export interface DeleteInput {
  readonly profileId: string;
  readonly expectedRevision: number;
  readonly deviceId: string | null;
}

/** حذف. يطلب المراجعة نفسها، فحذف متأخر يفشل ولا يمحو تعديلاً. */
export async function deleteProfile(
  ctx: Ctx,
  userId: string,
  input: DeleteInput,
): Promise<Result<null>> {
  return ctx.db.transaction(async (tx) => {
    const existing = await tx.one<{ slug: string }>(
      "SELECT slug FROM profiles WHERE id = $1 AND user_id = $2",
      [input.profileId, userId],
    );
    if (!existing) return fail<null>("not_found");

    // `revision` في شرط الحذف: يحمي من حذف نسخة عدّلها جهاز آخر.
    const deleted = await tx.run(
      "DELETE FROM profiles WHERE id = $1 AND user_id = $2 AND revision = $3",
      [input.profileId, userId, input.expectedRevision],
    );
    if (deleted === 0) return fail<null>("revision_conflict");

    await audit(tx, userId, "profile_deleted", { slug: existing.slug });
    return { ok: true, value: null };
  });
}

// ------------------------------------------------------------------ تدقيق

/**
 * سجل أمني. `context` بـJSON يُفحص بنيوياً قبل الإدراج: لا نقبل مفتاح
 * سرّي عرضاً، ونكتب فقط ما مرّ من `sync.ts`.
 */
async function audit(
  tx: Tx,
  userId: string,
  action: string,
  context: Record<string, string | number>,
): Promise<void> {
  await tx.run(
    `INSERT INTO audit_log (user_id, action, context) VALUES ($1, $2, $3::jsonb)`,
    [userId, action, JSON.stringify(context)],
  );
}
