import { Icon } from "../ui/icons";
import { NAV } from "./nav";

/**
 * شريط الحافة. يقود التطبيق إلى شاشاته، ويطوي نفسه إلى عمود أيقونات
 * حين يعرض البث: الشاشة التي تُعرض على المشاهدين لا تحتمل أن يأخذ
 * شريط التنقّل ربع عرضها.
 *
 * الطيّ صفة على `<aside>` لا حالة داخل المكوّن، فيصل الأسلوب من
 * `prefs` إلى هنا وإلى `.app` معاً ويبقى المصدر واحداً.
 */
export function Sidebar({
  route,
  onNavigate,
  rail,
  onToggleRail,
  counts,
  mock,
}: {
  route: string;
  onNavigate: (next: string) => void;
  rail: boolean;
  onToggleRail: () => void;
  counts: Record<string, number>;
  mock: boolean;
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span className="brand-mark" aria-hidden="true">
          <Icon name="bolt" size={16} />
        </span>
        <div className="brand-text">
          <div className="brand-name">Lansher</div>
          <div className="brand-tag">{mock ? "وضع المحاكاة" : "متصل بالنواة"}</div>
        </div>
      </div>

      <div className="sidebar-scroll">
        {NAV.map((section) => (
          <div className="nav-section" key={section.id}>
            <div className="nav-section-title">{section.label}</div>
            {section.items.map((item) => {
              const count = counts[item.id];
              const disabled = item.route === null;
              return (
                <button
                  key={item.id}
                  type="button"
                  className="nav-item"
                  data-disabled={disabled}
                  aria-current={!disabled && route === item.route ? "page" : undefined}
                  title={disabled ? `${item.label} — قريباً` : item.label}
                  onClick={() => {
                    if (item.route) {
                      onNavigate(item.route);
                    }
                  }}
                >
                  <span className="nav-icon">
                    <Icon name={item.icon} size={16} />
                  </span>
                  <span className="nav-label">{item.label}</span>
                  {disabled ? (
                    <span className="nav-count">قريباً</span>
                  ) : count === undefined ? null : (
                    <span className="nav-count">{count}</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="sidebar-foot">
        <button
          type="button"
          className="nav-item"
          onClick={onToggleRail}
          title={rail ? "توسيع الشريط" : "طيّ الشريط"}
        >
          <span className="nav-icon">
            <Icon name="panel" size={16} flip />
          </span>
          <span className="nav-label">{rail ? "توسيع الشريط" : "طيّ الشريط"}</span>
        </button>
      </div>
    </aside>
  );
}
