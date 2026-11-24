// axmlllm worker.js가 CDN에서 받는 Pyodide 파일을 로컬 캐시로 돌린다.
// 첫 실행에 한 번 받아 두면 이후는 오프라인으로 뜬다. 캐시: $ANDROID_LLM_CACHE 또는 ~/.cache/android-llm
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CDN = /^https:\/\/cdn\.jsdelivr\.net\/pyodide\/v([^/]+)\/full\/([^/]+)$/;

export function cacheRoot() {
  return process.env.ANDROID_LLM_CACHE ||
    path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "android-llm");
}

export async function resolvePyodideUrl(url) {
  const m = CDN.exec(url);
  if (!m) return null;
  const [, ver, file] = m;
  const dir = path.join(cacheRoot(), "pyodide-" + ver);
  const p = path.join(dir, file);
  if (fs.existsSync(p) && fs.statSync(p).size > 0) return p;
  fs.mkdirSync(dir, { recursive: true });
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Pyodide ${file} download failed: HTTP ${r.status} (${url})`);
  const tmp = p + ".part";
  fs.writeFileSync(tmp, new Uint8Array(await r.arrayBuffer()));
  fs.renameSync(tmp, p);
  return p;
}
