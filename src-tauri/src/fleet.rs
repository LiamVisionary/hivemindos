use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

const APPS_CACHE_FILE: &str = "~/.hivemindos/fleet-apps-cache.json";
const COLLECTOR_ENV_FILE: &str = "~/.hivemindos/collector.env";
const TAILSCALE_CLI_CANDIDATES: &[&str] = &[
    "/usr/local/bin/tailscale",
    "/opt/homebrew/bin/tailscale",
    "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
    "tailscale",
];

#[derive(Serialize)]
struct NativeDevice {
    #[serde(rename = "self")]
    is_self: bool,
    name: String,
    #[serde(rename = "dnsName")]
    dns_name: String,
    os: String,
    online: bool,
    ip: String,
    #[serde(rename = "collectorUrl")]
    collector_url: String,
    #[serde(rename = "lastSeen")]
    last_seen: Option<String>,
    #[serde(rename = "lastHandshake")]
    last_handshake: Option<String>,
    #[serde(rename = "curAddr")]
    cur_addr: String,
    #[serde(rename = "rxBytes")]
    rx_bytes: i64,
    #[serde(rename = "txBytes")]
    tx_bytes: i64,
    active: bool,
    relay: String,
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn expand_home(value: &str) -> PathBuf {
    let trimmed = value.trim();
    if let Some(home) = home_dir() {
        if trimmed == "~" || trimmed.is_empty() {
            return home;
        }
        if let Some(rest) = trimmed.strip_prefix("~/") {
            return home.join(rest);
        }
    }
    PathBuf::from(trimmed)
}

fn unquote_env_value(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() >= 2
        && ((trimmed.starts_with('"') && trimmed.ends_with('"'))
            || (trimmed.starts_with('\'') && trimmed.ends_with('\'')))
    {
        return trimmed[1..trimmed.len() - 1].to_string();
    }
    trimmed.replace("\\\"", "\"").replace("\\'", "'")
}

fn collector_env_value(key: &str) -> Option<String> {
    let raw = fs::read_to_string(expand_home(COLLECTOR_ENV_FILE)).ok()?;
    raw.lines().find_map(|line| {
        let (name, value) = line.split_once('=')?;
        (name.trim() == key).then(|| unquote_env_value(value))
    })
}

fn local_collector_url() -> String {
    let port = collector_env_value("AGENT_TELEMETRY_PORT")
        .or_else(|| std::env::var("AGENT_TELEMETRY_PORT").ok())
        .unwrap_or_else(|| "8787".to_string());
    format!("http://127.0.0.1:{port}")
}

fn local_device() -> NativeDevice {
    NativeDevice {
        is_self: true,
        name: if cfg!(target_os = "windows") {
            "This PC"
        } else if cfg!(target_os = "macos") {
            "This Mac"
        } else {
            "This Machine"
        }
        .to_string(),
        dns_name: String::new(),
        os: std::env::consts::OS.to_string(),
        online: true,
        ip: "127.0.0.1".to_string(),
        collector_url: local_collector_url(),
        last_seen: None,
        last_handshake: None,
        cur_addr: String::new(),
        rx_bytes: 0,
        tx_bytes: 0,
        active: true,
        relay: String::new(),
    }
}

fn local_collector_port() -> String {
    local_collector_url().rsplit(':').next().unwrap_or("8787").trim_matches('/').to_string()
}

fn http_get_local_json(path: &str) -> Option<Value> {
    let port = local_collector_port();
    let mut stream = TcpStream::connect(format!("127.0.0.1:{port}")).ok()?;
    let _ = stream.set_read_timeout(Some(Duration::from_millis(1200)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(800)));
    let request = format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    stream.write_all(request.as_bytes()).ok()?;
    let mut response = String::new();
    stream.read_to_string(&mut response).ok()?;
    let (_, body) = response.split_once("\r\n\r\n")?;
    serde_json::from_str(body).ok()
}

fn base64(input: &str) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let bytes = input.as_bytes();
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let first = chunk[0];
        let second = *chunk.get(1).unwrap_or(&0);
        let third = *chunk.get(2).unwrap_or(&0);
        out.push(TABLE[(first >> 2) as usize] as char);
        out.push(TABLE[(((first & 0b0000_0011) << 4) | (second >> 4)) as usize] as char);
        out.push(if chunk.len() > 1 { TABLE[(((second & 0b0000_1111) << 2) | (third >> 6)) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[(third & 0b0011_1111) as usize] as char } else { '=' });
    }
    out
}

