# android-llm

dexllm-web · axmlllm-web · apkllm-web 통합 웹 콘솔. 이 저장소는 **UI 셸(index.html)과 submodule 핀**만 관리한다.

- 각 도구 개발은 여기서 하지 말 것 — 원 저장소(~/Project/dexllm-web, ~/Project/axmlllm-web, ~/Project/apkllm-web)에서 개발·push 후 `./update.sh`로 핀만 올린다.
- 로컬 확인: `./serve.sh` → http://localhost:8800 (file:// 금지 — WASM/worker 로드 실패)
- WASM은 전부 단일 스레드 빌드 — COOP/COEP 헤더 불필요. 멀티스레드로 재빌드하면 파일 로드가 깨진다.
- 통합 셸은 각 도구 index.html을 same-origin iframe으로 올린다. 도구 내부 UI 변경은 셸 수정 없이 반영됨.
- versions.json은 update.sh가 생성 — 손으로 수정하지 말 것.
- 배포: GitHub Pages(main 루트, 서브모듈 포함) + `v*` 태그 push 시 CI가 Windows exe(`cmd/android-llm`)를 빌드해 Release에 첨부. 릴리즈 = 태그.
- 동시 분석은 셸이 각 iframe의 전역 `loadFile(file)`과 준비 플래그(dexllm `Module`, axmlllm `engineReady`)를 same-origin으로 직접 쓴다 — 도구 쪽에서 이 이름을 바꾸면 index.html의 READY/MAIN_DROP도 갱신할 것.
- 도구 간 연동은 `suite-bridge.js` 한 곳에 있다(도구 저장소는 수정하지 않음). 의존하는 도구 쪽 이름:
  axmlllm `session`·`last.tree`·`#status.ready`·`#comps/#perms` 표(열은 머리행 텍스트로 찾음: `tag`·`target_activity`, 행 `data-kind`, 그룹 행 `tr.grp`)·`#perm-count/#comp-count`, apkllm `report`·`gateParams` 입력(`#in-enl/#in-tsdk/#in-arsc`),
  dexllm `navigateToClass`·`allClasses`·`permIndex`·`permPending`·`permTab`·`activePermLevels`·`renderPermPanel`·`#permfilter`·`#status`(로드 완료 시 파일명으로 시작).
  axmlllm 표 하이라이트는 행의 data-suite-* 속성 + ::after 배지로만 그린다 — 셀 텍스트를 바꾸면 axmlllm 복사/클릭 이동이 깨진다.
  도구에서 이 이름이 바뀌면 bridge만 고치면 된다.
- headless Chrome 테스트 주의: 새 프로필로 막 뜬 Chrome은 시작 2~3초 구간의 fetch를 끊는다(axmlllm micropip "Failed to fetch"). 브라우저를 몇 초 띄워둔 뒤 테스트할 것 — 실사용에는 해당 없음.
- exe 빌드는 axmlllm-web/worker.js 사본의 Pyodide CDN base를 로컬 경로로 치환한다(build.sh). 그 문자열이 바뀌면 빌드가 실패하도록 돼 있음.
