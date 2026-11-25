// 통합 MCP / CLI용 Node backend — 세 엔진(mcp/engines/)을 Node에서 직접 띄운다.
//   dexllm : dexllm.wasm          (engines/dexllm.mjs)
//   axmlllm: Pyodide + axmlllm 휠 (engines/axmlllm.mjs, Pyodide는 번들 또는 로컬 캐시)
//   apkllm : apkllm.wasm + domain.js (engines/apkllm.mjs)
// 서브모듈에서는 엔진 빌드 산출물만 쓴다 — 도구 페이지·worker.js에 의존하지 않는다.
// 파일 종류별 대상은 웹 셸(index.html targets())과 같다: ZIP → 셋 다, dex → dexllm, AXML → axmlllm.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./engines/assets.mjs";
import { createDexllm } from "./engines/dexllm.mjs";
import { createAxmlllm } from "./engines/axmlllm.mjs";
import { createApkllm } from "./engines/apkllm.mjs";

function readVersions() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, "versions.json"), "utf8")); } catch (_) { return null; }
}

function kindOf(b) {
  if (b[0] === 0x50 && b[1] === 0x4b) return "zip";
  if (b[0] === 0x64 && b[1] === 0x65 && b[2] === 0x78 && b[3] === 0x0a) return "dex";
  if (b[0] === 0x03 && b[1] === 0x00 && b[2] === 0x08 && b[3] === 0x00) return "axml";
  return "unknown";
}
const TARGETS = { zip: ["dexllm", "axmlllm", "apkllm"], dex: ["dexllm"], axml: ["axmlllm"], unknown: [] };

export async function createNodeBackend({ log = (s) => process.stderr.write(s + "\n") } = {}) {
  const state = {
    dexllm: { state: "none" }, axmlllm: { state: "none" }, apkllm: { state: "none" },
  };
  let file = null, gen = 0, apkReport = null;
  const eng = {};

  // ── 엔진 부팅 (병렬) ──
  const boot = {
    dexllm: createDexllm({ log: (s) => log("[dexllm] " + s) }),
    axmlllm: createAxmlllm({ log: (s) => log("[axmlllm] " + s) }),
    apkllm: createApkllm({ log: (s) => log("[apkllm] " + s) }),
  };
  for (const [k, p] of Object.entries(boot)) {
    p.then((e) => { eng[k] = e; }, (e) => { state[k] = { state: "error", detail: "engine: " + (e && e.message || e) }; });
  }
  const ready = (k) => boot[k];

  async function load({ path: p }) {
    if (!p) throw new Error("path가 필요합니다");
    const abs = path.resolve(p);
    const bytes = new Uint8Array(fs.readFileSync(abs));
    const kind = kindOf(bytes);
    const targets = TARGETS[kind];
    if (!targets.length) throw new Error(`${abs}: ZIP(APK) / dex / 바이너리 AXML이 아닙니다`);
    gen++;
    file = { name: path.basename(abs), path: abs, size: bytes.length, kind };
    apkReport = null;
    for (const k of Object.keys(state)) state[k] = targets.includes(k) ? { state: "loading" } : { state: "none", detail: `${kind} 파일 대상 아님` };
    const my = gen;
    const run = async (k, fn) => {
      try { await ready(k); const d = await fn(); if (my === gen) state[k] = { state: "ready", ...(d ? { detail: d } : {}) }; }
      catch (e) { if (my === gen) state[k] = { state: "error", detail: String(e && e.message || e) }; }
    };
    await Promise.all([
      targets.includes("dexllm") && run("dexllm", async () => {
        const r = (await ready("dexllm")).load(bytes);
        return `${r.dexCount} dex · ${r.classCount} classes`;
      }),
      targets.includes("axmlllm") && run("axmlllm", async () => {
        const o = (await ready("axmlllm")).open(file.name, bytes);
        return `axmlllm ${o.version}`;
      }),
      targets.includes("apkllm") && run("apkllm", async () => {
        const r = (await ready("apkllm")).load(bytes);
        if (my === gen) apkReport = r;
        return `${r.content && r.content.entry_count} entries`;
      }),
    ].filter(Boolean));
    return { file, tools: state };
  }

  const need = (k) => {
    if (!file) throw new Error("열린 파일이 없습니다 — suite_load path=<apk> 먼저");
    const s = state[k];
    if (s.state !== "ready") throw new Error(`${k}: ${s.state}${s.detail ? " — " + s.detail : ""}`);
  };

  return {
    kind: "node",
    log: [],
    file: () => file,
    token: () => gen,
    tools: () => state,
    versions: readVersions,
    ready: () => Promise.allSettled(Object.values(boot)),
    load,
    dex() {
      need("dexllm");
      const d = eng.dexllm;
      return { dk: d.dk, decompile: async (cls) => d.decompile(cls), iocs: async () => d.iocs() };
    },
    axml(msg) { need("axmlllm"); return eng.axmlllm.call(msg); },
    // 도구 목록은 파일 없이도 안다 — MCP tools/list가 첫 load 전에도 axml_*를 보이게
    axmlTools: () => eng.axmlllm ? eng.axmlllm.tools() : null,
    apkReport() { need("apkllm"); return apkReport; },
    apk(msg) { need("apkllm"); return eng.apkllm.call(msg); },
  };
}
