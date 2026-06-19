// Native reads of the Obsidian shared-brain vault for the STATIC desktop build,
// which ships no Next /api server. Mirrors src/lib/services/obsidian/* readers so
// the dashboard can load vault-backed data over Tauri `invoke` instead of the
// (absent) HTTP routes. Agents and wallets first; miroshark sims to follow.

use chrono::Utc;
use serde_json::Map;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

const DEFAULT_VAULT: &str = "~/Documents/Obsidian/hivemindos-vault";
const WALLET_FOLDER: &str = "Projects/HivemindOS/Wallets";

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn expand_home(path: &str) -> PathBuf {
    let trimmed = path.trim();
    if trimmed == "~" {
        return home_dir().unwrap_or_else(|| PathBuf::from("."));
    }
    if let Some(rest) = trimmed.strip_prefix("~/") {
        if let Some(home) = home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(trimmed)
}

fn default_vault_path(vault_path: Option<String>) -> PathBuf {
    let raw = vault_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_VAULT);
    expand_home(raw)
}

// Exact-named (case-sensitive) child folder, mirroring exactRootFolder.
fn exact_root_folder(root: &Path, name: &str) -> Option<PathBuf> {
    let candidate = root.join(name);
    if candidate.is_dir() {
        Some(candidate)
    } else {
        None
    }
}

fn collect_profile_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_profile_files(&path, out);
        } else if path.file_name().map(|name| name == "profile.json").unwrap_or(false) {
            out.push(path);
        }
    }
}

/// Read agent profile records from the vault's Agents/ (or legacy AGENTS/) folder.
/// Mirrors readVaultAgentProfiles: every profile.json with an `id` + `runtime` is
/// a profile; dedupe by `runtime|agentId`. Returns `{ ok, agents }`.
#[tauri::command]
pub fn obsidian_agents(vault_path: Option<String>) -> Value {
    let Some(vault) = vault_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
    else {
        return json!({ "ok": true, "agents": [] });
    };
    let root = expand_home(vault);

    let mut files = Vec::new();
    // Legacy first so current profiles (read later) win on dedupe.
    for name in ["AGENTS", "Agents"] {
        if let Some(folder) = exact_root_folder(&root, name) {
            collect_profile_files(&folder, &mut files);
        }
    }

    let mut agents: Vec<Value> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for file in files {
        let Ok(raw) = fs::read_to_string(&file) else {
            continue;
        };
        let Ok(profile) = serde_json::from_str::<Value>(&raw) else {
            continue;
        };
        let id = profile.get("id").and_then(Value::as_str).unwrap_or("").trim();
        let runtime = profile
            .get("runtime")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        if id.is_empty() || runtime.is_empty() {
            continue;
        }
        let agent_id = profile
            .get("agentId")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(id);
        let key = format!("{runtime}|{agent_id}").to_lowercase();
        if seen.insert(key) {
            agents.push(profile);
        }
    }

    json!({ "ok": true, "agents": agents })
}

fn wallet_vault_path() -> PathBuf {
    home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".hivemindos")
        .join("wallet-vault.json")
}

fn parse_yaml_scalar(raw: &str) -> Value {
    let trimmed = raw.trim();
    if trimmed == "true" {
        return Value::Bool(true);
    }
    if trimmed == "false" {
        return Value::Bool(false);
    }
    if let Ok(number) = trimmed.parse::<f64>() {
        if let Some(json_number) = serde_json::Number::from_f64(number) {
            return Value::Number(json_number);
        }
    }
    if trimmed.len() >= 2 && trimmed.starts_with('"') && trimmed.ends_with('"') {
        return Value::String(
            trimmed[1..trimmed.len() - 1]
                .replace("\\\"", "\"")
                .replace("\\\\", "\\"),
        );
    }
    if trimmed.len() >= 2 && trimmed.starts_with('\'') && trimmed.ends_with('\'') {
        return Value::String(trimmed[1..trimmed.len() - 1].to_string());
    }
    Value::String(trimmed.to_string())
}

