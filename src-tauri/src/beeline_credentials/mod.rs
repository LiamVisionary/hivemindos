mod browser;
mod http;
mod policy;
mod storage;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{self, Read};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};
use base64::Engine;

pub(crate) const KEYRING_SERVICE: &str = "com.hivemindos.beeline.credentials";
pub(crate) const RESTRICTED_CONFIRMATION: &str = "CONFIRM_BEELINE_LOCAL_CREDENTIAL";

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum CredentialKind {
    Login,
    HttpHeader,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum AgentUseMode {
    Flexible,
    Restricted,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreCredentialInput {
    profile_id: String,
    label: String,
    kind: CredentialKind,
    origin: String,
    #[serde(default = "default_agent_use_mode")]
    agent_use_mode: AgentUseMode,
    #[serde(default)]
    allowed_http_methods: Vec<String>,
    #[serde(default)]
    header_name: Option<String>,
    #[serde(default)]
    header_prefix: Option<String>,
    #[serde(default)]
    username: Option<String>,
    #[serde(default)]
    password: Option<String>,
    #[serde(default)]
    token: Option<String>,
}

impl Drop for StoreCredentialInput {
    fn drop(&mut self) {
        if let Some(value) = self.username.as_mut() {
            value.zeroize();
        }
        if let Some(value) = self.password.as_mut() {
            value.zeroize();
        }
        if let Some(value) = self.token.as_mut() {
            value.zeroize();
        }
    }
}

fn default_agent_use_mode() -> AgentUseMode {
    AgentUseMode::Flexible
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum CredentialUsage {
    BrowserLogin,
    Http,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UseCredentialInput {
    profile_id: String,
    #[serde(default)]
    credential_id: Option<String>,
    usage: CredentialUsage,
    destination_url: String,
    capability: String,
    #[serde(default)]
    method: Option<String>,
    #[serde(default)]
    headers: std::collections::BTreeMap<String, String>,
    #[serde(default)]
    body: Option<Value>,
    #[serde(default)]
    username_element: Option<u32>,
    #[serde(default)]
    password_element: Option<u32>,
    #[serde(default)]
    submit_element: Option<u32>,
    #[serde(default)]
    confirmation: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "action", rename_all = "kebab-case", rename_all_fields = "camelCase")]
enum BrokerRequest {
    Status,
    List { profile_id: String },
    DeleteProfile { profile_id: String },
    DeleteAll,
    Use { request: UseCredentialInput },
}

#[derive(Debug, Deserialize, Serialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CredentialSecret {
    kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    password: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    token: Option<String>,
}

impl CredentialSecret {
    pub(crate) fn login(username: String, password: String) -> Self {
        Self {
            kind: "login".to_string(),
            username: Some(username),
            password: Some(password),
            token: None,
        }
    }

    pub(crate) fn http_header(token: String) -> Self {
        Self {
            kind: "http-header".to_string(),
            username: None,
            password: None,
            token: Some(token),
        }
    }

    pub(crate) fn username(&self) -> Result<&str, String> {
        self.username
            .as_deref()
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "The saved login has no username.".to_string())
    }

    pub(crate) fn password(&self) -> Result<&str, String> {
        self.password
            .as_deref()
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "The saved login has no password.".to_string())
    }

    pub(crate) fn token(&self) -> Result<&str, String> {
        self.token
            .as_deref()
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "The saved HTTP credential has no token.".to_string())
    }

    pub(crate) fn redactions(&self) -> Vec<&str> {
        [
            self.username.as_deref(),
            self.password.as_deref(),
            self.token.as_deref(),
        ]
        .into_iter()
        .flatten()
        .filter(|value| !value.is_empty())
        .collect()
    }

    pub(crate) fn response_redactions(&self) -> Vec<Zeroizing<String>> {
        let mut patterns = Vec::new();
        for secret in self.redactions() {
            patterns.push(Zeroizing::new(secret.to_string()));
            patterns.push(Zeroizing::new(base64::engine::general_purpose::STANDARD.encode(secret)));
            patterns.push(Zeroizing::new(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(secret)));
            patterns.push(Zeroizing::new(secret.as_bytes().iter().map(|byte| format!("{byte:02x}")).collect()));
            patterns.push(Zeroizing::new(secret.as_bytes().iter().map(|byte| format!("{byte:02X}")).collect()));
            patterns.push(Zeroizing::new(url::form_urlencoded::byte_serialize(secret.as_bytes()).collect()));
            if let Ok(encoded) = serde_json::to_string(secret) {
                patterns.push(Zeroizing::new(encoded.trim_matches('"').to_string()));
            }
            patterns.push(Zeroizing::new(
                secret
                    .replace('&', "&amp;")
                    .replace('<', "&lt;")
                    .replace('>', "&gt;")
                    .replace('"', "&quot;")
                    .replace('\'', "&#39;"),
            ));
        }
        patterns.retain(|pattern| !pattern.is_empty());
        patterns.sort_by(|left, right| right.len().cmp(&left.len()));
        patterns.dedup_by(|left, right| left.as_str() == right.as_str());
        patterns
    }
}

pub(crate) fn redact_secrets(value: &str, secrets: &[&str]) -> String {
    secrets
        .iter()
        .filter(|secret| !secret.is_empty())
        .fold(value.to_string(), |redacted, secret| {
            redacted.replace(secret, "[REDACTED_CREDENTIAL]")
        })
}

