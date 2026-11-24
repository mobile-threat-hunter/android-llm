# Android LLM Suite

axmlllm-web(AXML/Manifest) · dexllm-web(DEX) · apkllm-web(APK 컨테이너)을 한 콘솔에서 쓰는 통합 웹 페이지.

- 웹: https://mobile-threat-hunter.github.io/android-llm/
- Windows 로컬(오프라인): Releases의 `android-llm-<ver>-windows-amd64.exe` — [cmd/android-llm](cmd/android-llm/README.md)
- MCP 서버(Claude Code · Copilot): Releases의 `android-llm-<ver>-mcp.zip` (엔진·패키지 포함) — [mcp/README.md](mcp/README.md)
  ※ GitHub 자동 "Source code" 압축에는 엔진(서브모듈)·node 패키지가 없다.

탭 순서: 홈 · axmlllm · dexllm · apkllm — **Ctrl+1 / 2 / 3** 으로 전환 (도구 화면 안에 포커스가 있어도 동작).
탭을 오가도 각 화면의 스크롤 위치와 분석 상태는 그대로 유지된다.

**APK 하나를 드롭하면 세 도구가 동시에 분석한다.** 홈 드롭존이나 아무 도구 탭에 드롭해도
(헤더의 "동시 분석"이 켜져 있으면) 나머지 도구에도 같은 파일이 열린다.
`.dex`는 dexllm에만, 바이너리 `AndroidManifest.xml`은 axmlllm에만 들어간다.

### 도구 간 연동 (`suite-bridge.js`)

| 출발 | 도착 | 동작 |
|---|---|---|
| axmlllm 매니페스트 | apkllm Install gate | `extractNativeLibs` · `targetSdk` · split 사실(`apk_role`·`isolatedSplits`·feature split·`configForSplit`)을 자동 입력 → native lib 검사 등 판정이 unknown에서 확정값으로. 미선언 값은 플랫폼 기본값(근거 표시), 정적으로 확정 불가한 값은 unknown 유지 |
| dexllm 분석 결과 | axmlllm Components · Permissions 표 | dex 근거 하이라이트 — Components: 구현 클래스가 dex에 있으면 초록 `dex ✓`, 없으면 주황 `dex에 없음`(패킹·동적 로딩 단서). Permissions: 그 권한의 gated API를 dex가 호출하면 초록 `N API · M class`. 헤더의 **⚑ dex evidence first** 토글로 근거 있는 행을 위로 정렬 (Permissions는 호출 클래스 많은 순) |
| axmlllm Components 행 | dexllm 클래스 | 이름 클릭 → 해당 클래스 디컴파일 (activity-alias는 axmlllm의 target_activity 클래스로 매칭·이동, target 칸도 같은 색). dex에 없으면 탭을 넘기지 않고 "매니페스트에만 선언됨" 경고 |
| axmlllm Permissions 행 | dexllm permissions 패널 | 이름 클릭 → 그 권한으로 필터, gated API별 호출자 펼침, 첫 호출 클래스로 이동. dexllm permissions에 없으면 탭을 넘기지 않고 "선언만 됨" 경고 |

도구 사이에 오간 정보는 전부 교환 기록으로 남는다 — 웹 터미널에 실시간으로 찍히고 `xref_log`로 다시 본다.

### 웹 터미널 · 통합 MCP · CLI

