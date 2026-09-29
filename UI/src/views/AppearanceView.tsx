import { Card, PageHead, Tabs } from "../ui/primitives";
import { ACCENTS, SCALES, THEMES, usePrefs } from "../ui/prefs";

/**
 * شاشة المظهر. كل ما فيها يغيّر تفضيلاً محلياً لا حالة في المحرك،
 * فليست لها أي علاقة بالعقد ولا تحتاج اختباراً في `lansher-core`:
 * أثرها مرئي وحده.
 *
 * معاينة اللون هنا هي اللون نفسه، لا صورة له: كل مربّع يحمل قيمة
 * `--brand` الحقيقية، فيرى المستخدم ما سيحصل عليه في بقية التطبيق
 * قبل أن يختار.
 */
export default function AppearanceView() {
  const prefs = usePrefs();

  return (
    <>
      <PageHead
        title="المظهر"
        sub="اختر سمة التطبيق ولون التمييز وحجم العناصر."
      />

      <Card title="السمة">
        <div className="row">
          <Tabs
            label="سمة التطبيق"
            value={prefs.theme}
            onChange={(id) => prefs.setTheme(id as typeof prefs.theme)}
            tabs={THEMES.map((entry) => ({ id: entry.id, label: entry.label }))}
          />
          <span className="subtle">
            «النظام» يتبع سمة ويندوز ويتغيّر معها فوراً.
          </span>
        </div>
      </Card>

      <Card
        title="لون التمييز"
        sub="يغيّر لون الأزرار والعناصر المميّزة فوراً."
      >
        <div className="accent-grid">
          {ACCENTS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="accent-chip"
              data-accent={entry.id}
              aria-pressed={prefs.accent === entry.id}
              onClick={() => prefs.setAccent(entry.id)}
            >
              <span className="accent-dot" />
              <span>{entry.label}</span>
            </button>
          ))}
        </div>
      </Card>

      <Card
        title="حجم الواجهة"
        sub="اضبط حجم كل العناصر دفعة واحدة. مفيد على الشاشات الكبيرة."
      >
        <div className="row">
          <Tabs
            label="حجم الواجهة"
            value={String(prefs.scale)}
            onChange={(id) => prefs.setScale(Number(id) as typeof prefs.scale)}
            tabs={SCALES.map((value) => ({ id: String(value), label: `${value}%` }))}
          />
          <span className="subtle">100% مناسب لـ1080p · 125% لـ2K · 150% لـ4K</span>
        </div>
      </Card>
    </>
  );
}
