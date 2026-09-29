import type { LiveEvent, Payload } from "../types";
import { eventTypeName } from "../types";
import type { IconName } from "./icons";

/**
 * ترجمة الحدث إلى سطر يقرؤه إنسان. المحرك يتعامل مع كائنات موسومة
 * لا نصوصاً، وهذه الطبقة هي المكان الوحيد الذي يصير فيه الاسم
 * جملةً عربية، فلا تغرق الشاشات دوال تنسيق.
 *
 * الفكرة من واجهة asure: كل حدث في الجدول يقرأ كفعل واحد على فاعل
 * واحد، لا كصف أعمدة. من يتابع بثاً يقرأ \"أرسل هدية\" لا \"Gift
 * count=2 total_value=10\".
 */
export interface EventLine {
  id: string;
  icon: IconName;
  verb: string;
  user: string;
  detail: string;
  tone: "neutral" | "brand" | "ok";
  at: number;
}

function describe(payload: Payload): { verb: string; detail: string } {
  switch (payload.kind) {
    case "Gift":
      return {
        verb: "أرسل هدية",
        detail: `${payload.data.name} ×${payload.data.count} · ${payload.data.total_value}`,
      };
    case "Like":
      return { verb: "أعجب", detail: `×${payload.data.count}` };
    case "Chat":
      return { verb: "كتب", detail: payload.data.text };
    case "Follow":
      return { verb: "تابعك", detail: "" };
    case "Join":
      return { verb: "انضمّ إلى البث", detail: "" };
    case "Share":
      return { verb: "شارك البث", detail: "" };
    case "Subscribe":
      return {
        verb: "اشترك",
        detail: payload.data?.tier ?? "",
      };
    case "StreamStart":
      return { verb: "بدأ البث", detail: payload.data.title ?? "" };
    case "StreamEnd":
      return { verb: "انتهى البث", detail: "" };
    default:
      return { verb: "حدث مخصّص", detail: eventTypeName({ kind: "Custom", name: "—" }) };
  }
}

function iconFor(payload: Payload): IconName {
  switch (payload.kind) {
    case "Gift":
      return "gift";
    case "Like":
      return "heart";
    case "Chat":
      return "chat";
    case "Follow":
      return "userPlus";
    case "Join":
      return "users";
    case "Share":
      return "share";
    case "Subscribe":
      return "trophy";
    case "StreamStart":
      return "play";
    case "StreamEnd":
      return "stop";
    default:
      return "dot";
  }
}

export function describeEvent(event: LiveEvent): EventLine {
  const { verb, detail } = describe(event.payload);
  const worth = event.payload.kind === "Gift" || event.payload.kind === "Subscribe";
  return {
    id: event.id,
    icon: iconFor(event.payload),
    verb,
    user: event.user?.nickname ?? "غير معروف",
    detail,
    tone: worth ? "brand" : "neutral",
    at: event.received_ms,
  };
}
