/**
 * حدود الخطة: Free وPro.
 *
 * القاعدة: **الحدود في السيرفر، والعميل يعرضها فقط.** لو قرأها EXE من
 * ملف محلي، يعدّلها في ثانية. لذلك كل `require*` يمرّ من هنا، وكل
 * هنا يمرّ من جدول `plan_limits` في PostgreSQL.
 *
 * التخزين المؤقت: نخزّن الحدود في الذاكرة 60 ثانية. الاستدعاء في كل
 * طلب مزامنة مؤجلة. تغيير حد في لوحة الإدارة يسري خلال دقيقة، وهو
 * مقبول: لا نريد تعديل العتاد البطيء ولا نريد حداً لا يسري أبداً.
 */

import type { Ctx, Reader, Row } from "./db.js";

export type Plan = "free" | "pro";

export interface Limits {
  readonly plan: Plan;
  readonly maxDevices: number;
  readonly maxProfiles: number;
  readonly maxRulesPerProfile: number;
  readonly maxSessions: number;
  /** بالبايت. صفر يعني بلا حد. */
  readonly maxStorageBytes: number;
}

interface LimitRow extends Row {
  plan: Plan;
  max_devices: number;
  max_profiles: number;
  max_rules_per_profile: number;
  max_sessions: number;
  max_storage_bytes: string;
}

const TTL_MS = 60_000;
/** ذاكرة مؤقتة لكل `Ctx`، فاختبار بـ`Ctx` جديد لا يرث حدود غيره. */
const cache = new WeakMap<Reader, Map<Plan, { at: number; limits: Limits }>>();

function cacheOf(reader: Reader): Map<Plan, { at: number; limits: Limits }> {
  let map = cache.get(reader);
  if (!map) {
    map = new Map();
    cache.set(reader, map);
  }
  return map;
}

/** حدود خطة، من الذاكرة أو من قاعدة البيانات. */
export async function limitsFor(ctx: Ctx, plan: Plan): Promise<Limits> {
  const memo = cacheOf(ctx.db);
  const hit = memo.get(plan);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.limits;

  const row = await ctx.db.one<LimitRow>(
    `SELECT plan, max_devices, max_profiles, max_rules_per_profile,
            max_sessions, max_storage_bytes
       FROM plan_limits WHERE plan = $1`,
    [plan],
  );
  if (!row) {
    // لا نخترع قيماً عند غياب الصف في الإنتاج: صف `plan_limits` ناقص
    // خطأ نشر، ويُخفى هنا أن يراه المكلَّف.
    if (ctx.config.env === "production") {
      throw new Error(`plan_limits لا تحتوي صفاً للخطة: ${plan}. نفّذ migration.`);
    }
    const fallback = plan === "pro" ? DEV_PRO : DEV_FREE;
    memo.set(plan, { at: Date.now(), limits: fallback });
    return fallback;
  }

  const limits: Limits = {
    plan,
    maxDevices: row.max_devices,
    maxProfiles: row.max_profiles,
    maxRulesPerProfile: row.max_rules_per_profile,
    maxSessions: row.max_sessions,
    maxStorageBytes: Number(row.max_storage_bytes),
  };
  memo.set(plan, { at: Date.now(), limits });
  return limits;
}

// قيم احتياطية للتطوير فقط، مطابقة لـ`db/schema.sql`.
// في الإنتاج غياب الصف يرمي استثناء، ولا تُستخدم هذه.
const DEV_FREE: Limits = {
  plan: "free",
  maxDevices: 1,
  maxProfiles: 3,
  maxRulesPerProfile: 10,
  maxSessions: 1,
  maxStorageBytes: 50 * 1024 * 1024,
};
const DEV_PRO: Limits = {
  plan: "pro",
  maxDevices: 5,
  maxProfiles: 50,
  maxRulesPerProfile: 200,
  maxSessions: 5,
  maxStorageBytes: 2 * 1024 * 1024 * 1024,
};

/**
 * نتيجة فحص حد. `allowed: false` يعني الرفض، و`reason` رمز ثابت
 * تستهلكه الواجهة لعرض رسالة مناسبة بلغتها.
 */
export interface Check {
  readonly allowed: boolean;
  readonly reason: string | null;
  readonly limit: number | null;
  readonly current: number;
}

const OK: Check = { allowed: true, reason: null, limit: null, current: 0 };

export async function checkDevices(ctx: Ctx, plan: Plan, current: number): Promise<Check> {
  const limits = await limitsFor(ctx, plan);
  if (current >= limits.maxDevices) {
    return {
      allowed: false,
      reason: "device_limit",
      limit: limits.maxDevices,
      current,
    };
  }
  return { ...OK, current };
}

export async function checkProfiles(ctx: Ctx, plan: Plan, current: number): Promise<Check> {
  const limits = await limitsFor(ctx, plan);
  if (current >= limits.maxProfiles) {
    return { allowed: false, reason: "profile_limit", limit: limits.maxProfiles, current };
  }
  return { ...OK, current };
}

export async function checkRules(ctx: Ctx, plan: Plan, ruleCount: number): Promise<Check> {
  const limits = await limitsFor(ctx, plan);
  if (ruleCount > limits.maxRulesPerProfile) {
    return {
      allowed: false,
      reason: "rule_limit",
      limit: limits.maxRulesPerProfile,
      current: ruleCount,
    };
  }
  return { ...OK, current: ruleCount };
}

export async function checkSessions(ctx: Ctx, plan: Plan, current: number): Promise<Check> {
  const limits = await limitsFor(ctx, plan);
  if (current >= limits.maxSessions) {
    return { allowed: false, reason: "session_limit", limit: limits.maxSessions, current };
  }
  return { ...OK, current };
}

/** فحص الحجم. `size` و`max` بالبايت. */
export async function checkStorage(
  ctx: Ctx,
  plan: Plan,
  currentBytes: number,
  incoming: number,
): Promise<Check> {
  const limits = await limitsFor(ctx, plan);
  // صفر = بلا حد.
  if (limits.maxStorageBytes > 0 && currentBytes + incoming > limits.maxStorageBytes) {
    return {
      allowed: false,
      reason: "storage_limit",
      limit: limits.maxStorageBytes,
      current: currentBytes + incoming,
    };
  }
  return { allowed: true, reason: null, limit: limits.maxStorageBytes, current: currentBytes + incoming };
}

/**
 * إبطال ذاكرة `ctx` واحد. بعد تغيير حدود من لوحة الإدارة.
 * الذاكرة لـ`WeakMap`، فلا تحتفظ بميت ولا تحتاج نسياناً يدوياً.
 */
export function invalidateLimitsCache(reader: Reader): void {
  cacheOf(reader).clear();
}
