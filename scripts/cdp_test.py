#!/usr/bin/env python3
import json
import urllib.request

try:
    req = urllib.request.Request('http://localhost:50872/json')
    with urllib.request.urlopen(req, timeout=5) as response:
        data = json.loads(response.read().decode())
        print(f'Found {len(data)} targets (tabs)')
        for t in data[:5]:
            title = t.get('title', 'No title')
            url = t.get('url', 'No URL')[:100]
            print(f'  - {title}: {url}')
except Exception as e:
    print(f'Error: {e}')