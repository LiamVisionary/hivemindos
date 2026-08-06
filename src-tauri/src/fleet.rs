use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::{self, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::process::{Child, Command, Output, Stdio};
use std::time::{Duration, Instant};

const APPS_CACHE_FILE: &str = "~/.hivemindos/fleet-apps-cache.json";
const COLLECTOR_ENV_FILE: &str = "~/.hivemindos/collector.env";
const TAILSCALE_STATUS_TIMEOUT: Duration = Duration::from_secs(3);
#[cfg(target_os = "macos")]
const MACOS_TAILSCALE_DISCOVERY_TIMEOUT: Duration = Duration::from_millis(750);
const MACOS_APP_STORE_TAILSCALE_BUNDLE_ID: &str = "io.tailscale.ipn.macos";
const TAILSCALE_CLI_CANDIDATES: &[&str] = &[
    "/usr/local/bin/tailscale",
    "/opt/homebrew/bin/tailscale",
    "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
    "tailscale",
];

#[derive(Clone, Serialize)]
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

fn http_get_json_url(raw_url: &str, timeout_ms: u64) -> Result<Value, String> {
    let url = url::Url::parse(raw_url).map_err(|error| format!("Invalid collector URL: {error}"))?;
    if url.scheme() != "http" {
        return Err("Collector URL must use http.".to_string());
    }
    let host = url.host_str().ok_or_else(|| "Collector URL has no host.".to_string())?;
    let port = url.port_or_known_default().ok_or_else(|| "Collector URL has no port.".to_string())?;
    let mut path = url.path().to_string();
    if path.is_empty() {
        path = "/".to_string();
    }
    if let Some(query) = url.query() {
        path.push('?');
        path.push_str(query);
    }

    let timeout = Duration::from_millis(timeout_ms);
    let mut addrs = (host, port)
        .to_socket_addrs()
        .map_err(|error| format!("Could not resolve collector host: {error}"))?;
    let addr = addrs.next().ok_or_else(|| "Collector host resolved to no addresses.".to_string())?;
    let mut stream = TcpStream::connect_timeout(&addr, timeout)
        .map_err(|error| format!("Collector connection failed: {error}"))?;
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(timeout_ms.min(800))));
    let request = format!(
        "GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nAccept: application/json\r\nConnection: close\r\n\r\n"
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|error| format!("Collector request failed: {error}"))?;
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|error| format!("Collector response failed: {error}"))?;
    let (head, body) = response
        .split_once("\r\n\r\n")
        .ok_or_else(|| "Collector returned an invalid HTTP response.".to_string())?;
    if !(head.starts_with("HTTP/1.1 2") || head.starts_with("HTTP/1.0 2")) {
        let status = head.lines().next().unwrap_or("HTTP error");
        return Err(format!("Collector returned {status}."));
    }
    serde_json::from_str(body.trim()).map_err(|error| format!("Collector JSON parse failed: {error}"))
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

