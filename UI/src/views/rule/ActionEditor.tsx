import { ACTION_LABELS, ACTION_ORDER, ON_ERROR_LABELS } from "../../ui/labels";
import { Field, IconButton, Stepper } from "../../ui/primitives";
import type { Action, ActionSpec, OnError } from "../../types";

/**
 * محرّر الإجراء. الإجراء ليس حقلاً واحداً: هو `ActionSpec` يحمل
 * الفعل نفسه مع مهلة زمنية وتأثير بعده وسلوك عند الخطأ. المحرّر
 * يعرض الثلاثة، لأن قاعدة بلا مهلة ولا سلوك عند الخطأ تفاجئ
 * صاحبها في منتصف بث لا في شاشة التحرير.
 */

/** الإجراءات التي تحمل نصاً واحداً يملأه المستخدم. */
const TEXT_KINDS = ["speak", "send_chat", "log"] as const;

function isTextKind(kind: Action["kind"]): kind is (typeof TEXT_KINDS)[number] {
  return (TEXT_KINDS as readonly string[]).includes(kind);
}

/** قراءة نص الإجراء، و«» إن لم يكن من الإجراءات النصية. */
function textOf(action: Action): string {
  switch (action.kind) {
    case "speak":
    case "send_chat":
    case "log":
      return action.text;
    default:
      return "";
  }
}

/**
 * كتابة النص في الإجراء. تقسيم على `kind` لا نشر `{...action, text}`:
 * النشر على اتحاد يعطي اتحاداً لا يميّز، فيرفضه الفاحص عند
 * أول فرع لا يحمل `text`.
 */
function withText(action: Action, text: string): Action {
  switch (action.kind) {
    case "speak":
      return { ...action, text };
    case "send_chat":
      return { ...action, text };
    case "log":
      return { ...action, text };
    default:
      return action;
  }
}

/** جملة تصف ما يفعله الإجراء، للقراءة في صف القاعدة. */
export function describeAction(action: Action): string {
  switch (action.kind) {
    case "speak":
      return action.text ? `«${action.text}»` : "نطق صوتي";
    case "play_sound":
      return action.file_id ? `صوت ${action.file_id}` : "تشغيل صوت";
    case "alert":
      return action.title ? `تنبيه «${action.title}»` : "إظهار تنبيه";
    case "send_chat":
      return action.text ? `رسالة «${action.text}»` : "إرسال رسالة";
    case "add_to_goal":
      return `هدف ${action.goal_id}`;
    case "webhook":
      return action.url ? `استدعاء ${action.url}` : "استدعاء رابط";
    case "integration":
      return `${action.target}.${action.command}`;
    case "log":
      return action.text ? `سجل «${action.text}»` : "كتابة في السجل";
    default:
      return "بلا إجراء";
  }
}

