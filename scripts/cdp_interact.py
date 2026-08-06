#!/usr/bin/env python3
"""
CDP interaction script for Facebook Marketplace inbox.
Uses the Chrome DevTools Protocol to read and interact with the page.
"""
import json
import urllib.request
import time

def cdp_http_call(method, params=None, ws_url=None):
    """Send a CDP command via HTTP (limited to specific methods)"""
    # Some CDP methods can be called via HTTP, but Runtime methods need WebSocket
    pass

def get_browser_targets():
    """Get all browser targets (tabs) from CDP"""
    try:
        req = urllib.request.Request('http://localhost:50872/json')
        with urllib.request.urlopen(req, timeout=5) as response:
            return json.loads(response.read().decode())
    except Exception as e:
        print(f"Error getting targets: {e}")
        return []

def find_inbox_tab():
    """Find the Facebook Marketplace inbox tab"""
    targets = get_browser_targets()
    for t in targets:
        url = t.get('url', '')
        if 'marketplace/inbox' in url:
            return t
    return None

# Test
if __name__ == "__main__":
    inbox = find_inbox_tab()
    if inbox:
        print("Found Facebook Marketplace inbox!")
        print(f"Tab ID: {inbox['id']}")
        print(f"WebSocket URL: {inbox['webSocketDebuggerUrl']}")

        # Check page title and URL
        print(f"\nPage URL: {inbox['url']}")
        print(f"Title: {inbox.get('title', 'N/A')}")
    else:
        print("Could not find Marketplace inbox tab")