헤더의 **>_ 터미널**(또는 **Ctrl+`**)로 콘솔 아래에 터미널이 열린다. 통합 MCP와 **같은 도구·같은 문법·같은 결과**
(정의는 `core/suite.mjs` 하나)이고, 브라우저에 열린 세 도구의 엔진·세션을 그대로 쓴다.

```
android-llm> xref_summary                          # 세 도구 신호 + 교차 결과 요약
android-llm> xref_components status=missing         # 선언됐지만 dex에 없는 컴포넌트
android-llm> dex decompile_class com.foo.Main max_lines=80
android-llm> help apk_gate                          # 인자 설명
```

Tab 자동완성(명령·`key=`), ↑↓ 기록, Ctrl+L 지우기, Esc 닫기. 결과의 초록 descriptor(`La/b/C;`)를 누르면 dexllm에서 연다.
내장 명령: `help` · `clear` · `history` · `tab <도구>` · `goto <클래스>`.

| 그룹 | 내용 |
|---|---|
| `suite_*` | 파일 열기(`suite_load`), 세 도구 상태 |
| `dex_*` | dexllm — 클래스·디컴파일·심볼 검색·xref·IoC·capabilities·권한/컴포넌트 후보 (dexllm MCP와 같은 의미) |
| `axml_*` | axmlllm 엔진이 내보내는 도구 목록 그대로 (analyze_manifest, list_permissions, manifest_anomalies, resources…) |
| `apk_*` | apkllm — 요약·ZIP 변조 검사·서명 블록/인증서·엔트리 내용 분류·설치 게이트(값 직접 지정) |
| `xref_*` | **도구 사이에 주고받는 정보**: `xref_manifest_gate`(매니페스트 값→설치 게이트, extractNativeLibs 불일치), `xref_components`(선언 컴포넌트↔dex 클래스·상위 클래스 판정·미선언 컴포넌트), `xref_permissions`(선언 권한↔호출 근거: used / declared_only / undeclared), `xref_native`(포장된 .so·lib/ 밖 ELF↔dex 문자열·로더), `xref_summary`, `xref_log` |

같은 도구를 **MCP 서버**와 **CLI**로도 쓸 수 있다 — [mcp/README.md](mcp/README.md):

```bash
cd mcp && npm ci                                             # 배포 zip(mcp.zip)이면 생략
claude mcp add android-llm -- node "$PWD/server.mjs"        # MCP (stdio)
node cli.mjs app.apk xref_summary                            # CLI 한 번 실행 / 인자 없이 대화형
```

### Claude(MCP) ↔ 웹 콘솔 연결

**로컬에서 연 콘솔**(Windows exe 또는 `./serve.sh`)은 통합 MCP 서버에 자동으로 붙는다 — 헤더의 **MCP** 배지가 초록이면 연결됨.
연결돼 있는 동안 Claude의 MCP 도구 호출은 **그 브라우저 탭이 실행**한다:

- 분석가가 화면에 연 파일·상태(dexllm dump 추가 등)를 Claude가 그대로 다룬다. `suite_load path=…`는 파일을 이 화면에 연다.
- 호출과 결과가 콘솔 터미널에 `mcp>` 로 찍힌다 — Claude가 무엇을 보고 판단했는지 그 자리에서 보인다.
- `ui_open_class` · `ui_show_tab` 으로 Claude가 근거 코드를 dexllm 화면에 띄운다.
- 탭을 닫으면 MCP는 Node 엔진으로 이어서 동작한다(`suite_status`의 `executor`: browser / node).

중계는 MCP 서버가 `ws://127.0.0.1:47361`에 연다 — 루프백 Host·루프백 Origin 페이지만 받고(다른 웹사이트·DNS rebinding 차단),
오가는 것은 분석 도구 호출뿐이다. GitHub Pages 콘솔은 연결하지 않는다. 포트 변경: MCP `ANDROID_LLM_BRIDGE_PORT` + 콘솔 URL `?mcp=<port>`,
끄기: `ANDROID_LLM_BRIDGE=off`.

## 구조

세 도구는 **git submodule**로 고정된다 — 이 저장소는 UI 셸(index.html)과 핀(커밋)만 가진다.

```
android-llm/
├── index.html      # 통합 콘솔 (탭 + iframe, lazy load·상태 유지)
├── suite-bridge.js # 도구 간 연동 (axmlllm → apkllm / dexllm) + 교환 기록
├── terminal.js     # 웹 터미널 (core/를 브라우저 iframe 엔진에 연결)
├── core/           # 통합 도구 정의 — 웹 터미널·MCP·CLI 공용 (suite.mjs, facts.mjs, cli.mjs)
├── mcp/            # 통합 MCP 서버·CLI (Node — 서브모듈의 엔진을 그대로 띄움)
├── dexllm-web/     # submodule → github.com/mobile-threat-hunter/dexllm-web
├── axmlllm-web/    # submodule → github.com/mobile-threat-hunter/axmlllm-web
├── apkllm-web/     # submodule → github.com/mobile-threat-hunter/apkllm-web
├── update.sh       # 서브모듈 최신화 + versions.json + 핀 커밋
├── serve.sh        # 로컬 서빙 (기본 http://localhost:8800)
├── cmd/android-llm # Windows exe 런처 (Go, 전체 번들 embed)
└── .github/workflows/release.yml  # v* 태그 → exe 빌드 → Release 첨부
```

## 사용

```bash
git clone --recurse-submodules <this-repo>
./serve.sh            # http://localhost:8800
```

file:// 직접 열기는 WASM/worker 로드가 막히므로 반드시 serve.sh(HTTP)로 띄울 것.
각 도구의 WASM은 단일 스레드 빌드라 COOP/COEP 헤더가 필요 없다.

## 각 도구가 git에서 업데이트됐을 때

```bash
./update.sh           # 세 서브모듈을 origin/main 최신으로 + 핀 커밋
./update.sh --check   # 뭐가 바뀌는지만 확인
```

개별 도구만 올리려면: `git -C dexllm-web pull && git add dexllm-web && git commit`.

## 릴리즈

```bash
./update.sh                       # 핀 최신화 (필요 시)
git tag v0.X.Y && git push origin main v0.X.Y   # Pages 갱신 + CI가 exe를 Release에 첨부
```

## 주의

- 서브모듈 안에서 직접 개발하지 말 것 — 각 도구는 자기 저장소(~/Project/dexllm-web 등)에서 개발하고 push한 뒤 여기서 `./update.sh`.
- 통합 셸은 각 도구의 `index.html`을 same-origin iframe으로 올리므로, 도구 쪽 내부 변경은 셸 수정 없이 그대로 반영된다.
