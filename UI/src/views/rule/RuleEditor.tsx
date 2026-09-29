import { useState } from "react";
import { EVENT_LABELS, EVENT_TYPE_ORDER, QUEUE_LABELS } from "../../ui/labels";
import {
  Button,
  Dialog,
  Field,
  Note,
  Stepper,
  Switch,
  Tabs,
} from "../../ui/primitives";
import {
  eventType,
  eventTypeName,
  type EventTypeName,
  type QueueMode,
  type Rule,
} from "../../types";
import { ActionEditor, defaultSpec } from "./ActionEditor";
import { ConditionEditor, defaultCondition } from "./ConditionEditor";

/**
 * نافذة تحرير القاعدة. أربعة أقسام في ألسنة، لا صفحة طويلة: الاسم
 * والمدّة في «عام»، والمنطق في «الشروط»، والمخرجات في «الإجراءات»،
 * والحدود في «التحكّم». مَن يكتب قاعدة يعود إلى وضع يفكّر فيه وحده،
 * فلماذا تُعرض له أربعة أسئلة دفعة واحدة.
 *
 * الاختيار هنا لا يحفظ شيئاً: المحرّر يحتفظ بمسوّدة، والحفظ يمرّ
 * عبر `upsert_rule` ليصل إلى المحرك. الإلغاء إذن لا يترك أثراً.
 */

const TABS = [
  { id: "general", label: "عام" },
  { id: "conditions", label: "الشروط" },
  { id: "actions", label: "الإجراءات" },
  { id: "control", label: "التحكّم" },
];

