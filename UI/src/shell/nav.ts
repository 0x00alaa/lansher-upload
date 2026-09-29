import type { IconName } from "../ui/icons";

/**
 * خريطة التنقّل. مصدر واحد لشريط الحافة وعنوان الشريط العلوي، فليس
 * على الشاشة أن تكرّر اسم القسم الذي يعرضه الشريط.
 *
 * `route: null` يعني أن الشاشة لم تُبنَ بعد. العنصر يبقى ظاهراً
 * بشارة «قريباً» لا مخفياً: إخفاء ما وعد به التطبيق أصعب على
 * القارئ من عرضه معلماً. و`enabled` واحد لكل عنصر الآن، فليست
 * العادة أن تُبنى خريطة كاملة من عناصر معطّلة.
 */

export interface NavItem {
  id: string;
  label: string;
  icon: IconName;
  route: string | null;
}

export interface NavSection {
  id: string;
  label: string;
  items: NavItem[];
}

export const NAV: NavSection[] = [
  {
    id: "live",
    label: "البث",
    items: [
      { id: "dashboard", label: "لوحة البث", icon: "dashboard", route: "dashboard" },
      { id: "simulator", label: "محاكي الأحداث", icon: "signal", route: "simulator" },
    ],
  },
  {
    id: "automation",
    label: "الأتمتة",
    items: [
      { id: "rules", label: "القواعد والأحداث", icon: "bolt", route: "rules" },
      { id: "points", label: "نظام النقاط", icon: "trophy", route: null },
    ],
  },
  {
    id: "media",
    label: "الوسائط",
    items: [
      { id: "sounds", label: "مكتبة الأصوات", icon: "volume", route: null },
      { id: "tts", label: "النطق الصوتي", icon: "mic", route: null },
      { id: "alerts", label: "التنبيهات", icon: "bell", route: null },
      { id: "overlays", label: "الطبقات", icon: "monitor", route: null },
    ],
  },
  {
    id: "integrations",
    label: "التكاملات",
    items: [
      { id: "tiktok", label: "TikTok Live", icon: "link", route: null },
      { id: "obs", label: "OBS", icon: "terminal", route: null },
      { id: "streamerbot", label: "Streamer.bot", icon: "plug", route: null },
      { id: "webhooks", label: "Webhooks", icon: "webhook", route: null },
    ],
  },
  {
    id: "content",
    label: "المحتوى",
    items: [
      { id: "profiles", label: "الملفات الشخصية", icon: "folder", route: "profiles" },
      { id: "storage", label: "التخزين", icon: "image", route: null },
    ],
  },
  {
    id: "settings",
    label: "الإعدادات",
    items: [
      { id: "appearance", label: "المظهر", icon: "palette", route: "appearance" },
      { id: "diagnostics", label: "التشخيص", icon: "note", route: null },
    ],
  },
];

const FLAT = NAV.flatMap((section) => section.items);

/** الشاشة المقابلة لمسار، أو `null` إن كان المسار خارج الخريطة. */
export function viewForRoute(route: string): NavItem | null {
  return FLAT.find((item) => item.route === route) ?? null;
}

/** القسم الذي يقع فيه مسار، لعنوان الشريط العلوي. */
export function sectionForRoute(route: string): NavSection | null {
  return NAV.find((section) => section.items.some((item) => item.route === route)) ?? null;
}

export const DEFAULT_ROUTE = "dashboard";
