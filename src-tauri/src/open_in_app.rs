use crate::{
    clean_target, display_path, open_system_target, open_terminal_in_directory, path_from_target,
    reveal_system_path,
};
#[cfg(not(target_os = "macos"))]
use crate::hidden_command;
use serde_json::Value;
use std::path::Path;
use std::process::Command;

enum OpenInAppMethod {
    Editor {
        cli: Option<&'static str>,
        mac_app: Option<&'static str>,
        url_scheme: Option<&'static str>,
        mac_only: bool,
    },
    Terminal,
    Reveal,
    Default,
}

struct OpenInAppSpec {
    id: &'static str,
    display: &'static str,
    method: OpenInAppMethod,
}

const OPEN_IN_APP_MATRIX: &[OpenInAppSpec] = &[
    OpenInAppSpec {
        id: "vscode",
        display: "Visual Studio Code",
        method: OpenInAppMethod::Editor {
            cli: Some("code"),
            mac_app: Some("Visual Studio Code"),
            url_scheme: Some("vscode://file"),
            mac_only: false,
        },
    },
    OpenInAppSpec {
        id: "xcode",
        display: "Xcode",
        method: OpenInAppMethod::Editor {
            cli: None,
            mac_app: Some("Xcode"),
            url_scheme: None,
            mac_only: true,
        },
    },
    OpenInAppSpec {
        id: "terminal",
        display: "Terminal",
        method: OpenInAppMethod::Terminal,
    },
    OpenInAppSpec {
        id: "finder",
        display: "the file manager",
        method: OpenInAppMethod::Reveal,
    },
    OpenInAppSpec {
        id: "default",
        display: "the default app",
        method: OpenInAppMethod::Default,
    },
];

#[cfg(target_os = "macos")]
const MAC_OPEN_APP_QUERY: &str = r#"
ObjC.import("AppKit");
function bundleRecord(appUrl) {
  if (!appUrl) return null;
  const bundle = $.NSBundle.bundleWithURL(appUrl);
  return {
    name: ObjC.unwrap(appUrl.lastPathComponent.stringByDeletingPathExtension),
    bundleId: ObjC.unwrap(bundle.bundleIdentifier),
    path: ObjC.unwrap(appUrl.path),
  };
}
function priority(app) {
  const name = app.name.toLowerCase();
  if (name.includes("hivemind office") || name.includes("hermesoffice") || name.includes("genoffice")) return 5;
  if (name.includes("visual studio code") || name === "cursor" || name === "zed") return 10;
  if (name.includes("sublime") || name.includes("bbedit") || name.includes("nova")) return 20;
  if (name === "xcode" || name.includes("pycharm") || name.includes("webstorm")) return 30;
  if (name === "textedit" || name === "preview") return 40;
  if (name === "safari" || name === "google chrome" || name === "firefox") return 50;
  return 100;
}
function displayName(record) {
  if (record.bundleId === "com.hivemindos.office") return "Hivemind Office";
  if (record.bundleId === "com.hermesoffice.app") return "Hivemind Office (HermesOffice)";
  if (record.bundleId === "com.genoffice.app") return "Hivemind Office (GenOffice)";
  return record.name;
}
function run(argv) {
  const url = $.NSURL.fileURLWithPath(argv[0]);
  const workspace = $.NSWorkspace.sharedWorkspace;
  const urls = workspace.URLsForApplicationsToOpenURL(url);
  const defaultApp = bundleRecord(workspace.URLForApplicationToOpenURL(url));
  const defaultBundleId = defaultApp ? defaultApp.bundleId : "";
  const roots = ["/Applications/", ObjC.unwrap($.NSHomeDirectory()) + "/Applications/", "/System/Applications/", "/System/Library/CoreServices/"];
  const blocked = ["com.apple.Notes", "com.apple.dt.Instruments", "com.google.chrome.for.testing"];
  const seen = {};
  const apps = [];
  for (let index = 0; index < urls.count; index += 1) {
    const record = bundleRecord(urls.objectAtIndex(index));
    if (!record || !record.name || !record.bundleId || !record.path) continue;
    if (!roots.some((root) => record.path.startsWith(root))) continue;
    if (record.path.includes("/Contents/Applications/") || blocked.includes(record.bundleId) || seen[record.bundleId]) continue;
    seen[record.bundleId] = true;
    apps.push({ id: `bundle:${record.bundleId}`, name: displayName(record), isDefault: record.bundleId === defaultBundleId });
  }
  apps.sort((left, right) => Number(right.isDefault) - Number(left.isDefault) || priority(left) - priority(right) || left.name.localeCompare(right.name));
  return JSON.stringify({ ok: true, available: true, apps: apps.slice(0, 8), fileManagerLabel: "Finder", source: "local" });
}"#;

