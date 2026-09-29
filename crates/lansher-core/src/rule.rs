//! نموذج القاعدة: مُشغّل → شروط → تحكم → إجراءات.

use crate::event::{EventType, LiveEvent, Millis};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CompareOp {
    Eq,
    Ne,
    Gt,
    Gte,
    Lt,
    Lte,
    Between,
    Contains,
    StartsWith,
    EndsWith,
    Matches,
    In,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GroupOp {
    All,
    Any,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BoolExpectation {
    /// `None` لا يطابق: لا نعامل «غير معروف» كـ «نعم».
    True,
    False,
    /// `None` يطابق أيضاً.
    Any,
}

/// شرط واحد. `None` في حقل اختياري = غير معروف، ويسلك السلوك الموضّح في
/// `BoolExpectation` وفي شروط المقارنة.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Condition {
    EventTypeIs {
        #[serde(default)]
        any_of: Vec<EventType>,
    },
    EventTypeNot {
        any_of: Vec<EventType>,
    },
    /// قيمة الحدث: `total_value` للهدية، وعدد الإعجابات لغيرها.
    Value {
        op: CompareOp,
        value: i64,
        #[serde(default)]
        value2: Option<i64>,
    },
    /// عدد التكرار: عدد الهدايا المرسلة، أو عدد الإعجابات.
    RepeatCount {
        op: CompareOp,
        value: i64,
        #[serde(default)]
        value2: Option<i64>,
    },
    /// اسم الهدية أو نوع العضوية.
    Subject {
        op: CompareOp,
        value: String,
        #[serde(default)]
        values: Vec<String>,
    },
    /// نص الدردشة.
    Text {
        op: CompareOp,
        value: String,
    },
    /// اسم المستخدم.
    Nickname {
        op: CompareOp,
        value: String,
    },
    /// معرّف المستخدم الدائم.
    UniqueId {
        op: CompareOp,
        value: String,
    },
    IsFollower {
        expect: BoolExpectation,
    },
    IsSubscriber {
        expect: BoolExpectation,
    },
    /// نسبة مئوية 0-100. مع honour_seed تصبح النتيجة قابلة لإعادة الإنتاج.
    Chance {
        percent: u8,
        #[serde(default)]
        seed: Option<u64>,
    },
    /// ملاحظة: نستخدم حقولاً باسم واضح بدل `And(Vec<..>)`، لأن serde لا يقرأ
    /// newtype يحوي تسلسلاً مع `tag = "kind"`.
    And {
        conditions: Vec<Condition>,
    },
    Or {
        conditions: Vec<Condition>,
    },
    Not {
        condition: Box<Condition>,
    },
}

impl Condition {
    pub fn matches(&self, event: &LiveEvent) -> bool {
        match self {
            Condition::EventTypeIs { any_of } => {
                any_of.is_empty() || any_of.contains(&event.event_type)
            }
            Condition::EventTypeNot { any_of } => !any_of.contains(&event.event_type),
            Condition::Value { op, value, value2 } => {
                cmp_i64(*op, event.payload.numeric_value(), *value, *value2)
            }
            Condition::RepeatCount { op, value, value2 } => {
                cmp_i64(*op, event.payload.repeat_count(), *value, *value2)
            }
            Condition::Subject { op, value, values } => match event.payload.subject() {
                Some(subject) => cmp_str_with_list(*op, subject, value, values),
                // لا اسم هدية في هذا الحدث: لا يطابق شرط اسم هدية.
                None => false,
            },
            Condition::Text { op, value } => match event.payload.text() {
                Some(text) => cmp_str(*op, text, value),
                None => false,
            },
            Condition::Nickname { op, value } => cmp_str(*op, event.nickname(), value),
            Condition::UniqueId { op, value } => {
                match event.user.as_ref().and_then(|u| u.unique_id.as_ref()) {
                    Some(id) => cmp_str(*op, id, value),
                    None => false,
                }
            }
            Condition::IsFollower { expect } => {
                match_flag(event.user.as_ref().and_then(|u| u.is_follower), *expect)
            }
            Condition::IsSubscriber { expect } => {
                match_flag(event.user.as_ref().and_then(|u| u.is_subscriber), *expect)
            }
            Condition::Chance { percent, seed } => chance_hit(event, *percent, *seed),
            Condition::And { conditions } => {
                !conditions.is_empty() && conditions.iter().all(|c| c.matches(event))
            }
            Condition::Or { conditions } => conditions.iter().any(|c| c.matches(event)),
            Condition::Not { condition } => !condition.matches(event),
        }
    }
}

fn match_flag(value: Option<bool>, expectation: BoolExpectation) -> bool {
    match expectation {
        BoolExpectation::True => value == Some(true),
        BoolExpectation::False => value == Some(false),
        BoolExpectation::Any => true,
    }
}

/// نافذة معدّل: مسموح بعدد محاولات خلال فترة. المحرك ينفّذ نافذة **ثابتة**
/// تبدأ من أول ضربة، لا نافذة منزلقة: التسمية في الوثائق أرقى من التنفيذ،
/// والفرق يظهر عند أحداث متقطعة على حدّ النافذة. تغييرها إلى نافذة
/// منزلقة يغيّر سلوك القواعد، فيُنفَّذ مع اختبار، لا كتصحيح تعليق.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct RateGate {
    pub max_hits: u32,
    pub window_ms: Millis,
}

