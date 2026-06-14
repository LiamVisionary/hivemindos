---
title: "macOS code signing & notarization"
---

# macOS code signing & notarization

The HivemindOS desktop app must be **Developer ID signed and notarized** so it
has a *stable code identity*. This is the foundation for the "pair your phone"
file-access feature: macOS attaches Files-and-Folders / Full Disk Access grants
to a code identity, so an unsigned (ad-hoc) app loses the grant on every update.
Signing also removes the Gatekeeper "unidentified developer" warning.

**This project's team:** Rizzma Inc — **Team ID `L7XLLTV3X7`** (the same team the
Claw / HivemindOS Mobile iOS app is signed under). The Developer ID Application
certificate and the notarization Apple ID below must belong to this team.

## One-time prerequisites (Apple Developer account)

1. **Developer ID Application certificate** — create it in the Apple Developer
   portal (or Xcode → Settings → Accounts → Manage Certificates → +). Export it
   from Keychain Access as a `.p12` with a password.
2. **App-specific password** for notarization — create at appleid.apple.com →
   Sign-In and Security → App-Specific Passwords.
3. **Team ID** — the 10-character ID from the Apple Developer membership page.

## CI (GitHub Actions) — repo Secrets → Actions

The release workflow (`.github/workflows/tauri-cross-platform-release.yml`)
already passes these to `pnpm tauri:build`. Add them as repository secrets:

| Secret | Value |
|---|---|
| `APPLE_CERTIFICATE` | base64 of the `.p12`: `base64 -i DeveloperID.p12 \| pbcopy` |
| `APPLE_CERTIFICATE_PASSWORD` | the password you set when exporting the `.p12` |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Rizzma Inc (L7XLLTV3X7)` |
| `APPLE_ID` | the Apple ID email that's a member of the Rizzma Inc team |
| `APPLE_PASSWORD` | the app-specific password from step 2 |
| `APPLE_TEAM_ID` | `L7XLLTV3X7` |

With all six set, macOS release builds are signed **and** notarized. With none
set, the macOS build is unsigned (unchanged from before).

## Local signed build (to test the phone-pairing file access on your Mac)

You don't need notarization locally — signing alone gives the stable TCC
identity. Make sure the **Developer ID Application** cert is in your login
keychain (Xcode → Settings → Accounts, or import the `.p12`), then:

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
pnpm tauri:build
```

Open the built app from `src-tauri/target/release/bundle/macos/HivemindOS.app`.
Because it's signed with a stable identity, the macOS file-access grant you
give it will persist across rebuilds (as long as the signing identity is the
same), which is what makes the one-click "Allow" experience reliable.
