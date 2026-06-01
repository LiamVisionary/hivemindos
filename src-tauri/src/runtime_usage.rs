use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

const HERMES_DB: &str = "~/.hermes/state.db";
const OPENCLAW_AGENTS: &str = "~/.openclaw/agents";

fn expand_home(value: &str) -> PathBuf {
    if value == "~" {
        return std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(value));
    }
    if let Some(rest) = value.strip_prefix("~/") {
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home).join(rest);
        }
    }
    PathBuf::from(value)
}

fn positive(value: &Value) -> u64 {
    value.as_u64()
        .or_else(|| value.as_f64().filter(|number| number.is_finite() && *number > 0.0).map(|number| number.round() as u64))
        .unwrap_or(0)
}

fn first_number(record: &serde_json::Map<String, Value>, keys: &[&str]) -> u64 {
    keys.iter().map(|key| record.get(*key).map(positive).unwrap_or(0)).find(|value| *value > 0).unwrap_or(0)
}

fn looks_like_usage(record: &serde_json::Map<String, Value>) -> bool {
    ["total", "totalTokens", "total_tokens", "inputTokens", "input_tokens", "outputTokens", "output_tokens", "tokens"]
        .iter()
        .any(|key| record.get(*key).map(positive).unwrap_or(0) > 0)
}

fn collect_usage<'a>(value: &'a Value, matches: &mut Vec<&'a serde_json::Map<String, Value>>, depth: usize) {
    if depth > 5 {
        return;
    }
    match value {
        Value::Object(record) => {
            if looks_like_usage(record) {
                matches.push(record);
            }
            for child in record.values() {
                collect_usage(child, matches, depth + 1);
            }
        }
        Value::Array(items) => {
            for child in items.iter().rev().take(20) {
                collect_usage(child, matches, depth + 1);
            }
        }
        _ => {}
    }
}

fn usage_tokens(value: &Value) -> u64 {
    let mut matches = Vec::new();
    collect_usage(value, &mut matches, 0);
    matches.into_iter().fold(0, |best, usage| {
        let direct = first_number(usage, &["total", "totalTokens", "total_tokens", "tokens", "tokenCount", "token_count"]);
        let summed = first_number(usage, &["input", "inputTokens", "input_tokens", "promptTokens", "prompt_tokens"])
            + first_number(usage, &["output", "outputTokens", "output_tokens", "completionTokens", "completion_tokens"])
            + first_number(usage, &["cacheRead", "cache_read", "cacheReadTokens", "cache_read_tokens", "cached"])
            + first_number(usage, &["cacheWrite", "cache_write", "cacheWriteTokens", "cache_write_tokens"])
            + first_number(usage, &["reasoning", "reasoningTokens", "reasoning_tokens"]);
        best.max(direct).max(summed)
    })
}

fn find_string(value: &Value, keys: &[&str], depth: usize) -> Option<String> {
    if depth > 4 {
        return None;
    }
    match value {
        Value::Object(record) => {
            for key in keys {
                if let Some(value) = record.get(*key).and_then(|item| item.as_str()).map(str::trim).filter(|item| !item.is_empty()) {
                    return Some(value.to_string());
                }
            }
            record.values().find_map(|child| find_string(child, keys, depth + 1))
        }
        Value::Array(items) => items.iter().find_map(|child| find_string(child, keys, depth + 1)),
        _ => None,
    }
}

fn parse_json_line(line: &str) -> Option<Value> {
    serde_json::from_str::<Value>(line).ok()
}

fn iso_from_seconds(value: &Value) -> String {
    let seconds = value.as_i64().unwrap_or(0);
    chrono::DateTime::from_timestamp(seconds, 0)
        .unwrap_or_else(chrono::Utc::now)
        .to_rfc3339()
}

fn read_hermes_rows(limit: usize) -> Vec<Value> {
    let limit = limit.clamp(1, 500);
    let sql = format!(
        "select id, source, model, coalesce(ended_at, started_at) as updated_at, \
         coalesce(input_tokens, 0) as input_tokens, coalesce(output_tokens, 0) as output_tokens, \
         coalesce(cache_read_tokens, 0) + coalesce(cache_write_tokens, 0) as cache_tokens, \
         coalesce(reasoning_tokens, 0) as reasoning_tokens from sessions \
         where (coalesce(input_tokens, 0) + coalesce(output_tokens, 0) + coalesce(cache_read_tokens, 0) + coalesce(cache_write_tokens, 0) + coalesce(reasoning_tokens, 0)) > 0 \
         order by started_at desc limit {limit};"
    );
    let Ok(output) = Command::new("sqlite3").arg("-json").arg(expand_home(HERMES_DB)).arg(sql).output() else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    let rows = serde_json::from_slice::<Vec<Value>>(&output.stdout).unwrap_or_default();
    rows.into_iter().filter_map(|row| {
        let record = row.as_object()?;
        let input = record.get("input_tokens").map(positive).unwrap_or(0);
        let output = record.get("output_tokens").map(positive).unwrap_or(0);
        let cache = record.get("cache_tokens").map(positive).unwrap_or(0);
        let reasoning = record.get("reasoning_tokens").map(positive).unwrap_or(0);
        let total = input + output + cache + reasoning;
        if total == 0 {
            return None;
        }
        Some(json!({
            "runtime": "hermes",
            "agentId": "local-hermes",
            "sessionId": record.get("id").and_then(|value| value.as_str()).unwrap_or(""),
            "source": record.get("source").and_then(|value| value.as_str()).unwrap_or("cli"),
            "model": record.get("model").and_then(|value| value.as_str()).unwrap_or("hermes"),
            "updatedAt": iso_from_seconds(record.get("updated_at").unwrap_or(&Value::Null)),
            "inputTokens": input,
            "outputTokens": output,
            "cacheTokens": cache,
            "reasoningTokens": reasoning,
            "totalTokens": total,
        }))
    }).collect()
}

