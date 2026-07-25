#!/usr/bin/env bash

# Storyteller Animation Platform - One-Click Launcher
# Double-click this file in macOS Finder to start the application.

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "========================================================"
echo "  🚀 Launching Storyteller Animation Platform"
echo "========================================================"
echo ""

# Ensure Node environment is loaded
export PATH=$PATH:/usr/local/bin:~/.nvm/versions/node/$(ls ~/.nvm/versions/node 2>/dev/null | tail -n 1)/bin

npm run studio
