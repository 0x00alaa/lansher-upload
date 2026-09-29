/**
 * ظ‚ط§ط¹ط¯ط© ط¨ظٹط§ظ†ط§طھ ظپظٹ ط§ظ„ط°ط§ظƒط±ط© ظ„ظ„ط§ط®طھط¨ط§ط±.
 *
 * ظ„ظٹط³طھ ظ…ط­ط§ظƒط§ط© ظ„ظ€SQL: ظ‡ظٹ طھظپط³ظٹط± ظ„ظƒظ„ ط§ط³طھط¹ظ„ط§ظ… ظپظٹ `auth.ts` ط­ط³ط¨ ظ†طµظ‘ظ‡. ط£ظٹ
 * ط§ط³طھط¹ظ„ط§ظ… ط¬ط¯ظٹط¯ ظ„ط§ ظٹط¹ط±ظپظ‡ ظ‡ط°ط§ ط§ظ„ظ…ظ„ظپ ظٹظڈط¹ظٹط¯ `undefined`طŒ ظپظٹظپط´ظ„ ط§ظ„ط§ط®طھط¨ط§ط±
 * loudly ط¨ط¯ظ„ ط£ظ† ظٹظ…ط±ظ‘ ط¨ظ„ط§ ظپط­طµ. ظ‡ط°ط§ ظ…ظ‚طµظˆط¯: ظ…ط±ط§ط¬ط¹ط© ظƒظ„ ط§ط³طھط¹ظ„ط§ظ… ط¹ظ†ط¯ طھط؛ظٹظٹط±ظ‡.
 */

import { pgCode, type Db, type Row, type Tx } from "../src/db.js";

interface UserRecord extends Row {
  id: string;
  /** `bytea` ظپظٹ PostgreSQL: `Buffer` ظ…ظ† `emailHash`. */
  email_hash: unknown;
  email_cipher: string;
  pin_hash: string;
  status: string;
  plan: string;
  failed_logins: number;
  last_failed_at: Date | null;
}

interface SessionRecord extends Row {
  id: string;
  user_id: string;
  token_hash: string;
  previous_hash: string | null;
  device_label: string;
  device_id: string | null;
  created_at: Date;
  last_used_at: Date;
  revoked_at: Date | null;
  rotated_at: Date | null;
  expires_at: Date;
}

interface CodeRecord extends Row {
  code_hash: string;
  user_id: string;
  purpose: string;
  attempts: number;
  expires_at: Date;
}

interface ProfileRecord extends Row {
  id: string;
  user_id: string;
  slug: string;
  name: string;
  content: string;
  revision: number;
  updated_at: Date;
  created_at: Date;
}

function same(a: unknown, b: unknown): boolean {
  if (Buffer.isBuffer(a) && Buffer.isBuffer(b)) return a.equals(b);
  if (a instanceof Uint8Array && b instanceof Uint8Array) return Buffer.from(a).equals(Buffer.from(b));
  return String(a) === String(b);
}

export class FakeDb implements Db {
  readonly users = new Map<string, UserRecord>();
  readonly sessions = new Map<string, SessionRecord>();
  readonly codes = new Map<string, CodeRecord>();
  readonly devices: Row[] = [];
  readonly auditLog: Row[] = [];
  /** ملفات المستخدم. المفتاح `id`، والقيمة كما يخزّنها PostgreSQL. */
  readonly profiles = new Map<string, ProfileRecord>();
  /** سجل النسخ السابقة، كما في `profile_revisions`. */
  readonly revisions: Row[] = [];
  /** ظƒظ„ ط§ط³طھط¹ظ„ط§ظ… ط±ط¢ظ‡. ظ„ظ‚ظٹط§ط³ ط¹ط¯ط¯ ط§ظ„ط§ط³طھط¹ظ„ط§ظ…ط§طھ ظپظٹ ط­ط§ظ„ط© ط§ظ„ط­ط³ط§ط¨ ط؛ظٹط± ط§ظ„ظ…ظˆط¬ظˆط¯. */
  readonly seen: string[] = [];
  private nextId = 1;

