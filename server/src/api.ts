/**
 * عقد HTTP السحابي: نسخة TypeScript من `schemas/cloud.schema.json`.
 *
 * المرجع التنفيذي هو `docs/cloud-api.md`. المخطط وهذا الملف والوثيقة
 * ثلاثة أوجه لعقد واحد، و`tools/check-contract.mjs` يفحص تطابق
 * المخطط بهذا الملف ويفشل البناء عند الانحراف.
 *
 * **ملف أنواع سلك لا تنفيذ.** لا دوال ولا قرارات، ولا حتى نسخة من
 * أنواع المجال. الاستثناء الوحيد خريطة الحالة في آخره لأنها جزء من
 * العقد: العميل يحتاج أن يفرّق تعارض المراجعة (يسحب ثم يعيد) عن تجاوز
 * التخزين (يخفّف المحتوى)، والرقمان وحدهما يقولان ذلك.
 *
 * **كل اسم حقل هنا على السلك، وكله `snake_case` بلا استثناء.** أسماء
 * حقول JSON لا تُترجم ولا تُختصر، طلباً كان أم رداً: `device_id`
 * و`expected_revision` و`refresh_token`، وكذلك `access_token` و
 * `updated_at` و`device_label` في الردود.
 *
 * أنواع المجال في `auth.ts` و`sync.ts` (`AuthResult` و`Tokens` و
 * `SessionView` و`ProfileSummary`) تكتب `camelCase` لأنه عُرف
 * TypeScript، وهي **داخلية لا سلكية**: لا يستوردها هذا الملف ولا يوفّر
 * لها أسماء، لأنها لا تُسلسل إلى العميل. التويل يتم في `index.ts` عند
 * نقطة التسلسل الوحيدة (`wireTokens` و`wireProfile`)، فلا تعرف وحدة
 * المجال شيئاً عن HTTP. فإذا قرأت اسم حقل في هذا الملف فهو اسم على
 * الشبكة حرفاً بحرف.
 *
 * رمز الخطأ ثابت للاستهلاك الآلي، والواجهة تبني رسالتها منه بلغتها ولا
 * تترجم الرمز نفسه.
 */

/** طريقة HTTP. نفس القيم في `x-routes` بالمخطط. */
export type CloudMethod = "GET" | "POST" | "PUT" | "DELETE";

/** شرط المصادقة: `bearer` يعني ترويسة توكن وصول، و`none` يعني بلا توكن. */
export type CloudAuth = "none" | "bearer";

/**
 * رموز خطأ نطاق المصادقة.
 *
 * نوع المجال `AuthCode` في `auth.ts` يضم `ok` وهي ليست خطأً: لا ترد
 * أبداً في جسم رد، فلا تدخل هذا العقد.
 *
 * `email_taken` و`device_limit` محجوزان لا مستعملان: طلب التسجيل لا
 * يفرق بين بريد مستخدم وآخر، وتسجيل الدخول يصوغ تجاوز الجلسة
 * `session_limit`. وجودهما في العقد يعني أن لهما معنى محجوز، وغيابهما
 * من ردود المسارات اليوم قرار مقصود لا نقص.
 */
export type AuthErrorCode =
  | "invalid_credentials"
  | "session_invalid"
  | "session_expired"
  | "invalid_code"
  | "code_expired"
  | "account_locked"
  | "email_taken"
  | "rate_limited"
  | "too_many_attempts"
  | "device_limit"
  | "session_limit";

/** رموز خطأ نطاق المزامنة. نفس قيم `SyncCode` في `sync.ts`. */
export type SyncErrorCode =
  | "not_found"
  | "invalid_slug"
  | "slug_taken"
  | "invalid_name"
  | "invalid_content"
  | "profile_limit"
  | "rule_limit"
  | "storage_limit"
  | "revision_conflict";

/**
 * رموز تردّها وسيط الأخطاء في `index.ts` مباشرة، فلا تمرّ بخريطة
 * الحالة: جسم تالف قبل المسارات، وخطأ غير متوقع بعد فشل كل شيء.
 */
export type TransportErrorCode = "invalid_body" | "internal";

/** كل رمز خطأ في HTTP السحابي. */
export type CloudErrorCode = AuthErrorCode | SyncErrorCode | TransportErrorCode;

/**
 * حالة HTTP لكل رمز. نفس خريطة `STATUS` في `server/src/index.ts`،
 * ومضافاً إليها الرموز التي تردّها وسيط الأخطاء. الرمز غير المعروف
 * في الخادم يردّ `internal`، فلا تبنِ واجهة على رمز لا تراه هنا.
 */