fn use_credential(input: UseCredentialInput) -> Result<Value, String> {
    let capability = policy::normalize_capability(&input.capability)?;
    let profile = policy::require_authorized_profile(&input.profile_id, &capability)?;
    let destination = policy::validate_destination(&input.destination_url)?;
    let required_kind = match input.usage {
        CredentialUsage::BrowserLogin => CredentialKind::Login,
        CredentialUsage::Http => CredentialKind::HttpHeader,
    };
    let metadata = storage::resolve_credential(
        &profile.id,
        input.credential_id.as_deref(),
        &destination.origin,
        required_kind,
    )?;
    policy::enforce_credential_policy(
        &metadata,
        input.method.as_deref(),
        input.confirmation.as_deref(),
    )?;
    let secret = storage::load_secret(&metadata)?;

    let result = match input.usage {
        CredentialUsage::BrowserLogin => {
            policy::require_browser_automation(&profile)?;
            browser::submit_login(
                &profile.id,
                &destination.origin,
                input.username_element,
                input.password_element,
                input.submit_element,
                &secret,
            )
        }
        CredentialUsage::Http => http::execute(
            &destination,
            input.method.as_deref(),
            input.headers,
            input.body,
            &metadata,
            &secret,
        ),
    };

    let audit_error = storage::append_audit(storage::AuditEvent {
        profile_id: profile.id,
        credential_id: metadata.id,
        origin: metadata.origin,
        usage: match input.usage {
            CredentialUsage::BrowserLogin => "browser-login".to_string(),
            CredentialUsage::Http => "http".to_string(),
        },
        method: input.method.map(|value| value.to_ascii_uppercase()),
        ok: result.is_ok(),
        occurred_at: chrono::Utc::now().to_rfc3339(),
    })
    .err();
    match result {
        Ok(mut value) => {
            if let Some(error) = audit_error {
                if let Some(object) = value.as_object_mut() {
                    object.insert("auditWarning".to_string(), Value::String(error));
                }
            }
            Ok(value)
        }
        Err(error) => Err(error),
    }
}

fn dispatch(request: BrokerRequest) -> Result<Value, String> {
    match request {
        BrokerRequest::Status => Ok(json!({
            "backend": "os-keychain",
            "available": storage::keyring_available(),
        })),
        BrokerRequest::List { profile_id } => {
            policy::require_authorized_profile(&profile_id, "")?;
            Ok(serde_json::to_value(storage::list_credentials(&profile_id)?).map_err(|error| error.to_string())?)
        }
        BrokerRequest::DeleteProfile { profile_id } => {
            let deleted = storage::delete_profile_credentials(&profile_id)?;
            Ok(json!({ "profileId": profile_id, "deleted": deleted }))
        }
        BrokerRequest::DeleteAll => {
            let deleted = storage::delete_all_credentials()?;
            Ok(json!({ "deleted": deleted }))
        }
        BrokerRequest::Use { request } => use_credential(request),
    }
}

#[tauri::command]
pub fn beeline_local_credentials_list(profile_id: String) -> Result<Value, String> {
    policy::require_authorized_profile(&profile_id, "")?;
    Ok(json!({
        "backend": "os-keychain",
        "available": storage::keyring_available(),
        "credentials": storage::list_credentials(&profile_id)?,
    }))
}

#[tauri::command]
pub fn beeline_local_credential_store(
    input: StoreCredentialInput,
) -> Result<storage::CredentialMetadata, String> {
    policy::require_authorized_profile(&input.profile_id, "")?;
    storage::store_credential(input)
}

#[tauri::command]
pub fn beeline_local_credential_delete(
    profile_id: String,
    credential_id: String,
) -> Result<Value, String> {
    let deleted = storage::delete_credential(&profile_id, &credential_id)?;
    Ok(json!({ "profileId": profile_id, "credentialId": credential_id, "deleted": deleted }))
}

#[tauri::command]
pub fn beeline_local_credentials_delete_profile(profile_id: String) -> Result<Value, String> {
    let deleted = storage::delete_profile_credentials(&profile_id)?;
    Ok(json!({ "profileId": profile_id, "deleted": deleted }))
}

pub fn run_cli() -> i32 {
    let mut raw = Zeroizing::new(String::new());
    if let Err(error) = io::stdin().take(1_048_577).read_to_string(&mut raw) {
        println!("{}", json!({ "ok": false, "error": format!("Could not read broker request: {error}") }));
        return 1;
    }
    if raw.len() > 1_048_576 {
        println!("{}", json!({ "ok": false, "error": "Broker request exceeds 1 MiB." }));
        return 1;
    }
    let request = match serde_json::from_str::<BrokerRequest>(&raw) {
        Ok(request) => request,
        Err(error) => {
            println!("{}", json!({ "ok": false, "error": format!("Invalid broker request: {error}") }));
            return 1;
        }
    };
    match dispatch(request) {
        Ok(data) => {
            println!("{}", json!({ "ok": true, "data": data }));
            0
        }
        Err(error) => {
            println!("{}", json!({ "ok": false, "error": error }));
            1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redaction_removes_every_secret() {
        let value = redact_secrets("user@example.test password token", &["user@example.test", "password", "token"]);
        assert!(!value.contains("user@example.test"));
        assert!(!value.contains("password"));
        assert!(!value.contains("token"));
    }

    #[test]
    fn response_redactions_cover_common_encodings() {
        let secret = CredentialSecret::http_header("credential-value".to_string());
        let patterns = secret.response_redactions();
        let refs = patterns.iter().map(|value| value.as_str()).collect::<Vec<_>>();
        let value = redact_secrets(
            "credential-value Y3JlZGVudGlhbC12YWx1ZQ== 63726564656e7469616c2d76616c7565",
            &refs,
        );
        assert!(!value.contains("credential-value"));
        assert!(!value.contains("Y3JlZGVudGlhbC12YWx1ZQ=="));
        assert!(!value.contains("63726564656e7469616c2d76616c7565"));
    }
}
