// طبقة النداء: واجهة واحدة، وتنفيذان: Tauri عند التشغيل الحقيقي، ومحاكاة
// الآن حتى تعمل الواجهة قبل اكتمال Rust.

import type {
  ActionOutcome,
  AppState,
  Condition,
  Counts,
  EngineReport,
  EventType,
  LiveEvent,
  Request,
  Response,
  Rule,
} from "./types";
import { eventTypeName } from "./types";

/** يطابق `PROTOCOL_VERSION` في `crates/lansher-server/src/lib.rs`. */
const PROTOCOL_VERSION = 1;

export interface BridgeClient {
  send(request: Request): Promise<Response>;
  readonly kind: "tauri" | "mock";
}

export class BridgeError extends Error {}

function assertOk(response: Response): Response {
  if (!response.ok) {
    throw new BridgeError(response.error?.message ?? "فشل الطلب دون رسالة");
  }
  return response;
}

/** التنفيذ الحقيقي: كل شيء يمر عبر أمر واحد في Tauri. */
export class TauriBridge implements BridgeClient {
  readonly kind = "tauri" as const;
  private opened = false;

  async send(request: Request): Promise<Response> {
    const { invoke } = await import("@tauri-apps/api/core");
    if (!this.opened && request.cmd !== "hello") {
      await this.handshake(invoke);
    }
    const response = assertOk(await invoke<Response>("bridge_request", { request }));
    return response;
  }

  /**
   * مصافحة قبل أي طلب: التوكن يُولَّد داخل Rust ولا يُخزَّن في الواجهة، ويصل
   * عبر أمر منفصل لا عبر معاملات الطلب.
   */
  private async handshake(
    invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>,
  ): Promise<void> {
    const token = await invoke<string>("auth_token");
    // نتحقق من نجاح Hello قبل إعلان الجلسة مفتوحة، وإلا صار أول طلب
    // حقيقي puzzling بلا تفسير.
    assertOk(
      await invoke<Response>("bridge_request", {
        request: { cmd: "hello", protocol: PROTOCOL_VERSION, token, client: "tauri" },
      }),
    );
    this.opened = true;
  }
}

/**
 * محاكاة كاملة الطبقتين: عقد الأحداث نفسه، منع تكرار، تنفيذ قواعد. غرضها
 * AllowInterface تعمل قبل بناء Rust، وللبحث عن أخطاء منطق القواعد في المتصفح.
 */
export class MockBridge implements BridgeClient {
  readonly kind = "mock" as const;
  private readonly counts: Counts = {
    viewers: 0,
    likes: 0,
    gifts: 0,
    gift_value: 0,
    follows: 0,
    joins: 0,
    shares: 0,
    subscribes: 0,
    chats: 0,
    actions_executed: 0,
    actions_failed: 0,
    actions_retried: 0,
    events_seen: 0,
    events_deduplicated: 0,
  };
  private readonly state: AppState;
  private requestId = 0;
  private readonly seen = new Set<string>();
  private readonly outcomes: ActionOutcome[] = [];
  private readonly profiles: unknown[] = [];
  private readonly goals = new Map<string, number>();
  private readonly rules = new Map<string, Rule>();
  /** نوافذ المعدل لكل قاعدة: مطابقة لحالة `Engine::gates`. */
  private readonly gates = new Map<string, { hits: number; windowStartMs: number }>();

  constructor() {
    const now = Date.now();
    this.state = {
      app_version: "0.1.0-mock",
      protocol: 1,
      source: {
        connected: true,
        kind: "simulator",
        unique_id: "sim-uid",
        room_id: "sim-room",
        last_event_ms: now,
        last_error: null,
      },
      engine: {
        running: true,
        source_connected: true,
        last_error: null,
        counts: this.counts,
        session_started_ms: now,
        unique_id: "sim-uid",
        latency_ms: 0,
      },
      rule_count: 0,
      profile_count: 0,
      plan: "free",
    };
  }

  async send(request: Request): Promise<Response> {
    const request_id = `m${this.requestId++}`;
    const data = this.route(request);
    return { ok: true, request_id, data };
  }

