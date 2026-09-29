//! اختبارات العقد: تثبت الشكل الفعلي للـJSON الذي تراه الواجهة.
//!
//! سبب وجودها: `apps/desktop/src/types.ts` و`schemas/*.json` مكتوبان باليد،
//! فأي انحراف في أسماء الحقول يظهر هنا كاختبار فاشل بدل خطأ في الإنتاج.

use crate::event::{EventType, LiveEvent, Payload, User};
use crate::rule::{
    Action, ActionSpec, BoolExpectation, CompareOp, Condition, GroupOp, OnError, QueueMode,
    RateGate, Rule,
};
use serde_json::json;
use std::collections::BTreeMap;

fn sample_rule() -> Rule {
    Rule {
        id: "r1".into(),
        name: "هدية كبيرة".into(),
        enabled: true,
        priority: 10,
        trigger: Some(EventType::Gift),
        group_op: Some(GroupOp::All),
        conditions: vec![
            Condition::Value {
                op: CompareOp::Gte,
                value: 100,
                value2: None,
            },
            Condition::IsFollower {
                expect: BoolExpectation::True,
            },
            Condition::Text {
                op: CompareOp::Contains,
                value: "مباراة".into(),
            },
        ],
        rate: RateGate::new(3, 60_000),
        queue: QueueMode::Serial,
        max_concurrent: 1,
        start_delay_ms: 250,
        actions: vec![ActionSpec {
            action: Action::Speak {
                text: "شكراً {user} على {gift}".into(),
                voice: Some("ar-SA".into()),
                rate: Some(0),
            },
            timeout_ms: 4_000,
            delay_after_ms: 100,
            on_error: OnError::Continue,
        }],
    }
}

#[test]
fn event_type_serializes_as_tagged_kind() {
    assert_eq!(
        serde_json::to_value(EventType::Gift).unwrap(),
        json!({ "kind": "Gift" })
    );
    assert_eq!(
        serde_json::to_value(EventType::Custom("horloge_tick".into())).unwrap(),
        json!({ "kind": "Custom", "name": "horloge_tick" })
    );
    assert_eq!(EventType::StreamStart.as_str(), "stream_start");
}

#[test]
fn gift_payload_uses_value_per_unit_name() {
    let event = LiveEvent::gift("g1", "sim", 1_000, "Rose", 2, 5);
    let value = serde_json::to_value(&event).unwrap();
    assert_eq!(
        value["payload"],
        json!({
            "kind": "Gift",
            "data": {
                "gift_id": null,
                "name": "Rose",
                "count": 2,
                "value_per_unit": 5,
                "total_value": 10
            }
        })
    );
}

#[test]
fn unit_payloads_have_no_data_key() {
    for payload in [Payload::Follow, Payload::Share, Payload::Join] {
        let value = serde_json::to_value(&payload).unwrap();
        assert!(value.get("data").is_none(), "الوحدة لا تُغلّف data");
    }
}

#[test]
fn subscribe_accepts_both_shapes() {
    // الواجهة تسمح بحذف `data` كاملة، لأن `tier` اختياري. إن رفض Rust
    // هذا الشكل فالتعاقد مكسور عند إعادة تحميل ملف محفوظ من الواجهة.
    let without: Payload = serde_json::from_value(json!({ "kind": "Subscribe" })).expect("بلا data");
    assert_eq!(without, Payload::Subscribe { tier: None });
    let empty: Payload =
        serde_json::from_value(json!({ "kind": "Subscribe", "data": {} })).expect("data فارغ");
    assert_eq!(empty, Payload::Subscribe { tier: None });
    let full: Payload =
        serde_json::from_value(json!({ "kind": "Subscribe", "data": { "tier": "level1" } }))
            .expect("tier موجود");
    assert_eq!(
        full,
        Payload::Subscribe {
            tier: Some("level1".into())
        }
    );
}

#[test]
fn custom_accepts_absent_or_empty_data() {
    // `Custom` يحمل خريطة مفتاح/قيمة، وقد تكون فارغة. نفس قاعدة
    // `Subscribe`: غياب `data` يعني خريطة فارغة.
    let absent: Payload = serde_json::from_value(json!({ "kind": "Custom" })).expect("بلا data");
    assert_eq!(absent, Payload::Custom(BTreeMap::new()));

    let empty: Payload =
        serde_json::from_value(json!({ "kind": "Custom", "data": {} })).expect("data فارغ");
    assert_eq!(empty, Payload::Custom(BTreeMap::new()));

    let full: Payload =
        serde_json::from_value(json!({ "kind": "Custom", "data": { "k": "v", "n": 2 } }))
            .expect("بيانات");
    let mut expected = BTreeMap::new();
    expected.insert("k".to_string(), json!("v"));
    expected.insert("n".to_string(), json!(2));
    assert_eq!(full, Payload::Custom(expected));
}