fn parse_frontmatter(content: &str) -> Map<String, Value> {
    let mut out = Map::new();
    let Some(rest) = content.strip_prefix("---") else {
        return out;
    };
    let rest = rest.strip_prefix('\n').unwrap_or(rest);
    let Some((frontmatter, _body)) = rest.split_once("\n---") else {
        return out;
    };
    for line in frontmatter.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let key = key.trim();
        if !key.is_empty() {
            out.insert(key.to_string(), parse_yaml_scalar(value));
        }
    }
    out
}

fn string_field(record: &Map<String, Value>, key: &str) -> String {
    record
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn number_field(record: &Map<String, Value>, key: &str) -> f64 {
    record.get(key).and_then(Value::as_f64).unwrap_or(0.0)
}

fn bool_field(record: &Map<String, Value>, key: &str) -> bool {
    record.get(key).and_then(Value::as_bool).unwrap_or(false)
}

fn is_recovery_phrase_wallet_id(id: &str) -> bool {
    id.starts_with("user:")
        && (id.contains(":eip155-")
            || id.contains(":solana-mainnet")
            || id.contains(":solana-devnet")
            || id.contains(":solana-testnet"))
}

fn personal_wallet_import_source(
    id: &str,
    custody_mode: &str,
    imported_from: Option<&str>,
) -> &'static str {
    if imported_from == Some("recovery-phrase") || is_recovery_phrase_wallet_id(id) {
        return "recovery-phrase";
    }
    match imported_from {
        Some("generated") => "generated",
        Some("private-key") => "private-key",
        Some("browser") => "browser",
        Some("watch") => "watch",
        Some("recovery-phrase") => "recovery-phrase",
        _ if custody_mode == "local" => "private-key",
        _ => "watch",
    }
}

fn personal_wallet_name(agent_id: &str, agent_name: &str, network: &str) -> String {
    if !agent_name.is_empty() && agent_name != agent_id {
        return agent_name.to_string();
    }
    let chain = if network.starts_with("solana:") { "Solana" } else { "Base" };
    if is_recovery_phrase_wallet_id(agent_id) {
        format!("My wallet {chain}")
    } else {
        format!("My {chain} wallet")
    }
}

fn wallet_account_key(wallet: &Value) -> Option<String> {
    let network = wallet.get("network")?.as_str()?.trim();
    let address = wallet.get("address")?.as_str()?.trim();
    if network.is_empty() || address.is_empty() {
        None
    } else {
        Some(format!("{}:{}", network, address.to_lowercase()))
    }
}

fn split_json_objects(raw: &str) -> Vec<&str> {
    let mut chunks = Vec::new();
    let mut depth = 0;
    let mut start: Option<usize> = None;
    let mut in_string = false;
    let mut escaped = false;

    for (index, character) in raw.char_indices() {
        if in_string {
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == '"' {
                in_string = false;
            }
            continue;
        }
        if character == '"' {
            in_string = true;
            continue;
        }
        if character == '{' {
            if depth == 0 {
                start = Some(index);
            }
            depth += 1;
            continue;
        }
        if character != '}' || depth == 0 {
            continue;
        }
        depth -= 1;
        if depth == 0 {
            if let Some(start_index) = start.take() {
                chunks.push(&raw[start_index..index + character.len_utf8()]);
            }
        }
    }
    chunks
}

fn wallet_vault_records(raw: &str) -> HashMap<String, Value> {
    let parsed_values = serde_json::from_str::<Value>(raw)
        .map(|parsed| vec![parsed])
        .unwrap_or_else(|_| {
            split_json_objects(raw)
                .into_iter()
                .filter_map(|chunk| serde_json::from_str::<Value>(chunk).ok())
                .collect()
        });
    let mut records = HashMap::new();
    for parsed in parsed_values {
        if parsed.get("version").and_then(Value::as_i64) != Some(1) {
            continue;
        }
        let Some(raw_records) = parsed.get("records").and_then(Value::as_object) else {
            continue;
        };
        for (key, record) in raw_records {
            records.insert(key.clone(), record.clone());
        }
    }
    records
}

