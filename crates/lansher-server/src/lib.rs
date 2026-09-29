//! الجسر المحلي: مصادقة، بث أحداث، تنفيذ إجراءات، ودورة حياة بلا إطار عمل.
//!
//! الغرض أن يكون هذا الملف منطقاً خالصاً قابلاً للاختبار، ويلتفّ حوله Tauri
//! في `apps/desktop` بطبقة أوامر رفيعة. لا يستورد Tauri هنا إطلاقاً.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use hmac::{Hmac, Mac};
use lansher_core::engine::{ActionExecutor, DryRunExecutor, Engine, EngineReport, Explanation};
use lansher_core::event::LiveEvent;
use lansher_core::rule::{Action, Rule};
use lansher_core::{Millis, RuleSet};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

pub const APP_NAME: &str = "lansher";
pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
/// إصدار بروتوكول الجسر. الواجهة ترفض الاتصال عند اختلافه.
pub const PROTOCOL_VERSION: u32 = 1;

pub fn now_ms() -> Millis {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// بادئات رسائل `BridgeError`. نستخدمها في العرض والتحليل معاً، فلا يفترق
/// النص عن المُرمِّز ولا يفقد التفصيل في الذهاب والإياب.
const PROTOCOL_MESSAGE_PREFIX: &str = "إصدار البروتوكول غير مدعوم: ";
const UNKNOWN_REQUEST_MESSAGE_PREFIX: &str = "طلب غير معروف: ";
const FORBIDDEN_MESSAGE_PREFIX: &str = "أمر غير مسموح: ";
const INTERNAL_MESSAGE_PREFIX: &str = "خطأ داخلي: ";

/// يفصل التفصيل عن الرسالة المعروضة. إن غابت البادئة نُبقي الرسالة كما
/// هي، فلا نفقد بيانات ولا نرفض خطأ جاء من طرف آخر.
fn strip_detail<'a>(message: &'a str, prefix: &str) -> &'a str {
    message.strip_prefix(prefix).unwrap_or(message).trim()
}

#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum BridgeError {
    #[error("رمز الدخول غير صالح أو منتهٍ")]
    Unauthorized,
    #[error("{PROTOCOL_MESSAGE_PREFIX}{0}")]
    Protocol(u32),
    #[error("{UNKNOWN_REQUEST_MESSAGE_PREFIX}{0}")]
    UnknownRequest(String),
    #[error("المصدر غير متصل")]
    SourceOffline,
    #[error("{FORBIDDEN_MESSAGE_PREFIX}{0}")]
    Forbidden(String),
    #[error("{INTERNAL_MESSAGE_PREFIX}{0}")]
    Internal(String),
}

impl BridgeError {
    /// رمز ثابت للاستهلاك الآلي، لا يُترجم، وتبني عليه الواجهة سجلاتها.
    pub fn code(&self) -> &'static str {
        match self {
            Self::Unauthorized => "unauthorized",
            Self::Protocol(_) => "unsupported_protocol",
            Self::UnknownRequest(_) => "unknown_request",
            Self::SourceOffline => "source_offline",
            Self::Forbidden(_) => "forbidden",
            Self::Internal(_) => "internal",
        }
    }
}

/// خطأ الجسر في JSON: `{"code": "...", "message": "..."}`.
/// الرسالة عربية للعرض، والرمز للاستهلاك الآلي.
impl Serialize for BridgeError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("BridgeError", 2)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

impl<'de> Deserialize<'de> for BridgeError {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        struct Raw {
            code: String,
            #[serde(default)]
            message: String,
        }
        let raw = Raw::deserialize(deserializer)?;
        let detail = raw.message;
        Ok(match raw.code.as_str() {
            "unauthorized" => Self::Unauthorized,
            // الرقم والتفاصيل تُستخرج من الرسالة نفسها: عقد الخطأ حقلان
            // فقط (`code` و`message`)، فلا حقل ثالث للتفصيل. لولا القصّ
            // لفقدنا كل تفصيل في الذهاب والإياب.
            "unsupported_protocol" => Self::Protocol(
                strip_detail(&detail, PROTOCOL_MESSAGE_PREFIX)
                    .parse::<u32>()
                    .unwrap_or(0),
            ),
            "unknown_request" => {
                Self::UnknownRequest(strip_detail(&detail, UNKNOWN_REQUEST_MESSAGE_PREFIX).into())
            }
            "source_offline" => Self::SourceOffline,
            "forbidden" => Self::Forbidden(strip_detail(&detail, FORBIDDEN_MESSAGE_PREFIX).into()),
            _ => Self::Internal(strip_detail(&detail, INTERNAL_MESSAGE_PREFIX).into()),
        })
    }
}

