"""Read-only Telegram routing policy for the HivemindOS Swarm Sovereign bot.

The plugin keeps the messaging gateway on Swarm Sovereign for Telegram turns
when its model endpoint answers within three seconds, routes directly to Luna
otherwise, and restricts every Telegram conversation to read-only web tools.
Hermes' native ``fallback_providers`` chain remains a second safety net.
"""

from __future__ import annotations

import logging
import http.client
import json
import re
import time
from collections import OrderedDict
from typing import Any
from urllib.parse import urlsplit


LOGGER = logging.getLogger(__name__)

PLUGIN_CONFIG_KEY = "swarm-sovereign-gateway"
DEFAULT_PRIMARY_PROVIDER = "lm-studio"
DEFAULT_PRIMARY_MODEL = "swarm-sovereign-26b"
DEFAULT_PRIMARY_BASE_URL = "http://127.0.0.1:1234/v1"
DEFAULT_FALLBACK_PROVIDER = "openai-codex"
DEFAULT_FALLBACK_MODEL = "gpt-5.6-luna"
MAX_PRIMARY_HEALTH_TIMEOUT_SECONDS = 3.0
DEFAULT_PUBLIC_TOOLS = frozenset({"web_search", "web_extract"})
MAX_TRACKED_SESSIONS = 512
MAX_HEALTH_RESPONSE_BYTES = 1_048_576

BOT_COMMAND_PATTERN = re.compile(
    r"^\s*(?:@[A-Za-z0-9_]{2,32}bot\s+)?/",
    re.IGNORECASE,
)

PROJECT_CONTEXT = """HivemindOS project context:
- Official user documentation: https://liamvisionary.github.io/hivemindos/
- Official GitHub repository: https://github.com/LiamVisionary/hivemindos
- For questions such as \"what's new\", \"latest updates\", or current project status, inspect the current GitHub repository/releases and the official documentation instead of relying on stale memory.
- Clearly distinguish confirmed current information from inference. Keep Telegram replies useful, friendly, and reasonably concise."""

READ_ONLY_CONTEXT = """Read-only Telegram turn:
- This Telegram gateway does not expose an owner action mode.
- Answer from public information. Web search/extraction are the only permitted tools.
- Never expose local files, sessions, credentials, private memory, personal data, internal network details, or unpublished operational information.
- Do not claim to have performed an action on anyone's behalf."""


_session_access: "OrderedDict[str, str]" = OrderedDict()
_primary_runtime_override: dict[str, Any] | None = None
_runtime_config: dict[str, Any] = {}
_owner_user_ids: frozenset[str] | None = None
_public_tools = DEFAULT_PUBLIC_TOOLS


def is_bot_command(event: Any) -> bool:
    """Recognize commands before public users reach Hermes slash handlers."""
    message_type = str(getattr(event, "message_type", "") or "").lower()
    if "command" in message_type:
        return True
    return bool(BOT_COMMAND_PATTERN.match(str(getattr(event, "text", "") or "")))


def build_read_only_prompt(text: str) -> str:
    return f"{PROJECT_CONTEXT}\n\n{READ_ONLY_CONTEXT}\n\nTelegram request:\n{text.strip()}"


def _plugin_config() -> dict[str, Any]:
    try:
        from hermes_cli.config import load_config

        config = load_config() or {}
    except Exception as exc:
        LOGGER.warning("swarm-sovereign-gateway: could not load config: %s", exc)
        return {}
    plugins = config.get("plugins")
    if not isinstance(plugins, dict):
        return {}
    value = plugins.get(PLUGIN_CONFIG_KEY)
    return value if isinstance(value, dict) else {}


def _configured_owner_ids(config: dict[str, Any]) -> frozenset[str]:
    raw = config.get("owner_telegram_user_ids")
    if raw is None:
        return frozenset()
    values = raw if isinstance(raw, list) else [raw]
    return frozenset(str(value).strip() for value in values if str(value).strip())


def resolve_owner_user_ids(gateway: Any, config: dict[str, Any]) -> frozenset[str]:
    """Resolve owners explicitly, or fail closed unless pairing has one owner."""
    configured = _configured_owner_ids(config)
    if configured:
        return configured
    try:
        approved = gateway.pairing_store.list_approved("telegram")
    except Exception as exc:
        LOGGER.warning("swarm-sovereign-gateway: could not read Telegram pairing: %s", exc)
        return frozenset()
    ids = frozenset(
        str(entry.get("user_id", "")).strip()
        for entry in approved
        if isinstance(entry, dict) and str(entry.get("user_id", "")).strip()
    )
    if len(ids) != 1:
        LOGGER.error(
            "swarm-sovereign-gateway: owner DM/command access disabled because Telegram pairing has %d approved users; configure owner_telegram_user_ids explicitly",
            len(ids),
        )
        return frozenset()
    return ids