  /**
   * لقطة كاملة قبل المعاملة، ونستعيدها إن استثنت.
   *
   * PostgreSQL يتراجع عن كل تعديل داخل معاملة أُجهضت. بدون ذلك
   * كان `sync.ts` يبدو خاطئاً: تعديل الاسم يبقى بعد تعارض المراجعة،
   * والحقيقة أن التراجع يطمسه. المحاكي الذي يملأ فراغاً بلا rollback
   * يعطي ثقة كاذبة، فنحاكيها.
   */
  private snapshot(): { users: Map<string, UserRecord>; profiles: Map<string, ProfileRecord>; devices: Row[]; auditLog: Row[]; revisions: Row[]; nextId: number } {
    return {
      users: new Map(this.users),
      // `ProfileRecord` كائنات قابلة للتعديل في مكانها (يزيد `bump`
      // المراجعة ويغيّر `content`)، فننسخ القيم لا المراجع.
      profiles: new Map([...this.profiles].map(([id, p]) => [id, { ...p }])),
      devices: [...this.devices],
      auditLog: [...this.auditLog],
      revisions: [...this.revisions],
      nextId: this.nextId,
    };
  }

  private restore(state: ReturnType<FakeDb["snapshot"]>): void {
    this.users.clear();
    for (const [id, row] of state.users) this.users.set(id, row);
    this.profiles.clear();
    for (const [id, row] of state.profiles) this.profiles.set(id, row);
    this.devices.length = 0;
    this.devices.push(...state.devices);
    this.auditLog.length = 0;
    this.auditLog.push(...state.auditLog);
    this.revisions.length = 0;
    this.revisions.push(...state.revisions);
    this.nextId = state.nextId;
  }

  async one<T extends Row>(text: string, params: readonly unknown[] = []): Promise<T | undefined> {
    return this.read<T>(text, params);
  }

  async many<T extends Row>(text: string, params: readonly unknown[] = []): Promise<T[]> {
    const t = text.replace(/\s+/g, " ").trim();
    if (t.includes("FROM profiles WHERE user_id = $1 ORDER BY updated_at DESC")) {
      return this.profilesOf(params[0])
        .map((p): T => this.snap(p) as unknown as T)
        .sort(
          (a, b) =>
            (b as unknown as ProfileRecord).updated_at.getTime() -
            (a as unknown as ProfileRecord).updated_at.getTime(),
        );
    }
    if (t.includes("FROM profiles WHERE user_id = $1 AND updated_at > $2")) {
      const since = new Date(params[1] as string).getTime();
      return this.profilesOf(params[0])
        .filter((p) => p.updated_at.getTime() > since)
        .sort((a, b) => a.updated_at.getTime() - b.updated_at.getTime())
        .map((p): T => this.snap(p) as unknown as T);
    }
    if (t.includes("FROM sessions WHERE user_id = $1 ORDER BY last_used_at DESC")) {
      return [...this.sessions.values()]
        .filter((s) => same(s.user_id, params[0]))
        .map(
          (s): T =>
            ({
              device_label: s.device_label,
              created_at: s.created_at,
              last_used_at: s.last_used_at,
              revoked_at: s.revoked_at,
              expires_at: s.expires_at,
            }) as unknown as T,
        );
    }
    const single = await this.read<T>(text, params);
    return single === undefined ? [] : [single];
  }

  async run(text: string, params: readonly unknown[] = []): Promise<number> {
    return this.write(text, params);
  }