fn status_from_localapi() -> Option<Value> {
    let port = fs::read_to_string("/Library/Tailscale/ipnport").ok()?.trim().to_string();
    let proof = fs::read_to_string(format!("/Library/Tailscale/sameuserproof-{port}")).ok()?.trim().to_string();
    if port.is_empty() || proof.is_empty() {
        return None;
    }
    let mut stream = TcpStream::connect(format!("127.0.0.1:{port}")).ok()?;
    let _ = stream.set_read_timeout(Some(Duration::from_millis(1800)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(800)));
    let request = format!(
        "GET /localapi/v0/status HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Basic {}\r\nConnection: close\r\n\r\n",
        base64(&format!("x:{proof}")),
    );
    stream.write_all(request.as_bytes()).ok()?;
    let mut response = String::new();
    stream.read_to_string(&mut response).ok()?;
    let (_, body) = response.split_once("\r\n\r\n")?;
    serde_json::from_str(body).ok()
}

fn app_initials(name: &str) -> String {
    let initials = name
        .split_whitespace()
        .filter_map(|part| part.chars().next())
        .take(2)
        .collect::<String>()
        .to_uppercase();
    if initials.is_empty() { "APP".to_string() } else { initials }
}

fn local_collector_apps_payload() -> Result<Value, String> {
    let payload = http_get_local_json("/apps").ok_or_else(|| "Local collector apps are unavailable.".to_string())?;
    let raw_apps = payload.get("apps").and_then(Value::as_array).cloned().unwrap_or_default();
    let apps = raw_apps
        .iter()
        .enumerate()
        .map(|(index, app)| {
            let name = app.get("name").and_then(Value::as_str).unwrap_or("Local app");
            let scheme = app.get("scheme").and_then(Value::as_str).unwrap_or("http");
            let host = app.get("host").and_then(Value::as_str).unwrap_or("127.0.0.1");
            let port = app.get("port").and_then(Value::as_i64).unwrap_or(0);
            let path = app.get("path").and_then(Value::as_str).unwrap_or("/");
            let open_url = app
                .get("localUrl")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| if port > 0 { format!("{scheme}://{host}:{port}{path}") } else { format!("{scheme}://{host}{path}") });
            json!({
                "id": app.get("id").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| format!("native-local-{index}")),
                "name": name,
                "sourceName": name,
                "description": app.get("description").and_then(Value::as_str).unwrap_or("Local service exposed by this Mac."),
                "kind": "service",
                "theme": "from-teal-400 to-cyan-500",
                "initials": app_initials(name),
                "iconUrl": app.get("iconUrl").cloned().unwrap_or(Value::Null),
                "machineName": "This Mac",
                "machineHost": "127.0.0.1",
                "local": true,
                "online": true,
                "interactive": app.get("interactive").and_then(Value::as_bool).unwrap_or(true),
                "serviceKind": app.get("serviceKind").cloned().unwrap_or(Value::Null),
                "scheme": scheme,
                "port": port,
                "path": path,
                "openUrl": open_url,
                "apiBaseUrl": app.get("apiBaseUrl").and_then(Value::as_str).unwrap_or(&open_url),
                "healthUrl": app.get("healthUrl").cloned().unwrap_or(Value::Null)
            })
        })
        .collect::<Vec<_>>();
    Ok(json!({
        "ok": true,
        "checkedAt": chrono::Utc::now().to_rfc3339(),
        "source": "native-local-collector",
        "cacheAgeMs": 0,
        "stale": false,
        "apps": apps,
        "machines": [{ "name": "This Mac", "collector": "native-local", "appCount": apps.len() }]
    }))
}

