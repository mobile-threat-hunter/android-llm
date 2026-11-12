// 도구 간 연동 — 셸이 same-origin iframe의 DOM과 전역(함수·let 바인딩)을 직접 쓴다.
// 도구 저장소는 손대지 않는다. 도구 쪽 이름이 바뀌면 이 파일만 고칠 것 (CLAUDE.md 참고).
//
//   axmlllm → apkllm   매니페스트 사실(extractNativeLibs · targetSdk · split 여부)을 Gate 입력에 자동 기입
//   dexllm → axmlllm   Components/Permissions 행에 dex 근거 하이라이트 + evidence-first 정렬
//   axmlllm → dexllm   Components 행 클릭 → 해당 클래스 디컴파일
//                      Permissions 행 클릭 → dexllm permissions 패널(그 권한의 gated API → 호출 클래스)
//                      dex에 없는 클래스·권한은 탭을 넘기지 않고 axmlllm에서 경고만 띄운다
//
// 셸(index.html)이 쓰는 진입점: Bridge.hook(name, iframe), Bridge.opened(name, fileName, gen)
const Bridge = (() => {
  const win = name => {
    const f = document.querySelector(`#view-${name} iframe`);
    return f && f.contentWindow;
  };
  const fileOf = {};          // 도구별로 마지막에 연 파일 이름 (셸이 알려준 것)
  let curGen = 0, syncedGen = 0, annotGen = 0;

  // ── 토스트 ──
  let toastTimer = null;
  function toast(msg, kind) {
    let t = document.getElementById('suite-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'suite-toast';
      t.addEventListener('click', () => t.classList.remove('on'));
      document.body.appendChild(t);
    }
    t.className = 'on ' + (kind || '');
    t.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('on'), kind === 'warn' ? 9000 : 4000);
  }

  // 조건이 참이 될 때까지 폴링. gen이 바뀌면(새 파일) 포기.
  function until(pred, { timeout = 120000, gen = null } = {}) {
    const t0 = Date.now();
    return new Promise(res => {
      (function poll() {
        if (gen !== null && gen !== curGen) return res(false);
        let ok = false;
        try { ok = pred(); } catch (_) { /* 아직 준비 안 됨 */ }
        if (ok) return res(true);
        if (Date.now() - t0 > timeout) return res(false);
        setTimeout(poll, 250);
      })();
    });
  }

  // ── 매니페스트 → 사실 ──
  // 미선언 값은 플랫폼 기본값을 쓴다 (추측이 아니라 파서 동작):
  //   extractNativeLibs 미선언 → true (ParsingPackageUtils: bool(true, …extractNativeLibs))
  //   targetSdkVersion 미선언 → minSdkVersion, 그것도 없으면 1
  // 리소스 참조·코드네임처럼 정적으로 확정할 수 없는 값은 unknown으로 둔다.
  function manifestFacts(tree) {
    const root = tree && tree.root;
    if (!root) return null;
    const attr = (n, k) => n && (n.attributes || []).find(a => a.key === k);
    const kid = (n, tag) => n && (n.children || []).find(c => c.tag === tag);
    const app = kid(root, 'application'), sdk = kid(root, 'uses-sdk');
    const f = {};

    // <manifest split="…">가 없으면 base APK. split이면 extractNativeLibs·targetSdk·isolatedSplits는
    // base 매니페스트 값이라(apkllm docs/usage.md) 이 매니페스트만으로는 모른다 → unknown.
    const bool = (a, dflt) => !a ? { v: dflt, why: `미선언 → 기본 ${dflt}` }
      : (a.value === true || a.value === false || a.value === 'true' || a.value === 'false')
        ? { v: String(a.value) === 'true', why: '선언값' }
        : { v: null, why: `정적 확정 불가 (${a.value})` };
    const split = attr(root, 'split');
    const BASE = { v: null, why: 'split — base 매니페스트 값' };
    if (split) {
      f.role = { v: 'split', why: `split="${split.value}"` };
      f.enl = BASE; f.tsdk = BASE; f.iso = BASE;
      f.feat = bool(attr(root, 'isFeatureSplit'), false);
      const cfg = attr(root, 'configForSplit');
      f.cfg = { v: !!cfg, why: cfg ? `configForSplit="${cfg.value}"` : '미선언' };
      return f;
    }
    f.role = { v: 'base', why: 'split 속성 없음' };
    f.iso = bool(attr(root, 'isolatedSplits'), false);
    f.feat = { v: false, why: 'base' };
    f.cfg = { v: false, why: 'base' };

    f.enl = bool(attr(app, 'extractNativeLibs'), true);
    if (!attr(app, 'extractNativeLibs')) f.enl.why = '미선언 → 플랫폼 기본 true';

    const isInt = a => a && Number.isInteger(Number(a.value)) && String(a.value).trim() !== '';
    const t = attr(sdk, 'targetSdkVersion'), m = attr(sdk, 'minSdkVersion');
    if (isInt(t)) f.tsdk = { v: Number(t.value), why: '선언값' };
    else if (t) f.tsdk = { v: null, why: `정적 확정 불가 (${t.value})` };
    else if (isInt(m)) f.tsdk = { v: Number(m.value), why: '미선언 → minSdkVersion' };
    else if (m) f.tsdk = { v: null, why: `정적 확정 불가 (min ${m.value})` };
    else f.tsdk = { v: 1, why: '미선언 → 기본 1' };
    return f;
  }

  // ── axmlllm → apkllm ──
  async function syncManifestToApk(fileName, gen) {
    // opened()는 iframe 생성 직전에 불리므로 창도 준비될 때까지 기다린다
    let ax, ap;
    const ready = await until(() =>
      (ax = win('axmlllm')) && (ap = win('apkllm')) &&
      ax.eval('session && session.name') === fileName &&
      ax.document.getElementById('status').className === 'ready' &&
      ap.eval('report && report.file && report.file.name') === fileName, { gen });
    if (!ready) return;
    const facts = manifestFacts(ax.eval('last.tree'));
    if (!facts) return;
    const d = ap.document;
    const set = (sel, v) => { d.querySelector(sel).value = v === null ? '' : String(v); };
    set('#in-enl', facts.enl.v);
    set('#in-tsdk', facts.tsdk.v);
    set('#in-role', facts.role.v);
    set('#in-iso', facts.iso.v);
    set('#in-feat', facts.feat.v);
    set('#in-cfg', facts.cfg.v);
    // gateParams()가 모든 입력을 읽으므로 change 한 번이면 rerunGate가 새 값으로 돈다.
    // #in-tsdk의 change 핸들러는 값 검증(tsdkOk 갱신) 후 rerunGate를 부른다.
    d.querySelector('#in-tsdk').dispatchEvent(new ap.Event('change'));

    const form = d.querySelector('#in-enl').closest('.form');
    let note = d.getElementById('suite-manifest-note');
    if (!note) {
      note = d.createElement('p');
      note.id = 'suite-manifest-note';
      note.className = 'note';
      note.style.cssText = 'color:var(--good, #5fdca0)';
      form.insertAdjacentElement('afterend', note);
    }
    const show = (k, x) => `${k} = ${x.v === null ? 'unknown' : x.v} (${x.why})`;
    note.textContent = '↳ axmlllm 매니페스트에서 자동 입력 — ' +
      [show('extractNativeLibs', facts.enl), show('targetSdk', facts.tsdk), show('apk_role', facts.role),
       show('isolatedSplits', facts.iso), show('feature split', facts.feat), show('configForSplit', facts.cfg)].join(' · ') +
      '. 직접 바꾸면 그 값으로 다시 계산된다.';
  }

  // ── axmlllm → dexllm ──
  // dexllm이 같은 파일을 열고 엔진·클래스 목록이 준비됐는지
  function dexFor(fileName) {
    const dw = win('dexllm');
    if (!dw) { toast('dexllm이 아직 열리지 않았습니다 — 같은 APK를 dexllm에도 여세요.', 'warn'); return null; }
    if (fileOf.dexllm !== fileName) {
      toast(`dexllm에 열린 파일(${fileOf.dexllm || '없음'})이 axmlllm의 파일(${fileName})과 다릅니다.`, 'warn');
      return null;
    }
    return dw;
  }

  // axmlllm 표의 열 값 — 머리행(th) 텍스트로 열을 찾는다 (axmlllm이 target_activity·declared_name 열을 조건부로 넣음)
  function colText(tr, key) {
    const head = tr.closest('table').rows[0];
    const i = [...head.cells].findIndex(c => c.textContent.trim() === key);
    return i < 0 || !tr.cells[i] ? '' : tr.cells[i].textContent.trim();
  }
  // Components 행 → { name, tag, cls }. activity-alias는 클래스가 아니므로 cls = 그 alias가 띄우는 클래스.
  // axmlllm ≥ v0.5.1은 target_activity 열을 기기와 같은 규칙(ResID → buildClassName)으로 채워 준다 — 그 값을 쓰고,
  // 열이 없는 예전 axmlllm이면 매니페스트 트리에서 직접 푼다.
  // axmlllm ≥ v0.6.0은 행에 data-class(기기가 인스턴스화하는 클래스)를 직접 달아 준다 — 임베딩 계약, 최우선.
  function compRow(tr, ax) {
    const name = tr.cells[0].textContent.trim();
    const tag = tr.dataset.kind || colText(tr, 'tag');
    if (tr.dataset.class) return { name, tag, cls: tr.dataset.class };
    if (tag !== 'activity-alias') return { name, tag, cls: name };
    // 대상을 모르는 alias는 셀에 "(unknown: …)" 메모가 들어간다 — 클래스명으로 쓰지 않는다
    const t = colText(tr, 'target_activity');
    return { name, tag, cls: (t && !t.startsWith('(') ? t : null) || aliasTargetFromTree(name, ax) };
  }
  function aliasTargetFromTree(name, ax) {
    const pkg = ax.eval('last.tree.root.attributes.find(a => a.key === "package")?.value') || '';
    const app = (ax.eval('last.tree.root.children') || []).find(c => c.tag === 'application');
    const al = (app && app.children || []).find(c => c.tag === 'activity-alias' &&
      (c.attributes || []).some(a => a.key === 'name' && (a.value === name || pkg + a.value === name || pkg + '.' + a.value === name)));
    const tgt = al && (al.attributes || []).find(a => a.key === 'targetActivity');
    if (!tgt) return null;
    return tgt.value.startsWith('.') ? pkg + tgt.value : tgt.value.includes('.') ? tgt.value : pkg + '.' + tgt.value;
  }
  const descOf = cls => 'L' + cls.replace(/\./g, '/') + ';';

  async function gotoComponent({ name, tag, cls }, ax) {
    const fileName = ax.eval('session && session.name');
    const dw = dexFor(fileName);
    if (!dw) return;
    if (!cls) { toast(`${name}: activity-alias의 targetActivity를 찾지 못했습니다.`, 'warn'); return; }
    const desc = descOf(cls);
    // 확인은 axmlllm 탭에 머문 채로 — dex에 없으면 탭을 넘기지 않는다
    if (!await until(() => dw.eval('Module !== null && allClasses.length > 0'), { timeout: 60000 })) {
      toast('dexllm이 아직 분석 중입니다. 잠시 후 다시 클릭하세요.', 'warn'); return;
    }
    if (!dw.eval(`allClasses.includes(${JSON.stringify(desc)})`)) {
      toast(`${cls} — dex에 이 클래스가 없습니다. 매니페스트에만 선언된 컴포넌트입니다 ` +
        '(패킹·동적 로딩·split APK·미사용 선언 가능성).', 'warn');
      return;
    }
    show('dexllm');
    dw.navigateToClass(desc);
    toast(tag === 'activity-alias' ? `alias ${name} → ${cls}` : `${tag} → ${cls}`);
  }

  async function gotoPermission(perm, ax) {
    const fileName = ax.eval('session && session.name');
    const dw = dexFor(fileName);
    if (!dw) return;
    // 확인은 axmlllm 탭에 머문 채로 — dex permissions에 없으면 탭을 넘기지 않는다
    if (!await until(() => dw.eval('Module !== null && allClasses.length > 0 && !permPending'), { timeout: 120000 })) {
      toast('dexllm이 아직 권한 호출 분석 중입니다. 잠시 후 다시 클릭하세요.', 'warn'); return;
    }
    const q = JSON.stringify(perm);
    const level = dw.eval(`permIndex.find(p => p.perm === ${q})?.level`);
    if (!level) {
      toast(`${perm.replace(/^android\.permission\./, '')} — dexllm permissions에 없습니다: dex에서 이 권한으로 보호되는 API 호출을 찾지 못했습니다. ` +
        '선언만 됐거나 리플렉션·네이티브·동적 코드로 호출될 수 있습니다(정적 분석 범위 밖).', 'warn');
      return;
    }
    show('dexllm');
    const d = dw.document;
    dw.eval(`activePermLevels.add(${JSON.stringify(level)})`);   // 레벨 칩으로 숨겨져 있으면 다시 켠다
    dw.eval('permTab = "perms"');
    d.getElementById('permfilter').value = perm;
    // input 이벤트 대신 직접 렌더 — 디바운스 재렌더가 아래에서 펼친 행을 다시 접지 않게
    dw.renderPermPanel();
    // 이 권한 헤더 아래 행만 펼치고, 첫 호출 클래스로 이동 (나머지는 패널에서 고른다)
    const body = d.getElementById('permpanelbody');
    let inPerm = false, first = null;
    for (const el of [...body.children]) {
      if (el.classList.contains('permhd') || el.classList.contains('permlvlhd')) { inPerm = el.title === perm; continue; }
      if (!inPerm) continue;
      const row = el.querySelector('.iocitem');
      const sub = el.querySelector('.isub');
      if (row && sub && sub.style.display === 'none') row.onclick();
      if (!first) first = el.querySelector('.isubitem');
    }
    const hd = [...body.querySelectorAll('.permhd')].find(h => h.title === perm);
    if (hd) hd.scrollIntoView({ block: 'start' });
    if (first) first.click();
    toast(`${perm.replace(/^android\.permission\./, '')} → dexllm permissions 패널`);
  }

  // ── dexllm 근거 → axmlllm 표 (하이라이트 + evidence-first 정렬) ──
  // Components: 구현 클래스가 dex에 있으면 hit, 없으면 miss(매니페스트에만 선언 — 패킹/동적 로딩 단서)
  // Permissions: dex에 그 권한으로 보호되는 API 호출이 있으면 hit (API 수 · 호출 클래스 수)
  // 배지는 ::after(attr)로만 그린다 — 셀 textContent가 그대로라 axmlllm의 복사·클릭 이동에 영향 없음.
  let evSort = localStorage.getItem('suite.evsort') !== 'off';

  async function annotateAxml(fileName, gen) {
    let ax, dw;
    const ready = await until(() =>
      (ax = win('axmlllm')) && (dw = win('dexllm')) && fileOf.dexllm === fileName &&
      ax.eval('session && session.name') === fileName &&
      ax.document.getElementById('status').className === 'ready' &&
      dw.document.getElementById('status').textContent.startsWith(fileName) &&
      dw.eval('Module !== null && !permPending'), { gen, timeout: 300000 });
    if (!ready) return;
    const classes = dw.eval('new Set(allClasses)');
    const permEv = JSON.parse(dw.eval(`JSON.stringify((() => {
      const m = {};
      for (const p of permIndex) {
        const e = m[p.perm] || (m[p.perm] = { apis: 0, cls: new Set() });
        e.apis++;
        for (const c of p.callers) e.cls.add(c.split('->')[0]);
      }
      return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { apis: v.apis, classes: v.cls.size }]));
    })())`));
    const d = ax.document;
    const rows = id => [...d.getElementById(id).rows].filter(r => r.cells[0] && r.cells[0].matches('td.mono'));

    let ch = 0, ct = 0;
    rows('comps').forEach((r, i) => {
      const td = r.cells[0], { tag, cls } = compRow(r, ax);
      const alias = tag === 'activity-alias';
      r.dataset.suiteIdx = i; ct++;
      if (alias) {   // target_activity 칸도 같은 색으로 — 어느 클래스와 매칭했는지 보이게
        const ti = [...r.closest('table').rows[0].cells].findIndex(c => c.textContent.trim() === 'target_activity');
        if (ti >= 0 && r.cells[ti]) r.cells[ti].classList.add('suite-target');
      }
      if (cls && classes.has(descOf(cls))) {
        r.dataset.suiteEv = 'hit'; r.dataset.suiteRank = 0; ch++;
        td.dataset.suiteBadge = alias ? 'dex ✓ target' : 'dex ✓';
        td.title = alias ? `alias가 띄우는 ${cls}가 dex에 있음 — 클릭하면 dexllm에서 연다`
                         : 'dex에 구현 클래스가 있음 — 클릭하면 dexllm에서 연다';
      } else {
        r.dataset.suiteEv = 'miss'; r.dataset.suiteRank = 1;
        td.dataset.suiteBadge = alias ? (cls ? 'target dex에 없음' : 'target 불명') : 'dex에 없음';
        td.title = alias ? (cls ? `alias가 띄우는 ${cls}가 dex에 없음 — 패킹·동적 로딩 단서` : 'targetActivity를 정적으로 확정할 수 없음')
                         : 'dex에 구현 클래스가 없음 — 매니페스트에만 선언 (패킹·동적 로딩·split APK·미사용 선언 가능성)';
      }
    });
    let ph = 0, pt = 0;
    rows('perms').forEach((r, i) => {
      const td = r.cells[0], e = permEv[td.textContent.trim()];
      r.dataset.suiteIdx = i; pt++;
      if (e) {
        r.dataset.suiteEv = 'hit'; r.dataset.suiteRank = -e.classes; ph++;
        td.dataset.suiteBadge = `${e.apis} API · ${e.classes} class`;
        td.title = `dex에서 이 권한으로 보호되는 API ${e.apis}개를 ${e.classes}개 클래스가 호출 — 클릭하면 dexllm permissions 패널`;
      } else {
        delete r.dataset.suiteEv; r.dataset.suiteRank = 1;
        delete td.dataset.suiteBadge;
        td.title = 'dex에서 이 권한으로 보호되는 API 호출을 찾지 못함 (선언만 됐거나 리플렉션·네이티브·동적 코드)';
      }
    });
    for (const [id, hit, tot] of [['comps', ch, ct], ['perms', ph, pt]]) {
      const c = d.getElementById('suite-evcount-' + id);
      if (c) c.textContent = `dex 근거 ${hit}/${tot}`;
    }
    applySort(ax);
  }

  // evidence first: 근거 순(Components: dex에 있음 → 없음, Permissions: 호출 클래스 많은 순 → 없음), 같으면 원래 순서
  function applySort(ax) {
    const d = ax.document;
    const cmp = (a, b) => (evSort ? (+a.dataset.suiteRank) - (+b.dataset.suiteRank) : 0) || a.dataset.suiteIdx - b.dataset.suiteIdx;
    for (const id of ['comps', 'perms']) {
      // 데이터가 아닌 행(머리행, axmlllm의 종류별 그룹 행 tr.grp)을 경계로 구간마다 정렬 — 행이 자기 그룹을 벗어나지 않게
      const all = [...d.getElementById(id).rows];
      let anchor = all[0], seg = [];
      const flush = () => { seg.sort(cmp); let a = anchor; for (const r of seg) { a.after(r); a = r; } seg = []; };
      for (const r of all.slice(1)) {
        if (r.dataset.suiteIdx !== undefined) seg.push(r);
        else { flush(); anchor = r; }
      }
      flush();
    }
    for (const b of d.querySelectorAll('.suite-evsort')) b.classList.toggle('on', evSort);
  }

  // ── iframe 훅 ──
  const AXML_CSS = `
    #comps tr td.mono:first-child, #perms tr td.mono:first-child { cursor: pointer; }
    #comps tr td.mono:first-child:hover, #perms tr td.mono:first-child:hover {
      color: var(--brand, #a78bfa); text-decoration: underline; text-underline-offset: 3px;
    }
    #comps tr[data-suite-ev=hit] td.mono:first-child, #perms tr[data-suite-ev=hit] td.mono:first-child {
      color: #5fdca0; box-shadow: inset 3px 0 0 #5fdca0;
    }
    #comps tr[data-suite-ev=miss] td.mono:first-child { color: #f0b429; box-shadow: inset 3px 0 0 #f0b429; }
    #comps tr[data-suite-ev=hit] td.suite-target { color: #5fdca0; }
    #comps tr[data-suite-ev=miss] td.suite-target { color: #f0b429; }
    /* 근거가 확인된 뒤 dex에 없는 행은 이동하지 않는다 — 클릭 가능해 보이지 않게 */
    #comps tr[data-suite-ev=miss] td.mono:first-child, #perms tr[data-suite-idx]:not([data-suite-ev]) td.mono:first-child {
      cursor: help; text-decoration: none !important;
    }
    #perms tr[data-suite-idx]:not([data-suite-ev]) td.mono:first-child:hover { color: inherit; }
    td.mono:first-child[data-suite-badge]::after {
      content: attr(data-suite-badge); display: inline-block; margin-left: 10px; padding: 0 7px; border-radius: 999px;
      font: 600 10px/1.7 var(--f-ui, sans-serif); letter-spacing: .02em; vertical-align: 1px; text-decoration: none;
      color: #5fdca0; background: rgba(95,220,160,.12); box-shadow: inset 0 0 0 1px rgba(95,220,160,.35);
    }
    tr[data-suite-ev=miss] td.mono:first-child[data-suite-badge]::after {
      color: #f0b429; background: rgba(240,180,41,.12); box-shadow: inset 0 0 0 1px rgba(240,180,41,.4);
    }
    .suite-evsort {
      border: 0; cursor: pointer; border-radius: 999px; padding: 2px 9px; margin-left: 10px; vertical-align: 1px;
      font: 600 10px/1.6 var(--f-ui, sans-serif); letter-spacing: .04em; text-transform: uppercase;
      color: var(--fg-3, #888); background: var(--bg-1, #111); box-shadow: inset 0 0 0 1px var(--line-2, #333);
    }
    .suite-evsort:hover { color: var(--fg, #eee); }
    .suite-evsort.on { color: var(--brand, #a78bfa); box-shadow: inset 0 0 0 1px var(--brand, #a78bfa); }
    .suite-hint { font-size: 11px; font-weight: 400; color: var(--fg-3, #888); margin-left: 8px; text-transform: none; letter-spacing: 0; }
  `;
  function hookAxml(w) {
    const d = w.document;
    if (d.getElementById('suite-css')) return;
    const st = d.createElement('style');
    st.id = 'suite-css';
    st.textContent = AXML_CSS;
    d.head.appendChild(st);
    for (const [id, what] of [['perms', 'dexllm permissions 패널'], ['comps', 'dexllm 클래스']]) {
      const cnt = d.getElementById(id === 'perms' ? 'perm-count' : 'comp-count');   // 섹션 <h2> 안의 개수 표시
      if (cnt) cnt.insertAdjacentHTML('afterend',
        `<button class="suite-evsort" type="button" title="dexllm 근거가 있는 행을 위로 (Components: dex에 클래스 있음, Permissions: 호출 클래스 많은 순). 끄면 매니페스트 순서">⚑ dex evidence first</button>` +
        `<span class="suite-hint">이름 클릭 → ${what} · <span id="suite-evcount-${id}">dex 근거: dexllm 분석 후 표시</span></span>`);
    }
    d.addEventListener('click', e => {
      if (!e.target.closest || !e.target.closest('.suite-evsort')) return;
      e.stopPropagation();
      evSort = !evSort;
      localStorage.setItem('suite.evsort', evSort ? 'on' : 'off');
      applySort(w);
    }, true);
    d.addEventListener('click', e => {
      if (!w.getSelection().isCollapsed) return;   // 드래그 선택은 이동하지 않음
      const td = e.target.closest && e.target.closest('#comps td.mono:first-child, #perms td.mono:first-child');
      if (!td) return;
      if (!td.textContent.trim()) return;
      if (td.closest('#comps')) gotoComponent(compRow(td.parentElement, w), w);
      else gotoPermission(td.textContent.trim(), w);
    });
  }

  return {
    toast,
    manifestFacts,
    hook(name, f) {
      if (name === 'axmlllm') hookAxml(f.contentWindow);
    },
    // 셸이 도구에 파일을 넣었을 때(또는 도구가 스스로 열었을 때) 알린다
    opened(name, fileName, gen) {
      fileOf[name] = fileName;
      curGen = gen;
      if ((name === 'axmlllm' || name === 'apkllm') && syncedGen !== gen) {
        syncedGen = gen;
        syncManifestToApk(fileName, gen);
      }
      if ((name === 'axmlllm' || name === 'dexllm') && annotGen !== gen) {
        annotGen = gen;
        annotateAxml(fileName, gen);
      }
    },
  };
})();
