/**
 * تطبيق `db/schema.sql` على قاعدة البيانات، بلا تكرار وبلا فقدان.
 *
 * الملف يُشغَّل في أوقات لا نتحكم فيها: إقلاع Cloud Run، وخط CI متكرر،
 * ونسخة مطوّر يشغّله بلا داعٍ. لذلك التكرار ليس حالة استثنائية بل
 * الحالة الطبيعية. أربع آليات تجعل إعادة التشغيل عمليةً لا حدثاً:
 *
 * 1. **معاملة واحدة.** كل العبارات داخل `BEGIN` واحدة، فلا تبقى قاعدة
 *    نصف مطبَّقة إن فشلت عبارة في وسط الملف.
 * 2. **قفل استشاري.** `pg_advisory_xact_lock` يمنع تراكب تشغيلين على
 *    القاعدة نفسها: الثاني ينتظر الأول بدل أن يطبّقان معاً.
 * 3. **سجلّ بصمات.** جدول `schema_migrations` يذكر بصمة `sha256` لآخر
 *    ملف طُبِّق، فتشغيل ثانٍ على الملف نفسه = صفر استعلامات DDL.
 * 4. **تحمّل «الموجود مسبقاً» وحده.** أي خطأ آخر يُفشل التطبيق كاملاً.
 *
 * لا `DROP` ولا حذف بيانات هنا. المخطط `CREATE` فقط، فإعادة تطبيقه على
 * قاعدة قائمة تتخطّى ما وجدته ولا تمسّ صفاً واحداً.
 *
 * **لا نطبع رابط قاعدة البيانات ولا أي سرّ.** سطور التقدّم تذكر نوع
 * العبارة التي نُفِّذت، لا رابطاً يحوي كلمة مرور.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { PoolClient, QueryResultRow } from "pg";
import { config } from "../src/config.js";
import { closeDb, db, pgCode } from "../src/db.js";

/** المخطط نسبةً لهذا الملف، لا نسبةً لمسار العمل. */
const SCHEMA_URL = new URL("../db/schema.sql", import.meta.url);

/** اسم السجل في جدول البصمات. */
const SCHEMA_NAME = "schema.sql";

/** اسم جدول البصمات. */
const LEDGER = "schema_migrations";

/** مفتاح القفل الاستشاري. أي نص ثابت، المهم أن يكون واحداً ومشتركاً. */
const LOCK_KEY = "lansher-schema-migration";

/** أقل إصدار فيه `gen_random_uuid()` في نواة PostgreSQL. */
const UUID_IN_CORE = 13;

/**
 * أخطاء نعدّها مقبولة عند التكرار، ومعنى كل واحد.
 *
 * القائمة ضيّقة عن قصد: خطأ غير مذكور هنا يعني أن شيئاً غير متوقّع
 * حدث، ولا نخفيه. `CREATE OR REPLACE FUNCTION` لا يقع هنا لأنه ينجح
 * بالطبيعة على كل تشغيل.
 */
const TOLERATED: Readonly<Record<string, string>> = {
  "42P07": "جدول أو فهرس موجود مسبقاً",
  "42710": "دالة أو مشغّل موجود مسبقاً",
  "23505": "صف مكرر في جدول قيم ثابتة",
};

interface VersionRow extends QueryResultRow {
  major: number;
}

interface ChecksumRow extends QueryResultRow {
  checksum: string;
}

type Outcome = "applied" | "skipped";

async function main(): Promise<void> {
  const sql = await readSchema();
  const checksum = createHash("sha256").update(sql, "utf8").digest("hex");
  const statements = splitStatements(sql);
  const appConfig = config();

  console.log(
    `المخطط: ${statements.length} عبارة، بصمة ${short(checksum)}، بيئة ${appConfig.env}`,
  );

  const client = await db().connect();
  try {
    const major = await serverMajor(client);
    console.log(`الخادم: PostgreSQL ${major}`);

    // معاملة واحدة: إما المخطط كله أو لا شيء. القفل يُفلت تلقائياً
    // بانتهاء المعاملة، فلا نحتاج `pg_advisory_unlock` في مسار خطأ.
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [LOCK_KEY]);
      await ensureExtension(client, major);
      await ensureLedger(client);

      const previous = await appliedChecksum(client);
      if (previous === checksum) {
        await client.query("COMMIT");
        console.log("المخطط مطابق لآخر تطبيق. لا شيء يُنفَّذ.");
        return;
      }
      if (previous !== undefined) {
        console.warn(
          `تحذير: تغيّر المخطط بعد آخر تطبيق (${short(previous)} ← ${short(checksum)}). ` +
            "نطبّق الجديد ونتخطّى ما هو موجود. راجع الفرق في `db/schema.sql`.",
        );
      }

      let applied = 0;
      let skipped = 0;
      for (const statement of statements) {
        if ((await runOne(client, statement)) === "applied") applied += 1;
        else skipped += 1;
      }

      await client.query(
        `INSERT INTO ${LEDGER} (name, checksum) VALUES ($1, $2)
         ON CONFLICT (name) DO UPDATE
           SET checksum = EXCLUDED.checksum, applied_at = now()`,
        [SCHEMA_NAME, checksum],
      );
      await client.query("COMMIT");
      console.log(`اكتمل: ${applied} عبارة مُنفَّذة، ${skipped} متخطّاة.`);
    } catch (error) {
      // التراجع لا يعطي استعادة كاملة لو كان الخطأ في الاتصال نفسه،
      // فنبتلع خطأ التراجع حتى لا يحجب الخطأ الأصلي.
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  } finally {
    client.release();
    await closeDb();
  }
}

