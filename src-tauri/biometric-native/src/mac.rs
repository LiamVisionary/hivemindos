//! macOS LocalAuthentication backend.

use std::sync::mpsc;
use std::time::Duration;

use block2::RcBlock;
use objc2::runtime::Bool;
use objc2_foundation::{NSError, NSString};
use objc2_local_authentication::{LABiometryType, LAContext, LAPolicy};

use crate::{BiometricStatus, BiometryKind};

const AUTHENTICATION_TIMEOUT: Duration = Duration::from_secs(75);

pub fn status() -> BiometricStatus {
    // SAFETY: `new` initializes an ordinary LocalAuthentication context and
    // has no caller-side preconditions.
    let context = unsafe { LAContext::new() };
    // SAFETY: the receiver is a live retained context. The binding turns the
    // NSError out-parameter into a Rust Result and does not prompt the user.
    if unsafe {
        context.canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthenticationWithBiometrics)
    }
    .is_err()
    {
        return BiometricStatus {
            available: false,
            kind: None,
        };
    }

    // SAFETY: property read on the same valid context.
    let biometry_type = unsafe { context.biometryType() };
    let kind = if biometry_type == LABiometryType::TouchID {
        BiometryKind::TouchId
    } else if biometry_type == LABiometryType::FaceID {
        BiometryKind::FaceId
    } else if biometry_type == LABiometryType::OpticID {
        BiometryKind::OpticId
    } else if biometry_type == LABiometryType::None {
        return BiometricStatus {
            available: false,
            kind: None,
        };
    } else {
        BiometryKind::Unknown
    };

    BiometricStatus {
        available: true,
        kind: Some(kind),
    }
}

pub fn authenticate(reason: &str) -> Result<(), String> {
    let reason = reason.trim();
    if reason.is_empty() {
        return Err("A reason is required for biometric authentication.".to_string());
    }

    // SAFETY: ordinary LocalAuthentication context initialization.
    let context = unsafe { LAContext::new() };
    // SAFETY: capability check on a valid context; it does not show a prompt.
    unsafe {
        context.canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthenticationWithBiometrics)
    }
    .map_err(|error| format!("Device biometrics are unavailable: {error}"))?;

    let localized_reason = NSString::from_str(reason);
    let (sender, receiver) = mpsc::sync_channel(1);
    let reply = RcBlock::new(move |success: Bool, _error: *mut NSError| {
        let _ = sender.send(success.as_bool());
    });

    // SAFETY: the context and NSString are valid retained Objective-C
    // objects. The reply block is kept alive below until the framework calls
    // it (or the timeout invalidates the context); its captured sender is
    // thread-safe because LocalAuthentication invokes replies on a private
    // framework queue.
    unsafe {
        context.evaluatePolicy_localizedReason_reply(
            LAPolicy::DeviceOwnerAuthenticationWithBiometrics,
            &localized_reason,
            &reply,
        );
    }

    let result = receiver.recv_timeout(AUTHENTICATION_TIMEOUT);
    if result.is_err() {
        // SAFETY: invalidating this live context is the documented way to
        // cancel an outstanding evaluation after the application timeout.
        unsafe { context.invalidate() };
    }
    match result {
        Ok(true) => Ok(()),
        Ok(false) => Err("Device authentication was not accepted.".to_string()),
        Err(_) => Err("Device authentication timed out.".to_string()),
    }
}
