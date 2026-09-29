# وحدة السحابة — `server/`

> هذا الملف عن التشغيل كاملاً. لخمس إجابات مختصرة:
>
> **ما هي:** خادم Node للمرحلة الثانية: حساب بالبريد ورمز PIN، ومزامنة
> الملفات الشخصية، وحدود Free/Pro. سطحه كله تحت `/v1`.
> **ما لا يدخلها:** لا Rust، ولا React، ولا SQLite، ولا أحداث بث، ولا
> معرفة بالمحرك أو القواعد. تتكلم HTTP وJSON وحدها.
> **كيف تُبنى:** `npm.cmd ci` ثم `npm.cmd run build`، وصورة Docker من
> `Dockerfile`.
> **كيف تُختبر:** `npm.cmd test` (٧٥ اختباراً) و`npm.cmd run typecheck`،
> على قاعدة في الذاكرة بلا PostgreSQL ولا ملف `.env`.
> **من يملكها:** وحدة السحابة. **تُسلَّم لـ:** مطوّر خادم، بلا أي
> معرفة بالباقي.
> **نقطة ضعف يجب إصلاحها:** ترسل `sent:true` بلا إرسال بريد في الإنتاج.

---

هذا خادم المرحلة الثانية من المشروع: حساب بالبريد ورمز PIN، ومزامنة
الملفات الشخصية بين الأجهزة. العميل هو تطبيق سطح المكتب في
`apps/desktop`، وهذا الخادم هو الطرف الآخر: لا يحمل أي حالة بث ولا
يعرف أحداث المنصة. ما يعرفه هو مَن المستخدم، وما مملوكه من ملفات
شخصية.

الحدود (Free/Pro) تُقرَّر في **الخادم** من جدول `plan_limits`، لا في
واجهة التطبيق. والسطح كله تحت `/v1` لإبقاء مجال لإصدار ثانٍ.

عقد الـAPI كاملاً — المسارات والأجسام والأخطاء وأسماء الحقول — في
[`../docs/cloud-api.md`](../docs/cloud-api.md). هذه الصفحة عن التشغيل،
لا عن العقد.

## ما لا يفعله الخادم بعد

**لا إرسال بريد.** لا توجد خدمة بريد في هذه النسخة، ولا تنفيذ لها.

`POST /v1/auth/signup/start` في غير الإنتاج يعيد رمز التأكيد في جسم
الرد، فتستطيع إكمال التسجيل بلا بريد:

```json
{ "sent": true, "code": "04129857" }
```

وفي `NODE_ENV=production` لا يعيد الرمز: يردّ `{ "sent": true }` وحده،
ويُفترض أن يوصل الرمز بالبريد. **ومن يوصّله غير منفَّذ بعد**، فتسجيل
حساب جديد في وضع الإنتاج ينتهي برمز لا يجد صاحبه. عالج ذلك قبل فتح
التسجيل لعامة الناس: نفّذ مزوّد بريد يقرأ الرمز من جدول
`email_codes` ضمن `CODE_TTL_MINUTES`، واجعل `MAIL_FROM` و`PUBLIC_URL`
قيمة حقيقية. البديل الوحيد اليوم إبقاء `NODE_ENV` غير إنتاجي في بيئة
اختبار مغلقة، وهذا لا يصلح لبيئة إنتاج.

## المتطلّبات

- **Node.js 20 فأحدث** (`engines` في `package.json`). وقراءة
  `--env-file` الموضّحة أدناه تحتاج 20.6 فأحدث.
- **PostgreSQL 14 فأحدث** للمخطط في `db/schema.sql`. وعلى 13 فأحدث
  يعمل أيضاً، لأن `gen_random_uuid()` في نواة PostgreSQL منذ 13.
- لا شيء غير ذلك. قاعدة البيانات تُنشأ بأمر `createdb` واحد، و`psql`
  و`docker` اختياريان في التشغيل لا في البناء.

## الإعداد محلياً

أربعة مسارات في `server/`: `src/` للخادم، و`test/` للاختبارات، و
`db/schema.sql` للمخطط، و`scripts/migrate.ts` للترحيل.

```powershell
cd G:\re\my-lansher\server
npm.cmd ci
Copy-Item .env.example .env
```

