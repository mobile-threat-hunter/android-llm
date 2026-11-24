// 웹 터미널 — 통합 MCP(mcp/server.mjs)와 같은 도구(core/suite.mjs)를 같은 문법(core/cli.mjs)으로.
// 엔진은 새로 띄우지 않는다: 셸에 열린 세 도구 iframe의 엔진·세션을 그대로 쓴다(same-origin).
//   dexllm  : 페이지의 dk(WasmDexKit) + 디컴파일·IoC는 페이지 worker(wcall)
//   axmlllm : 페이지 worker(wcall) — 페이지가 연 세션 그대로
//   apkllm  : 페이지의 report(load 결과) + gate는 페이지 worker(wcall)
// 도구 사이에 오간 정보(suite-bridge 교환 기록)는 실시간으로 찍히고 xref_log로 다시 본다.
import { createSuite, renderResult } from './core/suite.mjs';
import { parseCommand, helpText, resolveTool } from './core/cli.mjs';

const $ = (id) => document.getElementById(id);
const TOOLS = ['axmlllm', 'dexllm', 'apkllm'];
const win = (name) => { const f = document.querySelector(`#view-${name} iframe`); return f && f.contentWindow; };
const curName = () => $('curfile').textContent || null;

// ── 웹 backend ──
const ids = new WeakMap(); let nextId = 1;
const idOf = (o) => (o && typeof o === 'object') ? (ids.get(o) || (ids.set(o, nextId++), ids.get(o))) : 0;
const peek = (name, expr) => { try { const w = win(name); return w ? w.eval(expr) : undefined; } catch (_) { return undefined; } };

const READY = {
  dexllm: (w, f) => w.eval('typeof dk !== "undefined" && dk !== null') && w.document.getElementById('status').textContent.startsWith(f),
  axmlllm: (w, f) => w.eval('session && session.name') === f && w.document.getElementById('status').className === 'ready',
  apkllm: (w, f) => w.eval('report && report.file && report.file.name') === f,
};
function toolState(name) {
  const f = curName();
  if (!f) return { state: 'none', detail: '열린 파일 없음' };
  const dot = document.querySelector(`#nav button[data-view="${name}"] .dot`);
  if (dot.classList.contains('skip')) return { state: 'none', detail: dot.title };
  if (dot.classList.contains('err')) return { state: 'error', detail: dot.title };
  const w = win(name);
  if (!w || Bridge.fileOf(name) !== f) return { state: 'none', detail: `${name}에 ${f}가 열려 있지 않음` };
  try { if (READY[name](w, f)) return { state: 'ready' }; } catch (_) { /* 로드 중 */ }
  return { state: 'loading' };
}
function need(name) {
  const s = toolState(name);
  if (s.state !== 'ready') throw new Error(`${name}: ${s.state}${s.detail ? ' — ' + s.detail : ''}`);
  return win(name);
}
let versions = null;
fetch('versions.json').then(r => r.ok ? r.json() : null).then(v => { versions = v; }).catch(() => {});

const be = {
  kind: 'web',
  log: Bridge.log,
  file: () => curName() && { name: curName() },
  token: () => [curName(), idOf(peek('dexllm', 'dk')), idOf(peek('axmlllm', 'session')), idOf(peek('apkllm', 'report'))].join('|'),
  tools: () => Object.fromEntries(TOOLS.map(n => [n, toolState(n)])),
  versions: () => versions,
  async load() {
    $('suitefile').click();
    return { note: '파일 선택 창을 열었습니다 — 고른 파일이 세 도구에 동시에 열립니다. 로드가 끝나면 suite_status로 확인.' };
  },
  dex() {
    const w = need('dexllm');
    return { dk: w.eval('dk'),
      decompile: (cls) => w.wcall({ type: 'decompile', cls, sourceIdx: -1 }),
      iocs: () => w.wcall({ type: 'extractIocs', sourceIdx: -1 }) };
  },
  axml: (msg) => need('axmlllm').wcall(msg),
  axmlTools: () => peek('axmlllm', 'session && session.tools') || [],
  apkReport: () => need('apkllm').eval('report'),
  apk: (msg) => need('apkllm').wcall(msg),
};
const suite = createSuite(be);

