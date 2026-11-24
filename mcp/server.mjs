#!/usr/bin/env node
// android-llm 통합 MCP 서버 (stdio) — dexllm · axmlllm · apkllm 세 엔진 + 교차 분석(xref_*).
//   claude mcp add android-llm -- node /path/to/android-llm/mcp/server.mjs
// 도구 정의·결과는 core/suite.mjs 하나 — 웹 콘솔 터미널(terminal.js)과 같다.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema, ListPromptsRequestSchema, GetPromptRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createNodeBackend } from "./backend-node.mjs";
import { createSuite, renderResult } from "../core/suite.mjs";
import { startRelay, DEFAULT_PORT } from "./relay.mjs";
import fs from "node:fs";
import path from "node:path";

const INSTRUCTIONS = `android-llm — 한 APK를 세 엔진으로 동시에 본다: dexllm(dex 바이트코드), axmlllm(AndroidManifest·리소스를 기기 파서대로), apkllm(ZIP 컨테이너·서명·설치 게이트).

로컬 웹 콘솔(exe·serve.sh)이 열려 있으면 모든 호출은 그 브라우저 탭이 실행한다 — 분석가가 연 파일·화면 상태를 그대로 다루고, 호출과 결과가 콘솔 터미널에 보인다. suite_status의 executor로 확인(browser / node).

흐름: suite_load path=<apk> → xref_summary(세 도구 신호 + 교차 결과 요약) → 신호가 가리키는 쪽으로 좁힌다.
- dex_* : 코드에서 나온 사실(호출·문자열·IoC). 매니페스트를 모른다.
- axml_* : 기기가 실제로 읽는 매니페스트(선언 컴포넌트·권한·이상 징후·리소스).
- apk_* : 컨테이너 사실(변조 검사, 서명 블록·인증서, 엔트리 내용 분류, 설치 게이트).
- ui_* : 웹 콘솔 화면을 움직인다(클래스 열기·탭 전환) — 분석가가 로컬 콘솔을 열어 이 MCP에 연결했을 때만.
- xref_* : 도구 사이에 주고받는 정보 — 매니페스트 값→설치 게이트(xref_manifest_gate), 선언 컴포넌트↔dex 클래스(xref_components), 선언 권한↔호출 근거(xref_permissions), 포장된 .so↔로더(xref_native), 교환 기록(xref_log).

판단 규칙: 정적 분석은 실행을 증명하지 않는다. 선언됐지만 dex에 없는 컴포넌트, 선언 없이 호출되는 권한 API, 포장 라이브러리를 참조하지 않는 로더는 '단서'로 보고 해당 dex_* 도구로 근거를 확인한 뒤 결론을 낸다. 결과가 크면 limit/offset/필터로 좁힌다(응답 상한 200k자).`;

const be = await createNodeBackend();
const suite = createSuite(be);

// 로컬 웹 콘솔(exe·serve.sh)이 중계에 붙어 있으면 도구 호출을 그 브라우저 탭이 실행한다 —
// 분석가가 보는 화면·세션과 같은 것을 다루고, 호출과 결과가 그 탭의 터미널에 찍힌다.
// 탭이 없으면 Node 엔진(be)으로. ANDROID_LLM_BRIDGE=off 로 중계를 끈다.
const relay = process.env.ANDROID_LLM_BRIDGE === "off" ? null
  : startRelay({ port: Number(process.env.ANDROID_LLM_BRIDGE_PORT) || DEFAULT_PORT, log: (s) => process.stderr.write(s + "\n") });
const bridgeInfo = () => relay ? relay.info() : { relay: null, disabled: "ANDROID_LLM_BRIDGE=off" };

async function dispatch(name, args) {
  if (!relay || !relay.connected()) {
    const r = await suite.call(name, args);
    if (name === "suite_status") return { ...r, executor: "node", bridge: bridgeInfo() };
    return r;
  }
  if (name === "suite_load") {
    // 브라우저는 로컬 경로를 못 읽는다 — 바이트를 보내 화면에 연다. Node 쪽에도 같이 열어 탭이 닫혀도 이어서 쓴다.
    const abs = path.resolve(args.path || "");
    const bytes = fs.readFileSync(abs);
    const nodeLoad = suite.call("suite_load", { path: abs }).catch((e) => ({ error: String(e.message || e) }));
    const r = await relay.call("suite_load", { name: path.basename(abs), bytes_b64: bytes.toString("base64") });
    await nodeLoad;
    return { ...r, executor: "browser" };
  }
  const r = await relay.call(name, args);
  if (name === "suite_status") return { ...r, executor: "browser", bridge: bridgeInfo() };
  return r;
}
const server = new Server({ name: "android-llm", version: "0.1.0" },
  { capabilities: { tools: { listChanged: true }, prompts: {} }, instructions: INSTRUCTIONS });

server.setRequestHandler(ListToolsRequestSchema, async () => {
  await be.ready();
  return { tools: suite.list().map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) };
});
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  try {
    await be.ready();
    const r = await dispatch(req.params.name, req.params.arguments || {});
    return { content: [{ type: "text", text: renderResult(r) }] };
  } catch (e) {
    return { isError: true, content: [{ type: "text", text: String(e && e.message || e) }] };
  }
});
server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [{ name: "triage_apk", description: "세 엔진 + 교차 분석으로 APK를 증거 우선 분류", arguments: [{ name: "path", description: "APK 절대 경로", required: true }] }],
}));
server.setRequestHandler(GetPromptRequestSchema, async (req) => ({
  messages: [{ role: "user", content: { type: "text", text:
`android-llm 도구로 ${req.params.arguments?.path} 를 분석하라.
1. suite_load path=<위 경로>
2. xref_summary — signals를 먼저 읽는다.
3. 교차 결과를 확인: xref_manifest_gate(설치 판정·extractNativeLibs 불일치), xref_components(missing/mismatch/undeclared), xref_permissions(undeclared·declared_only), xref_native(hidden ELF·외부 로더).
4. axml_manifest_anomalies, apk_tamper, apk_signing으로 컨테이너·매니페스트 이상을 본다.
5. 각 신호가 가리키는 클래스를 dex_decompile_class(창 단위)와 dex_callers_of_method / dex_usages_of_string으로 확인해 트리거 경로를 세운다.
6. 보고: 행위마다 무엇을·어떤 트리거로·근거(도구 결과)를. 도달 경로가 확인된 것과 존재만 하는 코드를 구분하고, IoC 목록과 종합 판정으로 끝낸다.` } }],
}));

await server.connect(new StdioServerTransport());
process.stderr.write("android-llm MCP server ready (stdio)\n");
