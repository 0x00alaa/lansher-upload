# وحدة المنطق — `lansher-core`

**ما هي:** منطق القواعد بلغة Rust. أنواع الأحداث والحمولات، ونموذج
القاعدة وشروطها وإجراءاتها، والتقييم والتنفيذ، واختبار تطابق العقد.

**ما لا يدخلها:** لا إدخال ولا إخراج. لا شبكة، ولا قرص، ولا async، ولا
ملف. لا استدعاء لـTauri. لا منطق أعمال في الواجهة. أي حاجة تحتاج I/O
تنتقل إلى `lansher-store` أو `lansher-server`.

**كيف تُبنى:** عضو في مساحة عمل Rust في الجذر. `cargo build -p
lansher-core` من `G:\re\my-lansher`.

**كيف تُختبر:** `cargo test -p lansher-core` (٥٠ اختباراً). كل سلوك له
اختبار في نفس الملف. البوابة الكاملة: `cargo test --workspace`.

**من يملكها:** وحدة المنطق، وهي **المالكة الحصرية للعقد الرباعي**:
`event.rs` و`rule.rs` و`UI/src/types.ts` و`schemas/*.json` و
`docs/event-contract.md`. في أي موجة، وكيل واحد فقط يمسّ هذه الخمسة.
`tools/check-contract.mjs` و`check-rust-shape.mjs` ملكها أيضاً.

**تُسلَّم لـ:** مدرّس Rust. **لا تلمس:** `UI/`، `server/`.

التفاصيل الكاملة: `OWNERS.md` و`tasks/` و`AGENTS.md`.