export const CLOUD_ERROR_STATUS: Readonly<Record<CloudErrorCode, number>> = {
  invalid_credentials: 401,
  session_invalid: 401,
  session_expired: 401,
  invalid_code: 400,
  code_expired: 410,
  account_locked: 423,
  email_taken: 409,
  rate_limited: 429,
  too_many_attempts: 429,
  device_limit: 409,
  session_limit: 409,
  profile_limit: 409,
  rule_limit: 409,
  storage_limit: 409,
  invalid_slug: 400,
  invalid_name: 400,
  invalid_content: 400,
  slug_taken: 409,
  revision_conflict: 409,
  not_found: 404,
  invalid_body: 400,
  internal: 500,
};

/**
 * الخطة. يقرّرها الخادم وحده: لا تُرسل في أي طلب، والعميل يعرض ما
 * رده في الدخول ولا يحسب حدوده ولا يعدّلها. رد التجديد لا يحملها.
 */
export type CloudPlan = "free" | "pro";

/** جسد الرد الفاشل: رمز واحد لا غير. لا `message`، فلا نص يُقارن. */
export interface CloudError {
  readonly code: CloudErrorCode;
}

/** رد فحص الصحة. ليس خطأً، فليس له رمز: الفشل هنا `503` لا `4xx`. */
export interface HealthStatus {
  readonly ok: boolean;
}

// -------------------------------------------------------------- المصادقة

/** `POST /v1/auth/signup/start` */
export interface SignupStartRequest {
  readonly email: string;
}

/**
 * `POST /v1/auth/signup/start` رد `202`.
 *
 * `code` يظهر في التطوير والاختبار وحدهما: في الإنتاج يُرسَل الرمز
 * بالبريد ولا يُعاد. للعميل الإنتاجي الحقل غائب دائماً.
 */
export interface SignupStartAccepted {
  readonly sent: boolean;
  readonly code?: string;
}

/** `POST /v1/auth/signup/confirm` */
export interface SignupConfirmRequest {
  readonly email: string;
  readonly code: string;
}

/**
 * `POST /v1/auth/signup/confirm` رد `201`.
 *
 * الـPIN يعاد مرة واحدة هنا. لا مسار استعادة ولا تغيير، فليس في العقد
 * طريقة تعيده ثانية، ويجب ألا يضاف مسار كهذا إلا بقرار صريح.
 */
export interface SignupConfirmCreated {
  readonly pin: string;
}

/**
 * `POST /v1/auth/login`
 *
 * `device_id` يولّده العميل مرة واحدة ويثبّته محلياً: هو ما يميّز
 * الأجهزة، لا عنوان IP. غياب أي حقل يعامله الخادم كسلسلة فارغة.
 */
export interface LoginRequest {
  readonly email: string;
  readonly pin: string;
  readonly device_id: string;
  readonly device_label: string;
}

/** `POST /v1/auth/login` رد `200`: زوج التوكنات كاملاً. */
export interface LoginResponse {
  readonly access_token: string;
  readonly refresh_token: string;
  /** ثوانٍ حتى انتهاء توكن الوصول. لا نضع تاريخاً: الساعة في العميل. */
  readonly expires_in: number;
  readonly user_id: string;
  readonly plan: CloudPlan;
}

/** `POST /v1/auth/refresh`: التوكن في الجسم لا الترويسة. */
export interface RefreshRequest {
  readonly refresh_token: string;
}

/** `POST /v1/auth/refresh` رد `200`. لا `user_id` ولا `plan`. */
export interface RefreshResponse {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly expires_in: number;
}

/**
 * `POST /v1/auth/logout`
 *
 * لا ترويسة هنا: التوكن في الجسم هو مفتاح الإبطال نفسه. الرد `204`
 * دائماً، فوجود التوكن معلومة لا نضيف عليها تأكيداً.
 */
export interface LogoutRequest {
  readonly refresh_token: string;
}

/** عنصر `sessions`: جلسة واحدة كما يعيدها الخادم. */
export interface SessionView {
  readonly device_label: string;
  /** وقت ISO 8601. */
  readonly created_at: string;
  /** وقت ISO 8601. يحدّثه كل طلب يمرّ بحارس التوكن. */
  readonly last_used_at: string;
  /** محسوب في الخادم: غير مُبطل ولم ينتهِ. */
  readonly active: boolean;
}

/** `GET /v1/auth/sessions` رد `200`. القائمة ملفوفة، لا مصفوفة عارية. */
export interface SessionListResponse {
  readonly sessions: readonly SessionView[];
}

// --------------------------------------------------------------- المزامنة

/**
 * محتوى الملف كما يقبله الخادم.
 *
 * الفحص بنيوي: الحقول المطلوبة في كل قاعدة وأنواعها، لا ما عداها.
 * الحقول التي لا نعرفها تُقبل ولا تُرفض، فعميل أحدث يجب أن يعمل مع
 * خادم أقدم. ودلالات الشرط لا يقرّرها هذا العقد ولا الخادم: يجيب
 * عنها المحرك وحده. الحقل `settings` يمرّ كما هو، فتحريره في
 * `UI/src/types.ts`.
 */
