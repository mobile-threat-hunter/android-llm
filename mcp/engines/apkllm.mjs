// apkllm 엔진 (Node) — apkllm.wasm + domain.js를 직접 띄운다.
// 보고서는 엔진(C++)이 통째로 정하고 domain.js가 Python 층 몫(signing_block 이름·frosting 판정)을 더한다.
// load/gate의 호출 순서·인자는 apkllm-web 페이지가 쓰는 것과 같아야 한다 — 웹 터미널과 결과가 같아야 하므로
// (같은 APK로 xref_*·apk_* 비교: mcp.yml / CLAUDE.md).
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { asset } from "./assets.mjs";

const require = createRequire(import.meta.url);

export async function createApkllm({ log = () => {} } = {}) {
  require(asset("apkllm-web", "domain.js"));          // → globalThis.ApkllmDomain
  const D = globalThis.ApkllmDomain;
  const create = require(asset("apkllm-web", "apkllm.js"));
  const M = await create({ print: () => {}, printErr: (s) => log(String(s)), locateFile: (f) => asset("apkllm-web", f) });
  if (M.abi() !== D.ENGINE_ABI) throw new Error(`apkllm engine ABI ${M.abi()} ≠ domain.js ${D.ENGINE_ABI}`);
  const VFS = "/input.apk";
  let loaded = false;

  const describe = (err) => {
    const ptr = typeof err === "number" ? err : (err && typeof err.excPtr === "number") ? err.excPtr : null;
    if (ptr != null && typeof M.getExceptionMessage === "function") {
      try { const s = [].concat(M.getExceptionMessage(ptr)).filter(Boolean).join(": "); if (s) return new Error(s); } catch (_) { /* freed */ }
    }
    return err instanceof Error ? err : new Error(String(err && err.message || err));
  };
  const guard = (fn) => { try { return fn(); } catch (e) { throw describe(e); } };

  // 매니페스트와 무관한 읽기 — 파일당 한 번
  function load(bytes) {
    return guard(() => {
      const input = { md5: crypto.createHash("md5").update(bytes).digest("hex"),
                      sha256: crypto.createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
      try { M.FS.unlink(VFS); } catch (_) { /* first load */ }
      M.FS.writeFile(VFS, bytes);
      loaded = true;
      const tamper = M.tamperReport(VFS);
      const signing = D.signingBlock(M.signingBlockPairs(VFS, D.PAIRS_CAP, D.PAIR_IDS));
      const traces = M.buildTraces(VFS);
      const certs = M.signingCerts(VFS);
      const frosting = D.frostingView(M.frosting(VFS, D.frostingKeys()), signing, tamper);
      const content = M.contentMap(VFS, D.HEAD_BYTES);
      if (content.ok) {
        const heads = M.entryHeads(VFS, D.HEAD_BYTES, null);
        content.heads = content.entries.map((e, i) => {
          const h = heads.ok ? heads.entries[i] : undefined;
          return h && h.name === e.name && h.name_hex === e.name_hex
            ? { name: h.name, disposition: h.disposition, complete: h.complete, head: h.head } : null;
        });
      }
      return { tamper, signing, traces, certs, frosting, content, input };
    });
  }

  // 설치 게이트 — 매니페스트 사실(값)을 받아 엔진이 판정. 인자 검사는 apkllm Python(container._gate_args)과 같다.
  function gate(p) {
    if (!loaded) throw new Error("no APK loaded");
    const ps = p.pageSize ?? 4096, tsdk = p.targetSdk ?? null;
    if (!Number.isInteger(ps) || ps <= 0 || ps >= 2 ** 63 || !Number.isInteger(Math.log2(ps))) throw new Error("page_size must be a positive power of two < 2**63");
    if (tsdk !== null && !(Number.isInteger(tsdk) && tsdk >= -(2 ** 31) && tsdk < 2 ** 31)) throw new Error(`targetSdk must be an integer, got ${tsdk}`);
    const defaulted = p.apkRole === undefined;
    const args = [VFS, p.extractNativeLibs ?? null, tsdk, ps, defaulted ? "base" : p.apkRole, defaulted,
                  p.isolatedSplits ?? null, p.featureSplit ?? null, p.configForSplit ?? null];
    return guard(() => {
      const r = M.installGate(...args);
      if (r.ok) r.extract = M.extractPlan(...args, true);
      return r;
    });
  }

  // core/suite.mjs의 be.apk(msg)와 같은 메시지 모양(웹 쪽은 페이지 worker가 받는다)
  return {
    load,
    gate,
    async call(msg) {
      if (msg.type === "load") return load(msg.bytes);
      if (msg.type === "gate") return gate(msg);
      throw new Error("apkllm: unknown message " + msg.type);
    },
  };
}
