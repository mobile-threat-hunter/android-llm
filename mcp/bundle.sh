#!/usr/bin/env bash
# MCP 배포 zip — 엔진 3개 + node 패키지 + Pyodide를 넣어, 풀고 등록만 하면 오프라인으로 바로 뜬다.
# 서브모듈에서는 엔진 빌드 산출물만 담는다(engines/assets.mjs의 ENGINE_FILES + axmlllm 휠) — 도구 페이지·worker.js는 넣지 않는다.
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
cd "$root"
# 이 저장소에서: MCP·CLI(mcp/, 추적 파일만)와 공용 도구 정의(core/), 버전 기록, Copilot용 VS Code 설정
git ls-files -z mcp core versions.json .vscode/mcp.json | xargs -0 cp --parents -t "$work/$name"
# 서브모듈에서: 엔진 파일만 — 목록은 엔진 로더(engines/assets.mjs)와 같은 출처
node --input-type=module -e '
  const a = await import(process.argv[1]);
  const files = Object.entries(a.ENGINE_FILES).flatMap(([d, fs]) => fs.map(f => d + "/" + f));
  files.push("axmlllm-web/" + a.axmlBuild().wheel);
  console.log(files.join("\n"));
  import("node:fs").then(fs => fs.writeFileSync(process.argv[2], JSON.stringify({ axmlllm: a.axmlBuild() }, null, 1) + "\n"));
' "$root/mcp/engines/assets.mjs" "$work/build.json" | while read -r f; do cp --parents "$f" "$work/$name"; done
mv "$work/build.json" "$work/$name/mcp/engines/build.json"   # 저장소 밖에서는 axmlllm-web/index.html 없이 핀을 읽는다
(cd "$work/$name/mcp" && npm ci --omit=dev --no-audit --no-fund --loglevel=error)

# Pyodide — engines/pyodide.mjs가 mcp/pyodide-<ver>/를 먼저 본다
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
# mcp/package.json이 "type": "module"이라 그 아래의 pyodide.js(CommonJS/UMD)를 require하면 ESM으로 읽힌다 — 이 폴더만 CommonJS로
echo '{ "type": "commonjs" }' > "$work/$name/mcp/pyodide-$pv/package.json"

rm -f "$out"
(cd "$work" && zip -qr -X "$out" "$name")
rm -rf "$work"
ls -l "$out"
