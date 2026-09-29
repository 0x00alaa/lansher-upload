//! حالة التشغيل، منع التكرار، وواجهة تنفيذ الإجراءات.

use crate::event::{LiveEvent, Millis, Payload};
use crate::rule::{render_template, Action, ActionOutcome, Rule, RuleSet};
use serde::{Deserialize, Serialize};
use std::collections::{HashSet, VecDeque};

/// نافذة منع تكرار: معرّفات آخر N حدثاً.
#[derive(Debug, Clone)]
pub struct DedupeWindow {
    order: VecDeque<String>,
    seen: HashSet<String>,
    capacity: usize,
    /// حدّ زمني إضافي: حدث أقدم من هذا يُعتبر خارج النافذة زمنياً.
    ttl_ms: Millis,
}

impl DedupeWindow {
    pub fn new(capacity: usize, ttl_ms: Millis) -> Self {
        assert!(capacity > 0, "سعة النافذة يجب أن تكون أكبر من صفر");
        Self {
            order: VecDeque::with_capacity(capacity),
            seen: HashSet::with_capacity(capacity * 2),
            capacity,
            ttl_ms,
        }
    }

    /// يعيد `true` إذا كان الحدث مكرراً (فيُهمَل).
    pub fn is_duplicate(&mut self, event: &LiveEvent) -> bool {
        if self.seen.contains(&event.id) {
            return true;
        }
        if self.ttl_ms > 0 && event.ts_ms > 0 {
            let now = event.received_ms;
            if now > 0 && event.ts_ms + self.ttl_ms < now {
                // حدث قديم جداً: مصادر كثيرة تعيد إرسال التاريخ عند الاتصال.
                return true;
            }
        }
        self.seen.insert(event.id.clone());
        self.order.push_back(event.id.clone());
        while self.order.len() > self.capacity {
            if let Some(expired) = self.order.pop_front() {
                self.seen.remove(&expired);
            }
        }
        false
    }

    pub fn len(&self) -> usize {
        self.order.len()
    }

    pub fn is_empty(&self) -> bool {
        self.order.is_empty()
    }

    /// يعيد بناء النافذة من معرّفات محفوظة، بعد إعادة تشغيل التطبيق.
    pub fn restore<I: IntoIterator<Item = String>>(&mut self, ids: I) {
        for id in ids {
            if self.order.len() >= self.capacity {
                break;
            }
            if self.seen.insert(id.clone()) {
                self.order.push_back(id);
            }
        }
    }
}