export interface CloudProfileContent {
  readonly rules?: readonly CloudRule[];
  readonly settings?: Readonly<Record<string, unknown>>;
  readonly [key: string]: unknown;
}

/**
 * قاعدة داخل `content`.
 *
 * هذه الحقول الستة هي كل ما يفحصه الخادم. ما عداها يتبع
 * `schemas/rule.schema.json` و`UI/src/types.ts`، ولا نكرره
 * هنا: تكرار العقد الثاني هو كيف ينحرف عقدان.
 */
export interface CloudRule {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly priority: number;
  readonly conditions: readonly unknown[];
  readonly actions: readonly unknown[];
  readonly [key: string]: unknown;
}

/** ملف بلا محتوى: يكفي للعرض وللمزامنة. */
export interface ProfileSummary {
  readonly id: string;
  /** معرّف يعرضه العميل، وحيد داخل الحساب. */
  readonly slug: string;
  readonly name: string;
  /** عدّاد رتيب يزيد في كل كتابة. به تُكتشف الكتابة فوق تعديل غيرك. */
  readonly revision: number;
  /** وقت ISO 8601: ما يقارن به العميل مزامنته. */
  readonly updated_at: string;
}

/** ملف واحد بمحتواه: ملخص زائد `content`. */
export interface ProfileView extends ProfileSummary {
  readonly content: CloudProfileContent;
}

/** رد قائمة الملفات، في `GET /v1/sync/profiles` و`.../changed`. */
export interface ProfileListResponse {
  readonly profiles: readonly ProfileSummary[];
}

/** استعلام `GET /v1/sync/profiles/changed`. وحيد في المسار كله. */
export interface ProfileChangedQuery {
  /** وقت ISO 8601. غيابه يعني كل الملفات: يردّها الخادم كلها. */
  readonly since?: string;
}

/** `POST /v1/sync/profiles`. الحدود تُفحص قبل الكتابة، فالرفض لا أثر له. */
export interface CreateProfileRequest {
  readonly slug: string;
  readonly name: string;
  readonly content: CloudProfileContent;
  /** من أي جهاز جاءت الكتابة. غيابه يعني جهازاً غير معروف. */
  readonly device_id?: string;
}

/**
 * `PUT /v1/sync/profiles/:id`
 *
 * `expected_revision` إجباري: هو ما يمنع آخر كتابة من محو عمل غيرك.
 * تعارضه يردّ `revision_conflict`، والحلّ عند المستخدم بسحب ثم إعادة،
 * لا عند الخادم بترجيح أحد الكاتبين.
 */
export interface WriteProfileRequest {
  readonly expected_revision: number;
  readonly name: string;
  readonly content: CloudProfileContent;
  readonly device_id?: string;
}

/**
 * `DELETE /v1/sync/profiles/:id`
 *
 * لا اسم ولا محتوى: الحذف يفحص المراجعة وحدها. حذف جهاز لنسخة عدّلها
 * جهاز آخر يفشل `revision_conflict` ولا يمحو التعديل.
 */
export interface DeleteProfileRequest {
  readonly expected_revision: number;
  readonly device_id?: string;
}

// ------------------------------------------------------------- جدول المسارات

/**
 * كل مسار في العقد: الطريقة مع المسار معاً، حتى لا يخلط العميل
 * `POST /v1/sync/profiles` بسحب ملف واحد بـ`GET /v1/sync/profiles/:id`.
 *
 * ترتيب السطرين هنا هو ترتيب التسجيل في `index.ts`، و`changed` مسجَّل
 * قبل `:id` في الخادم، فلا يبتلعه معامل المسار.
 */
export type CloudRoute =
  | { readonly method: "GET"; readonly path: "/healthz" }
  | { readonly method: "POST"; readonly path: "/v1/auth/signup/start" }
  | { readonly method: "POST"; readonly path: "/v1/auth/signup/confirm" }
  | { readonly method: "POST"; readonly path: "/v1/auth/login" }
  | { readonly method: "POST"; readonly path: "/v1/auth/refresh" }
  | { readonly method: "POST"; readonly path: "/v1/auth/logout" }
  | { readonly method: "GET"; readonly path: "/v1/auth/sessions" }
  | { readonly method: "GET"; readonly path: "/v1/sync/profiles" }
  | { readonly method: "GET"; readonly path: "/v1/sync/profiles/changed" }
  | { readonly method: "GET"; readonly path: "/v1/sync/profiles/:id" }
  | { readonly method: "POST"; readonly path: "/v1/sync/profiles" }
  | { readonly method: "PUT"; readonly path: "/v1/sync/profiles/:id" }
  | { readonly method: "DELETE"; readonly path: "/v1/sync/profiles/:id" };
