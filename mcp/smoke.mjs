// MCP 서버 스모크 테스트 — stdio로 server.mjs를 띄워 실제 MCP 클라이언트처럼 호출한다.
//   node smoke.mjs app.apk [out.json]
// 세 엔진이 모두 ready인지 확인하고, OS와 무관해야 하는 xref_* 결과를 out.json에 남긴다(CI가 OS 간 비교).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [apk, out] = process.argv.slice(2);
if (!apk) { console.error("usage: node smoke.mjs app.apk [out.json]"); process.exit(2); }

const server = path.join(path.dirname(fileURLToPath(import.meta.url)), "server.mjs");
const transport = new StdioClientTransport({
  command: process.execPath, args: [server],
  env: { ...process.env, ANDROID_LLM_BRIDGE: "off" }, stderr: "inherit",
});
const client = new Client({ name: "android-llm-smoke", version: "0" });
await client.connect(transport);

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content.map(c => c.text).join("");
  if (r.isError) throw new Error(`${name}: ${text}`);
  return JSON.parse(text);
};

const { tools } = await client.listTools();
for (const g of ["suite_", "dex_", "axml_", "apk_", "xref_"])
  if (!tools.some(t => t.name.startsWith(g))) throw new Error(`tools/list: ${g}* 없음`);

const st = await call("suite_load", { path: path.resolve(apk) });
const bad = Object.entries(st.tools).filter(([, s]) => s.state !== "ready");
if (bad.length) throw new Error("엔진 준비 실패: " + JSON.stringify(Object.fromEntries(bad)));

// 경로·크기처럼 OS나 체크아웃에 따라 달라지는 file 정보는 비교에서 뺀다
const strip = (o) => { if (o && typeof o === "object") { delete o.file; Object.values(o).forEach(strip); } return o; };
const result = {};
for (const n of ["xref_summary", "xref_manifest_gate", "xref_components", "xref_permissions", "xref_native"])
  result[n] = strip(await call(n));

if (out) fs.writeFileSync(out, JSON.stringify(result, null, 1) + "\n");
console.log(`ok — ${tools.length} tools, engines ready, ${Object.keys(result).length} xref results`);
await client.close();
