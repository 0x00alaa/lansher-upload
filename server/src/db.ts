/**
 * طبقة الوصول لقاعدة البيانات.
 *
 * ثلاث قواعد لا تُكسر:
 *
 * 1. **لا نركّب SQL من مدخلات.** كل استعلام يستخدم parameters. اسم
 *    الجدول أو العمود يأتي من كودنا لا من `req.body`، ولا يُقبل من
 *    الطلب أصلاً. `sort_by` مثلاً ليس عموداً من الطلب، بل اختيار من
 *    `sync.ts` يختار SQL جاهزاً.
 * 2. **لا نعيد سرّاً أبداً.** `email_cipher` و`pin_hash` و`token_hash`
 *    لا تغادر هذه الطبقة. كل ما يحتاجه `auth.ts` هو قيمة اشتقاق، لا أصل.
 * 3. **الاتصال لا يُفتح عند الاستيراد.** `db()` كسول حتى لا يحتاج
 *    `npm test` قاعدة بيانات. أول استعلام يفتح.
 */

import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { config, type Config } from "./config.js";

/** صف قاعدة بيانات. `pg` يستخدم `any`، فنقيّده هنا بـ`unknown`. */
export type Row = Record<string, unknown>;

/** واجهة القراءة وحدها. `Db` و`Tx` يحققانها، فتبقى `limits.ts` محايدة. */
export interface Reader {
  one<T extends Row>(text: string, params?: readonly unknown[]): Promise<T | undefined>;
}

/** واجهة المعاملة: قراءة وكتابة على اتصال واحد مضمون. */
export interface Tx extends Reader {
  many<T extends Row>(text: string, params?: readonly unknown[]): Promise<T[]>;
  run(text: string, params?: readonly unknown[]): Promise<number>;
  code(error: unknown): string | undefined;
}

/**
 * واجهة قاعدة البيانات التي تعتمد عليها `auth.ts` و`sync.ts`.
 *
 * نمرّرها صريحةً لا عبر استيراد مباشر، لسببين:
 *
 * 1. **الاختبار.** `test/auth.test.ts` يمرّر نسخة في الذاكرة، فيختبر قفل
 *    الحساب وكشف إعادة استخدام التوكن بلا PostgreSQL.
 * 2. **المراجعة.** كل SQL في دوال مسمّاة، لا موزّع في استيراد ضمني.
 */
export interface Db {
  one<T extends Row>(text: string, params?: readonly unknown[]): Promise<T | undefined>;
  many<T extends Row>(text: string, params?: readonly unknown[]): Promise<T[]>;
  run(text: string, params?: readonly unknown[]): Promise<number>;
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  /** شفرة خطأ PostgreSQL إن كان الخطأ منها، وإلا `undefined`. */
  code(error: unknown): string | undefined;
}

/** السياق الذي تحتاجه الطبقات العليا: قاعدة البيانات والإعدادات. */
export interface Ctx {
  readonly db: Db;
  readonly config: Config;
}

let pool: Pool | null = null;

/** مجموعة الاتصالات. كسولة حتى لا يحتاج الاختبار قاعدة بيانات. */
export function db(): Pool {
  pool ??= new Pool({
    connectionString: config().databaseUrl,
    // Cloud Run يفتح اتصالاً لكل نسخة. بلا حد، تنفد اتصالات PostgreSQL
    // بسرعة مع عدة نسخ نشطة.
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Cloud SQL عبر proxy يطلب TLS. نجعله شرطياً لأن التطوير محلي.
    ssl: config().env === "production" ? { rejectUnauthorized: false } : undefined,
  });
  return pool;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/** التنفيذ الحقيقي فوق `pg`. */
export function postgresDb(): Db {
  return {
    async one<T extends Row>(text: string, params: readonly unknown[] = []) {
      const result = await db().query<T & QueryResultRow>(text, params as unknown[]);
      return result.rows[0] as T | undefined;
    },
    async many<T extends Row>(text: string, params: readonly unknown[] = []) {
      const result = await db().query<T & QueryResultRow>(text, params as unknown[]);
      return result.rows as T[];
    },
    async run(text: string, params: readonly unknown[] = []) {
      const result = await db().query(text, params as unknown[]);
      return result.rowCount ?? 0;
    },
    transaction,
    code: pgCode,
  };
}

/**
 * معاملة. كل نجاح، أو لا شيء.
 *
 * إلزامية في تسجيل الدخول: يقرأ `failed_logins` ويحدّث `status`. بلا
 * معاملة، طلبان متزامنان يتركان الحساب في حالة نصف مكتملة.
 */
export async function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client: PoolClient = await db().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(txOf(client));
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function txOf(client: PoolClient): Tx {
  return {
    async one<T extends Row>(text: string, params: readonly unknown[] = []) {
      const result = await client.query<T & QueryResultRow>(text, params as unknown[]);
      return result.rows[0] as T | undefined;
    },
    async many<T extends Row>(text: string, params: readonly unknown[] = []) {
      const result = await client.query<T & QueryResultRow>(text, params as unknown[]);
      return result.rows as T[];
    },
    async run(text: string, params: readonly unknown[] = []) {
      const result = await client.query(text, params as unknown[]);
      return result.rowCount ?? 0;
    },
    code: pgCode,
  };
}

/** شفرة خطأ PostgreSQL إن كان الخطأ منها، وإلا `undefined`. */
export function pgCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

/** فحص صحة الاتصال. يُستدعى من `/healthz`. */
export async function ping(): Promise<boolean> {
  try {
    await db().query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

/** سياق حقيقي من البيئة. نقطة الدخول الوحيدة في الإنتاج. */
export function liveCtx(): Ctx {
  return { db: postgresDb(), config: config() };
}
