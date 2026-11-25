// axmlllm 엔진 (Node) — Pyodide를 Node에서 직접 띄우고 axmlllm 휠을 설치한다(Pyodide의 Node 공식 경로, Web Worker 흉내 없음).
// PY_SETUP은 axmlllm-web 페이지가 쓰는 보조 함수와 같은 일을 한다(트리 전체·컴포넌트+<application>+target_activity·클래스 이름).
// 웹 터미널은 페이지 worker의 같은 함수를 쓰므로 결과가 같아야 한다 — 같은 APK로 xref_* 비교(mcp.yml / CLAUDE.md).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { asset, axmlBuild } from "./assets.mjs";
import { ensurePyodide } from "./pyodide.mjs";

const require = createRequire(import.meta.url);

const PY_SETUP = `
import json
import axmlllm
from axmlllm import tools
from axmlllm import format as _fmt
from axmlllm.manifest import Manifest

_m = None

def _open(path, is_apk):
    global _m
    if is_apk:
        _m = Manifest.from_apk(path)
    else:
        with open(path, "rb") as f:
            _m = Manifest.from_axml(f.read())
    return json.dumps({"version": axmlllm.__version__})

def _tool_defs():
    return json.dumps(tools.TOOL_DEFINITIONS)

# sparse_tree 전체 — get_manifest_tree 도구의 LLM 응답 예산 없이
def _tree():
    if _m is None:
        return json.dumps({"error": "no APK loaded"})
    return json.dumps(_fmt.sparse_tree(_m), default=str)

# 기기가 만드는 클래스 이름(ParsingUtils.buildClassName): ".Main"/"Main" → 패키지 접두
def _class_names(names_json):
    from axmlllm.manifest.dispatch import _class_name
    pkg = _m.package if _m is not None else None
    return json.dumps([_class_name(pkg, n) if pkg and isinstance(n, str) and n else n
                       for n in json.loads(names_json)])

# list_components + 맨 앞에 <application> 요소들 + <activity-alias>마다 target_activity(기기가 읽는 대로)
def _components(limit):
    from axmlllm.manifest.dispatch import _class_name
    from axmlllm.manifest.model import _COMPONENT_TAGS
    from axmlllm.manifest.reads import non_resource_string
    from axmlllm.manifest.styleables import ATTR
    out = tools.execute("list_components", {"limit": limit}, _m)
    if _m is None or out.get("error"):
        return json.dumps(out, default=str)
    elems = [e for e in _m.iter() if e.tag in _COMPONENT_TAGS][out.get("offset", 0):]
    for item, e in zip(out.get("items", []), elems):
        if e.tag != "activity-alias" or item.get("tag") != e.tag or item.get("line") != e.line:
            continue
        raw = non_resource_string(e, ATTR["targetActivity"])
        if raw is not None and not isinstance(raw, str):
            item["target_activity"] = None
            item["target_activity_why"] = getattr(raw, "why", str(raw))
            continue
        item["target_activity"] = _class_name(_m.package, raw) if raw and _m.package else raw
    if out.get("offset", 0) == 0:
        apps = [_m._entry(e, {"application"}) for e in _m.iter() if e.tag == "application"]
        out["items"] = apps + out.get("items", [])
        out["total"] = out.get("total", 0) + len(apps)
    return json.dumps(out, default=str)

def _tool(name, args_json):
    if _m is None:
        return json.dumps({"error": "no APK loaded"})
    return json.dumps(tools.execute(name, json.loads(args_json), _m), default=str)
`;

export async function createAxmlllm({ log = () => {} } = {}) {
  const build = axmlBuild();
  const dir = await ensurePyodide(build.pyodide, { log });
  const { loadPyodide } = require(path.join(dir, "pyodide.js"));
  // stdout은 MCP stdio 프레이밍 — Python print도 log(stderr)로
  const py = await loadPyodide({ indexURL: dir + path.sep, stdout: (s) => log(s), stderr: (s) => log(s) });
  await py.loadPackage("micropip", { messageCallback: () => {}, errorCallback: (s) => log(s) });
  log(`loading ${build.wheel}…`);
  py.FS.writeFile(`/tmp/${build.wheel}`, fs.readFileSync(asset("axmlllm-web", build.wheel)));
  await py.pyimport("micropip").install(`emfs:/tmp/${build.wheel}`);
  py.runPython(PY_SETUP);
  const fn = (name, ...a) => JSON.parse(py.globals.get(name)(...a));
  const toolDefs = fn("_tool_defs");

  function open(name, bytes) {
    const isApk = bytes[0] === 0x50 && bytes[1] === 0x4b;   // 매니페스트만(바이너리 AXML)이면 zip이 아니다
    const work = "/work";
    try { py.FS.mkdirTree(work); } catch (_) { /* exists */ }
    for (const f of py.FS.readdir(work)) if (f !== "." && f !== "..") py.FS.unlink(`${work}/${f}`);
    const p = `${work}/input${isApk ? ".apk" : ".xml"}`;
    py.FS.writeFile(p, bytes);
    return { ...fn("_open", p, isApk), tools: toolDefs, isApk, name };
  }

  return {
    tools: () => toolDefs,
    open,
    // core/suite.mjs의 be.axml(msg)와 같은 메시지 모양(웹 쪽은 페이지 worker가 받는다)
    async call(msg) {
      switch (msg.type) {
        case "open": return open(msg.name, msg.bytes);
        case "tool": return fn("_tool", msg.name, JSON.stringify(msg.args || {}));
        case "tree": return fn("_tree");
        case "components": return fn("_components", msg.limit);
        case "classnames": return fn("_class_names", JSON.stringify(msg.names));
        default: throw new Error("axmlllm: unknown message " + msg.type);
      }
    },
  };
}
