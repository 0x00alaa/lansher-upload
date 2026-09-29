import {
  BOOL_LABELS,
  CONDITION_LABELS,
  CONDITION_ORDER,
  EVENT_LABELS,
  EVENT_TYPE_ORDER,
  NUMERIC_OPS,
  OP_LABELS,
  TEXT_OPS,
  splitValues,
} from "../../ui/labels";
import { Field, IconButton, Stepper } from "../../ui/primitives";
import {
  type BoolExpectation,
  type CompareOp,
  type Condition,
  type EventTypeName,
} from "../../types";

/**
 * محرّر الشرط. كتابة الشروط خطّ الأنابيب الحقيقي: كل شرط نوعه ثم
 * معامله ثم قيمته. المحرّر يغيّر الشكل لا القيمة — كل اختيار ينتج
 * شرطاً مطابقاً لـ`Condition` في العقد، فما يخرج من هنا يُحفظ كما هو.
 *
 * التفريع بـ`switch` على `kind` لا بحارس نوع واحد: الحراسة تعطي
 * تقاطعاً لا تمييزاً، فيضطر المحرّر إلى تأكيد النوع مرتين، ويبقى
 * الصنفان الوحيدان اللذان يحتاجان تأكيداً هما ذاكا اللذان يُنسى
 * تأكيدهما عند إضافة نوع جديد. التبديل يفشل ترجمةً لو أُضيف نوع
 * فُوتِب في فرع.
 *
 * التداخل محدود بعمق واحد: `and` و`or` يحملان شروطاً، و`not` شرطاً
 * واحداً. أعمق من ذلك نادر في قاعدة بشرية، وفتحه بلا سقف يعني
 * واجهة يمكن أن تنهار على نفسها.
 */

const MAX_DEPTH = 1;

