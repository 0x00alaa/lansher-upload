//! تخزين محلي: المخطط، الملفات الشخصية، القواعد، والإعدادات.

use lansher_core::{Rule, User};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("خطأ قاعدة البيانات: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("خطأ JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("خطأ نظام الملفات: {0}")]
    Io(#[from] std::io::Error),
    #[error("معرّف غير موجود: {0}")]
    NotFound(String),
    #[error("تعارض تعديل محلي مع نسخة أحدث على الخادم: {0}")]
    Conflict(String),
}

/// ملف شخصي محلي: هوية واحدة على الجهاز + قواعدها وإعداداتها.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Profile {
    pub id: String,
    pub name: String,
    /// معرّف حساب البث الذي يخصّه الملف، إن وُجد ربط.
    #[serde(default)]
    pub bound_unique_id: Option<String>,
    /// زوج المفاتيح العام/الخاص: يبقى المفتاح الخاص محلياً ولا يُرفع.
    #[serde(default)]
    pub identity_keys: Option<IdentityKeys>,
    #[serde(default)]
    pub settings: serde_json::Value,
    #[serde(default)]
    pub rules: Vec<Rule>,
    /// إصدار محلي يزيد مع كل تعديل، وتستعمله المزامنة لكشف التعارض.
    pub local_revision: i64,
    /// النسخة التي نزلت من السحابة، أو `None` إن كان الملف محلياً فقط.
    #[serde(default)]
    pub remote_revision: Option<i64>,
    #[serde(default)]
    pub updated_at_ms: i64,
    #[serde(default)]
    pub dirty: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IdentityKeys {
    /// مفتاح توقيع عام بصيغة Base64.
    pub public_key_b64: String,
    /// مفتاح خاص Ed25519 بصيغة Base64. لا يغادر الجهاز إلا بموافقة صريحة.
    pub private_key_b64: Option<String>,
    pub created_at_ms: i64,
}

impl Default for Profile {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: "ملف جديد".into(),
            bound_unique_id: None,
            identity_keys: None,
            settings: serde_json::json!({}),
            rules: Vec::new(),
            local_revision: 0,
            remote_revision: None,
            updated_at_ms: 0,
            dirty: true,
        }
    }
}

impl Profile {
    pub fn new(id: impl Into<String>, name: impl Into<String>, now_ms: i64) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            updated_at_ms: now_ms,
            ..Default::default()
        }
    }

    pub fn touch(&mut self, now_ms: i64) {
        self.local_revision += 1;
        self.updated_at_ms = now_ms;
        self.dirty = true;
    }

    pub fn bind(&mut self, unique_id: impl Into<String>, now_ms: i64) {
        self.bound_unique_id = Some(unique_id.into());
        self.touch(now_ms);
    }
}

/// سجل دخول محلي مبسّط: الاسم والصورة والمعرّف فقط.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AccountRecord {
    pub user: User,
    #[serde(default)]
    pub last_used_ms: i64,
    /// حضور رمز الجلسة على هذا الجهاز، أو `None` بعد تسجيل الخروج.
    #[serde(default)]
    pub session_token: Option<String>,
}

pub struct Store {
    conn: Connection,
    path: PathBuf,
}

