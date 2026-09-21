#!/usr/bin/env sh
cd "$(dirname "$0")/../server" || exit 1
node src/index.js
