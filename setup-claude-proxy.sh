#!/bin/bash
# Setup Claude Code CLI + proxy (works on both macOS and Linux)
#
# Usage:
#   chmod +x setup-claude-proxy.sh
#   ./setup-claude-proxy.sh

set -e

OS="$(uname -s)"
echo "=== Claude CLI Proxy Setup ($OS) ==="

# 1. Install Node.js if not present
if ! command -v node &>/dev/null; then
    if [ "$OS" = "Darwin" ]; then
        echo "Installing Node.js via Homebrew..."
        if ! command -v brew &>/dev/null; then
            echo "ERROR: Homebrew not found. Install it from https://brew.sh"
            exit 1
        fi
        brew install node
    else
        echo "Installing Node.js..."
        curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
        sudo apt-get install -y nodejs
    fi
fi
echo "Node.js: $(node --version)"

# 2. Install Claude Code CLI
if ! command -v claude &>/dev/null; then
    echo "Installing Claude Code CLI..."
    npm install -g @anthropic-ai/claude-code
fi
echo "Claude Code: $(claude --version 2>/dev/null || echo 'installed')"

# 3. Login to Claude Code (interactive — opens browser or shows code)
#    macOS stores credentials in Keychain, Linux uses ~/.claude/.credentials.json
check_logged_in() {
    if [ "$OS" = "Darwin" ]; then
        # On macOS, credentials are in Keychain — test by running a quick CLI check
        claude auth status &>/dev/null 2>&1 && return 0
        # Fallback: try to run a simple command to see if auth works
        echo "test" | claude --print --no-session-persistence &>/dev/null 2>&1 && return 0
        return 1
    else
        [ -f "$HOME/.claude/.credentials.json" ] && return 0
        return 1
    fi
}

if ! check_logged_in; then
    echo ""
    echo "You need to login to Claude Code."
    echo "This will open a browser or show a login URL."
    echo ""
    claude auth login
    echo ""
    if check_logged_in; then
        echo "Login successful!"
    else
        echo "WARNING: Could not verify login. Continuing anyway — the test step will confirm."
    fi
else
    echo "Already logged in."
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

# 5. Setup persistent service for the proxy
PROXY_PORT=$(grep CLAUDE_PROXY_PORT .env 2>/dev/null | cut -d= -f2 | tr -d ' ')
PROXY_PORT=${PROXY_PORT:-4006}
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ "$OS" = "Darwin" ]; then
    # ── macOS: use launchd ──
    echo ""
    echo "Setting up Claude CLI proxy as a launchd service..."

    PLIST_LABEL="com.pushable.claude-proxy"
    PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"
    NODE_BIN="$(which node)"
    CLAUDE_BIN="$(which claude)"
    LOG_DIR="$HOME/Library/Logs/claude-proxy"
    mkdir -p "$LOG_DIR"

    cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${NODE_BIN}</string>
        <string>${SCRIPT_DIR}/claude-proxy.mjs</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${SCRIPT_DIR}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>CLAUDE_PROXY_PORT</key>
        <string>${PROXY_PORT}</string>
        <key>CLAUDE_BIN</key>
        <string>${CLAUDE_BIN}</string>
        <key>PATH</key>
        <string>${PATH}</string>
        <key>HOME</key>
        <string>${HOME}</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${LOG_DIR}/stdout.log</string>
    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/stderr.log</string>
</dict>
</plist>
PLIST

    # Unload first if already loaded (ignore errors)
    launchctl bootout "gui/$(id -u)/${PLIST_LABEL}" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"

    echo ""
    echo "=== Setup Complete ==="
    echo ""
    echo "Claude CLI proxy running on port $PROXY_PORT"
    echo "Status: launchctl print gui/$(id -u)/${PLIST_LABEL}"
    echo "Logs:   tail -f ${LOG_DIR}/stdout.log ${LOG_DIR}/stderr.log"
    echo "Stop:   launchctl bootout gui/$(id -u)/${PLIST_LABEL}"
    echo "Start:  launchctl bootstrap gui/$(id -u) ${PLIST_PATH}"
else
    # ── Linux: use systemd ──
    echo ""
    echo "Setting up Claude CLI proxy as a systemd service..."

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
fi

echo ""
echo "Make sure your .env has:"
echo "  GATEWAY=CLAUDE"
echo "  CLAUDE_CLI_PROXY_URL=http://host.docker.internal:$PROXY_PORT"
echo ""
echo "Then start Docker: docker compose -f docker-compose.dev.yml up -d"
