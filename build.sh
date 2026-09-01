#!/usr/bin/env bash
# STone build — modular (default) หรือ --bundle → dist/
# โมดูล UI: app-core → app-dashboard → app-tx → app-categories → app-features
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
mkdir -p js dist/js
rm -rf dist/js/*

APP_MODULES=(
  js/app-core.js
  js/app-dashboard.js
  js/app-tx.js
  js/app-categories.js
  js/app-features.js
)

# Auto-bump CACHE_NAME in service-worker.js so clients pick up new assets
bump_sw_cache() {
  local ver="stone-v$(date +%Y%m%d%H%M%S)"
  if [[ -f service-worker.js ]]; then
    sed -i -E "s/const CACHE_NAME = 'stone-v[^']*'/const CACHE_NAME = '${ver}'/" service-worker.js
    echo "[build] CACHE_NAME → ${ver}"
  fi
}
bump_sw_cache

copy_core() {
  cp -f index.html service-worker.js dist/
  [[ -f manifest.webmanifest ]] && cp -f manifest.webmanifest dist/ || true
  [[ -f privacy.html ]] && cp -f privacy.html dist/ || true
  [[ -f firestore.rules ]] && cp -f firestore.rules dist/ || true
  [[ -f SECURITY.md ]] && cp -f SECURITY.md dist/ || true
  [[ -f README.md ]] && cp -f README.md dist/ || true
  cp -f build.sh dist/ || true
  for f in icon-192.png icon-512.png favicon-32.png apple-touch-icon-180.png icon_256x256.png icon-maskable-192.png icon-maskable-512.png; do
    [[ -f "$f" ]] && cp -f "$f" dist/ || true
  done
  if [[ -d css ]]; then
    mkdir -p dist/css
    cp -f css/* dist/css/ 2>/dev/null || true
  fi
}

if [[ "${1:-}" == "--bundle" ]]; then
  echo "[build] bundle mode"
  {
    echo "/* STone bundle generated $(date -u +%Y-%m-%dT%H:%M:%SZ) */"
    cat js/storage.js
    echo ""
    for m in "${APP_MODULES[@]}"; do
      echo "/* ---- ${m} ---- */"
      cat "$m"
      echo ""
    done
  } > js/app.bundle.js
  copy_core
  cp -f js/app.bundle.js js/reports.js js/firebase.js dist/js/
  python3 - <<'PY'
from pathlib import Path
import re
p = Path('dist/index.html')
t = p.read_text(encoding='utf-8')
old = re.compile(
    r'\s*<script src="\./js/storage\.js"></script>\s*'
    r'<script src="\./js/app-core\.js"></script>\s*'
    r'<script src="\./js/app-dashboard\.js"></script>\s*'
    r'<script src="\./js/app-tx\.js"></script>\s*'
    r'<script src="\./js/app-categories\.js"></script>\s*'
    r'<script src="\./js/app-features\.js"></script>\s*',
    re.M
)
new = '\n  <script src="./js/app.bundle.js"></script>\n  '
t2, n = old.subn(new, t, count=1)
if n != 1:
    t2 = re.sub(r'\s*<script src="\./js/storage\.js"></script>\s*', '\n  <script src="./js/app.bundle.js"></script>\n  ', t, count=1)
    t2 = re.sub(r'\s*<script src="\./js/app(?:-core|-dashboard|-tx|-categories|-features)?\.js"></script>\s*', '\n  ', t2)
p.write_text(t2, encoding='utf-8')
print('[build] dist/index.html script tags → app.bundle.js')
PY
  python3 - <<'PY'
from pathlib import Path
import re
p = Path('dist/service-worker.js')
t = p.read_text(encoding='utf-8')
for name in ['app-core.js', 'app-dashboard.js', 'app-tx.js', 'app-categories.js', 'app-features.js', 'app.js', 'storage.js']:
    t = re.sub(rf"\s*'./js/{re.escape(name)}',?\n", "\n", t)
if "./js/app.bundle.js" not in t:
    t = t.replace(
        "'./privacy.html',\n",
        "'./privacy.html',\n  './js/app.bundle.js',\n",
        1
    )
p.write_text(t, encoding='utf-8')
print('[build] dist/service-worker.js CORE_ASSETS → app.bundle.js')
PY
  echo "[build] dist/ ready (bundled)"
else
  echo "[build] modular mode"
  copy_core
  cp -f js/storage.js js/reports.js js/firebase.js dist/js/
  for m in "${APP_MODULES[@]}"; do
    cp -f "$m" dist/js/
  done
  [[ -f js/app.js ]] && cp -f js/app.js dist/js/ || true
  echo "[build] dist/ ready (modular)"
fi

echo "[build] files:"
find dist -type f | sort
