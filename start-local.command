#!/bin/sh
PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
export PATH
cd "$(dirname "$0")" || exit 1
node scripts/start-local.mjs
