//! عقد الحدث الداخلي.
//!
//! المرجع التنفيذي الكامل في `docs/event-contract.md`. أي تعديل هنا يتبع تعديل
//! الوثيقة، والعكس صحيح.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub type Millis = i64;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", content = "name")]
pub enum EventType {
    Chat,
    Gift,
    Like,
    Follow,
    Share,
    Join,
    Subscribe,
    StreamStart,
    StreamEnd,
    Custom(String),
}

impl EventType {
    pub fn as_str(&self) -> &str {
        match self {
            EventType::Chat => "chat",
            EventType::Gift => "gift",
            EventType::Like => "like",
            EventType::Follow => "follow",
            EventType::Share => "share",
            EventType::Join => "join",
            EventType::Subscribe => "subscribe",
            EventType::StreamStart => "stream_start",
            EventType::StreamEnd => "stream_end",
            EventType::Custom(name) => name,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct User {
    #[serde(default)]
    pub unique_id: Option<String>,
    pub nickname: String,
    #[serde(default)]
    pub is_follower: Option<bool>,
    #[serde(default)]
    pub is_subscriber: Option<bool>,
    #[serde(default)]
    pub avatar: Option<String>,
}

/// الحمولة: `{"kind": "...", "data": {...}}`.
///
/// `Serialize` مشتق، و`Deserialize` مكتوب يدوياً بالأسفل. السبب أن
/// serde لا يقبل `#[serde(default)]` على الـvariant، فيرفض
/// `{"kind":"Subscribe"}` بـ`missing field data`، بينما السكيما
/// و`types.ts` والوثيقة تسمح Three أشكال: بلا `data`، و`data` فارغ،
/// و`data` فيه `tier`. حافظنا على تعريف هذا الـenum كما هو لأن
/// `tools/check-contract.mjs` يقرأ أسماء الحقول منه.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", content = "data")]
pub enum Payload {
    Chat {
        text: String,
    },
    Gift {
        #[serde(default)]
        gift_id: Option<String>,
        name: String,
        count: i64,
        value_per_unit: i64,
        /// يُحسب دائماً من `count * value_per_unit`، ولا يُقرأ من المصدر.
        #[serde(default)]
        total_value: i64,
    },
    Like {
        count: i64,
    },
    Follow,
    Share,
    Join,
    Subscribe {
        #[serde(default)]
        tier: Option<String>,
    },
    StreamStart {
        unique_id: String,
        #[serde(default)]
        title: Option<String>,
    },
    StreamEnd {
        unique_id: String,
        duration_ms: i64,
    },
    Custom(BTreeMap<String, serde_json::Value>),
}

/// نسخة سلكية من `Payload`، تُستخدم فقط عند القراءة.
///
/// تطابق `Payload` حقلاً بحقل، إلا في `Subscribe` و`Custom`: تضع
/// `Option` حول `data` ليقبل غياب المفتاح. `Option` في serde تقرأ
/// `Content::Missing` كـ`None`، فهذه هي الطريقة الوحيدة التي تقبلها
/// serde لغياب `data` مع `content`.
#[derive(Deserialize)]
#[serde(tag = "kind", content = "data")]
enum PayloadWire {
    Chat {
        text: String,
    },
    Gift {
        #[serde(default)]
        gift_id: Option<String>,
        name: String,
        count: i64,
        value_per_unit: i64,
        #[serde(default)]
        total_value: i64,
    },
    Like {
        count: i64,
    },
    Follow,
    Share,
    Join,
    Subscribe(Option<SubscribeWire>),
    StreamStart {
        unique_id: String,
        #[serde(default)]
        title: Option<String>,
    },
    StreamEnd {
        unique_id: String,
        duration_ms: i64,
    },
    Custom(Option<BTreeMap<String, serde_json::Value>>),
}

#[derive(Deserialize)]
struct SubscribeWire {
    #[serde(default)]
    tier: Option<String>,
}

impl<'de> Deserialize<'de> for Payload {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        use PayloadWire as W;
        Ok(match W::deserialize(deserializer)? {
            W::Chat { text } => Payload::Chat { text },
            W::Gift {
                gift_id,
                name,
                count,
                value_per_unit,
                total_value,
            } => Payload::Gift {
                gift_id,
                name,
                count,
                value_per_unit,
                total_value,
            },
            W::Like { count } => Payload::Like { count },
            W::Follow => Payload::Follow,
            W::Share => Payload::Share,
            W::Join => Payload::Join,
            W::Subscribe(data) => Payload::Subscribe {
                tier: data.and_then(|d| d.tier),
            },
            W::StreamStart { unique_id, title } => Payload::StreamStart { unique_id, title },
            W::StreamEnd {
                unique_id,
                duration_ms,
            } => Payload::StreamEnd {
                unique_id,
                duration_ms,
            },
            W::Custom(data) => Payload::Custom(data.unwrap_or_default()),
        })
    }
}

impl Payload {
    /// قيمة الحدث التي تقارن بها القواعد: قيمة الهدية الكلية، أو عدد الإعجابات.
    pub fn numeric_value(&self) -> i64 {
        match self {
            Payload::Gift {
                count,
                value_per_unit,
                ..
            } => count * value_per_unit,
            Payload::Like { count } => *count,
            Payload::Chat { .. } => 0,
            _ => 0,
        }
    }

    /// عدد التكرار الذي تفهمه القواعد: هدية فيها `count` تعني `count = 3` هدية.
    pub fn repeat_count(&self) -> i64 {
        match self {
            Payload::Gift { count, .. } => *count,
            Payload::Like { count } => *count,
            _ => 1,
        }
    }

    /// اسم الهدية أو اسم مختصر يُستخدم في الشروط والواجهة.
    pub fn subject(&self) -> Option<&str> {
        match self {
            Payload::Gift { name, .. } => Some(name),
            Payload::Subscribe { tier } => tier.as_deref(),
            _ => None,
        }
    }

    pub fn text(&self) -> Option<&str> {
        match self {
            Payload::Chat { text } => Some(text),
            _ => None,
        }
    }

    pub fn kind(&self) -> &'static str {
        match self {
            Payload::Chat { .. } => "chat",
            Payload::Gift { .. } => "gift",
            Payload::Like { .. } => "like",
            Payload::Follow => "follow",
            Payload::Share => "share",
            Payload::Join => "join",
            Payload::Subscribe { .. } => "subscribe",
            Payload::StreamStart { .. } => "stream_start",
            Payload::StreamEnd { .. } => "stream_end",
            Payload::Custom(_) => "custom",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LiveEvent {
    /// معرّف فريد من المصدر. أساس منع التكرار، ولا يُولَّد هنا.
    pub id: String,
    pub event_type: EventType,
    /// زمن الحدث عند المنصة.
    pub ts_ms: Millis,
    /// زمن وصوله للمحرك.
    pub received_ms: Millis,
    pub source: String,
    #[serde(default)]
    pub user: Option<User>,
    pub payload: Payload,
    /// للتشخيص فقط. لا يُرسل للواجهة ولا للتكاملات.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw: Option<serde_json::Value>,
}

impl LiveEvent {
    pub fn new(
        id: impl Into<String>,
        event_type: EventType,
        source: impl Into<String>,
        now_ms: Millis,
        payload: Payload,
    ) -> Self {
        let mut event = Self {
            id: id.into(),
            event_type,
            ts_ms: now_ms,
            received_ms: now_ms,
            source: source.into(),
            user: None,
            payload,
            raw: None,
        };
        event.recompute_total_value();
        event
    }

    /// يبني حدث هدية ويحسب `total_value` محلياً بدل الوثوق به.
    pub fn gift(
        id: impl Into<String>,
        source: impl Into<String>,
        now_ms: Millis,
        name: impl Into<String>,
        count: i64,
        value_per_unit: i64,
    ) -> Self {
        Self::new(
            id,
            EventType::Gift,
            source,
            now_ms,
            Payload::Gift {
                gift_id: None,
                name: name.into(),
                count,
                value_per_unit,
                total_value: 0,
            },
        )
    }

    pub fn chat(
        id: impl Into<String>,
        source: impl Into<String>,
        now_ms: Millis,
        nickname: impl Into<String>,
        text: impl Into<String>,
    ) -> Self {
        let mut event = Self::new(
            id,
            EventType::Chat,
            source,
            now_ms,
            Payload::Chat { text: text.into() },
        );
        event.user = Some(User {
            nickname: nickname.into(),
            ..User::default()
        });
        event
    }

    pub fn like(
        id: impl Into<String>,
        source: impl Into<String>,
        now_ms: Millis,
        count: i64,
    ) -> Self {
        Self::new(id, EventType::Like, source, now_ms, Payload::Like { count })
    }

    fn recompute_total_value(&mut self) {
        if let Payload::Gift {
            count,
            value_per_unit,
            total_value,
            ..
        } = &mut self.payload
        {
            *total_value = *count * *value_per_unit;
        }
    }

    pub fn nickname(&self) -> &str {
        self.user
            .as_ref()
            .map(|u| u.nickname.as_str())
            .unwrap_or("")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gift_total_value_is_computed_locally() {
        let event = LiveEvent::gift("g1", "sim", 1_000, "Rose", 3, 5);
        match event.payload {
            Payload::Gift { total_value, .. } => assert_eq!(total_value, 15),
            other => panic!("expected gift, got {other:?}"),
        }
        assert_eq!(event.payload.numeric_value(), 15);
    }

    #[test]
    fn total_value_is_recomputed_even_if_source_lies() {
        let mut event = LiveEvent::gift("g1", "sim", 1_000, "Rose", 2, 10);
        if let Payload::Gift { total_value, .. } = &mut event.payload {
            *total_value = 999_999;
        }
        event.recompute_total_value();
        assert_eq!(event.payload.numeric_value(), 20);
    }

    #[test]
    fn event_type_keeps_custom_name() {
        let event = LiveEvent::new(
            "c1",
            EventType::Custom("horloge_tick".into()),
            "sim",
            1,
            Payload::Custom(BTreeMap::new()),
        );
        assert_eq!(event.event_type.as_str(), "horloge_tick");
    }
}
