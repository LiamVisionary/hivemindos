use super::storage::CredentialMetadata;
use super::{AgentUseMode, CredentialKind, RESTRICTED_CONFIRMATION};
use reqwest::Method;
use serde::Deserialize;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs};
use std::path::PathBuf;
use url::{Host, Url};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuthorizedProfile {
    pub(crate) id: String,
    #[serde(default)]
    capabilities: Vec<String>,
    consent: Consent,
    #[serde(default)]
    browser_binding: Option<BrowserBinding>,
}

#[derive(Debug, Deserialize)]
struct Consent {
    status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrowserBinding {
    automation_mode: String,
}

#[derive(Debug, Deserialize)]
struct ProfilesFile {
    profiles: Vec<AuthorizedProfile>,
}

pub(crate) struct ValidatedDestination {
    pub(crate) url: Url,
    pub(crate) origin: String,
}

fn home_dir() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(|| "Could not determine the current user's home directory.".to_string())
}

fn profiles_path() -> Result<PathBuf, String> {
    Ok(std::env::var_os("HIVEMINDOS_BEELINE_PROFILES_PATH")
        .map(PathBuf::from)
        .unwrap_or(home_dir()?.join(".hivemindos/beeline/profiles.json")))
}

pub(crate) fn normalize_capability(value: &str) -> Result<String, String> {
    let capability = value.trim().to_ascii_lowercase();
    if capability.is_empty() {
        return Ok(capability);
    }
    if !["browser", "calendar", "healthcare", "messaging", "shopping", "travel"]
        .contains(&capability.as_str())
    {
        return Err("That Beeline capability is not recognized.".to_string());
    }
    Ok(capability)
}

pub(crate) fn require_authorized_profile(
    profile_id: &str,
    capability: &str,
) -> Result<AuthorizedProfile, String> {
    let raw = std::fs::read_to_string(profiles_path()?)
        .map_err(|error| format!("Could not read Beeline profiles: {error}"))?;
    let mut profiles: ProfilesFile = serde_json::from_str(&raw)
        .map_err(|error| format!("Beeline profiles are invalid: {error}"))?;
    let profile = profiles
        .profiles
        .drain(..)
        .find(|profile| profile.id == profile_id)
        .ok_or_else(|| "That Beeline profile was not found.".to_string())?;
    if profile.consent.status != "confirmed" {
        return Err("Confirm authority for this Beeline profile before using its local credentials.".to_string());
    }
    if !capability.is_empty() && !profile.capabilities.iter().any(|item| item == capability) {
        return Err(format!("The Beeline profile does not allow the {capability} capability."));
    }
    Ok(profile)
}

pub(crate) fn require_browser_automation(profile: &AuthorizedProfile) -> Result<(), String> {
    if !profile.capabilities.iter().any(|capability| capability == "browser") {
        return Err("Browser access is not enabled for this Beeline profile.".to_string());
    }
    match profile.browser_binding.as_ref() {
        Some(binding) if binding.automation_mode == "trusted-agent" => Ok(()),
        Some(_) => Err("Switch this Beeline browser binding to trusted-agent mode before filling a saved login.".to_string()),
        None => Err("Bind a Chrome profile to this Beeline profile before filling a saved login.".to_string()),
    }
}

pub(crate) fn normalize_origin(value: &str) -> Result<String, String> {
    let url = Url::parse(value.trim()).map_err(|_| "Credential origin must be an absolute HTTPS URL.".to_string())?;
    if url.scheme() != "https" || url.username() != "" || url.password().is_some() {
        return Err("Credential origins must use HTTPS and cannot contain URL credentials.".to_string());
    }
    if url.port_or_known_default() != Some(443) {
        return Err("Credential origins must use the standard HTTPS port 443.".to_string());
    }
    let host = url.host().ok_or_else(|| "Credential origin must include a host.".to_string())?;
    validate_host_name(&host)?;
    Ok(url.origin().ascii_serialization())
}

pub(crate) fn validate_destination(value: &str) -> Result<ValidatedDestination, String> {
    let url = Url::parse(value.trim()).map_err(|_| "Credential destination must be an absolute HTTPS URL.".to_string())?;
    let origin = normalize_origin(value)?;
    if url.fragment().is_some() {
        return Err("Credential destinations cannot include URL fragments.".to_string());
    }
    Ok(ValidatedDestination { url, origin })
}

