// 도구 간 연동 — 셸이 same-origin iframe의 DOM과 전역(함수·let 바인딩)을 직접 쓴다.
// 도구 저장소는 손대지 않는다. 도구 쪽 이름이 바뀌면 이 파일만 고칠 것 (CLAUDE.md 참고).
//
//   axmlllm → apkllm   매니페스트 사실(extractNativeLibs · targetSdk · split 여부)을 Gate 입력에 자동 기입
//   axmlllm → dexllm   Components 행 클릭 → 해당 클래스 디컴파일
//                      Permissions 행 클릭 → dexllm permissions 패널(그 권한의 gated API → 호출 클래스)
//
// 셸(index.html)이 쓰는 진입점: Bridge.hook(name, iframe), Bridge.opened(name, fileName, gen)
const Bridge = (() => {
  const win = name => {
    const f = document.querySelector(`#view-${name} iframe`);
    return f && f.contentWindow;
  };
  const fileOf = {};          // 도구별로 마지막에 연 파일 이름 (셸이 알려준 것)
  let curGen = 0, syncedGen = 0;

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

    const enl = attr(app, 'extractNativeLibs');
    if (!enl) f.enl = { v: true, why: '미선언 → 플랫폼 기본 true' };
    else if (enl.value === true || enl.value === false || enl.value === 'true' || enl.value === 'false')
      f.enl = { v: String(enl.value) === 'true', why: '선언값' };
    else f.enl = { v: null, why: `정적 확정 불가 (${enl.value})` };

    const isInt = a => a && Number.isInteger(Number(a.value)) && String(a.value).trim() !== '';
    const t = attr(sdk, 'targetSdkVersion'), m = attr(sdk, 'minSdkVersion');
    if (isInt(t)) f.tsdk = { v: Number(t.value), why: '선언값' };
    else if (t) f.tsdk = { v: null, why: `정적 확정 불가 (${t.value})` };
    else if (isInt(m)) f.tsdk = { v: Number(m.value), why: '미선언 → minSdkVersion' };
    else if (m) f.tsdk = { v: null, why: `정적 확정 불가 (min ${m.value})` };
    else f.tsdk = { v: 1, why: '미선언 → 기본 1' };

    // <manifest split="…">가 없으면 base APK. split이면 isolatedSplits는 base 매니페스트에 있어 여기선 모름.
    const split = attr(root, 'split');
    f.arsc = split ? { v: null, why: `split APK (${split.value}) — 판단 불가` } : { v: true, why: 'base APK' };
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
    set('#in-arsc', facts.arsc.v);
    // gateParams()가 네 입력을 모두 읽으므로 change 한 번이면 rerunGate가 새 값으로 돈다
    d.querySelector('#in-enl').dispatchEvent(new ap.Event('change'));

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
      [show('extractNativeLibs', facts.enl), show('targetSdk', facts.tsdk), show('base AssetManager', facts.arsc)].join(' · ') +
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

  async function gotoComponent(name, tag, ax) {
    const fileName = ax.eval('session && session.name');
    const dw = dexFor(fileName);
    if (!dw) return;
    let cls = name;
    if (tag === 'activity-alias') {
      // alias 자체는 클래스가 아니다 — targetActivity로 간다
      const pkg = ax.eval('last.tree.root.attributes.find(a => a.key === "package")?.value') || '';
      const app = (ax.eval('last.tree.root.children') || []).find(c => c.tag === 'application');
      const al = (app && app.children || []).find(c => c.tag === 'activity-alias' &&
        (c.attributes || []).some(a => a.key === 'name' && (a.value === name || pkg + a.value === name || pkg + '.' + a.value === name)));
      const tgt = al && (al.attributes || []).find(a => a.key === 'targetActivity');
      if (!tgt) { toast(`${name}: activity-alias의 targetActivity를 찾지 못했습니다.`, 'warn'); return; }
      cls = tgt.value.startsWith('.') ? pkg + tgt.value : tgt.value.includes('.') ? tgt.value : pkg + '.' + tgt.value;
    }
    const desc = 'L' + cls.replace(/\./g, '/') + ';';
    show('dexllm');
    if (!await until(() => dw.eval('Module !== null && allClasses.length > 0'), { timeout: 60000 })) {
      toast('dexllm이 아직 분석 중입니다. 잠시 후 다시 클릭하세요.', 'warn'); return;
    }
    if (!dw.eval(`allClasses.includes(${JSON.stringify(desc)})`)) {
      toast(`${cls} — dex에 이 클래스가 없습니다. 매니페스트에만 선언된 컴포넌트입니다 ` +
        '(패킹·동적 로딩·split APK·미사용 선언 가능성).', 'warn');
      return;
    }
    dw.navigateToClass(desc);
    toast(`${tag} → ${cls}`);
  }

  async function gotoPermission(perm, ax) {
    const fileName = ax.eval('session && session.name');
    const dw = dexFor(fileName);
    if (!dw) return;
    show('dexllm');
    if (!await until(() => dw.eval('Module !== null && allClasses.length > 0 && !permPending'), { timeout: 120000 })) {
      toast('dexllm이 아직 권한 호출 분석 중입니다. 잠시 후 다시 클릭하세요.', 'warn'); return;
    }
    const d = dw.document;
    const q = JSON.stringify(perm);
    const level = dw.eval(`permIndex.find(p => p.perm === ${q})?.level`);
    if (level) dw.eval(`activePermLevels.add(${JSON.stringify(level)})`);   // 레벨 칩으로 숨겨져 있으면 다시 켠다
    dw.eval('permTab = "perms"');
    const pf = d.getElementById('permfilter');
    pf.value = perm;
    // input 이벤트 대신 직접 렌더 — 디바운스 재렌더가 아래에서 펼친 행을 다시 접지 않게
    dw.renderPermPanel();
    if (!level) {
      toast(`${perm.replace(/^android\.permission\./, '')} — dex에서 이 권한으로 보호되는 API 호출을 찾지 못했습니다. ` +
        '선언만 됐거나 리플렉션·네이티브·동적 코드로 호출될 수 있습니다(정적 분석 범위 밖).', 'warn');
      return;
    }
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

  // ── iframe 훅 ──
  const AXML_CSS = `
    #comps tr td.mono:first-child, #perms tr td.mono:first-child { cursor: pointer; }
    #comps tr td.mono:first-child:hover, #perms tr td.mono:first-child:hover {
      color: var(--brand, #a78bfa); text-decoration: underline; text-underline-offset: 3px;
    }
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
      const h2 = d.getElementById(id)?.parentElement?.previousElementSibling;   // <h2> 바로 뒤 div.scroll > table
      const cnt = h2 && h2.querySelector('.muted');
      if (cnt) cnt.insertAdjacentHTML('afterend', `<span class="suite-hint">이름 클릭 → ${what}</span>`);
    }
    d.addEventListener('click', e => {
      if (!w.getSelection().isCollapsed) return;   // 드래그 선택은 이동하지 않음
      const td = e.target.closest && e.target.closest('#comps td.mono:first-child, #perms td.mono:first-child');
      if (!td) return;
      const name = td.textContent.trim(), tag = (td.parentElement.cells[1] || {}).textContent || '';
      if (!name) return;
      if (td.closest('#comps')) gotoComponent(name, tag.trim(), w);
      else gotoPermission(name, w);
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
    },
  };
})();