impl Default for DedupeWindow {
    fn default() -> Self {
        Self::new(8192, 10 * 60 * 1000)
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Counts {
    /// مصدر التحديث: الحالة يرسلها، وليست حدثاً. التردد تواتر واحد.
    pub viewers: i64,
    pub likes: i64,
    pub gifts: i64,
    pub gift_value: i64,
    pub follows: i64,
    pub joins: i64,
    pub shares: i64,
    pub subscribes: i64,
    pub chats: i64,
    pub actions_executed: i64,
    pub actions_failed: i64,
    /// عدد المحاولات الإضافية بسبب سياسة `retry`. لا تُحسب في
    /// `actions_executed` ولا في `actions_failed`.
    pub actions_retried: i64,
    pub events_seen: i64,
    pub events_deduplicated: i64,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct EngineState {
    pub running: bool,
    pub source_connected: bool,
    pub last_error: Option<String>,
    pub counts: Counts,
    pub session_started_ms: Option<Millis>,
    pub unique_id: Option<String>,
    pub latency_ms: Option<Millis>,
}

/// نتيجة تمرير حدث واحد: مكرر، أو لا قواعد مطابقة، أو قائمة قواعد.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "result", rename_all = "snake_case")]
pub enum EngineReport {
    Duplicate,
    NoMatch {
        event_id: String,
    },
    Matched {
        event_id: String,
        rules: Vec<String>,
    },
}

/// منفّذ الإجراءات. المحرك يناديه، وهو ما يربط النواة بالعالم exterior.
///
/// التنفيذ في خيط الـ Tauri العملي هو `AsyncExecutor` في `lansher-server`،
/// و`DryRunExecutor` للاختبارات والمعاينة في الواجهة.
pub trait ActionExecutor {
    fn execute(
        &mut self,
        rule: &Rule,
        event: &LiveEvent,
        action: &Action,
    ) -> Result<serde_json::Value, String>;

    /// أقصى عدد تنفيذات متزامنة.
    fn max_concurrent(&self) -> usize {
        1
    }
}

#[derive(Debug, Default)]
pub struct DryRunExecutor {
    pub executed: usize,
}

impl ActionExecutor for DryRunExecutor {
    fn execute(
        &mut self,
        _rule: &Rule,
        _event: &LiveEvent,
        action: &Action,
    ) -> Result<serde_json::Value, String> {
        self.executed += 1;
        Ok(serde_json::json!({ "dry_run": true, "action": action_kind(action) }))
    }
}

/// عدد المحاولات الكلي للإجراء ذي سياسة `retry`، المحاولة الأولى منها.
pub const RETRY_ATTEMPTS: u32 = 3;

/// نتيجة محاولة تنفيذ إجراء واحدة بعد كل محاولات `retry`.
enum Attempt {
    Ok(serde_json::Value),
    Failed { error: String, attempts: u32 },
}

pub fn action_kind(action: &Action) -> &'static str {
    match action {
        Action::PlaySound { .. } => "play_sound",
        Action::Speak { .. } => "speak",
        Action::Alert { .. } => "alert",
        Action::AddToGoal { .. } => "add_to_goal",
        Action::SendChat { .. } => "send_chat",
        Action::Webhook { .. } => "webhook",
        Action::Integration { .. } => "integration",
        Action::Log { .. } => "log",
        Action::None => "none",
    }
}

/// المحرك: يمرّر الأحداث إلى القواعد مع تحكّم بالتبريد والتأخير.
pub struct Engine {
    rule_set: RuleSet,
    dedupe: DedupeWindow,
    state: EngineState,
    /// نافذة المعدل لكل قاعدة: متى بدأت، وكم مرة ضربت فيها.
    gates: Vec<Gate>,
    outcomes: VecDeque<ActionOutcome>,
}

#[derive(Debug, Clone, Copy, Default)]
struct Gate {
    hits: u32,
    window_start_ms: Millis,
}

impl Engine {
    pub fn new(rules: Vec<Rule>) -> Self {
        let rule_set = RuleSet::new(rules);
        let gates = vec![Gate::default(); rule_set.rules().len()];
        Self {
            rule_set,
            dedupe: DedupeWindow::default(),
            state: EngineState::default(),
            gates,
            outcomes: VecDeque::with_capacity(64),
        }
    }

    pub fn rule_set(&self) -> &RuleSet {
        &self.rule_set
    }

    pub fn state(&self) -> &EngineState {
        &self.state
    }

    pub fn state_mut(&mut self) -> &mut EngineState {
        &mut self.state
    }

    pub fn replace_rules(&mut self, rules: Vec<Rule>) {
        self.rule_set = RuleSet::new(rules);
        self.gates = vec![Gate::default(); self.rule_set.rules().len()];
    }

    pub fn start(&mut self, now_ms: Millis, unique_id: Option<String>) {
        self.state.running = true;
        self.state.session_started_ms = Some(now_ms);
        self.state.unique_id = unique_id;
        self.state.last_error = None;
    }

    /// بدء جلسة بث جديدة: تصفير عدّادات الجلسة ومنع التكرار ونتائج الإجراءات،
    /// مع إبقاء القواعد وربط المصدر كما هو.
    pub fn reset_session(&mut self, now_ms: Millis, unique_id: Option<String>) {
        self.state.counts = Counts::default();
        self.state.latency_ms = None;
        self.dedupe = DedupeWindow::default();
        self.gates = vec![Gate::default(); self.rule_set.rules().len()];
        self.outcomes.clear();
        self.start(now_ms, unique_id);
    }

    pub fn stop(&mut self) {
        self.state.running = false;
    }

    pub fn set_source_connected(&mut self, connected: bool) {
        self.state.source_connected = connected;
        if !connected {
            self.state.last_error = None;
        }
    }

    pub fn set_error(&mut self, error: Option<String>) {
        self.state.last_error = error;
    }

    pub fn set_viewers(&mut self, viewers: i64) {
        self.state.counts.viewers = viewers;
    }

    pub fn dedupe_mut(&mut self) -> &mut DedupeWindow {
        &mut self.dedupe
    }

    pub fn recent_outcomes(&self, limit: usize) -> Vec<ActionOutcome> {
        self.outcomes.iter().rev().take(limit).cloned().collect()
    }

    /// يمرّر حدثاً واحداً عبر المحرك كله.
    pub fn ingest(&mut self, event: &LiveEvent, executor: &mut dyn ActionExecutor) -> EngineReport {
        self.state.counts.events_seen += 1;
        self.state.latency_ms = Some((event.received_ms - event.ts_ms).max(0));

        if self.dedupe.is_duplicate(event) {
            self.state.counts.events_deduplicated += 1;
            return EngineReport::Duplicate;
        }

        self.update_counts(event);

        // نجمع المعرّفات لا المراجع: `run_rule` و`gate_allows` تأخذان
        // `&mut self`، فحمل مرجع مستعار من `self.rule_set` في نفس النطاق
        // تعارض استعارة.
        let matched_ids = self.rule_set.matching_ids(event);
        let now_ms = event.received_ms;
        let mut fired = Vec::new();
        for id in matched_ids {
            // النسخة المملوكة تنهي الاستعارة قبل استدعاء `&mut self`.
            let Some(rule) = self.rule_set.find(&id).cloned() else {
                continue;
            };
            if !self.gate_allows(&id, now_ms) {
                continue;
            }
            fired.push(id);
            self.run_rule(&rule, event, executor);
        }

        if fired.is_empty() {
            EngineReport::NoMatch {
                event_id: event.id.clone(),
            }
        } else {
            EngineReport::Matched {
                event_id: event.id.clone(),
                rules: fired,
            }
        }
    }

    fn update_counts(&mut self, event: &LiveEvent) {
        // نأخذ ما نحتاجه من الحمولة قبل الاستعارة، لأن الكتابة في
        // `self.state.unique_id` تتعارض مع استعارة `self.state.counts`.
        if let Payload::StreamStart { unique_id, .. } = &event.payload {
            self.state.unique_id = Some(unique_id.clone());
            self.state.session_started_ms = Some(event.received_ms);
        }
        let counts = &mut self.state.counts;
        match &event.payload {
            Payload::Gift {
                count, total_value, ..
            } => {
                counts.gifts += *count;
                counts.gift_value += *total_value;
            }
            Payload::Like { count } => counts.likes += *count,
            Payload::Follow => counts.follows += 1,
            Payload::Join => counts.joins += 1,
            Payload::Share => counts.shares += 1,
            Payload::Subscribe { .. } => counts.subscribes += 1,
            Payload::Chat { .. } => counts.chats += 1,
            Payload::StreamStart { .. } | Payload::StreamEnd { .. } | Payload::Custom(_) => {}
        }
    }

    /// نافذة المعدل لكل قاعدة.
    ///
    /// `max_hits = 0` أو `window_ms = 0` تعني: بلا حد. النافذة **ثابتة**
    /// تبدأ من أول ضربة، لا منزلقة. لذلك حدّ `1` كل `1000ms` يسمح بضربتين
    /// على حدّ النافذة: واحدة في `1000` وأخرى في `1001` تبدأ نافذة جديدة
    /// لأن `1001 - 1000 = 1` ليس أكبر من `1000`. هذا سلوك موثّق، لا
    /// إهمال؛ تحويلها لنافذة منزلق تغيير سلوكي يُختبر قبل تنفيذه.
    fn gate_allows(&mut self, rule_id: &str, now_ms: Millis) -> bool {
        let index = match self.rule_set.rules().iter().position(|r| r.id == rule_id) {
            Some(index) => index,
            None => return true,
        };
        let rate = self.rule_set.rules()[index].rate;
        if rate.max_hits == 0 || rate.window_ms <= 0 {
            return true;
        }
        let gate = &mut self.gates[index];
        if gate.window_start_ms == 0
            || now_ms < gate.window_start_ms
            || now_ms - gate.window_start_ms > rate.window_ms
        {
            gate.window_start_ms = now_ms;
            gate.hits = 0;
        }
        if gate.hits >= rate.max_hits {
            return false;
        }
        gate.hits += 1;
        true
    }

    fn run_rule(&mut self, rule: &Rule, event: &LiveEvent, executor: &mut dyn ActionExecutor) {
        // `start_delay_ms` و`timeout_ms` و`max_concurrent` تخصّ منفّذاً
        // غير متزامن. النواة نقية بلا I/O، فلا تنام ولا تفتح خيطاً؛
        // لذلك تقرأ هذه الحقول هنا لتوثيق التوقيع فقط، ويطبّقها Tauri.
        let _reserved = (rule.start_delay_ms, rule.max_concurrent, rule.queue);
        for spec in &rule.actions {
            let rendered = render_action(&spec.action, event);
            match self.attempt(executor, rule, event, spec, &rendered) {
                Attempt::Ok(detail) => {
                    self.state.counts.actions_executed += 1;
                    self.push_outcome(rule, event, detail);
                }
                Attempt::Failed { error, attempts } => {
                    self.state.counts.actions_failed += 1;
                    self.push_outcome(
                        rule,
                        event,
                        serde_json::json!({
                            "error": error,
                            "attempts": attempts,
                            "action": action_kind(&rendered),
                        }),
                    );
                    match spec.on_error {
                        crate::rule::OnError::Continue | crate::rule::OnError::Retry => {}
                        crate::rule::OnError::Abort => break,
                    }
                }
            }
        }
    }

    /// يحاول الإجراء حتى `RETRY_ATTEMPTS` مرات إذا كانت السياسة `retry`.
    ///
    /// `timeout_ms` لا يُطبَّق هنا: مهلة الإجراء تحتاج انتظاراً أو
    /// `async`، والنواة بلا I/O. تفرضها الطبقة التنفيذية.
    fn attempt(
        &mut self,
        executor: &mut dyn ActionExecutor,
        rule: &Rule,
        event: &LiveEvent,
        spec: &crate::rule::ActionSpec,
        action: &Action,
    ) -> Attempt {
        let max = if spec.on_error == crate::rule::OnError::Retry {
            RETRY_ATTEMPTS
        } else {
            1
        };
        let mut last = String::new();
        for attempt_index in 1..=max {
            match executor.execute(rule, event, action) {
                Ok(detail) => return Attempt::Ok(detail),
                Err(error) => {
                    last = error;
                    if attempt_index < max {
                        self.state.counts.actions_retried += 1;
                    }
                }
            }
        }
        Attempt::Failed {
            error: last,
            attempts: max,
        }
    }

    fn push_outcome(&mut self, rule: &Rule, event: &LiveEvent, detail: serde_json::Value) {
        self.outcomes.push_back(ActionOutcome {
            rule_id: rule.id.clone(),
            rule_name: rule.name.clone(),
            event_id: event.id.clone(),
            event_type: event.event_type.as_str().to_string(),
            nickname: event.nickname().to_string(),
            kind: event.payload.kind().to_string(),
            detail,
        });
        while self.outcomes.len() > 200 {
            self.outcomes.pop_front();
        }
    }

    /// أسئلة تشخيص: لماذا طابقت هذه القاعدة أو لم تطابق؟
    pub fn explain(&self, rule_id: &str, event: &LiveEvent) -> Vec<Explanation> {
        let mut out = Vec::new();
        for rule in self.rule_set.rules() {
            if rule.id != rule_id {
                continue;
            }
            if !rule.enabled {
                out.push(Explanation {
                    label: "القاعدة معطّلة".into(),
                    passed: false,
                });
            }
            if let Some(trigger) = &rule.trigger {
                let passed = *trigger == event.event_type;
                out.push(Explanation {
                    label: format!(
                        "المُشغِّل: {} {}",
                        trigger.as_str(),
                        if passed { "✓" } else { "✗" }
                    ),
                    passed,
                });
            }
            for condition in &rule.conditions {
                out.push(Explanation {
                    label: condition_label(condition),
                    passed: condition.matches(event),
                });
            }
        }
        out
    }
}

fn render_action(action: &Action, event: &LiveEvent) -> Action {
    match action {
        Action::Speak { text, voice, rate } => Action::Speak {
            text: render_template(text, event),
            voice: voice.clone(),
            rate: *rate,
        },
        Action::Alert {
            title,
            image,
            duration_ms,
        } => Action::Alert {
            title: render_template(title, event),
            image: image.clone(),
            duration_ms: *duration_ms,
        },
        Action::SendChat { text } => Action::SendChat {
            text: render_template(text, event),
        },
        Action::Log { text } => Action::Log {
            text: render_template(text, event),
        },
        Action::Webhook {
            url,
            method,
            include_event,
        } => Action::Webhook {
            url: url.clone(),
            method: method.clone(),
            include_event: *include_event,
        },
        other => other.clone(),
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Explanation {
    pub label: String,
    pub passed: bool,
}

fn condition_label(condition: &crate::rule::Condition) -> String {
    ConditionLabeler(condition).to_label()
}

/// غلاف واحد لتسمية الشروط، حتى نبقي منطق العرض في مكان واحد.
pub struct ConditionLabeler<'a>(pub &'a crate::rule::Condition);

impl std::fmt::Display for ConditionLabeler<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        use crate::event::EventType;
        use crate::rule::{BoolExpectation, CompareOp, Condition};
        fn op_text(op: CompareOp) -> &'static str {
            match op {
                CompareOp::Eq => "يساوي",
                CompareOp::Ne => "لا يساوي",
                CompareOp::Gt => "أكبر من",
                CompareOp::Gte => "أكبر أو يساوي",
                CompareOp::Lt => "أصغر من",
                CompareOp::Lte => "أصغر أو يساوي",
                CompareOp::Between => "بين",
                CompareOp::Contains => "يحتوي",
                CompareOp::StartsWith => "يبدأ بـ",
                CompareOp::EndsWith => "ينتهي بـ",
                CompareOp::Matches => "يطابق النمط",
                CompareOp::In => "ضمن قائمة",
            }
        }
        fn bool_text(expectation: BoolExpectation) -> &'static str {
            match expectation {
                BoolExpectation::True => "نعم",
                BoolExpectation::False => "لا",
                BoolExpectation::Any => "أي قيمة",
            }
        }
        let label = match self.0 {
            Condition::EventTypeIs { any_of } => format!(
                "نوع الحدث واحد من: {}",
                any_of
                    .iter()
                    .map(EventType::as_str)
                    .collect::<Vec<_>>()
                    .join("، ")
            ),
            Condition::EventTypeNot { any_of } => format!(
                "نوع الحدث ليس: {}",
                any_of
                    .iter()
                    .map(EventType::as_str)
                    .collect::<Vec<_>>()
                    .join("، ")
            ),
            Condition::Value { op, value, .. } => {
                format!("قيمة الحدث {} {}", op_text(*op), value)
            }
            Condition::RepeatCount { op, value, .. } => {
                format!("عدد التكرار {} {}", op_text(*op), value)
            }
            Condition::Subject { op, value, .. } => {
                format!("الهدية {} {}", op_text(*op), value)
            }
            Condition::Text { op, value } => {
                format!("نص الرسالة {} «{}»", op_text(*op), value)
            }
            Condition::Nickname { op, value } => {
                format!("اسم المستخدم {} {}", op_text(*op), value)
            }
            Condition::UniqueId { op, value } => {
                format!("معرّف المستخدم {} {}", op_text(*op), value)
            }
            Condition::IsFollower { expect } => {
                format!("المتابع: {}", bool_text(*expect))
            }
            Condition::IsSubscriber { expect } => {
                format!("المشترك: {}", bool_text(*expect))
            }
            Condition::Chance { percent, .. } => {
                format!("فرصة {}%", percent)
            }
            Condition::And { conditions } => {
                format!("كل الشروط ({})", conditions.len())
            }
            Condition::Or { conditions } => {
                format!("أي شرط ({})", conditions.len())
            }
            Condition::Not { .. } => "ليست".to_string(),
        };
        f.write_str(&label)
    }
}

