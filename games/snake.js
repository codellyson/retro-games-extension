/* Snake — grid-based, arrow-key steering, themed like the shell.
   Exposes init(api) returning the standard game module interface. */

export const meta = {
  id: "snake",
  name: "Snake",
};

export async function init(api) {
  const { canvas, ctx, storage, audio, hud, overlay, getTheme, getDifficulty, onStatusChange } = api;

  const COLS = 40;
  const ROWS = 32;
  const CELL = 18;
  const W = COLS * CELL; // 720
  const H = ROWS * CELL; // 576

  canvas.width = W;
  canvas.height = H;

  const DIFFICULTIES = {
    easy:   { moveInterval: 11, startLives: 5, speedRamp: 0.4 },
    normal: { moveInterval: 8,  startLives: 3, speedRamp: 0.5 },
    hard:   { moveInterval: 5,  startLives: 2, speedRamp: 0.6 },
  };

  function diffCfg() {
    return DIFFICULTIES[getDifficulty()] || DIFFICULTIES.normal;
  }

  const game = {
    snake: [],
    dir: { x: 1, y: 0 },
    nextDir: { x: 1, y: 0 },
    apple: { x: 0, y: 0 },
    status: "ready",
    score: 0,
    best: 0,
    level: 1,
    lives: 3,
    maxLives: 3,
    eaten: 0,
    moveAcc: 0,
    moveInterval: 8,
  };

  // ---- SFX ----------------------------------------------------------------
  const SFX = {
    eat: () => audio.blip({ freq: 520, dur: 0.08, type: "square", gain: 0.18 }),
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

  // ---- State helpers ------------------------------------------------------
  function spawnApple() {
    const occupied = new Set(game.snake.map((s) => `${s.x},${s.y}`));
    let tries = 0;
    while (tries++ < 500) {
      const x = Math.floor(Math.random() * COLS);
      const y = Math.floor(Math.random() * ROWS);
      if (!occupied.has(`${x},${y}`)) {
        game.apple = { x, y };
        return;
      }
    }
    game.apple = { x: 0, y: 0 };
  }

  function initSnake() {
    const cx = Math.floor(COLS / 2);
    const cy = Math.floor(ROWS / 2);
    game.snake = [
      { x: cx + 2, y: cy },
      { x: cx + 1, y: cy },
      { x: cx,     y: cy },
      { x: cx - 1, y: cy },
      { x: cx - 2, y: cy },
    ];
    game.dir = { x: 1, y: 0 };
    game.nextDir = { x: 1, y: 0 };
    game.moveAcc = 0;
  }

  function setStatus(s) {
    game.status = s;
    if (s === "ready") {
      if (game.lives < game.maxLives) {
        overlay.show(
          `${game.lives} ${game.lives === 1 ? "life" : "lives"} left`,
          "Press arrow or space to go"
        );
      } else {
        overlay.show("Snake", "Arrow keys to move · Space or click to start");
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
      storage.set({ snake_best: game.best });
    }
  }

  function resetGame() {
    game.score = 0;
    game.level = 1;
    game.eaten = 0;
    game.moveInterval = diffCfg().moveInterval;
    game.maxLives = diffCfg().startLives;
    game.lives = game.maxLives;
    hud.setScore(0);
    hud.setLevel(1);
    hud.setLives(game.lives, game.maxLives);
    initSnake();
    spawnApple();
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
    if (game.lives <= 0) {
      setStatus("lost");
    } else {
      initSnake();
      spawnApple();
      setStatus("ready");
    }
  }

  function levelUp() {
    game.level += 1;
    hud.setLevel(game.level);
    game.moveInterval = Math.max(3, game.moveInterval - diffCfg().speedRamp);
    SFX.levelUp();
  }

  // ---- Physics ------------------------------------------------------------
  function step(dt) {
    if (game.status !== "playing") return;
    game.moveAcc += dt;
    if (game.moveAcc < game.moveInterval) return;
    game.moveAcc -= game.moveInterval;

    game.dir = game.nextDir;
    const head = game.snake[0];
    const newHead = { x: head.x + game.dir.x, y: head.y + game.dir.y };

    if (newHead.x < 0 || newHead.x >= COLS || newHead.y < 0 || newHead.y >= ROWS) {
      loseLife();
      return;
    }
    for (let i = 0; i < game.snake.length - 1; i++) {
      if (game.snake[i].x === newHead.x && game.snake[i].y === newHead.y) {
        loseLife();
        return;
      }
    }

    game.snake.unshift(newHead);

    if (newHead.x === game.apple.x && newHead.y === game.apple.y) {
      game.eaten += 1;
      game.score += 10 * game.level;
      hud.setScore(game.score);
      if (game.score > game.best) {
        game.best = game.score;
        hud.setBest(game.best);
      }
      SFX.eat();
      spawnApple();
      if (game.eaten % 5 === 0) levelUp();
    } else {
      game.snake.pop();
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

  function renderGlassy() {
    const grad = ctx.createRadialGradient(W * 0.25, 0, 50, W * 0.25, 0, W * 1.1);
    grad.addColorStop(0, "#1b2340");
    grad.addColorStop(0.55, "#0b1020");
    grad.addColorStop(1, "#070914");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = "rgba(255,255,255,0.03)";
    for (let x = 0; x < COLS; x++) {
      for (let y = 0; y < ROWS; y++) {
        ctx.fillRect(x * CELL + CELL / 2, y * CELL + CELL / 2, 1, 1);
      }
    }

    const a = game.apple;
    ctx.shadowColor = "rgba(255,120,120,0.7)";
    ctx.shadowBlur = 14;
    const ag = ctx.createRadialGradient(
      a.x * CELL + CELL / 2 - 2, a.y * CELL + CELL / 2 - 2, 1,
      a.x * CELL + CELL / 2, a.y * CELL + CELL / 2, CELL / 2
    );
    ag.addColorStop(0, "#ffd0d0");
    ag.addColorStop(1, "#ff6b6b");
    ctx.fillStyle = ag;
    ctx.beginPath();
    ctx.arc(a.x * CELL + CELL / 2, a.y * CELL + CELL / 2, CELL / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.shadowColor = "rgba(140,210,255,0.4)";
    ctx.shadowBlur = 8;
    for (let i = 0; i < game.snake.length; i++) {
      const seg = game.snake[i];
      const shade = 1 - (i / Math.max(game.snake.length, 1)) * 0.35;
      ctx.fillStyle = `rgba(140,210,255,${shade})`;
      roundRect(seg.x * CELL + 1, seg.y * CELL + 1, CELL - 2, CELL - 2, 4);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  function renderNeon() {
    ctx.fillStyle = "#07060f";
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = "rgba(255,255,255,0.025)";
    for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);

    ctx.strokeStyle = "rgba(46,232,178,0.08)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= COLS; x++) {
      ctx.beginPath(); ctx.moveTo(x * CELL, 0); ctx.lineTo(x * CELL, H); ctx.stroke();
    }
    for (let y = 0; y <= ROWS; y++) {
      ctx.beginPath(); ctx.moveTo(0, y * CELL); ctx.lineTo(W, y * CELL); ctx.stroke();
    }

    const a = game.apple;
    ctx.shadowColor = "#ff2d95";
    ctx.shadowBlur = 16;
    ctx.fillStyle = "#ff2d95";
    ctx.fillRect(a.x * CELL + 3, a.y * CELL + 3, CELL - 6, CELL - 6);
    ctx.shadowBlur = 0;

    ctx.shadowColor = "#2ee8b2";
    ctx.shadowBlur = 10;
    for (let i = 0; i < game.snake.length; i++) {
      const seg = game.snake[i];
      ctx.fillStyle = i === 0 ? "#4dc6ff" : "#2ee8b2";
      ctx.fillRect(seg.x * CELL + 2, seg.y * CELL + 2, CELL - 4, CELL - 4);
    }
    ctx.shadowBlur = 0;
  }

  function renderPaper() {
    const INK = "#8a2a1a";
    ctx.fillStyle = "#f4efe3";
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = "rgba(138,42,26,0.1)";
    for (let x = 6; x < W; x += 12) {
      for (let y = 6; y < H; y += 12) {
        ctx.beginPath();
        ctx.arc(x, y, 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(12, 12, W - 24, H - 24);

    const a = game.apple;
    ctx.fillStyle = "rgba(200,50,50,0.3)";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(a.x * CELL + CELL / 2, a.y * CELL + CELL / 2, CELL / 2 - 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "rgba(138,42,26,0.18)";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.6;
    for (const seg of game.snake) {
      ctx.beginPath();
      roundRect(seg.x * CELL + 2, seg.y * CELL + 2, CELL - 4, CELL - 4, 3);
      ctx.fill();
      ctx.stroke();
    }
  }

  function render() {
    const t = getTheme();
    if (t === "neon") renderNeon();
    else if (t === "paper") renderPaper();
    else renderGlassy();
  }

  // ---- Input --------------------------------------------------------------
  function onKey(e, isDown) {
    if (!isDown) return;
    if (e.key === "ArrowLeft" && game.dir.x !== 1) {
      game.nextDir = { x: -1, y: 0 }; e.preventDefault();
      if (game.status === "ready") startGame();
    } else if (e.key === "ArrowRight" && game.dir.x !== -1) {
      game.nextDir = { x: 1, y: 0 }; e.preventDefault();
      if (game.status === "ready") startGame();
    } else if (e.key === "ArrowUp" && game.dir.y !== 1) {
      game.nextDir = { x: 0, y: -1 }; e.preventDefault();
      if (game.status === "ready") startGame();
    } else if (e.key === "ArrowDown" && game.dir.y !== -1) {
      game.nextDir = { x: 0, y: 1 }; e.preventDefault();
      if (game.status === "ready") startGame();
    } else if (e.key === " ") {
      e.preventDefault();
      if (game.status === "ready" || game.status === "lost") startGame();
    }
  }

  function onPointer(kind) {
    if (kind === "down" && (game.status === "ready" || game.status === "lost")) {
      startGame();
    }
  }

  // ---- Lifecycle ----------------------------------------------------------
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
    // No timers or listeners owned here; state goes out of scope with closure.
  }

  // ---- Boot ---------------------------------------------------------------
  const saved = await storage.get(["snake_best"]);
  game.best = saved.snake_best || 0;
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