export function ActionEditor({
  spec,
  onChange,
  onRemove,
}: {
  spec: ActionSpec;
  onChange: (next: ActionSpec) => void;
  onRemove: () => void;
}) {
  const action = spec.action;

  const setAction = (next: Action) => onChange({ ...spec, action: next });

  return (
    <div className="cond">
      <div className="cond-head">
        <select
          className="select"
          aria-label="نوع الإجراء"
          value={action.kind}
          onChange={(event) =>
            setAction(defaultAction(event.target.value as Action["kind"]))
          }
        >
          {ACTION_ORDER.map((kind) => (
            <option key={kind} value={kind}>
              {ACTION_LABELS[kind]}
            </option>
          ))}
        </select>
        <IconButton icon="trash" label="حذف الإجراء" onClick={onRemove} />
      </div>

      <div className="cond-body">
        {isTextKind(action.kind) ? (
          <Field
            label="النص"
            hint="المتغيرات المتاحة: {user} {text} {gift} {count} {value} {type}"
          >
            <input
              className="input"
              value={textOf(action)}
              onChange={(event) => setAction(withText(action, event.target.value))}
            />
          </Field>
        ) : null}

        {action.kind === "speak" ? (
          <div className="cond-grid">
            <Field label="الصوت" hint="اتركه فارغاً لاستخدام صوت افتراضي.">
              <input
                className="input"
                value={action.voice ?? ""}
                onChange={(event) => setAction({ ...action, voice: event.target.value || null })}
              />
            </Field>
            <Field label="السرعة" hint="1.0 هي السرعة الطبيعية.">
              <input
                className="input input-num"
                type="number"
                step="0.1"
                value={action.rate ?? 1}
                onChange={(event) => setAction({ ...action, rate: Number(event.target.value) })}
              />
            </Field>
          </div>
        ) : null}

        {action.kind === "play_sound" ? (
          <div className="cond-grid">
            <Field label="معرّف الملف" hint="من مكتبة الأصوات.">
              <input
                className="input"
                value={action.file_id}
                onChange={(event) => setAction({ ...action, file_id: event.target.value })}
              />
            </Field>
            <Field label="مستوى الصوت" hint="0 إلى 100.">
              <Stepper
                value={action.volume ?? 100}
                min={0}
                max={100}
                onChange={(volume) => setAction({ ...action, volume })}
              />
            </Field>
          </div>
        ) : null}

        {action.kind === "alert" ? (
          <div className="cond-grid">
            <Field label="العنوان">
              <input
                className="input"
                value={action.title}
                onChange={(event) => setAction({ ...action, title: event.target.value })}
              />
            </Field>
            <Field label="المدة" hint="بالميلي ثانية.">
              <Stepper
                value={action.duration_ms ?? 3000}
                min={200}
                max={60000}
                step={500}
                unit="ms"
                onChange={(duration_ms) => setAction({ ...action, duration_ms })}
              />
            </Field>
          </div>
        ) : null}

        {action.kind === "add_to_goal" ? (
          <div className="cond-grid">
            <Field label="الهدف">
              <input
                className="input"
                value={action.goal_id}
                onChange={(event) => setAction({ ...action, goal_id: event.target.value })}
              />
            </Field>
            <Field label="المبلغ" hint="0 يعني قيمة الحدث نفسه.">
              <Stepper
                value={action.amount ?? 0}
                min={0}
                onChange={(amount) => setAction({ ...action, amount })}
              />
            </Field>
          </div>
        ) : null}

        {action.kind === "webhook" ? (
          <div className="cond-grid">
            <Field label="الرابط">
              <input
                className="input mono"
                value={action.url}
                onChange={(event) => setAction({ ...action, url: event.target.value })}
              />
            </Field>
            <Field label="الطريقة">
              <input
                className="input"
                value={action.method ?? "POST"}
                onChange={(event) => setAction({ ...action, method: event.target.value })}
              />
            </Field>
          </div>
        ) : null}

        {action.kind === "integration" ? (
          <div className="cond-grid">
            <Field label="الهدف" hint="مثال: obs أو streamerbot">
              <input
                className="input"
                value={action.target}
                onChange={(event) => setAction({ ...action, target: event.target.value })}
              />
            </Field>
            <Field label="الأمر">
              <input
                className="input"
                value={action.command}
                onChange={(event) => setAction({ ...action, command: event.target.value })}
              />
            </Field>
          </div>
        ) : null}

        <div className="cond-grid">
          <Field label="المهلة" hint="بعدها يُعتبر الإجراء فاشلاً.">
            <Stepper
              value={spec.timeout_ms}
              min={0}
              max={600000}
              step={500}
              unit="ms"
              onChange={(timeout_ms) => onChange({ ...spec, timeout_ms })}
            />
          </Field>
          <Field label="تأخير بعده" hint="فاصل قبل الإجراء التالي.">
            <Stepper
              value={spec.delay_after_ms}
              min={0}
              max={600000}
              step={250}
              unit="ms"
              onChange={(delay_after_ms) => onChange({ ...spec, delay_after_ms })}
            />
          </Field>
          <Field label="عند الخطأ">
            <select
              className="select"
              value={spec.on_error}
              onChange={(event) =>
                onChange({ ...spec, on_error: event.target.value as OnError })
              }
            >
              {Object.entries(ON_ERROR_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>
    </div>
  );
}

export function defaultAction(kind: Action["kind"]): Action {
  switch (kind) {
    case "speak":
      return { kind, text: "", voice: null, rate: null };
    case "play_sound":
      return { kind, file_id: "", volume: null };
    case "alert":
      return { kind, title: "", image: null, duration_ms: null };
    case "add_to_goal":
      return { kind, goal_id: "default", amount: null, mode: "event" };
    case "send_chat":
      return { kind, text: "" };
    case "webhook":
      return { kind, url: "", method: "POST", include_event: true };
    case "integration":
      return { kind, target: "", command: "", args: {} };
    case "log":
      return { kind, text: "" };
    default:
      return { kind: "none" };
  }
}

export function defaultSpec(): ActionSpec {
  return {
    action: defaultAction("speak"),
    timeout_ms: 5000,
    delay_after_ms: 0,
    on_error: "continue",
  };
}
