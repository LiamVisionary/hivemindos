// Copyright 2014-2021 The winit contributors
// Copyright 2021-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0

use std::ffi::CStr;

use objc2::runtime::{AnyClass as Class, ClassBuilder as ClassDecl};
use objc2_app_kit::NSApplication;
use once_cell::sync::Lazy;

pub struct AppClass(pub *const Class);
unsafe impl Send for AppClass {}
unsafe impl Sync for AppClass {}

// HivemindOS patch: do not install Tao's `NSApplication.sendEvent:` override.
// The override only forwarded Cmd-key-up and device-motion events, and it
// aborted startup with `panic in a function that cannot unwind` on macOS
// 26.4.1. AppKit's native event dispatch is sufficient for the dashboard.
pub static APP_CLASS: Lazy<AppClass> = Lazy::new(|| unsafe {
  let superclass = class!(NSApplication);
  let decl = ClassDecl::new(CStr::from_bytes_with_nul(b"TaoApp\0").unwrap(), superclass).unwrap();

  AppClass(decl.register())
});
