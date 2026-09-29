-- مخطط قاعدة بيانات السيرفر السحابي.
--
-- قرارات ثابتة قبل أي جدول:
--
-- 1. **لا نخزّن رمز PIN ولا كلمة مرور ولا كوكي أبداً.** `pin_hash` هو
--    اشتقاق واحد الاتجاه بـArgon2id، فتسريب الجدول لا يمنح دخولاً.
-- 2. **الجلسة تُخزَّن مجزّأة** (`token_hash`). من يقرأ الجدول لا يستطيع
--    نسخ رمز يعمل، حتى لو كان قاعدة البيانات مكشوفة.
-- 3. **كل تعديل على ملف شخصي ينشئ نسخة جديدة**، ولا يُحذف سجل قديم.
--    آخر كتابة تفوز يحذف عمل المستخدم، و`PLAN.md` forbids ذلك.
-- 4. **الحدود (Free/Pro) في جدول** يقرأه الخادم عند كل طلب، فلا تعتمد
--    على فحص يمكن تعديله داخل EXE.
-- 5. `revision` هو عدّاد رتيب لكل ملف. المزامنة تقارن الأرقام، فلا
--    يضيع تعديل جهازين أحدهما.
--
-- هذا المخطط لـPostgreSQL 14+.

-- ---------------------------------------------------------------- users

CREATE TABLE users (
    -- معرّف عام لا تسرب فيه بريد المستخدم أو أي بياناته الشخصية.
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- البريد مجرّد للتطابق فقط. لا نخزّنه نصاً صريحاً.
    -- هل نحتاج بحثاً بالبريد؟ نعم: منع التكرار ومنع إساءة الإرسال.
    -- الحل: نخزّن التجزئة للاست Dedup، والبريد مشفّر-at-rest في Cloud
    -- (Cloud SQL يشفّر القرص)، ونحتفظ بالبريد فقط لتأكيد الإرسال.
    email_hash    BYTEA NOT NULL UNIQUE,
    email_cipher  BYTEA NOT NULL,

    -- اشتقاق واحد الاتجاه بـArgon2id، ومعاملاته تُقاس عند النشر وتُعدّل
    -- عند تغيّر عتاد الخادم. لا نثبّتها الآن كرقم مقدس.
    pin_hash      TEXT NOT NULL,

    -- حالة الحساب: active | locked | deleted
    -- `locked` يفصل بين «فشلت محاولات كثيرة» و«حظر إداري» بلا خلط.
    status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'locked', 'deleted')),

    -- الخطة_free أو pro. الخادم هو الوحيد الذي يقرّر.
    plan          TEXT NOT NULL DEFAULT 'free'
                  CHECK (plan IN ('free', 'pro')),

    -- عدّاد محاولات دخول متتالية. يُصفَّر بالنجاح.
    failed_logins INTEGER NOT NULL DEFAULT 0,

    -- وقت آخر محاولة فاشلة. يُقفل بعد حد خلال نافذة.
    last_failed_at TIMESTAMPTZ,

    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- لا نقبل حساباً محذوفاً بنفس البريد: نتحقق قبل الإدراج.
    CONSTRAINT users_email_present CHECK (octet_length(email_hash) > 0)
);

CREATE INDEX users_status_idx ON users (status);

-- ------------------------------------------------- email_verification_codes

-- رموز التحقق قصيرة العمر لاستخدام واحد. جدول منفصل لأنها بيانات عابرة
-- وحذفها بعد.consuming لا يجب أن يلمس جدول المستخدمين.
CREATE TABLE email_codes (
    -- الرمز نفسه **لا يُخزَّن**. نخزّن تجزئة SHA-256: البحث عن usage
    -- بالرمز يعني hashing ثم query، والاستعلام لا يسرب شيئاً لو سُجّل.
    code_hash     BYTEA PRIMARY KEY,
    user_id       UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,

    -- الغرض: signup | login | reset_email
    purpose       TEXT NOT NULL
                  CHECK (purpose IN ('signup', 'login', 'reset_email')),

    -- عدد المحاولات: حتى لو عُرض الرمز، 5 محاولات ثم يُحذف.
    attempts      INTEGER NOT NULL DEFAULT 0,

    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ NOT NULL,

    CONSTRAINT email_codes_expiry_future CHECK (expires_at > created_at)
);