// ── UI ──
const term = $('term'), out = $('term-out'), input = $('term-input');
const HKEY = 'suite.term.history';
let hist = []; try { hist = JSON.parse(localStorage.getItem(HKEY) || '[]'); } catch (_) {}
let hpos = hist.length, draft = '';
let busy = false;

const esc = (s) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// dex 클래스 descriptor(La/b/C;)는 눌러서 dexllm으로 — 메서드 descriptor는 그 클래스로
const DESC = /L[A-Za-z0-9_$\/\-]+;/g;
function block(cls, html) {
  const d = document.createElement('div');
  d.className = 'tb ' + cls;
  d.innerHTML = html;
  out.appendChild(d);
  out.scrollTop = out.scrollHeight;
  return d;
}
function print(text, cls = 'res') {
  const big = text.length > 400000;
  const html = big ? esc(text) : esc(text).replace(DESC, m => `<span class="tdesc" data-desc="${m}">${m}</span>`);
  const d = block(cls, `<button class="tcopy" title="복사">⧉</button><pre>${html}</pre>`);
  d.querySelector('.tcopy').onclick = () => navigator.clipboard.writeText(text).then(() => Bridge.toast('복사했습니다'));
  return d;
}
const line = (text, cls = 'dim') => block(cls, esc(text));

function banner() {
  const f = curName();
  line('android-llm 터미널 — 통합 MCP와 같은 명령(dex_* · axml_* · apk_* · xref_*). help 로 목록, help <명령> 으로 인자.', 'head');
  line(f ? `현재 파일: ${f} — xref_summary 로 시작` : '열린 파일 없음 — 홈에 APK를 드롭하거나 suite_load', 'dim');
}

function gotoClass(arg) {
  const m = String(arg || '').match(/L[^;]+;/);
  const desc = m ? m[0] : arg && 'L' + arg.replace(/\./g, '/') + ';';
  const dw = win('dexllm');
  if (!desc || !dw) throw new Error('goto: dexllm이 열려 있지 않습니다');
  if (!dw.eval(`allClasses.includes(${JSON.stringify(desc)})`)) throw new Error(`goto: dex에 ${desc}가 없습니다`);
  Bridge.log.push({ t: new Date().toISOString(), via: 'terminal', from: 'terminal', to: 'dexllm', what: 'goto class', data: { class: desc } });
  show('dexllm');
  dw.navigateToClass(desc);
  return desc;
}

const BUILTINS = {
  help: (a) => print(helpText(suite.list(), a[0]), 'help'),
  clear: () => { out.innerHTML = ''; },
  history: () => print(hist.slice(-50).map((h, i) => `${String(hist.length - Math.min(50, hist.length) + i + 1).padStart(4)}  ${h}`).join('\n'), 'help'),
  tab: (a) => { const n = a[0] === 'home' ? 'home' : TOOLS.find(t => t.startsWith(a[0] || '')); if (!n) throw new Error('tab <home|axmlllm|dexllm|apkllm>'); show(n); },
  goto: (a) => line('→ dexllm ' + gotoClass(a.join(' ')), 'dim'),
};

async function run(src) {
  src = src.trim();
  if (!src) return;
  if (hist[hist.length - 1] !== src) { hist.push(src); if (hist.length > 200) hist = hist.slice(-200); localStorage.setItem(HKEY, JSON.stringify(hist)); }
  hpos = hist.length;
  block('cmd', `<span class="ps">android-llm&gt;</span> ${esc(src)}`);
  const words = src.split(/\s+/);
  try {
    if (BUILTINS[words[0]]) { BUILTINS[words[0]](words.slice(1)); return; }
    const c = parseCommand(suite.list(), src);
    const t0 = performance.now();
    const pending = line(`${c.name} 실행 중…`, 'dim busy');
    busy = true;
    try {
      const r = await suite.call(c.name, c.args);
      pending.remove();
      print(renderResult(r));
      line(`(${c.name} ${Math.round(performance.now() - t0)}ms)`, 'dim');
    } catch (e) { pending.remove(); throw e; }
  } catch (e) {
    line('error: ' + (e && e.message || e), 'err');
  } finally { busy = false; }
}

