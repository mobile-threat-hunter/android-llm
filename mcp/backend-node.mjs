// 통합 MCP / CLI용 Node backend — 세 엔진을 서브모듈의 웹 배포물 그대로 띄운다.
//   dexllm : dexllm-web/mcp/engine.mjs (dexllm MCP가 쓰는 그 엔진 래퍼)
//   axmlllm: axmlllm-web/worker.js + Pyodide (workerhost.mjs, Pyodide는 로컬 캐시)
//   apkllm : apkllm-web/worker.js (workerhost.mjs)
// 파일 종류별 대상은 웹 셸(index.html targets())과 같다: ZIP → 셋 다, dex → dexllm, AXML → axmlllm.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hostWorker } from "./workerhost.mjs";
import { resolvePyodideUrl } from "./pyodide-cache.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sub = (d, f) => path.join(ROOT, d, f);

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
  const dexEngine = await import(sub("dexllm-web", "mcp/engine.mjs"));
  const state = {
    dexllm: { state: "none" }, axmlllm: { state: "none" }, apkllm: { state: "none" },
  };
  let file = null, gen = 0, apkReport = null, axTools = null;

  // ── 엔진 부팅 (병렬) ──
  const html = fs.readFileSync(sub("axmlllm-web", "index.html"), "utf8");
  const pin = html.match(/window\.__AXMLLLM_BUILD = (\{[^\n]*\});/);
  if (!pin) throw new Error("axmlllm-web/index.html: __AXMLLLM_BUILD pin not found");
  const axBuild = Function(`return ${pin[1]}`)();
  const ax = hostWorker(sub("axmlllm-web", "worker.js"), { resolveUrl: resolvePyodideUrl, log: (s) => log("[axmlllm] " + s) });
  const ap = hostWorker(sub("apkllm-web", "worker.js"), { log: (s) => log("[apkllm] " + s) });

  const boot = {
    dexllm: dexEngine.ensureEngine(),
    axmlllm: (async () => {
      const base = `https://cdn.jsdelivr.net/pyodide/v${axBuild.pyodide}/full/`;
      await ax.prefetch(base + "pyodide.js");
      await ax.prefetch(base + "pyodide.asm.js");
      await ax.call({ type: "init", build: axBuild });
      // 도구 목록은 파일 없이도 알 수 있다 — MCP tools/list가 첫 load 전에도 axml_*를 보이게
      axTools = JSON.parse(ax.eval(`py.runPython("import json\\nfrom axmlllm import tools as _t\\njson.dumps(_t.TOOL_DEFINITIONS)")`));
    })(),
    apkllm: ap.call({ type: "init", buildSha: "" }),
  };
  for (const [k, p] of Object.entries(boot)) p.catch((e) => { state[k] = { state: "error", detail: "engine: " + (e && e.message || e) }; });
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
        const r = await dexEngine.loadApk(abs);
        return `${r.dexCount} dex · ${r.classCount} classes`;
      }),
      targets.includes("axmlllm") && run("axmlllm", async () => {
        const o = await ax.call({ type: "open", name: file.name, bytes: bytes.slice() });
        if (o.tools) axTools = o.tools;
        return `axmlllm ${o.version}`;
      }),
      targets.includes("apkllm") && run("apkllm", async () => {
        const r = await ap.call({ type: "load", bytes: bytes.slice() });
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
      const dk = dexEngine.session.dk;
      return { dk, decompile: async (cls) => dk.decompileClassJava(cls),
        iocs: async () => { const r = dk.extractIocs(); return { network: r.network, providers: r.providers }; } };
    },
    axml(msg) { need("axmlllm"); return ax.call(msg); },
    axmlTools: () => axTools,
    apkReport() { need("apkllm"); return apkReport; },
    apk(msg) { need("apkllm"); return ap.call(msg); },
  };
}
