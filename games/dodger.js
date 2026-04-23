/* Dodger — drive forward on a 3-lane road, steer left/right to avoid obstacles.
   Exposes init(api) returning the standard game module interface. */

export const meta = {
  id: "dodger",
  name: "Dodger",
};

export async function init(api) {
  const { canvas, ctx, storage, audio, hud, overlay, getTheme, getDifficulty, onStatusChange } = api;

  const W = 1040;
  const H = 585;
  canvas.width = W;
  canvas.height = H;

  const ROAD_W = 560;
  const ROAD_X = (W - ROAD_W) / 2;
  const LANES = 3;
  const LANE_W = ROAD_W / LANES;

  const CAR = { w: 54, h: 82, y: H - 120 };
  const OBSTACLE = { w: 54, h: 76 };

  // ---- Sprites ------------------------------------------------------------
  const SPRITE_BASE = "assets/";
  const OBSTACLE_SPRITE_FILES = [
    "audi.png",
    "taxi.png",
    "mini-van.png",
    "mini-truck.png",
    "ambulance.png",
    "police.png",
    "car.png",
    "truck.png",
  ];

  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null); // fail soft — renderer falls back to rect
      img.src = src;
    });
  }

  const [playerSprite, ...obstacleSprites] = await Promise.all([
    loadImage(SPRITE_BASE + "black-viper.png"),
    ...OBSTACLE_SPRITE_FILES.map((f) => loadImage(SPRITE_BASE + f)),
  ]);
  const loadedObstacleSprites = obstacleSprites.filter(Boolean);

  const DIFFICULTIES = {
    easy:   { startLives: 5, scrollSpeed: 4.5, spawnInterval: 85, levelRamp: 0.94 },
    normal: { startLives: 3, scrollSpeed: 6.5, spawnInterval: 60, levelRamp: 0.91 },
    hard:   { startLives: 2, scrollSpeed: 9.0, spawnInterval: 42, levelRamp: 0.88 },
  };

  // Palette for obstacles per theme row-style variety
  const OBSTACLE_COLORS = {
    glassy: ["#ff7e2d", "#ffd23d", "#b07dff", "#ff2d95", "#2ee8b2"],
    neon:   ["#ff2d95", "#ff7e2d", "#ffd23d", "#2ee8b2", "#4dc6ff", "#b07dff"],
    paper:  ["#8a2a1a"],
  };

  function diffCfg() {
    return DIFFICULTIES[getDifficulty()] || DIFFICULTIES.normal;
  }

  const keys = { left: false, right: false };

  const game = {
    carX: W / 2,
    obstacles: [],
    particles: [],
    status: "ready",
    score: 0,
    best: 0,
    level: 1,
    lives: 3,
    maxLives: 3,
    spawnAcc: 0,
    spawnInterval: 60,
    speedMul: 1,
    scrollOffset: 0,
    distance: 0,
    passed: 0,
  };

  const SFX = {
    crash: () => {
      audio.blip({ freq: 220, dur: 0.14, type: "sawtooth", gain: 0.22, slide: -200 });
      setTimeout(() => audio.blip({ freq: 130, dur: 0.22, type: "sawtooth", gain: 0.2, slide: -80 }), 100);
    },
    pass: () => audio.blip({ freq: 640, dur: 0.04, type: "square", gain: 0.07 }),
    levelUp: () => {
      [0, 80, 160].forEach((d, i) =>
        setTimeout(() => audio.blip({ freq: 440 + i * 120, dur: 0.1, type: "square", gain: 0.14 }), d)
      );
    },
  };

  // ---- Particles (reused pattern) -----------------------------------------
  function spawnCrash(x, y) {
    const palette = OBSTACLE_COLORS[getTheme()] || OBSTACLE_COLORS.glassy;
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 4;
      game.particles.push({
        x,
        y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - 2,
        life: 30 + Math.random() * 20,
        max: 50,
        size: 2 + Math.random() * 3,
        color: palette[Math.floor(Math.random() * palette.length)],
      });
    }
  }

  function stepParticles(dt) {
    const parts = game.particles;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.vy += 0.3 * dt;
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

  // ---- Obstacles ----------------------------------------------------------
  function spawnObstacle() {
    const edge = 6;
    const minX = ROAD_X + edge;
    const maxX = ROAD_X + ROAD_W - OBSTACLE.w - edge;
    const x = minX + Math.random() * (maxX - minX);
    const sprite = loadedObstacleSprites.length > 0
      ? loadedObstacleSprites[Math.floor(Math.random() * loadedObstacleSprites.length)]
      : null;
    game.obstacles.push({
      x,
      y: -OBSTACLE.h,
      w: OBSTACLE.w,
      h: OBSTACLE.h,
      sprite,
      counted: false,
    });
  }

  function stepObstacles(dt) {
    const fall = diffCfg().scrollSpeed * game.speedMul * dt;
    const carLeft = game.carX - CAR.w / 2;
    const carRight = game.carX + CAR.w / 2;
    const carTop = CAR.y;
    const carBottom = CAR.y + CAR.h;

    for (let i = game.obstacles.length - 1; i >= 0; i--) {
      const o = game.obstacles[i];
      o.y += fall;

      // Collision with player car
      if (o.x < carRight && o.x + o.w > carLeft && o.y < carBottom && o.y + o.h > carTop) {
        spawnCrash(o.x + o.w / 2, o.y + o.h / 2);
        game.obstacles.splice(i, 1);
        loseLife();
        return;
      }

      // Count as passed when it goes below the car
      if (!o.counted && o.y > carBottom) {
        o.counted = true;
        game.passed += 1;
        game.score += 10 * game.level;
        hud.setScore(game.score);
        if (game.score > game.best) {
          game.best = game.score;
          hud.setBest(game.best);
        }
        SFX.pass();
        if (game.passed % 10 === 0) levelUp();
      }

      if (o.y > H + 20) game.obstacles.splice(i, 1);
    }
  }

  function stepSpawner(dt) {
    game.spawnAcc += dt;
    if (game.spawnAcc >= game.spawnInterval) {
      game.spawnAcc -= game.spawnInterval;
      spawnObstacle();
    }
  }

  function stepCar(dt) {
    const speed = 10 * dt;
    const leftBound = ROAD_X + CAR.w / 2 + 6;
    const rightBound = ROAD_X + ROAD_W - CAR.w / 2 - 6;
    if (keys.left) game.carX = Math.max(leftBound, game.carX - speed);
    if (keys.right) game.carX = Math.min(rightBound, game.carX + speed);
  }

  function stepScroll(dt) {
    game.scrollOffset = (game.scrollOffset + diffCfg().scrollSpeed * game.speedMul * dt) % 60;
    game.distance += diffCfg().scrollSpeed * game.speedMul * dt;
  }

  function levelUp() {
    game.level += 1;
    hud.setLevel(game.level);
    game.speedMul = Math.min(2.2, game.speedMul * 1.08);
    game.spawnInterval = Math.max(20, game.spawnInterval * diffCfg().levelRamp);
    SFX.levelUp();
  }

  // ---- Status -------------------------------------------------------------
  function setStatus(s) {
    game.status = s;
    if (s === "ready") {
      if (game.lives < game.maxLives) {
        overlay.show(
          `${game.lives} ${game.lives === 1 ? "life" : "lives"} left`,
          "Arrows to steer · click or press space"
        );
      } else {
        overlay.show("Dodger", "Arrows to steer · click or press space");
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
      storage.set({ dodger_best: game.best });
    }
  }

  function resetGame() {
    game.carX = W / 2;
    game.obstacles = [];
    game.particles = [];
    game.score = 0;
    game.level = 1;
    game.passed = 0;
    game.speedMul = 1;
    game.spawnInterval = diffCfg().spawnInterval;
    game.spawnAcc = 0;
    game.scrollOffset = 0;
    game.distance = 0;
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
    SFX.crash();
    game.obstacles = [];
    game.spawnAcc = 0;
    game.carX = W / 2;
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

  function drawCarShape(x, y, w, h, r) {
    // Rect fallback used when a sprite is missing
    roundRect(x, y, w, h, r);
    ctx.fill();
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x + 6, y + h * 0.25, w - 12, h * 0.2);
    ctx.restore();
  }

  function drawPlayer() {
    const x = game.carX - CAR.w / 2;
    const y = CAR.y;
    if (playerSprite) {
      ctx.drawImage(playerSprite, x, y, CAR.w, CAR.h);
    } else {
      ctx.fillStyle = "#4dc6ff";
      drawCarShape(x, y, CAR.w, CAR.h, 12);
    }
  }

  function drawObstacle(o) {
    if (o.sprite) {
      // Rotate 180° so the obstacle faces the player
      ctx.save();
      ctx.translate(o.x + o.w / 2, o.y + o.h / 2);
      ctx.rotate(Math.PI);
      ctx.drawImage(o.sprite, -o.w / 2, -o.h / 2, o.w, o.h);
      ctx.restore();
    } else {
      ctx.fillStyle = "#888";
      drawCarShape(o.x, o.y, o.w, o.h, 10);
    }
  }

  function renderGlassy() {
    // Sky gradient
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#1b2340");
    sky.addColorStop(1, "#070914");
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);

    // Off-road tint
    ctx.fillStyle = "rgba(30, 40, 70, 0.4)";
    ctx.fillRect(0, 0, ROAD_X, H);
    ctx.fillRect(ROAD_X + ROAD_W, 0, ROAD_X, H);

    // Road surface
    const road = ctx.createLinearGradient(ROAD_X, 0, ROAD_X + ROAD_W, 0);
    road.addColorStop(0, "#14192a");
    road.addColorStop(0.5, "#1a1f2e");
    road.addColorStop(1, "#14192a");
    ctx.fillStyle = road;
    ctx.fillRect(ROAD_X, 0, ROAD_W, H);

    // Lane markers
    ctx.strokeStyle = "rgba(230, 236, 255, 0.35)";
    ctx.lineWidth = 4;
    ctx.setLineDash([30, 30]);
    ctx.lineDashOffset = -game.scrollOffset;
    for (let i = 1; i < LANES; i++) {
      const x = ROAD_X + i * LANE_W;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;

    // Road edges
    ctx.strokeStyle = "rgba(230, 236, 255, 0.55)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(ROAD_X, 0); ctx.lineTo(ROAD_X, H);
    ctx.moveTo(ROAD_X + ROAD_W, 0); ctx.lineTo(ROAD_X + ROAD_W, H);
    ctx.stroke();

    // Obstacles
    for (const o of game.obstacles) drawObstacle(o);

    // Player car
    ctx.shadowColor = "rgba(180,210,255,0.65)";
    ctx.shadowBlur = 14;
    drawPlayer();
    ctx.shadowBlur = 0;

    renderParticles();
  }

  function renderNeon() {
    ctx.fillStyle = "#07060f"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(255,255,255,0.025)";
    for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);

    // Off-road darker
    ctx.fillStyle = "rgba(255, 45, 149, 0.06)";
    ctx.fillRect(0, 0, ROAD_X, H);
    ctx.fillRect(ROAD_X + ROAD_W, 0, ROAD_X, H);

    // Road surface
    ctx.fillStyle = "#0a0718";
    ctx.fillRect(ROAD_X, 0, ROAD_W, H);

    // Neon lane markers
    ctx.strokeStyle = "#ff2d95";
    ctx.lineWidth = 3;
    ctx.shadowColor = "#ff2d95"; ctx.shadowBlur = 10;
    ctx.setLineDash([28, 28]);
    ctx.lineDashOffset = -game.scrollOffset;
    for (let i = 1; i < LANES; i++) {
      const x = ROAD_X + i * LANE_W;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    ctx.shadowBlur = 0;

    // Neon road edges
    ctx.strokeStyle = "#2ee8b2";
    ctx.lineWidth = 3;
    ctx.shadowColor = "#2ee8b2"; ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.moveTo(ROAD_X, 0); ctx.lineTo(ROAD_X, H);
    ctx.moveTo(ROAD_X + ROAD_W, 0); ctx.lineTo(ROAD_X + ROAD_W, H);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Obstacles (with magenta glow)
    ctx.shadowColor = "#ff2d95";
    ctx.shadowBlur = 14;
    for (const o of game.obstacles) drawObstacle(o);
    ctx.shadowBlur = 0;

    // Player car (yellow glow)
    ctx.shadowColor = "#ffd23d";
    ctx.shadowBlur = 22;
    drawPlayer();
    ctx.shadowBlur = 0;

    renderParticles();
  }

  function renderPaper() {
    const INK = "#8a2a1a";
    ctx.fillStyle = "#f4efe3"; ctx.fillRect(0, 0, W, H);

    // Dot pattern
    ctx.fillStyle = "rgba(138,42,26,0.1)";
    for (let x = 6; x < W; x += 12)
      for (let y = 6; y < H; y += 12) {
        ctx.beginPath(); ctx.arc(x, y, 1, 0, Math.PI * 2); ctx.fill();
      }

    // Road surface (slightly darker)
    ctx.fillStyle = "rgba(138, 42, 26, 0.05)";
    ctx.fillRect(ROAD_X, 0, ROAD_W, H);

    // Lane markers (dashed)
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.setLineDash([22, 22]);
    ctx.lineDashOffset = -game.scrollOffset;
    for (let i = 1; i < LANES; i++) {
      const x = ROAD_X + i * LANE_W;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;

    // Road edges
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ROAD_X, 0); ctx.lineTo(ROAD_X, H);
    ctx.moveTo(ROAD_X + ROAD_W, 0); ctx.lineTo(ROAD_X + ROAD_W, H);
    ctx.stroke();

    // Obstacles (sprites, slightly faded to fit the paper aesthetic)
    ctx.save();
    ctx.globalAlpha = 0.85;
    for (const o of game.obstacles) drawObstacle(o);
    ctx.restore();

    // Player car (sprite)
    drawPlayer();

    renderParticles();
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
      if (isDown) {
        e.preventDefault();
        if (game.status === "ready" || game.status === "lost") startGame();
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
    if (game.status !== "playing") {
      stepParticles(dt);
      return;
    }
    stepCar(dt);
    stepScroll(dt);
    stepSpawner(dt);
    stepObstacles(dt);
    stepParticles(dt);
  }

  function togglePause() {
    if (game.status === "ready" || game.status === "lost") {
      startGame();
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
    // Closure state goes out of scope when the shell drops this object.
  }

  // ---- Boot ---------------------------------------------------------------
  const saved = await storage.get(["dodger_best"]);
  game.best = saved.dodger_best || 0;
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
