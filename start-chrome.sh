#!/bin/bash
# Start Chrome with remote debugging enabled for CDP Analyzer
# This allows the Python CDP Analyzer to connect and analyze pages

echo "Starting Chrome with remote debugging on port 9222..."
echo "Your existing profile and logins will be preserved."
echo ""

google-chrome \
  --remote-debugging-port=9222 \
  --remote-allow-origins=* \
  --user-data-dir="$HOME/.config/google-chrome" \
  --profile-directory="Default" \
  &

echo ""
echo "Chrome started. Verify with: curl http://localhost:9222/json/version"
echo ""
echo "Now load extension-v4 in chrome://extensions"
