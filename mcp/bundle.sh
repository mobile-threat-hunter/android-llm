#!/usr/bin/env bash
# MCP 배포 zip — 엔진 3개(서브모듈) + node 패키지 + Pyodide를 모두 넣어, 풀고 등록만 하면 오프라인으로 바로 뜬다.
# GitHub "Source code (zip)"에는 서브모듈과 node_modules가 없어서 따로 만든다. 패키지는 순수 JS라 zip 하나로 Windows·Linux·macOS 공용.
# 사용: mcp/bundle.sh [버전]  → dist/android-llm-<ver>-mcp.zip   (릴리즈 CI가 실행)
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ver="${1:-$(git -C "$root" describe --tags --always)}"
name="android-llm-$ver"
out="$root/dist/$name-mcp.zip"
work="$root/dist/.bundle"

for d in dexllm-web axmlllm-web apkllm-web; do
  [ -n "$(ls -A "$root/$d" 2>/dev/null)" ] || { echo "$d 비어 있음 — git submodule update --init" >&2; exit 1; }
done

rm -rf "$work"; mkdir -p "$work/$name"
# 추적되는 파일만(서브모듈 안까지) — dist/·로컬 node_modules·.git은 빠진다
git -C "$root" ls-files --recurse-submodules -z | (cd "$root" && xargs -0 cp --parents -t "$work/$name")
(cd "$work/$name/mcp" && npm ci --omit=dev --no-audit --no-fund --loglevel=error)

# Pyodide — axmlllm worker가 CDN에서 받는 파일들(pyodide-cache.mjs가 mcp/pyodide-<ver>/를 먼저 본다)
pv=$(grep -oE 'pyodide: "[0-9.]+"' "$root/axmlllm-web/index.html" | grep -oE '[0-9.]+')
[ -n "$pv" ] || { echo "pyodide version not found in axmlllm-web/index.html" >&2; exit 1; }
cache="$root/dist/.pyodide-$pv"; cdn="https://cdn.jsdelivr.net/pyodide/v$pv/full"
mkdir -p "$cache"
for f in pyodide.js pyodide.asm.js pyodide.asm.wasm python_stdlib.zip pyodide-lock.json; do
  [ -s "$cache/$f" ] || curl -sSfL "$cdn/$f" -o "$cache/$f"
done
mp=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['packages']['micropip']['file_name'])" "$cache/pyodide-lock.json")
[ -s "$cache/$mp" ] || curl -sSfL "$cdn/$mp" -o "$cache/$mp"
mkdir -p "$work/$name/mcp/pyodide-$pv" && cp "$cache"/* "$work/$name/mcp/pyodide-$pv/"

rm -f "$out"
(cd "$work" && zip -qr -X "$out" "$name")
rm -rf "$work"
ls -l "$out"
