# Android LLM Suite

dexllm-web(DEX) · axmlllm-web(AXML/Manifest) · apkllm-web(APK 컨테이너)을 한 콘솔에서 쓰는 통합 웹 페이지.

## 구조

세 도구는 **git submodule**로 고정된다 — 이 저장소는 UI 셸(index.html)과 핀(커밋)만 가진다.

```
android-llm/
├── index.html      # 통합 콘솔 (탭 + iframe, lazy load·상태 유지)
├── dexllm-web/     # submodule → github.com/mobile-threat-hunter/dexllm-web
├── axmlllm-web/    # submodule → github.com/mobile-threat-hunter/axmlllm-web
├── apkllm-web/     # submodule → github.com/mobile-threat-hunter/apkllm-web
├── update.sh       # 서브모듈 최신화 + versions.json + 핀 커밋
└── serve.sh        # 로컬 서빙 (기본 http://localhost:8800)
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

## 주의

- 서브모듈 안에서 직접 개발하지 말 것 — 각 도구는 자기 저장소(~/Project/dexllm-web 등)에서 개발하고 push한 뒤 여기서 `./update.sh`.
- 통합 셸은 각 도구의 `index.html`을 same-origin iframe으로 올리므로, 도구 쪽 내부 변경은 셸 수정 없이 그대로 반영된다.