  /** يمرر حدثاً كما لو جاء من مصدر حقيقي، ويطبّق القواعد المحفوظة. */
  pushEvent(event: LiveEvent): EngineReport {
    this.state.source.last_event_ms = event.received_ms;
    this.state.engine.latency_ms = Math.max(0, event.received_ms - event.ts_ms);
    if (this.seen.has(event.id)) {
      this.counts.events_deduplicated += 1;
      return { result: "duplicate" };
    }
    this.seen.add(event.id);
    this.counts.events_seen += 1;
    const payload = event.payload;
    if (payload.kind === "Gift") {
      this.counts.gifts += payload.data.count;
      this.counts.gift_value += payload.data.total_value;
    } else if (payload.kind === "Like") {
      this.counts.likes += payload.data.count;
    } else if (payload.kind === "Chat") {
      this.counts.chats += 1;
    } else if (payload.kind === "Follow") {
      this.counts.follows += 1;
    } else if (payload.kind === "Join") {
      this.counts.joins += 1;
    } else if (payload.kind === "Share") {
      this.counts.shares += 1;
    } else if (payload.kind === "Subscribe") {
      this.counts.subscribes += 1;
    }
    const fired: string[] = [];
    for (const rule of this.orderedRules()) {
      if (!rule.enabled || !matchesRule(rule, event)) continue;
      // نفس نافذة المحرك: ثابتة تبدأ من كل ضربة، وصفرية تعني بلا حد.
      if (!this.gateAllows(rule, event.received_ms)) continue;
      for (const spec of rule.actions) {
        this.outcomes.push({
          rule_id: rule.id,
          rule_name: rule.name,
          event_id: event.id,
          event_type: eventTypeName(event.event_type),
          nickname: event.user?.nickname ?? "",
          kind: spec.action.kind,
          detail: {},
        });
        this.counts.actions_executed += 1;
      }
      fired.push(rule.id);
    }
    if (fired.length === 0) return { result: "no_match", event_id: event.id };
    return { result: "matched", event_id: event.id, rules: fired };
  }

  /** نافذة معدل لكل قاعدة، مطابقة لـ`Engine::gate_allows` في Rust. */
  private gateAllows(rule: Rule, nowMs: number): boolean {
    const { max_hits: maxHits, window_ms: windowMs } = rule.rate;
    if (maxHits === 0 || windowMs <= 0) return true;
    const gate = this.gates.get(rule.id) ?? { hits: 0, windowStartMs: 0 };
    if (gate.windowStartMs === 0 || nowMs < gate.windowStartMs || nowMs - gate.windowStartMs > windowMs) {
      gate.windowStartMs = nowMs;
      gate.hits = 0;
    }
    if (gate.hits >= maxHits) {
      this.gates.set(rule.id, gate);
      return false;
    }
    gate.hits += 1;
    this.gates.set(rule.id, gate);
    return true;
  }

  private orderedRules(): Rule[] {
    return [...this.rules.values()].sort((a, b) => a.priority - b.priority);
  }

  private route(request: Request): unknown {
    switch (request.cmd) {
      case "hello":
      case "get_state":
        return this.state;
      case "list_rules":
        return this.orderedRules();
      case "upsert_rule":
        this.rules.set(request.rule.id, request.rule);
        // تعديل القاعدة يصفّر نافذتها، تماماً كما يفعل `Engine::replace_rules`.
        this.gates.delete(request.rule.id);
        this.state.rule_count = this.rules.size;
        return { count: this.rules.size };
      case "delete_rule": {
        const removed = this.rules.delete(request.id);
        this.gates.delete(request.id);
        this.state.rule_count = this.rules.size;
        return { removed };
      }
      case "test_rule": {
        const fired: string[] = [];
        // نجرّب كما ينفّذ المحرك: لا إجراءات لقاعدة لم يطابق الحدث شرطها.
        if (matchesRule(request.rule, request.event)) {
          fired.push(request.rule.id);
          for (const spec of request.rule.actions) {
            this.outcomes.push({
              rule_id: request.rule.id,
              rule_name: request.rule.name,
              event_id: request.event.id,
              event_type: eventTypeName(request.event.event_type),
              nickname: request.event.user?.nickname ?? "",
              kind: spec.action.kind,
              detail: { test: true },
            });
          }
        }
        const report: EngineReport = fired.length
          ? { result: "matched", event_id: request.event.id, rules: fired }
          : { result: "no_match", event_id: request.event.id };
        return {
          matched: fired.length > 0,
          report,
          explanations: explain(request.rule, request.event),
        };
      }
      case "push_event": {
        const report = this.pushEvent(request.event);
        return { report, counts: this.counts };
      }
      case "explain_rule": {
        const rule = this.rules.get(request.rule_id);
        if (!rule) return { error: `قاعدة غير معروفة: ${request.rule_id}` };
        return explain(rule, request.event);
      }
      case "get_diag":
        return { component: request.component, detail: { note: "محاكاة" } };
      case "get_action_history":
        return this.outcomes.slice(0, request.limit);
      case "get_event_history":
        return [];
      case "list_profiles":
        return this.profiles;
      case "set_goal": {
        const total = (this.goals.get(request.goal_id) ?? 0) + request.amount;
        this.goals.set(request.goal_id, total);
        return { goal: request.goal_id, total };
      }
      case "upsert_profile": {
        const id = (request.profile as { id?: unknown }).id;
        if (typeof id === "string" && id.length > 0) {
          this.profiles.splice(
            0,
            this.profiles.length,
            ...this.profiles.filter(
              (p) => (p as { id?: unknown }).id !== id,
            ),
            request.profile,
          );
        } else {
          this.profiles.push(request.profile);
        }
        this.state.profile_count = this.profiles.length;
        return { count: this.profiles.length };
      }
      default:
        return null;
    }
  }
}

