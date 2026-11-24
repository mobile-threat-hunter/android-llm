// 한 줄 명령 → 도구 호출. 웹 터미널과 Node CLI(mcp/cli.mjs)가 같은 문법을 쓴다.
//
//   <tool> [positional…] [key=value…]        예) dex_decompile_class Lcom/a/B; max_lines=80
//   <group> <tool>                            예) dex decompile_class com.a.B   (= dex_decompile_class)
//   <suffix>                                  예) summary                     (= xref_summary, 유일할 때)
//   <tool> {"json": "args"}                   인자를 JSON 객체로
// 값은 도구 스키마 타입에 맞춰 바꾼다(integer/boolean/null). 문자열 인자는 숫자처럼 보여도 문자열.
// 위치 인자는 필수 인자부터, 그다음 선언 순서로 채운다. 따옴표 '…' "…" 와 \ 이스케이프 지원.

export function tokenize(line) {
  const out = []; let cur = null, q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === "\\" && q === '"' && i + 1 < line.length) { cur += line[++i]; continue; }
      if (c === q) { q = null; continue; }
      cur += c; continue;
    }
    if (c === "'" || c === '"') { q = c; cur ??= ""; continue; }
    if (c === "\\" && i + 1 < line.length) { cur = (cur ?? "") + line[++i]; continue; }
    if (/\s/.test(c)) { if (cur !== null) { out.push(cur); cur = null; } continue; }
    cur = (cur ?? "") + c;
  }
  if (q) throw new Error("따옴표가 닫히지 않았습니다");
  if (cur !== null) out.push(cur);
  return out;
}

export function resolveTool(tools, words) {
  const names = tools.map(t => t.name);
  if (names.includes(words[0])) return { name: words[0], rest: words.slice(1) };
  if (words.length > 1 && names.includes(words[0] + "_" + words[1])) return { name: words[0] + "_" + words[1], rest: words.slice(2) };
  const suf = names.filter(n => n.endsWith("_" + words[0]));
  if (suf.length === 1) return { name: suf[0], rest: words.slice(1) };
  if (suf.length > 1) throw new Error(`'${words[0]}'은 여러 도구에 해당합니다: ${suf.join(", ")}`);
  const pre = names.filter(n => n.startsWith(words[0]));
  if (pre.length === 1) return { name: pre[0], rest: words.slice(1) };
  throw new Error(`알 수 없는 명령: ${words[0]} — help로 목록 보기`);
}

function coerce(v, schema) {
  const types = [].concat((schema && schema.type) || "string");
  if (v === "null" && types.includes("null")) return null;
  if (types.includes("integer") || types.includes("number")) {
    const n = Number(v);
    if (v !== "" && Number.isFinite(n)) return n;
  }
  if (types.includes("boolean")) {
    if (/^(true|yes|on|1)$/i.test(v)) return true;
    if (/^(false|no|off|0)$/i.test(v)) return false;
  }
  if (types.includes("object") || types.includes("array")) { try { return JSON.parse(v); } catch (_) { /* 문자열로 */ } }
  return v;
}

export function parseCommand(tools, line) {
  const words = tokenize(line.trim());
  if (!words.length) return null;
  const { name, rest } = resolveTool(tools, words);
  const tool = tools.find(t => t.name === name);
  const props = (tool.inputSchema && tool.inputSchema.properties) || {};
  const order = [...(tool.inputSchema.required || []), ...Object.keys(props).filter(k => !(tool.inputSchema.required || []).includes(k))];
  const args = {};
  const joined = rest.join(" ").trim();
  if (joined.startsWith("{")) return { name, args: JSON.parse(joined) };
  const pos = [];
  for (const w of rest) {
    const m = /^([A-Za-z_][\w-]*)=(.*)$/s.exec(w);
    if (m && (m[1] in props || m[1].replace(/-/g, "_") in props)) {
      const k = m[1] in props ? m[1] : m[1].replace(/-/g, "_");
      args[k] = coerce(m[2], props[k]);
    } else pos.push(w);
  }
  const free = order.filter(k => !(k in args));
  pos.forEach((w, i) => {
    const k = free[i];
    if (!k) throw new Error(`${name}: 인자가 너무 많습니다 ('${w}')`);
    args[k] = coerce(w, props[k]);
  });
  for (const r of tool.inputSchema.required || []) if (!(r in args)) throw new Error(`${name}: ${r} 인자가 필요합니다 — help ${name}`);
  return { name, args };
}

const GROUP_TITLE = { suite: "세션", dex: "dexllm (dex 바이트코드)", axml: "axmlllm (매니페스트·리소스)", apk: "apkllm (컨테이너·서명·설치 게이트)", xref: "교차 분석 (도구 사이에 주고받는 정보)", ui: "웹 콘솔 화면 (브라우저 탭이 실행할 때)" };

export function helpText(tools, name) {
  if (name) {
    const { name: n } = resolveTool(tools, [name]);
    const t = tools.find(x => x.name === n);
    const props = t.inputSchema.properties || {};
    const req = new Set(t.inputSchema.required || []);
    const lines = [`${t.name} — ${t.description}`, ""];
    const ks = Object.keys(props);
    if (!ks.length) lines.push("  (인자 없음)");
    for (const k of ks) {
      const p = props[k];
      const ty = [].concat(p.type || "any").join("|") + (p.enum ? ` ∈ {${p.enum.map(String).join(", ")}}` : "");
      lines.push(`  ${req.has(k) ? "*" : " "}${k}  ${ty}${p.default !== undefined ? ` = ${JSON.stringify(p.default)}` : ""}${p.description ? "  — " + p.description : ""}`);
    }
    return lines.join("\n");
  }
  const lines = [];
  for (const g of ["suite", "xref", "dex", "axml", "apk", "ui"]) {
    const ts = tools.filter(t => t.group === g);
    if (!ts.length) continue;
    lines.push(`■ ${GROUP_TITLE[g]}`);
    for (const t of ts) lines.push(`  ${t.name.padEnd(30)} ${t.description.split(/(?<=[.:])\s/)[0].slice(0, 90)}`);
    lines.push("");
  }
  lines.push("문법: <명령> [위치인자…] [key=value…]   ·   help <명령>   ·   'dex decompile_class X' = 'dex_decompile_class X'   ·   접미어만(summary)도 됨");
  return lines.join("\n");
}