fn validate_host_name(host: &Host<&str>) -> Result<(), String> {
    match host {
        Host::Domain(domain) => {
            let lower = domain.trim_end_matches('.').to_ascii_lowercase();
            if lower == "localhost"
                || lower.ends_with(".localhost")
                || lower.ends_with(".local")
                || lower.ends_with(".internal")
            {
                return Err("Local and private hostnames cannot receive Beeline credentials.".to_string());
            }
            Ok(())
        }
        Host::Ipv4(address) => require_public_ip(IpAddr::V4(*address)),
        Host::Ipv6(address) => require_public_ip(IpAddr::V6(*address)),
    }
}

pub(crate) fn resolve_public_addresses(url: &Url) -> Result<Vec<SocketAddr>, String> {
    let host = url.host_str().ok_or_else(|| "Credential destination has no host.".to_string())?;
    let addresses = (host, 443)
        .to_socket_addrs()
        .map_err(|error| format!("Could not resolve credential destination: {error}"))?
        .collect::<Vec<_>>();
    if addresses.is_empty() {
        return Err("Credential destination did not resolve to an address.".to_string());
    }
    for address in &addresses {
        require_public_ip(address.ip())?;
    }
    Ok(addresses)
}

fn require_public_ip(address: IpAddr) -> Result<(), String> {
    let public = match address {
        IpAddr::V4(address) => is_public_ipv4(address),
        IpAddr::V6(address) => is_public_ipv6(address),
    };
    if public {
        Ok(())
    } else {
        Err("Local, private, link-local, multicast, and unspecified addresses cannot receive Beeline credentials.".to_string())
    }
}

fn is_public_ipv4(address: Ipv4Addr) -> bool {
    let [a, b, c, _] = address.octets();
    let shared = a == 100 && (64..=127).contains(&b);
    let protocol_assignment = a == 192 && b == 0 && c == 0;
    let benchmarking = a == 198 && (b == 18 || b == 19);
    let reserved = a >= 240;
    !(address.is_private()
        || address.is_loopback()
        || address.is_link_local()
        || address.is_multicast()
        || address.is_broadcast()
        || address.is_documentation()
        || address.is_unspecified()
        || a == 0
        || shared
        || protocol_assignment
        || benchmarking
        || reserved)
}

fn is_public_ipv6(address: Ipv6Addr) -> bool {
    let first = address.segments()[0];
    let unique_local = first & 0xfe00 == 0xfc00;
    let link_local = first & 0xffc0 == 0xfe80;
    let documentation = first == 0x2001 && address.segments()[1] == 0x0db8;
    let discard_only = first == 0x0100 && address.segments()[1..4].iter().all(|segment| *segment == 0);
    let local_translation = first == 0x0064
        && address.segments()[1] == 0xff9b
        && address.segments()[2] == 0x0001;
    let ietf_special = first == 0x2001 && address.segments()[1] <= 0x01ff;
    let six_to_four = first == 0x2002;
    let orchid_or_documentation = first & 0xfff0 == 0x3ff0;
    let site_local = first & 0xffc0 == 0xfec0;
    let mapped_private = address.to_ipv4_mapped().map(|mapped| !is_public_ipv4(mapped)).unwrap_or(false);
    !(address.is_loopback()
        || address.is_unspecified()
        || address.is_multicast()
        || unique_local
        || link_local
        || documentation
        || discard_only
        || local_translation
        || ietf_special
        || six_to_four
        || orchid_or_documentation
        || site_local
        || mapped_private)
}

pub(crate) fn normalize_allowed_methods(
    kind: CredentialKind,
    mode: AgentUseMode,
    methods: &[String],
) -> Result<Vec<String>, String> {
    if kind == CredentialKind::Login || mode == AgentUseMode::Flexible {
        return Ok(Vec::new());
    }
    let mut normalized = methods
        .iter()
        .map(|method| method.trim().to_ascii_uppercase())
        .filter(|method| !method.is_empty())
        .collect::<Vec<_>>();
    normalized.sort();
    normalized.dedup();
    if normalized.is_empty() {
        normalized.push("GET".to_string());
    }
    for method in &normalized {
        Method::from_bytes(method.as_bytes()).map_err(|_| format!("Invalid allowed HTTP method: {method}"))?;
        if method == "CONNECT" || method == "TRACE" {
            return Err(format!("HTTP method {method} cannot be allowed for a saved credential."));
        }
    }
    Ok(normalized)
}