impl RateGate {
    pub fn new(max_hits: u32, window_ms: Millis) -> Self {
        Self {
            max_hits,
            window_ms,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QueueMode {
    /// تشغيل فوري، ويمكن أن يتداخل مع نفسه.
    Immediate,
    /// انتظار حتى انتهاء التنفيذ السابق.
    Serial,
    /// حد أقصى للتكرار المتزامن.
    Bounded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OnError {
    /// الافتراضي: فشل إجراء واحد لا يوقف باقي الإجراءات. يطابق سلوك
    /// `timeout_ms` الذي يسجّل الفشل ولا يوقف المحرك.
    #[default]
    Continue,
    Abort,
    Retry,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Action {
    PlaySound {
        file_id: String,
        #[serde(default)]
        volume: Option<u8>,
    },
    Speak {
        text: String,
        #[serde(default)]
        voice: Option<String>,
        #[serde(default)]
        rate: Option<i32>,
    },
    Alert {
        title: String,
        #[serde(default)]
        image: Option<String>,
        #[serde(default)]
        duration_ms: Option<u32>,
    },
    AddToGoal {
        goal_id: String,
        /// `event` يستخدم قيمة الحدث نفسها، و`fixed` قيمة ثابتة.
        #[serde(default)]
        amount: Option<i64>,
        #[serde(default)]
        mode: Option<GoalMode>,
    },
    SendChat {
        text: String,
    },
    Webhook {
        url: String,
        #[serde(default)]
        method: Option<String>,
        #[serde(default)]
        include_event: Option<bool>,
    },
    Integration {
        target: String,
        command: String,
        #[serde(default)]
        args: ActionArgs,
    },
    Log {
        text: String,
    },
    None,
}

/// وسائط أمر التكامل: نصوص فقط، حتى يبقى العقد محايداً عن أي منصة.
pub type ActionArgs = std::collections::BTreeMap<String, String>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GoalMode {
    Event,
    Fixed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ActionSpec {
    pub action: Action,
    /// مهلة الإجراء بالمللي ثانية. تجاوزها يسجّل فشلاً ولا يوقف المحرك.
    #[serde(default = "default_timeout")]
    pub timeout_ms: u64,
    /// فاصل بعد الإجراء قبل التالي.
    #[serde(default)]
    pub delay_after_ms: u64,
    #[serde(default)]
    pub on_error: OnError,
}

fn default_timeout() -> u64 {
    5_000
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Rule {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub enabled: bool,
    /// أعلى أولاً.
    #[serde(default)]
    pub priority: i32,
    /// `None` يعني: يُطابق أي نوع حدث، والشروط هي المرشّحة.
    #[serde(default)]
    pub trigger: Option<EventType>,
    /// `All` افتراضي. `None` = لا شروط = يُطابق كل شيء.
    #[serde(default)]
    pub group_op: Option<GroupOp>,
    #[serde(default)]
    pub conditions: Vec<Condition>,
    #[serde(default)]
    pub rate: RateGate,
    #[serde(default = "default_queue_mode")]
    pub queue: QueueMode,
    #[serde(default = "default_max_concurrent")]
    pub max_concurrent: u32,
    /// تأخير قبل تنفيذ أول إجراء.
    #[serde(default)]
    pub start_delay_ms: u64,
    #[serde(default)]
    pub actions: Vec<ActionSpec>,
}

fn default_queue_mode() -> QueueMode {
    QueueMode::Serial
}

fn default_max_concurrent() -> u32 {
    1
}

impl Rule {
    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    /// فحوصات خالصة بلا حالة: مهم للاختبار ولزر «لماذا لم تُطابق».
    pub fn matches(&self, event: &LiveEvent) -> bool {
        if !self.is_enabled() {
            return false;
        }
        if let Some(trigger) = &self.trigger {
            if trigger != &event.event_type {
                return false;
            }
        }
        let op = self.group_op.unwrap_or(GroupOp::All);
        match op {
            GroupOp::All => self.conditions.iter().all(|c| c.matches(event)),
            GroupOp::Any => self.conditions.iter().any(|c| c.matches(event)),
        }
    }
}

fn cmp_i64(op: CompareOp, left: i64, right: i64, right2: Option<i64>) -> bool {
    match op {
        CompareOp::Eq => left == right,
        CompareOp::Ne => left != right,
        CompareOp::Gt => left > right,
        CompareOp::Gte => left >= right,
        CompareOp::Lt => left < right,
        CompareOp::Lte => left <= right,
        CompareOp::Between => match right2 {
            Some(upper) => left >= right && left <= upper,
            None => left == right,
        },
        // المقارنات النصية على قيمة رقمية: نتحول إلى نص.
        CompareOp::Contains => left.to_string().contains(&right.to_string()),
        CompareOp::StartsWith => left.to_string().starts_with(&right.to_string()),
        CompareOp::EndsWith => left.to_string().ends_with(&right.to_string()),
        CompareOp::Matches => false,
        CompareOp::In => match right2 {
            Some(_) => false,
            None => left == right,
        },
    }
}

fn cmp_str(op: CompareOp, left: &str, right: &str) -> bool {
    let left = left.to_lowercase();
    let right = right.to_lowercase();
    match op {
        CompareOp::Eq => left == right,
        CompareOp::Ne => left != right,
        CompareOp::Contains => left.contains(&right),
        CompareOp::StartsWith => left.starts_with(&right),
        CompareOp::EndsWith => left.ends_with(&right),
        CompareOp::Matches => text_matches_pattern(&left, &right),
        CompareOp::Gt | CompareOp::Gte | CompareOp::Lt | CompareOp::Lte => {
            match (left.parse::<i64>(), right.parse::<i64>()) {
                (Ok(l), Ok(r)) => cmp_i64(op, l, r, None),
                _ => false,
            }
        }
        CompareOp::Between | CompareOp::In => false,
    }
}

fn cmp_str_with_list(op: CompareOp, left: &str, right: &str, values: &[String]) -> bool {
    if op == CompareOp::In {
        let left = left.to_lowercase();
        return values.iter().any(|v| v.to_lowercase() == left) || right.to_lowercase() == left;
    }
    cmp_str(op, left, right)
}

/// مطابقة نصية بسيطة بدون مكتبة تعابير نمطية كاملة.
///
/// نبتعد عن مكتبة تعابير نمطية لأنها تضيف اعتمادية في نواة المنتج، ولأن أنماط
/// المستخدم غالباً كلمات أو عبارات قصيرة. الدلالات: نص عادي = احتواء، و`*` =
/// أي تسلسل أحرف. المقارنة غير حسّاسة لحالة الأحرف.
/// نمط عام بنجمة واحدة أو أكثر: `*` تطابق أي تسلسل، كقواعد Fare.
///
/// `*` في البداية تعني «غير مثبّت من اليسار»، و`*` في النهاية «غير مثبّت
/// من اليمين». النمط بلا نجوم يجب أن يطابق النص كاملاً، لا بادأته.
///
/// `cmp_str` يوحّد حالة الأحرف قبل النداء، فالمقارنة هنا على النص
/// المطبَّع. `*` المتكررة `**` لا تعني شيئاً، فنحذف القطعات الفارغة.
fn text_matches_pattern(haystack: &str, pattern: &str) -> bool {
    let pattern = pattern.trim();
    if pattern.is_empty() {
        return false;
    }
    let anchored_start = !pattern.starts_with('*');
    let anchored_end = !pattern.ends_with('*');
    // النجمة المتكررة `**` لا تعني شيئاً، فنحذف القطعات الفارغة.
    let segments: Vec<&str> = pattern.split('*').filter(|s| !s.is_empty()).collect();
    if segments.is_empty() {
        // النمط كله نجوم: يطابق أي نص.
        return true;
    }
    let mut cursor = 0usize;
    for (index, segment) in segments.iter().enumerate() {
        // `find` يعيد موضع بايت على حدود محارف، فتبقى `cursor` صالحة.
        match haystack[cursor..].find(segment) {
            Some(position) => {
                if index == 0 && anchored_start && position != 0 {
                    return false;
                }
                cursor += position + segment.len();
            }
            None => return false,
        }
    }
    if anchored_end && cursor != haystack.len() {
        return false;
    }
    true
}

/// نتيجة حتمية لشرط `Chance`: مشتقّة من معرّف الحدث.
/// مع `seed` يستخدم تجزئة بسيطة للمدخلات بدل مخزن عشوائي عام، حتى تكون
/// النتيجة قابلة لإعادة الإنتاج في الاختبارات.
fn chance_hit(event: &LiveEvent, percent: u8, seed: Option<u64>) -> bool {
    if percent == 0 {
        return false;
    }
    if percent >= 100 {
        return true;
    }
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    let mut feed = |bytes: &[u8]| {
        for byte in bytes {
            hash ^= *byte as u64;
            hash = hash.wrapping_mul(0x1000_0000_01b3);
        }
    };
    feed(event.id.as_bytes());
    if let Some(seed) = seed {
        feed(&seed.to_le_bytes());
    }
    (hash % 100) < u64::from(percent)
}

/// ملح نصوص الإجراءات: يستبدل المتغيرات من الحدث.
pub fn render_template(template: &str, event: &LiveEvent) -> String {
    let mut out = template.to_string();
    out = out.replace("{user}", event.nickname());
    if let Some(text) = event.payload.text() {
        out = out.replace("{text}", text);
    }
    if let Some(subject) = event.payload.subject() {
        out = out.replace("{gift}", subject);
    }
    out = out.replace("{count}", &event.payload.repeat_count().to_string());
    out = out.replace("{value}", &event.payload.numeric_value().to_string());
    out = out.replace("{type}", event.payload.kind());
    out
}

/// مُشغّل قواعد بسيط: يقيّم القواعد ويعيد المطابقات مرتبة بالأولوية.
pub struct RuleSet {
    rules: Vec<Rule>,
}

impl RuleSet {
    pub fn new(mut rules: Vec<Rule>) -> Self {
        rules.sort_by(|a, b| b.priority.cmp(&a.priority).then(a.id.cmp(&b.id)));
        Self { rules }
    }

    pub fn rules(&self) -> &[Rule] {
        &self.rules
    }

    pub fn matching(&self, event: &LiveEvent) -> Vec<&Rule> {
        self.rules
            .iter()
            .filter(|rule| rule.matches(event))
            .collect()
    }

    /// معرّفات القواعد المطابقة فقط.
    ///
    /// نستخدمها داخل المحرك لأن `matching` تعيد مراجع مستعارة من `self`،
    /// و`Engine::ingest` يحتاج `&mut self` لتحديث العدّادات وتنفيذ
    /// الإجراءات. في نفس النطاق لا يصحّ حمل المراجع.
    pub fn matching_ids(&self, event: &LiveEvent) -> Vec<String> {
        self.rules
            .iter()
            .filter(|rule| rule.matches(event))
            .map(|rule| rule.id.clone())
            .collect()
    }

    /// نسخة مملوكة من قاعدة بمعرّفها، أو `None`.
    pub fn find(&self, id: &str) -> Option<&Rule> {
        self.rules.iter().find(|rule| rule.id == id)
    }
}

/// حمولة إجراء بعد تنفيذها، جاهزة للطبقات والواجهة.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ActionOutcome {
    pub rule_id: String,
    pub rule_name: String,
    pub event_id: String,
    pub event_type: String,
    pub nickname: String,
    pub kind: String,
    pub detail: serde_json::Value,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::LiveEvent;

    fn rule_with(conditions: Vec<Condition>) -> Rule {
        Rule {
            id: "r1".into(),
            name: "قاعدة اختبار".into(),
            enabled: true,
            priority: 0,
            trigger: None,
            group_op: Some(GroupOp::All),
            conditions,
            rate: RateGate::default(),
            queue: QueueMode::Serial,
            max_concurrent: 1,
            start_delay_ms: 0,
            actions: vec![],
        }
    }

    #[test]
    fn gift_value_condition_uses_total_value() {
        let event = LiveEvent::gift("g1", "sim", 10, "Rose", 3, 5);
        let rule = rule_with(vec![Condition::Value {
            op: CompareOp::Gte,
            value: 15,
            value2: None,
        }]);
        assert!(rule.matches(&event));
    }

    #[test]
    fn unknown_follower_does_not_match_true() {
        let event = LiveEvent::chat("c1", "sim", 10, "user", "hi");
        let rule = rule_with(vec![Condition::IsFollower {
            expect: BoolExpectation::True,
        }]);
        assert!(!rule.matches(&event));
    }

    #[test]
    fn unknown_follower_matches_any() {
        let event = LiveEvent::chat("c1", "sim", 10, "user", "hi");
        let rule = rule_with(vec![Condition::IsFollower {
            expect: BoolExpectation::Any,
        }]);
        assert!(rule.matches(&event));
    }

    #[test]
    fn any_group_needs_one_match() {
        let event = LiveEvent::chat("c1", "sim", 10, "user", "مرحبا");
        let mut rule = rule_with(vec![
            Condition::Text {
                op: CompareOp::Contains,
                value: "سلام".into(),
            },
            Condition::Text {
                op: CompareOp::Contains,
                value: "مرحبا".into(),
            },
        ]);
        rule.group_op = Some(GroupOp::Any);
        assert!(rule.matches(&event));
        rule.group_op = Some(GroupOp::All);
        assert!(!rule.matches(&event));
    }

    #[test]
    fn trigger_blocks_other_event_types() {
        let mut rule = rule_with(vec![]);
        rule.trigger = Some(EventType::Gift);
        assert!(!rule.matches(&LiveEvent::chat("c1", "sim", 1, "u", "x")));
        assert!(rule.matches(&LiveEvent::gift("g1", "sim", 1, "Rose", 1, 1)));
    }

    #[test]
    fn wildcard_pattern_matches() {
        let event = LiveEvent::chat("c1", "sim", 1, "user", "نص starred هنا");
        let rule = rule_with(vec![Condition::Text {
            op: CompareOp::Matches,
            value: "*starred*".into(),
        }]);
        assert!(rule.matches(&event));
    }

    #[test]
    fn wildcard_anchors_are_honoured() {
        // النجمة الأولى تُهمَل إن طُلب تطابق البادئة. هذا ما كان يُفشل
        // `*starred*` على نص لا يبدأ بـ`starred`.
        // الجدول ثلاثيات: (النص، النمط، المتوقع) لأن الدلالة تتعلق بالطرفين.
        let cases: &[(&str, &str, bool)] = &[
            ("start starred end", "*starred*", true),
            ("start starred end", "starred*", false),
            ("start starred end", "*starred", false),
            ("start starred end", "start*", true),
            ("start starred end", "*end", true),
            ("start starred end", "start*end", true),
            ("start starred end", "start*end*", true),
            // القطع يجب أن تظهر بالترتيب.
            ("start starred end", "start*mid*", false),
            // بلا نجوم: مطابقة كاملة، لا بادئة.
            ("start starred end", "start", false),
            ("start starred end", "start starred end", true),
            // نجوم فقط: تطابق كل نص.
            ("start starred end", "*", true),
            ("start starred end", "**", true),
            // غير موجود.
            ("start starred end", "*absent*", false),
            // عربي: القطع على حدود المحارف لا البايتات.
            ("نص starred هنا", "نص*", true),
            ("نص starred هنا", "*هنا", true),
            ("نص starred هنا", "*starred*", true),
            ("نص starred هنا", "هنا*", false),
        ];
        for (text, pattern, expected) in cases {
            let event = LiveEvent::chat("c1", "sim", 1, "user", *text);
            let rule = rule_with(vec![Condition::Text {
                op: CompareOp::Matches,
                value: (*pattern).to_string(),
            }]);
            assert_eq!(
                rule.matches(&event),
                *expected,
                "النص {text} والنمط {pattern}"
            );
        }
    }

    #[test]
    fn chance_is_deterministic_for_same_event() {
        let event = LiveEvent::chat("c1", "sim", 1, "user", "x");
        let first = chance_hit(&event, 50, Some(7));
        for _ in 0..50 {
            assert_eq!(chance_hit(&event, 50, Some(7)), first);
        }
    }

    #[test]
    fn chance_zero_and_hundred_are_absolute() {
        let event = LiveEvent::chat("c1", "sim", 1, "user", "x");
        assert!(!chance_hit(&event, 0, None));
        assert!(chance_hit(&event, 100, None));
    }

    #[test]
    fn template_renders_all_variables() {
        let mut event = LiveEvent::gift("g1", "sim", 1, "Rose", 2, 5);
        event.user = Some(crate::event::User {
            nickname: "ali".into(),
            ..Default::default()
        });
        let rendered = render_template("{user} أرسل {gift} ×{count} بقيمة {value}", &event);
        assert_eq!(rendered, "ali أرسل Rose ×2 بقيمة 10");
    }

    #[test]
    fn ruleset_orders_by_priority() {
        let mut low = rule_with(vec![]);
        low.id = "low".into();
        low.priority = 1;
        let mut high = rule_with(vec![]);
        high.id = "high".into();
        high.priority = 9;
        let set = RuleSet::new(vec![low, high]);
        let ids: Vec<&str> = set.rules().iter().map(|r| r.id.as_str()).collect();
        assert_eq!(ids, vec!["high", "low"]);
    }
}
