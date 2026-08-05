#!/usr/bin/env bash
# Simple "bundler" for ระบบบันทึกต้นทุน กำไร - STone
#   ./build.sh           → modular copy into dist/
#   ./build.sh --bundle  → concatenate storage+app → app.bundle.js
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
mkdir -p js dist/js

# Auto-bump CACHE_NAME in service-worker.js so clients pick up new assets
bump_sw_cache() {
  local ver="somtum-v$(date +%Y%m%d%H%M%S)"
  if [[ -f service-worker.js ]]; then
    sed -i -E "s/const CACHE_NAME = 'somtum-v[^']*'/const CACHE_NAME = '${ver}'/" service-worker.js
    echo "[build] CACHE_NAME → ${ver}"
  fi
}
bump_sw_cache

copy_core() {
  cp -f index.html service-worker.js dist/
  cp -f js/firebase.js dist/js/
  # Keep docs & build script in dist in sync with root
  [[ -f README.md ]] && cp -f README.md dist/ || true
  cp -f build.sh dist/ || true
  # Copy local icons used by relative paths
  for f in icon-192.png icon-512.png favicon-32.png apple-touch-icon-180.png icon_256x256.png icon-maskable-192.png icon-maskable-512.png; do
    [[ -f "$f" ]] && cp -f "$f" dist/ || true
  done
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
