use super::{AgentUseMode, CredentialKind, CredentialSecret, StoreCredentialInput, KEYRING_SERVICE};
use chrono::Utc;
use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, SystemTime};
use zeroize::Zeroizing;

const METADATA_VERSION: u8 = 1;
const LOCK_WAIT_ATTEMPTS: usize = 100;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialMetadata {
    pub(crate) id: String,
    pub(crate) profile_id: String,
    pub(crate) label: String,
    pub(crate) kind: CredentialKind,
    pub(crate) origin: String,
    pub(crate) agent_use_mode: AgentUseMode,
    pub(crate) allowed_http_methods: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) header_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) header_prefix: Option<String>,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct MetadataFile {
    version: u8,
    credentials: Vec<CredentialMetadata>,
    updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuditEvent {
    pub(crate) profile_id: String,
    pub(crate) credential_id: String,
    pub(crate) origin: String,
    pub(crate) usage: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) method: Option<String>,
    pub(crate) ok: bool,
    pub(crate) occurred_at: String,
}

pub(crate) struct FileLock {
    path: PathBuf,
}

impl FileLock {
    pub(crate) fn acquire(path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            create_private_dir(parent)?;
        }
        for _ in 0..LOCK_WAIT_ATTEMPTS {
            match OpenOptions::new().write(true).create_new(true).open(&path) {
                Ok(mut file) => {
                    set_private_file(&path)?;
                    let _ = writeln!(file, "{}", std::process::id());
                    return Ok(Self { path });
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    let stale = fs::metadata(&path)
                        .and_then(|metadata| metadata.modified())
                        .ok()
                        .and_then(|modified| SystemTime::now().duration_since(modified).ok())
                        .map(|age| age > Duration::from_secs(120))
                        .unwrap_or(false);
                    if stale {
                        let _ = fs::remove_file(&path);
                    } else {
                        thread::sleep(Duration::from_millis(50));
                    }
                }
                Err(error) => return Err(format!("Could not acquire credential lock: {error}")),
            }
        }
        Err("Credential storage is busy. Try again in a moment.".to_string())
    }
}

impl Drop for FileLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

fn home_dir() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(|| "Could not determine the current user's home directory.".to_string())
}

fn metadata_path() -> Result<PathBuf, String> {
    Ok(std::env::var_os("HIVEMINDOS_BEELINE_CREDENTIAL_METADATA_PATH")
        .map(PathBuf::from)
        .unwrap_or(home_dir()?.join(".hivemindos/beeline/local-credentials.json")))
}

fn audit_path() -> Result<PathBuf, String> {
    Ok(home_dir()?.join(".hivemindos/beeline/local-credential-audit.jsonl"))
}

fn metadata_lock_path() -> Result<PathBuf, String> {
    let path = metadata_path()?;
    Ok(path.with_extension("lock"))
}

fn empty_file() -> MetadataFile {
    MetadataFile {
        version: METADATA_VERSION,
        credentials: Vec::new(),
        updated_at: Utc::now().to_rfc3339(),
    }
}

fn read_metadata() -> Result<MetadataFile, String> {
    let path = metadata_path()?;
    let mut raw = Zeroizing::new(String::new());
    match File::open(&path) {
        Ok(file) => file
            .take(1_048_577)
            .read_to_string(&mut raw)
            .map_err(|error| format!("Could not read Beeline credential metadata: {error}"))?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(empty_file()),
        Err(error) => return Err(format!("Could not open Beeline credential metadata: {error}")),
    };
    if raw.len() > 1_048_576 {
        return Err("Beeline credential metadata exceeds 1 MiB.".to_string());
    }
    let parsed: MetadataFile = serde_json::from_str(&raw)
        .map_err(|error| format!("Beeline credential metadata is invalid: {error}"))?;
    if parsed.version != METADATA_VERSION {
        return Err(format!("Unsupported Beeline credential metadata version {}.", parsed.version));
    }
    Ok(parsed)
}