// Tab: 첫 단어는 명령 이름, 그 뒤는 그 명령의 key=
function complete() {
  const v = input.value, pos = input.selectionStart;
  const left = v.slice(0, pos), words = left.split(/\s+/), cur = words[words.length - 1];
  let cands;
  if (words.length === 1) cands = [...Object.keys(BUILTINS), ...suite.list().map(t => t.name)].filter(n => n.startsWith(cur));
  else {
    let tool = null;
    try { tool = suite.find(resolveTool(suite.list(), words.slice(0, 2)).name) || suite.find(resolveTool(suite.list(), words).name); } catch (_) {}
    if (words[0] === 'help') cands = suite.list().map(t => t.name).filter(n => n.startsWith(cur));
    else if (words[0] === 'tab') cands = ['home', ...TOOLS].filter(n => n.startsWith(cur));
    else cands = tool ? Object.keys(tool.inputSchema.properties || {}).map(k => k + '=').filter(k => k.startsWith(cur)) : [];
  }
  if (!cands.length) return;
  let pre = cands[0];
  for (const c of cands) while (!c.startsWith(pre)) pre = pre.slice(0, -1);
  const fill = cands.length === 1 ? cands[0] + (cands[0].endsWith('=') ? '' : ' ') : pre;
  input.value = left.slice(0, left.length - cur.length) + fill + v.slice(pos);
  input.selectionStart = input.selectionEnd = left.length - cur.length + fill.length;
  if (cands.length > 1 && fill === cur) line(cands.join('   '), 'dim');
}

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (busy) return;
    const v = input.value; input.value = ''; draft = '';
    run(v);
  } else if (e.key === 'Tab') { e.preventDefault(); complete(); }
  else if (e.key === 'ArrowUp') {
    if (!hist.length) return;
    e.preventDefault();
    if (hpos === hist.length) draft = input.value;
    hpos = Math.max(0, hpos - 1); input.value = hist[hpos];
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    hpos = Math.min(hist.length, hpos + 1); input.value = hpos === hist.length ? draft : hist[hpos];
  } else if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); out.innerHTML = ''; }
  else if (e.key === 'Escape') { e.preventDefault(); toggle(false); }
});
out.addEventListener('click', (e) => {
  const d = e.target.closest('.tdesc');
  if (!d || !window.getSelection().isCollapsed) return;
  try { gotoClass(d.dataset.desc); } catch (err) { Bridge.toast(err.message, 'warn'); }
});
out.addEventListener('mouseup', () => { if (window.getSelection().isCollapsed) input.focus({ preventScroll: true }); });

// 도구 사이 교환 실시간 표시
Bridge.onExchange((x) => {
  if (!$('term-live').checked) return;
  line(`⇄ ${x.from} → ${x.to} · ${x.what}  ${JSON.stringify(x.data)}`, 'xch');
});

// 열기/닫기 + 높이 조절
const HKEY_H = 'suite.term.height';
term.style.height = (Number(localStorage.getItem(HKEY_H)) || 320) + 'px';
let shown = false;
function toggle(on = !shown) {
  shown = on;
  term.hidden = !on;
  $('termbtn').classList.toggle('active', on);
  if (on) { if (!out.childElementCount) banner(); input.focus(); }
  else { document.activeElement?.blur(); const v = document.querySelector('.view.active iframe'); v && v.contentWindow.focus(); }
}
$('termbtn').addEventListener('click', () => toggle());
$('term-close').addEventListener('click', () => toggle(false));
$('term-grip').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const y0 = e.clientY, h0 = term.offsetHeight;
  document.body.classList.add('resizing');
  const move = (ev) => { term.style.height = Math.max(120, Math.min(window.innerHeight - 120, h0 + y0 - ev.clientY)) + 'px'; };
  const up = () => {
    document.body.classList.remove('resizing');
    localStorage.setItem(HKEY_H, term.offsetHeight);
    removeEventListener('pointermove', move); removeEventListener('pointerup', up);
  };
  addEventListener('pointermove', move); addEventListener('pointerup', up);
});

window.SuiteTerminal = { toggle, run, suite };
