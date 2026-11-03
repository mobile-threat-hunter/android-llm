#!/usr/bin/env bash
# Assemble static/ from the repo root + submodules + Pyodide core, then build
# dist/android-llm-<ver>-windows-amd64.exe (and a native binary for smoke tests).
# 사용: cmd/android-llm/build.sh [버전]   (기본: git describe)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
ver="${1:-$(git -C "$root" describe --tags --always)}"
st="$here/static"

rm -rf "$st"; mkdir -p "$st"
cp "$root/index.html" "$root/versions.json" "$st/"

copy() {   # copy <tool> <files...> — only what the page loads at runtime
  local t="$1"; shift
  mkdir -p "$st/$t"
  for f in "$@"; do cp "$root/$t/$f" "$st/$t/"; done
}
copy dexllm-web  index.html worker.js dexllm.js dexllm.wasm dexllm_logo.png
copy apkllm-web  index.html worker.js apkllm.js apkllm.wasm domain.js apkllm_logo.png
copy axmlllm-web index.html worker.js axmlllm_logo.png
cp "$root"/axmlllm-web/*.whl "$st/axmlllm-web/"

# axmlllm-web loads Pyodide from jsdelivr. Bundle the core + micropip so the
# exe works offline, and point the worker at the local copy.
pv=$(grep -oE 'pyodide: "[0-9.]+"' "$root/axmlllm-web/index.html" | grep -oE '[0-9.]+')
[ -n "$pv" ] || { echo "pyodide version not found in axmlllm-web/index.html" >&2; exit 1; }
cache="$root/dist/.pyodide-$pv"
cdn="https://cdn.jsdelivr.net/pyodide/v$pv/full"
mkdir -p "$cache"
for f in pyodide.js pyodide.asm.js pyodide.asm.wasm python_stdlib.zip pyodide-lock.json; do
  [ -s "$cache/$f" ] || curl -sSfL "$cdn/$f" -o "$cache/$f"
done
mp=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['packages']['micropip']['file_name'])" "$cache/pyodide-lock.json")
[ -s "$cache/$mp" ] || curl -sSfL "$cdn/$mp" -o "$cache/$mp"
mkdir -p "$st/pyodide"
cp "$cache"/* "$st/pyodide/"

w="$st/axmlllm-web/worker.js"
pat='https://cdn.jsdelivr.net/pyodide/v${build.pyodide}/full/'
n=$(grep -cF "$pat" "$w" || true)
[ "$n" = 1 ] || { echo "axmlllm-web/worker.js: Pyodide CDN base not found exactly once ($n) — update build.sh" >&2; exit 1; }
# worker.js lives in /axmlllm-web/, so ../pyodide/ resolves to the bundled copy
python3 - "$w" "$pat" <<'PY'
import sys
p, pat = sys.argv[1], sys.argv[2]
s = open(p).read().replace(pat, '${new URL("../pyodide/", self.location).href}')
open(p, "w").write(s)
PY

cd "$here"
go build -ldflags="-s -w" -trimpath -o android-llm
mkdir -p "$root/dist"
out="$root/dist/android-llm-$ver-windows-amd64.exe"
GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -trimpath -o "$out"
printf "\nBuilt:\n  %s (%d bytes)\n  %s (%d bytes)\n" \
  "$here/android-llm" "$(stat -c %s android-llm)" "$out" "$(stat -c %s "$out")"
