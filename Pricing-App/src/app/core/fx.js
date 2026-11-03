/* ================= CORE · FX: the sign-in screen's drifting dots =================
 * Screens: the sign-in screen only — the canvas sellFx behind the sign-in card.
 * Does: draws faint dots drifting slowly across the canvas, joined by thin lines when two come close.
 * About one dot per 26,000 px² (at most 45, or 25 under 900px wide), lines under 130px, at most 30
 * frames a second, and never sharper than 1.5 device pixels per pixel. The colours are the theme's
 * --fx-dot / --fx-line, read again whenever the theme or the computer's colour scheme changes.
 * It RUNS ONLY WHILE THE CANVAS IS ON SCREEN: an IntersectionObserver starts and stops the loop, and it
 * stops while the tab is hidden. Once somebody has signed in the screen is display:none, so nothing
 * runs at all — no loop, no timer. With reduced motion it draws one still frame.
 * Touches nothing but that canvas, takes no mouse or touch input, and every part is inside try/catch:
 * if anything fails, the background is simply left plain. Everything sits inside the one function
 * below, so it adds no name to the app's shared scope. */
(() => {
  try {
    const cv = document.getElementById('sellFx');
    const ctx = cv && cv.getContext ? cv.getContext('2d') : null;
    if (!ctx || !window.IntersectionObserver || !window.requestAnimationFrame) return;
    const mq = q => (window.matchMedia ? window.matchMedia(q) : null);
    const still = mq('(prefers-reduced-motion: reduce)');
    const scheme = mq('(prefers-color-scheme: dark)');
    const LINK = 130, FRAME = 1000 / 30;
    let dots = [], w = 0, h = 0, dot = '', line = '', raf = 0, last = 0, seen = false, timer = 0, dead = false;

    // Stop for good: the loop, the timer, the canvas cleared.
    const stop = () => {
      dead = true;
      if (raf) cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
      raf = timer = 0;
      try { ctx.clearRect(0, 0, cv.width, cv.height); } catch (e) {}
    };
    // Every callback goes through this, so a failure inside one stops the effect instead of throwing.
    const safe = fn => (...args) => { if (dead) return; try { fn(...args); } catch (e) { stop(); } };

    // --- the theme's two colours ---
    const colours = () => {
      const cs = getComputedStyle(cv);
      dot = cs.getPropertyValue('--fx-dot').trim() || 'rgba(127,127,127,.3)';
      line = cs.getPropertyValue('--fx-line').trim() || 'rgba(127,127,127,.1)';
    };
    // --- size the canvas to its box, and scatter the dots afresh ---
    const size = () => {
      const box = cv.getBoundingClientRect();
      w = Math.max(1, Math.round(box.width));
      h = Math.max(1, Math.round(box.height));
      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.min(w < 900 ? 25 : 45, Math.max(6, Math.round((w * h) / 26000)));
      dots = Array.from({ length: n }, () => {
        const angle = Math.random() * Math.PI * 2, speed = 0.05 + Math.random() * 0.15;
        return { x: Math.random() * w, y: Math.random() * h, vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed, r: 1 + Math.random() * 1.2 };
      });
    };
    // --- one frame: the lines first, the dots over them ---
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      ctx.lineWidth = 1;
      ctx.strokeStyle = line;
      for (let i = 0; i < dots.length; i++) {
        for (let j = i + 1; j < dots.length; j++) {
          const dx = dots[i].x - dots[j].x, dy = dots[i].y - dots[j].y, d = Math.sqrt(dx * dx + dy * dy);
          if (d >= LINK) continue;
          ctx.globalAlpha = 1 - d / LINK;
          ctx.beginPath();
          ctx.moveTo(dots[i].x, dots[i].y);
          ctx.lineTo(dots[j].x, dots[j].y);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = dot;
      dots.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      });
    };
    // --- move every dot one step, turning back at the edges ---
    const move = () => dots.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0 || p.x > w) { p.vx = -p.vx; p.x = Math.max(0, Math.min(w, p.x)); }
      if (p.y < 0 || p.y > h) { p.vy = -p.vy; p.y = Math.max(0, Math.min(h, p.y)); }
    });

    // --- the loop: only while on screen, the tab is showing and motion is welcome ---
    const moving = () => seen && !document.hidden && !(still && still.matches);
    const frame = safe(t => {
      raf = 0;
      if (!moving()) return;
      raf = requestAnimationFrame(frame);
      if (t - last < FRAME) return;
      last = t;
      move();
      draw();
    });
    // Start or stop the loop to match; when it is not moving but on screen, leave one still frame.
    const sync = () => {
      if (moving()) { if (!raf) raf = requestAnimationFrame(frame); return; }
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (seen) draw();
    };

    // On screen or off it (it goes off when the sign-in screen is hidden).
    new IntersectionObserver(safe(entries => {
      const now = entries[entries.length - 1].isIntersecting;
      if (now && !seen) {
        seen = true;
        colours();
        const box = cv.getBoundingClientRect();
        if (Math.round(box.width) !== w || Math.round(box.height) !== h || !dots.length) size();
      } else if (!now) {
        seen = false;
        if (timer) clearTimeout(timer);
        timer = 0;
      }
      sync();
    })).observe(cv);
    document.addEventListener('visibilitychange', safe(sync));
    if (still) (still.addEventListener ? still.addEventListener('change', safe(sync)) : still.addListener(safe(sync)));
    // The theme changed — on the switch (data-theme on <html>) or on the computer: new colours.
    const recolour = safe(() => { if (!seen) return; colours(); if (!moving()) draw(); });
    new MutationObserver(recolour).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    if (scheme) (scheme.addEventListener ? scheme.addEventListener('change', recolour) : scheme.addListener(recolour));
    // A resize, settled for 200ms, re-sizes the canvas — only while the screen is showing.
    window.addEventListener('resize', safe(() => {
      if (!seen) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(safe(() => { timer = 0; size(); sync(); }), 200);
    }));
  } catch (e) { /* a decoration only: if anything here fails, the sign-in background stays plain */ }
})();
