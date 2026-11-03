# android-llm — 로컬 런처 (Windows)

통합 콘솔(셸 + dexllm-web · axmlllm-web · apkllm-web + axmlllm용 Pyodide 런타임)을
단일 exe로 묶는다. 다운로드 후에는 네트워크 없이 동작한다.

## 사용

1. Releases에서 `android-llm-<ver>-windows-amd64.exe` 다운로드
2. 더블클릭 → 콘솔 창에 `http://127.0.0.1:<랜덤포트>/` 출력, 기본 브라우저 자동 실행
3. APK 드롭 → 세 도구가 동시에 분석 (모두 브라우저 안 WASM, 업로드 없음)
4. 콘솔 창 닫기 / Ctrl+C로 종료

## 빌드

```bash
cmd/android-llm/build.sh [버전]     # → dist/android-llm-<ver>-windows-amd64.exe + 네이티브 바이너리
```

필요: Go ≥ 1.22, curl, python3. `static/`은 빌드 때마다 다시 조립된다(커밋 안 함):

- 셸 `index.html`, `versions.json`
- 각 서브모듈의 런타임 파일만 (index.html, worker.js, wasm/js, 로고, axmlllm wheel)
- Pyodide core + micropip (`dist/.pyodide-<ver>/`에 캐시) — axmlllm-web은 원래 jsdelivr CDN에서
  Pyodide를 받으므로, 빌드 시 `axmlllm-web/worker.js` 사본의 CDN base를 `../pyodide/`로 바꾼다.
  그 문자열이 upstream에서 바뀌면 build.sh가 실패한다 — 패턴을 갱신할 것.

릴리즈는 CI가 한다: `v*` 태그 push → `.github/workflows/release.yml`이 exe를 빌드해 Release에 첨부.

## 보안

- 127.0.0.1에만 바인드, OS가 고른 랜덤 포트
- 단일 스레드 WASM이라 COOP/COEP 헤더 없음
