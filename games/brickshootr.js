/* Brickshootr — cannon at the bottom, bricks fall from the top, hold space to fire.
   Exposes init(api) returning the standard game module interface. */

export const meta = {
  id: "brickshootr",
  name: "Brickshootr",
};

export async function init(api) {
  const { canvas, ctx, storage, audio, hud, overlay, getTheme, getDifficulty, onStatusChange } = api;

  const W = 1040;
  const H = 585;
  canvas.width = W;
  canvas.height = H;

  const FLOOR_Y = H - 70; // brick-passes-this-line = life lost
  const CANNON = { w: 80, h: 16, y: H - 40 };
  const BULLET = { speed: 11 };
  const BRICK = { w: 60, h: 22 };

  // Charge shot tiers: { minFrames, damage, pierce, w, h, color? }
  // "minFrames" is the minimum hold time (in normalized 60fps frames)
  // required to fire this tier. A release below tier 2 fires tier 1.
  const TIER1 = { damage: 1, pierce: 0, w: 4,  h: 12 };
  const TIER2 = { damage: 2, pierce: 0, w: 8,  h: 16 };
  const TIER3 = { damage: 3, pierce: 2, w: 14, h: 22 };
  const CHARGE_T2 = 12;  // frames to reach tier 2
  const CHARGE_T3 = 32;  // frames to reach tier 3 (full charge)

  const DIFFICULTIES = {
    easy:   { startLives: 5, brickSpeed: 0.7, spawnInterval: 90, levelRamp: 0.92 },
    normal: { startLives: 3, brickSpeed: 1.0, spawnInterval: 60, levelRamp: 0.90 },
    hard:   { startLives: 2, brickSpeed: 1.5, spawnInterval: 40, levelRamp: 0.88 },
  };

  const PALETTES = {
    glassy: { rowHues: [200, 210, 220, 230, 240, 250, 190, 180] },
    neon: { rowColors: ["#ff2d95", "#ff7e2d", "#ffd23d", "#2ee8b2", "#4dc6ff", "#b07dff"] },
    paper: { ink: "#8a2a1a" },
  };

  function diffCfg() {
    return DIFFICULTIES[getDifficulty()] || DIFFICULTIES.normal;
  }

  const keys = { left: false, right: false };

  const game = {
    cannonX: W / 2,
    bullets: [],
    bricks: [],
    particles: [],
    status: "ready",
    score: 0,
    best: 0,
    level: 1,
    lives: 3,
    maxLives: 3,
    destroyed: 0,
    spawnAcc: 0,
    spawnInterval: 60,
    speedMul: 1,
    combo: 0,
    comboMul: 1,
    // Charge state
    charging: false,
    chargeFrames: 0,
  };

  const MAX_COMBO_MUL = 5;

  const SFX = {
    shoot: () => audio.blip({ freq: 720, dur: 0.05, type: "square", gain: 0.08, slide: -200 }),
    hit: (row) => audio.blip({ freq: 440 + row * 80, dur: 0.07, type: "square", gain: 0.14 }),
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

  // ---- Particles (reused pattern) -----------------------------------------
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

  // ---- Bricks / bullets ---------------------------------------------------
  function spawnBrick() {
    const x = 20 + Math.random() * (W - 40 - BRICK.w);
    // 25% chance of a stubborn brick: 2 or 3 HP
    const stubborn = Math.random() < 0.25;
    const hp = stubborn ? 2 + Math.floor(Math.random() * 2) : 1;
    game.bricks.push({
      x,
      y: -BRICK.h,
      w: BRICK.w,
      h: BRICK.h,
      row: Math.floor(Math.random() * 6),
      alive: true,
      hp,
      maxHp: hp,
    });
  }

  function tierForFrames(frames) {
    if (frames >= CHARGE_T3) return TIER3;
    if (frames >= CHARGE_T2) return TIER2;
    return TIER1;
  }

  function fireBullet(tier) {
    game.bullets.push({
      x: game.cannonX - tier.w / 2,
      y: CANNON.y - tier.h,
      vy: -BULLET.speed,
      w: tier.w,
      h: tier.h,
      damage: tier.damage,
      pierce: tier.pierce,
    });
    if (tier === TIER3) {
      audio.blip({ freq: 300, dur: 0.15, type: "sawtooth", gain: 0.16, slide: -300 });
      audio.blip({ freq: 500, dur: 0.08, type: "square", gain: 0.08, slide: -200 });
    } else if (tier === TIER2) {
      audio.blip({ freq: 480, dur: 0.08, type: "square", gain: 0.12, slide: -250 });
    } else {
      SFX.shoot();
    }
  }

  function releaseCharge() {
    if (!game.charging) return;
    const tier = tierForFrames(game.chargeFrames);
    fireBullet(tier);
    game.charging = false;
    game.chargeFrames = 0;
  }

  function spawnSparks(x, y, color, count = 4) {
    for (let i = 0; i < count; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI;
      const speed = 2 + Math.random() * 2;
      game.particles.push({
        x,
        y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        life: 15 + Math.random() * 10,
        max: 25,
        size: 1.5 + Math.random() * 1.5,
        color,
      });
    }
  }

  function stepBullets(dt) {
    const bs = game.bullets;
    for (let i = bs.length - 1; i >= 0; i--) {
      const b = bs[i];
      b.y += b.vy * dt;
      if (b.y + b.h < 0) { bs.splice(i, 1); continue; }

      for (const br of game.bricks) {
        if (!br.alive) continue;
        if (b.x < br.x + br.w && b.x + b.w > br.x && b.y < br.y + br.h && b.y + b.h > br.y) {
          br.hp -= b.damage;
          if (br.hp <= 0) {
            br.alive = false;
            spawnShatter(br);
            game.destroyed += 1;
            game.combo += 1;
            game.comboMul = Math.min(MAX_COMBO_MUL, 1 + Math.floor(game.combo / 10));
            game.score += 10 * game.level * game.comboMul;
            hud.setScore(game.score);
            if (game.score > game.best) {
              game.best = game.score;
              hud.setBest(game.best);
            }
            SFX.hit(br.row);
            if (game.destroyed % 15 === 0) levelUp();
          } else {
            // Brick survived the hit — sparks, small clunk sound.
            spawnSparks(b.x + b.w / 2, b.y, brickColor(br));
            audio.blip({ freq: 180, dur: 0.04, type: "square", gain: 0.1 });
          }
          if (b.pierce > 0) {
            b.pierce -= 1;
          } else {
            bs.splice(i, 1);
            break;
          }
        }
      }
    }
  }

  function stepBricks(dt) {
    const fall = diffCfg().brickSpeed * game.speedMul * dt;
    let reached = false;
    for (const b of game.bricks) {
      if (!b.alive) continue;
      b.y += fall;
      if (b.y + b.h >= FLOOR_Y) reached = true;
    }
    game.bricks = game.bricks.filter((b) => b.alive);
    if (reached) loseLife();
  }

  function stepSpawner(dt) {
    game.spawnAcc += dt;
    if (game.spawnAcc >= game.spawnInterval) {
      game.spawnAcc -= game.spawnInterval;
      spawnBrick();
    }
  }

  function stepCannon(dt) {
    const speed = 12 * dt;
    const half = CANNON.w / 2;
    if (keys.left) game.cannonX = Math.max(half, game.cannonX - speed);
    if (keys.right) game.cannonX = Math.min(W - half, game.cannonX + speed);

    if (game.charging) {
      game.chargeFrames += dt;
      if (game.chargeFrames > CHARGE_T3 * 1.5) game.chargeFrames = CHARGE_T3 * 1.5;
    }
  }

  function levelUp() {
    game.level += 1;
    hud.setLevel(game.level);
    game.speedMul = Math.min(2.5, game.speedMul * 1.07);
    game.spawnInterval = Math.max(18, game.spawnInterval * diffCfg().levelRamp);
    SFX.levelUp();
  }

  // ---- Status / reset -----------------------------------------------------
  function setStatus(s) {
    game.status = s;
    if (s === "ready") {
      if (game.lives < game.maxLives) {
        overlay.show(
          `${game.lives} ${game.lives === 1 ? "life" : "lives"} left`,
          "Arrows to move · tap to fire · hold to charge"
        );
      } else {
        overlay.show("Brickshootr", "Arrows to move · tap space to fire · hold to charge");
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
      storage.set({ brickshootr_best: game.best });
    }
  }

  function resetGame() {
    game.cannonX = W / 2;
    game.bullets = [];
    game.bricks = [];
    game.particles = [];
    game.score = 0;
    game.level = 1;
    game.destroyed = 0;
    game.speedMul = 1;
    game.spawnInterval = diffCfg().spawnInterval;
    game.spawnAcc = 0;
    game.combo = 0;
    game.comboMul = 1;
    game.charging = false;
    game.chargeFrames = 0;
    game.maxLives = diffCfg().startLives;
    game.lives = game.maxLives;
    hud.setScore(0);
    hud.setLevel(1);
    hud.setLives(game.lives, game.maxLives);
    setStatus("ready");
  }

  function startGame() {
    if (game.status === "lost") resetGame();
    if (game.status !== "ready") return;
    setStatus("playing");
  }

  function loseLife() {
    game.lives -= 1;
    hud.setLives(game.lives, game.maxLives);
    persistBest();
    SFX.lose();
    game.bricks = [];
    game.bullets = [];
    game.spawnAcc = 0;
    game.combo = 0;
    game.comboMul = 1;
    game.charging = false;
    game.chargeFrames = 0;
    if (game.lives <= 0) {
      setStatus("lost");
    } else {
      setStatus("ready");
    }
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

  function chargeRatio() {
    if (!game.charging) return 0;
    return Math.min(1, game.chargeFrames / CHARGE_T3);
  }

  function renderChargeAura(baseColor, glowColor) {
    if (!game.charging) return;
    const ratio = chargeRatio();
    const radius = 3 + ratio * 14;
    const cx = game.cannonX;
    const cy = CANNON.y - 8;
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 4 + ratio * 18;
    ctx.globalAlpha = 0.5 + ratio * 0.5;
    ctx.fillStyle = baseColor;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    // Subtle ring when fully charged
    if (ratio >= 1) {
      ctx.strokeStyle = glowColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, radius + 4, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function renderHpPips(b, color) {
    if (b.maxHp <= 1) return;
    const pipSize = 3;
    const gap = 3;
    const total = b.maxHp;
    const width = total * pipSize + (total - 1) * gap;
    let x = b.x + b.w - 6 - width;
    const y = b.y + 5;
    ctx.fillStyle = color;
    for (let i = 0; i < total; i++) {
      ctx.globalAlpha = i < b.hp ? 1 : 0.25;
      ctx.fillRect(x, y, pipSize, pipSize);
      x += pipSize + gap;
    }
    ctx.globalAlpha = 1;
  }

  function renderCombo(textColor) {
    if (game.combo < 2) return;
    ctx.fillStyle = textColor;
    ctx.font = "bold 14px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(`${game.combo} HIT · ${game.comboMul}x`, 20, 20);
  }

  function renderFloor(color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(0, FLOOR_Y);
    ctx.lineTo(W, FLOOR_Y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function renderGlassy() {
    const grad = ctx.createRadialGradient(W * 0.25, 0, 50, W * 0.25, 0, W * 1.1);
    grad.addColorStop(0, "#1b2340");
    grad.addColorStop(0.55, "#0b1020");
    grad.addColorStop(1, "#070914");
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);

    renderFloor("rgba(180,210,255,0.25)", 1);

    for (const b of game.bricks) {
      if (!b.alive) continue;
      const hue = PALETTES.glassy.rowHues[b.row % 8];
      const bg = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
      bg.addColorStop(0, `oklch(0.72 0.08 ${hue} / 0.45)`);
      bg.addColorStop(1, `oklch(0.5 0.08 ${hue} / 0.2)`);
      ctx.fillStyle = bg;
      roundRect(b.x, b.y, b.w, b.h, 6); ctx.fill();
      ctx.strokeStyle = `oklch(0.88 0.08 ${hue} / 0.6)`;
      ctx.lineWidth = b.maxHp > 1 ? 2 : 1;
      ctx.stroke();
      renderHpPips(b, "rgba(255,255,255,0.9)");
    }

    // Bullets
    ctx.shadowColor = "rgba(180,210,255,0.8)"; ctx.shadowBlur = 10;
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    for (const b of game.bullets) ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.shadowBlur = 0;

    // Cannon
    ctx.shadowColor = "rgba(120,160,230,0.4)"; ctx.shadowBlur = 16;
    const pg = ctx.createLinearGradient(0, CANNON.y, 0, CANNON.y + CANNON.h);
    pg.addColorStop(0, "rgba(255,255,255,0.4)");
    pg.addColorStop(1, "rgba(255,255,255,0.15)");
    ctx.fillStyle = pg;
    roundRect(game.cannonX - CANNON.w / 2, CANNON.y, CANNON.w, CANNON.h, CANNON.h / 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 1; ctx.stroke();
    // Barrel
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillRect(game.cannonX - 3, CANNON.y - 6, 6, 6);
    ctx.shadowBlur = 0;

    renderChargeAura("rgba(180,210,255,0.9)", "rgba(120,180,255,0.9)");
    renderParticles();
    renderCombo("rgba(255,255,255,0.75)");
  }

  function renderNeon() {
    ctx.fillStyle = "#07060f"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(255,255,255,0.025)";
    for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);

    renderFloor("rgba(255,45,149,0.4)", 1.5);

    for (const b of game.bricks) {
      if (!b.alive) continue;
      const c = PALETTES.neon.rowColors[b.row % 6];
      ctx.strokeStyle = c; ctx.shadowColor = c; ctx.shadowBlur = 10;
      ctx.lineWidth = b.maxHp > 1 ? 2.5 : 1.5;
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.shadowBlur = 0;
      ctx.fillStyle = c + (b.maxHp > 1 ? "25" : "15");
      ctx.fillRect(b.x, b.y, b.w, b.h);
      renderHpPips(b, c);
    }

    ctx.shadowColor = "#ffd23d"; ctx.shadowBlur = 16; ctx.fillStyle = "#ffd23d";
    for (const b of game.bullets) ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.shadowBlur = 0;

    ctx.shadowColor = "#2ee8b2"; ctx.shadowBlur = 16; ctx.fillStyle = "#2ee8b2";
    ctx.fillRect(game.cannonX - CANNON.w / 2, CANNON.y, CANNON.w, CANNON.h);
    ctx.fillRect(game.cannonX - 3, CANNON.y - 8, 6, 8);
    ctx.shadowBlur = 0;

    renderChargeAura("#ffd23d", "#ff2d95");
    renderParticles();
    renderCombo("#ffd23d");
  }

  function renderPaper() {
    const INK = PALETTES.paper.ink;
    ctx.fillStyle = "#f4efe3"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(138,42,26,0.12)";
    for (let x = 6; x < W; x += 12) {
      for (let y = 6; y < H; y += 12) {
        ctx.beginPath(); ctx.arc(x, y, 1, 0, Math.PI * 2); ctx.fill();
      }
    }
    renderFloor(INK, 1.5);

    ctx.strokeStyle = INK;
    for (const b of game.bricks) {
      if (!b.alive) continue;
      ctx.fillStyle = b.maxHp > 1 ? "rgba(138,42,26,0.18)" : "rgba(138,42,26,0.08)";
      ctx.lineWidth = b.maxHp > 1 ? 2.5 : 1.5;
      ctx.beginPath();
      roundRect(b.x, b.y, b.w, b.h, 3);
      ctx.fill(); ctx.stroke();
      renderHpPips(b, INK);
    }

    ctx.fillStyle = INK;
    for (const b of game.bullets) ctx.fillRect(b.x, b.y, b.w, b.h);

    ctx.fillStyle = "rgba(138,42,26,0.15)"; ctx.strokeStyle = INK; ctx.lineWidth = 1.8;
    roundRect(game.cannonX - CANNON.w / 2, CANNON.y, CANNON.w, CANNON.h, 2);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = INK;
    ctx.fillRect(game.cannonX - 3, CANNON.y - 6, 6, 6);

    renderChargeAura("rgba(138,42,26,0.4)", INK);
    renderParticles();
    renderCombo(INK);
  }

  function render() {
    const t = getTheme();
    if (t === "neon") renderNeon();
    else if (t === "paper") renderPaper();
    else renderGlassy();
  }

  // ---- Input --------------------------------------------------------------
  function onKey(e, isDown) {
    if (e.key === "ArrowLeft") {
      keys.left = isDown;
      if (isDown) { e.preventDefault(); if (game.status === "ready") startGame(); }
    } else if (e.key === "ArrowRight") {
      keys.right = isDown;
      if (isDown) { e.preventDefault(); if (game.status === "ready") startGame(); }
    } else if (e.key === " ") {
      e.preventDefault();
      if (isDown) {
        if (game.status === "ready" || game.status === "lost") {
          startGame();
          return;
        }
        if (game.status === "playing" && !game.charging) {
          game.charging = true;
          game.chargeFrames = 0;
        }
      } else {
        if (game.charging) releaseCharge();
      }
    }
  }

  function onPointer(kind) {
    if (kind === "down" && (game.status === "ready" || game.status === "lost")) {
      startGame();
    }
  }

  // ---- Lifecycle ----------------------------------------------------------
  function step(dt) {
    stepCannon(dt);
    if (game.status !== "playing") {
      stepParticles(dt);
      return;
    }
    stepSpawner(dt);
    stepBricks(dt);
    stepBullets(dt);
    stepParticles(dt);
  }

  function togglePause() {
    if (game.status === "ready" || game.status === "lost") {
      startGame();
    } else if (game.status === "playing") {
      game.charging = false;
      game.chargeFrames = 0;
      setStatus("paused");
    } else if (game.status === "paused") {
      setStatus("playing");
    }
  }

  function onDifficultyChange() {
    resetGame();
  }

  function destroy() {
    // No timers or listeners owned here; state is closed over and goes with it.
  }

  // ---- Boot ---------------------------------------------------------------
  const saved = await storage.get(["brickshootr_best"]);
  game.best = saved.brickshootr_best || 0;
  hud.setBest(game.best);
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
