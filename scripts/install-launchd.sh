#!/bin/zsh
# Builds the web app and installs a macOS LaunchAgent so TradeTime
# starts at login and restarts if it crashes. Open http://127.0.0.1:4317 afterwards.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.tradingcompanion.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DATA_DIR="${TC_DATA_DIR:-$HOME/TradingCompanion}"
NODE="$(command -v node)"
PNPM="$(command -v pnpm)"

echo "Building web app…"
(cd "$REPO" && "$PNPM" build)

mkdir -p "$DATA_DIR/logs" "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>--import</string>
    <string>tsx</string>
    <string>src/index.ts</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO/apps/server</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key><string>production</string>
    <key>TC_DATA_DIR</key><string>$DATA_DIR</string>
    <key>PATH</key><string>$(dirname "$NODE"):/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DATA_DIR/logs/server.log</string>
  <key>StandardErrorPath</key><string>$DATA_DIR/logs/server.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed. TradeTime is running at http://127.0.0.1:4317 (data: $DATA_DIR)"
