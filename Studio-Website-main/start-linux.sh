#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Get the LTS version from https://nodejs.org, then run this again."
  exit 1
fi
[ -d node_modules ] || npm install || exit 1
echo "Open http://localhost:3000 in your browser. (Ctrl+C to stop.)"
node server.js
