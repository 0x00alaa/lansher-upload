import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * تفضيلات المظهر. ثلاثة محاور تُحفظ محلياً وتُطبَّق على عنصر `html`
 * لا على شجرة React: CSS وحده هو من يقرأها، فلا rerender على تبديل
 * السمة ولا خطر أن ينحرف ما يراه المستخدم عن ما حُفظ.
 *
 * لا حساب ولا مزامنة: التفضيل شخصي على هذا الجهاز، وغيره من بيانات
 * الملف الشخصي الذي لم تُبنَ مرحلته بعد.
 */

export const ACCENTS = [
  { id: "violet", label: "بنفسجي" },
  { id: "sky", label: "سماوي" },
  { id: "blue", label: "أزرق" },
  { id: "teal", label: "فيروزي" },
  { id: "green", label: "أخضر" },
  { id: "lime", label: "ليموني" },
  { id: "amber", label: "عنبري" },
  { id: "orange", label: "برتقالي" },
  { id: "rose", label: "قرمزي" },
  { id: "pink", label: "وردي" },
] as const;

export const SCALES = [100, 110, 125, 150] as const;

export type AccentId = (typeof ACCENTS)[number]["id"];
export type ScaleValue = (typeof SCALES)[number];
export type ThemeMode = "light" | "dark" | "system";

export const THEMES: { id: ThemeMode; label: string }[] = [
  { id: "light", label: "فاتح" },
  { id: "dark", label: "داكن" },
  { id: "system", label: "النظام" },
];

export interface Prefs {
  theme: ThemeMode;
  accent: AccentId;
  scale: ScaleValue;
  rail: boolean;
  setTheme: (value: ThemeMode) => void;
  setAccent: (value: AccentId) => void;
  setScale: (value: ScaleValue) => void;
  setRail: (value: boolean) => void;
}

const STORAGE_KEY = "lansher.prefs.v1";

const PrefsContext = createContext<Prefs | null>(null);

interface Stored {
  theme: ThemeMode;
  accent: AccentId;
  scale: ScaleValue;
  rail: boolean;
}

const DEFAULTS: Stored = {
  theme: "system",
  accent: "violet",
  scale: 100,
  rail: false,
};

function isAccent(value: unknown): value is AccentId {
  return ACCENTS.some((entry) => entry.id === value);
}

function isScale(value: unknown): value is ScaleValue {
  return SCALES.some((entry) => entry === value);
}

function isTheme(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

/**
 * قراءة التخزين المحلي بلا ثقة: الملف قابل للتحرير من أي أداة،
 * وقيمة لا تنتمي إلى التعداد تسقط إلى الافتراض بدل أن تُطبَّق على
 * `html` فيبقى التطبيق بلون يكسر التباين.
 */
function load(): Stored {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return DEFAULTS;
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return DEFAULTS;
    }
    const record = parsed as Record<string, unknown>;
    return {
      theme: isTheme(record.theme) ? record.theme : DEFAULTS.theme,
      accent: isAccent(record.accent) ? record.accent : DEFAULTS.accent,
      scale: isScale(record.scale) ? record.scale : DEFAULTS.scale,
      rail: typeof record.rail === "boolean" ? record.rail : DEFAULTS.rail,
    };
  } catch {
    return DEFAULTS;
  }
}

/** السمة الفعلية حين يكون الاختيار على النظام. */
function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode !== "system") {
    return mode;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function apply(stored: Stored): void {
  const root = document.documentElement;
  root.dataset.theme = resolveTheme(stored.theme);
  root.dataset.accent = stored.accent;
  root.dataset.scale = String(stored.scale);
  root.style.setProperty("--ui-scale", String(stored.scale / 100));
}

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState<Stored>(load);

  useEffect(() => {
    apply(stored);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // التخزين ممتلئ أو محظور. التفضيل يبقى في الذاكرة لهذه الجلسة،
      // والكتابة تفشل بصمت لأن رفض الحفظ لا يستوجب إيقاف التطبيق.
    }
  }, [stored]);

  // `system` لا قرار يُطبَّق مرة واحدة: يتغيّر حين يغيّر المستخدم سمة
  // نظامه وهو جالس في التطبيق. بلا مستمع، يبقى على الحالة الأولى.
  useEffect(() => {
    if (stored.theme !== "system") {
      return;
    }
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply(stored);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [stored]);

  const patch = useCallback((next: Partial<Stored>) => {
    setStored((previous) => ({ ...previous, ...next }));
  }, []);

  const value = useMemo<Prefs>(
    () => ({
      theme: stored.theme,
      accent: stored.accent,
      scale: stored.scale,
      rail: stored.rail,
      setTheme: (value) => patch({ theme: value }),
      setAccent: (value) => patch({ accent: value }),
      setScale: (value) => patch({ scale: value }),
      setRail: (value) => patch({ rail: value }),
    }),
    [stored, patch],
  );

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): Prefs {
  const value = useContext(PrefsContext);
  if (!value) {
    throw new Error("usePrefs خارج PrefsProvider");
  }
  return value;
}