function OpSelect({
  op,
  ops,
  onChange,
}: {
  op: CompareOp;
  ops: CompareOp[];
  onChange: (next: CompareOp) => void;
}) {
  return (
    <Field label="المقارنة">
      <select
        className="select"
        value={op}
        onChange={(event) => onChange(event.target.value as CompareOp)}
      >
        {ops.map((entry) => (
          <option key={entry} value={entry}>
            {OP_LABELS[entry]}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function ConditionEditor({
  condition,
  onChange,
  onRemove,
  depth = 0,
}: {
  condition: Condition;
  onChange: (next: Condition) => void;
  onRemove?: () => void;
  depth?: number;
}) {
  const { kind } = condition;

  function body() {
    switch (condition.kind) {
      case "event_type_is":
      case "event_type_not": {
        const anyOf = condition.any_of;
        return (
          <div className="chip-row">
            {EVENT_TYPE_ORDER.map((name) => {
              const active = anyOf.some((entry) => entry.kind === name);
              return (
                <button
                  key={name}
                  type="button"
                  className="chip"
                  aria-pressed={active}
                  onClick={() =>
                    onChange({
                      kind: condition.kind,
                      any_of: active
                        ? anyOf.filter((entry) => entry.kind !== name)
                        : [...anyOf, { kind: name }],
                    })
                  }
                >
                  {EVENT_LABELS[name]}
                </button>
              );
            })}
          </div>
        );
      }

      case "value":
      case "repeat_count":
        return (
          <div className="cond-grid">
            <OpSelect
              op={condition.op}
              ops={NUMERIC_OPS}
              onChange={(op) => onChange({ ...condition, op })}
            />
            <Field label="القيمة">
              <Stepper
                value={condition.value}
                onChange={(value) => onChange({ ...condition, value })}
              />
            </Field>
            {condition.op === "between" ? (
              <Field label="الحد الأعلى">
                <Stepper
                  value={condition.value2 ?? 0}
                  onChange={(value2) => onChange({ ...condition, value2 })}
                />
              </Field>
            ) : null}
          </div>
        );

      case "subject":
        return (
          <div className="cond-grid">
            <OpSelect
              op={condition.op}
              ops={TEXT_OPS}
              onChange={(op) => onChange({ ...condition, op })}
            />
            {condition.op === "in" ? (
              <Field label="القائمة" hint="افصل بينها بفاصلة: Rose, Galaxy">
                <input
                  className="input"
                  value={condition.values.join(", ")}
                  onChange={(event) =>
                    onChange({ ...condition, values: splitValues(event.target.value) })
                  }
                />
              </Field>
            ) : (
              <Field label="القيمة">
                <input
                  className="input"
                  value={condition.value}
                  onChange={(event) => onChange({ ...condition, value: event.target.value })}
                />
              </Field>
            )}
          </div>
        );

      case "text":
      case "nickname":
      case "unique_id":
        return (
          <div className="cond-grid">
            <OpSelect
              op={condition.op}
              ops={TEXT_OPS}
              onChange={(op) => onChange({ ...condition, op })}
            />
            <Field label="القيمة" hint="`*` تطابق أي نص، و`?` تطابق حرفاً واحداً.">
              <input
                className="input"
                value={condition.value}
                onChange={(event) => onChange({ ...condition, value: event.target.value })}
              />
            </Field>
          </div>
        );

      case "is_follower":
      case "is_subscriber":
        return (
          <Field label="القيمة المتوقعة" hint="«مهم» يتجاهل القيمة، فلا يعتبر المجهول نعم.">
            <select
              className="select"
              value={condition.expect}
              onChange={(event) =>
                onChange({ kind: condition.kind, expect: event.target.value as BoolExpectation })
              }
            >
              {Object.entries(BOOL_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        );

      case "chance":
        return (
          <Field label="النسبة" hint="حتمية: النتيجة نفسها للحدث نفسه.">
            <Stepper
              value={condition.percent}
              min={0}
              max={100}
              unit="%"
              onChange={(percent) => onChange({ ...condition, percent })}
            />
          </Field>
        );

      case "and":
      case "or":
        return (
          <div className="nested">
            {condition.conditions.map((child, index) => (
              <ConditionEditor
                key={index}
                condition={child}
                depth={depth + 1}
                onChange={(next) => {
                  const conditions = [...condition.conditions];
                  conditions[index] = next;
                  onChange({ kind: condition.kind, conditions });
                }}
                onRemove={() =>
                  onChange({
                    kind: condition.kind,
                    conditions: condition.conditions.filter((_, i) => i !== index),
                  })
                }
              />
            ))}
            {depth < MAX_DEPTH ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() =>
                  onChange({
                    kind: condition.kind,
                    conditions: [
                      ...condition.conditions,
                      { kind: "value", op: "gte", value: 1, value2: null },
                    ],
                  })
                }
              >
                إضافة شرط فرعي
              </button>
            ) : null}
          </div>
        );

      case "not":
        return (
          <div className="nested">
            <ConditionEditor
              condition={condition.condition}
              depth={depth + 1}
              onChange={(next) => onChange({ kind: "not", condition: next })}
            />
          </div>
        );
    }
  }

  return (
    <div className="cond">
      <div className="cond-head">
        <select
          className="select"
          aria-label="نوع الشرط"
          value={kind}
          onChange={(event) =>
            onChange(defaultCondition(event.target.value as Condition["kind"]))
          }
        >
          {CONDITION_ORDER.map((entry) => (
            <option key={entry} value={entry}>
              {CONDITION_LABELS[entry]}
            </option>
          ))}
        </select>
        {onRemove ? <IconButton icon="trash" label="حذف الشرط" onClick={onRemove} /> : null}
      </div>
      <div className="cond-body">{body()}</div>
    </div>
  );
}

/** شرط جديد بالشكل الذي يختاره النوع المختار للتو. */
export function defaultCondition(kind: Condition["kind"]): Condition {
  switch (kind) {
    case "chance":
      return { kind: "chance", percent: 50, seed: null };
    case "is_follower":
    case "is_subscriber":
      return { kind, expect: "any" };
    case "and":
    case "or":
      return { kind, conditions: [{ kind: "value", op: "gte", value: 1, value2: null }] };
    case "not":
      return { kind: "not", condition: { kind: "is_follower", expect: "true" } };
    case "event_type_is":
    case "event_type_not":
      return { kind, any_of: [{ kind: "Gift" as EventTypeName }] };
    case "value":
    case "repeat_count":
      return { kind, op: "gte", value: 1, value2: null };
    case "subject":
      return { kind, op: "eq", value: "", values: [] };
    default:
      return { kind, op: "contains", value: "" };
  }
}