ثم املأ `.env`. **قيم الحشو لا تصلح للإنتاج عمداً.**
`CHANGE_ME_32_CHARS_MINIMUM` أقصر من 32 محرفاً فيرفضه `config.ts` في
الإنتاج، و`CHANGE_ME_BASE64_OF_32_BYTES` لا يفكّ إلى 32 بايت فيرفضه
أينما كان. ولّد القيم الحقيقية بالأوامر المذكورة في تعليقات `.env`،
**قبل** إنشاء أي حساب محلي: التطوير يقبل الـpeppers القصيرة، فبيئة
تطوير بأساس سرّي معروف تُنتج بُرِداً مشفّرة بتجزئة يسهل ربطها.

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

**الخادم لا يقرأ `.env` بنفسه**، إذ لا اعتماد `dotenv` في المشروع.
إمّا تصدّر المتغيّرات في جلستك، أو تمرّر الملف إلى Node مباشرةً. على
PowerShell:

```powershell
Get-Content .env | Where-Object { $_ -match '^[A-Z_]+=' } | ForEach-Object {
  $name, $value = $_ -split '=', 2
  [Environment]::SetEnvironmentVariable($name, $value, 'Process')
}
```

أو أمر واحد بملفه، بلا سكربت تحميل في المستودع:

```powershell
node --env-file=.env --import tsx src/index.ts
```

## الترحيل

يطبّق `scripts/migrate.ts` ملف `db/schema.sql` على `DATABASE_URL` من
البيئة نفسها التي يقرأها الخادم، فتبقى القيم في مكان واحد. العبارات
المطبَّقة تُسجَّل ببصمة `sha256` في جدول `schema_migrations`، فإعادة
التشغيل على الملف نفسه لا تفعل شيئاً.

```powershell
npm.cmd run migrate
```

وهذا الاختصار في `package.json` يساوي `node --import tsx
scripts/migrate.ts`. أربع خصائص تجعل الترحيل آمناً عند التكرار:
معاملة واحدة، وقفل استشاري يمنع تشغيلين متزامنين، وسجلّ بصمات،
وتحمّل «الموجود مسبقاً» وحده. أي خطأ آخر يُفشل التطبيق كاملاً ولا
يترك نصف مخطط. لا `DROP` ولا حذف بيانات.

عند التشغيل يطبع سطراً لكل عبارة:

```
[تم] CREATE TABLE users (
[تم] CREATE INDEX users_status_idx ON users (status)
[تخطّى] CREATE TABLE users ( — جدول أو فهرس موجود مسبقاً
```

قبل المخطط ينشئ السكربت امتداد `pgcrypto` بـ`IF NOT EXISTS`، لأن
`gen_random_uuid()` مصدره الامتداد قبل PostgreSQL 13. فإن منعت
Cloud SQL صلاحية `CREATE EXTENSION` والنسخة 13 فأحدث، يكمل بتحذير
واحد، لأن الدالة عندها في النواة. أما دون 13 فيفشل الترحيل برسالة
صريحة، بدل أن يفشل عند أول جدول برسالة أغرب.

الترحيل يحتاج `tsx`، وهي أداة تطوير، ولذلك **صورة الإنتاج لا تحوي
سكربت الترحيل**. راجع «الترحيل في الإنتاج» أدناه.

## التشغيل والاختبار

```powershell
npm.cmd run dev        # خادم تطوير مع إعادة تحميل عند التغيير
npm.cmd test           # بلا قاعدة بيانات وبلا متغيّرات بيئة
npm.cmd run typecheck  # tsc --noEmit
npm.cmd run build      # فحص الأنواع ثم إخراج dist/
```

الاختبارات تمرّ على قاعدة بيانات في الذاكرة (`test/fake-db.ts`)، فلا
تحتاج PostgreSQL ولا ملف `.env`. جرّب التدفق كاملاً على `localhost`،
واعلم أن `/v1` مغطّى بالعقد لا باختبار وحدة وحده: اقرأ
[`../docs/cloud-api.md`](../docs/cloud-api.md).

فحص الصحة:

```powershell
curl.exe http://localhost:8080/healthz
```

يردّ `{"ok":true}` إن قبل `pg` الاتصال، و`503` غير ذلك.

## صورة الإنتاج

مرحلتان: بناء يصرّف `src/` إلى `dist/`، وتشغيل يحمل `dist/` وحده مع
اعتماديات التشغيل. البناء لا يتصل بقاعدة بيانات ولا يقرأ أي سرّ.

```powershell
cd G:\re\my-lansher\server
docker build -t lansher-server:local .
docker run --rm -p 8080:8080 --env-file .env lansher-server:local
```

المنفذ من `PORT` لا من `Dockerfile`: `config().port` يقرأه، و`EXPOSE`
توثيق لا توجيه. والحاوية تعمل بمستخدم غير جذر (`USER node`)، فلا
تتسرّب صلاحية الجذر إلى الخدمة لو ثُقّمت أداتها.