async function readSchema(): Promise<string> {
  try {
    return await readFile(SCHEMA_URL, "utf8");
  } catch {
    // المسار في الرسالة نسبيّ وثابت في المستودع. أما خطأ النظام
    // فيضمّ مساراً مطلقاً، فلا نطبعه.
    throw new Error("تعذّرت قراءة `db/schema.sql`. شغّل السكربت من داخل `server/`.");
  }
}

/** الإصدار الرئيسي: يقرّر إن كان `pgcrypto` مطلوباً فعلاً أم لا. */
async function serverMajor(client: PoolClient): Promise<number> {
  const result = await client.query<VersionRow>(
    "SELECT current_setting('server_version_num')::int / 10000 AS major",
  );
  return result.rows[0]?.major ?? 0;
}

/**
 * امتداد `pgcrypto` لمصدر `gen_random_uuid()`.
 *
 * الدالة في نواة PostgreSQL منذ 13، وقبلها يوفّرها `pgcrypto`. ننشئ
 * الامتداد بـ`IF NOT EXISTS` لأن Cloud SQL قد لا يمنح صلاحية
 * `CREATE EXTENSION`، فإذا رُفض والنسخة 13 فأحدث نكمل: إذ لا نحتاجه.
 * وما دون 13 نُفشل التطبيق صراحةً، بدل أن يسقط أول `CREATE TABLE`
 * برسالة أغرب من هذه.
 */
async function ensureExtension(client: PoolClient, major: number): Promise<void> {
  await client.query("SAVEPOINT extension");
  try {
    await client.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    await client.query("RELEASE SAVEPOINT extension");
    console.log("امتداد pgcrypto: متاح.");
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT extension");
    await client.query("RELEASE SAVEPOINT extension");
    if (major >= UUID_IN_CORE) {
      console.warn(
        "تحذير: تعذّر إنشاء pgcrypto (صلاحية أو قيد). النسخ 13 فما فوق " +
          "تحتوي `gen_random_uuid()` في النواة، فالتطبيق يتابع.",
      );
      return;
    }
    throw new Error(
      `النسخة ${major} تحتاج pgcrypto لـgen_random_uuid()، وتعذّر إنشاء الامتداد. ` +
        "امنح صلاحية CREATE EXTENSION أو رقِّ PostgreSQL إلى 13 فأحدث.",
    );
  }
}

