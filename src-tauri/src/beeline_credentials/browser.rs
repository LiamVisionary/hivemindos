use super::storage::{create_private_dir, FileLock};
use super::{redact_secrets, CredentialSecret};
use serde::Serialize;
use serde_json::{json, Value};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::time::Duration;
use zeroize::Zeroizing;

#[cfg(unix)]
use std::os::unix::net::UnixStream;
#[cfg(target_os = "windows")]
use std::net::TcpStream;

fn home_dir() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(|| "Could not determine the current user's home directory.".to_string())
}

fn browser_use_home() -> Result<PathBuf, String> {
    Ok(std::env::var_os("BROWSER_USE_HOME")
        .map(PathBuf::from)
        .unwrap_or(home_dir()?.join(".browser-use")))
}

fn safe_session(profile_id: &str) -> Result<String, String> {
    if profile_id.is_empty()
        || profile_id.len() > 120
        || !profile_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-' || character == '_')
    {
        return Err("Beeline profile id cannot be used as a Browser Use session.".to_string());
    }
    Ok(format!("beeline-{profile_id}"))
}

fn lock_path(session: &str) -> Result<PathBuf, String> {
    Ok(home_dir()?
        .join(".hivemindos/beeline/browser-use-locks")
        .join(format!("{session}.lock")))
}

#[derive(Serialize)]
struct DaemonRequest<'a, P: Serialize> {
    id: &'a str,
    action: &'a str,
    params: P,
    agent_id: &'a str,
    token: &'a str,
}

#[derive(Serialize)]
struct EvalParams<'a> {
    js: &'a str,
}

#[derive(Serialize)]
struct InputParams<'a> {
    index: u32,
    text: &'a str,
}

#[derive(Serialize)]
struct ClickParams {
    index: u32,
}

#[derive(Serialize)]
struct KeysParams<'a> {
    keys: &'a str,
}

fn request_id() -> Result<String, String> {
    let mut bytes = [0_u8; 8];
    getrandom::getrandom(&mut bytes).map_err(|error| format!("Could not create browser request id: {error}"))?;
    Ok(format!(
        "beeline_{}",
        bytes.iter().map(|byte| format!("{byte:02x}")).collect::<String>()
    ))
}

#[cfg(target_os = "windows")]
fn adler32(value: &[u8]) -> u32 {
    const MOD: u32 = 65_521;
    let mut a = 1_u32;
    let mut b = 0_u32;
    for byte in value {
        a = (a + u32::from(*byte)) % MOD;
        b = (b + a) % MOD;
    }
    (b << 16) | a
}

fn send<P: Serialize>(
    session: &str,
    action: &str,
    params: P,
    redactions: &[&str],
) -> Result<Value, String> {
    let browser_home = browser_use_home()?;
    let token_path = browser_home.join(format!("{session}.token"));
    let token = Zeroizing::new(
        fs::read_to_string(&token_path)
            .map_err(|_| "The Beeline Browser Use session is not running. Open the destination in that family browser session first.".to_string())?
            .trim()
            .to_string(),
    );
    if token.is_empty() {
        return Err("The Beeline Browser Use session has no authentication token.".to_string());
    }
    let id = request_id()?;
    let request = DaemonRequest {
        id: &id,
        action,
        params,
        agent_id: "__beeline_credential_broker__",
        token: &token,
    };
    let mut payload = Zeroizing::new(
        serde_json::to_string(&request)
            .map_err(|error| format!("Could not encode Browser Use request: {error}"))?,
    );
    payload.push('\n');

    #[cfg(unix)]
    let mut stream = {
        let socket = browser_home.join(format!("{session}.sock"));
        let stream = UnixStream::connect(socket)
            .map_err(|_| "Could not connect to the Beeline Browser Use session. Open the destination in that family browser session first.".to_string())?;
        stream.set_read_timeout(Some(Duration::from_secs(30))).map_err(|error| error.to_string())?;
        stream.set_write_timeout(Some(Duration::from_secs(30))).map_err(|error| error.to_string())?;
        stream
    };

    #[cfg(target_os = "windows")]
    let mut stream = {
        let port = 49_152 + adler32(session.as_bytes()) % 16_383;
        let stream = TcpStream::connect(("127.0.0.1", port as u16))
            .map_err(|_| "Could not connect to the Beeline Browser Use session. Open the destination in that family browser session first.".to_string())?;
        stream.set_read_timeout(Some(Duration::from_secs(30))).map_err(|error| error.to_string())?;
        stream.set_write_timeout(Some(Duration::from_secs(30))).map_err(|error| error.to_string())?;
        stream
    };

    stream
        .write_all(payload.as_bytes())
        .map_err(|error| format!("Could not send Browser Use request: {error}"))?;
    let mut raw = Zeroizing::new(String::new());
    BufReader::new(stream)
        .take(1_048_577)
        .read_line(&mut raw)
        .map_err(|error| format!("Could not read Browser Use response: {error}"))?;
    if raw.len() > 1_048_576 {
        return Err("Browser Use response exceeds 1 MiB.".to_string());
    }
    let mut all_redactions = redactions.to_vec();
    all_redactions.push(&token);
    let sanitized = redact_secrets(&raw, &all_redactions);
    let response: Value = serde_json::from_str(&sanitized)
        .map_err(|error| format!("Browser Use returned invalid JSON: {error}"))?;
    if response.get("success").and_then(Value::as_bool) != Some(true) {
        return Err(response
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("Browser Use action failed.")
            .to_string());
    }
    if let Some(error) = response.pointer("/data/error").and_then(Value::as_str) {
        return Err(error.to_string());
    }
    Ok(response.get("data").cloned().unwrap_or(Value::Null))
}