fn write_metadata(file: &MetadataFile) -> Result<(), String> {
    let path = metadata_path()?;
    let parent = path
        .parent()
        .ok_or_else(|| "Credential metadata path has no parent directory.".to_string())?;
    create_private_dir(parent)?;
    let temporary = path.with_extension(format!("{}.tmp", std::process::id()));
    let payload = serde_json::to_vec_pretty(file)
        .map_err(|error| format!("Could not encode credential metadata: {error}"))?;
    {
        let mut output = OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&temporary)
            .map_err(|error| format!("Could not create credential metadata: {error}"))?;
        output
            .write_all(&payload)
            .and_then(|_| output.write_all(b"\n"))
            .and_then(|_| output.sync_all())
            .map_err(|error| format!("Could not write credential metadata: {error}"))?;
    }
    set_private_file(&temporary)?;
    #[cfg(target_os = "windows")]
    if path.exists() {
        fs::remove_file(&path)
            .map_err(|error| format!("Could not replace credential metadata: {error}"))?;
    }
    fs::rename(&temporary, &path)
        .map_err(|error| format!("Could not publish credential metadata: {error}"))?;
    set_private_file(&path)
}

pub(crate) fn create_private_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|error| format!("Could not create {}: {error}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|error| format!("Could not protect {}: {error}", path.display()))?;
    }
    Ok(())
}

fn set_private_file(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("Could not protect {}: {error}", path.display()))?;
    }
    Ok(())
}

fn new_id() -> Result<String, String> {
    let mut bytes = [0_u8; 16];
    getrandom::getrandom(&mut bytes).map_err(|error| format!("Could not create credential id: {error}"))?;
    Ok(format!(
        "beeline_cred_{}",
        bytes.iter().map(|byte| format!("{byte:02x}")).collect::<String>()
    ))
}

fn entry(id: &str) -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, id)
        .map_err(|error| format!("Could not access the operating-system credential store: {error}"))
}

pub(crate) fn keyring_available() -> bool {
    Entry::new(KEYRING_SERVICE, "beeline-availability-probe").is_ok()
}

fn delete_keyring_entry(id: &str) -> Result<(), String> {
    match entry(id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("Could not delete credential from the operating-system store: {error}")),
    }
}

pub(crate) fn list_credentials(profile_id: &str) -> Result<Vec<CredentialMetadata>, String> {
    Ok(read_metadata()?
        .credentials
        .into_iter()
        .filter(|credential| credential.profile_id == profile_id)
        .collect())
}

pub(crate) fn resolve_credential(
    profile_id: &str,
    credential_id: Option<&str>,
    origin: &str,
    kind: CredentialKind,
) -> Result<CredentialMetadata, String> {
    let matches = read_metadata()?
        .credentials
        .into_iter()
        .filter(|credential| {
            credential.profile_id == profile_id
                && credential.origin == origin
                && credential.kind == kind
                && credential_id.map(|id| credential.id == id).unwrap_or(true)
        })
        .collect::<Vec<_>>();
    match matches.as_slice() {
        [credential] => Ok(credential.clone()),
        [] => Err("No matching local credential is saved for this Beeline profile and website origin.".to_string()),
        _ => Err("More than one local credential matches. List credentials and retry with the intended opaque credential id.".to_string()),
    }
}

pub(crate) fn store_credential(mut input: StoreCredentialInput) -> Result<CredentialMetadata, String> {
    let label = input.label.split_whitespace().collect::<Vec<_>>().join(" ");
    if label.is_empty() || label.len() > 100 {
        return Err("Credential label must be between 1 and 100 characters.".to_string());
    }
    let origin = super::policy::normalize_origin(&input.origin)?;
    let allowed_http_methods = super::policy::normalize_allowed_methods(
        input.kind,
        input.agent_use_mode,
        &input.allowed_http_methods,
    )?;
    let (header_name, header_prefix, secret) = match input.kind {
        CredentialKind::Login => {
            let username = input
                .username
                .take()
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "A username is required for a saved login.".to_string())?;
            let password = input
                .password
                .take()
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "A password is required for a saved login.".to_string())?;
            (None, None, CredentialSecret::login(username, password))
        }
        CredentialKind::HttpHeader => {
            let header_name = super::policy::normalize_saved_header(input.header_name.as_deref())?;
            let header_prefix = super::policy::normalize_header_prefix(input.header_prefix.as_deref())?;
            let token = input
                .token
                .take()
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "A token is required for a saved HTTP credential.".to_string())?;
            (Some(header_name), Some(header_prefix), CredentialSecret::http_header(token))
        }
    };
    let id = new_id()?;
    let now = Utc::now().to_rfc3339();
    let metadata = CredentialMetadata {
        id: id.clone(),
        profile_id: input.profile_id.clone(),
        label,
        kind: input.kind,
        origin,
        agent_use_mode: input.agent_use_mode,
        allowed_http_methods,
        header_name,
        header_prefix,
        created_at: now.clone(),
        updated_at: now.clone(),
    };
    let encoded = Zeroizing::new(
        serde_json::to_string(&secret)
            .map_err(|error| format!("Could not encode credential for secure storage: {error}"))?,
    );
    entry(&id)?
        .set_password(&encoded)
        .map_err(|error| format!("Could not save credential in the operating-system store: {error}"))?;

    let _lock = FileLock::acquire(metadata_lock_path()?)?;
    let mut file = read_metadata()?;
    file.credentials.push(metadata.clone());
    file.updated_at = now;
    if let Err(error) = write_metadata(&file) {
        let _ = delete_keyring_entry(&id);
        return Err(error);
    }
    Ok(metadata)
}

