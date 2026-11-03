# android-llm

dexllm-web · axmlllm-web · apkllm-web 통합 웹 콘솔. 이 저장소는 **UI 셸(index.html)과 submodule 핀**만 관리한다.

- 각 도구 개발은 여기서 하지 말 것 — 원 저장소(~/Project/dexllm-web, ~/Project/axmlllm-web, ~/Project/apkllm-web)에서 개발·push 후 `./update.sh`로 핀만 올린다.
- 로컬 확인: `./serve.sh` → http://localhost:8800 (file:// 금지 — WASM/worker 로드 실패)
- WASM은 전부 단일 스레드 빌드 — COOP/COEP 헤더 불필요. 멀티스레드로 재빌드하면 파일 로드가 깨진다.
- 통합 셸은 각 도구 index.html을 same-origin iframe으로 올린다. 도구 내부 UI 변경은 셸 수정 없이 반영됨.
- versions.json은 update.sh가 생성 — 손으로 수정하지 말 것.
- 배포: GitHub Pages(main 루트, 서브모듈 포함) + `v*` 태그 push 시 CI가 Windows exe(`cmd/android-llm`)를 빌드해 Release에 첨부. 릴리즈 = 태그.
- 동시 분석은 셸이 각 iframe의 전역 `loadFile(file)`과 준비 플래그(dexllm `Module`, axmlllm `engineReady`)를 same-origin으로 직접 쓴다 — 도구 쪽에서 이 이름을 바꾸면 index.html의 READY/MAIN_DROP도 갱신할 것.
- exe 빌드는 axmlllm-web/worker.js 사본의 Pyodide CDN base를 로컬 경로로 치환한다(build.sh). 그 문자열이 바뀌면 빌드가 실패하도록 돼 있음.