/** جدول البصمات. `IF NOT EXISTS` فيبقى التطبيق قابلاً للتكرار. */
async function ensureLedger(client: PoolClient): Promise<void> {
  await client.query(`CREATE TABLE IF NOT EXISTS ${LEDGER} (
    name        TEXT PRIMARY KEY,
    checksum    TEXT NOT NULL,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
}

/** بصمة آخر ملف طُبِّق، أو `undefined` إن لم يسبق تطبيق. */
async function appliedChecksum(client: PoolClient): Promise<string | undefined> {
  const result = await client.query<ChecksumRow>(
    `SELECT checksum FROM ${LEDGER} WHERE name = $1`,
    [SCHEMA_NAME],
  );
  return result.rows[0]?.checksum;
}

/**
 * عبارة واحدة، مع نقطة حفظ قبلها.
 *
 * نقطة الحفظ ليست تفصيلاً: خطأ واحد في PostgreSQL يُبطل المعاملة
 * كاملة، فلا سبيل لمتابعة باقي العبارات بعد أول «موجود مسبقاً» من
 * دون التراجع إلى نقطة حفظ. وهذا هو الفارق بين ترحيل يُكمل رغم
 * التكرار وترحيل ينهار عنده.
 */
async function runOne(client: PoolClient, statement: string): Promise<Outcome> {
  const label = labelOf(statement);
  await client.query("SAVEPOINT step");
  try {
    await client.query(statement);
    await client.query("RELEASE SAVEPOINT step");
    console.log(`  [تم] ${label}`);
    return "applied";
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT step");
    await client.query("RELEASE SAVEPOINT step");
    const code = pgCode(error);
    const why = code === undefined ? undefined : TOLERATED[code];
    if (why === undefined) throw error;
    console.log(`  [تخطّى] ${label} — ${why}`);
    return "skipped";
  }
}

/**
 * تقسيم نص SQL إلى عبارات.
 *
 * لا يكفي التقسيم على `;` وحدها: جسم الدالة `bump_profile_revision`
 * بين `$$` و`$$` يحوي فواصل منقوطة، وتقسيمها ينتج SQL مكسوراً. لذا
 * نتتبّع قبل الفاصلة ثلاث حالات: الاقتباس المفرد، والمزدوج، والاقتباس
 * المعلَّم بالـ`$`، مع تخطّي التعليقات السطرية والكتلية.
 */
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let index = 0;
  let dollarTag: string | null = null;

  const push = (end: number): void => {
    const text = sql.slice(start, end).trim();
    if (hasSql(text)) statements.push(text);
  };

  while (index < sql.length) {
    const ch = sql[index];
    if (ch === undefined) break;

    if (dollarTag !== null) {
      // داخل جسم دالة: لا يهمّنا إلا ختامة الاقتباس.
      if (sql.startsWith(dollarTag, index)) {
        index += dollarTag.length;
        dollarTag = null;
      } else {
        index += 1;
      }
      continue;
    }

    if (ch === "-" && sql[index + 1] === "-") {
      const newline = sql.indexOf("\n", index);
      index = newline === -1 ? sql.length : newline;
      continue;
    }

    if (ch === "/" && sql[index + 1] === "*") {
      const end = sql.indexOf("*/", index + 2);
      index = end === -1 ? sql.length : end + 2;
      continue;
    }

    if (ch === "'" || ch === '"') {
      index = skipQuoted(sql, index, ch);
      continue;
    }

    if (ch === "$") {
      const tag = dollarTagAt(sql, index);
      if (tag !== null) {
        dollarTag = tag;
        index += tag.length;
        continue;
      }
    }

    if (ch === ";") {
      push(index);
      start = index + 1;
    }
    index += 1;
  }

  push(sql.length);
  return statements;
}

/** تجاوز نص بين اقتباسين، مع احترام التكرار `''` و`""`. */
function skipQuoted(sql: string, from: number, quote: string): number {
  let index = from + 1;
  while (index < sql.length) {
    if (sql[index] === quote) {
      if (sql[index + 1] === quote) {
        index += 2;
        continue;
      }
      return index + 1;
    }
    index += 1;
  }
  return index;
}

/** وسم `$` أو `$tag$` في موضعه، أو `null` إن كان `$` عادية. */
function dollarTagAt(sql: string, from: number): string | null {
  const match = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(from));
  return match === null ? null : match[0];
}

/** تسمية قصيرة للطباعة: أول سطر فيه SQL حقيقي. */
function labelOf(statement: string): string {
  const line = stripComments(statement)
    .split("\n")
    .map((part) => part.trim())
    .find((part) => part !== "");
  if (line === undefined) return "عبارة بلا تسمية";
  return line.length > 72 ? `${line.slice(0, 69)}...` : line;
}

/** هل تتبقّى SQL بعد حذف التعليقات؟ */
function hasSql(statement: string): boolean {
  return stripComments(statement).trim() !== "";
}

/**
 * حذف التعليقات. **للنظر لا للتنفيذ:** النص المُنفَّذ يبقى كما هو في
 * الملف، وهذه الدالة تُستعمل لاختبار الفراغ ولبناء التسمية فقط.
 */
function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

function short(checksum: string): string {
  return checksum.slice(0, 12);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// التشغيل عند تنفيذ الملف مباشرة، كما في `src/index.ts`: الاستيراد في
// اختبارٍ لأداة التقسيم لا يشغّل الترحيل.
const entry = process.argv[1] ?? "";
if (entry.endsWith("migrate.ts") || entry.endsWith("migrate.js")) {
  main().catch((error: unknown) => {
    const code = pgCode(error);
    const state = code === undefined ? "" : ` (SQLSTATE ${code})`;
    console.error(`فشل الترحيل${state}: ${messageOf(error)}`);
    process.exitCode = 1;
  });
}