/**
 * مُقيّم شروط مختصر للمتصفح. الغرض debugging للواجهة فقط؛ الحكم النهائي
 * في `lansher-core` بعد ربط Rust.
 */
function matchesRule(rule: Rule, event: LiveEvent): boolean {
  if (rule.trigger && eventTypeName(rule.trigger) !== eventTypeName(event.event_type)) {
    return false;
  }
  if (rule.conditions.length === 0) return true;
  const results = rule.conditions.map((c) => evaluate(c, event));
  return rule.group_op === "any" ? results.some(Boolean) : results.every(Boolean);
}

function evaluate(condition: Condition, event: LiveEvent): boolean {
  switch (condition.kind) {
    case "event_type_is":
      return condition.any_of.some(
        (t: EventType) => eventTypeName(t) === eventTypeName(event.event_type),
      );
    case "event_type_not":
      return !condition.any_of.some(
        (t: EventType) => eventTypeName(t) === eventTypeName(event.event_type),
      );
    case "value":
      return compare(event.payload.kind === "Gift" ? event.payload.data.total_value : numericValue(event), condition.op, condition.value, condition.value2 ?? null);
    case "repeat_count":
      return compare(repeatCount(event), condition.op, condition.value, condition.value2 ?? null);
    case "subject": {
      const subject = subjectOf(event);
      return subject === null ? false : subjectOp(condition.op, subject, condition.value, condition.values);
    }
    case "text": {
      const text = event.payload.kind === "Chat" ? event.payload.data.text : null;
      return text === null ? false : textOp(condition.op, text, condition.value);
    }
    case "nickname": {
      const name = event.user?.nickname ?? "";
      return textOp(condition.op, name, condition.value);
    }
    case "unique_id": {
      const id = event.user?.unique_id;
      return id ? textOp(condition.op, id, condition.value) : false;
    }
    case "is_follower":
      return matchBool(condition.expect, event.user?.is_follower);
    case "is_subscriber":
      return matchBool(condition.expect, event.user?.is_subscriber);
    case "chance":
      return chanceHit(event.id, condition.percent, condition.seed ?? null);
    case "and":
      return condition.conditions.length > 0 && condition.conditions.every((c) => evaluate(c, event));
    case "or":
      return condition.conditions.some((c) => evaluate(c, event));
    case "not":
      return !evaluate(condition.condition, event);
    default:
      return false;
  }
}

/** قيمة الحدث كما يعرّفها `Payload::numeric_value` في Rust. */
function numericValue(event: LiveEvent): number {
  if (event.payload.kind === "Gift") {
    return event.payload.data.count * event.payload.data.value_per_unit;
  }
  if (event.payload.kind === "Like") return event.payload.data.count;
  return 0;
}

/** `Payload::repeat_count`: عدد الهدايا أو الإعجابات، و1 لغيرها. */
function repeatCount(event: LiveEvent): number {
  if (event.payload.kind === "Gift" || event.payload.kind === "Like") {
    return event.payload.data.count;
  }
  return 1;
}

/** `Payload::subject`: اسم الهدية أو نوع العضوية. */
function subjectOf(event: LiveEvent): string | null {
  if (event.payload.kind === "Gift") return event.payload.data.name;
  if (event.payload.kind === "Subscribe") return event.payload.data?.tier ?? null;
  return null;
}

function compare(left: number, op: string, right: number, right2: number | null): boolean {
  switch (op) {
    case "eq":
      return left === right;
    case "ne":
      return left !== right;
    case "gt":
      return left > right;
    case "gte":
      return left >= right;
    case "lt":
      return left < right;
    case "lte":
      return left <= right;
    case "between":
      return right2 === null ? left === right : left >= right && left <= right2;
    case "in":
      return right2 === null ? left === right : false;
    case "contains":
      return String(left).includes(String(right));
    case "starts_with":
      return String(left).startsWith(String(right));
    case "ends_with":
      return String(left).endsWith(String(right));
    default:
      return false;
  }
}