#[tauri::command]
pub(crate) fn fleet_apps_cache(max_age_ms: Option<u64>) -> Result<Value, String> {
    let Ok(raw) = fs::read_to_string(expand_home(APPS_CACHE_FILE)) else {
        return local_collector_apps_payload();
    };
    let parsed: Value = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(_) => return local_collector_apps_payload(),
    };
    let payload = parsed
        .get("payload")
        .and_then(Value::as_object)
        .ok_or_else(|| "Fleet apps cache does not contain a payload.".to_string())?;
    if payload.get("ok").and_then(Value::as_bool) != Some(true)
        || !payload.get("apps").is_some_and(Value::is_array)
    {
        return Err("Fleet apps cache payload is incomplete.".to_string());
    }
    let checked_at = parsed.get("checkedAt").and_then(Value::as_u64).unwrap_or(0);
    if checked_at == 0 {
        return local_collector_apps_payload();
    }
    let cache_age_ms = (chrono::Utc::now().timestamp_millis().max(0) as u64).saturating_sub(checked_at);
    let mut payload = Value::Object(payload.clone());
    if let Some(object) = payload.as_object_mut() {
        let previous = object.get("source").and_then(Value::as_str).unwrap_or("cache");
        object.insert("source".to_string(), Value::String(format!("native-cache:{previous}")));
        object.insert("cacheAgeMs".to_string(), Value::Number(cache_age_ms.into()));
        object.insert(
            "stale".to_string(),
            Value::Bool(max_age_ms.is_some_and(|max_age| cache_age_ms > max_age) || cache_age_ms > 60_000),
        );
    }
    Ok(payload)
}

fn dns_label(value: &str) -> String {
    value.trim_end_matches('.').split('.').next().unwrap_or("").to_string()
}

fn peer_string(peer: &Value, key: &str) -> String {
    peer.get(key).and_then(Value::as_str).unwrap_or("").to_string()
}

fn peer_bool(peer: &Value, key: &str) -> bool {
    peer.get(key).and_then(Value::as_bool).unwrap_or(false)
}

fn peer_i64(peer: &Value, key: &str) -> i64 {
    peer.get(key).and_then(Value::as_i64).unwrap_or(0)
}

fn peer_ip(peer: &Value) -> String {
    let Some(items) = peer.get("TailscaleIPs").and_then(Value::as_array) else {
        return String::new();
    };
    items
        .iter()
        .filter_map(Value::as_str)
        .find(|value| value.chars().filter(|item| *item == '.').count() == 3)
        .or_else(|| items.iter().filter_map(Value::as_str).next())
        .unwrap_or("")
        .to_string()
}

fn normalize_name(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .filter(|item| item.is_ascii_alphanumeric())
        .collect()
}

fn display_name(peer: &Value, dns_name: &str, ip: &str) -> String {
    let host = peer_string(peer, "HostName");
    let dns = dns_label(dns_name);
    let normalized = host.trim().to_lowercase();
    if normalized.is_empty() || normalized == "localhost" || normalized == "localhost.localdomain" {
        return if dns.is_empty() { ip.to_string() } else { dns };
    }
    if normalize_name(&host).starts_with("hivemindos") && !dns.is_empty() {
        return dns;
    }
    host
}

