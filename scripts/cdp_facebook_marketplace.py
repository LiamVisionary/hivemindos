#!/usr/bin/env python3
"""
Facebook Marketplace inbox automation via CDP.
"""
import json
import time
import websocket
import urllib.request

# Get the WebSocket URL for the inbox tab
def get_inbox_ws_url():
    req = urllib.request.Request('http://localhost:50872/json/list')
    with urllib.request.urlopen(req, timeout=5) as response:
        targets = json.loads(response.read().decode())
        for t in targets:
            if 'marketplace/inbox' in t.get('url', ''):
                return t.get('webSocketDebuggerUrl')
    return None

ws_url = get_inbox_ws_url()
if not ws_url:
    print("ERROR: Could not find Marketplace inbox tab")
    exit(1)

print(f"Connecting to: {ws_url}")

# Connect to the WebSocket
ws = websocket.WebSocket()
ws.connect(ws_url)

# Generate a random ID for messages
msg_id = 1

def send_cdp(method, params=None):
    global msg_id
    msg = {"id": msg_id, "method": method}
    if params:
        msg["params"] = params
    msg_id += 1

    ws.send(json.dumps(msg))
    response = json.loads(ws.recv())
    return response

# Enable the Runtime domain
print("Enabling Runtime domain...")
resp = send_cdp("Runtime.enable")
print(f"Response: {resp}")

# Get the page DOM - evaluate JS to find messages
print("\nAccessing Facebook Marketplace inbox...")

# Try to get page title first
resp = send_cdp("Runtime.getTitle")
print(f"Page title: {resp.get('result', {}).get('title', 'unknown')}")

# Execute JS to find messages
# Facebook Marketplace inbox has a specific structure
js_code = """
// Check if we're on the right page
document.querySelector('h1, h2, h3')?.textContent || 'No title found'
"""

resp = send_cdp("Runtime.evaluate", {"expression": js_code, "returnByValue": True})
print(f"Page content check: {resp}")

ws.close()
print("\nWebSocket closed.")