export function RuleEditor({
  draft,
  onChange,
  onClose,
  onSave,
  busy,
}: {
  draft: Rule;
  onChange: (next: Rule) => void;
  onClose: () => void;
  onSave: () => void;
  busy: boolean;
}) {
  const [tab, setTab] = useState("general");

  return (
    <Dialog
      open
      wide
      title={`تحرير: ${draft.name}`}
      onClose={onClose}
      footer={
        <>
          <span className="subtle">
            {draft.conditions.length} شرط · {draft.actions.length} إجراء
          </span>
          <span className="spacer" />
          <Button onClick={onClose}>إلغاء</Button>
          <Button variant="primary" icon="check" onClick={onSave} disabled={busy}>
            {busy ? "جارٍ الحفظ…" : "حفظ القاعدة"}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Tabs label="أقسام القاعدة" tabs={TABS} value={tab} onChange={setTab} />

        {tab === "general" ? (
          <>
            <div className="cond-grid">
              <Field label="الاسم">
                <input
                  className="input"
                  value={draft.name}
                  onChange={(event) => onChange({ ...draft, name: event.target.value })}
                />
              </Field>
              <Field label="الأولوية" hint="القاعدة الأعلى أولاً عند التساوي.">
                <Stepper
                  value={draft.priority}
                  min={0}
                  max={999}
                  onChange={(priority) => onChange({ ...draft, priority })}
                />
              </Field>
            </div>
            <Field
              label="المُشغِّل"
              hint="نوع الحدث الذي يفتح القاعدة. «أي حدث» يترك القرار للشروط."
            >
              <select
                className="select"
                value={draft.trigger ? eventTypeName(draft.trigger) : ""}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    trigger: event.target.value
                      ? eventType(event.target.value as EventTypeName)
                      : null,
                  })
                }
              >
                <option value="">أي حدث</option>
                {EVENT_TYPE_ORDER.map((name) => (
                  <option key={name} value={name}>
                    {EVENT_LABELS[name]}
                  </option>
                ))}
              </select>
            </Field>
            <Switch
              checked={draft.enabled}
              onChange={(enabled) => onChange({ ...draft, enabled })}
              title="القاعدة مفعّلة"
              hint="معطّلة، لا تُنفَّذ، لكنها تبقى قابلة للشرح."
            />
          </>
        ) : null}

        {tab === "conditions" ? (
          <>
            <Field
              label="طريقة الدمج"
              hint="«كل الشروط» يعني أن تُصدق كلها، و«أي شرط» يعني واحداً منها فقط."
            >
              <select
                className="select"
                value={draft.group_op ?? "all"}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    group_op: event.target.value === "any" ? "any" : "all",
                  })
                }
              >
                <option value="all">كل الشروط</option>
                <option value="any">أي شرط</option>
              </select>
            </Field>
            {draft.conditions.map((condition, index) => (
              <ConditionEditor
                key={index}
                condition={condition}
                onChange={(next) => {
                  const conditions = [...draft.conditions];
                  conditions[index] = next;
                  onChange({ ...draft, conditions });
                }}
                onRemove={() =>
                  onChange({
                    ...draft,
                    conditions: draft.conditions.filter((_, i) => i !== index),
                  })
                }
              />
            ))}
            <Button
              icon="plus"
              onClick={() =>
                onChange({ ...draft, conditions: [...draft.conditions, defaultCondition("value")] })
              }
            >
              إضافة شرط
            </Button>
            {draft.conditions.length === 0 ? (
              <Note tone="info">بلا شروط، القاعدة تطابق كل ما يمرّ بالمُشغِّل.</Note>
            ) : null}
          </>
        ) : null}

        {tab === "actions" ? (
          <>
            {draft.actions.map((spec, index) => (
              <ActionEditor
                key={index}
                spec={spec}
                onChange={(next) => {
                  const actions = [...draft.actions];
                  actions[index] = next;
                  onChange({ ...draft, actions });
                }}
                onRemove={() =>
                  onChange({
                    ...draft,
                    actions: draft.actions.filter((_, i) => i !== index),
                  })
                }
              />
            ))}
            <Button
              icon="plus"
              onClick={() => onChange({ ...draft, actions: [...draft.actions, defaultSpec()] })}
            >
              إضافة إجراء
            </Button>
            {draft.actions.length === 0 ? (
              <Note tone="info">بلا إجراءات، القاعدة تُطابَق ولا تفعل شيئاً.</Note>
            ) : null}
          </>
        ) : null}

        {tab === "control" ? (
          <>
            <div className="cond-grid">
              <Field
                label="أقصى عدد مرات"
                hint="0 يعني بلا حد. يوقف التكرار المزعج دون تعطيل القاعدة."
              >
                <Stepper
                  value={draft.rate.max_hits}
                  min={0}
                  max={1000}
                  onChange={(max_hits) =>
                    onChange({ ...draft, rate: { ...draft.rate, max_hits } })
                  }
                />
              </Field>
              <Field label="نافذة العدّ" hint="بالميلي ثانية.">
                <Stepper
                  value={draft.rate.window_ms}
                  min={0}
                  max={600000}
                  step={1000}
                  unit="ms"
                  onChange={(window_ms) =>
                    onChange({ ...draft, rate: { ...draft.rate, window_ms } })
                  }
                />
              </Field>
            </div>
            {draft.rate.max_hits > 0 && draft.rate.window_ms === 0 ? (
              <Note tone="warn">
                عدد مرات بلا نافذة: النافذة الصفرية تعني «بلا حد» في المحرك، فلا
                يقيّد العدد شيئاً.
              </Note>
            ) : null}
            <div className="cond-grid">
              <Field label="نمط التنفيذ">
                <select
                  className="select"
                  value={draft.queue}
                  onChange={(event) =>
                    onChange({ ...draft, queue: event.target.value as QueueMode })
                  }
                >
                  {Object.entries(QUEUE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="أقصى عدد متزامن">
                <Stepper
                  value={draft.max_concurrent}
                  min={1}
                  max={32}
                  onChange={(max_concurrent) => onChange({ ...draft, max_concurrent })}
                />
              </Field>
              <Field label="تأخير البداية" hint="اتركه صفراً إلا لحاجز ترحيب.">
                <Stepper
                  value={draft.start_delay_ms}
                  min={0}
                  max={600000}
                  step={1000}
                  unit="ms"
                  onChange={(start_delay_ms) => onChange({ ...draft, start_delay_ms })}
                />
              </Field>
            </div>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
