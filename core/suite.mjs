// android-llm 통합 도구 세트 — MCP 서버(Node)와 웹 터미널(브라우저)이 같은 정의·같은 결과를 쓴다.
//
//   suite_*  세션·상태          dex_*  dexllm 엔진       axml_*  axmlllm 도구(엔진이 내보내는 목록 그대로)
//   apk_*    apkllm 엔진        xref_* 도구 사이에 주고받는 정보(매니페스트→게이트, 컴포넌트↔클래스,
//                                     권한↔호출 근거, 네이티브 라이브러리↔로더, 교환 기록)
//
// 엔진 접근은 backend가 맡는다(mcp/backend-node.mjs, terminal.js의 웹 backend):
//   kind                   "node" | "web"
//   file()                 { name, size? } | null           — 지금 세 도구에 열린 파일
//   token()                값이 바뀌면 캐시를 버린다(새 파일·새 dump)
//   load({ path })         파일 열기 (node: 경로, web: 파일 선택 창)
//   tools()                { dexllm|axmlllm|apkllm: { state: "ready"|"loading"|"error"|"none", detail? } }
//   dex()                  { dk, decompile(cls) → Promise<string>, iocs() → Promise<{network, providers}> }
//   axml(msg)              axmlllm worker.js 메시지 ({type:"tool"|"components"|"tree"|"classnames", …})
//   axmlTools()            axmlllm TOOL_DEFINITIONS ([{name, description, input_schema}])
//   apkReport()            apkllm worker "load" 결과 { tamper, signing, traces, certs, frosting, content, input }
//   apk(msg)               apkllm worker.js 메시지 ({type:"gate", …})
//   log                    교환 기록 배열 (웹에서는 suite-bridge가 같은 배열에 쌓는다)
import { descToJava, origDottedToDesc, computePerms, computeComponents, computeCaps }
  from "../dexllm-web/mcp/ported.mjs";
import { manifestFacts, gateParams, FACT_LABELS } from "./facts.mjs";

export const TEXT_CAP = 200_000;
const DEX_ONLY = " (dex 바이트코드만 봄 — 매니페스트 사실은 axml_*/xref_*)";

function vecToArray(v) {
  try { const out = []; const n = v.size(); for (let i = 0; i < n; i++) out.push(v.get(i)); return out; }
  finally { v.delete(); }
}
const descOf = (cls) => "L" + cls.replace(/\./g, "/") + ";";
const page = (arr, offset = 0, limit = 200) => ({
  total: arr.length, offset, count: Math.min(Math.max(arr.length - offset, 0), limit),
  next_offset: offset + limit < arr.length ? offset + limit : null,
  items: arr.slice(offset, offset + limit),
});
const int = (d, min, max) => ({ type: "integer", ...(d !== undefined ? { default: d } : {}), ...(min !== undefined ? { minimum: min } : {}), ...(max !== undefined ? { maximum: max } : {}) });
const str = (description) => ({ type: "string", description });
const bool = (d, description) => ({ type: "boolean", default: d, ...(description ? { description } : {}) });
const tri = (description) => ({ type: ["boolean", "null"], description });

// 컴포넌트 선언 tag → dex의 상위 클래스 판정(ported COMPONENT_BASES kind) 중 맞는 것
const TAG_KINDS = {
  application: ["application"],
  activity: ["activity"], "activity-alias": ["activity"],
  service: ["service", "accessibility", "notif-listener", "vpn", "job"],
  receiver: ["receiver", "device-admin"],
  provider: ["provider"],
};
const LOADERS = [
  "Ljava/lang/System;->loadLibrary(Ljava/lang/String;)V",
  "Ljava/lang/System;->load(Ljava/lang/String;)V",
  "Ljava/lang/Runtime;->loadLibrary(Ljava/lang/String;)V",
  "Ljava/lang/Runtime;->load(Ljava/lang/String;)V",
];