#[test]
fn every_payload_variant_survives_roundtrip() {
    // `Payload` له `Deserialize` يدوي، فلا يغطيه أي اشتقاق. هذا الاختبار
    // هو ما يمنع انحرافاً بين `Payload` و`PayloadWire`: أي variant يُضاف
    // لأحدهما دون الآخر يفشل هنا.
    let cases = vec![
        Payload::Chat { text: "hi".into() },
        Payload::Gift {
            gift_id: Some("g1".into()),
            name: "Rose".into(),
            count: 3,
            value_per_unit: 10,
            total_value: 30,
        },
        Payload::Like { count: 7 },
        Payload::Follow,
        Payload::Share,
        Payload::Join,
        Payload::Subscribe { tier: None },
        Payload::Subscribe {
            tier: Some("level1".into()),
        },
        Payload::StreamStart {
            unique_id: "u1".into(),
            title: Some("t".into()),
        },
        Payload::StreamEnd {
            unique_id: "u1".into(),
            duration_ms: 1000,
        },
        Payload::Custom(BTreeMap::new()),
    ];
    for payload in cases {
        let json = serde_json::to_string(&payload).unwrap();
        let back: Payload =
            serde_json::from_str(&json).unwrap_or_else(|e| panic!("فشل قراءة {json}: {e}"));
        assert_eq!(back, payload, "انحراف في round-trip لـ {json}");
    }
}

#[test]
fn chat_accepts_missing_optional_user() {
    // `user` اختياري في العقد، وملف قديم بلا مستخدم يجب أن يُقرأ.
    let event: LiveEvent = serde_json::from_value(json!({
        "id": "c9",
        "event_type": { "kind": "Chat" },
        "ts_ms": 1,
        "received_ms": 1,
        "source": "sim",
        "payload": { "kind": "Chat", "data": { "text": "hi" } }
    }))
    .expect("حدث بلا user");
    assert!(event.user.is_none());
    assert_eq!(event.nickname(), "");
}

#[test]
fn unknown_follower_survives_roundtrip_as_null() {
    let event = LiveEvent::chat("c1", "sim", 1, "ali", "x");
    let value = serde_json::to_value(&event).unwrap();
    assert_eq!(value["user"]["is_follower"], json!(null));
    let back: LiveEvent = serde_json::from_value(value).unwrap();
    let user = back.user.as_ref().expect("الحدث بلا user");
    assert_eq!(user.is_follower, None);
    // المجهول ليس نفياً ولا إثباتاً. يطابق `Any` فقط.
    assert!(Condition::IsFollower {
        expect: BoolExpectation::Any
    }
    .matches(&back));
    assert!(!Condition::IsFollower {
        expect: BoolExpectation::True
    }
    .matches(&back));
    assert!(!Condition::IsFollower {
        expect: BoolExpectation::False
    }
    .matches(&back));
}

#[test]
fn chat_event_shape_matches_typescript() {
    let mut event = LiveEvent::chat("c1", "sim", 2_000, "ali", "مرحبا");
    event.user = Some(User {
        nickname: "ali".into(),
        unique_id: Some("123".into()),
        is_follower: Some(true),
        is_subscriber: Some(false),
        avatar: None,
    });
    let value = serde_json::to_value(&event).unwrap();
    assert_eq!(value["event_type"], json!({ "kind": "Chat" }));
    assert_eq!(
        value["payload"],
        json!({ "kind": "Chat", "data": { "text": "مرحبا" } })
    );
    assert_eq!(value["user"]["is_follower"], json!(true));
    assert_eq!(value["user"]["avatar"], json!(null));
    // الحقول الاختيارية الفارغة تُحذف، فلا تفترض وجودها في الواجهة.
    assert!(value.get("raw").is_none());
}

