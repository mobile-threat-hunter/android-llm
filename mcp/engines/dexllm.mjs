// dexllm 엔진 (Node) — dexllm.wasm을 직접 띄운다. 파일 하나 = WasmDexKit 하나(웹 worker의 sourceIdx -1과 같은 단일 소스).
import { createRequire } from "node:module";
import { asset } from "./assets.mjs";

const require = createRequire(import.meta.url);

export async function createDexllm({ log = () => {} } = {}) {
  const create = require(asset("dexllm-web", "dexllm.js"));
  // stdout에 찍히면 MCP stdio 프레이밍이 깨진다 — 전부 log(stderr)로
  const M = await create({ print: () => {}, printErr: (s) => log(String(s)), locateFile: (f) => asset("dexllm-web", f) });
  const VFS = "/input.bin";
  let dk = null;

  const describe = (err) => {
    const ptr = typeof err === "number" ? err : (err && typeof err.excPtr === "number") ? err.excPtr : null;
    if (ptr != null && typeof M.getExceptionMessage === "function") {
      try { const r = M.getExceptionMessage(ptr); const s = [].concat(r).filter(Boolean).join(": "); if (s) return new Error(s); } catch (_) { /* freed */ }
    }
    return err instanceof Error ? err : new Error(String(err && err.message || err));
  };
  const guard = (fn) => { try { return fn(); } catch (e) { throw describe(e); } };

  return {
    load(bytes) {
      return guard(() => {
        if (dk) { try { dk.delete(); } catch (_) { /* already gone */ } dk = null; }
        try { M.FS.unlink(VFS); } catch (_) { /* first load */ }
        M.FS.writeFile(VFS, bytes);
        dk = new M.WasmDexKit(VFS);
        const v = dk.listClasses(); const classes = v.size(); v.delete();
        return { dexCount: dk.dexCount(), classCount: classes };
      });
    },
    get dk() { return dk; },
    decompile: (cls) => guard(() => dk.decompileClassJava(cls)),
    iocs: () => guard(() => { const r = dk.extractIocs(); return { network: r.network, providers: r.providers }; }),
  };
}
