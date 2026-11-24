# android-llm

dexllm-web · axmlllm-web · apkllm-web 통합 웹 콘솔. 이 저장소는 **UI 셸(index.html)과 submodule 핀**만 관리한다.

- 각 도구 개발은 여기서 하지 말 것 — 원 저장소(~/Project/dexllm-web, ~/Project/axmlllm-web, ~/Project/apkllm-web)에서 개발·push 후 `./update.sh`로 핀만 올린다.
- 로컬 확인: `./serve.sh` → http://localhost:8800 (file:// 금지 — WASM/worker 로드 실패)
- WASM은 전부 단일 스레드 빌드 — COOP/COEP 헤더 불필요. 멀티스레드로 재빌드하면 파일 로드가 깨진다.
- 통합 셸은 각 도구 index.html을 same-origin iframe으로 올린다. 도구 내부 UI 변경은 셸 수정 없이 반영됨.
- versions.json은 update.sh가 생성 — 손으로 수정하지 말 것.
- 배포: GitHub Pages(main 루트, 서브모듈 포함) + `v*` 태그 push 시 CI가 Windows exe(`cmd/android-llm`)를 빌드해 Release에 첨부. 릴리즈 = 태그.
- 동시 분석은 셸이 각 iframe의 전역 `loadFile(file)`과 준비 플래그(dexllm `Module`, axmlllm `engineReady`)를 same-origin으로 직접 쓴다 — 도구 쪽에서 이 이름을 바꾸면 index.html의 READY/MAIN_DROP도 갱신할 것.
- 도구 간 연동은 `suite-bridge.js` 한 곳에 있다(도구 저장소는 수정하지 않음). 연동할 때마다 `exchange()`로 교환 기록(`Bridge.log`)에 남긴다. 의존하는 도구 쪽 이름:
  axmlllm `session`·`last.tree`·`#status.ready`·`#comps/#perms` 표(열은 머리행 텍스트로 찾음: `tag`·`target_activity`, 행 `data-kind`, 그룹 행 `tr.grp`)·`#perm-count/#comp-count`, apkllm `report`·`gateParams` 입력(`#in-enl/#in-tsdk/#in-role/#in-iso/#in-feat/#in-cfg`, `#in-tsdk` change가 검증 후 rerunGate),
  dexllm `navigateToClass`·`allClasses`·`permIndex`·`permPending`·`permTab`·`activePermLevels`·`renderPermPanel`·`#permfilter`·`#status`(로드 완료 시 파일명으로 시작).
  axmlllm 표 하이라이트는 행의 data-suite-* 속성 + ::after 배지로만 그린다 — 셀 텍스트를 바꾸면 axmlllm 복사/클릭 이동이 깨진다.
  도구에서 이 이름이 바뀌면 bridge만 고치면 된다.
- 통합 도구 정의는 `core/suite.mjs` 하나 — 웹 터미널(terminal.js)·MCP(mcp/server.mjs)·CLI(mcp/cli.mjs)가 같이 쓴다. 도구를 고치면 세 곳이 같이 바뀐다.
  매니페스트→게이트 사실 규칙은 `core/facts.mjs`(브리지도 dynamic import로 사용).
  의존하는 도구 쪽 이름 — dexllm: `dexllm-web/mcp/engine.mjs`·`ported.mjs`(import), 페이지 `dk`·`wcall`(`decompile`/`extractIocs`),
  axmlllm: worker.js 메시지 `init/open/tool/tree/components/classnames`, worker 최상위 `py`(Node에서 TOOL_DEFINITIONS 읽기), 페이지 `session.tools`·`wcall`,
  apkllm: worker.js 메시지 `init/load/gate`, 페이지 `report`·`wcall`. Node에서는 axmlllm·apkllm의 worker.js를 그대로 vm에서 돌린다(mcp/workerhost.mjs).
- MCP ↔ 웹 콘솔 중계: MCP 서버가 ws://127.0.0.1:47361(mcp/relay.mjs)을 열고, 로컬에서 연 콘솔(terminal.js, hostname이 루프백일 때만)이 붙는다.
  연결 중엔 MCP 호출을 브라우저 탭이 실행(같은 core) — suite_load는 바이트를 보내 셸 `openAll`로 연다. Origin·Host 루프백 검사는 빼지 말 것.
- 웹 터미널과 Node MCP의 결과가 같아야 한다: 같은 APK로 `xref_*` 결과를 비교해 확인할 것.
- headless Chrome 테스트 주의: 새 프로필로 막 뜬 Chrome은 시작 2~3초 구간의 fetch를 끊는다(axmlllm micropip "Failed to fetch"). 브라우저를 몇 초 띄워둔 뒤 테스트할 것 — 실사용에는 해당 없음.
- MCP 배포 zip(`mcp/bundle.sh`, 릴리즈 CI가 첨부): git 추적 파일(서브모듈 포함) + `npm ci --omit=dev` + Pyodide(`mcp/pyodide-<ver>/`). 새 파일은 git add해야 zip에 들어간다.
  server.mjs·cli.mjs는 `preflight.mjs`(내장 모듈만)로 엔진·패키지를 먼저 확인하고 나머지를 dynamic import한다 — 맨 위에 static import를 늘리지 말 것.
- exe 빌드는 axmlllm-web/worker.js 사본의 Pyodide CDN base를 로컬 경로로 치환한다(build.sh). 그 문자열이 바뀌면 빌드가 실패하도록 돼 있음.