CREATE INDEX email_codes_user_idx ON email_codes (user_id, purpose);
CREATE INDEX email_codes_expiry_idx ON email_codes (expires_at);

-- ---------------------------------------------------------------- sessions

-- الجلسة Refresh token. مخزّن مجزّأة. access tokenissued client-side short-lived.
CREATE TABLE sessions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,

    -- SHA-256 من token.random 32 bytes. سهل هنا: التوكن عشوائي لا PIN،
    -- فلا داعي لـArgon2 الغامض. Argon2 للـPIN (ثابت منخفض) لا للتوكن.
    token_hash    BYTEA NOT NULL UNIQUE,

    --Refresh rotation. كل استخدام يستبدل التوكن ويسجل previous.
    -- هذا يكتشف إعادة استخدام token قديم = سرقة.
    previous_hash BYTEA,
    rotated_at    TIMESTAMPTZ,

    -- تحديد الجهاز. لازم لإبطال جلسة من جهاز واحد.
    device_label  TEXT NOT NULL DEFAULT 'غير معروف',
    device_id     TEXT,

    -- عنوان IP للتدقيق فقط، لا لتقييد جغرافي.
    created_ip    INET,

    -- RFC3339. نخزّن وقتاً لا نصاً.
    expires_at    TIMESTAMPTZ NOT NULL,
    revoked_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- آخر استخدام: لتحديد الجلسات الخاملة.
    last_used_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX sessions_user_idx ON sessions (user_id, revoked_at);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

-- ----------------------------------------------------------- user_devices

-- كل جهاز يُسجَّل مرة. الحد الأعلى من `plan_limits.max_devices`.
-- الاشتراك Pro يسمح بعدة أجهزة، المجاني بواحد.
CREATE TABLE user_devices (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,

    -- معرّف الجهاز stable: hash من قيمة الـclient random مثبّتة في التطبيق.
    device_id     TEXT NOT NULL,
    label         TEXT NOT NULL,

    -- آخر IP شوهد، للتدقيق فقط. تقييد الأجهزة يعتمد على `device_id`
    -- وعدد الأجهزة المسموح في الخطة، لا على عنوان IP.
    last_ip       INET,
    last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (user_id, device_id)
);

CREATE INDEX user_devices_user_idx ON user_devices (user_id, last_seen_at);

-- --------------------------------------------------------------- profiles

-- الملف الشخصي = قواعد + إعدادات واجهة. **ليست** Personal.
-- محلياً: SQLite. سحابياً: هذا الجدول + rows.
CREATE TABLE profiles (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,

    -- معرّف يعرضه EXE: slug نظيف.
    slug          TEXT NOT NULL,

    -- الاسم المعروض.-ar.
    name          TEXT NOT NULL,

    -- حجم البيانات: JSON بـ rules + settings.
    -- نخزّن JSONBFlexible: البنية تتطور بلا ترحيلات. الاستعلام عن
    -- الحقول من داخل JSONB أقل كفاءة من أعمدة، لكن المرونة أهم هنا.
    content       JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- عدّاد رتيب. كل كتابة تزيده. المزامنة تعتمد عليه.
    revision      INTEGER NOT NULL DEFAULT 1,

    -- آخر تعديل. للعرض ولكشف.device lag.
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- بنوع name، نسمح بأكثر من ملف واحد. ملاحِظ إلى naming.
    UNIQUE (user_id, slug)
);

CREATE INDEX profiles_user_idx ON profiles (user_id, updated_at DESC);

-- ------------------------------------------------------- profile_revisions

