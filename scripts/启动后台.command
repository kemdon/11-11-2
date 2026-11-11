#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"
node "./scripts/start-local.mjs"
echo
read -n 1 -s -r -p "Press any key to continue..."
echo
