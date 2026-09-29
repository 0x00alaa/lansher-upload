import { useCallback, useEffect, useMemo, useState } from "react";
import { createBridge, type BridgeClient } from "./bridge";
import { Sidebar } from "./shell/Sidebar";
import { Topbar } from "./shell/Topbar";
import { DEFAULT_ROUTE, sectionForRoute, viewForRoute } from "./shell/nav";
import { Note } from "./ui/primitives";
import { usePrefs } from "./ui/prefs";
import type { AppState, Explanation, LiveEvent, Rule } from "./types";
import Dashboard from "./views/Dashboard";
import RulesView from "./views/RulesView";
import SimulatorView from "./views/SimulatorView";
import ProfilesView from "./views/ProfilesView";
import AppearanceView from "./views/AppearanceView";

/**
 * جذر التطبيق: الصدفة، والمسار، والحالة المشتركة بين الشاشات.
 *
 * المسار في عنوان الصفحة لا في حالة `useState`: به يعود المستخدم إلى
 * الشاشة نفسها عند إعادة التحميل، ويعمل زر الرجوع في ويندوز كما
 * يتوقع. والصدفة لا تعرف شيئاً عن القواعد ولا عن الأحداث، فتقرأ
 * ما تعطيه إياه الشاشة وتعرض ما تعيده.
 */
function readRoute(): string {
  const hash = window.location.hash.replace(/^#\/?/, "");
  return viewForRoute(hash) ? hash : DEFAULT_ROUTE;
}

export default function App() {
  const bridge = useMemo<BridgeClient>(() => createBridge(), []);
  const prefs = usePrefs();
  const [route, setRoute] = useState(readRoute);
  const [state, setState] = useState<AppState | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [feed, setFeed] = useState<LiveEvent[]>([]);
  const [explanations, setExplanations] = useState<Explanation[]>([]);
  const [error, setError] = useState<string | null>(null);

  /**
   * كل حدث يصل من أي مصدر — محاكي كان أو موصل حقيقي — يصير في
   * قائمة واحدة هنا. المكوّنات لا تعرف من أين جاء، فلا تُكتب نسخة
   * ثانية من عدّاد في الشاشة التي تعرضه.
   */
  const onEvent = useCallback((event: LiveEvent) => {
    setFeed((previous) => [event, ...previous].slice(0, 60));
  }, []);

  const navigate = useCallback((next: string) => {
    window.location.hash = `/${next}`;
    setRoute(next);
  }, []);

  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await bridge.send({ cmd: "get_state" });
      setState(response.data as AppState);
      const listed = await bridge.send({ cmd: "list_rules" });
      setRules((listed.data as Rule[]) ?? []);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [bridge]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const onExplain = useCallback(
    async (rule: Rule, event: LiveEvent) => {
      try {
        const response = await bridge.send({
          cmd: "explain_rule",
          rule_id: rule.id,
          event,
        });
        setExplanations((response.data as Explanation[]) ?? []);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [bridge],
  );

  const view = viewForRoute(route) ?? viewForRoute(DEFAULT_ROUTE);
  const section = sectionForRoute(route);
  const counts: Record<string, number> = {
    rules: state?.rule_count ?? 0,
    profiles: state?.profile_count ?? 0,
  };

  return (
    <div className="app" data-rail={prefs.rail}>
      <Sidebar
        route={route}
        onNavigate={navigate}
        rail={prefs.rail}
        onToggleRail={() => prefs.setRail(!prefs.rail)}
        counts={counts}
        mock={bridge.kind === "mock"}
      />

      <div className="main-wrap">
        <Topbar
          title={section && view ? `${view.label}` : "Lansher"}
          state={state}
        />
        <main className="main">
          <div className="content">
            {error ? <Note tone="bad">{error}</Note> : null}

            {route === "dashboard" ? (
              <Dashboard state={state} feed={feed} onNavigate={navigate} />
            ) : null}

            {route === "simulator" ? (
              <SimulatorView bridge={bridge} onEvent={onEvent} />
            ) : null}

            {route === "rules" ? (
              <RulesView
                bridge={bridge}
                rules={rules}
                onChanged={refresh}
                explanations={explanations}
                onExplain={onExplain}
              />
            ) : null}

            {route === "profiles" ? <ProfilesView bridge={bridge} /> : null}

            {route === "appearance" ? <AppearanceView /> : null}
          </div>
        </main>
      </div>
    </div>
  );
}
