use super::policy::{resolve_public_addresses, ValidatedDestination};
use super::storage::CredentialMetadata;
use super::{redact_secrets, CredentialSecret};
use reqwest::blocking::Client;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, CONTENT_TYPE};
use reqwest::{Method, Url};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::io::Read;
use std::time::Duration;

const MAX_BODY_BYTES: usize = 1_048_576;

fn forbidden_agent_header(name: &str, credential_header: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower == "authorization"
        || lower == credential_header.to_ascii_lowercase()
        || ["cookie", "host", "content-length", "connection", "transfer-encoding", "te", "upgrade"].contains(&lower.as_str())
        || lower.starts_with("proxy-")
        || lower.starts_with("forwarded")
        || lower.starts_with("x-forwarded-")
}

fn build_headers(
    headers: BTreeMap<String, String>,
    metadata: &CredentialMetadata,
    secret: &CredentialSecret,
) -> Result<HeaderMap, String> {
    let saved_name = metadata
        .header_name
        .as_deref()
        .ok_or_else(|| "Saved HTTP credential has no header name.".to_string())?;
    let mut output = HeaderMap::new();
    for (name, value) in headers {
        if forbidden_agent_header(&name, saved_name) {
            return Err(format!("Agent-supplied HTTP header {name} is not allowed for credential use."));
        }
        let name = HeaderName::from_bytes(name.as_bytes())
            .map_err(|_| "An agent-supplied HTTP header name is invalid.".to_string())?;
        let value = HeaderValue::from_str(&value)
            .map_err(|_| "An agent-supplied HTTP header value is invalid.".to_string())?;
        output.insert(name, value);
    }
    let header_name = HeaderName::from_bytes(saved_name.as_bytes())
        .map_err(|_| "Saved HTTP credential header is invalid.".to_string())?;
    let credential_value = format!("{}{}", metadata.header_prefix.as_deref().unwrap_or(""), secret.token()?);
    let header_value = HeaderValue::from_str(&credential_value)
        .map_err(|_| "Saved HTTP credential cannot be represented as a header value.".to_string())?;
    output.insert(header_name, header_value);
    Ok(output)
}

fn build_client(url: &Url) -> Result<Client, String> {
    let addresses = resolve_public_addresses(url)?;
    let host = url.host_str().ok_or_else(|| "Credential destination has no host.".to_string())?;
    Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .resolve_to_addrs(host, &addresses)
        .build()
        .map_err(|error| format!("Could not initialize native credential request: {error}"))
}

pub(crate) fn execute(
    destination: &ValidatedDestination,
    method: Option<&str>,
    headers: BTreeMap<String, String>,
    body: Option<Value>,
    metadata: &CredentialMetadata,
    secret: &CredentialSecret,
) -> Result<Value, String> {
    let method_name = method.unwrap_or("GET").trim().to_ascii_uppercase();
    let method = Method::from_bytes(method_name.as_bytes())
        .map_err(|_| "HTTP method is invalid.".to_string())?;
    if method == Method::CONNECT || method == Method::TRACE {
        return Err(format!("HTTP {method_name} is not available for Beeline credential use."));
    }
    let mut request_headers = build_headers(headers, metadata, secret)?;
    let encoded_body = match body {
        None => None,
        Some(Value::String(value)) => Some(value.into_bytes()),
        Some(value) => {
            if !request_headers.contains_key(CONTENT_TYPE) {
                request_headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
            }
            Some(serde_json::to_vec(&value).map_err(|error| format!("Could not encode HTTP body: {error}"))?)
        }
    };
    if encoded_body.as_ref().map(Vec::len).unwrap_or(0) > MAX_BODY_BYTES {
        return Err("HTTP request body exceeds 1 MiB.".to_string());
    }
    let client = build_client(&destination.url)?;
    let mut request = client
        .request(method, destination.url.clone())
        .headers(request_headers);
    if let Some(body) = encoded_body {
        request = request.body(body);
    }
    let response = request
        .send()
        .map_err(|error| format!("Native credential request failed: {error}"))?;
    let status = response.status();
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    let mut limited = response.take((MAX_BODY_BYTES + 1) as u64);
    let mut bytes = Vec::new();
    limited
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Could not read native credential response: {error}"))?;
    if bytes.len() > MAX_BODY_BYTES {
        return Err("HTTP response exceeds 1 MiB.".to_string());
    }
    let text = String::from_utf8_lossy(&bytes);
    let response_redactions = secret.response_redactions();
    let response_redaction_refs = response_redactions.iter().map(|value| value.as_str()).collect::<Vec<_>>();
    let redacted = redact_secrets(&text, &response_redaction_refs);
    let body = serde_json::from_str::<Value>(&redacted).ok();
    Ok(json!({
        "status": status.as_u16(),
        "ok": status.is_success(),
        "contentType": content_type,
        "origin": destination.origin,
        "path": destination.url.path(),
        "body": body,
        "text": if body.is_none() { Some(redacted) } else { None },
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_cannot_override_auth_or_transport_headers() {
        assert!(forbidden_agent_header("Authorization", "X-Api-Key"));
        assert!(forbidden_agent_header("X-Api-Key", "X-Api-Key"));
        assert!(forbidden_agent_header("Cookie", "X-Api-Key"));
        assert!(forbidden_agent_header("Proxy-Authorization", "X-Api-Key"));
        assert!(!forbidden_agent_header("Accept", "X-Api-Key"));
    }
}
