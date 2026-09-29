import { useEffect, useId, useRef, type ReactNode } from "react";
import { Icon, type IconName } from "./icons";

/**
 * مكوّنات العرض. كل واحد منها غلاف حول صنف في `styles/components.css`
 * لا منطق ولا حالة: الحالة في `App` أو في الشاشة، والعرض هنا.
 *
 * الصنف يحمل الشكل، والمكوّن يحمل الدلالة. `Button` knows its tone,
 * `Field` knows its label belongs above its control, فلا يبقى في
 * الشاشة `className` واحد يمكن أن ينساه أحد.
 */

export function PageHead({
  title,
  sub,
  actions,
}: {
  title: string;
  sub?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div className="page-head-text">
        <h1 className="page-title">{title}</h1>
        {sub ? <p className="page-sub">{sub}</p> : null}
      </div>
      {actions ? <div className="page-head-actions">{actions}</div> : null}
    </header>
  );
}

export function Card({
  title,
  sub,
  actions,
  footer,
  bodyClass = "card-body",
  children,
}: {
  title?: ReactNode;
  sub?: string;
  actions?: ReactNode;
  footer?: ReactNode;
  bodyClass?: string;
  children: ReactNode;
}) {
  return (
    <section className="card">
      {title || actions ? (
        <div className="card-head">
          <div className="card-title">
            {typeof title === "string" ? <h2>{title}</h2> : title}
            {sub ? <div className="field-hint">{sub}</div> : null}
          </div>
          {actions}
        </div>
      ) : null}
      <div className={bodyClass}>{children}</div>
      {footer ? <div className="card-foot">{footer}</div> : null}
    </section>
  );
}

export type Tone = "neutral" | "brand" | "ok" | "warn" | "bad" | "info";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "badge",
  brand: "badge badge-brand",
  ok: "badge badge-ok",
  warn: "badge badge-warn",
  bad: "badge badge-bad",
  info: "badge badge-info",
};

export function Badge({
  tone = "neutral",
  icon,
  live,
  children,
}: {
  tone?: Tone;
  icon?: IconName;
  live?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={live ? "badge badge-live" : TONE_CLASS[tone]}>
      {live ? <span className="live-dot" /> : null}
      {!live && icon ? <Icon name={icon} size={12} /> : null}
      {children}
    </span>
  );
}

export function Note({
  tone = "warn",
  icon,
  children,
}: {
  tone?: "warn" | "bad" | "ok" | "info";
  icon?: IconName;
  children: ReactNode;
}) {
  const fallback: IconName = tone === "bad" ? "alert" : tone === "ok" ? "check" : "info";
  return (
    <div className={tone === "warn" ? "note" : `note note-${tone}`}>
      <Icon name={icon ?? fallback} size={15} />
      <div>{children}</div>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

export function Button({
  variant = "subtle",
  size,
  icon,
  block,
  children,
  ...rest
}: {
  variant?: "primary" | "outline" | "ghost" | "danger" | "subtle";
  size?: "sm";
  icon?: IconName;
  block?: boolean;
  children?: ReactNode;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className">) {
  const classes = ["btn", variant !== "subtle" ? `btn-${variant}` : ""]
    .concat(size === "sm" ? "btn-sm" : "")
    .concat(block ? "btn-block" : "")
    .filter(Boolean)
    .join(" ");
  return (
    <button type="button" className={classes} {...rest}>
      {icon ? <Icon name={icon} size={14} /> : null}
      {children}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  flip,
  ...rest
}: {
  icon: IconName;
  label: string;
  flip?: boolean;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className" | "aria-label">) {
  return (
    <button
      type="button"
      className="btn btn-ghost btn-icon"
      aria-label={label}
      title={label}
      {...rest}
    >
      <Icon name={icon} size={16} flip={flip ?? false} />
    </button>
  );
}

/**
 * عدّاد رقمي. يدخله الحقل نصاً حراً، ويخرج دائماً عدداً صحيحاً: قيمة
 * فارغة أو نص يرفضه المتصفح تسقط إلى `min`، فلا يخرج `NaN` إلى
 * العقد ولا يصبح الحقل عالقاً على قيمة لا يقرأها المحرك.
 */
export function Stepper({
  value,
  onChange,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  step = 1,
  unit,
  disabled,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
}) {
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  return (
    <div className="stepper">
      <button
        type="button"
        className="stepper-btn"
        aria-label="إنقاص"
        disabled={disabled || value <= min}
        onClick={() => onChange(clamp(value - step))}
      >
        <Icon name="minus" size={14} />
      </button>
      <input
        className="stepper-input"
        type="number"
        inputMode="numeric"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          onChange(Number.isFinite(parsed) ? clamp(parsed) : min);
        }}
      />
      {unit ? <span className="stepper-unit">{unit}</span> : null}
      <button
        type="button"
        className="stepper-btn"
        aria-label="زيادة"
        disabled={disabled || value >= max}
        onClick={() => onChange(clamp(value + step))}
      >
        <Icon name="plus" size={14} />
      </button>
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  title,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  title?: string;
  hint?: string;
  disabled?: boolean;
}) {
  const control = (
    <button
      type="button"
      className="switch"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
  if (!title) {
    return control;
  }
  return (
    <div className="switch-row">
      {control}
      <div className="switch-text">
        <div className="switch-title">{title}</div>
        {hint ? <div className="switch-hint">{hint}</div> : null}
      </div>
    </div>
  );
}

export interface TabItem {
  id: string;
  label: string;
  count?: number;
}

export function Tabs({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: TabItem[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          className="tab"
          aria-selected={value === tab.id}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.count === undefined ? null : (
            <span className="subtle"> {tab.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/**
 * نافذة نمطية. تُغلق بـEscape أو بالنقر خارجها، وتحبس التركيز داخلها
 * ما دامت مفتوحة: مستخدم لوحة المفاتيح لا يجد نفسه في الشاشة خلف
 * نافذة مفتوحة على شاشة.
 */
export function Dialog({
  open,
  title,
  onClose,
  wide,
  footer,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  wide?: boolean;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panel.current) {
        return;
      }
      const focusable = panel.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) {
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    panel.current?.focus();
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) {
    return null;
  }
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={panel}
        className={wide ? "dialog dialog-wide" : "dialog"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="dialog-head">
          <h2 className="dialog-title" id={titleId}>
            {title}
          </h2>
          <IconButton icon="x" label="إغلاق" onClick={onClose} />
        </div>
        <div className="dialog-body">{children}</div>
        {footer ? <div className="dialog-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Empty({
  icon = "file",
  title,
  text,
  action,
}: {
  icon?: IconName;
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} size={20} />
      </div>
      <div className="empty-title">{title}</div>
      {text ? <p className="empty-text">{text}</p> : null}
      {action}
    </div>
  );
}

export function Stat({
  label,
  value,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  icon?: IconName;
  tone?: Tone;
}) {
  const color: Record<Tone, string> = {
    neutral: "var(--fg-subtle)",
    brand: "var(--brand)",
    ok: "var(--ok)",
    warn: "var(--warn)",
    bad: "var(--bad)",
    info: "var(--info)",
  };
  return (
    <div className="stat">
      <div className="stat-label">
        {icon ? <Icon name={icon} size={12} /> : null}
        <span>{label}</span>
      </div>
      <div className="stat-value" style={{ color: color[tone] }}>
        {typeof value === "number" ? value.toLocaleString("ar-EG") : value}
      </div>
    </div>
  );
}