fn simplify_peer(peer: &Value, is_self: bool) -> NativeDevice {
    let ip = peer_ip(peer);
    let dns_name = peer_string(peer, "DNSName").trim_end_matches('.').to_string();
    NativeDevice {
        is_self,
        name: if is_self { "This Mac".to_string() } else { display_name(peer, &dns_name, &ip) },
        dns_name,
        os: peer_string(peer, "OS"),
        online: is_self || peer_bool(peer, "Online"),
        collector_url: if is_self {
            local_collector_url()
        } else if ip.is_empty() {
            String::new()
        } else {
            format!("http://{ip}:8787")
        },
        ip,
        last_seen: peer.get("LastSeen").and_then(Value::as_str).map(str::to_string),
        last_handshake: peer.get("LastHandshake").and_then(Value::as_str).map(str::to_string),
        cur_addr: peer_string(peer, "CurAddr"),
        rx_bytes: peer_i64(peer, "RxBytes"),
        tx_bytes: peer_i64(peer, "TxBytes"),
        active: peer_bool(peer, "Active"),
        relay: peer_string(peer, "Relay"),
    }
}

fn status_from_cli() -> Result<Value, String> {
    if let Some(status) = status_from_localapi() {
        return Ok(status);
    }
    let mut last_error = "tailscale unavailable".to_string();
    for command in TAILSCALE_CLI_CANDIDATES {
        let output = Command::new(command).args(["status", "--json"]).output();
        let Ok(output) = output else {
            last_error = format!("{command} unavailable");
            continue;
        };
        if !output.status.success() {
            last_error = String::from_utf8_lossy(&output.stderr).trim().to_string();
            continue;
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        return serde_json::from_str::<Value>(&stdout)
            .map_err(|error| format!("Could not parse tailscale status: {error}"));
    }
    Err(last_error)
}

/// This machine's tailnet IPv4 (100.x) when Tailscale is running, else None.
/// Used to bind the phone bridge to the tailnet interface only — reachable by a
/// paired phone over the tailnet, never the local LAN.
pub(crate) fn self_tailnet_ipv4() -> Option<String> {
    let status = status_from_cli().ok()?;
    if status.get("BackendState").and_then(Value::as_str) != Some("Running") {
        return None;
    }
    let ip = peer_ip(status.get("Self")?);
    if ip.starts_with("100.") && ip.chars().filter(|item| *item == '.').count() == 3 {
        Some(ip)
    } else {
        None
    }
}

fn tailnet_health(status: Option<&Value>) -> Value {
    let Some(status) = status else {
        return json!({ "state": "status-unavailable", "detail": "Tailscale status was not available." });
    };
    let backend = status.get("BackendState").and_then(Value::as_str).unwrap_or("");
    if !backend.is_empty() && backend != "Running" {
        return json!({ "state": "not-running", "detail": format!("Tailscale backend is {backend}.") });
    }
    json!({ "state": "ok" })
}

/// Exact machine identity, mirroring `exactMachineIdentity` in the fleet
/// discover route: the normalized dns label (or name) with only the
/// `hivemindos` prefix and `local` suffix stripped. The same physical
/// machine's system node ("liams-macbook-pro") and embedded link node
/// ("hivemindos-liams-macbook-pro") map to the same identity, while
/// tailscale's `-N` suffix is KEPT — a `-1` node is a different physical
/// machine that shares the hostname.
fn exact_machine_identity(name: &str, dns_name: &str) -> String {
    let label = normalize_name(&dns_label(dns_name));
    let value = if label.is_empty() { normalize_name(name) } else { label };
    let value = value.strip_prefix("hivemindos").unwrap_or(&value);
    value.strip_suffix("local").unwrap_or(value).to_string()
}

fn devices_from_status(status: &Value) -> Vec<NativeDevice> {
    let mut devices = Vec::new();
    if let Some(self_peer) = status.get("Self") {
        devices.push(simplify_peer(self_peer, true));
    }
    let self_ip = devices.first().map(|device| device.ip.clone()).unwrap_or_default();
    let self_identity = devices
        .first()
        .map(|device| exact_machine_identity(&device.name, &device.dns_name))
        .unwrap_or_default();
    if let Some(peers) = status.get("Peer").and_then(Value::as_object) {
        for peer in peers.values() {
            let device = simplify_peer(peer, false);
            if !self_ip.is_empty() && device.ip == self_ip {
                continue;
            }
            // This machine's own embedded link node shows up as a peer of the
            // system tailscaled under a different tailnet IP — same exact
            // identity means same physical machine, so fold it into self.
            if !self_identity.is_empty()
                && exact_machine_identity(&device.name, &device.dns_name) == self_identity
            {
                continue;
            }
            devices.push(device);
        }
    }
    if devices.is_empty() {
        devices.push(local_device());
    }
    let mut seen = HashMap::<String, NativeDevice>::new();
    for device in devices {
        let key = if device.is_self {
            "self".to_string()
        } else {
            exact_machine_identity(&device.name, &device.dns_name)
        };
        seen.entry(if key.is_empty() { device.ip.clone() } else { key }).or_insert(device);
    }
    seen.into_values().collect()
}

#[tauri::command]
pub(crate) fn tailscale_devices() -> Result<Value, String> {
    match status_from_cli() {
        Ok(status) => Ok(json!({
            "ok": status.get("BackendState").and_then(Value::as_str) == Some("Running"),
            "backendState": status.get("BackendState").and_then(Value::as_str).unwrap_or(""),
            "magicDnsSuffix": status.get("MagicDNSSuffix").and_then(Value::as_str).unwrap_or(""),
            "source": "native-tailscale",
            "tailnetHealth": tailnet_health(Some(&status)),
            "devices": devices_from_status(&status),
        })),
        Err(error) => Ok(json!({
            "ok": false,
            "error": error,
            "source": "native-tailscale",
            "tailnetHealth": tailnet_health(None),
            "devices": [local_device()],
        })),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn peer(host: &str, dns: &str, ip: &str) -> Value {
        json!({
            "HostName": host,
            "DNSName": dns,
            "TailscaleIPs": [ip],
            "OS": "macOS",
            "Online": true,
        })
    }

    #[test]
    fn folds_own_link_node_into_self_but_keeps_suffixed_machines() {
        // The system tailscaled sees this machine's own embedded link node as
        // a peer under a different tailnet IP. Same exact identity → fold into
        // self. A `-1` node is a DIFFERENT physical machine sharing the
        // hostname and must survive.
        let status = json!({
            "Self": peer("Liams-MacBook-Pro", "liams-macbook-pro.tail1.ts.net.", "100.0.0.1"),
            "Peer": {
                "a": peer("Liams-MacBook-Pro", "hivemindos-liams-macbook-pro.tail1.ts.net.", "100.0.0.2"),
                "b": peer("Liams-MacBook-Pro", "hivemindos-liams-macbook-pro-1.tail1.ts.net.", "100.0.0.3"),
                "c": peer("ubuntu-8gb-hel1-2", "hivemindos-ubuntu-8gb-hel1-2.tail1.ts.net.", "100.0.0.4"),
            },
        });
        let devices = devices_from_status(&status);
        assert_eq!(devices.len(), 3);
        let self_count = devices.iter().filter(|device| device.is_self).count();
        assert_eq!(self_count, 1);
        assert!(!devices.iter().any(|device| device.ip == "100.0.0.2"));
        assert!(devices.iter().any(|device| device.ip == "100.0.0.3"));
        assert!(devices.iter().any(|device| device.ip == "100.0.0.4"));
    }

    #[test]
    fn exact_identity_strips_prefix_and_keeps_suffix() {
        assert_eq!(
            exact_machine_identity("This Mac", "liams-macbook-pro.tail1.ts.net"),
            exact_machine_identity("x", "hivemindos-liams-macbook-pro.tail1.ts.net"),
        );
        assert_ne!(
            exact_machine_identity("x", "hivemindos-liams-macbook-pro-1.tail1.ts.net"),
            exact_machine_identity("x", "hivemindos-liams-macbook-pro.tail1.ts.net"),
        );
    }
}
