import { useState } from "react";
import type { BridgeClient } from "../bridge";
import { EVENT_LABELS } from "../ui/labels";
import { describeEvent } from "../ui/describe";
import { Icon } from "../ui/icons";
import {
  Badge,
  Button,
  Card,
  Empty,
  Field,
  Note,
  PageHead,
  Stepper,
  Tabs,
} from "../ui/primitives";
import {
  eventType,
  type EventTypeName,
  type LiveEvent,
} from "../types";

/**
 * محاكي الأحداث. يصنع أحداثاً بالشكل الذي يصنعه المصدر الحقيقي
 * ويمرّرها عبر `push_event` وحدها، فالحكم يقع في المحرك ولا في هذه
 * الشاشة. تعرض النتيجة المعروضة هي نتيجة المحرك نفسها، فما هنا
 * عرضٌ فقط.
 */

let counter = 0;

function nextId(kind: string): string {
  counter += 1;
  return `sim-${kind}-${counter}`;
}

const KINDS: EventTypeName[] = [
  "Gift",
  "Chat",
  "Like",
  "Follow",
  "Join",
  "Share",
  "Subscribe",
  "StreamStart",
];

function buildEvent(
  kind: EventTypeName,
  nickname: string,
  giftName: string,
  giftCount: number,
  unitValue: number,
  text: string,
): LiveEvent {
  const now = Date.now();
  const base = {
    id: nextId(kind),
    event_type: eventType(kind),
    ts_ms: now,
    received_ms: now,
    source: "simulator",
  };
  switch (kind) {
    case "Gift":
      return {
        ...base,
        user: { nickname, is_follower: true, is_subscriber: false },
        payload: {
          kind: "Gift",
          data: {
            gift_id: null,
            name: giftName,
            count: giftCount,
            value_per_unit: unitValue,
            total_value: giftCount * unitValue,
          },
        },
      };
    case "Like":
      return {
        ...base,
        user: { nickname },
        payload: { kind: "Like", data: { count: giftCount || 1 } },
      };
    case "Follow":
      return {
        ...base,
        user: { nickname, is_follower: true },
        payload: { kind: "Follow" },
      };
    case "Join":
      return { ...base, user: { nickname }, payload: { kind: "Join" } };
    case "Share":
      return { ...base, user: { nickname }, payload: { kind: "Share" } };
    case "Subscribe":
      return {
        ...base,
        user: { nickname, is_subscriber: true },
        payload: { kind: "Subscribe", data: { tier: "level1" } },
      };
    case "StreamStart":
      return {
        ...base,
        payload: {
          kind: "StreamStart",
          data: { unique_id: "sim-uid", title: "بث تجريبي" },
        },
      };
    default:
      return {
        ...base,
        user: { nickname, is_follower: false },
        payload: { kind: "Chat", data: { text } },
      };
  }
}