/// رسالة الطلب: كل ما تأتي به الواجهة يمر من هنا.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
pub enum Request {
    Hello {
        protocol: u32,
        token: String,
        client: String,
    },
    GetState,
    ListRules,
    UpsertRule {
        rule: Rule,
    },
    DeleteRule {
        id: String,
    },
    TestRule {
        rule: Rule,
        event: LiveEvent,
    },
    /// إدخال حدث في المحرك الحيّ. يستخدمه الموصل الجانبي ومحرّك الأحداث،
    /// فيمرّ الحدث بالمصادقة ونافذة منع التكرار والإجراءات نفسها.
    PushEvent {
        event: LiveEvent,
    },
    GetEventHistory {
        limit: usize,
    },
    GetActionHistory {
        limit: usize,
    },
    ExplainRule {
        rule_id: String,
        event: LiveEvent,
    },
    ListProfiles,
    UpsertProfile {
        profile: serde_json::Value,
    },
    SetGoal {
        goal_id: String,
        amount: i64,
    },
    GetDiag {
        component: String,
    },
}

/// ردّ على كل طلب: نفس البنية دائماً، فيقرأ الكود البسيط في الواجهة.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Response {
    pub ok: bool,
    pub request_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<BridgeError>,
}

impl Response {
    fn ok(request_id: &str, data: serde_json::Value) -> Self {
        Self {
            ok: true,
            request_id: request_id.to_string(),
            data: Some(data),
            error: None,
        }
    }

    fn fail(request_id: &str, error: impl Into<BridgeError>) -> Self {
        Self {
            ok: false,
            request_id: request_id.to_string(),
            data: None,
            error: Some(error.into()),
        }
    }
}

/// من يسمع على أحداث المصدر: منفذ الإجراءات الحقيقي.
pub trait EventSink: Send {
    fn on_event(&mut self, event: &LiveEvent);
}

impl<F: FnMut(&LiveEvent) + Send> EventSink for F {
    fn on_event(&mut self, event: &LiveEvent) {
        self(event)
    }
}

/// منفذ إجراءات حقيقي. نبدأ بتسجيل الخطوات الواردة، ثم يربطها Tauri
/// بمشغّلات الصوت والنطق و OBS.
#[derive(Default)]
pub struct Executors {
    played_sounds: Vec<String>,
    spoken: Vec<String>,
    alerts: Vec<String>,
    chats: Vec<String>,
    webhooks: Vec<String>,
    integrations: Vec<String>,
    logs: Vec<String>,
}

impl ActionExecutor for Executors {
    fn execute(
        &mut self,
        rule: &Rule,
        event: &LiveEvent,
        action: &Action,
    ) -> Result<serde_json::Value, String> {
        let outcome = match action {
            Action::PlaySound { file_id, .. } => {
                self.played_sounds.push(file_id.clone());
                serde_json::json!({ "sound": file_id })
            }
            Action::Speak { text, .. } => {
                self.spoken.push(text.clone());
                serde_json::json!({ "spoken": text })
            }
            Action::Alert { title, .. } => {
                self.alerts.push(title.clone());
                serde_json::json!({ "alert": title })
            }
            Action::AddToGoal {
                goal_id,
                amount,
                mode,
            } => {
                let amount = resolve_goal_amount(event, *amount, *mode);
                serde_json::json!({ "goal": goal_id, "amount": amount })
            }
            Action::SendChat { text } => {
                self.chats.push(text.clone());
                serde_json::json!({ "chat": text })
            }
            Action::Webhook { url, .. } => {
                self.webhooks.push(url.clone());
                serde_json::json!({ "webhook": url })
            }
            Action::Integration {
                target, command, ..
            } => {
                self.integrations.push(format!("{target}:{command}"));
                serde_json::json!({ "integration": target, "command": command })
            }
            Action::Log { text } => {
                self.logs.push(text.clone());
                serde_json::json!({ "log": text })
            }
            Action::None => serde_json::json!({ "noop": true }),
        };
        let _ = rule;
        Ok(outcome)
    }
}

