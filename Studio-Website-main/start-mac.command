#!/bin/bash
cd "$(dirname "$0")"
clear
echo "======================================================"
echo "  The ePlane Co. - Clay Studio"
echo "======================================================"
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Node.js is not installed."
  echo "  1) Download the LTS version from https://nodejs.org"
  echo "  2) Install it, then double-click this file again."
  echo ""
  read -p "Press Enter to close."
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "  Installing dependencies (first run only, ~30s)..."
  npm install || { echo "  npm install failed."; read -p "Press Enter to close."; exit 1; }
fi
echo ""
echo "  Server is starting..."
echo "  >> Open this in your browser:  http://localhost:3000"
echo "  (Keep this window open. Press Ctrl+C here to stop.)"
echo "======================================================"
echo ""
node server.js