fn read_openclaw_rows(limit: usize) -> Vec<Value> {
    let root = expand_home(OPENCLAW_AGENTS);
    let mut rows = Vec::new();
    let Ok(agents) = fs::read_dir(&root) else {
        return rows;
    };
    for agent in agents.flatten() {
        if !agent.path().is_dir() {
            continue;
        }
        let agent_id = agent.file_name().to_string_lossy().to_string();
        let sessions_dir = agent.path().join("sessions");
        let Ok(files) = fs::read_dir(sessions_dir) else {
            continue;
        };
        for file in files.flatten() {
            let path = file.path();
            let extension = path.extension().and_then(|value| value.to_str()).unwrap_or("");
            if !path.is_file() || !matches!(extension, "json" | "jsonl") {
                continue;
            }
            let Ok(metadata) = fs::metadata(&path) else {
                continue;
            };
            if metadata.len() > 5_000_000 {
                continue;
            }
            let Ok(raw) = fs::read_to_string(&path) else {
                continue;
            };
            let values = if extension == "jsonl" {
                raw.lines().rev().take(500).filter_map(parse_json_line).collect::<Vec<_>>()
            } else {
                parse_json_line(&raw).into_iter().collect::<Vec<_>>()
            };
            let mut best_tokens = 0;
            let mut model = "openclaw".to_string();
            for value in values {
                best_tokens = best_tokens.max(usage_tokens(&value));
                if let Some(found) = find_string(&value, &["model", "modelId", "modelRef"], 0) {
                    model = found;
                }
            }
            if best_tokens == 0 {
                continue;
            }
            rows.push(json!({
                "runtime": "openclaw",
                "agentId": agent_id,
                "sessionId": path.file_stem().and_then(|value| value.to_str()).unwrap_or("").to_string(),
                "source": "sessions",
                "model": model,
                "updatedAt": chrono::DateTime::<chrono::Utc>::from(metadata.modified().unwrap_or(std::time::SystemTime::now())).to_rfc3339(),
                "inputTokens": 0,
                "outputTokens": 0,
                "cacheTokens": 0,
                "reasoningTokens": 0,
                "totalTokens": best_tokens,
            }));
            if rows.len() >= limit {
                return rows;
            }
        }
    }
    rows
}

fn group_usage(rows: &[Value], key: &str) -> Vec<Value> {
    let mut groups = HashMap::<String, (u64, u64)>::new();
    for row in rows {
        let name = row.get(key).and_then(|value| value.as_str()).unwrap_or("unknown").to_string();
        let tokens = row.get("totalTokens").map(positive).unwrap_or(0);
        let entry = groups.entry(name).or_insert((0, 0));
        entry.0 += 1;
        entry.1 += tokens;
    }
    let mut items = groups.into_iter().map(|(name, (sessions, tokens))| json!({ key: name, "sessions": sessions, "tokens": tokens })).collect::<Vec<_>>();
    items.sort_by(|left, right| right.get("tokens").map(positive).unwrap_or(0).cmp(&left.get("tokens").map(positive).unwrap_or(0)));
    items.truncate(12);
    items
}

#[tauri::command]
pub(crate) fn runtime_usage(limit: Option<u64>) -> Result<Value, String> {
    let limit = limit.unwrap_or(200).clamp(1, 500) as usize;
    let mut rows = read_hermes_rows(limit);
    rows.extend(read_openclaw_rows(limit));
    rows.sort_by(|left, right| {
        right.get("updatedAt").and_then(|value| value.as_str()).unwrap_or("")
            .cmp(left.get("updatedAt").and_then(|value| value.as_str()).unwrap_or(""))
    });
    rows.truncate(limit);
    let tokens = rows.iter().map(|row| row.get("totalTokens").map(positive).unwrap_or(0)).sum::<u64>();
    let input_tokens = rows.iter().map(|row| row.get("inputTokens").map(positive).unwrap_or(0)).sum::<u64>();
    let output_tokens = rows.iter().map(|row| row.get("outputTokens").map(positive).unwrap_or(0)).sum::<u64>();
    let cache_tokens = rows.iter().map(|row| row.get("cacheTokens").map(positive).unwrap_or(0)).sum::<u64>();
    let reasoning_tokens = rows.iter().map(|row| row.get("reasoningTokens").map(positive).unwrap_or(0)).sum::<u64>();
    let estimated_cost_usd = ((tokens as f64 * 0.000002) * 10000.0).round() / 10000.0;
    let sessions = rows.len();
    let models = group_usage(&rows, "model");
    let runtimes = group_usage(&rows, "runtime");
    let sources = group_usage(&rows, "source");

    Ok(json!({
        "ok": true,
        "source": "tauri",
        "rows": rows,
        "totals": {
            "sessions": sessions,
            "tokens": tokens,
            "inputTokens": input_tokens,
            "outputTokens": output_tokens,
            "cacheTokens": cache_tokens,
            "reasoningTokens": reasoning_tokens,
            "estimatedCostUsd": estimated_cost_usd,
        },
        "models": models,
        "runtimes": runtimes,
        "sources": sources,
    }))
}
