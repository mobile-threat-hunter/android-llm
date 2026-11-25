// 다크·라이트 테마 + 홈 배경(매트릭스 레인). <head>에서 동기로 실행 — 첫 페인트 전에 테마를 정해 깜빡임이 없게.
//   저장: localStorage "suite.theme" = "dark" | "light" (없으면 시스템 설정을 따른다)
//   도구 iframe: 세 도구가 같은 색 토큰(--bg·--bg-1~4·--line-1~3·--fg·--fg-2/3·--brand…, dexllm 체계)을 쓰므로
//   라이트일 때 그 토큰만 덮어쓴다 — 도구의 DOM 구조에는 기대지 않는다. 토큰 이름이 바뀌면 덮어쓰기가 무시될 뿐(다크로 보임).
(function () {
  const KEY = 'suite.theme';
  const mq = matchMedia('(prefers-color-scheme: light)');
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch (_) { /* 저장소 막힘 */ }
  const cur = () => saved || (mq.matches ? 'light' : 'dark');

  // 도구 화면용 라이트 토큰. 브랜드 색은 도구마다 유지(axmlllm 보라, dexllm·apkllm 파랑)하되 흰 바탕에서 읽히는 농도로.
  const LIGHT_BASE = `
    color-scheme: light;
    --bg:#f3f5f9; --bg-1:#ffffff; --bg-2:#ffffff; --bg-3:#eef2f7; --bg-4:#e3e9f2;
    --line-1:rgba(15,23,42,.07); --line-2:rgba(15,23,42,.12); --line-3:rgba(15,23,42,.2);
    --fg:#0f172a; --fg-2:#334155; --fg-3:#64748b; --muted:#64748b;
    --good:#059669; --warn:#b45309; --bad:#dc2626; --info:#0284c7;`;
  const LIGHT_BRAND = {
    blue: `--brand:#2563eb; --brand-2:#1d4ed8; --brand-3:#1e40af; --brand-rgb:37,99,235;
           --brand-soft:rgba(37,99,235,.08); --brand-glow:rgba(37,99,235,.25); --hl:rgba(37,99,235,.10); --hl-strong:rgba(37,99,235,.2);`,
    violet: `--brand:#7c3aed; --brand-2:#6d28d9; --brand-3:#5b21b6; --brand-rgb:124,58,237;
             --brand-soft:rgba(124,58,237,.08); --brand-glow:rgba(124,58,237,.25); --hl:rgba(124,58,237,.10); --hl-strong:rgba(124,58,237,.2);`,
  };
  const FRAME_BRAND = { axmlllm: 'violet', dexllm: 'blue', apkllm: 'blue' };
  const frameCss = (tool) => `:root{${LIGHT_BASE}${LIGHT_BRAND[FRAME_BRAND[tool] || 'blue']}}`;

  // 도구 CSS 중 토큰 대신 색을 직접 적은 선언(다크 전용: 검정 바탕 헤더, 흰 반투명 선, 파스텔 글자…)은
  // 같은 선택자로 "밝기만 뒤집은" 색을 다시 선언한다 — 색상·채도·투명도는 그대로. 선택자를 손으로 고르지 않으므로
  // 도구 화면 구조가 바뀌어도 따라간다. :root(토큰 정의)는 위 토큰으로 따로 덮으니 건너뛴다.
  const COLOR_PROPS = ['color', 'background', 'background-color', 'background-image', 'border-color', 'border-top-color',
    'border-right-color', 'border-bottom-color', 'border-left-color', 'border', 'border-top', 'border-bottom', 'border-left',
    'border-right', 'outline-color', 'box-shadow', 'text-shadow', 'fill', 'stroke', 'caret-color', 'text-decoration-color',
    'column-rule-color', 'accent-color'];
  const COLOR_RE = /#([0-9a-f]{3,8})\b|rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/gi;
  function flip(r, g, b) {   // HSL 밝기 반전
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    let h = 0, s = 0;
    if (d) {
      s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h /= 6;
    }
    const L = Math.min(.97, Math.max(.08, 1 - l));
    const q = L < .5 ? L * (1 + s) : L + s - L * s, p = 2 * L - q;
    const hue = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < .5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    return s ? [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)].map(x => Math.round(x * 255)) : [L, L, L].map(x => Math.round(x * 255));
  }
  function flipColors(v) {
    return v.replace(COLOR_RE, (m, hex, R, G, B, A) => {
      let r, g, b, a = 1;
      if (hex) {
        const x = hex.length <= 4 ? hex.split('').map(c => c + c).join('') : hex;
        r = parseInt(x.slice(0, 2), 16); g = parseInt(x.slice(2, 4), 16); b = parseInt(x.slice(4, 6), 16);
        if (x.length === 8) a = parseInt(x.slice(6, 8), 16) / 255;
      } else { r = +R; g = +G; b = +B; if (A != null) a = A.endsWith('%') ? parseFloat(A) / 100 : +A; }
      const [x, y, z] = flip(r, g, b);
      return a === 1 ? `rgb(${x},${y},${z})` : `rgba(${x},${y},${z},${+a.toFixed(3)})`;
    });
  }
  function adaptRules(rules, out) {
    for (const r of rules) {
      if (r.cssRules && !r.selectorText) {   // @media 등
        const inner = []; adaptRules(r.cssRules, inner);
        if (inner.length && r.conditionText != null) out.push(`@media ${r.conditionText}{${inner.join('')}}`);
        continue;
      }
      if (!r.style || !r.selectorText || /(^|,)\s*:root\s*($|,)/.test(r.selectorText)) continue;
      const decl = [];
      for (const prop of COLOR_PROPS) {
        const v = r.style.getPropertyValue(prop);
        if (!v || !COLOR_RE.test(v)) { COLOR_RE.lastIndex = 0; continue; }
        COLOR_RE.lastIndex = 0;
        // 불투명한 브랜드·상태색 위의 흰 글자(버튼)는 그대로 둔다 — 반투명 강조(--hl·rgba) 위의 흰 글자는 뒤집는다
        if (prop === 'color' && /^(#fff(fff)?|white|rgb\(255, 255, 255\))$/i.test(v.trim()) &&
            /var\(--(brand|brand-2|brand-3|accent|accent-2|good|bad|warn)\)/.test(r.style.getPropertyValue('background') + r.style.getPropertyValue('background-color') + r.style.getPropertyValue('background-image'))) continue;
        decl.push(`${prop}:${flipColors(v)}${r.style.getPropertyPriority(prop) ? ' !important' : ''}`);
      }
      if (decl.length) out.push(`${r.selectorText}{${decl.join(';')}}`);
    }
  }
  const adapted = new WeakMap();   // document → 뒤집은 CSS (도구 CSS는 정적이라 한 번)
  function lightAdapter(d) {
    if (adapted.has(d)) return adapted.get(d);
    const out = [];
    for (const sh of d.styleSheets) {
      const own = sh.ownerNode && (sh.ownerNode.id === 'suite-theme' || sh.ownerNode.id === 'suite-css');
      if (own) continue;
      try { adaptRules(sh.cssRules, out); } catch (_) { /* 다른 출처 시트 */ }
    }
    const css = out.join('\n');
    adapted.set(d, css);
    return css;
  }

  function themeFrame(f) {
    try {
      const d = f.contentDocument;
      if (!d || !d.head) return;
      const tool = (f.closest('.view') || {}).id?.replace('view-', '');
      let st = d.getElementById('suite-theme');
      if (!st) { st = d.createElement('style'); st.id = 'suite-theme'; }
      d.head.appendChild(st);   // 매번 맨 뒤로 — 도구가 나중에 넣은 :root보다 뒤에 있어야 이긴다
      st.textContent = cur() === 'light' ? frameCss(tool) + '\n' + lightAdapter(d) : '';
      d.documentElement.dataset.suiteTheme = cur();
    } catch (_) { /* cross-origin이면 건너뜀 */ }
  }

  function apply() {
    const t = cur();
    document.documentElement.dataset.theme = t;
    const b = document.getElementById('themebtn');
    if (b) { b.textContent = t === 'light' ? '☀' : '☾'; b.title = `테마: ${t === 'light' ? '라이트' : '다크'} — 클릭해 전환${saved ? '' : ' (시스템 설정 따름)'}`; }
    document.querySelectorAll('.view iframe').forEach(themeFrame);
  }

  function set(t) {
    saved = t === 'light' || t === 'dark' ? t : null;
    try { saved ? localStorage.setItem(KEY, saved) : localStorage.removeItem(KEY); } catch (_) {}
    apply();
  }

  mq.addEventListener('change', () => { if (!saved) apply(); });
  document.documentElement.dataset.theme = cur();
  window.SuiteTheme = { get: cur, set, toggle: () => set(cur() === 'light' ? 'dark' : 'light'), frame: themeFrame };

  // ── 홈 배경: 매트릭스 디지털 레인(VoiceX) — 홈이 보이고 탭이 보일 때만 그린다 ──
  function matrix() {
    const cv = document.getElementById('matrix'), home = document.getElementById('view-home');
    if (!cv || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = cv.getContext('2d');
    const FS = 14;
    let cols = [], w = 0, h = 0, last = 0;
    const resize = () => {
      const r = devicePixelRatio || 1;
      w = cv.clientWidth; h = cv.clientHeight;
      cv.width = w * r; cv.height = h * r; ctx.setTransform(r, 0, 0, r, 0, 0);
      cols = Array.from({ length: Math.ceil(w / FS) }, () => Math.random() * -h / FS);
    };
    const frame = (t) => {
      requestAnimationFrame(frame);
      if (!home.classList.contains('active') || document.hidden || t - last < 55) return;
      last = t;
      if (cv.clientWidth !== w || cv.clientHeight !== h) resize();
      const light = cur() === 'light';
      ctx.fillStyle = light ? 'rgba(243,245,249,.22)' : 'rgba(0,0,0,.18)';   // 잔상
      ctx.fillRect(0, 0, w, h);
      ctx.font = `${FS}px ui-monospace, monospace`;
      for (let i = 0; i < cols.length; i++) {
        const y = cols[i] * FS;
        ctx.fillStyle = Math.random() < .08 ? (light ? '#0891b2' : '#a5f3fc') : (light ? '#2563eb' : '#22d3ee');
        ctx.fillText(Math.random() < .5 ? '0' : '1', i * FS, y);
        if (y > h && Math.random() > .975) cols[i] = 0;
        cols[i] += .55 + (i % 3) * .2;
      }
    };
    resize();
    requestAnimationFrame(frame);
  }

  document.addEventListener('DOMContentLoaded', () => {
    apply();
    const b = document.getElementById('themebtn');
    if (b) b.addEventListener('click', () => window.SuiteTheme.toggle());
    matrix();
  });
})();