export default function SimulatorView({
  bridge,
  onEvent,
}: {
  bridge: BridgeClient;
  /** للعرض في اللوحة فقط؛ الحكم ينفَّذ في المحرك. */
  onEvent?: (event: LiveEvent) => void;
}) {
  const [kind, setKind] = useState<EventTypeName>("Gift");
  const [nickname, setNickname] = useState("ali");
  const [giftName, setGiftName] = useState("Rose");
  const [count, setCount] = useState(2);
  const [unitValue, setUnitValue] = useState(5);
  const [text, setText] = useState("مرحباً");
  const [log, setLog] = useState<LiveEvent[]>([]);
  const [matches, setMatches] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function fire() {
    const event = buildEvent(kind, nickname, giftName, count, unitValue, text);
    onEvent?.(event);
    setError(null);
    try {
      const response = await bridge.send({ cmd: "push_event", event });
      const data = (response.data ?? {}) as {
        report?: { result: string; rules?: string[] };
      };
      setMatches(data.report?.result === "matched" ? (data.report.rules ?? []) : []);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
    setLog((previous) => [event, ...previous].slice(0, 40));
  }

  async function burst(total: number) {
    setBusy(true);
    for (let index = 0; index < total; index += 1) {
      await fire();
    }
    setBusy(false);
  }

  return (
    <>
      <PageHead
        title="محاكي الأحداث"
        sub="يصنع أحداثاً بالشكل نفسه الذي يصنعه المصدر الحقيقي، لاختبار القواعد دون بث مباشر."
        actions={
          <>
            <Button icon="bolt" onClick={() => void fire()} disabled={busy}>
              إطلاق حدث
            </Button>
            <Button icon="rotate" onClick={() => void burst(10)} disabled={busy}>
              ×10
            </Button>
            <Button onClick={() => void burst(200)} disabled={busy}>
              ×200
            </Button>
          </>
        }
      />

      {error ? <Note tone="bad">تعذّر تمرير الحدث: {error}</Note> : null}

      {matches.length > 0 ? (
        <Note tone="ok" icon="check">
          طابقت القاعدة: {matches.join("، ")}
        </Note>
      ) : null}

      <div className="grid grid-2">
        <Card title="الحدث" sub="الحقول تغيّر بتغيّر النوع.">
          <div className="stack">
            <Field label="نوع الحدث">
              <Tabs
                label="نوع الحدث"
                value={kind}
                onChange={(id) => setKind(id as EventTypeName)}
                tabs={KINDS.map((name) => ({ id: name, label: EVENT_LABELS[name] }))}
              />
            </Field>

            {kind !== "StreamStart" ? (
              <Field label="المستخدم">
                <input
                  className="input"
                  value={nickname}
                  onChange={(event) => setNickname(event.target.value)}
                />
              </Field>
            ) : null}

            {kind === "Gift" ? (
              <div className="cond-grid">
                <Field label="الهدية">
                  <input
                    className="input"
                    value={giftName}
                    onChange={(event) => setGiftName(event.target.value)}
                  />
                </Field>
                <Field label="العدد">
                  <Stepper value={count} min={1} max={999} onChange={setCount} />
                </Field>
                <Field label="قيمة الوحدة" hint="تُحسب محلياً ولا تُقرأ من المصدر.">
                  <Stepper value={unitValue} min={0} max={10000} onChange={setUnitValue} />
                </Field>
              </div>
            ) : null}

            {kind === "Like" ? (
              <Field label="عدد الإعجابات">
                <Stepper value={count} min={1} max={999} onChange={setCount} />
              </Field>
            ) : null}

            {kind === "Chat" ? (
              <Field label="نص الرسالة">
                <input
                  className="input"
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                />
              </Field>
            ) : null}

            <div className="row row-tight">
              <Button variant="primary" icon="play" onClick={() => void fire()} disabled={busy}>
                إطلاق الحدث
              </Button>
              <span className="subtle">
                القيمة الإجمالية{" "}
                {kind === "Gift" ? (count * unitValue).toLocaleString("ar-EG") : "—"}
              </span>
            </div>
          </div>
        </Card>

        <Card title="السجل" bodyClass="" actions={<Badge icon="list">{log.length}</Badge>}>
          {log.length === 0 ? (
            <Empty
              icon="signal"
              title="لم تُطلق أي حدث"
              text="كل حدث هنا يمرّ بالمحرك نفسه، فالنتيجة المعروضة هي نتيجة المحرك لا تقدير في الواجهة."
            />
          ) : (
            <ul className="feed">
              {log.map((event) => {
                const line = describeEvent(event);
                return (
                  <li key={event.id}>
                    <span className="feed-icon">
                      <Icon name={line.icon} size={14} />
                    </span>
                    <span className="feed-user">{line.user}</span>
                    <span className="feed-verb">{line.verb}</span>
                    {line.detail ? <span className="muted">{line.detail}</span> : null}
                    <span className="feed-time">
                      {new Date(event.ts_ms).toLocaleTimeString("ar-EG", { hour12: false })}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {log[0] ? (
        <Card title="آخر حمولة" sub="كما وصلت إلى المحرك.">
          <div className="scroll-box">
            <pre className="mono">{JSON.stringify(log[0].payload, null, 2)}</pre>
          </div>
        </Card>
      ) : null}
    </>
  );
}
