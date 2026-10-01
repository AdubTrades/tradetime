#!/bin/zsh
# Stops TradeTime and removes the login item. Your data folder is left untouched.
set -euo pipefail
LABEL="com.tradingcompanion.server"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
echo "Uninstalled. Data in ~/TradingCompanion was not touched."
