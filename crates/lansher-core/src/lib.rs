//! `lansher-core` — قلب المنتج: عقد الحدث، محرك القواعد، وحالة التشغيل.
//!
//! هذه crate لا تعرف شيئاً عن Tauri ولا عن الواجهة ولا عن الشبكة. تُبنى
//! فوقها بقية الأجزاء، فتُختبر منفردة وبسرعة.

#[cfg(test)]
mod contract;
pub mod engine;
pub mod event;
pub mod rule;

pub use engine::{DedupeWindow, Engine, EngineReport};
pub use event::{EventType, LiveEvent, Millis, Payload, User};
pub use rule::{
    render_template, Action, ActionOutcome, ActionSpec, BoolExpectation, CompareOp, Condition,
    GoalMode, GroupOp, OnError, QueueMode, RateGate, Rule, RuleSet,
};