#[test]
fn rule_shape_matches_schemas() {
    let value = serde_json::to_value(sample_rule()).unwrap();
    assert_eq!(value["id"], json!("r1"));
    assert_eq!(value["trigger"], json!({ "kind": "Gift" }));
    assert_eq!(value["group_op"], json!("all"));
    assert_eq!(
        value["conditions"][0],
        json!({ "kind": "value", "op": "gte", "value": 100, "value2": null })
    );
    assert_eq!(
        value["conditions"][1],
        json!({ "kind": "is_follower", "expect": "true" })
    );
    assert_eq!(
        value["conditions"][2],
        json!({ "kind": "text", "op": "contains", "value": "مباراة" })
    );
    assert_eq!(value["rate"], json!({ "max_hits": 3, "window_ms": 60000 }));
    assert_eq!(value["queue"], json!("serial"));
    assert_eq!(value["actions"][0]["on_error"], json!("continue"));
    assert_eq!(value["actions"][0]["action"]["kind"], json!("speak"));
}

#[test]
fn rule_deserializes_from_minimal_json() {
    // حقلان فقط: الباقي يأخذ القيم الافتراضية، وهذا ما تتوقعه الواجهة.
    let rule: Rule = serde_json::from_value(json!({
        "id": "r2",
        "name": "أبسط قاعدة",
        "enabled": true,
        "conditions": [],
        "actions": []
    }))
    .unwrap();
    assert_eq!(rule.priority, 0);
    assert!(rule.trigger.is_none());
    assert_eq!(rule.queue, QueueMode::Serial);
    assert_eq!(rule.max_concurrent, 1);
    assert_eq!(rule.rate, RateGate::default());
}

#[test]
fn condition_with_bool_expectation_roundtrips() {
    let condition = Condition::IsSubscriber {
        expect: BoolExpectation::Any,
    };
    let value = serde_json::to_value(&condition).unwrap();
    assert_eq!(value, json!({ "kind": "is_subscriber", "expect": "any" }));
    let back: Condition = serde_json::from_value(value).unwrap();
    assert_eq!(back, condition);
}

#[test]
fn nested_conditions_roundtrip() {
    let condition = Condition::Or {
        conditions: vec![
            Condition::Not {
                condition: Box::new(Condition::Chance {
                    percent: 50,
                    seed: Some(7),
                }),
            },
            Condition::And {
                conditions: vec![Condition::Nickname {
                    op: CompareOp::StartsWith,
                    value: "ali".into(),
                }],
            },
        ],
    };
    let value = serde_json::to_value(&condition).unwrap();
    assert_eq!(value["kind"], json!("or"));
    assert_eq!(value["conditions"][0]["kind"], json!("not"));
    assert_eq!(value["conditions"][0]["condition"]["percent"], json!(50));
    assert_eq!(value["conditions"][1]["kind"], json!("and"));
    let back: Condition = serde_json::from_value(value).unwrap();
    assert_eq!(back, condition);
}

#[test]
fn empty_and_group_never_matches() {
    // مجموعة `all` فارغة لا تُعامل كـ«نعم»: تفرض شرطاً واحداً على الأقل.
    let event = LiveEvent::chat("c1", "sim", 1, "ali", "x");
    assert!(!Condition::And { conditions: vec![] }.matches(&event));
    assert!(!Condition::Or { conditions: vec![] }.matches(&event));
}

#[test]
fn chance_seed_is_optional_but_never_null_when_present() {
    let with_seed = Condition::Chance {
        percent: 30,
        seed: Some(11),
    };
    let value = serde_json::to_value(&with_seed).unwrap();
    assert_eq!(
        value,
        json!({ "kind": "chance", "percent": 30, "seed": 11 })
    );
    let without_seed: Condition =
        serde_json::from_value(json!({ "kind": "chance", "percent": 30 })).unwrap();
    assert_eq!(
        without_seed,
        Condition::Chance {
            percent: 30,
            seed: None
        }
    );
}

#[test]
fn action_variants_use_snake_case_kinds() {
    let pairs = vec![
        (Action::None, "none"),
        (
            Action::PlaySound {
                file_id: "f".into(),
                volume: Some(80),
            },
            "play_sound",
        ),
        (
            Action::AddToGoal {
                goal_id: "g".into(),
                amount: Some(10),
                mode: Some(crate::rule::GoalMode::Event),
            },
            "add_to_goal",
        ),
        (Action::SendChat { text: "hi".into() }, "send_chat"),
    ];
    for (action, expected) in pairs {
        assert_eq!(
            serde_json::to_value(&action).unwrap()["kind"],
            json!(expected)
        );
    }
}

#[test]
fn rule_json_accepted_by_deserialize_with_all_fields() {
    let value = serde_json::to_value(sample_rule()).unwrap();
    let back: Rule = serde_json::from_value(value).unwrap();
    assert_eq!(back, sample_rule());
}