fn terminate_command_tree(child: &mut Child) {
    #[cfg(unix)]
    {
        let process_group = format!("-{}", child.id());
        let _ = Command::new("/bin/kill")
            .args(["-KILL", &process_group])
            .status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn command_output_with_timeout(
    mut command: Command,
    timeout: Duration,
) -> io::Result<Output> {
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command.spawn()?;
    let started = Instant::now();
    loop {
        if child.try_wait()?.is_some() {
            return child.wait_with_output();
        }
        if started.elapsed() >= timeout {
            terminate_command_tree(&mut child);
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                format!("command timed out after {} ms", timeout.as_millis()),
            ));
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn should_use_tailscale_cli_fallback() -> bool {
    !cfg!(target_os = "macos")
        || std::env::var("HIVEMIND_TAILSCALE_CLI_FALLBACK").as_deref() == Ok("1")
}

fn macos_app_store_service_connected(service_list: &str) -> bool {
    let bundle_marker = format!("[VPN:{MACOS_APP_STORE_TAILSCALE_BUNDLE_ID}]");
    service_list
        .lines()
        .any(|line| line.contains("(Connected)") && line.contains(&bundle_marker))
}

fn connected_macos_app_store_cli() -> Option<PathBuf> {
    #[cfg(not(target_os = "macos"))]
    {
        None
    }

    #[cfg(target_os = "macos")]
    {
        // The App Store variant does not expose the standalone daemon's
        // /Library/Tailscale LocalAPI files. Invoking its GUI executable is
        // safe only after macOS confirms that exact variant is already
        // connected; otherwise a status poll can launch an app or VPN prompt.
        let mut service_probe = crate::hidden_command("/usr/sbin/scutil");
        service_probe.args(["--nc", "list"]);
        let service_output = command_output_with_timeout(
            service_probe,
            MACOS_TAILSCALE_DISCOVERY_TIMEOUT,
        )
        .ok()?;
        if !service_output.status.success()
            || !macos_app_store_service_connected(&String::from_utf8_lossy(
                &service_output.stdout,
            ))
        {
            return None;
        }

        let query = format!(
            "kMDItemCFBundleIdentifier == \"{MACOS_APP_STORE_TAILSCALE_BUNDLE_ID}\""
        );
        let mut app_probe = crate::hidden_command("/usr/bin/mdfind");
        app_probe.args(["-onlyin", "/Applications", &query]);
        let app_output = command_output_with_timeout(
            app_probe,
            MACOS_TAILSCALE_DISCOVERY_TIMEOUT,
        )
        .ok()?;
        if !app_output.status.success() {
            return None;
        }

        String::from_utf8_lossy(&app_output.stdout)
            .lines()
            .map(str::trim)
            .filter(|path| !path.is_empty())
            .map(PathBuf::from)
            .map(|app| app.join("Contents/MacOS/Tailscale"))
            .find(|cli| cli.is_file())
    }
}

fn tailscale_cli_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(app_store_cli) = connected_macos_app_store_cli() {
        candidates.push(app_store_cli);
    }
    if should_use_tailscale_cli_fallback() {
        for command in TAILSCALE_CLI_CANDIDATES {
            let candidate = PathBuf::from(command);
            if !candidates.contains(&candidate) {
                candidates.push(candidate);
            }
        }
    }
    candidates
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
    let candidates = tailscale_cli_candidates();
    if candidates.is_empty() {
        return Err("Tailscale LocalAPI did not respond.".to_string());
    }
    let mut last_error = "tailscale unavailable".to_string();
    for command in candidates {
        // hidden_command: fleet status is polled; a plain `tailscale status`
        // spawn flashes a console window on Windows each poll when the local
        // API path is unavailable. See crate::hidden_command.
        let mut probe = crate::hidden_command(&command);
        probe.args(["status", "--json"]);
        let output = match command_output_with_timeout(probe, TAILSCALE_STATUS_TIMEOUT) {
            Ok(output) => output,
            Err(error) if error.kind() == io::ErrorKind::TimedOut => {
                return Err(format!(
                    "Tailscale status check timed out after {} seconds.",
                    TAILSCALE_STATUS_TIMEOUT.as_secs()
                ));
            }
            Err(_) => {
                last_error = format!("{} unavailable", command.display());
                continue;
            }
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
        return json!({
            "state": "status-unavailable",
            "requiresAttention": true,
            "detail": "Tailscale needs attention. Its local service did not respond. HivemindOS is continuing locally."
        });
    };
    let backend = status.get("BackendState").and_then(Value::as_str).unwrap_or("");
    if !backend.is_empty() && backend != "Running" {
        return json!({
            "state": "not-running",
            "requiresAttention": true,
            "detail": format!("Tailscale needs attention. Its backend is {backend}. HivemindOS is continuing locally.")
        });
    }
    json!({ "state": "ok", "requiresAttention": false })
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

pub(crate) fn tailscale_devices_payload() -> Result<Value, String> {
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

#[tauri::command]
pub(crate) async fn tailscale_devices() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(tailscale_devices_payload)
        .await
        .map_err(|error| format!("Tailscale status task failed: {error}"))?
}

fn is_mobile_device(device: &NativeDevice) -> bool {
    matches!(device.os.to_lowercase().as_str(), "ios" | "android")
}

fn collector_url_for_host(host: &str, port: u16) -> Option<String> {
    let trimmed = host.trim().trim_end_matches('.');
    if trimmed.is_empty() {
        return None;
    }
    Some(format!("http://{trimmed}:{port}"))
}

fn push_unique(values: &mut Vec<String>, value: Option<String>) {
    let Some(value) = value else {
        return;
    };
    if !values.iter().any(|item| item == &value) {
        values.push(value);
    }
}

fn collector_url_candidates(device: &NativeDevice) -> Vec<String> {
    if device.is_self {
        return vec![local_collector_url()];
    }
    let mut values = Vec::new();
    for port in 8787..=8810 {
        push_unique(&mut values, collector_url_for_host(&device.ip, port));
    }
    let dns_name = device.dns_name.trim_end_matches('.');
    let dns_short = dns_label(dns_name);
    for port in 8787..=8810 {
        push_unique(&mut values, collector_url_for_host(&dns_short, port));
        push_unique(&mut values, collector_url_for_host(dns_name, port));
    }
    values
}

fn is_hivemind_collector_health(payload: &Value) -> bool {
    payload
        .get("version")
        .and_then(|version| version.get("appDir"))
        .is_some()
        || payload
            .get("machineId")
            .and_then(Value::as_str)
            .is_some_and(|value| value.starts_with("hivemind-machine-"))
        || payload
            .get("capabilities")
            .and_then(|capabilities| capabilities.get("runtimes"))
            .is_some_and(Value::is_array)
        || payload
            .get("capabilities")
            .and_then(|capabilities| capabilities.get("hostedApps"))
            .and_then(Value::as_bool)
            == Some(true)
        || payload
            .get("capabilities")
            .and_then(|capabilities| capabilities.get("runtimeAgentCreation"))
            .and_then(Value::as_bool)
            == Some(true)
}

fn collector_agents(collector_url: &str, device: &NativeDevice, capabilities: &Value) -> Vec<Value> {
    let agents_payload = http_get_json_url(&format!("{collector_url}/agents"), 1600).ok();
    agents_payload
        .and_then(|payload| payload.get("agents").and_then(Value::as_array).cloned())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|agent| {
            let mut object = agent.as_object()?.clone();
            object.insert("telemetryUrl".to_string(), Value::String(collector_url.to_string()));
            object.insert("machineName".to_string(), Value::String(device.name.clone()));
            object.insert("collectorCapabilities".to_string(), capabilities.clone());
            Some(Value::Object(object))
        })
        .collect()
}

fn probe_collector(device: &NativeDevice, collector_url: &str) -> Option<Value> {
    let health = http_get_json_url(&format!("{collector_url}/health"), 1600).ok()?;
    if !is_hivemind_collector_health(&health) {
        return None;
    }
    let capabilities = health
        .get("capabilities")
        .cloned()
        .unwrap_or_else(|| json!({ "chat": false, "runtimes": [] }));
    let agents = collector_agents(collector_url, device, &capabilities);
    let mut active_device = device.clone();
    active_device.collector_url = collector_url.to_string();
    Some(json!({
        "device": active_device,
        "collector": "ready",
        "collectorHost": health.get("host").cloned().unwrap_or(Value::Null),
        "machineId": health.get("machineId").cloned().unwrap_or(Value::Null),
        "tailnetSelf": health.get("tailnetSelf").cloned().unwrap_or(Value::Null),
        "version": health.get("version").cloned().unwrap_or(Value::Null),
        "capabilities": capabilities,
        "envSync": health.get("envSync").cloned().unwrap_or(Value::Null),
        "system": health.get("system").cloned().unwrap_or(Value::Null),
        "agents": agents,
        "snapshots": [],
    }))
}

fn discover_machine(device: NativeDevice) -> Value {
    if is_mobile_device(&device) {
        return json!({
            "device": device,
            "collector": if device.online { "not-installed" } else { "offline" },
            "agents": [],
            "snapshots": [],
        });
    }
    for collector_url in collector_url_candidates(&device) {
        if let Some(machine) = probe_collector(&device, &collector_url) {
            return machine;
        }
    }
    json!({
        "device": device,
        "collector": if device.online { "not-installed" } else { "offline" },
        "agents": [],
        "snapshots": [],
    })
}

// Identity candidates a ready collector claims for itself beyond its own
// device: the system tailscaled node it reported in /health `tailnetSelf`.
// After an OS hostname rename the linkd tsnet node re-registers under the
// new name while the system node keeps its sticky MagicDNS name — without
// this, the orphaned system node renders as an empty ghost machine.
fn tailnet_self_identities(machine: &Value) -> Vec<String> {
    let Some(tailnet_self) = machine.get("tailnetSelf") else {
        return Vec::new();
    };
    // dnsName ONLY: the MagicDNS name is sticky and unique per node, while
    // the reported `name` (tailscaled HostName = macOS ComputerName) can be
    // shared by two physical machines — deriving an identity from it would
    // let one machine's collector claim the OTHER machine's system node.
    let dns_name = tailnet_self.get("dnsName").and_then(Value::as_str).unwrap_or("");
    let identity = exact_machine_identity("", dns_name);
    if identity.is_empty() {
        Vec::new()
    } else {
        vec![identity]
    }
}

fn machine_device_identity(machine: &Value) -> String {
    let device = machine.get("device");
    let name = device
        .and_then(|d| d.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let dns_name = device
        .and_then(|d| d.get("dnsName"))
        .and_then(Value::as_str)
        .unwrap_or("");
    exact_machine_identity(name, dns_name)
}

fn fold_ready_tailnet_self(machines: Vec<Value>) -> Vec<Value> {
    let ready_self_identities = machines
        .iter()
        .filter(|machine| {
            machine.get("collector").and_then(Value::as_str) == Some("ready")
        })
        .flat_map(tailnet_self_identities)
        .collect::<std::collections::HashSet<_>>();
    if ready_self_identities.is_empty() {
        return machines;
    }
    machines
        .into_iter()
        .filter(|machine| {
            if machine.get("collector").and_then(Value::as_str) == Some("ready") {
                return true;
            }
            // Self is never folded by a remote collector's claims.
            if machine
                .get("device")
                .and_then(|device| device.get("self"))
                .and_then(Value::as_bool)
                == Some(true)
            {
                return true;
            }
            let identity = machine_device_identity(machine);
            identity.is_empty() || !ready_self_identities.contains(&identity)
        })
        .collect()
}

fn fleet_discover_payload() -> Result<Value, String> {
    let status = status_from_cli().ok();
    let devices = status
        .as_ref()
        .map(devices_from_status)
        .unwrap_or_else(|| vec![local_device()]);
    let machines = devices
        .into_iter()
        .map(discover_machine)
        .collect::<Vec<_>>();
    let machines = fold_ready_tailnet_self(machines);
    Ok(json!({
        "ok": true,
        "source": "native-fleet",
        "machines": machines,
    }))
}

#[tauri::command]
pub(crate) async fn fleet_discover() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(fleet_discover_payload)
        .await
        .map_err(|error| format!("Fleet discovery task failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn command_timeout_stops_the_process_group() {
        let marker = std::env::temp_dir().join(format!(
            "hivemindos-tailscale-timeout-{}",
            std::process::id()
        ));
        let _ = fs::remove_file(&marker);
        let mut command = std::process::Command::new("/bin/sh");
        command
            .arg("-c")
            .arg("(sleep 0.25; printf reached > \"$1\") & wait")
            .arg("hivemindos-timeout-test")
            .arg(&marker);

        let started = std::time::Instant::now();
        let error = command_output_with_timeout(command, Duration::from_millis(50))
            .expect_err("the child command should time out");

        assert_eq!(error.kind(), std::io::ErrorKind::TimedOut);
        assert!(started.elapsed() < Duration::from_secs(1));
        std::thread::sleep(Duration::from_millis(350));
        assert!(
            !marker.exists(),
            "a timed-out command must not leave descendants running"
        );
    }

    #[test]
    fn unavailable_tailnet_health_requires_attention() {
        let health = tailnet_health(None);
        assert_eq!(
            health.get("state").and_then(Value::as_str),
            Some("status-unavailable")
        );
        assert_eq!(
            health.get("requiresAttention").and_then(Value::as_bool),
            Some(true)
        );
        assert!(
            health
                .get("detail")
                .and_then(Value::as_str)
                .is_some_and(|detail| detail.contains("Tailscale needs attention"))
        );
    }

    #[test]
    fn detects_only_a_connected_macos_app_store_tailscale_service() {
        let connected = r#"* (Connected) 123 VPN (io.tailscale.ipn.macos) \"Tailscale\" [VPN:io.tailscale.ipn.macos]"#;
        let connecting = r#"* (Connecting) 123 VPN (io.tailscale.ipn.macos) \"Tailscale\" [VPN:io.tailscale.ipn.macos]"#;
        let standalone = r#"* (Connected) 123 VPN (io.tailscale.ipn.macsys) \"Tailscale\" [VPN:io.tailscale.ipn.macsys]"#;

        assert!(macos_app_store_service_connected(connected));
        assert!(!macos_app_store_service_connected(connecting));
        assert!(!macos_app_store_service_connected(standalone));
    }

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

    #[test]
    fn folds_ghost_system_node_claimed_by_ready_collector_tailnet_self() {
        // An OS hostname rename rotated the linkd tsnet node name; the system
        // node kept its sticky old MagicDNS name. The ready collector claims
        // the system node via /health tailnetSelf → the empty ghost folds.
        // tailnetSelf `name` is tailscaled's HostName = the macOS
        // ComputerName BOTH MacBooks share — identity comes from dnsName only.
        let ready = json!({
            "device": { "name": "LiamsMBP481146", "dnsName": "hivemindos-liamsmbp481146-lan.tail1.ts.net" },
            "collector": "ready",
            "tailnetSelf": { "name": "Liam's MacBook Pro", "dnsName": "liams-macbook-pro-1.tail1.ts.net" },
        });
        let ghost = json!({
            "device": { "name": "Liam's MacBook Pro", "dnsName": "liams-macbook-pro-1.tail1.ts.net" },
            "collector": "offline",
        });
        // A DIFFERENT machine sharing the ComputerName must survive, even
        // with its collector down.
        let sibling = json!({
            "device": { "name": "Liam's MacBook Pro", "dnsName": "liams-macbook-pro.tail1.ts.net" },
            "collector": "offline",
        });
        // Self is untouchable even on an identity collision.
        let self_machine = json!({
            "device": { "self": true, "name": "This Mac", "dnsName": "liams-macbook-pro-1.tail1.ts.net" },
            "collector": "offline",
        });
        let machines =
            fold_ready_tailnet_self(vec![ready, ghost, sibling, self_machine]);
        assert_eq!(machines.len(), 3);
        assert!(!machines.iter().any(|machine| {
            let device = machine.get("device");
            device.and_then(|d| d.get("dnsName")).and_then(Value::as_str)
                == Some("liams-macbook-pro-1.tail1.ts.net")
                && device.and_then(|d| d.get("self")).and_then(Value::as_bool) != Some(true)
        }));
        assert!(machines.iter().any(|machine| {
            machine.get("device").and_then(|d| d.get("self")).and_then(Value::as_bool)
                == Some(true)
        }));
    }

    #[test]
    fn fold_is_inert_without_tailnet_self() {
        let ready = json!({
            "device": { "name": "a", "dnsName": "hivemindos-a.tail1.ts.net" },
            "collector": "ready",
        });
        let offline = json!({
            "device": { "name": "b", "dnsName": "b.tail1.ts.net" },
            "collector": "offline",
        });
        assert_eq!(fold_ready_tailnet_self(vec![ready, offline]).len(), 2);
    }
}
