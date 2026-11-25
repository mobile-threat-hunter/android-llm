// Pyodide 파일 준비 — axmlllm 엔진이 Node에서 loadPyodide({indexURL})로 띄울 디렉터리를 돌려준다.
//   1) 배포 zip: mcp/pyodide-<ver>/ (bundle.sh가 넣음) — 첫 실행도 오프라인
//   2) 그 외: $ANDROID_LLM_CACHE 또는 ~/.cache/android-llm/pyodide-<ver>/ — 없는 파일만 jsdelivr에서 한 번 받는다
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MCP_DIR } from "./assets.mjs";

export const PYODIDE_CORE = ["pyodide.js", "pyodide.asm.js", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"];

export function cacheRoot() {
  return process.env.ANDROID_LLM_CACHE ||
    path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "android-llm");
}

// 코어 + micropip 휠(lock에 적힌 이름)
function needed(dir) {
  const lock = path.join(dir, "pyodide-lock.json");
  const mp = fs.existsSync(lock) ? JSON.parse(fs.readFileSync(lock, "utf8")).packages.micropip.file_name : null;
  return mp ? [...PYODIDE_CORE, mp] : PYODIDE_CORE;
}
const complete = (dir) => needed(dir).every(f => fs.existsSync(path.join(dir, f)) && fs.statSync(path.join(dir, f)).size > 0);

export async function ensurePyodide(ver, { log = () => {} } = {}) {
  const bundled = path.join(MCP_DIR, "pyodide-" + ver);
  if (fs.existsSync(bundled) && complete(bundled)) return bundled;
  const dir = path.join(cacheRoot(), "pyodide-" + ver);
  if (fs.existsSync(dir) && complete(dir)) return dir;
  fs.mkdirSync(dir, { recursive: true });
  const cdn = `https://cdn.jsdelivr.net/pyodide/v${ver}/full/`;
  // lock을 먼저 받아야 micropip 휠 이름을 안다
  for (const f of ["pyodide-lock.json", ...PYODIDE_CORE.filter(f => f !== "pyodide-lock.json")]) await fetchTo(cdn, dir, f, log);
  for (const f of needed(dir)) await fetchTo(cdn, dir, f, log);
  return dir;
}

async function fetchTo(cdn, dir, file, log) {
  const p = path.join(dir, file);
  if (fs.existsSync(p) && fs.statSync(p).size > 0) return;
  log(`downloading Pyodide ${file}…`);
  const r = await fetch(cdn + file);
  if (!r.ok) throw new Error(`Pyodide ${file} download failed: HTTP ${r.status} (${cdn + file})`);
  const tmp = p + ".part";
  fs.writeFileSync(tmp, new Uint8Array(await r.arrayBuffer()));
  fs.renameSync(tmp, p);
}
