# android-llm MCP · CLI

dexllm · axmlllm · apkllm 세 엔진과 그 사이의 교차 분석(`xref_*`)을 MCP 도구와 CLI 명령으로 노출한다.
도구 정의는 `core/suite.mjs` 하나라 웹 콘솔의 터미널과 같은 명령·같은 결과다(같은 APK면 xref 결과가 바이트 단위로 같다).

## 설치·등록

```bash
git clone --recurse-submodules https://github.com/mobile-threat-hunter/android-llm
cd android-llm/mcp && npm install        # Node ≥ 20
claude mcp add android-llm -- node "$PWD/server.mjs"
```

첫 실행 때 axmlllm이 쓰는 Pyodide(약 12MB)를 jsdelivr에서 받아 `~/.cache/android-llm/pyodide-<ver>/`에 둔다
(`ANDROID_LLM_CACHE`로 위치 변경). 이후는 오프라인으로 뜬다. 세 엔진 기동 ≈ 1초(Pyodide), 파일 한 개 로드는 크기에 따라 1~3초.

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

프롬프트 `triage_apk`(path)는 이 흐름(요약 → 교차 결과 → 근거 확인 → 보고)을 한 번에 건다.

## 구조

- `backend-node.mjs` — 엔진: dexllm은 `dexllm-web/mcp/engine.mjs`, axmlllm·apkllm은 각 저장소의 **worker.js를 그대로** `workerhost.mjs`(vm 기반 최소 Web Worker 호스트)에서 돌린다. 웹 페이지와 같은 파일·같은 메시지 프로토콜.
- `pyodide-cache.mjs` — axmlllm worker.js가 CDN에서 받는 Pyodide 파일을 로컬 캐시로 돌린다.
- `server.mjs` — MCP stdio (도구 목록은 core에서, axml_*는 엔진이 내보내는 목록).
- `cli.mjs` — 같은 도구의 명령줄.

한 프로세스에 파일 하나(`suite_load`가 이전 세션을 비운다).