impl Store {
    pub fn open(path: &Path) -> Result<Self, StoreError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        let store = Self {
            conn,
            path: path.to_path_buf(),
        };
        store.migrate()?;
        Ok(store)
    }

    /// قاعدة في الذاكرة، للاختبارات.
    pub fn open_in_memory() -> Result<Self, StoreError> {
        let conn = Connection::open_in_memory()?;
        let store = Self {
            conn,
            path: PathBuf::from(":memory:"),
        };
        store.migrate()?;
        Ok(store)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    fn migrate(&self) -> Result<(), StoreError> {
        self.conn.execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS meta (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS profiles (
                id              TEXT PRIMARY KEY,
                name            TEXT NOT NULL,
                bound_unique_id TEXT,
                identity_keys   TEXT,
                settings        TEXT NOT NULL DEFAULT '{}',
                rules           TEXT NOT NULL DEFAULT '[]',
                local_revision  INTEGER NOT NULL DEFAULT 0,
                remote_revision INTEGER,
                updated_at_ms   INTEGER NOT NULL DEFAULT 0,
                dirty           INTEGER NOT NULL DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS accounts (
                user_json     TEXT PRIMARY KEY,
                last_used_ms  INTEGER NOT NULL DEFAULT 0,
                session_token TEXT
            );

            CREATE TABLE IF NOT EXISTS seen_events (
                event_id    TEXT PRIMARY KEY,
                seen_at_ms  INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS goals (
                id      TEXT PRIMARY KEY,
                name    TEXT NOT NULL,
                target  INTEGER NOT NULL DEFAULT 0,
                current INTEGER NOT NULL DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_profiles_dirty
                ON profiles (dirty, updated_at_ms);
            CREATE INDEX IF NOT EXISTS idx_seen_events_time
                ON seen_events (seen_at_ms);
            "#,
        )?;
        Ok(())
    }

    // ---------------- الملفات الشخصية ----------------

    pub fn save_profile(&mut self, profile: &Profile) -> Result<(), StoreError> {
        self.conn.execute(
            r#"
            INSERT INTO profiles
                (id, name, bound_unique_id, identity_keys, settings, rules,
                 local_revision, remote_revision, updated_at_ms, dirty)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                bound_unique_id = excluded.bound_unique_id,
                identity_keys = excluded.identity_keys,
                settings = excluded.settings,
                rules = excluded.rules,
                local_revision = excluded.local_revision,
                remote_revision = excluded.remote_revision,
                updated_at_ms = excluded.updated_at_ms,
                dirty = excluded.dirty
            "#,
            params![
                profile.id,
                profile.name,
                profile.bound_unique_id,
                profile
                    .identity_keys
                    .as_ref()
                    .map(serde_json::to_string)
                    .transpose()?,
                serde_json::to_string(&profile.settings)?,
                serde_json::to_string(&profile.rules)?,
                profile.local_revision,
                profile.remote_revision,
                profile.updated_at_ms,
                i64::from(profile.dirty),
            ],
        )?;
        Ok(())
    }

    pub fn load_profile(&self, id: &str) -> Result<Profile, StoreError> {
        let row = self
            .conn
            .query_row(
                r#"
                SELECT id, name, bound_unique_id, identity_keys, settings, rules,
                       local_revision, remote_revision, updated_at_ms, dirty
                FROM profiles WHERE id = ?1
                "#,
                params![id],
                row_to_profile,
            )
            .optional()?;
        row.ok_or_else(|| StoreError::NotFound(id.to_string()))
    }

    pub fn list_profiles(&self) -> Result<Vec<Profile>, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, bound_unique_id, identity_keys, settings, rules, \
             local_revision, remote_revision, updated_at_ms, dirty \
             FROM profiles ORDER BY updated_at_ms DESC",
        )?;
        let rows = stmt.query_map([], row_to_profile)?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub fn delete_profile(&self, id: &str) -> Result<(), StoreError> {
        let changed = self
            .conn
            .execute("DELETE FROM profiles WHERE id = ?1", params![id])?;
        if changed == 0 {
            return Err(StoreError::NotFound(id.to_string()));
        }
        Ok(())
    }

    pub fn dirty_profiles(&self) -> Result<Vec<Profile>, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, bound_unique_id, identity_keys, settings, rules, \
             local_revision, remote_revision, updated_at_ms, dirty \
             FROM profiles WHERE dirty = 1 ORDER BY updated_at_ms ASC",
        )?;
        let rows = stmt.query_map([], row_to_profile)?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    /// يدمج نسخة سحابية: آخر كاتب يفوز، مع كشف التعارض.
    pub fn merge_remote(
        &mut self,
        remote: &Profile,
        now_ms: i64,
    ) -> Result<MergeOutcome, StoreError> {
        let local = self.load_profile(&remote.id).ok();
        let outcome = match local {
            None => {
                self.save_profile(&Profile {
                    dirty: false,
                    ..remote.clone()
                })?;
                MergeOutcome::Created
            }
            Some(local) if !local.dirty => {
                if local.local_revision >= remote.local_revision {
                    MergeOutcome::Ignored
                } else {
                    self.save_profile(&Profile {
                        dirty: false,
                        ..remote.clone()
                    })?;
                    MergeOutcome::Updated
                }
            }
            Some(local) => {
                if local.local_revision > remote.local_revision {
                    MergeOutcome::LocalWins
                } else if local.local_revision == remote.local_revision
                    && local.updated_at_ms >= remote.updated_at_ms
                {
                    MergeOutcome::Ignored
                } else {
                    // التعديل المحلي غير المرفوع يتعارض مع نسخة أعلى من الخادم.
                    self.conflict_log(&local, remote, now_ms)?;
                    MergeOutcome::Conflict
                }
            }
        };
        Ok(outcome)
    }

    fn conflict_log(
        &self,
        local: &Profile,
        remote: &Profile,
        _now_ms: i64,
    ) -> Result<(), StoreError> {
        self.conn.execute(
            "INSERT INTO meta (key, value) VALUES ('last_conflict', ?1) \
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![serde_json::json!({
                "profile_id": local.id,
                "local_revision": local.local_revision,
                "remote_revision": remote.local_revision,
            })
            .to_string()],
        )?;
        Ok(())
    }

    // ---------------- الحسابات ----------------

    pub fn save_account(&mut self, account: &AccountRecord) -> Result<(), StoreError> {
        self.conn.execute(
            "INSERT INTO accounts (user_json, last_used_ms, session_token) \
             VALUES (?1, ?2, ?3) \
             ON CONFLICT(user_json) DO UPDATE SET \
                last_used_ms = excluded.last_used_ms, \
                session_token = excluded.session_token",
            params![
                serde_json::to_string(&account.user)?,
                account.last_used_ms,
                account.session_token,
            ],
        )?;
        Ok(())
    }

    pub fn list_accounts(&self) -> Result<Vec<AccountRecord>, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT user_json, last_used_ms, session_token FROM accounts \
                      ORDER BY last_used_ms DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            let user_json: String = row.get(0)?;
            Ok((
                user_json,
                row.get::<_, i64>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (user_json, last_used_ms, session_token) = row?;
            out.push(AccountRecord {
                user: serde_json::from_str(&user_json)?,
                last_used_ms,
                session_token,
            });
        }
        Ok(out)
    }

    pub fn sign_out_all(&mut self) -> Result<usize, StoreError> {
        Ok(self
            .conn
            .execute("UPDATE accounts SET session_token = NULL", [])?)
    }

    // ---------------- منع التكرار بعد إعادة التشغيل ----------------

    pub fn remember_seen(&mut self, event_id: &str, now_ms: i64) -> Result<(), StoreError> {
        self.conn.execute(
            "INSERT INTO seen_events (event_id, seen_at_ms) VALUES (?1, ?2) \
             ON CONFLICT(event_id) DO UPDATE SET seen_at_ms = excluded.seen_at_ms",
            params![event_id, now_ms],
        )?;
        Ok(())
    }

    pub fn recent_seen(&self, limit: usize) -> Result<Vec<String>, StoreError> {
        let mut stmt = self
            .conn
            .prepare("SELECT event_id FROM seen_events ORDER BY seen_at_ms DESC LIMIT ?1")?;
        let rows = stmt.query_map(params![limit as i64], |row| row.get::<_, String>(0))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub fn prune_seen(&mut self, older_than_ms: i64) -> Result<usize, StoreError> {
        Ok(self.conn.execute(
            "DELETE FROM seen_events WHERE seen_at_ms < ?1",
            params![older_than_ms],
        )?)
    }

    // ---------------- الأهداف ----------------

    pub fn add_to_goal(&mut self, goal_id: &str, amount: i64) -> Result<i64, StoreError> {
        self.conn.execute(
            "INSERT INTO goals (id, name, target, current) VALUES (?1, '', 0, ?2) \
             ON CONFLICT(id) DO UPDATE SET current = current + ?2",
            params![goal_id, amount],
        )?;
        let current: i64 = self.conn.query_row(
            "SELECT current FROM goals WHERE id = ?1",
            params![goal_id],
            |row| row.get(0),
        )?;
        Ok(current)
    }

    pub fn goal(&self, goal_id: &str) -> Result<Option<(String, i64, i64)>, StoreError> {
        let row = self
            .conn
            .query_row(
                "SELECT name, target, current FROM goals WHERE id = ?1",
                params![goal_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?;
        Ok(row)
    }

    // ---------------- إعدادات عامة ----------------

    pub fn set_meta(&mut self, key: &str, value: &str) -> Result<(), StoreError> {
        self.conn.execute(
            "INSERT INTO meta (key, value) VALUES (?1, ?2) \
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn get_meta(&self, key: &str) -> Result<Option<String>, StoreError> {
        Ok(self
            .conn
            .query_row(
                "SELECT value FROM meta WHERE key = ?1",
                params![key],
                |row| row.get(0),
            )
            .optional()?)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MergeOutcome {
    Created,
    Updated,
    Ignored,
    LocalWins,
    Conflict,
}

fn row_to_profile(row: &rusqlite::Row<'_>) -> rusqlite::Result<Profile> {
    let identity_keys: Option<String> = row.get(3)?;
    Ok(Profile {
        id: row.get(0)?,
        name: row.get(1)?,
        bound_unique_id: row.get(2)?,
        identity_keys: match identity_keys {
            Some(json) => Some(serde_json::from_str(&json).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    3,
                    rusqlite::types::Type::Text,
                    error.into(),
                )
            })?),
            None => None,
        },
        settings: parse_json_field(row, 4)?,
        rules: parse_json_field(row, 5)?,
        local_revision: row.get(6)?,
        remote_revision: row.get(7)?,
        updated_at_ms: row.get(8)?,
        dirty: row.get::<_, i64>(9)? != 0,
    })
}

fn parse_json_field<T: serde::de::DeserializeOwned>(
    row: &rusqlite::Row<'_>,
    index: usize,
) -> rusqlite::Result<T> {
    let raw: String = row.get(index)?;
    serde_json::from_str(&raw).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            index,
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use lansher_core::{Action, ActionSpec, Condition, Rule};

    fn sample_profile(id: &str, revision: i64, dirty: bool) -> Profile {
        let mut profile = Profile::new(id, "ملف", 1_000);
        profile.local_revision = revision;
        profile.dirty = dirty;
        profile.rules = vec![Rule {
            id: "r1".into(),
            name: "قاعدة".into(),
            enabled: true,
            priority: 0,
            trigger: None,
            group_op: None,
            conditions: vec![Condition::IsFollower {
                expect: lansher_core::BoolExpectation::Any,
            }],
            rate: Default::default(),
            queue: lansher_core::QueueMode::Serial,
            max_concurrent: 1,
            start_delay_ms: 0,
            actions: vec![ActionSpec {
                action: Action::Log { text: "hi".into() },
                timeout_ms: 1_000,
                delay_after_ms: 0,
                on_error: lansher_core::OnError::Continue,
            }],
        }];
        profile
    }

    #[test]
    fn save_and_load_roundtrip_preserves_rules() {
        let mut store = Store::open_in_memory().unwrap();
        let profile = sample_profile("p1", 1, true);
        store.save_profile(&profile).unwrap();
        let loaded = store.load_profile("p1").unwrap();
        assert_eq!(loaded.name, profile.name);
        assert_eq!(loaded.rules.len(), 1);
        assert_eq!(
            loaded.rules[0].actions[0].action,
            Action::Log { text: "hi".into() }
        );
        assert!(loaded.dirty);
    }

    #[test]
    fn list_profiles_is_sorted_and_deletable() {
        let mut store = Store::open_in_memory().unwrap();
        store
            .save_profile(&sample_profile("old", 1, false))
            .unwrap();
        store
            .save_profile(&sample_profile("new", 1, false))
            .unwrap();
        let mut newer = sample_profile("new", 1, false);
        newer.updated_at_ms = 9_999;
        store.save_profile(&newer).unwrap();
        let ids: Vec<String> = store
            .list_profiles()
            .unwrap()
            .into_iter()
            .map(|p| p.id)
            .collect();
        assert_eq!(ids, vec!["new".to_string(), "old".to_string()]);
        store.delete_profile("old").unwrap();
        assert_eq!(store.list_profiles().unwrap().len(), 1);
        assert!(matches!(
            store.delete_profile("old"),
            Err(StoreError::NotFound(_))
        ));
    }

    #[test]
    fn touch_increments_revision_and_marks_dirty() {
        let mut profile = Profile::new("p1", "اسم", 0);
        profile.dirty = false;
        profile.remote_revision = Some(7);
        profile.touch(500);
        profile.touch(600);
        assert_eq!(profile.local_revision, 2);
        assert!(profile.dirty);
        assert_eq!(profile.remote_revision, Some(7));
    }

    #[test]
    fn merge_remote_creates_then_updates_clean_profile() {
        let mut store = Store::open_in_memory().unwrap();
        let remote = sample_profile("p1", 3, false);
        assert_eq!(
            store.merge_remote(&remote, 1).unwrap(),
            MergeOutcome::Created
        );
        assert!(!store.load_profile("p1").unwrap().dirty);

        let mut newer = sample_profile("p1", 9, false);
        newer.name = "أحدث".into();
        assert_eq!(
            store.merge_remote(&newer, 2).unwrap(),
            MergeOutcome::Updated
        );
        assert_eq!(store.load_profile("p1").unwrap().name, "أحدث");
    }

    #[test]
    fn merge_remote_reports_conflict_when_local_is_dirty() {
        let mut store = Store::open_in_memory().unwrap();
        store.save_profile(&sample_profile("p1", 2, true)).unwrap();
        let remote = sample_profile("p1", 5, false);
        assert_eq!(
            store.merge_remote(&remote, 1).unwrap(),
            MergeOutcome::Conflict
        );
        assert!(store.get_meta("last_conflict").unwrap().is_some());
        // الملف المحلي يبقى كما هو: لا نطمس عمل المستخدم.
        assert!(store.load_profile("p1").unwrap().dirty);
    }

    #[test]
    fn dirty_profiles_are_listed_for_upload() {
        let mut store = Store::open_in_memory().unwrap();
        store
            .save_profile(&sample_profile("clean", 1, false))
            .unwrap();
        store
            .save_profile(&sample_profile("dirty", 1, true))
            .unwrap();
        let ids: Vec<String> = store
            .dirty_profiles()
            .unwrap()
            .into_iter()
            .map(|p| p.id)
            .collect();
        assert_eq!(ids, vec!["dirty".to_string()]);
    }

    #[test]
    fn accounts_keep_session_only_until_sign_out() {
        let mut store = Store::open_in_memory().unwrap();
        let account = AccountRecord {
            user: User {
                nickname: "ali".into(),
                unique_id: Some("123".into()),
                ..Default::default()
            },
            last_used_ms: 10,
            session_token: Some("tok".into()),
        };
        store.save_account(&account).unwrap();
        assert_eq!(store.list_accounts().unwrap().len(), 1);
        assert_eq!(store.sign_out_all().unwrap(), 1);
        assert!(store.list_accounts().unwrap()[0].session_token.is_none());
    }

    #[test]
    fn seen_events_survive_restart_and_prune_by_age() {
        let mut store = Store::open_in_memory().unwrap();
        store.remember_seen("e1", 100).unwrap();
        store.remember_seen("e2", 200).unwrap();
        assert_eq!(store.recent_seen(10).unwrap(), vec!["e2", "e1"]);
        assert_eq!(store.prune_seen(150).unwrap(), 1);
        assert_eq!(store.recent_seen(10).unwrap(), vec!["e2"]);
    }

    #[test]
    fn goal_accumulates() {
        let mut store = Store::open_in_memory().unwrap();
        assert_eq!(store.add_to_goal("g1", 10).unwrap(), 10);
        assert_eq!(store.add_to_goal("g1", 5).unwrap(), 15);
        assert_eq!(store.goal("g1").unwrap(), Some((String::new(), 0, 15)));
        assert!(store.goal("missing").unwrap().is_none());
    }

    #[test]
    fn meta_roundtrip() {
        let mut store = Store::open_in_memory().unwrap();
        assert!(store.get_meta("theme").unwrap().is_none());
        store.set_meta("theme", "dark").unwrap();
        store.set_meta("theme", "light").unwrap();
        assert_eq!(store.get_meta("theme").unwrap().as_deref(), Some("light"));
    }
}
