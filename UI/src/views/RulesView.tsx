import { useMemo, useState } from "react";
import type { BridgeClient } from "../bridge";
import { EVENT_LABELS } from "../ui/labels";
import { Icon } from "../ui/icons";
import {
  Badge,
  Button,
  Card,
  Empty,
  IconButton,
  Note,
  PageHead,
  Tabs,
} from "../ui/primitives";
import {
  eventType,
  type Explanation,
  type EventTypeName,
  type LiveEvent,
  type Rule,
} from "../types";
import { describeAction } from "./rule/ActionEditor";
import { RuleEditor } from "./rule/RuleEditor";

/**
 * شاشة القواعد. كل قاعدة صفّ واحد يقرأ كخط أنابيب: «عند هذا →
 * بهذه الشروط → يفعل هذا». السطر يقرأه صاحب البث في ثانية، والنقر
 * على أي خانة يفتحه عندها لا في صفحة أخرى.
 *
 * لا نسخة من منطق المطابقة هنا. زر «اشرح» يرسل حدثاً إلى المحرك
 * ويسأل `explain_rule`، فالسبب الذي يعرضه هو سبب المحرك نفسه.
 */

type Sort = "priority" | "name";

const SORTS: { id: Sort; label: string }[] = [
  { id: "priority", label: "حسب الأولوية" },
  { id: "name", label: "حسب الاسم" },
];

function newRule(): Rule {
  return {
    id: `r${Date.now().toString(36)}`,
    name: "قاعدة جديدة",
    enabled: true,
    priority: 0,
    trigger: eventType("Gift"),
    group_op: "all",
    conditions: [{ kind: "value", op: "gte", value: 10, value2: null }],
    rate: { max_hits: 0, window_ms: 0 },
    queue: "serial",
    max_concurrent: 1,
    start_delay_ms: 0,
    actions: [
      {
        action: {
          kind: "speak",
          text: "شكراً {user} على {gift}",
          voice: null,
          rate: null,
        },
        timeout_ms: 5000,
        delay_after_ms: 0,
        on_error: "continue",
      },
    ],
  };
}

function triggerLabel(rule: Rule): string {
  if (!rule.trigger) {
    return "أي حدث";
  }
  const name = rule.trigger.kind as EventTypeName;
  return EVENT_LABELS[name] ?? rule.trigger.kind;
}