-- كل تعديل على ملف يُسجَّل هنا. نسخ.previous محفوظة.
-- الحد: نأخذ آخر 50 نسخة لكل ملف، ونحذف الأقدم مع profiles.
CREATE TABLE profile_revisions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id    UUID NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,

    revision      INTEGER NOT NULL,
    content       JSONB NOT NULL,
    updated_at    TIMESTAMPTZ NOT NULL,

    -- من أي جهاز vale تعديل. مهم لتعارض device.
    device_id     TEXT,

    UNIQUE (profile_id, revision)
);

CREATE INDEX profile_revisions_profile_idx
    ON profile_revisions (profile_id, revision DESC);

-- -------------------------------------------------------------- plan_limits

-- حدود Free/Pro **في السيرفر**. EXE يعرضها ولا يقرّرها.
CREATE TABLE plan_limits (
    plan          TEXT PRIMARY KEY CHECK (plan IN ('free', 'pro')),

    max_devices        INTEGER NOT NULL,
    max_profiles       INTEGER NOT NULL,
    max_rules_per_profile INTEGER NOT NULL,
    max_sessions       INTEGER NOT NULL,

    -- حدود storage بالبايت. 0 = غير محدود.
    max_storage_bytes  BIGINT NOT NULL DEFAULT 0,

    -- الصوت premium أو عادي.
    -- max_tts_chars_per_day INTEGER NOT NULL DEFAULT 0,

    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- القيم الابتدائية. نحدّثها بـmigration لا بـUPDATE يدوي.
INSERT INTO plan_limits (plan, max_devices, max_profiles, max_rules_per_profile, max_sessions, max_storage_bytes)
VALUES
    ('free', 1, 3, 10, 1, 50 * 1024 * 1024),
    ('pro',  5, 50, 200, 5, 2 * 1024 * 1024 * 1024);

-- -------------------------------------------------------------- audit_log

-- سجل أمني. من فعل ماذا ومتى. لا يكتب الأسرار أبداً.
-- retention: 90 يوماً، cleanup cron.
CREATE TABLE audit_log (
    id            BIGSERIAL PRIMARY KEY,
    user_id       UUID REFERENCES users (id) ON DELETE SET NULL,
    session_id    UUID REFERENCES sessions (id) ON DELETE SET NULL,

    -- login_success | login_failed | pin_requested | profile_written
    -- profile_conflict | device_added | device_revoked | plan_changed
    action        TEXT NOT NULL,

    -- سياق JSON. **لا PIN ولا token ولا cookie.**
    context       JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_ip    INET,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_user_idx ON audit_log (user_id, created_at DESC);
CREATE INDEX audit_log_action_idx ON audit_log (action, created_at DESC);

-- ---------------------------------------------------------------- triggers

-- تذكير PostgreSQL بتحديث updated_at تلقائياً عند التعديل.
-- بدون هذا، كل UPDATE يضطر للكتابة اليدوية، وننسى مرة.
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_touch BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER profiles_touch BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------- functions

-- رفع revision بشكل ذرّي يمنع سباق الكتابة: two devices increment same
-- profile at the same time. يضمنRow updated that expected revision.
CREATE OR REPLACE FUNCTION bump_profile_revision(
    p_profile_id UUID,
    p_expected   INTEGER,
    p_content    JSONB,
    p_device_id  TEXT
) RETURNS profiles AS $$
DECLARE
    updated profiles;
BEGIN
    UPDATE profiles
       SET content = p_content,
           revision = revision + 1,
           updated_at = now()
     WHERE id = p_profile_id
       AND revision = p_expected          -- الشرط يحمي من السباق
    RETURNING * INTO updated;

    IF updated IS NULL THEN
        RAISE EXCEPTION 'revision_conflict'
            USING ERRCODE = '40001', HINT = 'غير ق Profiles على جهاز آخر';
    END IF;

    INSERT INTO profile_revisions (profile_id, revision, content, device_id)
    VALUES (updated.id, updated.revision, p_content, p_device_id);

    RETURN updated;
END;
$$ LANGUAGE plpgsql;

-- ملاحظة: الدالة ترفع استثناء عند التعارض، والخادم يترجمه إلى HTTP 409
-- مع `revision` الحالي ليمكن للمستخدم حلّه. لا نكتب فوق تعديل آخر.
