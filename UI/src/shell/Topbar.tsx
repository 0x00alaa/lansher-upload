import { Icon, type IconName } from "../ui/icons";
import { IconButton } from "../ui/primitives";
import { THEMES, usePrefs, type ThemeMode } from "../ui/prefs";
import type { AppState } from "../types";

const THEME_LABEL: Record<ThemeMode, string> = {
  light: "فاتح",
  dark: "داكن",
  system: "النظام",
};

const THEME_ICON: Record<ThemeMode, IconName> = {
  light: "sun",
  dark: "moon",
  system: "monitor",
};

/** التالية في دورة الفاتح/الداكن/النظام، بدءاً من الحالة الجارية. */
function nextTheme(current: ThemeMode): ThemeMode {
  const index = THEMES.findIndex((entry) => entry.id === current);
  return THEMES[(index + 1) % THEMES.length]?.id ?? "system";
}

/**
 * شريط الحالة. يجيب عن سؤالين لا غير: هل البث جارٍ، وما الحالة التي
 * يقرأها التطبيق. تبديل السمة زر واحد يدور بين ثلاث حالات بدل قائمة
 * منسدلة: خيار يُستعمل كل يوم لا يستحق أن يفتح قائمة.
 */
export function Topbar({
  title,
  state,
}: {
  title: string;
  state: AppState | null;
}) {
  const prefs = usePrefs();
  const live = state?.source.connected === true && state.engine.running;
  const viewers = state?.engine.counts.viewers ?? 0;

  return (
    <div className="topbar">
      <div className="topbar-title">{title}</div>
      <div className="topbar-spacer" />
      <div className="topbar-group">
        {live ? (
          <span className="badge badge-live">
            <span className="live-dot" />
            مباشر · {viewers.toLocaleString("ar-EG")} مشاهد
          </span>
        ) : (
          <span className="badge">غير متصل</span>
        )}
        {state?.engine.latency_ms ? (
          <span className="badge tnum">{state.engine.latency_ms}ms</span>
        ) : null}
        <IconButton
          icon={THEME_ICON[prefs.theme]}
          label={`السمة: ${THEME_LABEL[prefs.theme]}`}
          onClick={() => prefs.setTheme(nextTheme(prefs.theme))}
        />
      </div>
    </div>
  );
}

/**
 * شريط حالة مضغوط أسفل النافذة العائمة في البث. نفس القراءة في
 * نافذتين مختلفتين، فالمنطق في دالة واحدة لا في شاشتين.
 */
export function LiveStrip({ state }: { state: AppState | null }) {
  if (!state) {
    return null;
  }
  const counts = state.engine.counts;
  const entries: { label: string; value: number; icon: IconName }[] = [
    { label: "مشاهدون", value: counts.viewers, icon: "eye" },
    { label: "هدايا", value: counts.gifts, icon: "gift" },
    { label: "قيمة", value: counts.gift_value, icon: "trophy" },
    { label: "إعجابات", value: counts.likes, icon: "heart" },
    { label: "متابعون", value: counts.follows, icon: "userPlus" },
  ];
  return (
    <div className="row row-tight">
      {entries.map((entry) => (
        <span className="badge tnum" key={entry.label}>
          <Icon name={entry.icon} size={12} />
          {entry.value.toLocaleString("ar-EG")}
          <span className="subtle">{entry.label}</span>
        </span>
      ))}
    </div>
  );
}