لا يوجد `server/.dockerignore` بعد، فسياق البناء يرسل `node_modules`
إن وُجد. أضِفه بثلاثة أسطر (`node_modules` و`.env` و`dist`) أو ابنِ من
مسار نظيف.

## النشر على Cloud Run

1. **قاعدة البيانات.** نسخة Cloud SQL من PostgreSQL 14 فأحدث، مربوطة
   بـVPC Peering أو بعنوان IP عام. أضِف نسخة Cloud Run إلى مستهلكي
   Cloud SQL، أو استعمل وكيل Cloud SQL أثناء الإعداد.
2. **الأسرار.** في Secret Manager، لا في صورة ولا في متغيّرات عادية
   ولا في المستودع. أربعة أسرار على الأقل:

   | الاسم | كيف يُبنى |
   | --- | --- |
   | `DATABASE_URL` | رابط Cloud SQL مع كلمة مرور التطبيق |
   | `EMAIL_PEPPER` | `randomBytes(32).toString('base64url')` |
   | `SESSION_PEPPER` | قيمة جديدة مختلفة عن `EMAIL_PEPPER` |
   | `EMAIL_ENCRYPTION_KEY` | `randomBytes(32).toString('base64')` |

   و`NODE_ENV=production` و`MAIL_FROM` و`PUBLIC_URL` متغيّرات عادية
   تُمرَّر بـ`--set-env-vars`، لأنها ليست أسراراً.
3. **الصورة.** البناء من `server/Dockerfile`، ثم Cloud Build أو Artifact
   Registry:

```powershell
gcloud builds submit --tag REGION-docker.pkg.dev/PROJECT/REPO/lansher-server:latest .
```

4. **الترحيل قبل النشر لا بعده.** الخادم يفشل في أول طلب إن لم يجد
   جداوله. راجع القسم التالي.
5. **النشر.**

```powershell
gcloud run deploy lansher-server --image REGION-docker.pkg.dev/PROJECT/REPO/lansher-server:latest --region REGION --add-cloudsql-instances=INSTANCE:run --set-env-vars NODE_ENV=production,PUBLIC_URL=https://SERVICE-URL --set-secrets DATABASE_URL=DB_URL:latest,EMAIL_PEPPER=EMAIL_PEPPER:latest,SESSION_PEPPER=SESSION_PEPPER:latest,EMAIL_ENCRYPTION_KEY=EMAIL_KEY:latest
```

`--allow-unauthenticated` مطلوب إن أردت اتصال العميل بلا معرّف
خدمتَي. ومن يعرف الرابط يستطيع إذاً إنشاء حساب، فالحدود هنا هي
`MAX_FAILED_LOGINS` و`LOCKOUT_MINUTES` وحدّ معدّل على العنوان في
`index.ts`، لا Cloud Run.

### الترحيل في الإنتاج

**صورة التشغيل لا تنفّذ الترحيل**: لا تحمل `tsx` ولا `scripts/` ولا
`db/schema.sql`. فالفصل مقصود، صورة جديدة بعد شهرين لن تعرف ما الذي
تغيّر في المخطط، وهذا يمنع ترحيلاً عابراً مع كل نشر جديد يعبث بمخطط
قائم. نفّذ الترحيل من مكان يحوي المستودع:

- **من جهاز المطوّر أو من CI.** شغّل وكيل Cloud SQL، ثم وجّه
  `DATABASE_URL` إليه على `localhost:5432` ونفّذ `npm.cmd run migrate`
  من `server/`. الوكيل يتكلّم نصاً صريحاً، وطبقة TLS في `db.ts` مفعَّلة
  في الإنتاج وحده، فاترك `NODE_ENV=development` للترحيل المحلي. كل
  عبارة تُطبَّق وما هو موجود يُتخطّى.
- **بـCloud Run Job.** يحتاج صورة منفصلة تبني الأدوات في طبقة وقت
  التشغيل: `npm ci` بلا `--omit=dev` مع نسخ `scripts/` و`db/`. ليست
  `Dockerfile` الحالية.
- **يدوياً بـ`gcloud sql connect`:** نفس ملف `schema.sql` مباشرةً. لا
  يسجّل البصمة، فترحيل `npm run migrate` لاحقاً يعيد تطبيق DDL
  ويتخطّى الموجود، وهو مقبول لأن المخطط `CREATE` فقط.

تنظيف `audit_log` بعد 90 يوماً لم يُنفَّذ بعد: يحتاج مهمة دورية لم
تُضف في هذه النسخة.