export default function RulesView({
  bridge,
  rules,
  onChanged,
  explanations,
  onExplain,
}: {
  bridge: BridgeClient;
  rules: Rule[];
  onChanged: () => Promise<void>;
  explanations: Explanation[];
  onExplain: (rule: Rule, event: LiveEvent) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Rule | null>(null);
  const [sort, setSort] = useState<Sort>("priority");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sorted = useMemo(() => {
    const copy = [...rules];
    if (sort === "name") {
      return copy.sort((a, b) => a.name.localeCompare(b.name, "ar"));
    }
    return copy.sort((a, b) => b.priority - a.priority);
  }, [rules, sort]);

  async function save() {
    if (!draft) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await bridge.send({ cmd: "upsert_rule", rule: draft });
      setDraft(null);
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(rule: Rule) {
    await bridge.send({ cmd: "upsert_rule", rule: { ...rule, enabled: !rule.enabled } });
    await onChanged();
  }

  async function remove(rule: Rule) {
    await bridge.send({ cmd: "delete_rule", id: rule.id });
    await onChanged();
  }

  async function duplicate(rule: Rule) {
    const copy: Rule = {
      ...rule,
      id: `r${Date.now().toString(36)}`,
      name: `${rule.name} (نسخة)`,
      enabled: false,
    };
    await bridge.send({ cmd: "upsert_rule", rule: copy });
    await onChanged();
  }

  return (
    <>
      <PageHead
        title="القواعد والأحداث"
        sub="كل قاعدة تربط حدثاً بشروط وإجراءات. الترتيب عند التساوي بالأولوية."
        actions={
          <Button variant="primary" icon="plus" onClick={() => setDraft(newRule())}>
            قاعدة جديدة
          </Button>
        }
      />

      {error ? <Note tone="bad">{error}</Note> : null}

      <div className="row">
        <Tabs
          label="ترتيب القواعد"
          value={sort}
          onChange={(id) => setSort(id as Sort)}
          tabs={SORTS.map((entry) => ({ id: entry.id, label: entry.label }))}
        />
        <span className="subtle">{sorted.length} قاعدة</span>
      </div>

      {sorted.length === 0 ? (
        <Card>
          <Empty
            icon="bolt"
            title="لا توجد قواعد بعد"
            text="القاعدة تربط حدثاً بشروط وإجراءات. ابدأ بأبسطها: عند هدية تتجاوز قيمة، اكتب اسماً قصيراً وقل «شكراً»."
            action={
              <Button variant="primary" icon="plus" onClick={() => setDraft(newRule())}>
                قاعدة جديدة
              </Button>
            }
          />
        </Card>
      ) : null}

      <div className="stack">
        {sorted.map((rule) => (
          <Card
            key={rule.id}
            bodyClass=""
            actions={
              <>
                <Badge tone={rule.enabled ? "ok" : "warn"}>
                  {rule.enabled ? "مفعّلة" : "معطّلة"}
                </Badge>
                <IconButton
                  icon="pencil"
                  label="تحرير"
                  onClick={() => setDraft(rule)}
                />
                <IconButton
                  icon={rule.enabled ? "stop" : "play"}
                  label={rule.enabled ? "تعطيل" : "تفعيل"}
                  onClick={() => void toggle(rule)}
                />
                <IconButton
                  icon="copy"
                  label="تكرار"
                  onClick={() => void duplicate(rule)}
                />
                <IconButton
                  icon="search"
                  label="اشرح المطابقة"
                  onClick={() => void onExplain(rule, sampleEvent())}
                />
                <IconButton
                  icon="trash"
                  label="حذف"
                  onClick={() => void remove(rule)}
                />
              </>
            }
          >
            <div className="pipeline">
              <div className="pipeline-cell">
                <div className="pipeline-label">عند</div>
                <div className="pipeline-value">{triggerLabel(rule)}</div>
              </div>
              <span className="pipeline-arrow">
                <Icon name="chevronInline" size={14} flip />
              </span>
              <div className="pipeline-cell">
                <div className="pipeline-label">بشرط</div>
                <div className="pipeline-value">
                  {rule.conditions.length === 0
                    ? "بلا شروط"
                    : `${rule.conditions.length} شرط · ${
                        rule.group_op === "any" ? "أي واحد يكفي" : "كلها"
                      }`}
                </div>
              </div>
              <span className="pipeline-arrow">
                <Icon name="chevronInline" size={14} flip />
              </span>
              <div className="pipeline-cell">
                <div className="pipeline-label">يفعل</div>
                <div className="pipeline-value">
                  {rule.actions.length === 0
                    ? "بلا إجراءات"
                    : rule.actions.map((spec) => describeAction(spec.action)).join(" ثم ")}
                </div>
              </div>
            </div>
            {rule.rate.max_hits > 0 && rule.rate.window_ms > 0 ? (
              <div className="rule-foot">
                <Badge icon="timer">
                  {rule.rate.max_hits} مرات كل{" "}
                  {Math.round(rule.rate.window_ms / 1000)} ثانية
                </Badge>
                <Badge icon="bolt">أولوية {rule.priority}</Badge>
              </div>
            ) : null}
          </Card>
        ))}
      </div>

      {explanations.length > 0 ? (
        <Card title="لماذا طابقت؟" sub="من المحرك نفسه، لا تقدير في الواجهة.">
          <ul className="list">
            {explanations.map((item, index) => (
              <li key={index}>
                <span>{item.label}</span>
                <span className={item.passed ? "explain-pass" : "explain-fail"}>
                  {item.passed ? "✓" : "✗"}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {draft ? (
        <RuleEditor
          draft={draft}
          onChange={setDraft}
          onClose={() => setDraft(null)}
          onSave={() => void save()}
          busy={busy}
        />
      ) : null}
    </>
  );
}

/** حدث مرجعي واحد لزر «اشرح»: هدية واحدة بقيمة معروفة. */
function sampleEvent(): LiveEvent {
  const now = Date.now();
  return {
    id: `sample-${now}`,
    event_type: eventType("Gift"),
    ts_ms: now,
    received_ms: now,
    source: "sample",
    user: { nickname: "ali", is_follower: true, is_subscriber: false },
    payload: {
      kind: "Gift",
      data: {
        gift_id: null,
        name: "Rose",
        count: 2,
        value_per_unit: 5,
        total_value: 10,
      },
    },
  };
}
