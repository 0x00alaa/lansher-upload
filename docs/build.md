# دليل البناء والتشغيل

## 1. المتطلبات

| الأداة | النسخة | ملاحظة |
|---|---|---|
| Node.js | 20 أو أحدث | مثبَّت: 22.18.0 |
| npm | 10 أو أحدث | استخدم `npm.cmd` إن كان `npm.ps1` محجوباً بسياسة التنفيذ |
| Rust | 1.77 أو أحدث | عبر rustup، والهدف toolchain `stable-x86_64-pc-windows-msvc` |
| Visual C++ Build Tools | 2022 | إجباري للربط على Windows: Component «Desktop development with C++» |
| WebView2 Runtime | أي حديث | يأتي مع Windows 11، ويُنزَّل تلقائياً لغيرها |

## 2. واجهة الويب فقط (بلا Rust)

```powershell
cd G:\re\my-lansher\apps\desktop
npm.cmd install --fetch-retries=12 --fetch-timeout=600000 --maxsockets=2
npm.cmd run build      # فحص العقد + فحص الأنواع + حزمة الإنتاج في dist/
npm.cmd run dev        # http://localhost:5173
```

`npm.cmd run build` يمرّ بأربع خطوات بالترتيب:
1. `npm.cmd run check:contract` — 111 فحص تطابق بين Rust و TypeScript
   و `schemas/*.json`، ويوقف البناء عند أي انحراف.
2. `npm.cmd run check:rust` — فحص بنيوي لـ Rust بلا مُصرِّف.
3. `tsc --noEmit` — أخطاء الأنواع.
4. `vite build` — الحزمة.

الواجهة تعمل في «وضع المحاكاة» بلا Tauri: `MockBridge` ينفّذ نفس العقد.
هذا مقصود لتسريع العمل على الواجهة، وليس بديلاً عن النواة.

## 3. تطبيق سطح المكتب (يلزم Rust)

```powershell
cd G:\re\my-lansher
cargo test --workspace
cd apps\desktop
npm.cmd run tauri:dev
```

`tauri:dev` يبني Rust أولاً، ثم يفتح النافذة. `npm.cmd run tauri:build`
ينتج `src-tauri/target/release/lansher-desktop.exe` وحزم MSI و NSIS.

## 4. إعادة توليد الأيقونات

```powershell
cd G:\re\my-lansher\apps\desktop
npm.cmd run icons
```

يولّد `icon-source.png` ثم كل المقاسات وحاوية `icon.ico` بلا اعتماديات.

## 5. فحوص بلا مُصرِّف

```powershell
cd G:\re\my-lansher
node tools\check-contract.mjs
node tools\check-rust-shape.mjs
```

`check-contract.mjs` (111 فحصاً) يقرأ **الملفات الثلاثة** `types.ts` و
`event.rs` و `rule.rs` و `lib.rs`، ويقارنها مع المخططات:
- أنواع `EventType` و`Payload`: كل نوع في Rust موجود في المخطط والعكس.
- حمولة بلا حقول تُسلسل كوحدة بلا `data`، وذات الحقول تتطلبه، عدا
  `Subscribe` لأن `tier` اختياري فيقبل حذف `data` كاملاً.
- شروط `Condition` وإجراءات `Action` بعد التطبيع إلى `snake_case`.
- أوامر `Request` وحقول كل أمر مقابل فرع `oneOf` في `request.schema.json`.
- أكواد الخطأ، وحقول `BaseRule`، وأن `EventType` ليس نصاً.

`check-rust-shape.mjs` يفحص Rust بلا `cargo`: توازن الأقواس بعد إزالة
التعليقات والسلاسل، وتطابق `Counts` بين `engine.rs` و `types.ts`، وعدم
تكرار حقل في `struct` واحد، ومنع نمط `matching()` داخل `ingest` لأن
`matching` تعيد مراجع مستعارة و`ingest` تحتاج `&mut self`، ومنع الحروف
الصينية والكورية ومحارف الترميز التالفة في كل ملفات Rust و TypeScript.

**لماذا فحوص نصية وليس `cargo`؟**
لأنه لا توجد سلسلة أدوات Rust على هذا الجهاز. هذه الأدوات مكمّلة: لا
تثبت دلالات، ولا تفحص الاستعارات، ولا تستبدل `cargo check` ولا
`cargo test`. الغرض منها أن يُمسَك الانحراف البنيوي في ثوانٍ بدل
انتظار ساعات على شبكة بطيئة.

**كيف نعرف أن الفاحص يعمل؟**
باختبار انحراف: نضيف `BrandNewKind` إلى `Condition` في Rust، فيفشل
`check-contract.mjs`؛ ونعيد نمط `matching()` داخل `ingest`، فيفشل
`check-rust-shape.mjs`؛ ونضع حرفاً صينياً في تعليق واجهة، فيفشل فحص
اللغة. فاحص لا يلتقط شيئاً لا قيمة له.

**انحراف EventType إلى نص.**
`{"kind":"Gift"}` وليس `"Gift"`. إن رأيت في الواجهة قيمة `undefined` في
حقل اسم معرّف، فالحقل غالباً خرج من شكله.

## 6. مشاكل شائعة

**فشل `cargo build` بـ `link.exe not found`.**
Build Tools مثبتة بلا component الرؤوس. أضف «Desktop development with C++»
من Visual Studio Installer.

**`EPERM: rmdir node_modules` بعد إيقاف مفاجئ.**
عمليات أخرى تمسك الملفات. أغلق كل عمليات `node` ثم احذف المجلد يدوياً.

**`ECONNRESET` أثناء `npm install`.**
الشبكة غير مستقرة. أعد الأمر مع `--fetch-retries=12 --maxsockets=2`، كما هو
في السطر أعلاه. على شبكة بطيئة جداً يستغرق التثبيت دقائق.

**واجهة بيضاء بعد `tauri dev`.**
`devUrl` لا يطابق منفذ Vite. المنفذ مثبّت على 5173 في `vite.config.ts`.

**الأيقونة لا تظهر في القائمة.**
`tauri.conf.json` يشير إلى `icons/icon.ico`. أعد `npm.cmd run icons`.

## 7. ترتيب التنفيذ الصحيح بعد تثبيت الأدوات

```powershell
cargo test --workspace      # 1. العقد والمنطق أولاً
npm.cmd run build           # 2. الواجهة
npm.cmd run tauri:dev       # 3. التطبيق كاملاً
npm.cmd run tauri:build     # 4. حزمة التوزيع
```

## 8. حالة التحقق الحالية

`npm.cmd run build` ينجح. أما `cargo test` فلا يمكن تشغيله على هذا
الجهاز: لا سلسلة أدوات Rust ولا Visual C++ Build Tools مثبتة، ولم
يُصرَّف أي سطر Rust. لا يُكتب صف `done` في `docs/parity-matrix.md` قبل
أن ينجح اختبار قابل للتشغيل.
