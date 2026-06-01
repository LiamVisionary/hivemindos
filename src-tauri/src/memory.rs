use serde::Serialize;
use serde_json::json;
use std::process::Command;

#[derive(Clone)]
struct ProcessRow {
    pid: i64,
    ppid: i64,
    rss_kb: i64,
    percent_memory: f64,
    elapsed: String,
    command: String,
}

#[derive(Serialize)]
struct MemoryProcess {
    pid: i64,
    ppid: i64,
    label: String,
    command: String,
    role: &'static str,
    #[serde(rename = "rssMb")]
    rss_mb: f64,
    #[serde(rename = "growthMb")]
    growth_mb: f64,
    #[serde(rename = "recentGrowthMb")]
    recent_growth_mb: f64,
    #[serde(rename = "percentMemory")]
    percent_memory: f64,
    elapsed: String,
    #[serde(rename = "isCurrentProcess")]
    is_current_process: bool,
    #[serde(rename = "isAppRelated")]
    is_app_related: bool,
}

fn mb_from_kb(kb: i64) -> f64 {
    ((kb.max(0) as f64 / 1024.0) * 10.0).round() / 10.0
}

fn parse_process_row(line: &str) -> Option<ProcessRow> {
    let parts = line.split_whitespace().collect::<Vec<_>>();
    if parts.len() < 6 {
        return None;
    }
    let pid = parts.first()?.parse().ok()?;
    let ppid = parts.get(1)?.parse().ok()?;
    let rss_kb = parts.get(2)?.parse().ok()?;
    let percent_memory = parts.get(3)?.parse().ok()?;
    let elapsed = parts.get(4)?.to_string();
    let command = parts.get(5..).unwrap_or_default().join(" ");
    Some(ProcessRow {
        pid,
        ppid,
        rss_kb,
        percent_memory,
        elapsed,
        command,
    })
}

fn process_rows() -> Vec<ProcessRow> {
    let output = Command::new("ps")
        .args(["-axo", "pid=,ppid=,rss=,pmem=,etime=,command="])
        .output();
    let Ok(output) = output else {
        return Vec::new();
    };
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(parse_process_row)
        .collect()
}

fn process_label(command: &str) -> String {
    let first = command.split_whitespace().next().unwrap_or(command);
    first.rsplit('/').next().unwrap_or(first).to_string()
}

fn is_app_process(row: &ProcessRow, current_pid: i64, project_root: &str) -> bool {
    row.pid == current_pid
        || row.ppid == current_pid
        || row.command.contains("HivemindOS")
        || row.command.contains("hivemindos")
        || (!project_root.is_empty() && row.command.contains(project_root))
}

fn to_process(row: &ProcessRow, role: &'static str, current_pid: i64, app_related: bool) -> MemoryProcess {
    MemoryProcess {
        pid: row.pid,
        ppid: row.ppid,
        label: process_label(&row.command),
        command: row.command.clone(),
        role,
        rss_mb: mb_from_kb(row.rss_kb),
        growth_mb: 0.0,
        recent_growth_mb: 0.0,
        percent_memory: row.percent_memory,
        elapsed: row.elapsed.clone(),
        is_current_process: row.pid == current_pid,
        is_app_related: app_related,
    }
}

#[tauri::command]
pub(crate) fn memory_telemetry() -> Result<serde_json::Value, String> {
    let checked_at = chrono::Utc::now().timestamp_millis();
    let current_pid = std::process::id() as i64;
    let project_root = std::env::current_dir()
        .ok()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default();
    let rows = process_rows();
    let mut app_rows = rows
        .iter()
        .filter(|row| is_app_process(row, current_pid, &project_root))
        .cloned()
        .collect::<Vec<_>>();
    if app_rows.is_empty() {
        if let Some(row) = rows.iter().find(|row| row.pid == current_pid).cloned() {
            app_rows.push(row);
        }
    }
    let app_pids = app_rows.iter().map(|row| row.pid).collect::<std::collections::HashSet<_>>();
    let mut system_rows = rows
        .iter()
        .filter(|row| !app_pids.contains(&row.pid))
        .cloned()
        .collect::<Vec<_>>();
    system_rows.sort_by(|left, right| right.rss_kb.cmp(&left.rss_kb));

    let processes = app_rows
        .iter()
        .map(|row| to_process(row, if row.pid == current_pid { "current" } else { "descendant" }, current_pid, true))
        .collect::<Vec<_>>();
    let top_system_processes = system_rows
        .iter()
        .take(12)
        .map(|row| to_process(row, "system", current_pid, false))
        .collect::<Vec<_>>();
    let app_rss_mb = mb_from_kb(app_rows.iter().map(|row| row.rss_kb).sum());
    let current_rss_mb = rows
        .iter()
        .find(|row| row.pid == current_pid)
        .map(|row| mb_from_kb(row.rss_kb))
        .unwrap_or(app_rss_mb);

    Ok(json!({
        "ok": true,
        "source": "native-memory",
        "checkedAt": checked_at,
        "pid": current_pid,
        "uptimeSeconds": 0,
        "processMemory": {
            "rssMb": current_rss_mb,
            "heapTotalMb": 0,
            "heapUsedMb": 0,
            "externalMb": 0,
            "arrayBuffersMb": 0,
            "heapLimitMb": 0,
            "totalAvailableSizeMb": 0,
            "mallocedMemoryMb": 0,
            "peakMallocedMemoryMb": 0,
            "nativeContexts": 0,
            "detachedContexts": 0,
            "heapSpaces": []
        },
        "resourceUsage": {
            "maxRssMb": current_rss_mb,
            "userCpuSeconds": 0,
            "systemCpuSeconds": 0
        },
        "systemMemory": {
            "totalMb": 0,
            "freeMb": 0,
            "usedMb": 0
        },
        "cleanup": {
            "devGuardEnabled": false,
            "gcAvailable": false,
            "forceGcEnabled": false,
            "maxOldSpaceMb": null
        },
        "summary": {
            "appRssMb": app_rss_mb,
            "trackedProcessCount": processes.len(),
            "topGrowerLabel": processes.first().map(|item| item.label.clone()).unwrap_or_else(|| "No growth yet".to_string()),
            "topGrowerGrowthMb": 0,
            "sampleWindowMinutes": 0
        },
        "samples": [{
            "ts": checked_at,
            "appRssMb": app_rss_mb,
            "currentRssMb": current_rss_mb,
            "heapUsedMb": 0,
            "heapTotalMb": 0,
            "heapLimitMb": 0,
            "oldSpaceUsedMb": 0,
            "codeSpaceUsedMb": 0,
            "largeObjectSpaceUsedMb": 0,
            "externalMb": 0,
            "arrayBuffersMb": 0,
            "nativeContexts": 0,
            "detachedContexts": 0,
            "trackedProcessCount": processes.len()
        }],
        "processes": processes,
        "topGrowers": processes,
        "topSystemProcesses": top_system_processes,
        "suspects": []
    }))
}
