// 도구의 worker.js를 Node에서 그대로 돌리는 최소 Web Worker 호스트.
// 웹 페이지와 같은 파일·같은 메시지 프로토콜을 쓰므로 MCP 결과가 웹 콘솔과 같은 엔진 경로에서 나온다.
// worker마다 vm context 하나 — 각 worker.js의 최상위 let(Module, py …)이 서로 섞이지 않는다.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

// url → 로컬 파일 경로. 상대 URL은 worker.js 디렉터리 기준, 절대 URL은 resolveUrl 훅이 정한다.
function makeResolver(dir, resolveUrl) {
  return async (url) => {
    const u = String(url).split(/[?#]/)[0];
    if (u.startsWith("file://")) return decodeURIComponent(new URL(u).pathname);
    if (/^[a-z]+:\/\//i.test(u)) {
      const p = resolveUrl ? await resolveUrl(u) : null;
      if (!p) throw new Error(`worker host: no local mapping for ${u}`);
      return p;
    }
    return path.join(dir, u);
  };
}

export function hostWorker(workerFile, { resolveUrl, log = () => {} } = {}) {
  const dir = path.dirname(workerFile);
  const resolve = makeResolver(dir, resolveUrl);
  const pending = new Map();
  let nextId = 1;

  const ctx = {
    console: { log: (...a) => log(a.join(" ")), warn: (...a) => log(a.join(" ")), error: (...a) => log(a.join(" ")), info: () => {}, debug: () => {} },
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    TextEncoder, TextDecoder, URL, URLSearchParams, atob, btoa, Blob, Response, Headers,
    crypto: globalThis.crypto, performance, structuredClone,
  };
  ctx.location = new URL("file://" + workerFile);   // Pyodide: new URL(x, location)
  ctx.postMessage = (data) => {
    if (data && data.id != null && pending.has(data.id) && ("ok" in data)) {
      const p = pending.get(data.id);
      pending.delete(data.id);
      if (data.ok) p.resolve(data.result); else p.reject(new Error(data.error));
    } else if (data && data.type === "progress") log(String(data.text));
  };
  // importScripts는 동기다 — resolveUrl이 미리 받아둔 파일만 읽는다(prefetch 참조).
  const syncMap = new Map();
  ctx.importScripts = (...urls) => {
    for (const url of urls) {
      const u = String(url).split(/[?#]/)[0];
      const p = /^[a-z]+:\/\//i.test(u) ? syncMap.get(u) : path.join(dir, u);
      if (!p) throw new Error(`worker host: importScripts ${u} was not prefetched`);
      vm.runInContext(fs.readFileSync(p, "utf8"), ctx, { filename: p });
    }
  };
  ctx.fetch = async (url) => {
    const p = await resolve(url);
    const buf = fs.readFileSync(p);
    const type = p.endsWith(".wasm") ? "application/wasm" : "application/octet-stream";
    return new Response(buf, { status: 200, headers: { "content-type": type } });
  };
  vm.createContext(ctx);
  // Pyodide는 self instanceof WorkerGlobalScope로 Web Worker 환경을 판별한다
  vm.runInContext("class WorkerGlobalScope {}; Object.setPrototypeOf(globalThis, WorkerGlobalScope.prototype);" +
                  "globalThis.WorkerGlobalScope = WorkerGlobalScope; globalThis.self = globalThis;", ctx);
  vm.runInContext(fs.readFileSync(workerFile, "utf8"), ctx, { filename: workerFile });

  return {
    // importScripts에 쓰일 절대 URL을 미리 로컬 파일로 받아 둔다
    async prefetch(url) { const u = url.split(/[?#]/)[0]; syncMap.set(u, await resolve(u)); },
    call(msg, transfer) {
      const id = nextId++;
      return new Promise((res, rej) => {
        pending.set(id, { resolve: res, reject: rej });
        ctx.onmessage({ data: { ...msg, id } });
      });
    },
    eval(code) { return vm.runInContext(code, ctx); },
  };
}
