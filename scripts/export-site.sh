#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
hide="$(mktemp -d)"
restore() {
  if [ -d "$hide/api" ]; then
    rm -rf app/api
    mv "$hide/api" app/api
  fi
  if [ -f "$hide/instrumentation.ts" ]; then
    mv "$hide/instrumentation.ts" instrumentation.ts
  fi
}
trap restore EXIT
mv app/api "$hide/api"
if [ -f instrumentation.ts ]; then
  mv instrumentation.ts "$hide/instrumentation.ts"
fi
export CUTLINE_EXPORT=1
export NEXT_PUBLIC_DIRECT=1
export NEXT_PUBLIC_BASE_PATH="${NEXT_PUBLIC_BASE_PATH:-/cut-line}"
npm run build