  /**
   * ظ…ط¹ط§ظ…ظ„ط© ظˆظ‡ظ…ظٹط©. `auth.ts` ظ„ط§ ظٹط±ظ…ظٹ ط§ط³طھط«ظ†ط§ط، ط¯ط§ط®ظ„ `fn` ط¹ظ…ط¯ط§ظ‹طŒ ظپظ„ط§ ظ†ط­طھط§ط¬
   * rollback ط­ظ‚ظٹظ‚ظٹ. ظ„ظˆ ط£ظڈط¶ظٹظپ ط±ظ…ط² ظٹط±ظ…ظٹطŒ ظٹظپط´ظ„ ظ‡ط°ط§ ط§ظ„ظ…ظ„ظپ طµط§ظ…طھط§ظ‹ â€” ظ†ظ‚ط¨ظ„ ط°ظ„ظƒ
   * ط§ظ„ط¢ظ† ظ„ط£ظ† `auth.test.ts` ظٹط؛ط·ظٹ ظ…ط³ط§ط±ط§طھ ط§ظ„ظپط´ظ„ ط¹ط¨ط± ط±ظ…ظˆط² ط§ظ„ط¥ط±ط¬ط§ط¹.
   */
  async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const before = this.snapshot();
    try {
      return await fn(this);
    } catch (error) {
      this.restore(before);
      throw error;
    }
  }

  code(error: unknown): string | undefined {
    // نستخدم نفس قراءة `pg`، وإلا اختبر `sync.ts` مسار تعارض لا يحدث في
    // PostgreSQL: `40001` من `RAISE EXCEPTION`.
    return pgCode(error);
  }

  /** ظٹط¶ظٹظپ ظ…ط³طھط®ط¯ظ…ط§ظ‹ ظ†ط´ط·ط§ظ‹ ط¨طھط¬ط²ط¦ط© PIN ط­ظ‚ظٹظ‚ظٹط©. ظٹط¹ظٹط¯ ط§ظ„ظ…ط¹ط±ظ‘ظپ. */
  seedUser(pinHash: string, plan: "free" | "pro" = "free", emailHash: unknown = "user-1"): string {
    const id = `u${this.nextId++}`;
    this.users.set(id, {
      id,
      email_hash: emailHash,
      email_cipher: "enc",
      pin_hash: pinHash,
      status: "active",
      plan,
      failed_logins: 0,
      last_failed_at: null,
    });
    return id;
  }

  /** ط¹ط¯ط¯ ط§ظ„ط¬ظ„ط³ط§طھ ط§ظ„ط­ظٹظ‘ط© ظ„ظ…ط³طھط®ط¯ظ…. */
  liveSessions(userId: string): number {
    const now = Date.now();
    return [...this.sessions.values()].filter(
      (s) => s.user_id === userId && s.revoked_at === null && s.expires_at.getTime() > now,
    ).length;
  }

  /**
   * ظ‚ط±ط§ط،ط© طµظپ ط¹ط¨ط± `one`طŒ ظ„ظ„طھط£ظƒط¯ ظ…ظ† ط£ظ†ظ‡ط§ ظ„ظ‚ط·ط© ظ„ط§ ظ…ط±ط¬ط¹ ط­ظٹظ‘.
   *
   * ظ‡ط°ط§ ط§ظ„ظپط±ظ‚ ط­ط§ط³ظ… ظپظٹ `login`: طھظ‚ط±ط£ `failed_logins`طŒ ط«ظ… طھظƒطھط¨
   * `+ 1`طŒ ط«ظ… طھط­ط³ط¨ ط§ظ„ط­ط¯ظ‘. ظ„ظˆ ظƒط§ظ† ط§ظ„طµظپ ظ…ط±ط¬ط¹ط§ظ‹طŒ ظ„ظƒط§ظ†طھ `+ 1` طھظ‚ط±ط¤ظ‡ط§
   * ط¨ط¹ط¯ ط²ظٹط§ط¯ط© ط§ظ„ظ‚ط±ط§ط،ط©طŒ ظپظٹظ‚ظپظ„ ط§ظ„ط­ط³ط§ط¨ ظپظٹ ظ…ط­ط§ظˆظ„ط© ط£ط¨ظƒط± ظ…ظ…ط§ ظٹظ‚طھط¶ظٹظ‡ ط§ظ„ط­ط¯ظ‘.
   */
  async peek<T extends Row>(text: string, params: readonly unknown[]): Promise<T | undefined> {
    return this.read<T>(text, params);
  }

  private read<T extends Row>(text: string, params: readonly unknown[]): T | undefined {
    this.queries += 1;
    const t = text.replace(/\s+/g, " ").trim();
    this.seen.push(t);

    // `INSERT ... RETURNING id` ظپظٹ `auth.ts` ظٹظ…ط±ظ‘ ط¹ط¨ط± `one` ظ„ط§ `run`طŒ
    // ظپظ†ظڈظ†ط´ط¦ ط§ظ„ظ…ط³طھط®ط¯ظ… ظ‡ظ†ط§ ظˆظ†ظڈط±ط¬ط¹ ط§ظ„ظ…ط¹ط±ظ‘ظپ.
    // `INSERT ... RETURNING id` عبر `one`: ننفّذ ثم نقرأ الصف الجديد.
    if (t.startsWith("INSERT INTO sessions") && t.includes("RETURNING id")) {
      this.write(t, params);
      const created = [...this.sessions.values()].at(-1);
      return (created === undefined ? undefined : { id: created.id }) as unknown as T | undefined;
    }
    if (t.includes("FROM sessions WHERE id = $1 AND user_id = $2")) {
      const session = this.sessions.get(params[0] as string);
      if (!session || !same(session.user_id, params[1])) return undefined;
      // `revoked_at IS NULL AND expires_at > now()`: جلسة ملغاة أو منتهية
      // لا تُرجَع، فالتوكن الموقَّق بعدها يُرفض كأنه باطل.
      if (session.revoked_at !== null || session.expires_at.getTime() <= Date.now()) {
        return undefined;
      }
      return { id: session.id, user_id: session.user_id } as unknown as T | undefined;
    }
    if (t.startsWith("INSERT INTO users") && t.includes("RETURNING id")) {
      this.write(t, params);
      const created = [...this.users.values()].at(-1);
      return (created === undefined ? undefined : { id: created.id }) as unknown as T | undefined;
    }
    if (t.includes("FROM users WHERE email_hash = $1")) {
      return this.snap(this.pick(this.users, "email_hash", params[0])) as T | undefined;
    }
    if (t.includes("FROM users WHERE id = $1")) {
      return this.snap(this.pick(this.users, "id", params[0])) as T | undefined;
    }
    if (t.includes("count(*)::text AS count FROM sessions")) {
      return { count: String(this.liveSessions(params[0] as string)) } as unknown as T;
    }
    if (t.includes("FROM email_codes WHERE code_hash = $1 AND purpose = 'signup'")) {
      return this.snap(this.pick(this.codes, "code_hash", params[0])) as T | undefined;
    }
    if (t.includes("FROM sessions WHERE token_hash = $1")) {
      return this.snap(this.pick(this.sessions, "token_hash", params[0])) as T | undefined;
    }
    // `INSERT ... RETURNING` عبر `one`: ننفّذ الكتابة ثم نقرأ الصف الذي
    // أنشأته. `ON CONFLICT DO NOTHING` يعطي `affected = 0` أي لا صف، وهو
    // ما يميّز `slug_taken` عن النجاح.
    if (t.startsWith("INSERT INTO profiles")) {
      if (this.write(t, params) === 0) return undefined;
      const created = [...this.profiles.values()].at(-1);
      return (created === undefined ? undefined : this.snap(created)) as T | undefined;
    }
    // `bump_profile_revision` دالة في `schema.sql`: تقارن المراجعة وتزيدها
    // في معاملة واحدة، وترفع `40001` عند التعارض. نحاكيها حرفياً.
    if (t.includes("FROM bump_profile_revision(")) {
      const profile = this.pick(this.profiles, "id", params[0]);
      if (!profile) return undefined;
      if (profile.revision !== Number(params[1])) {
        const error = new Error("revision_conflict") as Error & { code: string };
        error.code = "40001";
        throw error;
      }
      profile.content = params[2] as string;
      profile.revision += 1;
      profile.updated_at = new Date();
      this.revisions.push({
        profile_id: profile.id,
        revision: profile.revision,
        content: profile.content,
        device_id: params[3],
      });
      return this.snap(profile) as T | undefined;
    }
    if (t.startsWith("SELECT plan FROM users WHERE id = $1")) {
      const user = this.pick(this.users, "id", params[0]);
      return (user === undefined ? undefined : { plan: user["plan"] }) as unknown as T | undefined;
    }
    if (t.includes("COUNT(*)::text AS total FROM profiles WHERE user_id = $1")) {
      const n = this.profilesOf(params[0]).length;
      return { total: String(n) } as unknown as T;
    }
    if (t.includes("SUM(pg_column_size(content))")) {
      const total = this.profilesOf(params[0]).reduce((sum, p) => sum + Buffer.byteLength(p.content), 0);
      return { total: String(total) } as unknown as T;
    }
    if (t.includes("pg_column_size(content)::text AS size FROM profiles WHERE id = $1")) {
      const profile = this.pick(this.profiles, "id", params[0]);
      if (!profile) return undefined;
      return {
        size: String(Buffer.byteLength(profile.content as unknown as string)),
      } as unknown as T;
    }
    // ملف واحد مع محتواه. `content` عمود في `SELECT`، والمعرّف والمالك
    // في `WHERE`، فنطابق النص لا ترتيب الأعمدة.
    if (t.includes("content FROM profiles WHERE id = $1 AND user_id = $2")) {
      const profile = this.pick(this.profiles, "id", params[0]) as ProfileRecord | undefined;
      if (!profile || !same(profile.user_id, params[1])) return undefined;
      return this.snap({ ...profile, content: JSON.parse(profile.content) }) as T | undefined;
    }
    if (t.includes("FROM profiles WHERE id = $1 AND user_id = $2")) {
      const profile = this.pick(this.profiles, "id", params[0]) as ProfileRecord | undefined;
      if (!profile || !same(profile.user_id, params[1])) return undefined;
      return this.snap(profile) as T | undefined;
    }
    if (t.includes("FROM plan_limits WHERE plan = $1")) {
      const plan = params[0] as string;
      if (plan === "free") {
        return {
          plan,
          max_devices: 1,
          max_profiles: 3,
          max_rules_per_profile: 10,
          max_sessions: 1,
          max_storage_bytes: "52428800",
        } as unknown as T;
      }
      if (plan === "pro") {
        return {
          plan,
          max_devices: 5,
          max_profiles: 50,
          max_rules_per_profile: 200,
          max_sessions: 5,
          max_storage_bytes: "2147483648",
        } as unknown as T;
      }
      return undefined;
    }
    return undefined;
  }

  private write(text: string, params: readonly unknown[]): number {
    this.queries += 1;
    const t = text.replace(/\s+/g, " ").trim();
    this.seen.push(t);
    const now = new Date();
    const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000);

    if (t.startsWith("INSERT INTO email_codes")) {
      this.codes.set(params[0] as string, {
        code_hash: params[0] as string,
        user_id: params[1] as string,
        purpose: params[2] as string,
        attempts: 0,
        expires_at: inDays(1),
      });
      return 1;
    }
    if (t.startsWith("INSERT INTO users")) {
      const id = `u${this.nextId++}`;
      this.users.set(id, {
        id,
        email_hash: params[0] as string,
        email_cipher: params[1] as string,
        pin_hash: params[2] as string,
        status: "pending",
        plan: "free",
        failed_logins: 0,
        last_failed_at: null,
      });
      return 1;
    }
    if (t.startsWith("UPDATE email_codes SET attempts")) {
      const code = this.codes.get(params[0] as string);
      if (code) code.attempts += 1;
      return 1;
    }
    if (t.startsWith("UPDATE users SET pin_hash = $1, status = 'active'")) {
      const user = this.users.get(params[1] as string);
      if (user) {
        user.pin_hash = params[0] as string;
        user.status = "active";
      }
      return 1;
    }
    if (t.includes("failed_logins = failed_logins + 1")) {
      const user = this.users.get(params[0] as string);
      if (user) {
        user.failed_logins += 1;
        user.last_failed_at = new Date();
      }
      return 1;
    }
    if (t.startsWith("UPDATE users SET status = 'locked'")) {
      const user = this.users.get(params[0] as string);
      if (user) user.status = "locked";
      return 1;
    }
    if (t.startsWith("UPDATE users SET failed_logins = 0")) {
      const user = this.users.get(params[0] as string);
      if (user) {
        user.failed_logins = 0;
        user.last_failed_at = null;
      }
      return 1;
    }
    if (t.startsWith("DELETE FROM email_codes WHERE user_id = $1")) {
      let n = 0;
      for (const [key, code] of this.codes) {
        if (code.user_id === params[0]) {
          this.codes.delete(key);
          n += 1;
        }
      }
      return n;
    }
    if (t.startsWith("INSERT INTO sessions") && t.includes("device_id")) {
      const id = `s${this.nextId++}`;
      this.sessions.set(id, {
        id,
        user_id: params[0] as string,
        token_hash: params[1] as string,
        previous_hash: null,
        device_label: params[2] as string,
        device_id: params[3] as string,
        created_at: new Date(),
        last_used_at: new Date(),
        revoked_at: null,
        rotated_at: null,
        expires_at: inDays(Number(params[5] ?? 30)),
      });
      return 1;
    }
    if (t.startsWith("INSERT INTO sessions")) {
      const id = `s${this.nextId++}`;
      this.sessions.set(id, {
        id,
        user_id: params[0] as string,
        token_hash: params[1] as string,
        previous_hash: null,
        device_label: params[2] as string,
        device_id: null,
        created_at: new Date(),
        last_used_at: new Date(),
        revoked_at: null,
        rotated_at: null,
        expires_at: inDays(Number(params[3] ?? 30)),
      });
      return 1;
    }
    if (t.startsWith("UPDATE sessions SET last_used_at = now() WHERE id = $1")) {
      const session = this.sessions.get(params[0] as string);
      if (session) session.last_used_at = new Date();
      return session ? 1 : 0;
    }
    if (t.startsWith("INSERT INTO user_devices")) {
      this.devices.push({ user_id: params[0], device_id: params[1], label: params[2] });
      return 1;
    }
    if (t.startsWith("UPDATE sessions SET revoked_at = now(), previous_hash = $2")) {
      const session = this.sessions.get(params[0] as string);
      if (session) {
        session.revoked_at = new Date();
        session.previous_hash = params[1] as string;
        session.rotated_at = new Date();
      }
      return 1;
    }
    if (t.startsWith("UPDATE sessions SET revoked_at = now() WHERE token_hash = $1")) {
      // ظ‡ظ†ط§ ظ†ط¹ط¯ظ‘ظ„ ط§ظ„طµظپ ط§ظ„ظ…ط®ط²ظژظ‘ظ†طŒ ظ„ط§ ظ†ط³ط®ط©: ظ…ط³ط§ط± ظƒطھط§ط¨ط© ظ„ط§ ظ‚ط±ط§ط،ط©.
      const session = this.pick(this.sessions, "token_hash", params[0]) as
        | SessionRecord
        | undefined;
      if (session && session.revoked_at === null) {
        session.revoked_at = new Date();
        return 1;
      }
      return 0;
    }
    if (t.startsWith("UPDATE sessions SET revoked_at = now() WHERE user_id = $1")) {
      let n = 0;
      for (const session of this.sessions.values()) {
        if (session.user_id === params[0] && session.revoked_at === null) {
          session.revoked_at = new Date();
          n += 1;
        }
      }
      return n;
    }
    if (t.startsWith("INSERT INTO profiles")) {
      // `ON CONFLICT (user_id, slug) DO NOTHING RETURNING`: نتحقق من
      // التكرار بأنفسنا، تماماً كما يفعل PostgreSQL.
      const userId = params[0] as string;
      const slug = params[1] as string;
      if (this.profilesOf(userId).some((p) => p.slug === slug)) return 0;
      const id = `p${this.nextId++}`;
      this.profiles.set(id, {
        id,
        user_id: userId,
        slug,
        name: params[2] as string,
        content: params[3] as string,
        revision: 1,
        updated_at: new Date(),
        created_at: new Date(),
      });
      return 1;
    }
    if (t.startsWith("INSERT INTO profile_revisions")) {
      this.revisions.push({
        profile_id: params[0],
        revision: 1,
        content: params[1],
        device_id: params[2],
      });
      return 1;
    }
    if (t.startsWith("UPDATE profiles SET name = $1 WHERE id = $2")) {
      const profile = this.pick(this.profiles, "id", params[1]);
      if (profile) {
        profile.name = params[0] as string;
        profile.updated_at = new Date();
      }
      return profile ? 1 : 0;
    }
    if (t.startsWith("DELETE FROM profiles WHERE id = $1")) {
      const profile = this.pick(this.profiles, "id", params[0]) as ProfileRecord | undefined;
      if (!profile || !same(profile.user_id, params[1])) return 0;
      // المراجعة شرط في الحذف، فلا نحذف نسخة أحدث.
      if (profile.revision !== Number(params[2])) return 0;
      this.profiles.delete(profile.id);
      return 1;
    }
    if (t.startsWith("INSERT INTO audit_log")) {
      // `auth.ts` يمرّر `session_id` ضمن المعاملات، و`sync.ts` لا يمرّره.
      // نقرأ الشكل من قائمة الأعمدة لا من رقم معامل ثابت.
      const hasSession = t.includes("session_id");
      this.auditLog.push({
        user_id: params[0],
        action: hasSession ? params[2] : params[1],
        context: hasSession ? params[3] : params[2],
      });
      return 1;
    }
    return 0;
  }

  queries = 0;

  private pick(map: Map<string, Row>, field: string, value: unknown): Row | undefined {
    for (const row of map.values()) {
      if (same(row[field], value)) return row;
    }
    return undefined;
  }

  /** كل ملفات مستخدم. الاختبارات تحتاجها للتحقق من حدود الخطة. */
  profilesOf(userId: unknown): ProfileRecord[] {
    return [...this.profiles.values()].filter((p) => same(p.user_id, userId));
  }

  /**
   * ظ†ط³ط®ط© ظ…ظ† ط§ظ„طµظپ ط¹ظ†ط¯ ط§ظ„ظ‚ط±ط§ط،ط©.
   *
   * PostgreSQL ظٹط¹ظٹط¯ ظ„ظ‚ط·ط©: ظ…ط§ ظٹط¹ط¯ظ‘ظ„ظ‡ `UPDATE` ظ„ط§ط­ظ‚ط§ظ‹ ظ„ط§ ظٹط؛ظٹظ‘ط± ط§ظ„طµظپ ط§ظ„ط°ظٹ
   * ظ‚ط±ط£ظ‡ ط§ظ„ط§ط³طھط¹ظ„ط§ظ… ط§ظ„ط³ط§ط¨ظ‚. ظ„ظˆ ط£ط¹ط§ط¯ ظ‡ط°ط§ ط§ظ„ظ…ظ„ظپ ط§ظ„ظ…ط±ط¬ط¹ ظ†ظپط³ظ‡طŒ ظ„ط¹ط¯ظ‘ظ„ `login`
   * ظ‚ظٹظ…ط© `failed_logins` ظ‚ط¨ظ„ ط£ظ† ظٹظ‚ط±ط£ظ‡ط§طŒ ظپظٹط­ط³ط¨ `+1` ط®ط·ط£ظ‹. ط£ط¹ط§ط¯طھ ط§ط®طھط¨ط§ط±
   * ط§ظ„ظ‚ظپظ„ ظ‡ط°ظ‡ ط§ظ„ظ…ط´ظƒظ„ط©: ظ‚ط±ظ‘ط± ظ‚ظپظ„ط§ظ‹ ظپظٹ ط§ظ„ظ…ط­ط§ظˆظ„ط© ط§ظ„ط±ط§ط¨ط¹ط© ط¨ط¯ظ„ ط§ظ„ط®ط§ظ…ط³ط©.
   */
  private snap(row: Row | undefined): Row | undefined {
    return row === undefined ? undefined : { ...row };
  }
}
