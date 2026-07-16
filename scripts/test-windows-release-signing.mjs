#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflowPath = ".github/workflows/tauri-cross-platform-release.yml";
const workflow = readFileSync(workflowPath, "utf8");

assert.match(
  workflow,
  /permissions:[\s\S]{0,200}id-token:\s*write/,
  "the release workflow must grant OIDC token access for Azure login",
);

for (const requiredSetting of [
  "secrets.AZURE_CLIENT_ID",
  "secrets.AZURE_TENANT_ID",
  "secrets.AZURE_SUBSCRIPTION_ID",
  "vars.AZURE_ARTIFACT_SIGNING_ENDPOINT",
  "vars.AZURE_ARTIFACT_SIGNING_ACCOUNT_NAME",
  "vars.AZURE_ARTIFACT_SIGNING_CERTIFICATE_PROFILE_NAME",
]) {
  assert.ok(
    workflow.includes(requiredSetting),
    `the Windows signing flow must require ${requiredSetting}`,
  );
}

assert.match(
  workflow,
  /- name: Azure login for Windows signing\s*\n\s+if: runner\.os == 'Windows'\s*\n\s+uses: azure\/login@v3/,
  "Windows release jobs must authenticate to Azure through OIDC",
);
assert.match(
  workflow,
  /- name: Sign Windows installers with Azure Artifact Signing\s*\n\s+if: runner\.os == 'Windows'\s*\n\s+uses: azure\/artifact-signing-action@v2/,
  "Windows release jobs must use the supported Azure Artifact Signing action",
);
assert.match(
  workflow,
  /files-folder:\s*\$\{\{ github\.workspace \}\}\\release-assets/,
);
assert.match(workflow, /files-folder-filter:\s*exe,msi/);
assert.match(workflow, /file-digest:\s*SHA256/);
assert.match(
  workflow,
  /timestamp-rfc3161:\s*['"]?http:\/\/timestamp\.acs\.microsoft\.com['"]?/,
);
assert.match(workflow, /timestamp-digest:\s*SHA256/);

assert.match(
  workflow,
  /- name: Regenerate Tauri signature for signed Windows updater\s*\n\s+if: runner\.os == 'Windows'[\s\S]*?TAURI_SIGNING_PRIVATE_KEY:\s*\$\{\{ secrets\.TAURI_SIGNING_PRIVATE_KEY \}\}[\s\S]*?pnpm tauri signer sign/,
  "Authenticode stamping must be followed by a fresh Tauri updater signature",
);

assert.match(
  workflow,
  /- name: Verify Windows Authenticode signatures\s*\n\s+if: runner\.os == 'Windows'[\s\S]*?Get-AuthenticodeSignature[\s\S]*?SignatureStatus\]::Valid/,
  "the release must fail if any Windows installer lacks a valid Authenticode signature",
);

const collectIndex = workflow.indexOf("- name: Collect bundle assets");
const loginIndex = workflow.indexOf("- name: Azure login for Windows signing");
const signIndex = workflow.indexOf(
  "- name: Sign Windows installers with Azure Artifact Signing",
);
const updaterSignIndex = workflow.indexOf(
  "- name: Regenerate Tauri signature for signed Windows updater",
);
const verifyIndex = workflow.indexOf(
  "- name: Verify Windows Authenticode signatures",
);
const uploadIndex = workflow.indexOf("- name: Upload build artifacts");

assert.ok(
  collectIndex >= 0 &&
    collectIndex < loginIndex &&
    loginIndex < signIndex &&
    signIndex < updaterSignIndex &&
    updaterSignIndex < verifyIndex &&
    verifyIndex < uploadIndex,
  "Windows installers must be collected, signed, verified, and only then uploaded",
);

const signingSection = workflow.slice(loginIndex, uploadIndex);
assert.doesNotMatch(
  signingSection,
  /continue-on-error:\s*true/,
  "Windows release signing must fail closed",
);

console.log("Windows release signing contract passed.");