impl<'a> ConditionLabeler<'a> {
    fn to_label(&self) -> String {
        self.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::LiveEvent;
    use crate::rule::{Action, ActionSpec, CompareOp, Condition, RateGate, Rule};

    fn rule(id: &str, conditions: Vec<Condition>, actions: Vec<Action>) -> Rule {
        Rule {
            id: id.into(),
            name: id.into(),
            enabled: true,
            priority: 0,
            trigger: None,
            group_op: None,
            conditions,
            rate: RateGate::default(),
            queue: crate::rule::QueueMode::Serial,
            max_concurrent: 1,
            start_delay_ms: 0,
            actions: actions
                .into_iter()
                .map(|action| ActionSpec {
                    action,
                    timeout_ms: 5_000,
                    delay_after_ms: 0,
                    on_error: crate::rule::OnError::Continue,
                })
                .collect(),
        }
    }

    #[test]
    fn duplicate_event_is_dropped_once() {
        let mut engine = Engine::new(vec![]);
        let event = LiveEvent::chat("c1", "sim", 10, "u", "hi");
        assert_eq!(
            engine.ingest(&event, &mut DryRunExecutor::default()),
            EngineReport::NoMatch {
                event_id: "c1".into()
            }
        );
        assert_eq!(
            engine.ingest(&event, &mut DryRunExecutor::default()),
            EngineReport::Duplicate
        );
        assert_eq!(engine.state().counts.events_deduplicated, 1);
    }

    #[test]
    fn old_history_events_are_dropped() {
        let mut window = DedupeWindow::new(10, 60_000);
        let mut event = LiveEvent::chat("old", "sim", 1_000, "u", "x");
        event.received_ms = 1_000_000;
        assert!(window.is_duplicate(&event));
    }

    #[test]
    fn restore_rebuilds_window() {
        let mut window = DedupeWindow::new(4, 0);
        window.restore(vec!["a".to_string(), "b".to_string(), "c".to_string()]);
        let mut event = LiveEvent::chat("b", "sim", 1, "u", "x");
        event.ts_ms = 1;
        assert!(window.is_duplicate(&event));
    }

    #[test]
    fn counts_track_events() {
        let mut engine = Engine::new(vec![]);
        engine.ingest(
            &LiveEvent::gift("g1", "sim", 1, "Rose", 2, 5),
            &mut DryRunExecutor::default(),
        );
        engine.ingest(
            &LiveEvent::like("l1", "sim", 1, 10),
            &mut DryRunExecutor::default(),
        );
        engine.ingest(
            &LiveEvent::chat("c1", "sim", 1, "u", "x"),
            &mut DryRunExecutor::default(),
        );
        let counts = &engine.state().counts;
        assert_eq!(counts.gifts, 2);
        assert_eq!(counts.gift_value, 10);
        assert_eq!(counts.likes, 10);
        assert_eq!(counts.chats, 1);
    }

    #[test]
    fn actions_render_template_before_execution() {
        let mut executor = DryRunExecutor::default();
        let rule = rule(
            "r1",
            vec![Condition::Value {
                op: CompareOp::Gte,
                value: 10,
                value2: None,
            }],
            vec![Action::Speak {
                text: "{user} أرسل {gift}".into(),
                voice: None,
                rate: None,
            }],
        );
        let mut engine = Engine::new(vec![rule]);
        let mut event = LiveEvent::gift("g1", "sim", 1, "Rose", 2, 5);
        event.user = Some(crate::event::User {
            nickname: "ali".into(),
            ..Default::default()
        });
        let report = engine.ingest(&event, &mut executor);
        assert!(matches!(report, EngineReport::Matched { .. }));
        assert_eq!(executor.executed, 1);
        let outcomes = engine.recent_outcomes(1);
        assert_eq!(outcomes.len(), 1);
        assert_eq!(outcomes[0].rule_id, "r1");
    }

    #[test]
    fn rate_gate_blocks_burst() {
        let mut executor = DryRunExecutor::default();
        let mut rule = rule("r1", vec![], vec![Action::Log { text: "x".into() }]);
        rule.rate = RateGate::new(1, 60_000);
        let mut engine = Engine::new(vec![rule]);
        let first = engine.ingest(&LiveEvent::chat("c1", "sim", 1, "u", "x"), &mut executor);
        let second = engine.ingest(&LiveEvent::chat("c2", "sim", 2, "u", "x"), &mut executor);
        assert!(matches!(first, EngineReport::Matched { .. }));
        assert!(matches!(second, EngineReport::NoMatch { .. }));
        assert_eq!(executor.executed, 1);
    }

    #[test]
    fn explain_reports_each_condition() {
        let rule = rule(
            "r1",
            vec![
                Condition::Value {
                    op: CompareOp::Gte,
                    value: 100,
                    value2: None,
                },
                Condition::Text {
                    op: CompareOp::Contains,
                    value: "سلام".into(),
                },
            ],
            vec![],
        );
        let engine = Engine::new(vec![rule]);
        let event = LiveEvent::chat("c1", "sim", 1, "u", "مساء");
        let report = engine.explain("r1", &event);
        assert_eq!(report.len(), 2);
        assert!(report.iter().all(|r| !r.passed));
    }

    /// منفذ يفشل حتى عدد محدد، لاختبار `retry`.
    struct Flaky {
        fail_first: u32,
        calls: u32,
    }

    impl ActionExecutor for Flaky {
        fn execute(
            &mut self,
            _rule: &Rule,
            _event: &LiveEvent,
            _action: &Action,
        ) -> Result<serde_json::Value, String> {
            self.calls += 1;
            if self.calls <= self.fail_first {
                Err(format!("فشل {}", self.calls))
            } else {
                Ok(serde_json::json!({ "ok": true }))
            }
        }
    }

    /// منفذ يفشل دائماً، لاختبار `abort` وعدد المحاولات النهائي.
    struct AlwaysFails {
        calls: u32,
    }

    impl ActionExecutor for AlwaysFails {
        fn execute(
            &mut self,
            _rule: &Rule,
            _event: &LiveEvent,
            _action: &Action,
        ) -> Result<serde_json::Value, String> {
            self.calls += 1;
            Err("فشل دائم".into())
        }
    }

    fn spec(action: Action, on_error: crate::rule::OnError) -> ActionSpec {
        ActionSpec {
            action,
            timeout_ms: 5_000,
            delay_after_ms: 0,
            on_error,
        }
    }

    #[test]
    fn retry_stops_at_first_success() {
        let rule = Rule {
            actions: vec![spec(
                Action::Log { text: "x".into() },
                crate::rule::OnError::Retry,
            )],
            ..rule("r1", vec![], vec![])
        };
        let mut engine = Engine::new(vec![rule]);
        let mut executor = Flaky {
            fail_first: 2,
            calls: 0,
        };
        let event = LiveEvent::chat("c1", "sim", 1, "u", "x");
        assert!(matches!(
            engine.ingest(&event, &mut executor),
            EngineReport::Matched { .. }
        ));
        assert_eq!(executor.calls, 3, "فشل مرتين ثم نجح في الثالثة");
        let counts = &engine.state().counts;
        assert_eq!(counts.actions_executed, 1);
        assert_eq!(counts.actions_failed, 0);
        assert_eq!(counts.actions_retried, 2, "إعادتان قبل النجاح");
    }

    #[test]
    fn retry_gives_up_after_three_attempts() {
        let rule = Rule {
            actions: vec![spec(
                Action::Log { text: "x".into() },
                crate::rule::OnError::Retry,
            )],
            ..rule("r1", vec![], vec![])
        };
        let mut engine = Engine::new(vec![rule]);
        let mut executor = AlwaysFails { calls: 0 };
        engine.ingest(&LiveEvent::chat("c1", "sim", 1, "u", "x"), &mut executor);
        assert_eq!(executor.calls, RETRY_ATTEMPTS);
        let counts = &engine.state().counts;
        assert_eq!(counts.actions_failed, 1, "الفشل يُحسب مرة واحدة");
        assert_eq!(counts.actions_retried, (RETRY_ATTEMPTS - 1) as i64);
    }

    #[test]
    fn continue_policy_does_not_retry() {
        let rule = Rule {
            actions: vec![spec(
                Action::Log { text: "x".into() },
                crate::rule::OnError::Continue,
            )],
            ..rule("r1", vec![], vec![])
        };
        let mut engine = Engine::new(vec![rule]);
        let mut executor = AlwaysFails { calls: 0 };
        engine.ingest(&LiveEvent::chat("c1", "sim", 1, "u", "x"), &mut executor);
        assert_eq!(executor.calls, 1, "محاولة واحدة بلا إعادة");
        assert_eq!(engine.state().counts.actions_retried, 0);
    }

    #[test]
    fn abort_policy_stops_the_chain() {
        let rule = Rule {
            actions: vec![
                spec(
                    Action::Log { text: "أ".into() },
                    crate::rule::OnError::Abort,
                ),
                spec(
                    Action::Log { text: "ب".into() },
                    crate::rule::OnError::Continue,
                ),
            ],
            ..rule("r1", vec![], vec![])
        };
        let mut engine = Engine::new(vec![rule]);
        let mut executor = AlwaysFails { calls: 0 };
        engine.ingest(&LiveEvent::chat("c1", "sim", 1, "u", "x"), &mut executor);
        assert_eq!(executor.calls, 1, "الإجراء الثاني لا ينفَّذ بعد abort");
    }

    #[test]
    fn failed_outcome_records_error_and_attempts() {
        let rule = Rule {
            actions: vec![spec(
                Action::Log { text: "x".into() },
                crate::rule::OnError::Retry,
            )],
            ..rule("r1", vec![], vec![])
        };
        let mut engine = Engine::new(vec![rule]);
        engine.ingest(
            &LiveEvent::chat("c1", "sim", 1, "u", "x"),
            &mut AlwaysFails { calls: 0 },
        );
        let outcomes = engine.recent_outcomes(1);
        assert_eq!(outcomes.len(), 1);
        assert_eq!(
            outcomes[0].detail["attempts"],
            serde_json::json!(RETRY_ATTEMPTS)
        );
        assert_eq!(outcomes[0].detail["action"], serde_json::json!("log"));
        assert!(outcomes[0].detail["error"].as_str().is_some());
    }

    #[test]
    fn reset_session_clears_counts_dedupe_and_outcomes() {
        let rule = rule("r1", vec![], vec![Action::Log { text: "x".into() }]);
        let mut engine = Engine::new(vec![rule]);
        let event = LiveEvent::gift("g1", "sim", 1, "Rose", 2, 5);
        engine.ingest(&event, &mut DryRunExecutor::default());
        assert_eq!(engine.state().counts.gifts, 2);
        assert!(!engine.recent_outcomes(10).is_empty());

        engine.reset_session(1_000, Some("uid-2".into()));
        let counts = &engine.state().counts;
        assert_eq!(counts.gifts, 0);
        assert_eq!(counts.events_seen, 0);
        assert!(engine.recent_outcomes(10).is_empty());
        assert_eq!(engine.state().unique_id.as_deref(), Some("uid-2"));
        assert!(engine.state().running);

        // المعرّف نفسه يُقبل بعد الجلسة الجديدة: النافذة تصفّرت.
        let mut executor = DryRunExecutor::default();
        let report = engine.ingest(&event, &mut executor);
        assert!(matches!(report, EngineReport::Matched { .. }));
    }

    #[test]
    fn rate_gate_window_resets_after_it_expires() {
        let mut rule = rule("r1", vec![], vec![Action::Log { text: "x".into() }]);
        rule.rate = RateGate::new(1, 1_000);
        let mut engine = Engine::new(vec![rule]);
        let mut executor = DryRunExecutor::default();
        assert!(matches!(
            engine.ingest(
                &LiveEvent::chat("c1", "sim", 1_000, "u", "x"),
                &mut executor
            ),
            EngineReport::Matched { .. }
        ));
        assert!(matches!(
            engine.ingest(
                &LiveEvent::chat("c2", "sim", 1_500, "u", "x"),
                &mut executor
            ),
            EngineReport::NoMatch { .. }
        ));
        // تجاوز مدة النافذة: ينفتح من جديد.
        assert!(matches!(
            engine.ingest(
                &LiveEvent::chat("c3", "sim", 2_500, "u", "x"),
                &mut executor
            ),
            EngineReport::Matched { .. }
        ));
        assert_eq!(executor.executed, 2);
    }

    #[test]
    fn rate_gate_ignores_zero_window() {
        let mut rule = rule("r1", vec![], vec![Action::Log { text: "x".into() }]);
        rule.rate = RateGate::new(1, 0);
        let mut engine = Engine::new(vec![rule]);
        let mut executor = DryRunExecutor::default();
        for index in 0..3 {
            engine.ingest(
                &LiveEvent::chat(format!("c{index}"), "sim", 1, "u", "x"),
                &mut executor,
            );
        }
        assert_eq!(executor.executed, 3, "نافذة صفرية تعني بلا حد");
    }

    #[test]
    fn disabled_rule_never_fires() {
        let mut rule = rule("r1", vec![], vec![Action::Log { text: "x".into() }]);
        rule.enabled = false;
        let mut engine = Engine::new(vec![rule]);
        let mut executor = DryRunExecutor::default();
        let report = engine.ingest(&LiveEvent::chat("c1", "sim", 1, "u", "x"), &mut executor);
        assert!(matches!(report, EngineReport::NoMatch { .. }));
        assert_eq!(executor.executed, 0);
    }

    #[test]
    fn rate_gate_window_is_fixed_not_sliding() {
        // النافذة الثابتة تغطّي [البداية، البداية + المدة). لذلك
        // ضربة بعد 1ms ما زالت داخل النافذة نفسها، فتُحجب: النافذة لا
        // تنزلق مع كل ضربة، بل تُصفَّر دفعة واحدة بعد انتهائها.
        let mut rule = rule("r1", vec![], vec![Action::Log { text: "x".into() }]);
        rule.rate = RateGate::new(1, 1_000);
        let mut engine = Engine::new(vec![rule]);
        let mut executor = DryRunExecutor::default();
        assert!(matches!(
            engine.ingest(
                &LiveEvent::chat("c1", "sim", 1_000, "u", "x"),
                &mut executor
            ),
            EngineReport::Matched { .. }
        ));
        // 1001 - 1000 = 1، وهو ليس أكبر من 1000: النافذة لم تنتهِ بعد.
        assert!(
            matches!(
                engine.ingest(
                    &LiveEvent::chat("c2", "sim", 1_001, "u", "x"),
                    &mut executor
                ),
                EngineReport::NoMatch { .. }
            ),
            "نافذة ثابتة: 1ms بعد فتحها لا تفتح نافذة جديدة"
        );
        // 2001 - 1000 = 1001 > 1000: انتهت النافذة، فتُصفَّر دفعة واحدة.
        assert!(matches!(
            engine.ingest(
                &LiveEvent::chat("c3", "sim", 2_001, "u", "x"),
                &mut executor
            ),
            EngineReport::Matched { .. }
        ));
        assert_eq!(executor.executed, 2);
    }

    #[test]
    fn stream_start_sets_session_identity() {
        let mut engine = Engine::new(vec![]);
        let event = LiveEvent::new(
            "s1",
            crate::event::EventType::StreamStart,
            "sim",
            4_000,
            Payload::StreamStart {
                unique_id: "uid-7".into(),
                title: None,
            },
        );
        engine.ingest(&event, &mut DryRunExecutor::default());
        assert_eq!(engine.state().unique_id.as_deref(), Some("uid-7"));
        assert_eq!(engine.state().session_started_ms, Some(4_000));
    }

    #[test]
    fn latency_is_not_negative_when_clock_skews() {
        let mut engine = Engine::new(vec![]);
        let mut event = LiveEvent::chat("c1", "sim", 5_000, "u", "x");
        event.received_ms = 4_000;
        engine.ingest(&event, &mut DryRunExecutor::default());
        assert_eq!(engine.state().latency_ms, Some(0));
    }
}
