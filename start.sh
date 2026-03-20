#!/bin/bash
API_KEY=$(python3 -c "import json; print(json.load(open('/home/sem/.openclaw/agents/main/agent/auth-profiles.json'))['profiles']['anthropic:default']['key'])")
export ANTHROPIC_API_KEY=$API_KEY
cd /home/sem/.openclaw/workspace/spreekdossier-site
node server.js