#[cfg(target_os = "macos")]
fn mac_open_in_apps(path: &Path) -> Result<Value, String> {
    let output = Command::new("/usr/bin/osascript")
        .args(["-l", "JavaScript", "-e", MAC_OPEN_APP_QUERY])
        .arg(path)
        .output()
        .map_err(|error| format!("Could not inspect compatible applications: {error}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("Compatible application data was invalid: {error}"))
}

#[cfg(not(target_os = "macos"))]
fn command_on_path(program: &str) -> bool {
    #[cfg(target_os = "windows")]
    let detector = "where.exe";
    #[cfg(not(target_os = "windows"))]
    let detector = "which";
    hidden_command(detector)
        .arg(program)
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn open_in_apps_for_path(path: &Path) -> Result<Value, String> {
    #[cfg(target_os = "macos")]
    {
        mac_open_in_apps(path)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let apps = if command_on_path("code") {
            vec![serde_json::json!({ "id": "vscode", "name": "Visual Studio Code", "isDefault": false })]
        } else {
            Vec::new()
        };
        let manager = if cfg!(target_os = "windows") {
            "File Explorer"
        } else {
            "file manager"
        };
        Ok(serde_json::json!({
            "ok": true,
            "available": true,
            "apps": apps,
            "fileManagerLabel": manager,
            "source": "local",
        }))
    }
}

#[tauri::command]
pub(crate) fn list_open_in_apps(path: String) -> Result<Value, String> {
    let file_path = path_from_target(&path)?;
    if !file_path.is_file() {
        return Err("Target file does not exist on this machine.".to_string());
    }
    open_in_apps_for_path(&file_path)
}

fn dynamic_bundle_id(app_id: &str) -> Option<&str> {
    let bundle_id = app_id.strip_prefix("bundle:")?;
    (bundle_id.len() >= 3
        && bundle_id.len() <= 160
        && bundle_id.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '-')
        }))
    .then_some(bundle_id)
}

fn try_launch_cli(program: &str, path: &Path) -> Result<bool, String> {
    match Command::new(program).arg(path).spawn() {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.to_string()),
    }
}

fn open_with_mac_app(app: &str, path: &Path) -> Result<(), String> {
    Command::new("open")
        .args(["-a", app])
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn launch_editor(
    display: &str,
    cli: Option<&str>,
    mac_app: Option<&str>,
    url_scheme: Option<&str>,
    mac_only: bool,
    path: &Path,
) -> Result<&'static str, String> {
    if mac_only && !cfg!(target_os = "macos") {
        return Err(format!("{} is only available on macOS.", display));
    }
    if let Some(program) = cli {
        if try_launch_cli(program, path)? {
            return Ok("cli");
        }
    }
    if cfg!(target_os = "macos") {
        if let Some(app) = mac_app {
            open_with_mac_app(app, path)?;
            return Ok("app");
        }
    }
    if let Some(scheme) = url_scheme {
        open_system_target(&format!("{}{}", scheme, path.to_string_lossy()))?;
        return Ok("url");
    }
    Err(format!("{} is not available on this machine.", display))
}

#[tauri::command]
pub(crate) fn open_in_app(app: String, path: String) -> Result<Value, String> {
    let app_id = clean_target(&app);
    let file_path = path_from_target(&path)?;
    if !file_path.exists() {
        return Err("Target does not exist on this machine.".to_string());
    }

    if let Some(bundle_id) = dynamic_bundle_id(&app_id) {
        #[cfg(target_os = "macos")]
        {
            let apps = open_in_apps_for_path(&file_path)?;
            let registered = apps
                .get("apps")
                .and_then(Value::as_array)
                .map(|entries| {
                    entries.iter().any(|entry| {
                        entry.get("id").and_then(Value::as_str) == Some(app_id.as_str())
                    })
                })
                .unwrap_or(false);
            if !registered {
                return Err("That application is not registered to open this file type.".to_string());
            }
            Command::new("/usr/bin/open")
                .args(["-b", bundle_id])
                .arg(&file_path)
                .spawn()
                .map_err(|error| error.to_string())?;
            return Ok(serde_json::json!({
                "ok": true,
                "app": app_id,
                "method": "bundle",
                "path": display_path(&file_path),
            }));
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = bundle_id;
            return Err("macOS application bundles are not available on this machine.".to_string());
        }
    }

    let spec = OPEN_IN_APP_MATRIX
        .iter()
        .find(|entry| entry.id == app_id.as_str())
        .ok_or_else(|| format!("Unknown app target: {}", app_id))?;
    let method_used = match &spec.method {
        OpenInAppMethod::Editor {
            cli,
            mac_app,
            url_scheme,
            mac_only,
        } => launch_editor(
            spec.display,
            *cli,
            *mac_app,
            *url_scheme,
            *mac_only,
            &file_path,
        )?,
        OpenInAppMethod::Terminal => {
            open_terminal_in_directory(&file_path)?;
            "terminal"
        }
        OpenInAppMethod::Reveal => {
            reveal_system_path(&file_path)?;
            "reveal"
        }
        OpenInAppMethod::Default => {
            open_system_target(&file_path.to_string_lossy())?;
            "default"
        }
    };
    Ok(serde_json::json!({
        "ok": true,
        "app": spec.id,
        "method": method_used,
        "path": display_path(&file_path),
    }))
}

#[cfg(test)]
mod tests {
    use super::dynamic_bundle_id;

    #[test]
    fn dynamic_bundle_ids_are_strictly_validated() {
        assert_eq!(
            dynamic_bundle_id("bundle:com.microsoft.VSCode"),
            Some("com.microsoft.VSCode")
        );
        assert_eq!(dynamic_bundle_id("bundle:../../Applications/Bad"), None);
        assert_eq!(dynamic_bundle_id("bundle:bad bundle"), None);
        assert_eq!(dynamic_bundle_id("vscode"), None);
    }
}
