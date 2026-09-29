import { describeEvent } from "../ui/describe";
import { Icon } from "../ui/icons";
import {
  Badge,
  Button,
  Card,
  Empty,
  Note,
  PageHead,
  Stat,
} from "../ui/primitives";
import type { AppState, LiveEvent } from "../types";

/**
 * لوحة البث. تُقرأ بنظرة واحدة: هل البث جارٍ، ما أرقامه، وماذا
 * جرى في آخر دقيقة. كل رقم هنا اسم من `Counts` في العقد ولا رقم
 * محسوب في الواجهة، فما تعرضه اللوحة هو ما يظنه المحرك.
 */

function uptime(startedMs: number | null, now: number): string {
  if (!startedMs) {
    return "—";
  }
  const seconds = Math.max(0, Math.floor((now - startedMs) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) {
    return `${hours}س ${minutes}د`;
  }
  if (minutes > 0) {
    return `${minutes}د ${rest}ث`;
  }
  return `${rest}ث`;
}

function clock(ms: number | null): string {
  if (!ms) {
    return "—";
  }
  return new Date(ms).toLocaleTimeString("ar-EG", { hour12: false });
}

export default function Dashboard({
  state,
  feed,
  onNavigate,
}: {
  state: AppState | null;
  feed: LiveEvent[];
  onNavigate: (route: string) => void;
}) {
  if (!state) {
    return (
      <>
        <PageHead title="لوحة البث" />
        <Card>
          <Empty icon="rotate" title="جارٍ قراءة الحالة…" />
        </Card>
      </>
    );
  }

  const counts = state.engine.counts;
  const live = state.source.connected && state.engine.running;
  const lines = feed.map(describeEvent);

  return (
    <>
      <PageHead
        title="لوحة البث"
        sub={
          live
            ? "البث جارٍ. كل ما يصل إلى المحرك يُحلَّل الآن."
            : "لا يوجد بث متصل. شغّل المحاكي لتجربة القواعد."
        }
        actions={
          <>
            <Button icon="signal" onClick={() => onNavigate("simulator")}>
              محاكي الأحداث
            </Button>
            <Button variant="primary" icon="bolt" onClick={() => onNavigate("rules")}>
              القواعد والأحداث
            </Button>
          </>
        }
      />

      {state.engine.last_error ? (
        <Note tone="bad">{state.engine.last_error}</Note>
      ) : null}

      <Card bodyClass="card-pad">
        <div className="row">
          {live ? (
            <Badge live>مباشر الآن</Badge>
          ) : (
            <Badge tone="warn" icon="signal">
              غير متصل
            </Badge>
          )}
          <Badge icon="users">{state.source.kind}</Badge>
          {state.source.unique_id ? (
            <Badge icon="userPlus">@{state.source.unique_id}</Badge>
          ) : null}
          <Badge icon="clock">مدة البث {uptime(state.engine.session_started_ms, Date.now())}</Badge>
          <Badge icon="bolt">
            {counts.actions_executed.toLocaleString("ar-EG")} إجراء نُفّذ
          </Badge>
          <span className="spacer" />
          <Badge icon="file">v{state.app_version}</Badge>
        </div>
      </Card>

      <div className="grid grid-stats">
        <Stat icon="eye" label="المشاهدون" value={counts.viewers} />
        <Stat icon="heart" label="الإعجابات" value={counts.likes} />
        <Stat icon="gift" label="الهدايا" value={counts.gifts} />
        <Stat icon="trophy" label="قيمة الهدايا" value={counts.gift_value} tone="brand" />
        <Stat icon="userPlus" label="متابعون جدد" value={counts.follows} />
        <Stat icon="users" label="انضمّوا" value={counts.joins} />
        <Stat icon="share" label="مشاركات" value={counts.shares} />
        <Stat icon="trophy" label="مشتركون" value={counts.subscribes} />
        <Stat icon="chat" label="رسائل" value={counts.chats} />
        <Stat
          icon="check"
          label="إجراءات نجحت"
          value={counts.actions_executed}
          tone="ok"
        />
        <Stat
          icon="alert"
          label="إجراءات فشلت"
          value={counts.actions_failed}
          tone={counts.actions_failed > 0 ? "bad" : "neutral"}
        />
        <Stat icon="rotate" label="أحداث مكررة" value={counts.events_deduplicated} />
      </div>

      <div className="grid grid-2">
        <Card
          title="النشاط المباشر"
          bodyClass=""
          actions={<Badge icon="signal">{feed.length}</Badge>}
        >
          {lines.length === 0 ? (
            <Empty
              icon="signal"
              title="لا نشاط بعد"
              text="ستظهر هنا كل رسالة وإعجاب وهدية تصل إلى المحرك، بصيغة يقرؤها الإنسان لا بصيغة JSON."
              action={
                <Button icon="play" onClick={() => onNavigate("simulator")}>
                  أرسل حدثاً تجريبياً
                </Button>
              }
            />
          ) : (
            <ul className="feed">
              {lines.map((line) => (
                <li key={line.id}>
                  <span className="feed-icon">
                    <Icon name={line.icon} size={14} />
                  </span>
                  <span className="feed-user">{line.user}</span>
                  <span className="feed-verb">{line.verb}</span>
                  {line.detail ? (
                    <span className={line.tone === "brand" ? "feed-value" : "muted"}>
                      {line.detail}
                    </span>
                  ) : null}
                  <span className="feed-time">{clock(line.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="stack">
          <Card title="الجلسة" bodyClass="card-pad">
            <dl className="kv">
              <dt>بدأت</dt>
              <dd className="mono">{clock(state.engine.session_started_ms)}</dd>
              <dt>المعرّف</dt>
              <dd className="mono">{state.engine.unique_id ?? "—"}</dd>
              <dt>الغرفة</dt>
              <dd className="mono">{state.source.room_id ?? "—"}</dd>
              <dt>زمن الاستجابة</dt>
              <dd className="mono">{state.engine.latency_ms ?? 0} ms</dd>
              <dt>القواعد</dt>
              <dd>{state.rule_count}</dd>
              <dt>الملفات</dt>
              <dd>{state.profile_count}</dd>
              <dt>الخطة</dt>
              <dd>{state.plan}</dd>
            </dl>
          </Card>

          <Card title="إجراءات سريعة">
            <div className="row row-tight">
              <Button icon="bolt" onClick={() => onNavigate("rules")}>
                القواعد والأحداث
              </Button>
              <Button icon="signal" onClick={() => onNavigate("simulator")}>
                محاكي الأحداث
              </Button>
              <Button icon="folder" onClick={() => onNavigate("profiles")}>
                الملفات الشخصية
              </Button>
              <Button icon="palette" onClick={() => onNavigate("appearance")}>
                المظهر
              </Button>
            </div>
          </Card>
        </div>
      </div>

      {feed[0] ? (
        <Card
          title="آخر حدث كما وصل المحرك"
          sub="الشكل الحرفي الذي تسلّمه له الطبقة السفلية."
        >
          <div className="scroll-box">
            <pre className="mono">{JSON.stringify(feed[0], null, 2)}</pre>
          </div>
        </Card>
      ) : null}
    </>
  );
}