function subjectOp(op: string, left: string, right: string, values: string[]): boolean {
  if (op === "in") {
    const lower = left.toLowerCase();
    return values.some((v) => v.toLowerCase() === lower) || right.toLowerCase() === lower;
  }
  return textOp(op, left, right);
}

function matchBool(expect: "true" | "false" | "any", value: boolean | null | undefined): boolean {
  if (expect === "any") return true;
  if (value === null || value === undefined) return false;
  return value === (expect === "true");
}

function textOp(op: string, haystack: string, needle: string): boolean {
  const left = haystack.toLowerCase();
  const right = needle.toLowerCase();
  switch (op) {
    case "eq":
      return left === right;
    case "ne":
      return left !== right;
    case "contains":
      return left.includes(right);
    case "starts_with":
      return left.startsWith(right);
    case "ends_with":
      return left.endsWith(right);
    case "matches":
      return wildcardMatch(right, left);
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      // Rust يستعمل `parse::<i64>`: يقبل الصحيح فقط ويرفض الكسر.
      // `Number` كان يقبل "1.5" فيختلفان على نفس القاعدة.
      const a = parseI64(left);
      const b = parseI64(right);
      if (a === null || b === null) return false;
      return compare(a, op, b, null);
    }
    case "between":
    case "in":
      return false;
    default:
      return false;
  }
}

/** محاكاة `str::parse::<i64>`: صحيح فقط، بلا كسر ولا رمز أُس. */
function parseI64(text: string): number | null {
  if (!/^[+-]?\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}

/** نمط بمحدّدات `*` فقط. النص العادي = احتواء، والمقارنة غير حسّاسة لحالة الأحرف. */
function wildcardMatch(pattern: string, text: string): boolean {
  if (pattern.length === 0) return false;
  const anchoredStart = !pattern.startsWith("*");
  const anchoredEnd = !pattern.endsWith("*");
  const segments = pattern.split("*").filter((s) => s.length > 0);
  if (segments.length === 0) return true;
  let cursor = 0;
  for (const [index, segment] of segments.entries()) {
    const at = text.indexOf(segment, cursor);
    if (at < 0) return false;
    if (index === 0 && anchoredStart && at !== 0) return false;
    cursor = at + segment.length;
  }
  if (anchoredEnd && cursor !== text.length) return false;
  return true;
}

/**
 * نتيجة شرط `chance` مطابقة لـ`chance_hit` في Rust بايتاً ببايت.
 *
 * الفروق الثلاثة التي كانت تفصل المحاكاة عن النواة:
 * 1. Rust يستعمل 64-bit لا 32-bit، فنستخدم `BigInt` بدل `Math.imul`.
 * 2. الترتيب: معرّف الحدث أولاً ثم البذرة، لا العكس.
 * 3. البذرة 8 بايت little-endian، و`charCodeAt` يعطي UTF-16 لا UTF-8،
 *    فنمرر بايتات `TextEncoder` كما يفعل `as_bytes()` في Rust.
 */
function chanceHit(eventId: string, percent: number, seed: number | null): boolean {
  if (percent <= 0) return false;
  if (percent >= 100) return true;
  const mask = (1n << 64n) - 1n;
  const prime = 0x100000001b3n;
  let hash = 0xcbf29ce484222325n;
  const feed = (bytes: Uint8Array) => {
    for (const byte of bytes) {
      hash = (hash ^ BigInt(byte)) & mask;
      hash = (hash * prime) & mask;
    }
  };
  feed(new TextEncoder().encode(eventId));
  if (seed !== null && seed !== undefined) {
    const bytes = new Uint8Array(8);
    let value = BigInt(Math.trunc(seed));
    for (let index = 0; index < 8; index += 1) {
      bytes[index] = Number(value & 0xffn);
      value >>= 8n;
    }
    feed(bytes);
  }
  return Number(hash % 100n) < percent;
}

function explain(rule: Rule, event: LiveEvent): { label: string; passed: boolean }[] {
  return rule.conditions.map((condition) => ({
    label: condition.kind,
    passed: evaluate(condition, event),
  }));
}

export function createBridge(): BridgeClient {
  // Tauri 2 يحقن `__TAURI_INTERNALS__` دائماً، أما `__TAURI__` فيحتاج
  // `withGlobalTauri` في الإعدادات، والاعتماد عليه يجعل التطبيق يسقط إلى
  // المحاكاة داخل نافذة الإنتاج.
  const injected = (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  return injected ? new TauriBridge() : new MockBridge();
}