export function createSuite(be) {
  // ── 캐시: backend.token()이 바뀌면 전부 버린다 ──
  let token = null;
  const cache = new Map();
  function memo(key, fn) {
    const t = be.token();
    if (t !== token) { cache.clear(); token = t; }
    if (!cache.has(key)) {
      const p = Promise.resolve().then(fn);
      cache.set(key, p);
      p.catch(() => { if (cache.get(key) === p) cache.delete(key); });
    }
    return cache.get(key);
  }
  function exchange(from, to, what, data) {
    be.log.push({ t: new Date().toISOString(), via: be.kind === "node" ? "mcp" : "terminal", from, to, what, data });
    if (be.log.length > 500) be.log.splice(0, be.log.length - 500);
  }

  // ── dex ──
  const D = () => be.dex();
  const dk = () => D().dk;
  const classList = () => memo("dex.classes", () => vecToArray(dk().listClasses()));
  const classSet = () => memo("dex.classSet", async () => new Set(await classList()));
  const stringList = () => memo("dex.strings", () => vecToArray(dk().listValueStrings()));
  const perms = (appOnly = true) => memo("dex.perms." + appOnly, () => computePerms(dk(), appOnly));
  const comps = () => memo("dex.comps", () => computeComponents(dk()));
  const compIndex = () => memo("dex.compIndex", async () => {
    const m = new Map();
    for (const g of await comps()) for (const c of g.classes) m.set(c, g.kind);
    return m;
  });
  const caps = (appOnly = true) => memo("dex.caps." + appOnly, () => computeCaps(dk(), appOnly));
  const iocs = () => memo("dex.iocs", () => D().iocs());
  const symCorpus = (kind) => memo("dex.sym." + kind, async () =>
    kind === "class" ? classList() : kind === "string" ? stringList()
      : vecToArray(kind === "method" ? dk().listAllMethodDescriptors() : dk().listAllFieldDescriptors()));
  async function resolveClass(input) {
    const set = await classSet();
    if (set.has(input)) return input;
    const dotted = (input.startsWith("L") && input.endsWith(";")) ? descToJava(input) : input;
    const o = origDottedToDesc(dotted);
    if (o && set.has(o)) return o;
    const d = descOf(dotted);
    if (set.has(d)) return d;
    throw new Error("class not found in dex: " + input);
  }

  // ── axml ──
  const axTool = async (name, args = {}) => {
    const r = await be.axml({ type: "tool", name, args });
    if (r && r.error) throw new Error(`axmlllm ${name}: ${r.error}`);
    return r;
  };
  async function axAll(name, extra = {}) {   // 페이지를 끝까지 넘겨 items 전부
    const items = []; let offset = 0;
    for (;;) {
      const r = await axTool(name, { ...extra, offset, limit: 500 });
      items.push(...(r.items || []));
      if (r.next_offset == null || r.next_offset <= offset) return { ...r, items };
      offset = r.next_offset;
    }
  }
  const axManifest = () => memo("axml.manifest", () => axTool("analyze_manifest"));
  const axTree = () => memo("axml.tree", () => be.axml({ type: "tree" }));
  const axPerms = () => memo("axml.perms", () => axAll("list_permissions"));
  // axmlllm 페이지와 같은 경로: worker "components"(application 먼저, alias에 target_activity) →
  // "classnames"로 기기가 만드는 클래스 이름(.Main → pkg.Main)
  const axComps = () => memo("axml.comps", async () => {
    // worker "components"는 limit만 받는다(offset 없음) — 한 번에 넉넉히
    const r = await be.axml({ type: "components", limit: 100000 });
    if (r.error) throw new Error("axmlllm components: " + r.error);
    const items = r.items || [];
    if (items.length) {
      const full = await be.axml({ type: "classnames", names: items.map(i => i.name) });
      items.forEach((i, k) => { if (full[k] !== i.name) { i.declared_name = i.name; i.name = full[k]; } });
    }
    return items;
  });
  const facts = () => memo("axml.facts", async () => {
    const f = manifestFacts(await axTree());
    if (!f) throw new Error("axmlllm: 매니페스트 트리가 없습니다(파싱 실패?)");
    return f;
  });

  // ── apk ──
  const apkRep = () => { const r = be.apkReport(); if (!r) throw new Error("apkllm: 보고서가 없습니다"); return r; };
  const apkGate = (p) => memo("apk.gate." + JSON.stringify(p), async () => {
    const g = await be.apk({ type: "gate", ...p });
    if (g && g.ok === false && g.error) throw new Error("apkllm gate: " + g.error);
    return g;
  });
  const factGate = (pageSize = 4096) => memo("xref.factGate." + pageSize, async () => {
    const f = await facts();
    return { f, params: gateParams(f, pageSize), gate: await apkGate(gateParams(f, pageSize)) };
  });
  const gateSummary = (g) => {
    const { entries, extract, exceptions, ...rest } = g;
    return {
      ...rest,
      exceptions: { total: (exceptions || []).length, items: (exceptions || []).slice(0, 50) },
      extract: extract ? { summary: extract.summary, checks: extract.checks } : null,
    };
  };

  // ── 도구 정의 ──
  const T = [];
  const def = (name, group, description, properties, run, required) =>
    T.push({ name, group, description, inputSchema: { type: "object", properties: properties || {}, ...(required ? { required } : {}) }, run });

  // suite
  def("suite_status", "suite", "열린 파일과 세 도구(dexllm·axmlllm·apkllm)의 준비 상태.", {}, async () => ({
    backend: be.kind, file: be.file(), tools: be.tools(), versions: be.versions ? be.versions() : undefined,
  }));
  def("suite_load", "suite",
    "APK(또는 dex / 바이너리 AndroidManifest.xml)를 세 도구에 한 번에 연다. 이전 세션은 초기화된다. " +
    "웹 터미널에서는 path 없이 부르면 파일 선택 창이 열린다.",
    { path: str("로컬 파일 절대 경로 (MCP·CLI)") },
    async (a) => be.load(a), be.kind === "node" ? ["path"] : undefined);

  // dex — dexllm MCP(dexllm-web/mcp/server.mjs)와 같은 의미·같은 엔진 호출
  def("dex_list_classes", "dex", "dex 클래스 descriptor 목록(페이지)." + DEX_ONLY,
    { package_prefix: str('descriptor 접두어, 예: "Lcom/example/"'), offset: int(0, 0), limit: int(200, 1, 500) },
    async ({ package_prefix, offset = 0, limit = 200 }) => {
      const all = (await classList()).filter(c => !package_prefix || c.startsWith(package_prefix));
      return page(all, offset, limit);
    });
  def("dex_decompile_class", "dex",
    "클래스 하나를 Java로 디컴파일(DAD). descriptor 또는 점 표기 FQN. 큰 클래스는 start_line/max_lines로 창을 옮긴다(디컴파일은 캐시).",
    { class_desc: str("class descriptor 또는 FQN"), start_line: int(1, 1), max_lines: int(400, 1, 2000) },
    async ({ class_desc, start_line = 1, max_lines = 400 }) => {
      const cls = await resolveClass(class_desc);
      const text = await memo("dex.java." + cls, () => D().decompile(cls));
      const lines = String(text).split("\n");
      const from = Math.min(start_line - 1, Math.max(lines.length - 1, 0));
      const win = lines.slice(from, from + max_lines);
      return { text: JSON.stringify({ class: cls, totalLines: lines.length, window: { start: from + 1, end: from + win.length } }) + "\n" + win.join("\n") };
    }, ["class_desc"]);
  def("dex_search_symbols", "dex",
    "심볼 부분 문자열 검색(대소문자 무시): class / method / field / string. 심볼은 java(a.b.C.m)·smali(La/b/C;->m) 표기 모두 가능.",
    { query: str("검색어"), kind: { type: "string", enum: ["class", "method", "field", "string"], default: "class" }, limit: int(200, 1, 600) },
    async ({ query, kind = "class", limit = 200 }) => {
      const q = String(query).toLowerCase();
      const norm = (s) => s.replace(/;?->/g, ".").replace(/[/$]/g, ".");
      const qn = norm(q);
      const hit = kind === "string" ? (s) => s.toLowerCase().includes(q) : (s) => norm(s.toLowerCase()).includes(qn);
      const out = []; let truncated = false;
      for (const s of await symCorpus(kind)) {
        if (!hit(s)) continue;
        if (out.length >= limit) { truncated = true; break; }
        out.push(s);
      }
      return { kind, count: out.length, truncated, results: out };
    }, ["query"]);
  def("dex_callers_of_method", "dex", '메서드를 호출하는 모든 위치("La/b/C;->m(..)R"), 바이트코드 offset 포함.',
    { method_desc: str("메서드 descriptor"), limit: int(200, 1, 1000) },
    async ({ method_desc, limit = 200 }) => {
      const sites = dk().findCallSitesWithOffset(method_desc);
      return { total: sites.length, truncated: sites.length > limit,
        callSites: sites.slice(0, limit).map(s => ({ caller: s.caller, offset: s.offset, ...(s.shadowed ? { shadowed: true } : {}) })) };
    }, ["method_desc"]);
  def("dex_usages_of_string", "dex", "문자열 리터럴(정확히 일치)을 읽는 메서드.",
    { value: str("문자열 값"), limit: int(200, 1, 1000) },
    async ({ value, limit = 200 }) => {
      const m = vecToArray(dk().findMethodsUsingString(value));
      return { total: m.length, truncated: m.length > limit, methods: m.slice(0, limit) };
    }, ["value"]);
  def("dex_accessors_of_field", "dex", '필드("La/b/C;->f:T")를 읽고 쓰는 메서드.',
    { field_desc: str("필드 descriptor"), limit: int(200, 1, 1000) },
    async ({ field_desc, limit = 200 }) => {
      const g = vecToArray(dk().findFieldGetMethods(field_desc)), p = vecToArray(dk().findFieldPutMethods(field_desc));
      return { getters: g.slice(0, limit), putters: p.slice(0, limit), truncated: g.length > limit || p.length > limit };
    }, ["field_desc"]);
  def("dex_references_to_type", "dex", "타입을 참조하는 필드 / 그 타입을 반환하는 메서드 / 인자로 받는 메서드.",
    { class_desc: str("class descriptor 또는 FQN"), limit_per_bucket: int(100, 1, 500) },
    async ({ class_desc, limit_per_bucket: n = 100 }) => {
      const cls = await resolveClass(class_desc);
      const r = dk().findTypeReferences(cls);
      return { class: cls, fields: r.fields.slice(0, n), methodsReturning: r.methodsReturning.slice(0, n), methodsWithParam: r.methodsWithParam.slice(0, n),
        truncated: r.fields.length > n || r.methodsReturning.length > n || r.methodsWithParam.length > n };
    }, ["class_desc"]);
  def("dex_iocs", "dex", "문자열 리터럴의 IoC: 네트워크 지표(URL/IP/도메인…)와 민감한 content provider URI, 참조 클래스 포함." + DEX_ONLY,
    {}, async () => iocs());
  def("dex_capabilities", "dex", "행위 능력 프로필: API 카탈로그 매칭(SMS/REFLECTION/DYNAMIC…) 호출 위치 수 순." + DEX_ONLY,
    { app_only: bool(true, "라이브러리·프레임워크 호출자 제외"), min_call_sites: int(0, 0), limit: int(300, 1, 1000) },
    async ({ app_only = true, min_call_sites = 0, limit = 300 }) => {
      const r = await caps(app_only);
      const hits = r.apiHits.filter(h => h.callSiteCount + h.fieldAccessCount >= min_call_sites).sort((a, b) => b.callSiteCount - a.callSiteCount);
      return { ...r, apiHits: hits.slice(0, limit), apiHitsShown: Math.min(hits.length, limit), truncated: hits.length > limit };
    });
  def("dex_permissions", "dex", "코드가 호출하는 API가 요구하는 권한(권한→API→호출자). 선언 권한과의 대조는 xref_permissions." + DEX_ONLY,
    { app_only: bool(true), bucket: { type: "string", enum: ["dangerous", "signature", "internal", "normal", "other"] } },
    async ({ app_only = true, bucket }) => {
      const { permIndex, totals } = await perms(app_only);
      return { totals, bucket: bucket || "all",
        rows: permIndex.filter(r => !bucket || r.level === bucket).map(r => ({ perm: r.perm, level: r.level, api: r.api, callerCount: r.callers.length, callers: r.callers.slice(0, 20) })) };
    });
  def("dex_components", "dex", "상위 클래스 체인으로 찾은 컴포넌트 후보(activity/service/receiver/provider/device-admin…). 선언과의 대조는 xref_components." + DEX_ONLY,
    {}, async () => {
      const g = await comps();
      return { kinds: g.length, groups: g.map(x => ({ kind: x.kind, tag: x.tag, count: x.classes.length, classes: x.classes })) };
    });

  // apk
  def("apk_overview", "apk", "apkllm 요약: 입력 해시, 변조 검사·서명 블록·서명 인증서·Play frosting·콘텐츠 분류의 요약.", {}, async () => {
    const r = apkRep();
    return {
      input: r.input,
      tamper: { ok: r.tamper.ok, libziparchive_would_open: r.tamper.libziparchive_would_open, summary: r.tamper.summary, checks: r.tamper.checks },
      signing: { found: r.signing.found, schemes: Object.keys(r.signing.named || {}), duplicate_ids: r.signing.duplicate_ids, unknown_ids: r.signing.unknown_ids },
      certs: { v1: r.certs.v1 && r.certs.v1.files_total, v2: r.certs.v2 && r.certs.v2.signers_total, v3: r.certs.v3 && r.certs.v3.signers_total, v31: r.certs.v31 && r.certs.v31.signers_total, source_stamp: !!r.certs.source_stamp },
      frosting: { play_result: r.frosting.play_result, present: r.frosting.present },
      content: { entry_count: r.content.entry_count, summary: r.content.summary, checks: r.content.checks },
    };
  });
  def("apk_tamper", "apk", "ZIP 변조 검사(Janus·중복 엔트리·CD/LFH 불일치·메서드 위조…): findings와 검사 결과.",
    { include_entries: bool(false, "CD/LFH 엔트리 표까지") }, async ({ include_entries = false }) => {
      const t = apkRep().tamper;
      return include_entries ? t : { ...t, entries: undefined, entry_count: (t.entries || []).length };
    });
  def("apk_signing", "apk", "APK Signing Block 쌍, v1/v2/v3 서명 인증서(검증 안 함), 빌드 흔적, Play frosting.",
    {}, async () => { const r = apkRep(); return { signing: r.signing, certs: r.certs, traces: r.traces, frosting: r.frosting }; });
  def("apk_content", "apk", "엔트리별 실제 내용 분류(기기 reader가 읽는 첫 512바이트의 magic): 역할·확장자 불일치 표시.",
    { content_type: str("예: dex, elf, axml, png, unknown"), category: str("예: executable, image, android"), mismatch_only: bool(false, "역할·확장자 불일치만"), offset: int(0, 0), limit: int(200, 1, 2000) },
    async ({ content_type, category, mismatch_only = false, offset = 0, limit = 200 }) => {
      const c = apkRep().content;
      const items = (c.entries || []).filter(e => (!content_type || e.content_type === content_type) && (!category || e.category === category) && (!mismatch_only || e.role_mismatch || e.extension_mismatch));
      return { summary: c.summary, checks: c.checks, ...page(items, offset, limit) };
    });
  def("apk_gate", "apk",
    "설치 게이트를 주어진 매니페스트 값으로 직접 계산(생략 = unknown → 조건부 판정). " +
    "axmlllm 매니페스트 값을 자동으로 넣은 판정은 xref_manifest_gate.",
    { extract_native_libs: tri("extractNativeLibs"), target_sdk: { type: ["integer", "null"] }, apk_role: { type: ["string", "null"], enum: ["base", "split", null] },
      isolated_splits: tri("base 매니페스트의 isolatedSplits"), feature_split: tri("isFeatureSplit"), config_for_split: tri("configForSplit 선언 여부"),
      page_size: { type: "integer", enum: [4096, 16384], default: 4096 },
      class: str("엔트리 class 필터: dex, native_lib, manifest, resources_arsc, resource, meta, other"), failing_only: bool(false, "통과 못 하는 엔트리만"),
      offset: int(0, 0), limit: int(100, 0, 2000) },
    async (a) => {
      const p = { extractNativeLibs: a.extract_native_libs ?? null, targetSdk: a.target_sdk ?? null, pageSize: a.page_size || 4096,
        isolatedSplits: a.isolated_splits ?? null, featureSplit: a.feature_split ?? null, configForSplit: a.config_for_split ?? null };
      if (a.apk_role !== undefined) p.apkRole = a.apk_role;
      const g = await apkGate(p);
      const ents = (g.entries || []).filter(e => (!a.class || e.class === a.class) && (!a.failing_only || !e.passes));
      return { params: p, ...gateSummary(g), entries: page(ents, a.offset || 0, a.limit ?? 100) };
    });

  // xref — 도구 사이에서 주고받는 정보
  def("xref_manifest_gate", "xref",
    "axmlllm → apkllm: 매니페스트에서 읽은 extractNativeLibs·targetSdk·split 사실(값과 근거)을 apkllm 설치 게이트에 넣은 판정. " +
    "선언된 extractNativeLibs가 컨테이너와 맞지 않으면 divergence로 표시.",
    { page_size: { type: "integer", enum: [4096, 16384], default: 4096 } },
    async ({ page_size = 4096 }) => {
      const { f, params, gate } = await factGate(page_size);
      const sent = Object.fromEntries(Object.entries(FACT_LABELS).map(([k, l]) => [l, f[k]]));
      exchange("axmlllm", "apkllm", "manifest facts → install gate", params);
      const cons = gate.consistent_extract_native_libs || [];
      return {
        sent: { from: "axmlllm", to: "apkllm", facts: sent, gate_params: params },
        verdict: { installable: gate.installable, needs_manifest: gate.needs_manifest, in_base_asset_manager: gate.in_base_asset_manager,
          in_base_asset_manager_reason: gate.in_base_asset_manager_reason, consistent_extract_native_libs: cons,
          divergence: f.enl.v === null ? null : !cons.includes(String(f.enl.v)) },
        ...gateSummary(gate),
      };
    });
  def("xref_components", "xref",
    "axmlllm ↔ dexllm: 선언된 컴포넌트(application·alias는 target 클래스)가 dex에 있는지, dex의 상위 클래스 판정이 선언 tag와 맞는지, " +
    "dex에는 컴포넌트 하위 클래스로 있지만 선언되지 않은 클래스(동적 등록·죽은 코드·은닉). " +
    "선언됐는데 dex에 없으면 패킹·동적 로딩·분할 APK의 단서.",
    { status: { type: "string", enum: ["all", "present", "missing", "mismatch", "undeclared"], default: "all" }, app_package_only: bool(false, "undeclared를 매니페스트 패키지 아래로 제한"), limit: int(300, 1, 5000) },
    async ({ status = "all", app_package_only = false, limit = 300 }) => {
      const [items, set, idx, man] = await Promise.all([axComps(), classSet(), compIndex(), axManifest()]);
      const declared = new Set();
      const rows = items.map(it => {
        const cls = it.tag === "activity-alias" ? it.target_activity : it.name;
        const desc = cls ? descOf(cls) : null;
        if (desc) declared.add(desc);
        const present = desc ? set.has(desc) : null;
        const dexKind = desc ? idx.get(desc) || null : null;
        const want = TAG_KINDS[it.tag] || [];
        const mismatch = !!(present && dexKind && !want.includes(dexKind));
        return { tag: it.tag, name: it.name, class: cls || null, desc, ...(it.target_activity_why ? { target_unknown: it.target_activity_why } : {}),
          device: it.device, ...(it.hidden ? { hidden: it.hidden } : {}), ...(it.conditions ? { conditions: it.conditions } : {}),
          in_dex: present, dex_kind: dexKind, ...(mismatch ? { mismatch: `선언 ${it.tag} ↔ dex ${dexKind}` } : {}) };
      });
      const pkg = man.package ? descOf(man.package + ".").slice(0, -1) : null;
      const undeclared = [...idx].filter(([c]) => !declared.has(c) && (!app_package_only || (pkg && c.startsWith(pkg))))
        .map(([c, kind]) => ({ class: c, kind, in_app_package: !!(pkg && c.startsWith(pkg)) }))
        .sort((a, b) => b.in_app_package - a.in_app_package || a.class.localeCompare(b.class));
      exchange("axmlllm", "dexllm", "declared component classes → dex class lookup", { declared: rows.length, classes: declared.size });
      const counts = { declared: rows.length, present: rows.filter(r => r.in_dex).length, missing: rows.filter(r => r.in_dex === false).length,
        unknown_target: rows.filter(r => r.in_dex === null).length, mismatch: rows.filter(r => r.mismatch).length, undeclared: undeclared.length };
      const pick = status === "present" ? rows.filter(r => r.in_dex) : status === "missing" ? rows.filter(r => r.in_dex !== true)
        : status === "mismatch" ? rows.filter(r => r.mismatch) : status === "undeclared" ? [] : rows;
      return { package: man.package, counts,
        declared: status === "undeclared" ? undefined : pick.slice(0, limit),
        undeclared: status === "all" || status === "undeclared" ? undeclared.slice(0, limit) : undefined,
        note: "undeclared: 매니페스트에 없는 컴포넌트 하위 클래스 — receiver는 registerReceiver로 동적 등록될 수 있고, activity/service/provider는 선언 없이는 기기가 띄우지 않는다(라이브러리·죽은 코드 포함)." };
    });
  def("xref_permissions", "xref",
    "axmlllm ↔ dexllm: 선언된 권한(<uses-permission>, 기기가 읽는지 포함) × 코드가 호출하는 권한 보호 API. " +
    "used = 선언+호출, declared_only = 선언만(호출 근거 없음: 리플렉션·네이티브·동적 코드일 수 있음), undeclared = 호출하지만 선언 안 됨.",
    { status: { type: "string", enum: ["all", "used", "declared_only", "undeclared"], default: "all" }, app_only: bool(true, "dex 호출자에서 라이브러리 제외"), samples: int(5, 0, 50) },
    async ({ status = "all", app_only = true, samples = 5 }) => {
      const [decl, { permIndex }] = await Promise.all([axPerms(), perms(app_only)]);
      const used = new Map();
      for (const r of permIndex) {
        const u = used.get(r.perm) || { level: r.level, apis: new Set(), callers: new Set() };
        u.apis.add(r.api); r.callers.forEach(c => u.callers.add(c)); used.set(r.perm, u);
      }
      const ev = (u) => u && { level: u.level, apis: u.apis.size, callers: u.callers.size,
        sample_apis: [...u.apis].slice(0, samples), sample_callers: [...u.callers].slice(0, samples) };
      const names = new Set();
      const declared = (decl.items || []).map(it => {
        names.add(it.name);
        const u = used.get(it.name);
        return { perm: it.name, tag: it.tag, device: it.device, ...(it.hidden ? { hidden: it.hidden } : {}), ...(it.conditions ? { conditions: it.conditions } : {}),
          status: u ? "used" : "declared_only", dex: ev(u) };
      });
      const undeclared = [...used].filter(([p]) => !names.has(p)).map(([perm, u]) => ({ perm, status: "undeclared", dex: ev(u) }))
        .sort((a, b) => b.dex.callers - a.dex.callers);
      exchange("dexllm", "axmlllm", "permission-guarded API evidence → declared permissions", { declared: declared.length, dex_perms: used.size });
      const counts = { declared: declared.length, used: declared.filter(d => d.status === "used").length,
        declared_only: declared.filter(d => d.status === "declared_only").length, undeclared: undeclared.length,
        not_read_by_device: declared.filter(d => d.device !== "read").length };
      return { counts,
        declared: status === "undeclared" ? undefined : declared.filter(d => status === "all" || d.status === status),
        undeclared: status === "all" || status === "undeclared" ? undeclared : undefined };
    });
  def("xref_native", "xref",
    "apkllm ↔ dexllm (+ axmlllm extractNativeLibs): APK의 네이티브 라이브러리(lib/<abi>/*.so)와 ELF가 lib/ 밖에 숨은 엔트리, " +
    "그 이름을 문자열로 참조하는 dex 메서드, System.loadLibrary/load 호출자. 포장된 라이브러리 이름을 참조하지 않는 로더는 외부·동적 라이브러리 후보.",
    { samples: int(10, 0, 200) },
    async ({ samples = 10 }) => {
      const [{ f, gate }, strings] = await Promise.all([factGate(), stringList()]);
      const content = apkRep().content.entries || [];
      const libs = new Map();
      for (const e of gate.entries || []) {
        if (e.class !== "native_lib") continue;
        const m = /^lib\/([^/]+)\/(.+)$/.exec(e.name);
        const file = m ? m[2] : e.name.split("/").pop();
        const l = libs.get(file) || { file, abis: [], gate: [] };
        l.abis.push(m ? m[1] : "?"); if (!e.passes) l.gate.push({ abi: m && m[1], reason: e.reason });
        libs.set(file, l);
      }
      const hidden = content.filter(e => e.content_type === "elf" && e.class !== "native_lib").map(e => ({ name: e.name, class: e.class, disposition: e.disposition }));
      const keysFor = (file) => {
        const base = file.replace(/^lib/, "").replace(/\.so$/, "");
        return strings.filter(s => s === base || s === file || s.endsWith("/" + file));
      };
      const refMethods = new Set();
      const out = [...libs.values(), ...hidden.map(h => ({ file: h.name.split("/").pop(), hidden_entry: h }))].map(l => {
        const keys = keysFor(l.file);
        const methods = [...new Set(keys.flatMap(k => vecToArray(dk().findMethodsUsingString(k))))];
        methods.forEach(m => refMethods.add(m));
        return { ...l, strings: keys, referenced_by: methods.slice(0, samples), referenced_by_total: methods.length };
      });
      const loaders = LOADERS.map(api => {
        const sites = dk().findCallSitesWithOffset(api);
        const callers = [...new Set(sites.map(s => s.caller))];
        const unmatched = callers.filter(c => !refMethods.has(c));
        return { api, callers: callers.length, sample: callers.slice(0, samples), not_referencing_packaged_lib: unmatched.slice(0, samples), not_referencing_total: unmatched.length };
      }).filter(l => l.callers);
      const nl = (gate.checks || []).find(c => c.id === "container.native_lib_gate");
      exchange("apkllm", "dexllm", "packaged native libs → dex string/loader lookup", { libs: libs.size, hidden_elf: hidden.length });
      return { extractNativeLibs: f.enl, native_lib_gate: nl || null, libs: out, hidden_elf: hidden.length, loaders };
    });
  def("xref_summary", "xref",
    "세 도구의 핵심 신호를 한 번에: 파일·패키지·SDK, 매니페스트 이상, ZIP 변조, 서명, 매니페스트 기반 설치 판정, " +
    "컴포넌트·권한·네이티브 교차 결과 개수, IoC 개수. 분석 시작점으로 쓴다.",
    {}, async () => {
      const out = { file: be.file(), tools: be.tools(), signals: [] };
      const sig = (s) => out.signals.push(s);
      const tryPart = async (k, fn) => { try { out[k] = await fn(); } catch (e) { out[k] = { error: String(e && e.message || e) }; } };
      await tryPart("manifest", async () => {
        const m = await axManifest();
        const an = await axTool("manifest_anomalies", { limit: 20 });
        if (an.total) sig(`매니페스트 이상 ${an.total}건 (axml_manifest_anomalies)`);
        if (m.parse_status && m.parse_status !== "ok") sig(`매니페스트 parse_status=${m.parse_status}`);
        const { package: pkg, parse_status, permission_count, component_count, resources_status } = m;
        return { package: pkg, parse_status, permission_count, component_count, resources_status,
          anomalies: an.total, anomaly_sample: (an.items || []).slice(0, 5) };
      });
      await tryPart("apk", async () => {
        const r = apkRep();
        if (r.tamper.summary && r.tamper.summary.findings) sig(`ZIP 변조 findings ${r.tamper.summary.findings}건: ${Object.keys(r.tamper.summary.by_id || {}).join(", ")}`);
        if (!r.tamper.libziparchive_would_open) sig("기기 ZIP reader(libziparchive)가 열지 못하는 컨테이너");
        const mm = r.content.summary || {};
        if (mm.role_mismatch || mm.extension_mismatch) sig(`콘텐츠 역할/확장자 불일치 ${mm.role_mismatch || 0}/${mm.extension_mismatch || 0} (apk_content mismatch_only=true)`);
        return { md5: r.input.md5, sha256: r.input.sha256, size: r.input.size, tamper_findings: r.tamper.summary, signing_schemes: Object.keys(r.signing.named || {}),
          frosting: r.frosting.play_result, content: mm.by_content_type };
      });
      await tryPart("install", async () => {
        const { f, gate } = await factGate();
        const cons = gate.consistent_extract_native_libs || [];
        if (gate.installable === false) sig("매니페스트 값 기준 설치 불가 판정 (xref_manifest_gate)");
        if (f.enl.v !== null && !cons.includes(String(f.enl.v))) sig(`선언 extractNativeLibs=${f.enl.v}가 컨테이너와 어긋남`);
        return { installable: gate.installable, needs_manifest: gate.needs_manifest, extractNativeLibs: f.enl.v, targetSdk: f.tsdk.v, apk_role: f.role.v };
      });
      await tryPart("components", async () => {
        const c = (await T.find(t => t.name === "xref_components").run({ status: "missing", limit: 10 }));
        if (c.counts.missing) sig(`선언됐지만 dex에 없는 컴포넌트 ${c.counts.missing}개 — 패킹/동적 로딩 단서 (xref_components status=missing)`);
        if (c.counts.mismatch) sig(`선언 tag와 dex 상위 클래스가 다른 컴포넌트 ${c.counts.mismatch}개`);
        return { ...c.counts, missing_sample: (c.declared || []).filter(r => r.in_dex === false).slice(0, 5).map(r => r.class) };
      });
      await tryPart("permissions", async () => {
        const p = await T.find(t => t.name === "xref_permissions").run({ status: "all", samples: 0 });
        const dang = (p.undeclared || []).filter(u => u.dex.level === "dangerous");
        if (dang.length) sig(`선언 없이 호출되는 dangerous 권한 API ${dang.length}종: ${dang.slice(0, 5).map(u => u.perm).join(", ")}`);
        return p.counts;
      });
      await tryPart("native", async () => {
        const n = await T.find(t => t.name === "xref_native").run({ samples: 3 });
        if (n.hidden_elf) sig(`lib/ 밖에 있는 ELF ${n.hidden_elf}개 (xref_native)`);
        const ext = n.loaders.reduce((s, l) => s + l.not_referencing_total, 0);
        if (ext) sig(`포장된 라이브러리 이름을 참조하지 않는 loadLibrary/load 호출자 ${ext}개`);
        return { libs: n.libs.length, hidden_elf: n.hidden_elf, loader_callers: n.loaders.reduce((s, l) => s + l.callers, 0) };
      });
      await tryPart("dex", async () => {
        const io = await iocs();
        const cl = await classList();
        return { classes: cl.length, ioc_network: (io.network || []).length, ioc_providers: (io.providers || []).length };
      });
      return out;
    });
  def("xref_log", "xref",
    "도구 사이에 오간 정보의 기록(최근 순): 웹 콘솔의 자동 연동(매니페스트→apkllm 입력, 컴포넌트·권한 표시, dexllm 이동)과 xref_* 호출.",
    { limit: int(50, 1, 500) }, async ({ limit = 50 }) => ({ total: be.log.length, items: be.log.slice(-limit).reverse() }));

  // ── axml: 엔진이 내보내는 도구 목록 그대로 axml_<name> ──
  function axmlDefs() {
    let defs = [];
    try { defs = be.axmlTools() || []; } catch (_) { /* 아직 엔진 없음 */ }
    return defs.map(d => ({ name: "axml_" + d.name, group: "axml", description: d.description,
      inputSchema: d.input_schema || { type: "object", properties: {} }, run: (a) => axTool(d.name, a) }));
  }

  const list = () => [...T.filter(t => t.group !== "dex" && t.group !== "apk" && t.group !== "xref"),
    ...T.filter(t => t.group === "dex"), ...axmlDefs(), ...T.filter(t => t.group === "apk"), ...T.filter(t => t.group === "xref")];

  return {
    list,
    find: (name) => list().find(t => t.name === name),
    async call(name, args = {}) {
      const t = list().find(x => x.name === name);
      if (!t) throw new Error(`unknown tool: ${name}`);
      return t.run(args || {});
    },
  };
}

// 결과 → 텍스트 (MCP content, 터미널 출력 공통). {text}는 그대로, 나머지는 JSON.
export function renderResult(r, pretty = 1) {
  let s = r && typeof r === "object" && typeof r.text === "string" && Object.keys(r).length === 1 ? r.text : JSON.stringify(r, null, pretty);
  if (s === undefined) s = "null";
  if (s.length > TEXT_CAP) s = s.slice(0, TEXT_CAP) + `\n…[TRUNCATED: 전체 ${s.length}자 — limit/offset/필터로 좁히세요]`;
  return s;
}