def _resolve_runtime_bundle(provider: str, model: str, base_url: str = "") -> dict[str, Any]:
    """Resolve a complete gateway session override without persisting credentials."""
    from hermes_cli.runtime_provider import resolve_runtime_provider

    runtime = resolve_runtime_provider(
        requested=provider,
        explicit_base_url=base_url or None,
    )
    return {
        "model": model,
        "provider": runtime.get("provider"),
        "api_key": runtime.get("api_key"),
        "base_url": runtime.get("base_url") or base_url,
        "api_mode": runtime.get("api_mode"),
    }


def resolve_runtime_override(config: dict[str, Any]) -> dict[str, Any]:
    """Resolve the complete Hermes runtime bundle for the local primary."""
    provider = str(config.get("primary_provider") or DEFAULT_PRIMARY_PROVIDER).strip()
    model = str(config.get("primary_model") or DEFAULT_PRIMARY_MODEL).strip()
    base_url = str(config.get("primary_base_url") or DEFAULT_PRIMARY_BASE_URL).strip()
    return _resolve_runtime_bundle(provider, model, base_url)


def resolve_fallback_runtime_override(config: dict[str, Any]) -> dict[str, Any]:
    """Resolve a fresh Luna OAuth runtime for a direct pre-agent fallback."""
    provider = str(config.get("fallback_provider") or DEFAULT_FALLBACK_PROVIDER).strip()
    model = str(config.get("fallback_model") or DEFAULT_FALLBACK_MODEL).strip()
    base_url = str(config.get("fallback_base_url") or "").strip()
    return _resolve_runtime_bundle(provider, model, base_url)


def _health_timeout_seconds(config: dict[str, Any]) -> float:
    raw_timeout = config.get(
        "primary_health_timeout_seconds",
        MAX_PRIMARY_HEALTH_TIMEOUT_SECONDS,
    )
    try:
        timeout = float(raw_timeout)
    except (TypeError, ValueError):
        timeout = MAX_PRIMARY_HEALTH_TIMEOUT_SECONDS
    return min(max(timeout, 0.1), MAX_PRIMARY_HEALTH_TIMEOUT_SECONDS)


def _request_json_with_deadline(url: str, timeout_seconds: float) -> Any:
    """Fetch a small JSON health response within one total wall-clock budget."""
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return None

    connection_class = (
        http.client.HTTPSConnection
        if parsed.scheme == "https"
        else http.client.HTTPConnection
    )
    connection = connection_class(
        parsed.hostname,
        port=parsed.port,
        timeout=timeout_seconds,
    )
    started_at = time.monotonic()

    def remaining_seconds() -> float:
        remaining = timeout_seconds - (time.monotonic() - started_at)
        if remaining <= 0:
            raise TimeoutError("primary health-check deadline exceeded")
        return remaining

    request_path = parsed.path or "/"
    if parsed.query:
        request_path = f"{request_path}?{parsed.query}"

    try:
        connection.request(
            "GET",
            request_path,
            headers={"Accept": "application/json"},
        )
        if connection.sock is not None:
            connection.sock.settimeout(remaining_seconds())
        response = connection.getresponse()
        if response.status != 200:
            return None
        if connection.sock is not None:
            connection.sock.settimeout(remaining_seconds())
        body = response.read(MAX_HEALTH_RESPONSE_BYTES + 1)
        if len(body) > MAX_HEALTH_RESPONSE_BYTES:
            return None
        remaining_seconds()
        return json.loads(body.decode("utf-8"))
    except (OSError, TimeoutError, UnicodeDecodeError, json.JSONDecodeError):
        return None
    finally:
        connection.close()


def primary_model_is_available(
    config: dict[str, Any],
    request_json: Any = None,
) -> bool:
    """Return true only when the primary endpoint advertises the target model."""
    base_url = str(config.get("primary_base_url") or DEFAULT_PRIMARY_BASE_URL).strip()
    health_url = str(config.get("primary_health_url") or "").strip()
    if not health_url:
        health_url = f"{base_url.rstrip('/')}/models"
    expected_model = str(config.get("primary_model") or DEFAULT_PRIMARY_MODEL).strip().lower()
    fetch_json = request_json or _request_json_with_deadline
    payload = fetch_json(health_url, _health_timeout_seconds(config))
    if not isinstance(payload, dict):
        return False
    models = payload.get("data")
    if not isinstance(models, list):
        return False
    for entry in models:
        if not isinstance(entry, dict):
            continue
        model_id = str(entry.get("id") or "").strip().lower()
        if model_id == expected_model or model_id.endswith(f"/{expected_model}"):
            return True
    return False


