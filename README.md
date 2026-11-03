# Android LLM Suite

dexllm-web(DEX) · axmlllm-web(AXML/Manifest) · apkllm-web(APK 컨테이너)을 한 콘솔에서 쓰는 통합 웹 페이지.

- 웹: https://mobile-threat-hunter.github.io/android-llm/
- Windows 로컬(오프라인): Releases의 `android-llm-<ver>-windows-amd64.exe` — [cmd/android-llm](cmd/android-llm/README.md)

**APK 하나를 드롭하면 세 도구가 동시에 분석한다.** 홈 드롭존이나 아무 도구 탭에 드롭해도
(헤더의 "동시 분석"이 켜져 있으면) 나머지 도구에도 같은 파일이 열린다.
`.dex`는 dexllm에만, 바이너리 `AndroidManifest.xml`은 axmlllm에만 들어간다.

### 도구 간 연동 (`suite-bridge.js`)

| 출발 | 도착 | 동작 |
|---|---|---|
| axmlllm 매니페스트 | apkllm Install gate | `extractNativeLibs` · `targetSdk` · base APK 여부를 자동 입력 → native lib 검사 등 판정이 unknown에서 확정값으로. 미선언 값은 플랫폼 기본값(근거 표시), 정적으로 확정 불가한 값은 unknown 유지 |
| axmlllm Components 행 | dexllm 클래스 | 이름 클릭 → 해당 클래스 디컴파일 (activity-alias는 targetActivity). dex에 없으면 "매니페스트에만 선언됨" 경고 |
| axmlllm Permissions 행 | dexllm permissions 패널 | 이름 클릭 → 그 권한으로 필터, gated API별 호출자 펼침, 첫 호출 클래스로 이동. dex에서 호출이 없으면 "선언만 됨" 경고 |

## 구조

세 도구는 **git submodule**로 고정된다 — 이 저장소는 UI 셸(index.html)과 핀(커밋)만 가진다.

```
android-llm/
├── index.html      # 통합 콘솔 (탭 + iframe, lazy load·상태 유지)
├── suite-bridge.js # 도구 간 연동 (axmlllm → apkllm / dexllm)
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
