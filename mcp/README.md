# android-llm MCP · CLI

dexllm · axmlllm · apkllm 세 엔진과 그 사이의 교차 분석(`xref_*`)을 MCP 도구와 CLI 명령으로 노출한다.
도구 정의는 `core/suite.mjs` 하나라 웹 콘솔의 터미널과 같은 명령·같은 결과다(같은 APK면 xref 결과가 바이트 단위로 같다).

## 설치·등록

필요한 것: [Node.js LTS](https://nodejs.org/) ≥ 20. 둘 중 하나로 받는다.

> GitHub가 자동으로 만드는 **"Source code (zip/tar.gz)"에는 엔진 3개(서브모듈)와 node 패키지가 없다** — 그걸로는 뜨지 않는다(서버가 원인과 해결 방법을 알려 주고 끝난다).

**A. 배포 zip (권장 — git·npm 불필요, 첫 실행도 오프라인)**
[Release](https://github.com/mobile-threat-hunter/android-llm/releases)의 `android-llm-<ver>-mcp.zip`을 받아 푼다 — 엔진 3개·node 패키지·Pyodide가 들어 있고 Windows·Linux·macOS 공용.

```powershell
# Windows PowerShell (풀어 둔 폴더 기준)
cd C:\tools\android-llm-v0.9.3\mcp
claude mcp add -s user android-llm -- node "$PWD\server.mjs"
node smoke.mjs C:\path\to\app.apk     # (선택) "ok — … engines ready" 면 정상
```

**B. git clone (개발·최신 main)**

```bash
git clone --recurse-submodules https://github.com/mobile-threat-hunter/android-llm
cd android-llm/mcp && npm ci
claude mcp add -s user android-llm -- node "$PWD/server.mjs"     # Windows: "$PWD\server.mjs"
```

- `--recurse-submodules`를 빼먹었으면 `git submodule update --init`. 이 경우 첫 실행 때 Pyodide(≈12MB)를 jsdelivr에서 받아 캐시에 둔다.
- 화면 연결용 콘솔은 Release의 `android-llm-<ver>-windows-amd64.exe`(Windows) 또는 `./serve.sh`. MCP와 같은 버전을 쓸 것.
- Windows 경로는 `C:\…` 그대로 넘기면 된다(`suite_load path=C:\Users\me\app.apk`). Pyodide 캐시는 `%USERPROFILE%\.cache\android-llm`.
- CI(`.github/workflows/mcp.yml`)가 Windows·Linux에서 서버를 띄워 같은 APK의 `xref_*` 결과가 같은지, 배포 zip이 Windows에서 풀자마자 오프라인으로 뜨는지 확인한다.

### GitHub Copilot

- **VS Code (Copilot Chat)**: 푼(또는 clone한) `android-llm` 폴더 자체를 VS Code로 열면 저장소의 `.vscode/mcp.json`으로 서버가 잡힌다(첫 실행 때 신뢰 확인 → Start).
  Chat을 **Agent** 모드로, 도구 목록에서 `android-llm`을 켠다. 다른 폴더에서 쓰려면 사용자 설정(`MCP: Open User Configuration`)에 같은 항목을 절대 경로로 넣는다.
- **Copilot CLI**: `/mcp add`로 넣거나 `~/.copilot/mcp-config.json`(Windows `%USERPROFILE%\.copilot\mcp-config.json`)에:

```json
{ "mcpServers": { "android-llm": { "type": "local", "command": "node", "args": ["C:\\path\\to\\android-llm\\mcp\\server.mjs"], "tools": ["*"] } } }
```

Claude Code와 Copilot을 같이 띄우면 서버가 둘이 된다 — 47361 중계(화면 연결)는 먼저 뜬 쪽만 쓰고, 나머지는 Node 엔진으로 동작한다.

첫 실행 때 axmlllm이 쓰는 Pyodide(약 12MB)를 jsdelivr에서 받아 `~/.cache/android-llm/pyodide-<ver>/`에 둔다
(`ANDROID_LLM_CACHE`로 위치 변경). 이후는 오프라인으로 뜬다. 세 엔진 기동 ≈ 1초(Pyodide), 파일 한 개 로드는 크기에 따라 1~3초.

## 웹 콘솔 연결

MCP 서버는 `ws://127.0.0.1:47361`에 중계를 연다. 로컬에서 연 통합 콘솔(exe·`serve.sh`)이 자동으로 붙고(헤더 **MCP** 배지),
붙어 있는 동안 모든 도구 호출을 **그 브라우저 탭이 실행**한다 — 분석가가 연 파일·화면 상태를 그대로 쓰고, 호출·결과는 콘솔 터미널에 `mcp>`로 찍힌다.
`suite_load path=…`는 파일 바이트를 보내 그 화면에 열고(Node 쪽에도 같이 열어 둠), `ui_open_class` / `ui_show_tab`은 화면을 움직인다.
탭이 없으면 Node 엔진으로 실행(`suite_status` → `executor`). 같은 APK면 브라우저·Node의 분석 결과는 같다.

- 보안: 127.0.0.1 바인드, Host·Origin이 루프백일 때만 수락(다른 사이트·DNS rebinding 거부). 분석 도구 호출만 오간다.
- 여러 탭이면 마지막에 포커스한 탭이 실행한다. 두 번째 MCP 프로세스는 포트가 겹쳐 중계 없이 Node로만 동작한다.
- 환경 변수: `ANDROID_LLM_BRIDGE=off`(중계 끄기), `ANDROID_LLM_BRIDGE_PORT`(콘솔은 URL `?mcp=<port>`).

## CLI

```bash
node cli.mjs app.apk                         # 대화형 (help, Tab 완성, exit)
node cli.mjs app.apk xref_summary            # 한 번 실행
node cli.mjs app.apk -e xref_native -e "dex_iocs" -q   # 여러 명령, -q = 진행 로그 숨김
```

문법(웹 터미널과 같음): `<명령> [위치인자…] [key=value…]`, `<그룹> <명령>`(`dex decompile_class X`), 유일하면 접미어만(`summary`),
인자를 JSON으로(`apk_gate {"target_sdk": 30}`). 값은 스키마 타입에 맞춰 바뀐다.

## 도구

| 도구 | 주고받는 정보 |
|---|---|
| `suite_load` / `suite_status` | 파일 하나를 세 엔진에 연다(ZIP → 셋, dex → dexllm, AXML → axmlllm) / 엔진별 상태 |
| `dex_*` | dexllm MCP(dexllm-web/mcp)와 같은 의미: list_classes, decompile_class, search_symbols, callers_of_method, usages_of_string, accessors_of_field, references_to_type, iocs, capabilities, permissions, components |
| `axml_*` | axmlllm 엔진의 `TOOL_DEFINITIONS` 그대로 |
| `apk_*` | overview, tamper, signing, content, gate |
| `xref_manifest_gate` | axmlllm → apkllm: 매니페스트 사실(값+근거) → 설치 게이트 판정, 선언 extractNativeLibs와 컨테이너 불일치 |
| `xref_components` | axmlllm ↔ dexllm: 선언 컴포넌트가 dex에 있는지 · dex 상위 클래스가 선언 tag와 맞는지 · 선언 안 된 컴포넌트 하위 클래스 |
| `xref_permissions` | axmlllm ↔ dexllm: 선언 권한 × 권한 보호 API 호출 근거 (used / declared_only / undeclared) |
| `xref_native` | apkllm ↔ dexllm: lib/<abi>/*.so 와 lib/ 밖 ELF, 그 이름을 참조하는 dex 메서드, loadLibrary/load 호출자 |
| `xref_summary` | 세 도구 신호 + 위 교차 결과 개수 |
| `xref_log` | 이 세션에서 도구 사이에 오간 정보 기록 |
| `ui_open_class` / `ui_show_tab` | 연결된 웹 콘솔 화면에서 클래스 열기 / 탭 전환 |

프롬프트 `triage_apk`(path)는 이 흐름(요약 → 교차 결과 → 근거 확인 → 보고)을 한 번에 건다.

## 구조

- `engines/` — Node 엔진 계층(이 저장소 소유). 서브모듈에서는 **엔진 빌드 산출물만** 쓴다 — 도구 페이지·worker.js에 의존하지 않는다.
  - `dexllm.mjs` — `dexllm-web/dexllm.{js,wasm}` 직접 로드
  - `apkllm.mjs` — `apkllm-web/apkllm.{js,wasm}` + `domain.js` 직접 로드 (load/gate 호출 순서는 apkllm-web 페이지와 같음)
  - `axmlllm.mjs` — Pyodide를 Node에서 공식 방식으로 띄우고 `axmlllm-web/*.whl` 설치 (페이지용 보조 함수와 같은 Python)
  - `pyodide.mjs` — Pyodide 파일: 배포 zip의 `mcp/pyodide-<ver>/` → 없으면 로컬 캐시(없는 파일만 jsdelivr에서 한 번)
  - `assets.mjs` — 엔진 파일 목록·버전 핀(배포 zip은 `engines/build.json`, 저장소는 axmlllm-web 핀) — `preflight.mjs`·`bundle.sh`도 이 목록을 쓴다
- `backend-node.mjs` — 세 엔진을 병렬로 띄우고 파일 종류별로 연다(ZIP → 셋, dex → dexllm, AXML → axmlllm).
- `bundle.sh` — 릴리즈용 `android-llm-<ver>-mcp.zip`: mcp/·core/ + 엔진 파일 + node 패키지 + Pyodide (도구 페이지 미포함).
- `preflight.mjs` — 시작 전 엔진·패키지 확인(없으면 원인과 해결 명령).
- `relay.mjs` — 웹 콘솔 중계(WebSocket, 루프백 전용).
- `server.mjs` — MCP stdio (도구 목록은 core에서, axml_*는 엔진이 내보내는 목록).
- `cli.mjs` — 같은 도구의 명령줄.

한 프로세스에 파일 하나(`suite_load`가 이전 세션을 비운다).