fn resolve_goal_amount(
    event: &LiveEvent,
    amount: Option<i64>,
    mode: Option<lansher_core::GoalMode>,
) -> i64 {
    match mode.unwrap_or(lansher_core::GoalMode::Event) {
        lansher_core::GoalMode::Event => amount.unwrap_or_else(|| event.payload.numeric_value()),
        lansher_core::GoalMode::Fixed => amount.unwrap_or(0),
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SourceStatus {
    pub connected: bool,
    pub kind: String,
    pub unique_id: Option<String>,
    pub room_id: Option<String>,
    pub last_event_ms: Option<Millis>,
    pub last_error: Option<String>,
}

/// حالة البث التي تراها الواجهة.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BroadcastState {
    pub app_version: String,
    pub protocol: u32,
    pub source: SourceStatus,
    pub engine: lansher_core::engine::EngineState,
    pub rule_count: usize,
    pub profile_count: usize,
    pub plan: String,
}

pub struct Bridge {
    engine: Engine,
    rules: HashMap<String, Rule>,
    executors: Executors,
    request_counter: AtomicU64,
    source: SourceStatus,
    event_history: Vec<LiveEvent>,
    profiles: Vec<serde_json::Value>,
    goals: HashMap<String, i64>,
    auth: AuthGate,
}

impl Bridge {
    pub fn new() -> Self {
        let mut engine = Engine::new(Vec::new());
        // المحرك يعمل من الإقلاع: الجسر هو العملية الحقيقية، لا ننتظر ربط
        // مصدر حتى تصير الحالة `running` في الواجهة صادقة.
        engine.start(now_ms(), None);
        Self {
            engine,
            rules: HashMap::new(),
            executors: Executors::default(),
            request_counter: AtomicU64::new(0),
            source: SourceStatus {
                connected: false,
                kind: "none".into(),
                unique_id: None,
                room_id: None,
                last_event_ms: None,
                last_error: None,
            },
            event_history: Vec::new(),
            profiles: Vec::new(),
            goals: HashMap::new(),
            auth: AuthGate::new(),
        }
    }

    pub fn engine(&self) -> &Engine {
        &self.engine
    }

    /// رمز ملكة واحد يُمرَّر للواجهة عبر أمر Tauri. لا يُكتب على القرص.
    pub fn auth_token(&self) -> Option<String> {
        self.auth.token().map(str::to_string)
    }

    pub fn executors_mut(&mut self) -> &mut Executors {
        &mut self.executors
    }

    pub fn source_status(&self) -> &SourceStatus {
        &self.source
    }

    pub fn attach_rules(&mut self, rules: Vec<Rule>) {
        for rule in &rules {
            self.rules.insert(rule.id.clone(), rule.clone());
        }
        self.engine.replace_rules(rules);
    }

    pub fn source_attached(
        &mut self,
        kind: &str,
        unique_id: Option<String>,
        room_id: Option<String>,
    ) {
        self.source.kind = kind.to_string();
        self.source.unique_id = unique_id.clone();
        self.source.room_id = room_id;
        self.source.connected = true;
        self.source.last_error = None;
        self.engine.set_source_connected(true);
        // ربط مصدر هو بداية جلسة بث جديدة: نبدأ زمن الجلسة ونضع المعرّف،
        // ونصفّر عدّادات الجلسة السابقة.
        self.engine.reset_session(now_ms(), unique_id);
    }

    pub fn source_detached(&mut self, reason: Option<String>) {
        self.source.connected = false;
        self.source.last_error = reason.clone();
        self.engine.set_source_connected(false);
        if let Some(reason) = reason {
            self.engine.set_error(Some(reason));
        }
    }

    /// نقطة الدخول الوحيدة للأحداث من أي مصدر: متصفح، جهاز، أو محاكي اختبار.
    pub fn push_event(&mut self, event: LiveEvent, sink: &mut dyn EventSink) -> EngineReport {
        sink.on_event(&event);
        self.source.last_event_ms = Some(event.received_ms);
        if self.event_history.len() < 2_000 {
            self.event_history.push(event.clone());
        } else {
            self.event_history.remove(0);
            self.event_history.push(event.clone());
        }
        self.engine.ingest(&event, &mut self.executors)
    }

    pub fn handle(&mut self, request: Request) -> Response {
        let request_id = format!("r{}", self.request_counter.fetch_add(1, Ordering::SeqCst));
        if let Request::Hello {
            protocol,
            ref token,
            ref client,
        } = request
        {
            if protocol != PROTOCOL_VERSION {
                return Response::fail(&request_id, BridgeError::Protocol(protocol));
            }
            if let Err(error) = self.auth.verify(token, client) {
                return Response::fail(&request_id, error);
            }
            return Response::ok(
                &request_id,
                serde_json::json!({
                    "app_version": APP_VERSION,
                    "protocol": PROTOCOL_VERSION,
                    "session": self.auth.session_summary(),
                }),
            );
        }
        if !self.auth.is_open() {
            return Response::fail(&request_id, BridgeError::Unauthorized);
        }

        match request {
            Request::Hello { .. } => unreachable!("عولج أعلاه"),
            Request::GetState => Response::ok(&request_id, self.state_json()),
            Request::ListRules => Response::ok(
                &request_id,
                serde_json::json!(RuleSet::new(self.rules.values().cloned().collect()).rules()),
            ),
            Request::UpsertRule { rule } => {
                self.rules.insert(rule.id.clone(), rule);
                self.engine.replace_rules(self.ordered_rules());
                Response::ok(
                    &request_id,
                    serde_json::json!({ "count": self.rules.len() }),
                )
            }
            Request::DeleteRule { id } => {
                let removed = self.rules.remove(&id).is_some();
                self.engine.replace_rules(self.ordered_rules());
                Response::ok(&request_id, serde_json::json!({ "removed": removed }))
            }
            Request::TestRule { rule, event } => {
                // القواعد تُختبر في محرك معزول حتى لا تُحمّل القاعدة غير
                // المحفوظة على المحرك الحيّ ولا تُنفّذ إجراءاتها.
                let mut dry = Engine::new(vec![rule.clone()]);
                let passed = rule.matches(&event);
                let report = dry.ingest(&event, &mut DryRunExecutor::default());
                let explanations = dry.explain(&rule.id, &event);
                Response::ok(
                    &request_id,
                    serde_json::json!({
                        "matched": passed,
                        "report": report,
                        "explanations": explanations,
                    }),
                )
            }
            Request::PushEvent { event } => {
                let mut sink = |_: &LiveEvent| {};
                let report = self.push_event(event, &mut sink);
                Response::ok(
                    &request_id,
                    serde_json::json!({
                        "report": report,
                        "counts": self.engine.state().counts,
                    }),
                )
            }
            Request::GetEventHistory { limit } => {
                let slice: Vec<&LiveEvent> = self.event_history.iter().rev().take(limit).collect();
                Response::ok(&request_id, serde_json::json!(slice))
            }
            Request::GetActionHistory { limit } => Response::ok(
                &request_id,
                serde_json::json!(self.engine.recent_outcomes(limit)),
            ),
            Request::ExplainRule { rule_id, event } => {
                let explanations: Vec<Explanation> = self.engine.explain(&rule_id, &event);
                Response::ok(&request_id, serde_json::json!(explanations))
            }
            Request::ListProfiles => Response::ok(&request_id, serde_json::json!(self.profiles)),
            Request::UpsertProfile { profile } => {
                let id = profile
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                if id.is_empty() {
                    return Response::fail(
                        &request_id,
                        BridgeError::UnknownRequest("ملف بلا معرّف".into()),
                    );
                }
                self.profiles
                    .retain(|p| p.get("id").and_then(|v| v.as_str()) != Some(&id));
                self.profiles.push(profile);
                Response::ok(
                    &request_id,
                    serde_json::json!({ "count": self.profiles.len() }),
                )
            }
            Request::SetGoal { goal_id, amount } => {
                // `goal_id` ينتقل إلى `entry`، والرد يحتاج اسمه، فننسخ
                // الاسم قبل النقل بدل استعارته بعده.
                let name = goal_id.clone();
                let total = self.goals.entry(goal_id).or_insert(0);
                *total += amount;
                Response::ok(
                    &request_id,
                    serde_json::json!({ "goal": name, "total": *total }),
                )
            }
            Request::GetDiag { component } => {
                Response::ok(&request_id, self.diagnostics(&component))
            }
        }
    }

    fn ordered_rules(&self) -> Vec<Rule> {
        RuleSet::new(self.rules.values().cloned().collect())
            .rules()
            .to_vec()
    }

    fn state_json(&self) -> serde_json::Value {
        let state = BroadcastState {
            app_version: APP_VERSION.into(),
            protocol: PROTOCOL_VERSION,
            source: self.source.clone(),
            engine: self.engine.state().clone(),
            rule_count: self.rules.len(),
            profile_count: self.profiles.len(),
            plan: "free".into(),
        };
        serde_json::to_value(state).unwrap_or(serde_json::Value::Null)
    }

    /// تقرير تشخيصي: خطوة ناضجة تعطي بيانات مفيدة أكثر من رسالة عامة.
    fn diagnostics(&self, component: &str) -> serde_json::Value {
        let mut report = serde_json::json!({
            "component": component,
            "app_version": APP_VERSION,
            "protocol": PROTOCOL_VERSION,
            "source": self.source,
            "counts": self.engine.state().counts,
        });
        let detail = match component {
            "audio" => serde_json::json!({
                "engine": "auto",
                "devices": self.executors.played_sounds,
                "note": "التشغيل الحقيقي يحتاج جهاز إخراج في عملية Tauri",
            }),
            "tts" => serde_json::json!({
                "spoken": self.executors.spoken,
                "voices": "اختيار الصوت يتم في الواجهة",
            }),
            "obs" => serde_json::json!({
                "alerts": self.executors.alerts,
                "websocket": "غير موصول بعد",
            }),
            "integrations" => serde_json::json!({
                "webhooks": self.executors.webhooks,
                "commands": self.executors.integrations,
            }),
            "events" => serde_json::json!({
                "history_len": self.event_history.len(),
                "duplicates": self.engine.state().counts.events_deduplicated,
            }),
            _ => serde_json::json!({ "hint": "مكوّن غير معروف" }),
        };
        report
            .as_object_mut()
            .map(|map| map.insert("detail".into(), detail));
        report
    }
}

impl Default for Bridge {
    fn default() -> Self {
        Self::new()
    }
}

/// بوابة مصادقة: رمز ملكية.
///
/// نبدأ برمز مولّد عند الإقلاع ونمرّره إلى Tauri كمتغير بيئة، فلا يُكتب
/// على القرص ولا يظهر في سطر الأوامر. في مرحلة السحابة يُستبدل هذا بتخويل
/// PostgREST مع «PIP + WebAuthn».
pub struct AuthGate {
    token: Option<String>,
    client: Option<String>,
    verified_clients: Vec<String>,
    opened_at_ms: Option<Millis>,
}

impl AuthGate {
    pub fn new() -> Self {
        Self {
            token: Some(new_token()),
            client: None,
            verified_clients: Vec::new(),
            opened_at_ms: None,
        }
    }

    pub fn token(&self) -> Option<&str> {
        self.token.as_deref()
    }

    pub fn is_open(&self) -> bool {
        !self.verified_clients.is_empty()
    }

    pub fn session_summary(&self) -> serde_json::Value {
        serde_json::json!({
            "clients": self.verified_clients,
            "opened_at_ms": self.opened_at_ms,
            "uptime_ms": self.opened_at_ms.map(|t| now_ms() - t),
        })
    }

    pub fn verify(&mut self, token: &str, client: &str) -> Result<(), BridgeError> {
        let expected = self.token.as_deref().ok_or(BridgeError::Unauthorized)?;
        if !constant_time_eq(expected.as_bytes(), token.as_bytes()) {
            return Err(BridgeError::Unauthorized);
        }
        if self.client.is_none() {
            self.client = Some(client.to_string());
        } else if self.client.as_deref() != Some(client) {
            // جهازان يستعملان الرمز نفسه: نرفض حتى لا تتسرب الجلسة.
            return Err(BridgeError::Forbidden("عميل آخر موصول".into()));
        }
        if !self.verified_clients.iter().any(|c| c == client) {
            self.verified_clients.push(client.to_string());
        }
        if self.opened_at_ms.is_none() {
            self.opened_at_ms = Some(now_ms());
        }
        Ok(())
    }
}

impl Default for AuthGate {
    fn default() -> Self {
        Self::new()
    }
}

pub fn new_token() -> String {
    let id = uuid::Uuid::new_v4();
    URL_SAFE_NO_PAD.encode(id.as_bytes())
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let left = keyed_digest(a);
    let right = keyed_digest(b);
    constant_time_equal(&left[..], &right[..])
}

/// تجزئة بمفتاح ثابت، لتوحيد زمن المقارنة وإخفاء طول المدخل.
fn keyed_digest(data: &[u8]) -> [u8; 32] {
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(&[0u8; 32]).expect("مفتاح HMAC بطول صالح");
    mac.update(data);
    mac.finalize().into_bytes().into()
}

fn constant_time_equal(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// توقيع الحمولة: نتحقق من مصدر الأحداث الداخلي قبل التنفيذ.
pub fn sign_payload(secret: &str, payload: &[u8]) -> String {
    let mut mac =
        <Hmac<Sha256> as Mac>::new_from_slice(secret.as_bytes()).expect("مفتاح HMAC بطول غير صالح");
    mac.update(payload);
    URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
}

pub fn verify_payload(secret: &str, payload: &[u8], signature: &str) -> bool {
    let expected = sign_payload(secret, payload);
    constant_time_equal(expected.as_bytes(), signature.as_bytes())
}

/// نسخة مختصرة من HMAC لاختبارات السطح العام.
pub fn hmac_hex(secret: &str, payload: &[u8]) -> String {
    sign_payload(secret, payload)
}

#[cfg(test)]
mod tests {
    use super::*;
    use lansher_core::event::User;

    fn bridge_with_token() -> (Bridge, String) {
        let bridge = Bridge::new();
        let token = bridge.auth.token().unwrap().to_string();
        (bridge, token)
    }

    fn hello(token: &str) -> Request {
        Request::Hello {
            protocol: PROTOCOL_VERSION,
            token: token.to_string(),
            client: "test".into(),
        }
    }

    #[test]
    fn hello_with_correct_token_opens_session() {
        let (mut bridge, token) = bridge_with_token();
        assert!(!bridge.auth.is_open(), "لا جلسة قبل Hello");
        let response = bridge.handle(hello(&token));
        assert!(response.ok);
        assert!(bridge.auth.is_open(), "Hello الصحيح يفتح الجلسة");
        let second = bridge.handle(Request::GetState);
        assert!(second.ok, "الجلسة مفتوحة بعد Hello صحيح");
    }

    #[test]
    fn wrong_token_is_rejected() {
        let (mut bridge, _) = bridge_with_token();
        let response = bridge.handle(hello("wrong"));
        assert!(!response.ok);
        assert!(matches!(response.error, Some(BridgeError::Unauthorized)));
    }

    #[test]
    fn wrong_protocol_is_rejected_before_token() {
        let (mut bridge, token) = bridge_with_token();
        let response = bridge.handle(Request::Hello {
            protocol: 99,
            token,
            client: "test".into(),
        });
        assert!(matches!(response.error, Some(BridgeError::Protocol(99))));
    }

    #[test]
    fn requests_before_hello_are_rejected() {
        let (mut bridge, _) = bridge_with_token();
        let response = bridge.handle(Request::GetState);
        assert!(!response.ok);
    }

    #[test]
    fn second_client_with_same_token_is_forbidden() {
        let (mut bridge, token) = bridge_with_token();
        assert!(bridge.handle(hello(&token)).ok);
        let response = bridge.handle(Request::Hello {
            protocol: PROTOCOL_VERSION,
            token,
            client: "attacker".into(),
        });
        assert!(matches!(response.error, Some(BridgeError::Forbidden(_))));
    }

    #[test]
    fn rules_roundtrip_and_delete() {
        let (mut bridge, token) = bridge_with_token();
        bridge.handle(hello(&token));
        let rule = Rule {
            id: "r1".into(),
            name: "هدية".into(),
            enabled: true,
            priority: 5,
            trigger: Some(lansher_core::EventType::Gift),
            group_op: None,
            conditions: vec![],
            rate: Default::default(),
            queue: lansher_core::QueueMode::Serial,
            max_concurrent: 1,
            start_delay_ms: 0,
            actions: vec![],
        };
        let response = bridge.handle(Request::UpsertRule { rule });
        assert!(response.ok);
        let listed = bridge.handle(Request::ListRules);
        assert_eq!(listed.data.unwrap().as_array().unwrap().len(), 1);
        let deleted = bridge.handle(Request::DeleteRule { id: "r1".into() });
        assert_eq!(deleted.data.unwrap()["removed"], serde_json::json!(true));
    }

    #[test]
    fn push_event_runs_rule_and_records_history() {
        let (mut bridge, token) = bridge_with_token();
        bridge.handle(hello(&token));
        let rule = Rule {
            id: "speak".into(),
            name: "نطق".into(),
            enabled: true,
            priority: 0,
            trigger: None,
            group_op: None,
            conditions: vec![],
            rate: Default::default(),
            queue: lansher_core::QueueMode::Serial,
            max_concurrent: 1,
            start_delay_ms: 0,
            actions: vec![lansher_core::ActionSpec {
                action: Action::Speak {
                    text: "{user}?".into(),
                    voice: None,
                    rate: None,
                },
                timeout_ms: 1_000,
                delay_after_ms: 0,
                on_error: lansher_core::OnError::Continue,
            }],
        };
        bridge.handle(Request::UpsertRule { rule });
        let mut seen = Vec::new();
        let mut event = LiveEvent::gift("g1", "sim", 1, "Rose", 1, 1);
        event.user = Some(User {
            nickname: "ali".into(),
            ..Default::default()
        });
        let report = bridge.push_event(event, &mut |e: &LiveEvent| seen.push(e.id.clone()));
        assert!(matches!(report, EngineReport::Matched { .. }));
        assert_eq!(bridge.executors_mut().spoken, vec!["ali?".to_string()]);
        let history = bridge.handle(Request::GetEventHistory { limit: 10 });
        assert_eq!(history.data.unwrap().as_array().unwrap().len(), 1);
    }

    #[test]
    fn duplicate_event_ignored_at_bridge_level() {
        let (mut bridge, _) = bridge_with_token();
        let event = LiveEvent::chat("c1", "sim", 1, "u", "x");
        bridge.push_event(event.clone(), &mut |_: &LiveEvent| {});
        let second = bridge.push_event(event, &mut |_: &LiveEvent| {});
        assert_eq!(second, EngineReport::Duplicate);
    }

    #[test]
    fn source_attach_and_detach_updates_state() {
        let (mut bridge, token) = bridge_with_token();
        bridge.handle(hello(&token));
        bridge.source_attached("browser", Some("9999".into()), Some("7".into()));
        assert!(bridge.source_status().connected);
        let state = bridge.handle(Request::GetState);
        let data = state.data.unwrap();
        assert_eq!(data["source"]["connected"], serde_json::json!(true));
        bridge.source_detached(Some("انقطع المصدر".into()));
        assert!(!bridge.source_status().connected);
        let state = bridge.handle(Request::GetState);
        assert_eq!(
            state.data.unwrap()["source"]["last_error"],
            serde_json::json!("انقطع المصدر")
        );
    }

    #[test]
    fn goals_accumulate_over_requests() {
        let (mut bridge, token) = bridge_with_token();
        bridge.handle(hello(&token));
        bridge.handle(Request::SetGoal {
            goal_id: "g".into(),
            amount: 10,
        });
        let response = bridge.handle(Request::SetGoal {
            goal_id: "g".into(),
            amount: 5,
        });
        assert_eq!(response.data.unwrap()["total"], serde_json::json!(15));
    }

    #[test]
    fn payload_signature_roundtrip() {
        let signature = sign_payload("s3cret", b"payload");
        assert!(verify_payload("s3cret", b"payload", &signature));
        assert!(!verify_payload("s3cret", b"other", &signature));
        assert!(!verify_payload("other", b"payload", &signature));
    }

    #[test]
    fn constant_time_compare_rejects_different_lengths() {
        assert!(!constant_time_eq(b"abc", b"ab"));
        assert!(constant_time_eq(b"abc", b"abc"));
    }

    #[test]
    fn constant_time_eq_accepts_equal_values_and_rejects_others() {
        // هذا الاختبار يغطي الانحدار الذي جمع فيه التنفيذ السابق
        // `a` و`b` في HMAC واحد: التجزئة لا تساوي تجزئة مدخل فارغ أبداً،
        // فيفشل التحقق من الرمز ولا يستطيع أي عميل الدخول.
        let token = new_token();
        assert!(constant_time_eq(token.as_bytes(), token.as_bytes()));
        assert!(!constant_time_eq(token.as_bytes(), b"wrong"));
        assert!(!constant_time_eq(b"", b"a"));
        assert!(!constant_time_eq(b"ab", b"ba"));
        // نفس البادئة لكن مختلف في الذيل: لا يصح أن تختصر المقارنة.
        assert!(!constant_time_eq(b"tok-abcdef", b"tok-abcdeg"));
    }

    #[test]
    fn hmac_hex_is_stable() {
        assert_eq!(hmac_hex("k", b"v"), hmac_hex("k", b"v"));
        assert_ne!(hmac_hex("k", b"v"), hmac_hex("k", b"w"));
    }

    #[test]
    fn diagnostics_include_component_detail() {
        let (mut bridge, token) = bridge_with_token();
        bridge.handle(hello(&token));
        let response = bridge.handle(Request::GetDiag {
            component: "audio".into(),
        });
        let data = response.data.unwrap();
        assert_eq!(data["component"], serde_json::json!("audio"));
        assert!(data["detail"].is_object());
    }

    #[test]
    fn upsert_profile_requires_id() {
        let (mut bridge, token) = bridge_with_token();
        bridge.handle(hello(&token));
        let bad = bridge.handle(Request::UpsertProfile {
            profile: serde_json::json!({ "name": "بلا معرّف" }),
        });
        assert!(!bad.ok);
        let good = bridge.handle(Request::UpsertProfile {
            profile: serde_json::json!({ "id": "p1", "name": "ملف" }),
        });
        assert!(good.ok);
        let list = bridge.handle(Request::ListProfiles);
        assert_eq!(list.data.unwrap().as_array().unwrap().len(), 1);
    }

    #[test]
    fn upsert_profile_replaces_same_id_instead_of_duplicating() {
        let (mut bridge, token) = bridge_with_token();
        bridge.handle(hello(&token));
        bridge.handle(Request::UpsertProfile {
            profile: serde_json::json!({ "id": "p1", "name": "الأول" }),
        });
        bridge.handle(Request::UpsertProfile {
            profile: serde_json::json!({ "id": "p1", "name": "الثاني" }),
        });
        let list = bridge.handle(Request::ListProfiles);
        let items = list.data.unwrap();
        assert_eq!(items.as_array().unwrap().len(), 1);
        assert_eq!(items[0]["name"], serde_json::json!("الثاني"));
    }

    #[test]
    fn push_event_request_requires_session_and_runs_rules() {
        let (mut bridge, token) = bridge_with_token();
        let before = bridge.handle(Request::PushEvent {
            event: LiveEvent::chat("c0", "sim", 1, "u", "x"),
        });
        assert!(!before.ok, "push_event قبل المصافحة مرفوض");

        bridge.handle(hello(&token));
        bridge.handle(Request::UpsertRule {
            rule: gift_rule("r-gift"),
        });
        let response = bridge.handle(Request::PushEvent {
            event: LiveEvent::gift("g1", "sim", 1, "Rose", 3, 7),
        });
        assert!(response.ok);
        let data = response.data.unwrap();
        assert_eq!(data["report"]["result"], serde_json::json!("matched"));
        assert_eq!(data["report"]["rules"], serde_json::json!(["r-gift"]));
        assert_eq!(data["counts"]["gifts"], serde_json::json!(3));
        assert_eq!(data["counts"]["gift_value"], serde_json::json!(21));

        let again = bridge.handle(Request::PushEvent {
            event: LiveEvent::gift("g1", "sim", 1, "Rose", 3, 7),
        });
        assert_eq!(
            again.data.unwrap()["report"]["result"],
            serde_json::json!("duplicate")
        );
    }

    #[test]
    fn bridge_error_json_has_code_and_message() {
        let error = BridgeError::Forbidden("طلب".into());
        let value = serde_json::to_value(&error).unwrap();
        assert_eq!(value["code"], serde_json::json!("forbidden"));
        assert!(value["message"].as_str().unwrap().contains("طلب"));
        let back: BridgeError = serde_json::from_value(value).unwrap();
        assert_eq!(back, error);
    }

    #[test]
    fn every_bridge_error_survives_roundtrip() {
        // لا نكتفي بنوع واحد: فقدت رسالة البروتوكول رقمها مرة، وهذا ما
        // يجعل الذهاب والإياب اختباراً contract لا مجرد اختبار ترميز.
        let cases = [
            BridgeError::Unauthorized,
            BridgeError::Protocol(99),
            BridgeError::UnknownRequest("أمر".into()),
            BridgeError::SourceOffline,
            BridgeError::Forbidden("ممنوع".into()),
            BridgeError::Internal("عطل".into()),
        ];
        for error in cases {
            let value = serde_json::to_value(&error).unwrap();
            assert_eq!(value.as_object().unwrap().len(), 2, "حقلان فقط");
            let back: BridgeError = serde_json::from_value(value).unwrap();
            assert_eq!(back, error, "فقد {:?} في الذهاب والإياب", error.code());
        }
    }

    #[test]
    fn unknown_error_code_becomes_internal_without_panicking() {
        // رمز غريب بلا رسالة: لا يpanic.
        let back: BridgeError =
            serde_json::from_value(serde_json::json!({ "code": "رمز_غير_معروف" })).unwrap();
        assert_eq!(back.code(), "internal");
    }

    #[test]
    fn non_numeric_protocol_detail_does_not_panic() {
        // الرسالة قد تأتي من طرف آخر، فنص لا يُحلَّل رقماً يعطي 0 ولا
        // يُسقط العملية.
        for message in [
            "",
            "إصدار البروتوكول غير مدعوم: ",
            "إصدار البروتوكول غير مدعوم: x",
        ] {
            let back: BridgeError = serde_json::from_value(serde_json::json!({
                "code": "unsupported_protocol",
                "message": message,
            }))
            .expect("الفك لا يفشل");
            assert_eq!(back, BridgeError::Protocol(0), "الرسالة {message}");
        }
    }

    #[test]
    fn error_detail_survives_a_foreign_prefix() {
        // لو جاءت الرسالة بلا بادئة معروفة نُبقيها كما هي، لا نخسرها.
        let back: BridgeError = serde_json::from_value(serde_json::json!({
            "code": "forbidden",
            "message": "نص حر بلا بادئة",
        }))
        .expect("الفك لا يفشل");
        assert_eq!(back, BridgeError::Forbidden("نص حر بلا بادئة".into()));
    }

    #[test]
    fn response_json_matches_frontend_contract() {
        let (mut bridge, _token) = bridge_with_token();
        let response = bridge.handle(hello("wrong"));
        assert!(!response.ok);
        let value = serde_json::to_value(&response).unwrap();
        assert_eq!(value["ok"], serde_json::json!(false));
        assert_eq!(value["error"]["code"], serde_json::json!("unauthorized"));
        assert!(value.get("data").is_none(), "الرد الفاشل بلا data");
        assert!(value.get("error").is_some());
    }

    #[test]
    fn engine_report_json_is_tagged_by_result() {
        let matched = EngineReport::Matched {
            event_id: "e1".into(),
            rules: vec!["r1".into()],
        };
        let value = serde_json::to_value(&matched).unwrap();
        assert_eq!(value["result"], serde_json::json!("matched"));
        assert_eq!(value["event_id"], serde_json::json!("e1"));
        let back: EngineReport = serde_json::from_value(value).unwrap();
        assert_eq!(back, matched);
    }

    #[test]
    fn engine_runs_before_any_source_is_attached() {
        let bridge = Bridge::new();
        assert!(bridge.engine().state().running);
    }

    #[test]
    fn attaching_source_resets_session_counts() {
        let (mut bridge, token) = bridge_with_token();
        bridge.handle(hello(&token));
        bridge.push_event(
            LiveEvent::gift("g1", "sim", 1, "Rose", 2, 5),
            &mut |_: &LiveEvent| {},
        );
        assert!(bridge.engine().state().counts.gifts > 0);
        bridge.source_attached("probe", Some("uid-1".into()), Some("room-1".into()));
        let state = bridge.engine().state();
        assert!(state.source_connected);
        assert_eq!(state.counts.gifts, 0, "جلسة جديدة تبدأ بعدّاد صفري");
        assert_eq!(state.unique_id.as_deref(), Some("uid-1"));
    }

    /// قاعدة هدية بسيطة، تُستخدم في اختبارات المسار الكامل.
    fn gift_rule(id: &str) -> Rule {
        Rule {
            id: id.into(),
            name: "هدية".into(),
            enabled: true,
            priority: 0,
            trigger: Some(lansher_core::EventType::Gift),
            group_op: None,
            conditions: vec![],
            rate: Default::default(),
            queue: lansher_core::QueueMode::Serial,
            max_concurrent: 1,
            start_delay_ms: 0,
            actions: vec![],
        }
    }
}