fn require_current_origin(session: &str, expected_origin: &str) -> Result<(), String> {
    let current = send(
        session,
        "eval",
        EvalParams { js: "location.origin" },
        &[],
    )?;
    let actual_origin = current
        .get("result")
        .and_then(Value::as_str)
        .ok_or_else(|| "Could not verify the current browser origin.".to_string())?;
    if actual_origin != expected_origin {
        return Err(format!(
            "Browser is at {actual_origin}; the saved credential is restricted to {expected_origin}."
        ));
    }
    Ok(())
}

pub(crate) fn submit_login(
    profile_id: &str,
    expected_origin: &str,
    username_element: Option<u32>,
    password_element: Option<u32>,
    submit_element: Option<u32>,
    secret: &CredentialSecret,
) -> Result<Value, String> {
    if username_element.is_none() && password_element.is_none() {
        return Err("At least one of usernameElement or passwordElement is required for browser login.".to_string());
    }
    let session = safe_session(profile_id)?;
    let lock_parent = lock_path(&session)?;
    if let Some(parent) = lock_parent.parent() {
        create_private_dir(parent)?;
    }
    let _lock = FileLock::acquire(lock_parent)?;
    require_current_origin(&session, expected_origin)?;
    let username = secret.username()?;
    let password = secret.password()?;
    let redactions = [username, password];
    if let Some(index) = username_element {
        send(
            &session,
            "input",
            InputParams { index, text: username },
            &redactions,
        )?;
    }
    require_current_origin(&session, expected_origin)?;
    if let Some(index) = password_element {
        if let Err(error) = send(
            &session,
            "input",
            InputParams { index, text: password },
            &redactions,
        ) {
            let _ = send(
                &session,
                "input",
                InputParams { index, text: "" },
                &redactions,
            );
            return Err(error);
        }
        if let Err(error) = require_current_origin(&session, expected_origin) {
            let _ = send(
                &session,
                "input",
                InputParams { index, text: "" },
                &redactions,
            );
            return Err(error);
        }
    }
    let submitted = match submit_element {
        Some(index) => send(&session, "click", ClickParams { index }, &redactions),
        None => send(&session, "keys", KeysParams { keys: "ENTER" }, &redactions),
    };
    if let Err(error) = submitted {
        if let Some(index) = password_element {
            let _ = send(
                &session,
                "input",
                InputParams { index, text: "" },
                &redactions,
            );
        }
        return Err(error);
    }
    Ok(json!({
        "submitted": true,
        "origin": expected_origin,
        "session": session,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_name_rejects_path_characters() {
        assert!(safe_session("beeline_123").is_ok());
        assert!(safe_session("../escape").is_err());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_port_matches_browser_use_algorithm() {
        assert_eq!(adler32(b"default"), 199_033_572);
    }
}
