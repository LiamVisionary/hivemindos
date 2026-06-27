#!/usr/bin/env bash

hivemindos_macos_sign_identity() {
  printf "%s" "${HIVEMINDOS_COLLECTOR_SIGN_IDENTITY:-${HIVEMINDOS_SIGNING_IDENTITY:-${APPLE_SIGNING_IDENTITY:-Developer ID Application: Rizzma, Inc. (L7XLLTV3X7)}}}"
}

hivemindos_codesign_identity_available() {
  local identity="$1"
  [[ "$(uname -s)" == "Darwin" ]] || return 1
  [[ -n "$identity" ]] || return 1
  command -v security >/dev/null 2>&1 || return 1
  security find-identity -v -p codesigning 2>/dev/null | grep -F "$identity" >/dev/null 2>&1
}

hivemindos_sign_macos_binary() {
  local target="$1" identifier="$2" identity
  [[ "$(uname -s)" == "Darwin" ]] || return 0
  [[ -f "$target" ]] || return 1
  command -v codesign >/dev/null 2>&1 || return 0

  identity="$(hivemindos_macos_sign_identity)"
  if hivemindos_codesign_identity_available "$identity"; then
    if codesign --force --timestamp=none --options runtime \
      --sign "$identity" \
      -i "$identifier" \
      "$target" >/dev/null 2>&1; then
      return 0
    fi
    echo "Warning: could not sign $target with $identity" >&2
    return 0
  fi

  if ! codesign -dv "$target" >/dev/null 2>&1; then
    codesign --force --sign - "$target" >/dev/null 2>&1 || true
  fi
}

hivemindos_install_packaged_helper() {
  local source="$1" target="$2" identifier="$3"
  [[ "$(uname -s)" == "Darwin" ]] || return 1
  [[ -x "$source" ]] || return 1
  mkdir -p "$(dirname "$target")"
  if [[ ! -x "$target" ]] || ! cmp -s "$source" "$target"; then
    cp -f "$source" "$target"
    chmod 755 "$target"
  fi
  hivemindos_sign_macos_binary "$target" "$identifier"
  printf "%s" "$target"
}

hivemindos_build_background_helper() {
  local source="$1" target="$2" identifier="$3" temp_target
  [[ "$(uname -s)" == "Darwin" ]] || return 1
  [[ -f "$source" ]] || return 1
  command -v cc >/dev/null 2>&1 || return 1

  mkdir -p "$(dirname "$target")"
  temp_target="$target.tmp"
  if [[ ! -x "$target" || "$source" -nt "$target" ]]; then
    cc -O2 -Wall -Wextra -Werror "$source" -o "$temp_target"
    mv -f "$temp_target" "$target"
    chmod 755 "$target"
  fi
  hivemindos_sign_macos_binary "$target" "$identifier"
  printf "%s" "$target"
}

hivemindos_resolve_background_helper() {
  local helper_name="$1" identifier="$2" source="$3" target="$4" packaged
  shift 4
  for packaged in "$@"; do
    if hivemindos_install_packaged_helper "$packaged" "$target" "$identifier" >/dev/null; then
      printf "%s" "$target"
      return 0
    fi
  done

  hivemindos_build_background_helper "$source" "$target" "$identifier"
}
