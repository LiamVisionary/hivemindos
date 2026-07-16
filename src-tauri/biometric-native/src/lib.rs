//! Local device-owner biometric verification behind a small safe API.
//!
//! The macOS backend uses LocalAuthentication. Objective-C calls stay in this
//! focused crate so the parent Tauri crate can continue to forbid unsafe code.

#[cfg(target_os = "macos")]
mod mac;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BiometryKind {
    TouchId,
    FaceId,
    OpticId,
    Unknown,
}

impl BiometryKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::TouchId => "touch-id",
            Self::FaceId => "face-id",
            Self::OpticId => "optic-id",
            Self::Unknown => "biometric",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct BiometricStatus {
    pub available: bool,
    pub kind: Option<BiometryKind>,
}

pub fn status() -> BiometricStatus {
    #[cfg(target_os = "macos")]
    {
        mac::status()
    }
    #[cfg(not(target_os = "macos"))]
    {
        BiometricStatus {
            available: false,
            kind: None,
        }
    }
}

pub fn authenticate(reason: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        mac::authenticate(reason)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = reason;
        Err("Native biometric authentication is not available on this platform.".to_string())
    }
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "macos")]
    use super::status;
    use super::BiometryKind;

    #[test]
    fn biometry_kind_has_stable_client_value() {
        assert_eq!(BiometryKind::TouchId.as_str(), "touch-id");
        assert_eq!(BiometryKind::FaceId.as_str(), "face-id");
        assert_eq!(BiometryKind::OpticId.as_str(), "optic-id");
        assert_eq!(BiometryKind::Unknown.as_str(), "biometric");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_status_probe_is_consistent() {
        let status = status();
        assert_eq!(status.available, status.kind.is_some());
    }
}
