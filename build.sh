#!/usr/bin/env bash
# Simple "bundler" for ส้มตำนายหนึ่ง
#   ./build.sh           → modular copy into dist/
#   ./build.sh --bundle  → concatenate storage+app → app.bundle.js
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
mkdir -p js dist/js

copy_core() {
  cp -f index.html service-worker.js dist/
  cp -f js/firebase.js dist/js/
}

if [[ "${1:-}" == "--bundle" ]]; then
  echo "[build] bundle mode"
  {
    echo "/* Somtum bundle generated $(date -u +%Y-%m-%dT%H:%M:%SZ) */"
    cat js/storage.js
    echo ""
    cat js/app.js
  } > js/app.bundle.js
  copy_core
  cp -f js/app.bundle.js dist/js/
  # Rewrite script tags in dist index
  python3 - <<'PY'
from pathlib import Path
p = Path('dist/index.html')
t = p.read_text(encoding='utf-8')
t = t.replace('./js/storage.js', './js/app.bundle.js')
# remove the separate app.js script line
import re
t = re.sub(r'\s*<script src="\./js/app\.js"></script>\s*', '\n  ', t, count=1)
p.write_text(t, encoding='utf-8')
PY
  # SW cache list
  sed -i "s|./js/storage.js|./js/app.bundle.js|g; /js\/app\.js/d" dist/service-worker.js || true
  echo "[build] dist/ ready (bundled)"
else
  echo "[build] modular mode"
  copy_core
  cp -f js/storage.js js/app.js dist/js/
  echo "[build] dist/ ready (modular)"
fi

echo "[build] files:"
find dist -type f | sort