pub(crate) fn load_secret(metadata: &CredentialMetadata) -> Result<CredentialSecret, String> {
    let raw = Zeroizing::new(
        entry(&metadata.id)?
            .get_password()
            .map_err(|error| format!("Could not read credential from the operating-system store: {error}"))?,
    );
    let secret: CredentialSecret = serde_json::from_str(&raw)
        .map_err(|_| "The saved credential is malformed and must be replaced.".to_string())?;
    let expected_kind = match metadata.kind {
        CredentialKind::Login => "login",
        CredentialKind::HttpHeader => "http-header",
    };
    if secret.kind != expected_kind {
        return Err("The saved credential kind does not match its metadata and must be replaced.".to_string());
    }
    Ok(secret)
}

pub(crate) fn delete_credential(profile_id: &str, credential_id: &str) -> Result<bool, String> {
    let _lock = FileLock::acquire(metadata_lock_path()?)?;
    let mut file = read_metadata()?;
    let before = file.credentials.len();
    let target = file
        .credentials
        .iter()
        .find(|credential| credential.id == credential_id && credential.profile_id == profile_id)
        .cloned();
    let Some(target) = target else {
        return Ok(false);
    };
    delete_keyring_entry(&target.id)?;
    file.credentials.retain(|credential| credential.id != target.id);
    file.updated_at = Utc::now().to_rfc3339();
    write_metadata(&file)?;
    Ok(file.credentials.len() != before)
}

pub(crate) fn delete_profile_credentials(profile_id: &str) -> Result<usize, String> {
    let _lock = FileLock::acquire(metadata_lock_path()?)?;
    let mut file = read_metadata()?;
    let ids = file
        .credentials
        .iter()
        .filter(|credential| credential.profile_id == profile_id)
        .map(|credential| credential.id.clone())
        .collect::<Vec<_>>();
    for id in &ids {
        delete_keyring_entry(id)?;
    }
    file.credentials.retain(|credential| credential.profile_id != profile_id);
    file.updated_at = Utc::now().to_rfc3339();
    write_metadata(&file)?;
    Ok(ids.len())
}

pub(crate) fn delete_all_credentials() -> Result<usize, String> {
    let _lock = FileLock::acquire(metadata_lock_path()?)?;
    let mut file = read_metadata()?;
    let ids = file
        .credentials
        .iter()
        .map(|credential| credential.id.clone())
        .collect::<Vec<_>>();
    for id in &ids {
        delete_keyring_entry(id)?;
    }
    file.credentials.clear();
    file.updated_at = Utc::now().to_rfc3339();
    write_metadata(&file)?;
    Ok(ids.len())
}

pub(crate) fn append_audit(event: AuditEvent) -> Result<(), String> {
    let path = audit_path()?;
    let parent = path
        .parent()
        .ok_or_else(|| "Credential audit path has no parent directory.".to_string())?;
    create_private_dir(parent)?;
    let line = serde_json::to_string(&event)
        .map_err(|error| format!("Could not encode credential audit event: {error}"))?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| format!("Could not open credential audit log: {error}"))?;
    set_private_file(&path)?;
    writeln!(file, "{line}").map_err(|error| format!("Could not write credential audit log: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serialized_metadata_contains_no_secret_fields() {
        let metadata = CredentialMetadata {
            id: "beeline_cred_test".to_string(),
            profile_id: "beeline_test".to_string(),
            label: "Doctor portal".to_string(),
            kind: CredentialKind::Login,
            origin: "https://example.com".to_string(),
            agent_use_mode: AgentUseMode::Flexible,
            allowed_http_methods: Vec::new(),
            header_name: None,
            header_prefix: None,
            created_at: "now".to_string(),
            updated_at: "now".to_string(),
        };
        let serialized = serde_json::to_string(&metadata).expect("serialize metadata");
        assert!(!serialized.contains("username"));
        assert!(!serialized.contains("password"));
        assert!(!serialized.contains("token"));
    }
}
