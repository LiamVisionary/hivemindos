// Native "leverage your Slack account" capture flow.
//
// Opens an embedded Slack login window; once the user is signed into a workspace,
// reads the `xoxc-` web token (from the Slack client's localStorage) and the
// httpOnly `d` session cookie (from the webview cookie store) and emits both to
// the dashboard, which persists them to the shared hive env. This gives HivemindOS
// the user's OWN session for workspaces where our OAuth app can't be installed
// (community/course Slacks) — an unofficial path the UI gates behind explicit
// consent. Desktop-only: it needs a native webview + cookie store.
//
// Both reads use stock Tauri 2.11 APIs (WebviewWindow::eval_with_callback +
// ::cookies) and run OFF the UI thread — cookies() blocks on a main-run-loop
// completion block and deadlocks if called from a sync main-thread command.

use serde_json::{json, Value};
use std::sync::mpsc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

const LOGIN_WINDOW_LABEL: &str = "slack-login";
const POLL_ATTEMPTS: usize = 150; // ~5 min at 2s cadence
const POLL_INTERVAL_SECS: u64 = 2;

// Scans the Slack web client's localStorage for a workspace token. Returns a plain
// object { xoxc, team_id, team_name } (present only once fully logged in), else
// null. Kept defensive across the couple of keys/shapes Slack has used.
const READ_TOKEN_JS: &str = r#"
(function () {
  try {
    var keys = ["localConfig_v2", "localConfig"];
    for (var k = 0; k < keys.length; k++) {
      var raw = localStorage.getItem(keys[k]);
      if (!raw) continue;
      var cfg = JSON.parse(raw);
      var teams = (cfg && cfg.teams) || {};
      var order = Object.keys(teams);
      var active = cfg && (cfg.lastActiveTeamId || cfg.activeTeamId);
      if (active && teams[active]) order.unshift(active);
      for (var i = 0; i < order.length; i++) {
        var t = teams[order[i]];
        if (t && typeof t.token === "string" && t.token.indexOf("xoxc-") === 0) {
          return { xoxc: t.token, team_id: t.id || order[i], team_name: t.name || t.domain || "" };
        }
      }
    }
    return null;
  } catch (e) { return null; }
})()
"#;

/// Open the embedded Slack sign-in window and begin capturing. Returns as soon as
/// the window is open; the captured credentials arrive later via the
/// `slack-session-captured` event (or `slack-session-capture-error` on failure).
#[tauri::command]
pub(crate) async fn slack_session_capture(
    app: AppHandle,
    workspace_url: Option<String>,
) -> Result<Value, String> {
    // Only accept an https Slack URL as the starting surface; otherwise the app
    // login picker. This value comes from the UI, so validate it.
    let start_url = workspace_url
        .filter(|u| u.starts_with("https://") && u.contains("slack.com"))
        .unwrap_or_else(|| "https://app.slack.com/".to_string());
    let url = url::Url::parse(&start_url).map_err(|error| error.to_string())?;

    if let Some(window) = app.get_webview_window(LOGIN_WINDOW_LABEL) {
        let _ = window.set_focus();
        return Ok(json!({ "ok": true, "opened": true, "already": true }));
    }

    WebviewWindowBuilder::new(&app, LOGIN_WINDOW_LABEL, WebviewUrl::External(url))
        .title("Sign in to Slack — HivemindOS")
        .inner_size(980.0, 780.0)
        .min_inner_size(720.0, 560.0)
        .resizable(true)
        .build()
        .map_err(|error| error.to_string())?;

    let app_for_task = app.clone();
    tauri::async_runtime::spawn(async move {
        match wait_and_capture(app_for_task.clone()).await {
            Ok(payload) => {
                let _ = app_for_task.emit("slack-session-captured", payload);
            }
            Err(error) => {
                let _ = app_for_task.emit("slack-session-capture-error", json!({ "error": error }));
            }
        }
        if let Some(window) = app_for_task.get_webview_window(LOGIN_WINDOW_LABEL) {
            let _ = window.close();
        }
    });

    Ok(json!({ "ok": true, "opened": true }))
}

async fn wait_and_capture(app: AppHandle) -> Result<Value, String> {
    for _ in 0..POLL_ATTEMPTS {
        let Some(window) = app.get_webview_window(LOGIN_WINDOW_LABEL) else {
            return Err("The Slack sign-in window was closed before completing.".to_string());
        };
        // A transient read error (page mid-load) is not fatal — keep polling.
        if let Ok(Some(mut token)) = read_token(&window).await {
            let cookie = read_d_cookie(&window).await?;
            if let Value::Object(ref mut map) = token {
                map.insert("d".to_string(), Value::String(cookie));
            }
            return Ok(token);
        }
        let _ = tauri::async_runtime::spawn_blocking(|| {
            std::thread::sleep(Duration::from_secs(POLL_INTERVAL_SECS))
        })
        .await;
    }
    Err("Timed out waiting for Slack sign-in.".to_string())
}

/// Read the workspace `xoxc-` token from the Slack client's localStorage.
async fn read_token(window: &tauri::WebviewWindow) -> Result<Option<Value>, String> {
    let (sender, receiver) = mpsc::channel::<String>();
    window
        .eval_with_callback(READ_TOKEN_JS, move |result| {
            let _ = sender.send(result);
        })
        .map_err(|error| error.to_string())?;

    let raw = tauri::async_runtime::spawn_blocking(move || {
        receiver.recv_timeout(Duration::from_secs(6))
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|_| "Reading the Slack token timed out.".to_string())?;

    // eval_with_callback hands back the JSON-serialized JS result. Accept either the
    // object directly or a JSON-encoded string of it.
    let value: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);
    let parsed = match value {
        Value::Object(_) => value,
        Value::String(inner) => serde_json::from_str(&inner).unwrap_or(Value::Null),
        _ => Value::Null,
    };
    let has_token = parsed
        .get("xoxc")
        .and_then(|v| v.as_str())
        .map(|s| s.starts_with("xoxc-"))
        .unwrap_or(false);
    Ok(if has_token { Some(parsed) } else { None })
}

/// Read the httpOnly `d` session cookie from the webview cookie store. Runs off the
/// UI thread — cookies() blocks on a main-run-loop completion block.
async fn read_d_cookie(window: &tauri::WebviewWindow) -> Result<String, String> {
    let handle = window.clone();
    let cookies = tauri::async_runtime::spawn_blocking(move || handle.cookies())
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?;

    for cookie in cookies {
        let domain_ok = cookie.domain().map(|d| d.contains("slack.com")).unwrap_or(false);
        if cookie.name() == "d" && domain_ok {
            return Ok(cookie.value().to_string());
        }
    }
    Err("The Slack `d` session cookie was not found (are you fully signed in?).".to_string())
}
