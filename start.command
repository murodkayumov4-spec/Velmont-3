#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null; then echo "Установите Node.js: https://nodejs.org"; read -p "Enter..."; exit 1; fi
(sleep 1.5; (open http://localhost:3000 || xdg-open http://localhost:3000) >/dev/null 2>&1) &
node server.js
