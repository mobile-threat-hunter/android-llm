// 엔진 파일 위치 — 서브모듈(각 도구의 웹 배포물)에서 쓰는 것은 엔진 빌드 산출물뿐이다:
//   dexllm  : dexllm-web/dexllm.{js,wasm}              (emscripten MODULARIZE, Node 지원)
//   apkllm  : apkllm-web/apkllm.{js,wasm}, domain.js   (같음 / domain.js는 apkllm Python 층의 JS 미러)
//   axmlllm : axmlllm-web/axmlllm-*.whl + Pyodide      (Pyodide는 Node 공식 지원)
// 도구의 페이지(index.html)·worker.js는 Node 쪽에서 쓰지 않는다.
// 버전 핀(Pyodide 버전·휠 이름): 배포 zip이면 engines/build.json(bundle.sh가 생성), 저장소면 axmlllm-web/index.html의 핀.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ENGINES_DIR = path.dirname(fileURLToPath(import.meta.url));
export const MCP_DIR = path.dirname(ENGINES_DIR);
export const ROOT = path.dirname(MCP_DIR);

export const asset = (tool, file) => path.join(ROOT, tool, file);

export const ENGINE_FILES = {
  "dexllm-web": ["dexllm.js", "dexllm.wasm", "mcp/ported.mjs"],
  "apkllm-web": ["apkllm.js", "apkllm.wasm", "domain.js"],
  "axmlllm-web": [],   // 휠 이름은 axmlBuild()가 정한다
};

let build = null;
export function axmlBuild() {
  if (build) return build;
  const pinned = path.join(ENGINES_DIR, "build.json");
  if (fs.existsSync(pinned)) build = JSON.parse(fs.readFileSync(pinned, "utf8")).axmlllm;
  else {
    const html = fs.readFileSync(asset("axmlllm-web", "index.html"), "utf8");
    const m = html.match(/window\.__AXMLLLM_BUILD = (\{[^\n]*\});/);
    if (!m) throw new Error("axmlllm-web/index.html: __AXMLLLM_BUILD pin not found");
    build = Function(`return ${m[1]}`)();
  }
  if (!build.pyodide || !build.wheel) throw new Error("axmlllm build pin: pyodide/wheel 없음");
  return build;
}
