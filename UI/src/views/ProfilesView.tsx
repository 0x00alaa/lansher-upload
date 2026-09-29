import { useCallback, useEffect, useState } from "react";
import type { BridgeClient } from "../bridge";
import {
  Badge,
  Button,
  Card,
  Empty,
  Field,
  Note,
  PageHead,
} from "../ui/primitives";

/**
 * الملفات الشخصية. حزمة قواعد وإعدادات تُنقل بين الأجهزة. محلياً
 * كل ملف على جهازه، والمزامنة مرحلة لاحقة — فالفرق بين «متزامن»
 * و«بانتظار المزامنة» هنا فرق في المرحلة لا في الحالة.
 */

interface ProfileSummary {
  id: string;
  name: string;
  local_revision: number;
  remote_revision: number | null;
  updated_at_ms: number;
  dirty: boolean;
}

export default function ProfilesView({ bridge }: { bridge: BridgeClient }) {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await bridge.send({ cmd: "list_profiles" });
      setProfiles((response.data as ProfileSummary[]) ?? []);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [bridge]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    if (!name.trim()) {
      return;
    }
    setBusy(true);
    try {
      const now = Date.now();
      await bridge.send({
        cmd: "upsert_profile",
        profile: {
          id: `p${now.toString(36)}`,
          name: name.trim(),
          settings: {},
          rules: [],
          local_revision: 0,
          remote_revision: null,
          updated_at_ms: now,
          dirty: true,
        },
      });
      setName("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead
        title="الملفات الشخصية"
        sub="كل ملف يجمع قواعده وإعداداته. يبقى على هذا الجهاز حتى تُفعّل المزامنة."
      />

      {error ? <Note tone="bad">{error}</Note> : null}

      <Card>
        <div className="row">
          <Field label="اسم الملف" htmlFor="profile-name">
            <input
              id="profile-name"
              className="input"
              value={name}
              placeholder="مثال: بث الألعاب"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void create();
                }
              }}
            />
          </Field>
          <span className="spacer" />
          <Button
            variant="primary"
            icon="plus"
            onClick={() => void create()}
            disabled={busy || !name.trim()}
          >
            إنشاء
          </Button>
        </div>
      </Card>

      {profiles.length === 0 ? (
        <Card>
          <Empty
            icon="folder"
            title="لا توجد ملفات"
            text="أنشئ أول ملف لتبدأ. سيجمع قواعده وإعداداته في حزمة واحدة."
            action={
              <Button icon="plus" onClick={() => void create()} disabled={!name.trim()}>
                إنشاء من الاسم أعلاه
              </Button>
            }
          />
        </Card>
      ) : (
        <Card title="الملفات" bodyClass="">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>الاسم</th>
                  <th>المراجعة المحلية</th>
                  <th>مراجعة الخادم</th>
                  <th>آخر تعديل</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((profile) => (
                  <tr key={profile.id}>
                    <td>{profile.name}</td>
                    <td className="tnum">{profile.local_revision}</td>
                    <td className="tnum">{profile.remote_revision ?? "—"}</td>
                    <td className="mono">
                      {new Date(profile.updated_at_ms).toLocaleString("ar-EG")}
                    </td>
                    <td>
                      <Badge tone={profile.dirty ? "warn" : "ok"}>
                        {profile.dirty ? "بانتظار المزامنة" : "متزامن"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
