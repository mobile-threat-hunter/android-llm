// 셸 테마 — 다크 전용(라이트 모드 없음). 색 토큰은 index.html :root, 도구 iframe은 각 도구의 자체 다크 화면 그대로.
// 이 파일은 홈 배경(매트릭스 레인)만 그린다.
(function () {
  try { localStorage.removeItem('suite.theme'); } catch (_) { /* 예전 라이트 설정 정리 */ }

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
      ctx.fillStyle = 'rgba(0,0,0,.18)';   // 잔상
      ctx.fillRect(0, 0, w, h);
      ctx.font = `${FS}px ui-monospace, monospace`;
      for (let i = 0; i < cols.length; i++) {
        const y = cols[i] * FS;
        ctx.fillStyle = Math.random() < .08 ? '#a5f3fc' : '#22d3ee';
        ctx.fillText(Math.random() < .5 ? '0' : '1', i * FS, y);
        if (y > h && Math.random() > .975) cols[i] = 0;
        cols[i] += .55 + (i % 3) * .2;
      }
    };
    resize();
    requestAnimationFrame(frame);
  }

  document.addEventListener('DOMContentLoaded', matrix);
})();
