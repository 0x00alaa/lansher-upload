// بدون هذا السطر يُبنى التطبيق بـ`Console`، فيفتح له نافذة سطر أوامر
// سوداء خلف نافذة Tauri. الواجهة نافذة، لاطرفية: فلا شيء منها يُرى.
#![windows_subsystem = "windows"]

// جسر Tauri: طبقة رفيعة فقط. كل المنطق في `lansher-server`، وهنا أمر واحد
// يمرّر الطلب ويعيد الرد كما هو. لا منطق أعمال هنا حتى يبقى الاختبار ممكناً
// دون نافذة.

use lansher_server::{now_ms, Bridge, Request, Response, APP_NAME, APP_VERSION};
use std::sync::Mutex;
use tauri::{Manager, RunEvent, State};

struct AppState {
    bridge: Mutex<Bridge>,
}

#[tauri::command]
fn bridge_request(state: State<'_, AppState>, request: Request) -> Result<Response, String> {
    let mut bridge = state
        .bridge
        .lock()
        .map_err(|_| "حالة الجسر مشغولة".to_string())?;
    Ok(bridge.handle(request))
}

#[tauri::command]
fn auth_token(state: State<'_, AppState>) -> Result<String, String> {
    let bridge = state
        .bridge
        .lock()
        .map_err(|_| "حالة الجسر مشغولة".to_string())?;
    bridge
        .auth_token()
        .ok_or_else(|| "لا يوجد رمز دخول".to_string())
}

#[tauri::command]
fn app_info() -> serde_json::Value {
    serde_json::json!({
        "name": APP_NAME,
        "version": APP_VERSION,
        "started_at_ms": now_ms(),
    })
}

fn main() {
    tauri::Builder::default()
        .manage(AppState {
            bridge: Mutex::new(Bridge::new()),
        })
        .invoke_handler(tauri::generate_handler![
            bridge_request,
            auth_token,
            app_info
        ])
        .build(tauri::generate_context!())
        .expect("فشل بناء تطبيق Tauri")
        .run(|app, event| {
            if let RunEvent::ExitRequested { .. } = event {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_title(&format!("{APP_NAME} {APP_VERSION}"));
                }
            }
        });
}
