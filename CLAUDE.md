# android-llm

dexllm-web · axmlllm-web · apkllm-web 통합 웹 콘솔. 이 저장소는 **UI 셸(index.html)과 submodule 핀**만 관리한다.

- 각 도구 개발은 여기서 하지 말 것 — 원 저장소(~/Project/dexllm-web, ~/Project/axmlllm-web, ~/Project/apkllm-web)에서 개발·push 후 `./update.sh`로 핀만 올린다.
- 로컬 확인: `./serve.sh` → http://localhost:8800 (file:// 금지 — WASM/worker 로드 실패)
- WASM은 전부 단일 스레드 빌드 — COOP/COEP 헤더 불필요. 멀티스레드로 재빌드하면 파일 로드가 깨진다.
- 통합 셸은 각 도구 index.html을 same-origin iframe으로 올린다. 도구 내부 UI 변경은 셸 수정 없이 반영됨.
- versions.json은 update.sh가 생성 — 손으로 수정하지 말 것.
