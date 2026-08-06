#!/usr/bin/env python3
import json
import urllib.request
import time

BASE_URL = 'http://localhost:50872/json'
WS_URL = None

def get_targets():
    req = urllib.request.Request(BASE_URL)
    with urllib.request.urlopen(req, timeout=5) as response:
        return json.loads(response.read().decode())

def find_marketplace_inbox():
    targets = get_targets()
    for t in targets:
        if 'marketplace/inbox' in t.get('url', ''):
            return t
    return None

inbox_target = find_marketplace_inbox()
print(f"Marketplace inbox found: {inbox_target is not None}")
if inbox_target:
    print(f"Target ID: {inbox_target.get('id')}")
    print(f"URL: {inbox_target.get('url')}")
    print(f"WebSocket URL: {inbox_target.get('webSocketDebuggerUrl')}")

    # Store for later use
    with open('/tmp/cdp_target.json', 'w') as f:
        json.dump(inbox_target, f)
