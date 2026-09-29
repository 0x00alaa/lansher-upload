// نسخة TypeScript من عقد Rust. أي تغيير في `crates/lansher-core/src/event.rs`
// أو `rule.rs` ينعكس هنا، لأن الواجهة تعرض نفس الأسماء ونفس قيم JSON.

export type Millis = number;

/**
 * مطابق تماماً لـ serde في `crates/lansher-core/src/event.rs`:
 * `#[serde(tag = "kind", content = "name")]`. لذلك النوع وحدة هو
 * `{ "kind": "Gift" }` وليس `"Gift"`.
 */
export type EventTypeName =
  | "Chat"
  | "Gift"
  | "Like"
  | "Follow"
  | "Share"
  | "Join"
  | "Subscribe"
  | "StreamStart"
  | "StreamEnd";

export type EventType = { kind: EventTypeName } | { kind: "Custom"; name: string };

export function eventType(kind: EventTypeName): EventType {
  return { kind };
}

export function eventTypeName(value: EventType): string {
  return value.kind === "Custom" ? value.name : value.kind;
}

export interface User {
  nickname: string;
  unique_id?: string | null;
  is_follower?: boolean | null;
  is_subscriber?: boolean | null;
  avatar?: string | null;
}

export type Payload =
  | { kind: "Chat"; data: { text: string } }
  | { kind: "Like"; data: { count: number } }
  | {
      kind: "Gift";
      data: {
        gift_id?: string | null;
        name: string;
        count: number;
        value_per_unit: number;
        total_value: number;
      };
    }
  | { kind: "Follow" }
  | { kind: "Share" }
  | { kind: "Join" }
  | { kind: "Subscribe"; data?: { tier?: string | null } }
  | {
      kind: "StreamStart";
      data: { unique_id: string; title?: string | null };
    }
  | { kind: "StreamEnd"; data: { unique_id: string; duration_ms: number } }
  | { kind: "Custom"; data: Record<string, unknown> };

export interface LiveEvent {
  id: string;
  event_type: EventType;
  ts_ms: Millis;
  received_ms: Millis;
  source: string;
  user?: User | null;
  payload: Payload;
  raw?: unknown;
}

export type CompareOp =
  | "eq"
  | "ne"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "between"
  | "contains"
  | "starts_with"
  | "ends_with"
  | "matches"
  | "in";

export type GroupOp = "all" | "any";
export type BoolExpectation = "true" | "false" | "any";
export type QueueMode = "immediate" | "serial" | "bounded";
export type OnError = "continue" | "abort" | "retry";
export type GoalMode = "event" | "fixed";

export type Condition =
  | { kind: "event_type_is"; any_of: EventType[] }
  | { kind: "event_type_not"; any_of: EventType[] }
  | { kind: "value"; op: CompareOp; value: number; value2?: number | null }
  | { kind: "repeat_count"; op: CompareOp; value: number; value2?: number | null }
  | { kind: "subject"; op: CompareOp; value: string; values: string[] }
  | { kind: "text"; op: CompareOp; value: string }
  | { kind: "nickname"; op: CompareOp; value: string }
  | { kind: "unique_id"; op: CompareOp; value: string }
  | { kind: "is_follower"; expect: BoolExpectation }
  | { kind: "is_subscriber"; expect: BoolExpectation }
  | { kind: "chance"; percent: number; seed?: number | null }
  | { kind: "and"; conditions: Condition[] }
  | { kind: "or"; conditions: Condition[] }
  | { kind: "not"; condition: Condition };

export type Action =
  | { kind: "play_sound"; file_id: string; volume?: number | null }
  | { kind: "speak"; text: string; voice?: string | null; rate?: number | null }
  | { kind: "alert"; title: string; image?: string | null; duration_ms?: number | null }
  | { kind: "add_to_goal"; goal_id: string; amount?: number | null; mode?: GoalMode | null }
  | { kind: "send_chat"; text: string }
  | { kind: "webhook"; url: string; method?: string | null; include_event?: boolean | null }
  | {
      kind: "integration";
      target: string;
      command: string;
      args: Record<string, string>;
    }
  | { kind: "log"; text: string }
  | { kind: "none" };

export interface ActionSpec {
  action: Action;
  timeout_ms: number;
  delay_after_ms: number;
  on_error: OnError;
}

export interface RateGate {
  max_hits: number;
  window_ms: number;
}

export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  trigger?: EventType | null;
  group_op?: GroupOp | null;
  conditions: Condition[];
  rate: RateGate;
  queue: QueueMode;
  max_concurrent: number;
  start_delay_ms: number;
  actions: ActionSpec[];
}

export interface Counts {
  /** يرسلها المصدر كحالة دورية، وليس كحدث. */
  viewers: number;
  likes: number;
  gifts: number;
  gift_value: number;
  follows: number;
  joins: number;
  shares: number;
  subscribes: number;
  chats: number;
  actions_executed: number;
  actions_failed: number;
  /** محاولات إضافية بسبب `on_error: "retry"`. */
  actions_retried: number;
  events_seen: number;
  events_deduplicated: number;
}

export interface EngineState {
  running: boolean;
  source_connected: boolean;
  last_error: string | null;
  counts: Counts;
  session_started_ms: number | null;
  unique_id: string | null;
  latency_ms: number | null;
}

export interface SourceStatus {
  connected: boolean;
  kind: string;
  unique_id: string | null;
  room_id: string | null;
  last_event_ms: number | null;
  last_error: string | null;
}

export interface AppState {
  app_version: string;
  protocol: number;
  source: SourceStatus;
  engine: EngineState;
  rule_count: number;
  profile_count: number;
  plan: string;
}

export interface ActionOutcome {
  rule_id: string;
  rule_name: string;
  event_id: string;
  event_type: string;
  nickname: string;
  kind: string;
  detail: Record<string, unknown>;
}

export interface Explanation {
  label: string;
  passed: boolean;
}

/** مطابق لـ `EngineReport` في `crates/lansher-core/src/engine.rs`. */
export type EngineReport =
  | { result: "duplicate" }
  | { result: "no_match"; event_id: string }
  | { result: "matched"; event_id: string; rules: string[] };

export type Request =
  | { cmd: "hello"; protocol: number; token: string; client: string }
  | { cmd: "get_state" }
  | { cmd: "list_rules" }
  | { cmd: "upsert_rule"; rule: Rule }
  | { cmd: "delete_rule"; id: string }
  | { cmd: "test_rule"; rule: Rule; event: LiveEvent }
  | { cmd: "push_event"; event: LiveEvent }
  | { cmd: "get_event_history"; limit: number }
  | { cmd: "get_action_history"; limit: number }
  | { cmd: "explain_rule"; rule_id: string; event: LiveEvent }
  | { cmd: "list_profiles" }
  | { cmd: "upsert_profile"; profile: unknown }
  | { cmd: "set_goal"; goal_id: string; amount: number }
  | { cmd: "get_diag"; component: string };

export interface BridgeErrorPayload {
  /** رمز ثابت للاستهلاك الآلي، مطابق لـ `BridgeError::code` في Rust. */
  code:
    | "unauthorized"
    | "unsupported_protocol"
    | "unknown_request"
    | "source_offline"
    | "forbidden"
    | "internal";
  /** رسالة عربية للعرض فقط. */
  message: string;
}

export interface Response {
  ok: boolean;
  request_id: string;
  data?: unknown;
  error?: BridgeErrorPayload;
}
