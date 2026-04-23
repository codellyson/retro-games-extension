/* Breakout — endless mode, drag/arrow paddle, particles, power-ups.
   Exposes init(api) returning the standard game module interface. */

export const meta = {
  id: "breakout",
  name: "Breakout",
};

export async function init(api) {
  const { canvas, ctx, storage, audio, hud, overlay, getTheme, getDifficulty, onStatusChange } = api;

  const CFG = {
    paddle: { w: 110, h: 14, bottomMargin: 40 },
    ball: { r: 8, speed: 6 },
    brickRow: { h: 24, gap: 8, padX: 40, padTop: 60, cols: 9 },
  };

  const DIFFICULTIES = {
    easy:   { ballSpeed: 6.0, paddleScale: 1.25, levelRamp: 0.04, startLives: 5 },
    normal: { ballSpeed: 8.5, paddleScale: 1.00, levelRamp: 0.06, startLives: 3 },
    hard:   { ballSpeed: 11.0, paddleScale: 0.75, levelRamp: 0.09, startLives: 2 },
  };

  const PALETTES = {
    glassy: { rowHues: [200, 210, 220, 230, 240, 250, 190, 180] },
    neon: { rowColors: ["#ff2d95", "#ff7e2d", "#ffd23d", "#2ee8b2", "#4dc6ff", "#b07dff"] },
    paper: { ink: "#8a2a1a" },
  };

  let W = 1040;
  const ASPECT = 9 / 16;
  let H = Math.round(W * ASPECT);

  let paddleEffectMul = 1;
  let effectSpeedMul = 1;

  const keys = { left: false, right: false };
  let isDragging = false;
  let dragOffset = 0;

  const game = {
    paddleX: W / 2,
    ball: { x: W / 2, y: 0, vx: 0, vy: 0 },
    bricks: [],
    particles: [],
    capsules: [],
    effects: { widePaddle: 0, slowBall: 0 },
    status: "ready",
    score: 0,
    best: 0,
    level: 1,
    lives: 3,
    maxLives: 3,
    rowsSpawned: 0,
    speedMul: 1,
  };

  function diffCfg() {
    return DIFFICULTIES[getDifficulty()] || DIFFICULTIES.normal;
  }

  function recomputeSize(newW) {
    W = Math.max(480, Math.min(1600, newW | 0));
    H = Math.round(W * ASPECT);
    canvas.width = W;
    canvas.height = H;
    CFG.brickRow.cols = Math.max(7, Math.min(16, Math.round(W / 72)));
    CFG.paddle.w = Math.round(W * 0.17 * diffCfg().paddleScale * paddleEffectMul);
    game.paddleX = Math.max(CFG.paddle.w / 2, Math.min(W - CFG.paddle.w / 2, game.paddleX));
  }

  const SFX = {
    brick: (row) => audio.blip({ freq: 440 + row * 80, dur: 0.08, type: "square", gain: 0.18 }),
    wall: () => audio.blip({ freq: 220, dur: 0.05, type: "triangle", gain: 0.12 }),
    paddle: () => audio.blip({ freq: 180, dur: 0.07, type: "sine", gain: 0.2 }),
    launch: () => audio.blip({ freq: 330, dur: 0.12, type: "sawtooth", gain: 0.14, slide: 200 }),
    lose: () => {
      audio.blip({ freq: 300, dur: 0.2, type: "sawtooth", gain: 0.18, slide: -200 });
      setTimeout(() => audio.blip({ freq: 160, dur: 0.25, type: "sawtooth", gain: 0.18, slide: -80 }), 140);
    },
    levelUp: () => {
      [0, 80, 160].forEach((d, i) =>
        setTimeout(() => audio.blip({ freq: 440 + i * 120, dur: 0.1, type: "square", gain: 0.15 }), d)
      );
    },
  };

  // ---- Particles ----------------------------------------------------------
  function brickColor(b) {
    const theme = getTheme();
    if (theme === "neon") return PALETTES.neon.rowColors[b.row % 6];
    if (theme === "paper") return PALETTES.paper.ink;
    const hue = PALETTES.glassy.rowHues[b.row % 8];
    return `hsl(${hue}, 60%, 72%)`;
  }

  function spawnShatter(b) {
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const color = brickColor(b);
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 3;
      game.particles.push({
        x: cx + (Math.random() - 0.5) * b.w * 0.6,
        y: cy + (Math.random() - 0.5) * b.h * 0.6,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - 1.5,
        life: 30 + Math.random() * 15,
        max: 45,
        size: 2 + Math.random() * 2,
        color,
      });
    }
  }

  function stepParticles(dt) {
    const parts = game.particles;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.vy += 0.25 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0 || p.y > H + 20) parts.splice(i, 1);
    }
  }

  function renderParticles() {
    ctx.shadowBlur = 0;
    for (const p of game.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  // ---- Power-ups ----------------------------------------------------------
  const CAPSULE_COLORS = { wide: "#4dc6ff", slow: "#b07dff", life: "#2ee8b2" };
  const CAPSULE_LABELS = { wide: "W", slow: "S", life: "+" };
  const EFFECT_FRAMES = 900;

  function makeCapsule(x, y) {
    const r = Math.random();
    let type;
    if (r < 0.35) type = "wide";
    else if (r < 0.70) type = "slow";
    else type = "life";
    return { x, y, vy: 2.5, type };
  }

  function stepCapsules(dt) {
    const caps = game.capsules;
    const pY = H - CFG.paddle.bottomMargin;
    const pH = CFG.paddle.h;
    const pLeft = game.paddleX - CFG.paddle.w / 2;
    const pRight = game.paddleX + CFG.paddle.w / 2;
    for (let i = caps.length - 1; i >= 0; i--) {
      const c = caps[i];
      c.y += c.vy * dt;
      if (c.y + 8 >= pY && c.y - 8 <= pY + pH && c.x >= pLeft && c.x <= pRight) {
        applyPowerUp(c.type);
        caps.splice(i, 1);
        continue;
      }
      if (c.y > H + 20) caps.splice(i, 1);
    }
  }

  function applyPowerUp(type) {
    SFX.levelUp();
    if (type === "wide") {
      paddleEffectMul = 1.5;
      game.effects.widePaddle = EFFECT_FRAMES;
      recomputeSize(W);
    } else if (type === "slow") {
      effectSpeedMul = 0.6;
      game.effects.slowBall = EFFECT_FRAMES;
    } else if (type === "life") {
      game.lives += 1;
      if (game.lives > game.maxLives) game.maxLives = game.lives;
      hud.setLives(game.lives, game.maxLives);
    }
  }

  function stepEffects(dt) {
    if (game.effects.widePaddle > 0) {
      game.effects.widePaddle -= dt;
      if (game.effects.widePaddle <= 0) {
        paddleEffectMul = 1;
        recomputeSize(W);
      }
    }
    if (game.effects.slowBall > 0) {
      game.effects.slowBall -= dt;
      if (game.effects.slowBall <= 0) effectSpeedMul = 1;
    }
  }

  function renderCapsules() {
    ctx.shadowBlur = 0;
    ctx.font = "bold 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const c of game.capsules) {
      ctx.fillStyle = CAPSULE_COLORS[c.type];
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(c.x - 16, c.y - 9, 32, 18, 9);
      else ctx.rect(c.x - 16, c.y - 9, 32, 18);
      ctx.fill();
      ctx.fillStyle = "#0b1020";
      ctx.fillText(CAPSULE_LABELS[c.type], c.x, c.y + 1);
    }
  }

  // ---- Bricks -------------------------------------------------------------
  function makeRow(row) {
    const { cols, padX, gap, h } = CFG.brickRow;
    const totalGap = gap * (cols - 1);
    const brickW = (W - padX * 2 - totalGap) / cols;
    const out = [];
    for (let c = 0; c < cols; c++) {
      out.push({
        x: padX + c * (brickW + gap),
        y: row * (h + gap) + CFG.brickRow.padTop,
        w: brickW,
        h,
        row: game.rowsSpawned % 6,
        alive: true,
        jx: (Math.random() - 0.5) * 1.5,
        jy: (Math.random() - 0.5) * 1.5,
        jr: (Math.random() - 0.5) * 0.8,
      });
    }
    game.rowsSpawned++;
    return out;
  }

  function initBricks() {
    game.bricks = [];
    for (let r = 0; r < 5; r++) game.bricks.push(...makeRow(r));
  }

  function shiftAndSpawn() {
    const { h, gap } = CFG.brickRow;
    game.bricks = game.bricks.filter((b) => b.alive);
    const aliveRows = new Set(game.bricks.map((b) => Math.round(b.y)));
    if (aliveRows.size < 5) {
      const rowStep = h + gap;
      for (const b of game.bricks) b.y += rowStep;
      game.bricks.push(...makeRow(0));
      game.level = 1 + Math.floor(game.rowsSpawned / 5);
      hud.setLevel(game.level);
      game.speedMul = 1 + (game.level - 1) * diffCfg().levelRamp;
      SFX.levelUp();
    }
  }

  // ---- Status -------------------------------------------------------------
  function setStatus(s) {
    game.status = s;
    if (s === "ready") {
      if (game.lives < game.maxLives) {
        overlay.show(
          `${game.lives} ${game.lives === 1 ? "life" : "lives"} left`,
          "Click or press space to relaunch"
        );
      } else {
        overlay.show("Hold & drag to play", "Click the board to launch");
      }
    } else if (s === "playing") {
      overlay.hide();
    } else if (s === "paused") {
      overlay.show("Paused", "Press play or P to resume");
    } else if (s === "lost") {
      overlay.show("Game over", `Score ${game.score}   ·   Click to try again`);
    }
    onStatusChange?.(s);
  }

  function persistBest() {
    if (game.score > game.best) {
      game.best = game.score;
      hud.setBest(game.best);
      storage.set({ best: game.best });
    }
  }

  function resetGame() {
    game.paddleX = W / 2;
    game.ball = { x: W / 2, y: H - CFG.paddle.bottomMargin - 20, vx: 0, vy: 0 };
    game.score = 0;
    game.level = 1;
    game.rowsSpawned = 0;
    game.speedMul = 1;
    game.particles = [];
    game.capsules = [];
    game.effects = { widePaddle: 0, slowBall: 0 };
    paddleEffectMul = 1;
    effectSpeedMul = 1;
    game.maxLives = diffCfg().startLives;
    game.lives = game.maxLives;
    hud.setScore(0);
    hud.setLevel(1);
    hud.setLives(game.lives, game.maxLives);
    recomputeSize(W);
    initBricks();
    setStatus("ready");
  }

  function launch() {
    if (game.status === "lost") resetGame();
    if (game.status !== "ready") return;
    const sp = CFG.ball.speed * game.speedMul;
    game.ball.vx = sp * 0.6;
    game.ball.vy = -sp * 0.8;
    setStatus("playing");
    SFX.launch();
  }

  // ---- Physics ------------------------------------------------------------
  function stepPaddle(dt) {
    const speed = 12 * dt;
    const half = CFG.paddle.w / 2;
    if (keys.left) game.paddleX = Math.max(half, game.paddleX - speed);
    if (keys.right) game.paddleX = Math.min(W - half, game.paddleX + speed);
    if (game.status === "ready" && (keys.left || keys.right)) {
      game.ball.x = game.paddleX;
      game.ball.y = H - CFG.paddle.bottomMargin - 20;
    }
  }

  function stepPhysics(dt) {
    if (game.status !== "playing") return;
    let { x, y, vx, vy } = game.ball;
    const dx = vx * dt * effectSpeedMul;
    const dy = vy * dt * effectSpeedMul;
    x += dx;
    y += dy;
    const r = CFG.ball.r;

    let wallHit = false;
    if (x - r < 0) { x = r; vx = -vx; wallHit = true; }
    else if (x + r > W) { x = W - r; vx = -vx; wallHit = true; }
    if (y - r < 0) { y = r; vy = -vy; wallHit = true; }
    if (wallHit) SFX.wall();

    const pY = H - CFG.paddle.bottomMargin;
    const pW = CFG.paddle.w;
    const pH = CFG.paddle.h;
    const pLeft = game.paddleX - pW / 2;
    const pRight = game.paddleX + pW / 2;
    if (vy > 0 && y + r >= pY && y + r <= pY + pH + Math.abs(dy) && x >= pLeft - r && x <= pRight + r) {
      y = pY - r;
      const hit = (x - game.paddleX) / (pW / 2);
      const speed = Math.hypot(vx, vy);
      const angle = hit * (Math.PI / 3);
      vx = Math.sin(angle) * speed;
      vy = -Math.abs(Math.cos(angle) * speed);
      SFX.paddle();
    }

    if (y - r > H) {
      game.lives -= 1;
      hud.setLives(game.lives, game.maxLives);
      persistBest();
      SFX.lose();
      if (game.lives <= 0) {
        game.ball = { x, y, vx: 0, vy: 0 };
        setStatus("lost");
      } else {
        game.ball = { x: game.paddleX, y: H - CFG.paddle.bottomMargin - 20, vx: 0, vy: 0 };
        setStatus("ready");
      }
      return;
    }

    for (const b of game.bricks) {
      if (!b.alive) continue;
      if (x + r >= b.x && x - r <= b.x + b.w && y + r >= b.y && y - r <= b.y + b.h) {
        const prevX = x - dx;
        const prevY = y - dy;
        const wasLeft = prevX + r <= b.x;
        const wasRight = prevX - r >= b.x + b.w;
        const wasTop = prevY + r <= b.y;
        const wasBottom = prevY - r >= b.y + b.h;
        if (wasLeft || wasRight) vx = -vx;
        else if (wasTop || wasBottom) vy = -vy;
        else vy = -vy;
        b.alive = false;
        spawnShatter(b);
        if (Math.random() < 0.15) {
          game.capsules.push(makeCapsule(b.x + b.w / 2, b.y + b.h / 2));
        }
        game.score += 10 * game.level;
        hud.setScore(game.score);
        if (game.score > game.best) {
          game.best = game.score;
          hud.setBest(game.best);
        }
        SFX.brick(b.row);
        break;
      }
    }

    game.ball = { x, y, vx, vy };
    shiftAndSpawn();
  }

  // ---- Rendering ----------------------------------------------------------
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function renderGlassy() {
    const grad = ctx.createRadialGradient(W * 0.25, 0, 50, W * 0.25, 0, W * 1.1);
    grad.addColorStop(0, "#1b2340"); grad.addColorStop(0.55, "#0b1020"); grad.addColorStop(1, "#070914");
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
    const g1 = ctx.createRadialGradient(W * 0.35, -50, 10, W * 0.35, -50, 300);
    g1.addColorStop(0, "rgba(120,180,255,0.22)"); g1.addColorStop(1, "rgba(120,180,255,0)");
    ctx.fillStyle = g1; ctx.fillRect(0, 0, W, H);

    for (const b of game.bricks) {
      if (!b.alive) continue;
      const hue = PALETTES.glassy.rowHues[b.row % 8];
      const bg = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
      bg.addColorStop(0, `oklch(0.72 0.08 ${hue} / 0.45)`);
      bg.addColorStop(1, `oklch(0.5 0.08 ${hue} / 0.2)`);
      ctx.fillStyle = bg;
      roundRect(b.x, b.y, b.w, b.h, 6); ctx.fill();
      ctx.strokeStyle = `oklch(0.88 0.08 ${hue} / 0.6)`; ctx.lineWidth = 1; ctx.stroke();
    }

    const pY = H - CFG.paddle.bottomMargin;
    ctx.shadowColor = "rgba(180,210,255,0.8)"; ctx.shadowBlur = 18;
    const bg = ctx.createRadialGradient(game.ball.x - 2, game.ball.y - 2, 1, game.ball.x, game.ball.y, CFG.ball.r);
    bg.addColorStop(0, "rgba(255,255,255,0.95)"); bg.addColorStop(0.5, "rgba(180,210,255,0.85)"); bg.addColorStop(1, "rgba(120,160,230,0.9)");
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.arc(game.ball.x, game.ball.y, CFG.ball.r, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;

    ctx.shadowColor = "rgba(120,160,230,0.4)"; ctx.shadowBlur = 16;
    const pg = ctx.createLinearGradient(0, pY, 0, pY + CFG.paddle.h);
    pg.addColorStop(0, "rgba(255,255,255,0.4)"); pg.addColorStop(1, "rgba(255,255,255,0.15)");
    ctx.fillStyle = pg;
    roundRect(game.paddleX - CFG.paddle.w / 2, pY, CFG.paddle.w, CFG.paddle.h, CFG.paddle.h / 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 1; ctx.stroke();
    ctx.shadowBlur = 0;

    renderCapsules();
    renderParticles();
  }

  function renderNeon() {
    ctx.fillStyle = "#07060f"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(255,255,255,0.025)";
    for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);

    ctx.lineWidth = 1.5;
    for (const b of game.bricks) {
      if (!b.alive) continue;
      const c = PALETTES.neon.rowColors[b.row % 6];
      ctx.strokeStyle = c; ctx.shadowColor = c; ctx.shadowBlur = 10;
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.shadowBlur = 0;
      ctx.fillStyle = c + "15"; ctx.fillRect(b.x, b.y, b.w, b.h);
    }

    const pY = H - CFG.paddle.bottomMargin;
    ctx.shadowColor = "#4dc6ff"; ctx.shadowBlur = 24; ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(game.ball.x, game.ball.y, CFG.ball.r, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;

    ctx.shadowColor = "#2ee8b2"; ctx.shadowBlur = 16; ctx.fillStyle = "#2ee8b2";
    ctx.fillRect(game.paddleX - CFG.paddle.w / 2, pY, CFG.paddle.w, CFG.paddle.h);
    ctx.shadowBlur = 0;

    renderCapsules();
    renderParticles();
  }

  function renderPaper() {
    const INK = PALETTES.paper.ink;
    ctx.fillStyle = "#f4efe3"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(138,42,26,0.12)";
    for (let x = 6; x < W; x += 12)
      for (let y = 6; y < H; y += 12) {
        ctx.beginPath(); ctx.arc(x, y, 1, 0, Math.PI * 2); ctx.fill();
      }
    ctx.lineWidth = 1.5; ctx.strokeStyle = INK; ctx.fillStyle = "rgba(138,42,26,0.08)";
    for (const b of game.bricks) {
      if (!b.alive) continue;
      ctx.save();
      ctx.translate(b.x + b.w / 2 + b.jx, b.y + b.h / 2 + b.jy);
      ctx.rotate((b.jr * Math.PI) / 180);
      ctx.translate(-b.w / 2, -b.h / 2);
      roundRect(0, 0, b.w, b.h, 3); ctx.fill(); ctx.stroke();
      ctx.restore();
    }

    const pY = H - CFG.paddle.bottomMargin;
    ctx.fillStyle = "rgba(138,42,26,0.15)"; ctx.strokeStyle = INK; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.arc(game.ball.x, game.ball.y, CFG.ball.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

    ctx.fillStyle = "rgba(138,42,26,0.12)"; ctx.lineWidth = 1.8;
    roundRect(game.paddleX - CFG.paddle.w / 2, pY, CFG.paddle.w, CFG.paddle.h, 2);
    ctx.fill(); ctx.stroke();

    renderCapsules();
    renderParticles();
  }

  function render() {
    const t = getTheme();
    if (t === "neon") renderNeon();
    else if (t === "paper") renderPaper();
    else renderGlassy();
  }

  // ---- Input --------------------------------------------------------------
  function canvasXFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const scale = W / rect.width;
    const clientX = e.touches?.[0]?.clientX ?? e.clientX;
    return (clientX - rect.left) * scale;
  }

  function onPointer(kind, e) {
    if (kind === "down") {
      canvas.setPointerCapture?.(e.pointerId);
      const x = canvasXFromEvent(e);
      const half = CFG.paddle.w / 2;
      if (Math.abs(x - game.paddleX) <= half + 10 && e.clientY) {
        dragOffset = x - game.paddleX;
      } else {
        dragOffset = 0;
        game.paddleX = Math.max(half, Math.min(W - half, x));
      }
      isDragging = true;
      if (game.status === "ready" || game.status === "lost") launch();
    } else if (kind === "move") {
      if (!isDragging) return;
      const x = canvasXFromEvent(e);
      const half = CFG.paddle.w / 2;
      game.paddleX = Math.max(half, Math.min(W - half, x - dragOffset));
      if (game.status === "ready") {
        game.ball.x = game.paddleX;
        game.ball.y = H - CFG.paddle.bottomMargin - 20;
      }
    } else {
      isDragging = false;
    }
  }

  function onKey(e, isDown) {
    if (e.key === " ") {
      if (isDown) { e.preventDefault(); launch(); }
    } else if (e.key === "ArrowLeft") {
      keys.left = isDown;
      if (isDown) e.preventDefault();
    } else if (e.key === "ArrowRight") {
      keys.right = isDown;
      if (isDown) e.preventDefault();
    }
  }

  // ---- Lifecycle ----------------------------------------------------------
  function step(dt) {
    stepPaddle(dt);
    stepPhysics(dt);
    stepParticles(dt);
    stepCapsules(dt);
    stepEffects(dt);
  }

  function togglePause() {
    if (game.status === "ready" || game.status === "lost") {
      launch();
    } else if (game.status === "playing") {
      setStatus("paused");
    } else if (game.status === "paused") {
      setStatus("playing");
    }
  }

  function onDifficultyChange() {
    resetGame();
  }

  function destroy() {
    // Nothing to clean up: shell forwards events, no timers or rAF owned here.
    // Closed-over state becomes collectible once the shell drops this object.
  }

  // ---- Boot ---------------------------------------------------------------
  const saved = await storage.get(["best"]);
  game.best = saved.best || 0;
  hud.setBest(game.best);
  recomputeSize(1040);
  resetGame();

  return {
    step,
    render,
    onKey,
    onPointer,
    togglePause,
    getStatus: () => game.status,
    onDifficultyChange,
    destroy,
  };
}
