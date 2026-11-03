#!/usr/bin/env bash
# 서브모듈 3개를 각 GitHub main 최신으로 당기고, 핀 변경을 커밋한다.
# 사용: ./update.sh          — 최신화 + versions.json 갱신 + 커밋
#       ./update.sh --check  — 변경 여부만 확인 (커밋 안 함)
set -euo pipefail
cd "$(dirname "$0")"

git submodule update --init --remote --merge

# 각 서브모듈의 태그/커밋으로 versions.json 생성
{
  echo "{"
  first=1
  for d in dexllm-web axmlllm-web apkllm-web; do
    v=$(git -C "$d" describe --tags --always 2>/dev/null)
    [ $first -eq 0 ] && echo ","
    first=0
    printf '  "%s": "%s"' "$d" "$v"
  done
  echo ""
  echo "}"
} > versions.json

if [ "${1:-}" = "--check" ]; then
  git status --short
  exit 0
fi

if git status --porcelain | grep -q .; then
  git add -A
  git commit -m "chore: bump submodules ($(python3 -c "import json;print(' · '.join(f'{k.split(chr(45))[0]} {v}' for k,v in json.load(open('versions.json')).items()))"))"
  echo "updated:"
  git submodule status
else
  echo "already up to date"
fi