fn read_local_wallet_infos() -> Vec<Value> {
    let Ok(raw) = fs::read_to_string(wallet_vault_path()) else {
        return Vec::new();
    };
    let records = wallet_vault_records(&raw);
    if records.is_empty() {
        return Vec::new();
    }
    let mut wallets = records
        .values()
        .filter_map(|record| {
            let agent_id = record.get("agentId").and_then(Value::as_str)?.trim();
            let address = record.get("address").and_then(Value::as_str)?.trim();
            let network = record.get("network").and_then(Value::as_str)?.trim();
            if !agent_id.starts_with("user:") || address.is_empty() || network.is_empty() {
                return None;
            }
            Some(json!({
                "agentId": agent_id,
                "address": address,
                "network": network,
                "custodyMode": record.get("custodyMode").and_then(Value::as_str).unwrap_or("local"),
                "createdAt": record.get("createdAt").and_then(Value::as_str).unwrap_or(""),
            }))
        })
        .collect::<Vec<_>>();
    wallets.sort_by(|left, right| {
        let left_created = left.get("createdAt").and_then(Value::as_str).unwrap_or("");
        let right_created = right.get("createdAt").and_then(Value::as_str).unwrap_or("");
        left_created.cmp(right_created)
    });
    wallets
}

fn wallet_from_vault_info(wallet: &Value) -> Value {
    let agent_id = wallet.get("agentId").and_then(Value::as_str).unwrap_or("");
    let network = wallet.get("network").and_then(Value::as_str).unwrap_or("eip155:8453");
    let custody_mode = wallet.get("custodyMode").and_then(Value::as_str).unwrap_or("local");
    let created_at = wallet
        .get("createdAt")
        .and_then(Value::as_str)
        .unwrap_or_default();
    json!({
        "agentId": agent_id,
        "id": agent_id,
        "name": personal_wallet_name(agent_id, "", network),
        "address": wallet.get("address").and_then(Value::as_str).unwrap_or(""),
        "network": network,
        "custodyMode": custody_mode,
        "importedFrom": personal_wallet_import_source(agent_id, custody_mode, None),
        "currentBalanceUsd": 0,
        "nativeBalance": 0,
        "tokens": [],
        "portfolioVersion": 0,
        "lastOnchainSyncAt": 0,
        "createdAt": chrono::DateTime::parse_from_rfc3339(created_at)
            .map(|date| date.timestamp_millis())
            .unwrap_or_else(|_| Utc::now().timestamp_millis()),
        "updatedAt": chrono::DateTime::parse_from_rfc3339(created_at)
            .map(|date| date.timestamp_millis())
            .unwrap_or_else(|_| Utc::now().timestamp_millis()),
    })
}

fn wallet_from_ledger_file(path: &Path) -> Option<Value> {
    let raw = fs::read_to_string(path).ok()?;
    let fm = parse_frontmatter(&raw);
    let fallback_id = path.file_stem()?.to_string_lossy().to_string();
    let agent_id = string_field(&fm, "agentId");
    let agent_id = if agent_id.is_empty() { fallback_id } else { agent_id };
    if !agent_id.starts_with("user:") {
        return None;
    }
    let address = [string_field(&fm, "walletAddress"), string_field(&fm, "vaultAddress")]
        .into_iter()
        .find(|value| !value.is_empty())
        .unwrap_or_default();
    if address.is_empty() {
        return None;
    }
    let network = {
        let value = string_field(&fm, "network");
        if value.is_empty() {
            "eip155:8453".to_string()
        } else {
            value
        }
    };
    let custody_mode = {
        let value = string_field(&fm, "custodyMode");
        if value == "local" { "local" } else { "watch" }
    };
    let agent_name = string_field(&fm, "agentName");
    let updated_at_ms = number_field(&fm, "updatedAtMs");
    Some(json!({
        "agentId": agent_id.clone(),
        "id": agent_id.clone(),
        "name": personal_wallet_name(&agent_id, &agent_name, &network),
        "address": address,
        "network": network.clone(),
        "custodyMode": custody_mode,
        "importedFrom": personal_wallet_import_source(&agent_id, custody_mode, None),
        "currentBalanceUsd": number_field(&fm, "currentBalanceUsd")
            .max(number_field(&fm, "onchainBalanceUsd")),
        "nativeBalance": number_field(&fm, "nativeBalance"),
        "tokens": [],
        "portfolioVersion": 0,
        "lastOnchainSyncAt": number_field(&fm, "lastOnchainSyncAt"),
        "createdAt": if updated_at_ms > 0.0 { updated_at_ms } else { 0.0 },
        "updatedAt": if updated_at_ms > 0.0 { updated_at_ms } else { 0.0 },
        "enabled": bool_field(&fm, "enabled"),
    }))
}

