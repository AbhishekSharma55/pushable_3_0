#!/bin/bash
# Setup Claude Code CLI + proxy on Ubuntu server (one-time setup)
#
# Usage:
#   chmod +x setup-claude-proxy.sh
#   ./setup-claude-proxy.sh

set -e

echo "=== Claude CLI Proxy Setup for Ubuntu ==="

# 1. Install Node.js if not present
if ! command -v node &>/dev/null; then
    echo "Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi
echo "Node.js: $(node --version)"

# 2. Install Claude Code CLI
if ! command -v claude &>/dev/null; then
    echo "Installing Claude Code CLI..."
    npm install -g @anthropic-ai/claude-code
fi
echo "Claude Code: $(claude --version 2>/dev/null || echo 'installed')"

# 3. Login to Claude Code (interactive — opens browser or shows code)
if [ ! -f "$HOME/.claude/.credentials.json" ]; then
    echo ""
    echo "You need to login to Claude Code."
    echo "This will open a browser or show a login URL."
    echo ""
    claude auth login
    echo ""
    if [ -f "$HOME/.claude/.credentials.json" ]; then
        echo "Login successful! Credentials saved to ~/.claude/.credentials.json"
    else
        echo "WARNING: Credentials file not found. Login may have failed."
        exit 1
    fi
else
    echo "Already logged in (credentials found at ~/.claude/.credentials.json)"
fi

# 4. Test that Claude CLI works
echo ""
echo "Testing Claude CLI..."
RESULT=$(echo "Say OK" | claude --print --model claude-haiku-4-5 --output-format json --no-session-persistence 2>/dev/null)
if echo "$RESULT" | grep -q '"is_error":false'; then
    echo "Claude CLI working!"
else
    echo "ERROR: Claude CLI test failed. Output:"
    echo "$RESULT"
    exit 1
fi

# 5. Setup systemd service for the proxy
echo ""
echo "Setting up Claude CLI proxy as a systemd service..."

PROXY_PORT=$(grep CLAUDE_PROXY_PORT .env 2>/dev/null | cut -d= -f2 | tr -d ' ')
PROXY_PORT=${PROXY_PORT:-4006}
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

sudo tee /etc/systemd/system/claude-proxy.service > /dev/null <<EOF
[Unit]
Description=Claude CLI Proxy
After=network.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=$SCRIPT_DIR
ExecStart=$(which node) $SCRIPT_DIR/claude-proxy.mjs
Restart=always
RestartSec=5
Environment=CLAUDE_PROXY_PORT=$PROXY_PORT
Environment=HOME=$HOME
Environment=PATH=$(echo $PATH)
Environment=CLAUDE_BIN=$(which claude)

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable claude-proxy
sudo systemctl start claude-proxy

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Claude CLI proxy running on port $PROXY_PORT"
echo "Status: sudo systemctl status claude-proxy"
echo "Logs:   sudo journalctl -u claude-proxy -f"
echo ""
echo "Make sure your .env has:"
echo "  GATEWAY=CLAUDE"
echo "  CLAUDE_CLI_PROXY_URL=http://host.docker.internal:$PROXY_PORT"
echo ""
echo "Then start Docker: docker compose -f docker-compose.dev.yml up -d"