def select_runtime_override(config: dict[str, Any]) -> dict[str, Any] | None:
    """Choose Swarm when healthy; otherwise start the turn directly on Luna."""
    if primary_model_is_available(config):
        return _primary_runtime_override
    try:
        fallback_runtime = resolve_fallback_runtime_override(config)
    except Exception as exc:
        LOGGER.error(
            "swarm-sovereign-gateway: direct fallback resolution failed; preserving native fallback: %s",
            exc,
        )
        return _primary_runtime_override
    LOGGER.info(
        "swarm-sovereign-gateway: primary unavailable within %.1fs; routing directly to %s",
        _health_timeout_seconds(config),
        fallback_runtime.get("model") or DEFAULT_FALLBACK_MODEL,
    )
    return fallback_runtime


def _remember_access(session_id: str, access: str) -> None:
    if not session_id:
        return
    _session_access[session_id] = access
    _session_access.move_to_end(session_id)
    while len(_session_access) > MAX_TRACKED_SESSIONS:
        _session_access.popitem(last=False)


def _session_id_for_event(gateway: Any, session_store: Any, event: Any) -> str:
    source = event.source
    try:
        source = gateway._normalize_source_for_session_key(source)
    except Exception:
        pass
    try:
        return str(session_store.get_or_create_session(source).session_id or "")
    except Exception as exc:
        LOGGER.warning("swarm-sovereign-gateway: could not resolve session: %s", exc)
        return ""


def _set_session_runtime(
    gateway: Any,
    event: Any,
    runtime_override: dict[str, Any] | None,
) -> None:
    if not runtime_override:
        return
    source = event.source
    try:
        source = gateway._normalize_source_for_session_key(source)
    except Exception:
        pass
    try:
        session_key = gateway._session_key_for_source(source)
    except Exception as exc:
        LOGGER.warning("swarm-sovereign-gateway: could not resolve model session: %s", exc)
        return

    existing = gateway._session_model_overrides.get(session_key)
    if existing == runtime_override:
        return
    gateway._session_model_overrides[session_key] = dict(runtime_override)
    try:
        gateway._evict_cached_agent(session_key)
    except Exception:
        pass


def pre_gateway_dispatch(event: Any, gateway: Any, session_store: Any, **_: Any) -> dict[str, str] | None:
    """Route Telegram turns through the read-only web boundary."""
    global _owner_user_ids

    source = getattr(event, "source", None)
    platform = str(getattr(getattr(source, "platform", None), "value", None) or getattr(source, "platform", "")).lower()
    if platform != "telegram":
        return None

    user_id = str(getattr(source, "user_id", "") or "").strip()
    if _owner_user_ids is None:
        _owner_user_ids = resolve_owner_user_ids(gateway, _plugin_config())
    is_owner = bool(user_id and user_id in _owner_user_ids)

    chat_type = str(getattr(source, "chat_type", "") or "").lower()
    if not is_owner and chat_type == "dm":
        return {"action": "skip", "reason": "public-dm-denied"}
    if not is_owner and is_bot_command(event):
        return {"action": "skip", "reason": "public-command-denied"}

    if not is_owner:
        # Authorize only this normalized message object. Do not add the guest
        # to Telegram's process-wide allowlist: doing so would also authorize
        # later callback buttons (including an owner's approval controls).
        source.role_authorized = True

    session_id = _session_id_for_event(gateway, session_store, event)
    _remember_access(session_id, "read_only")
    _set_session_runtime(gateway, event, select_runtime_override(_runtime_config))

    return {
        "action": "rewrite",
        "text": build_read_only_prompt(str(getattr(event, "text", "") or "")),
    }


def pre_tool_call(tool_name: str, task_id: str = "", **_: Any) -> dict[str, str] | None:
    """Block every non-web tool for all Telegram sessions."""
    if _session_access.get(str(task_id or "")) != "read_only":
        return None
    if tool_name in _public_tools:
        return None
    return {
        "action": "block",
        "message": "This Telegram gateway is limited to read-only web search and extraction.",
    }


def register(ctx: Any) -> None:
    """Register routing hooks and resolve the configured primary runtime."""
    global _public_tools, _primary_runtime_override, _runtime_config

    config = _plugin_config()
    _runtime_config = dict(config)
    raw_public_tools = config.get("public_tools")
    if isinstance(raw_public_tools, list):
        configured_tools = frozenset(str(value).strip() for value in raw_public_tools if str(value).strip())
        if configured_tools:
            _public_tools = configured_tools
    try:
        _primary_runtime_override = resolve_runtime_override(config)
    except Exception as exc:
        _primary_runtime_override = None
        LOGGER.error("swarm-sovereign-gateway: local primary resolution failed: %s", exc)

    ctx.register_hook("pre_gateway_dispatch", pre_gateway_dispatch)
    ctx.register_hook("pre_tool_call", pre_tool_call)
