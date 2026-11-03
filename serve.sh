#!/usr/bin/env bash
# 통합 콘솔 로컬 서빙. 사용: ./serve.sh [포트]  (기본 8800)
cd "$(dirname "$0")"
PORT="${1:-8800}"
echo "http://localhost:${PORT}"
exec python3 -m http.server "$PORT" --bind 127.0.0.1