fn read_ledger_wallets(vault_path: Option<String>) -> Vec<Value> {
    let folder = default_vault_path(vault_path).join(WALLET_FOLDER);
    let Ok(entries) = fs::read_dir(folder) else {
        return Vec::new();
    };
    let mut wallets = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let file_name = path.file_name()?.to_string_lossy().to_lowercase();
            if !file_name.ends_with(".md")
                || file_name == "readme.md"
                || file_name.contains(".sync-conflict-")
            {
                return None;
            }
            wallet_from_ledger_file(&path)
        })
        .collect::<Vec<_>>();
    wallets.sort_by(|left, right| {
        let left_name = left.get("name").and_then(Value::as_str).unwrap_or("");
        let right_name = right.get("name").and_then(Value::as_str).unwrap_or("");
        left_name.cmp(right_name)
    });
    wallets
}

fn ledger_wallet_with_signer_truth(
    mut wallet: Value,
    vault_by_account: &HashMap<String, Value>,
) -> Value {
    let Some(key) = wallet_account_key(&wallet) else {
        return wallet;
    };
    let Some(vault_wallet) = vault_by_account.get(&key) else {
        if let Some(object) = wallet.as_object_mut() {
            object.insert("custodyMode".to_string(), Value::String("watch".to_string()));
            object.insert("importedFrom".to_string(), Value::String("watch".to_string()));
        }
        return wallet;
    };
    let agent_id = vault_wallet
        .get("agentId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let custody_mode = vault_wallet
        .get("custodyMode")
        .and_then(Value::as_str)
        .unwrap_or("local")
        .to_string();
    if let Some(object) = wallet.as_object_mut() {
        object.insert("agentId".to_string(), Value::String(agent_id.clone()));
        object.insert("id".to_string(), Value::String(agent_id.clone()));
        object.insert("custodyMode".to_string(), Value::String(custody_mode.clone()));
        object.insert(
            "importedFrom".to_string(),
            Value::String(personal_wallet_import_source(&agent_id, &custody_mode, None).to_string()),
        );
    }
    wallet
}

#[tauri::command]
pub fn obsidian_personal_wallets(vault_path: Option<String>) -> Result<Value, String> {
    let vault_wallets = read_local_wallet_infos();
    let vault_by_account = vault_wallets
        .iter()
        .filter_map(|wallet| wallet_account_key(wallet).map(|key| (key, wallet.clone())))
        .collect::<HashMap<_, _>>();
    let ledger_wallets = read_ledger_wallets(vault_path)
        .into_iter()
        .map(|wallet| ledger_wallet_with_signer_truth(wallet, &vault_by_account))
        .collect::<Vec<_>>();
    let existing = ledger_wallets
        .iter()
        .filter_map(wallet_account_key)
        .collect::<HashSet<_>>();
    let mut wallets = ledger_wallets;
    wallets.extend(
        vault_wallets
            .iter()
            .filter(|wallet| wallet_account_key(wallet).is_some_and(|key| !existing.contains(&key)))
            .map(wallet_from_vault_info),
    );

    Ok(json!({ "ok": true, "source": "tauri", "wallets": wallets }))
}