pub(crate) fn normalize_saved_header(value: Option<&str>) -> Result<String, String> {
    let name = value.unwrap_or("Authorization").trim();
    let parsed = reqwest::header::HeaderName::from_bytes(name.as_bytes())
        .map_err(|_| "Saved HTTP header name is invalid.".to_string())?;
    let normalized = parsed.as_str().to_ascii_lowercase();
    if ["cookie", "host", "content-length", "connection"].contains(&normalized.as_str())
        || normalized.starts_with("proxy-")
    {
        return Err("That HTTP header cannot hold a saved Beeline credential.".to_string());
    }
    Ok(parsed.as_str().to_string())
}

pub(crate) fn normalize_header_prefix(value: Option<&str>) -> Result<String, String> {
    let prefix = value.unwrap_or("");
    if prefix.len() > 64 || prefix.contains(['\r', '\n']) {
        return Err("Credential header prefix is invalid.".to_string());
    }
    Ok(prefix.to_string())
}

pub(crate) fn enforce_credential_policy(
    metadata: &CredentialMetadata,
    method: Option<&str>,
    confirmation: Option<&str>,
) -> Result<(), String> {
    if metadata.agent_use_mode == AgentUseMode::Flexible {
        return Ok(());
    }
    if confirmation != Some(RESTRICTED_CONFIRMATION) {
        return Err(format!(
            "This credential is in restricted mode and requires confirmation {RESTRICTED_CONFIRMATION}."
        ));
    }
    if metadata.kind == CredentialKind::HttpHeader {
        let method = method.unwrap_or("GET").trim().to_ascii_uppercase();
        if !metadata.allowed_http_methods.iter().any(|allowed| allowed == &method) {
            return Err(format!("Restricted credential does not allow HTTP {method}."));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn metadata(mode: AgentUseMode) -> CredentialMetadata {
        CredentialMetadata {
            id: "id".to_string(),
            profile_id: "profile".to_string(),
            label: "label".to_string(),
            kind: CredentialKind::HttpHeader,
            origin: "https://example.com".to_string(),
            agent_use_mode: mode,
            allowed_http_methods: vec!["GET".to_string()],
            header_name: Some("Authorization".to_string()),
            header_prefix: Some("Bearer ".to_string()),
            created_at: "now".to_string(),
            updated_at: "now".to_string(),
        }
    }

    #[test]
    fn origin_is_exact_and_https_only() {
        assert_eq!(normalize_origin("https://Example.COM/path").unwrap(), "https://example.com");
        assert!(normalize_origin("http://example.com").is_err());
        assert!(normalize_origin("https://localhost").is_err());
        assert!(normalize_origin("https://127.0.0.1").is_err());
    }

    #[test]
    fn flexible_mode_does_not_require_operation_selection() {
        assert!(enforce_credential_policy(&metadata(AgentUseMode::Flexible), Some("DELETE"), None).is_ok());
    }

    #[test]
    fn restricted_mode_requires_confirmation_and_allowed_method() {
        let metadata = metadata(AgentUseMode::Restricted);
        assert!(enforce_credential_policy(&metadata, Some("GET"), None).is_err());
        assert!(enforce_credential_policy(&metadata, Some("POST"), Some(RESTRICTED_CONFIRMATION)).is_err());
        assert!(enforce_credential_policy(&metadata, Some("GET"), Some(RESTRICTED_CONFIRMATION)).is_ok());
    }

    #[test]
    fn non_public_address_ranges_are_rejected() {
        for address in [
            "10.0.0.1",
            "100.64.0.1",
            "127.0.0.1",
            "169.254.1.1",
            "192.168.1.1",
            "198.18.0.1",
            "203.0.113.1",
            "240.0.0.1",
            "::1",
            "fc00::1",
            "fe80::1",
            "2001:db8::1",
        ] {
            assert!(require_public_ip(address.parse().unwrap()).is_err(), "{address} must be rejected");
        }
        assert!(require_public_ip("1.1.1.1".parse().unwrap()).is_ok());
        assert!(require_public_ip("2606:4700:4700::1111".parse().unwrap()).is_ok());
    }
}
