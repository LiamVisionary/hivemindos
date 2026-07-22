"""HivemindOS safety boundary for the pinned Hound web-research runtime."""

from __future__ import annotations

import asyncio
import ipaddress
import os
import socket
from pathlib import Path
from urllib.parse import urljoin, urlparse


class UnsafeWebResearchUrl(ValueError):
    """Raised when a URL could reach a non-public network destination."""


def _public_addresses(hostname: str) -> list[str]:
    try:
        records = socket.getaddrinfo(hostname, None, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise UnsafeWebResearchUrl(f"Could not resolve public hostname: {hostname}") from exc

    addresses = sorted({record[4][0].split("%", 1)[0] for record in records})
    if not addresses:
        raise UnsafeWebResearchUrl(f"Could not resolve public hostname: {hostname}")
    for raw in addresses:
        address = ipaddress.ip_address(raw)
        if not address.is_global:
            raise UnsafeWebResearchUrl(
                f"Blocked non-public destination for {hostname}: {address.compressed}"
            )
    return addresses


def validate_public_url(raw_url: str) -> str:
    if not isinstance(raw_url, str) or not raw_url.strip():
        raise UnsafeWebResearchUrl("A non-empty URL is required")
    url = raw_url.strip()
    parsed = urlparse(url)
    if parsed.scheme.lower() not in {"http", "https"}:
        raise UnsafeWebResearchUrl("Only public http(s) URLs are allowed")
    if parsed.username or parsed.password:
        raise UnsafeWebResearchUrl("Credentials embedded in URLs are not allowed")
    hostname = (parsed.hostname or "").rstrip(".").lower()
    if not hostname:
        raise UnsafeWebResearchUrl("URL hostname is required")
    if hostname == "localhost" or hostname.endswith((".localhost", ".local", ".internal")):
        raise UnsafeWebResearchUrl(f"Blocked local hostname: {hostname}")
    _public_addresses(hostname)
    return url


def _redirect_location(headers: object) -> str:
    if not isinstance(headers, dict):
        return ""
    for key, value in headers.items():
        if str(key).lower() == "location":
            return str(value).strip()
    return ""


def _install_cache_boundary() -> None:
    data_dir = os.environ.get("HIVEMINDOS_WEB_RESEARCH_DATA_DIR", "").strip()
    if not data_dir:
        return
    root = Path(data_dir).expanduser().resolve()
    cache_dir = root / "cache"
    model_dir = root / "models" / "msmarco-minilm-l6-v2"
    cache_dir.mkdir(parents=True, exist_ok=True)

    import master_fetch.cache as cache

    cache._CACHE_DIR = cache_dir

    import master_fetch.reranker as reranker

    reranker.MODEL_DIR = model_dir


def _install_http_redirect_guard() -> None:
    import master_fetch.fetcher as fetcher

    original_get = fetcher.HTTPSession.get

    async def guarded_get(self, url: str, *args, **kwargs):
        follow_value = kwargs.pop("follow_redirects", True)
        follow_redirects = not (
            follow_value is False
            or isinstance(follow_value, str) and follow_value.lower() == "never"
        )
        max_redirects = min(max(int(kwargs.pop("max_redirects", 5)), 0), 10)
        current_url = await asyncio.to_thread(validate_public_url, url)

        for redirect_count in range(max_redirects + 1):
            response = await original_get(
                self,
                current_url,
                *args,
                follow_redirects=False,
                max_redirects=0,
                **kwargs,
            )
            await asyncio.to_thread(validate_public_url, str(response.url or current_url))
            location = _redirect_location(response.headers)
            if not follow_redirects or response.status not in {301, 302, 303, 307, 308} or not location:
                return response
            if redirect_count >= max_redirects:
                raise UnsafeWebResearchUrl(f"Too many redirects while fetching {url}")
            current_url = await asyncio.to_thread(
                validate_public_url,
                urljoin(str(response.url or current_url), location),
            )

        raise UnsafeWebResearchUrl(f"Too many redirects while fetching {url}")

    fetcher.HTTPSession.get = guarded_get


def _install_browser_request_guard() -> None:
    import master_fetch.browser as browser

    original_route_handler = browser._create_route_handler
    original_fetch = browser.BrowserSession.fetch

    def guarded_route_handler(_disable_resources: bool, blocked_domains=None):
        # HivemindOS values complete screenshots over Hound's optional resource
        # suppression. The route exists here to validate every navigation and
        # subresource, including redirect targets, before Chromium reaches it.
        base_handler = original_route_handler(False, blocked_domains)

        async def handler(route):
            request_url = str(route.request.url)
            scheme = urlparse(request_url).scheme.lower()
            if scheme in {"http", "https"}:
                try:
                    await asyncio.to_thread(validate_public_url, request_url)
                except UnsafeWebResearchUrl:
                    await route.abort()
                    return
            elif scheme not in {"about", "blob", "data"}:
                await route.abort()
                return
            await base_handler(route)

        return handler

    async def guarded_browser_fetch(self, url: str, *args, **kwargs):
        await asyncio.to_thread(validate_public_url, url)
        kwargs["disable_resources"] = True
        response = await original_fetch(self, url, *args, **kwargs)
        await asyncio.to_thread(validate_public_url, str(response.url or url))
        return response

    browser._create_route_handler = guarded_route_handler
    browser.BrowserSession.fetch = guarded_browser_fetch


def install_hound_guard() -> None:
    import master_fetch.security as security

    security.validate_url = validate_public_url
    _install_cache_boundary()
    _install_http_redirect_guard()
    _install_browser_request_guard()
