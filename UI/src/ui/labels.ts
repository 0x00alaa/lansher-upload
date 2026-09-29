import type { Action, CompareOp, Condition, EventTypeName } from "../types";

/**
 * أسماء عربية لأنواع العقد. مكانها واحد لكل التطبيق: القوائم تكتب
 * الاسم وتكتب القيمة، ولا تترك المستخدم يقرأ `is_subscriber` في
 * حقل اختيار. القيم نفسها (`kind`, `op`) تبقى كما في العقد بلا
 * ترجمة ولا اختصار، فالترجمة في العرض فقط.
 */

export const EVENT_LABELS: Record<EventTypeName, string> = {
  Chat: "رسالة دردشة",
  Gift: "هدية",
  Like: "إعجاب",
  Follow: "متابعة جديدة",
  Join: "انضمام للبث",
  Share: "مشاركة",
  Subscribe: "اشتراك",
  StreamStart: "بداية البث",
  StreamEnd: "نهاية البث",
};

export const EVENT_TYPE_ORDER: EventTypeName[] = [
  "Gift",
  "Like",
  "Chat",
  "Subscribe",
  "Follow",
  "Share",
  "Join",
  "StreamStart",
  "StreamEnd",
];

export const OP_LABELS: Record<CompareOp, string> = {
  eq: "يساوي",
  ne: "لا يساوي",
  gt: "أكبر من",
  gte: "أكبر من أو يساوي",
  lt: "أصغر من",
  lte: "أصغر من أو يساوي",
  between: "بين",
  contains: "يحتوي",
  starts_with: "يبدأ بـ",
  ends_with: "ينتهي بـ",
  matches: "يطابق النمط",
  in: "ضمن قائمة",
};

/** العمليات المقبولة لكل شرط: قيمة رقمية لا تقبل `contains`. */
export const NUMERIC_OPS: CompareOp[] = [
  "eq",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
];

export const TEXT_OPS: CompareOp[] = [
  "eq",
  "ne",
  "contains",
  "starts_with",
  "ends_with",
  "matches",
];

export const CONDITION_LABELS: Record<Condition["kind"], string> = {
  event_type_is: "نوع الحدث هو",
  event_type_not: "نوع الحدث ليس",
  value: "قيمة الحدث",
  repeat_count: "عدد التكرار",
  subject: "المُرسَل",
  text: "نص الرسالة",
  nickname: "اسم المستخدم",
  unique_id: "معرّف الحساب",
  is_follower: "متابِع",
  is_subscriber: "مشترك",
  chance: "نسبة مئوية",
  and: "كل الشروط",
  or: "أي شرط",
  not: "ليس هذا الشرط",
};

export const CONDITION_ORDER: Condition["kind"][] = [
  "event_type_is",
  "value",
  "repeat_count",
  "subject",
  "text",
  "nickname",
  "unique_id",
  "is_follower",
  "is_subscriber",
  "chance",
  "and",
  "or",
  "not",
];

export const ACTION_LABELS: Record<Action["kind"], string> = {
  play_sound: "تشغيل صوت",
  speak: "نطق صوتي",
  alert: "إظهار تنبيه",
  add_to_goal: "إضافة إلى هدف",
  send_chat: "إرسال رسالة",
  webhook: "استدعاء رابط",
  integration: "تكامل خارجي",
  log: "كتابة في السجل",
  none: "بلا إجراء",
};

export const ACTION_ORDER: Action["kind"][] = [
  "speak",
  "play_sound",
  "alert",
  "send_chat",
  "add_to_goal",
  "webhook",
  "integration",
  "log",
  "none",
];

export const ON_ERROR_LABELS: Record<"continue" | "abort" | "retry", string> = {
  continue: "متابعة رغم الخطأ",
  abort: "إيقاف بقية الإجراءات",
  retry: "إعادة المحاولة",
};

export const QUEUE_LABELS: Record<"immediate" | "serial" | "bounded", string> = {
  immediate: "تشغيل فوري",
  serial: "واحد تلو الآخر",
  bounded: "بعدد محدود",
};

export const BOOL_LABELS: Record<"true" | "false" | "any", string> = {
  any: "مهم",
  true: "نعم",
  false: "لا",
};

/** قائمة القيم النصية لشرط `subject`، منفصلة عن `values` في العقد. */
export function splitValues(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
