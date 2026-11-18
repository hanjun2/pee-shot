(() => {
  "use strict";

  const canvas = document.querySelector("#game");
  const ctx = canvas.getContext("2d");
  const startScreen = document.querySelector("#startScreen");
  const gameOver = document.querySelector("#gameOver");
  const hunterName = document.querySelector("#hunterName");
  const roomCodeInput = document.querySelector("#roomCode");
  const createRoomButton = document.querySelector("#createRoomButton");
  const joinRoomButton = document.querySelector("#joinRoomButton");
  const roomStatus = document.querySelector("#roomStatus");
  const startButton = document.querySelector("#startButton");
  const retryButton = document.querySelector("#retryButton");
  const previewCanvas = document.querySelector("#avatarPreview");
  const previewCtx = previewCanvas?.getContext("2d") || null;
  const W = canvas.width, H = canvas.height, ARENA = 1010;

  const RULES = {
    easy:   { label: "쉬움", enemySpeed: .72, spawn: 1.15, bossSpeed: .72, bullets: .65, fire: 1.22, damage: 1, hp: 5, coin: 1.25 },
    normal: { label: "보통", enemySpeed: 1.10, spawn: .78, bossSpeed: 1.15, bullets: 1.05, fire: .90, damage: 1, hp: 4, coin: 1 },
    hard:   { label: "어려움", enemySpeed: 2.05, spawn: .28, bossSpeed: 2.25, bullets: 2.10, fire: .38, damage: 2, hp: 3, coin: .8 },
  };

  let difficulty = "easy";
  let avatar = { hull: "#283a5d", accent: "#67e8f9", glow: "#ffcb65", ship: "fighter" };
  let state = "menu";
  let name = "방랑자";
  let keys = new Set();
  let mouse = { x: 600, y: 350, down: false };
  let player, enemies, bullets, enemyBullets, coins, particles, boss;
  let wave = 1, score = 0, money = 0, elapsed = 0;
  let spawnClock = 0, shake = 0, paused = false, last, warning = 0;
  let room = {
    enabled: false,
    code: "",
    playerId: "",
    isHost: false,
    seed: 1,
    startedAt: 0,
    remotePlayers: [],
    syncTimer: null,
    pollTimer: null,
  };
  let rngSeed = 1;
  let audioCtx, musicTimer, musicStep = 0, musicMode = "field";

  function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    startMusic("field");
  }

  function tone(frequency, duration = .08, type = "square", volume = .035, delay = 0) {
    if (!audioCtx || audioCtx.state !== "running") return;
    const start = audioCtx.currentTime + delay;
    const oscillator = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + .008);
    gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
    oscillator.connect(gain).connect(audioCtx.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + .02);
  }

  function sfx(name) {
    const sounds = {
      shoot: () => tone(580, .045, "square", .014),
      dash: () => { tone(170, .14, "sawtooth", .04); tone(420, .12, "triangle", .025, .03); },
      coin: () => { tone(740, .08, "square", .035); tone(1110, .11, "square", .03, .07); },
      hit: () => { tone(95, .23, "sawtooth", .07); tone(62, .27, "square", .035); },
      boss: () => { tone(82, .45, "sawtooth", .07); tone(55, .6, "square", .05, .12); },
      kill: () => { tone(220, .16, "square", .04); tone(440, .18, "square", .04, .12); tone(880, .3, "triangle", .04, .25); },
    };
    sounds[name]?.();
  }

  function startMusic(mode) {
    musicMode = mode;
    clearInterval(musicTimer);
    musicStep = 0;
    if (!audioCtx) return;
    const field = [52, 55, 59, 64, 59, 55, 50, 55];
    const bossNotes = [40, 40, 43, 46, 39, 45, 38, 44];
    const interval = mode === "boss" ? 115 : 210;
    musicTimer = setInterval(() => {
      if (state !== "playing" || paused || !audioCtx || audioCtx.state !== "running") return;
      const notes = musicMode === "boss" ? bossNotes : field;
      const midi = notes[musicStep % notes.length];
      const hz = 440 * 2 ** ((midi - 69) / 12);
      tone(hz, interval / 1000 * .8, "square", musicMode === "boss" ? .022 : .014);
      if (musicStep % 2 === 0) tone(hz / 2, interval / 1000, "triangle", .02);
      if (musicStep % 4 === 0) tone(musicMode === "boss" ? 72 : 92, .07, "sine", .04);
      musicStep++;
    }, interval);
  }

  function seededRandom() {
    rngSeed = (rngSeed * 1664525 + 1013904223) >>> 0;
    return rngSeed / 4294967296;
  }

  function rand() {
    return room.enabled ? seededRandom() : Math.random();
  }

  function updateRoomStatus(text) {
    if (roomStatus) roomStatus.textContent = text;
  }

  function roomStatePayload() {
    return {
      name,
      avatar,
      state: {
        x: player?.x ?? ARENA / 2,
        y: player?.y ?? H / 2,
        hp: player?.hp ?? 0,
        maxHp: player?.maxHp ?? 0,
        score,
        wave,
        ship: avatar.ship,
        tier: player?.tier ?? 0,
        dash: player?.dash ?? 0,
        alive: state === "playing",
      },
    };
  }

  async function postJSON(url, body) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || `request_failed_${response.status}`);
    }
    return data;
  }

  function applyRoomSnapshot(snapshot) {
    if (!snapshot?.room) return;
    const payload = snapshot.room;
    room.code = payload.roomCode;
    room.seed = payload.seed || room.seed;
    room.startedAt = new Date(payload.createdAt).getTime();
    room.remotePlayers = (payload.pilots || []).filter(p => p.playerId !== room.playerId);
    if (room.enabled && room.seed) rngSeed = room.seed >>> 0;
    if (roomCodeInput) roomCodeInput.value = room.code;
    updateRoomStatus(`${room.code} · ${room.isHost ? "호스트" : "참가"} · ${room.remotePlayers.length + 1}명`);
  }

  async function startRoom(mode) {
    initAudio();
    name = hunterName.value.trim() || "방랑자";
    const body = { name, avatar, playerId: room.playerId, state: roomStatePayload().state };
    try {
      const data = mode === "create"
        ? await postJSON("/api/rooms/create", body)
        : await postJSON("/api/rooms/join", { ...body, roomCode: (roomCodeInput?.value || "").trim().toUpperCase() });
      room.enabled = true;
      room.playerId = data.playerId;
      room.isHost = !!data.isHost;
      applyRoomSnapshot(data);
      if (roomStatus) updateRoomStatus(`${room.code} · ${room.isHost ? "호스트" : "참가"} · 연결됨`);
      startGame();
    } catch (error) {
      updateRoomStatus(`방 연결 실패: ${error.message}`);
    }
  }

  async function syncRoomState() {
    if (!room.enabled || !room.code || !room.playerId || !player) return;
    try {
      const data = await postJSON(`/api/rooms/${room.code}/sync`, {
        playerId: room.playerId,
        ...roomStatePayload(),
      });
      applyRoomSnapshot(data);
    } catch (error) {
      updateRoomStatus(`동기화 실패: ${error.message}`);
    }
  }

  document.querySelectorAll(".difficulty").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".difficulty").forEach(item => item.classList.remove("selected"));
      button.classList.add("selected");
      difficulty = button.dataset.difficulty;
    });
  });
  document.querySelectorAll(".swatch").forEach(button => {
    button.addEventListener("click", () => {
      const part = button.dataset.part;
      avatar[part] = button.dataset.color;
      document.querySelectorAll(`.swatch[data-part="${part}"]`).forEach(item => item.classList.remove("selected"));
      button.classList.add("selected");
      drawAvatarPreview();
    });
  });
  document.querySelectorAll(".ship-type").forEach(button => {
    button.addEventListener("click", () => {
      avatar.ship = button.dataset.ship;
      document.querySelectorAll(".ship-type").forEach(item => item.classList.remove("selected"));
      button.classList.add("selected");
      drawAvatarPreview();
    });
  });
  createRoomButton.addEventListener("click", () => startRoom("create"));
  joinRoomButton.addEventListener("click", () => startRoom("join"));

  startButton.addEventListener("click", startGame);
  retryButton.addEventListener("click", startGame);
  window.addEventListener("keydown", event => {
    keys.add(event.key.toLowerCase());
    if (event.code === "Space" || event.key === "Shift") { event.preventDefault(); dash(); }
    if (event.key.toLowerCase() === "p" && state === "playing") paused = !paused;
  });
  window.addEventListener("keyup", event => keys.delete(event.key.toLowerCase()));
  window.addEventListener("blur", () => { keys.clear(); mouse.down = false; });
  canvas.addEventListener("mousemove", event => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = (event.clientX - rect.left) * W / rect.width;
    mouse.y = (event.clientY - rect.top) * H / rect.height;
  });
  canvas.addEventListener("mousedown", event => {
    if (event.button === 0) {
      if (mouse.x > ARENA) shopClick(mouse.y);
      else mouse.down = true;
    }
    if (event.button === 2) dash();
  });
  window.addEventListener("mouseup", () => mouse.down = false);
  canvas.addEventListener("contextmenu", event => event.preventDefault());

  function startGame() {
    initAudio();
    name = hunterName.value.trim() || "방랑자";
    const rule = RULES[difficulty];
    if (room.enabled && room.seed) rngSeed = room.seed >>> 0;
    else rngSeed = (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
    player = {
      x: ARENA / 2, y: H * .62, vx: 0, vy: 0, r: 13,
      hp: rule.hp, maxHp: rule.hp, dash: 100, inv: 0,
      cooldown: 0, damage: 1, fireDelay: 12, tier: 0,
      damageLevel: 0, rapidLevel: 0, dashFrames: 0, trail: [],
    };
    enemies = []; bullets = []; enemyBullets = []; coins = []; particles = [];
    boss = null; wave = 1; score = 0; money = 0; elapsed = 0;
    spawnClock = 0; shake = 0; paused = false; warning = 0;
    state = "playing";
    startScreen.classList.remove("visible");
    gameOver.classList.remove("visible");
    startButton.blur();
    retryButton.blur();
    canvas.focus();
    if (room.enabled) {
      updateRoomStatus(`${room.code} · ${room.isHost ? "호스트" : "참가"} · 연결 중`);
      clearInterval(room.syncTimer);
      clearInterval(room.pollTimer);
      room.syncTimer = setInterval(syncRoomState, 250);
      room.pollTimer = setInterval(syncRoomState, 650);
      syncRoomState();
    } else {
      updateRoomStatus("로컬 모드");
    }
    for (let i = 0; i < 4; i++) spawnEnemy();
    for (let i = 0; i < 3; i++) spawnCoin();
  }

  function spawnCoin() {
    coins.push({ x: 70 + rand() * (ARENA - 140), y: 110 + rand() * (H - 180), phase: rand() * 8 });
  }

  function spawnEnemy() {
    if (boss) return;
    const types = wave < 3 ? ["stalker"] : wave < 6 ? ["stalker", "fang"] : ["stalker", "fang", "tank", "wisp"];
    const type = types[Math.floor(rand() * types.length)];
    const side = Math.floor(rand() * 4);
    const pos = side === 0 ? [rand() * ARENA, -30] :
      side === 1 ? [ARENA + 30, rand() * H] :
      side === 2 ? [rand() * ARENA, H + 30] : [-30, rand() * H];
    const data = {
      stalker: [15, 2, 1], fang: [12, 1, 1.55],
      tank: [24, 7 + Math.floor(wave / 4), .68], wisp: [17, 3, 1.2],
    }[type];
    enemies.push({ x: pos[0], y: pos[1], vx: 0, vy: 0, r: data[0], hp: data[1], speed: data[2], type, phase: rand() * 8 });
  }

  function spawnBoss() {
    enemies.length = 0; enemyBullets.length = 0;
    const rank = Math.floor(wave / 3);
    const rule = RULES[difficulty];
    boss = {
      x: ARENA / 2, y: 105, vx: 0, vy: 0, r: 46,
      rank, hp: 55 + rank * 34 + (player.damageLevel + player.rapidLevel) * 8,
      maxHp: 0, cooldown: 60, moveClock: 0, dashClock: 100,
      pattern: 0, type: (rank - 1) % 3,
    };
    boss.maxHp = boss.hp;
    boss.cooldown *= rule.fire;
    warning = 115;
    shake = 15;
    startMusic("boss");
    sfx("boss");
  }

  function shoot() {
    if (player.cooldown > 0) return;
    const angle = Math.atan2(mouse.y - player.y, mouse.x - player.x);
    const spreads = [[0], [-.07, .07], [-.13, 0, .13], [-.2, -.07, .07, .2]][player.tier];
    spreads.forEach(offset => {
      const a = angle + offset;
      bullets.push({ x: player.x, y: player.y, vx: Math.cos(a) * 11.5, vy: Math.sin(a) * 11.5, r: 5 + player.tier, damage: player.damage });
    });
    player.cooldown = player.fireDelay;
    sfx("shoot");
  }

  function dash() {
    if (state !== "playing" || player.dash < 35) return;
    let dx = Number(keys.has("d") || keys.has("arrowright")) - Number(keys.has("a") || keys.has("arrowleft"));
    let dy = Number(keys.has("s") || keys.has("arrowdown")) - Number(keys.has("w") || keys.has("arrowup"));
    if (!dx && !dy) { dx = Math.cos(Math.atan2(mouse.y - player.y, mouse.x - player.x)); dy = Math.sin(Math.atan2(mouse.y - player.y, mouse.x - player.x)); }
    const mag = Math.hypot(dx, dy) || 1;
    player.vx = dx / mag * 21; player.vy = dy / mag * 21;
    player.dash -= 35; player.inv = 25; shake = 7;
    player.dashFrames = 14;
    burst(player.x, player.y, "#67e8f9");
    sfx("dash");
  }

  function shopClick(y) {
    const buy = (price, apply) => {
      if (money < price) return;
      money -= price; apply();
      player.tier = Math.min(3, Math.floor((player.damageLevel + player.rapidLevel) / 5));
    };
    if (y > 430 && y < 490) buy(30 + player.damageLevel * 25, () => { player.damage++; player.damageLevel++; });
    if (y > 505 && y < 565) buy(35 + player.rapidLevel * 25, () => { player.fireDelay = Math.max(3, player.fireDelay - 1); player.rapidLevel++; });
    if (y > 580 && y < 640) buy(70 + (player.maxHp - RULES[difficulty].hp) * 40, () => { player.maxHp++; player.hp = player.maxHp; });
  }

  function update(dt) {
    if (state !== "playing" || paused) return;
    if (room.enabled && room.startedAt) elapsed = Math.max(0, (Date.now() - room.startedAt) / 1000);
    else elapsed += dt;
    if (warning > 0) warning = Math.max(0, warning - dt * 60);
    const rule = RULES[difficulty];
    const nextWave = 1 + Math.floor(elapsed / 16);
    if (nextWave > wave) {
      wave = nextWave;
      if (wave % 3 === 0) spawnBoss();
      else for (let i = 0; i < 1 + Math.floor(wave / 4); i++) spawnEnemy();
    }

    let dx = Number(keys.has("d") || keys.has("arrowright")) - Number(keys.has("a") || keys.has("arrowleft"));
    let dy = Number(keys.has("s") || keys.has("arrowdown")) - Number(keys.has("w") || keys.has("arrowup"));
    if (dx || dy) {
      const mag = Math.hypot(dx, dy);
      player.vx += dx / mag * 1.2; player.vy += dy / mag * 1.2;
    }
    const movementDrag = player.dashFrames > 0 ? .96 : .86;
    player.vx *= movementDrag; player.vy *= movementDrag;
    const ps = Math.hypot(player.vx, player.vy);
    const playerLimit = player.dashFrames > 0 ? 22 : 8;
    if (ps > playerLimit) { player.vx *= playerLimit / ps; player.vy *= playerLimit / ps; }
    player.x = clamp(player.x + player.vx, player.r, ARENA - player.r);
    player.y = clamp(player.y + player.vy, player.r + 70, H - player.r);
    player.trail.unshift({ x: player.x, y: player.y, life: player.dashFrames > 0 ? 18 : 6 });
    player.trail = player.trail.slice(0, player.dashFrames > 0 ? 12 : 4);
    player.trail.forEach(point => point.life--);
    player.dashFrames = Math.max(0, player.dashFrames - 1);
    player.cooldown = Math.max(0, player.cooldown - 1);
    player.inv = Math.max(0, player.inv - 1);
    player.dash = Math.min(100, player.dash + .25);
    if (mouse.down) shoot();

    spawnClock -= dt;
    const interval = Math.max(.12, (1.05 - wave * .035) * rule.spawn);
    if (!boss && spawnClock <= 0) { spawnEnemy(); spawnClock = interval; }

    enemies.forEach(enemy => {
      let angle = Math.atan2(player.y - enemy.y, player.x - enemy.x);
      if (enemy.type === "wisp") angle += Math.sin(elapsed * 3 + enemy.phase) * 1.1;
      const accel = (.11 + wave * .012) * enemy.speed * rule.enemySpeed;
      enemy.vx += Math.cos(angle) * accel; enemy.vy += Math.sin(angle) * accel;
      const limit = (2.4 + wave * .17) * enemy.speed * rule.enemySpeed;
      const speed = Math.hypot(enemy.vx, enemy.vy);
      if (speed > limit) { enemy.vx *= limit / speed; enemy.vy *= limit / speed; }
      enemy.x += enemy.vx; enemy.y += enemy.vy;
      if (hitCircle(player, enemy)) hurtPlayer(rule.damage);
    });

    if (boss && warning <= 0) updateBoss(rule);
    updateProjectiles(rule);
    updateCoins();
    particles.forEach(p => { p.x += p.vx; p.y += p.vy; p.life--; });
    particles = particles.filter(p => p.life > 0);
    shake *= .85;
  }

  function updateBoss(rule) {
    const rank = boss.rank;
    boss.moveClock--;
    boss.dashClock--;
    if (boss.moveClock <= 0) {
      boss.tx = 90 + rand() * (ARENA - 180);
      boss.ty = 95 + rand() * (H * .55);
      boss.moveClock = Math.max(12, 58 - rank * 5) / rule.bossSpeed;
    }
    const accel = (.022 + rank * .006) * rule.bossSpeed;
    boss.vx += (boss.tx - boss.x) * accel; boss.vy += (boss.ty - boss.y) * accel;
    if (boss.dashClock <= 0) {
      const a = Math.atan2(player.y - boss.y, player.x - boss.x);
      const speed = (8 + rank * 1.5) * rule.bossSpeed;
      boss.vx = Math.cos(a) * speed; boss.vy = Math.sin(a) * speed;
      boss.dashClock = Math.max(25, 150 - rank * 14) / rule.bossSpeed;
      shake = 9;
    }
    boss.vx *= .91; boss.vy *= .91;
    const max = (4 + rank * .9) * rule.bossSpeed;
    const speed = Math.hypot(boss.vx, boss.vy);
    if (speed > max) { boss.vx *= max / speed; boss.vy *= max / speed; }
    boss.x = clamp(boss.x + boss.vx, boss.r, ARENA - boss.r);
    boss.y = clamp(boss.y + boss.vy, 90, H * .68);
    boss.cooldown--;
    if (boss.cooldown <= 0) {
      bossAttack(rule);
      boss.cooldown = Math.max(12, (76 - rank * 4) * rule.fire);
    }
    if (hitCircle(player, boss)) hurtPlayer(rule.damage);
  }

  function bossAttack(rule) {
    const rank = boss.rank, type = boss.pattern++ % 4;
    const base = Math.atan2(player.y - boss.y, player.x - boss.x);
    let angles = [];
    if (type === 0) {
      const count = 5 + Math.min(8, rank + (difficulty === "hard" ? 5 : 0));
      angles = Array.from({ length: count }, (_, i) => base + (i / (count - 1) - .5) * 1.05);
    } else if (type === 1) {
      const count = 10 + rank * 2 + (difficulty === "hard" ? 10 : 0);
      angles = Array.from({ length: count }, (_, i) => Math.PI * 2 * i / count + elapsed);
    } else if (type === 2) {
      const count = 6 + rank;
      angles = Array.from({ length: count }, (_, i) => base + (i - count / 2) * .18);
    } else {
      const count = 8 + rank + (difficulty === "hard" ? 8 : 0);
      angles = Array.from({ length: count }, (_, i) => Math.PI / 2 + (i - count / 2) * .07);
    }
    const speed = (3.5 + rank * .2) * rule.bullets;
    angles.forEach((a, i) => enemyBullets.push({
      x: boss.x, y: boss.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
      r: difficulty === "hard" ? 7 : 5, curve: type === 2 ? (i % 2 ? .008 : -.008) : 0,
    }));
  }

  function updateProjectiles(rule) {
    bullets.forEach(b => { b.x += b.vx; b.y += b.vy; });
    bullets = bullets.filter(b => {
      if (boss && warning <= 0 && hitCircle(b, boss)) {
        boss.hp -= b.damage;
        if (boss.hp <= 0) {
          score += 5000; money += 70; player.hp = Math.min(player.maxHp, player.hp + 1);
          boss = null; enemyBullets.length = 0;
          startMusic("field");
          sfx("kill");
        }
        return false;
      }
      for (const enemy of enemies) {
        if (hitCircle(b, enemy)) {
          enemy.hp -= b.damage;
          if (enemy.hp <= 0) { enemies.splice(enemies.indexOf(enemy), 1); score += 120; money += 4; burst(enemy.x, enemy.y, "#ff5478"); }
          return false;
        }
      }
      return b.x > -20 && b.x < ARENA + 20 && b.y > -20 && b.y < H + 20;
    });
    enemyBullets.forEach(b => {
      if (b.curve) {
        const a = Math.atan2(b.vy, b.vx) + b.curve, s = Math.hypot(b.vx, b.vy);
        b.vx = Math.cos(a) * s; b.vy = Math.sin(a) * s;
      }
      b.x += b.vx; b.y += b.vy;
      if (hitCircle(player, b)) { b.dead = true; hurtPlayer(rule.damage); }
    });
    enemyBullets = enemyBullets.filter(b => !b.dead && b.x > -30 && b.x < ARENA + 30 && b.y > -30 && b.y < H + 30);
  }

  function updateCoins() {
    coins.forEach(c => {
      c.phase += .07;
      if (Math.hypot(player.x - c.x, player.y - c.y) < player.r + 24) {
        c.dead = true; score += 100; money += Math.round(8 * RULES[difficulty].coin); burst(c.x, c.y, "#ffd34d"); sfx("coin");
      }
    });
    const removed = coins.filter(c => c.dead).length;
    coins = coins.filter(c => !c.dead);
    for (let i = 0; i < removed; i++) spawnCoin();
  }

  function hurtPlayer(amount) {
    if (player.inv > 0) return;
    player.hp -= amount; player.inv = 90; shake = 16;
    sfx("hit");
    if (player.hp <= 0) endGame();
  }

  function endGame() {
    state = "gameover";
    clearInterval(musicTimer);
    document.querySelector("#gameOverTitle").textContent = "MISSION FAILED";
    document.querySelector("#finalStats").textContent = `${RULES[difficulty].label} · WAVE ${wave} · SCORE ${score}`;
    gameOver.classList.add("visible");
  }

  function burst(x, y, color) {
    for (let i = 0; i < 14; i++) {
      const a = rand() * Math.PI * 2, s = 1 + rand() * 5;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 28, color });
    }
  }

  function draw() {
    const ox = shake ? (Math.random() - .5) * shake : 0;
    const oy = shake ? (Math.random() - .5) * shake : 0;
    ctx.save(); ctx.translate(ox, oy);
    drawWorld();
    if (state === "playing" || state === "gameover") {
      coins.forEach(drawCoin);
      enemies.forEach(drawEnemy);
      bullets.forEach(drawPlayerBullet);
      enemyBullets.forEach(drawEnemyBullet);
      if (boss) drawBoss();
      drawPlayer();
      drawRemotePlayers();
      particles.forEach(p => { ctx.globalAlpha = p.life / 28; circle(p.x, p.y, 3, p.color); ctx.globalAlpha = 1; });
      drawHud();
      if (warning > 0 && boss) drawWarning();
      if (paused) drawPause();
    }
    ctx.restore();
  }

  function drawWorld() {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, ARENA, H);

    ctx.globalAlpha = .75;
    for (let i = 0; i < 90; i++) {
      const x = (i * 83 + 41) % ARENA;
      const y = (i * 137 + Math.floor(elapsed * (4 + i % 3))) % H;
      const size = i % 19 === 0 ? 1.8 : i % 7 === 0 ? 1.1 : .6;
      circle(x, y, size, i % 11 === 0 ? "#8fe8ff" : "#ffffff");
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = "#050505";
    ctx.fillRect(ARENA, 0, W - ARENA, H);
    ctx.strokeStyle = "#1a1a1a";
    ctx.beginPath();
    ctx.moveTo(ARENA, 0);
    ctx.lineTo(ARENA, H);
    ctx.stroke();
  }

  function drawCoin(c) {
    const width = 6 + Math.abs(Math.cos(c.phase)) * 12;
    ctx.fillStyle = "#6e4208"; ellipse(c.x, c.y, width + 4, 20);
    ctx.fillStyle = "#d99a16"; ellipse(c.x, c.y, width, 17);
    ctx.strokeStyle = "#fff0a6"; ctx.lineWidth = 2; ellipse(c.x, c.y, width, 17, true);
    if (width > 10) { ctx.fillStyle = "#fff1a8"; ctx.font = "bold 14px Georgia"; ctx.textAlign = "center"; ctx.fillText("C", c.x, c.y + 5); }
  }

  function drawPlayer() {
    const flash = player.inv > 0 && Math.floor(player.inv / 5) % 2;
    player.trail.forEach((point, index) => {
      ctx.globalAlpha = Math.max(0, point.life / 20) * .55;
      circle(point.x, point.y, Math.max(3, player.r - index), player.dashFrames > 0 ? avatar.accent : avatar.hull);
    });
    ctx.globalAlpha = 1;
    if (player.dashFrames > 0) {
      ctx.strokeStyle = "#c7f8ff"; ctx.lineWidth = 3; ctx.globalAlpha = player.dashFrames / 14;
      ctx.beginPath(); ctx.arc(player.x, player.y, 30 + (14 - player.dashFrames) * 3, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    }
    drawShip(ctx, player.x, player.y, .68, flash, avatar.ship, avatar);
    const a = Math.atan2(mouse.y - player.y, mouse.x - player.x);
    ctx.strokeStyle = [avatar.accent, avatar.glow, "#ff67d5", "#fff"][player.tier];
    ctx.lineWidth = 3 + player.tier; ctx.beginPath(); ctx.moveTo(player.x, player.y + 2); ctx.lineTo(player.x + Math.cos(a) * 28, player.y + 2 + Math.sin(a) * 28); ctx.stroke();
  }

  function drawRemotePlayers() {
    if (!room.enabled || !room.remotePlayers?.length) return;
    ctx.save();
    room.remotePlayers.forEach(remote => {
      const state = remote.state || {};
      const style = remote.avatar || {};
      ctx.globalAlpha = .55;
      drawShip(ctx, state.x ?? ARENA / 2, state.y ?? H / 2, .66, false, style.ship || "fighter", style);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#d9e5ff";
      ctx.font = "12px monospace";
      ctx.textAlign = "center";
      ctx.fillText(remote.name || "PILOT", state.x ?? ARENA / 2, (state.y ?? H / 2) - 34);
    });
    ctx.restore();
  }

  function drawEnemy(e) {
    ctx.save(); ctx.translate(e.x, e.y);
    if (e.type === "tank") {
      ctx.fillStyle = "#5e4034"; ctx.fillRect(-e.r, -e.r, e.r * 2, e.r * 2);
      ctx.strokeStyle = "#e6b85c"; ctx.lineWidth = 4; ctx.strokeRect(-e.r, -e.r, e.r * 2, e.r * 2);
      circle(0, 0, 11, "#ff9f1c");
    } else if (e.type === "fang") {
      ctx.fillStyle = "#e64b2e"; ctx.beginPath(); ctx.moveTo(0, -e.r - 9); ctx.lineTo(e.r + 8, e.r); ctx.lineTo(0, e.r - 5); ctx.lineTo(-e.r - 8, e.r); ctx.fill();
      circle(-6, -2, 4, "#fff4ca"); circle(6, -2, 4, "#fff4ca");
    } else if (e.type === "wisp") {
      circle(0, 0, e.r, "#58318b"); ellipse(0, 0, 13, 9, false, "#eee8ff"); circle(2, 0, 5, "#171027");
      const a = elapsed * 4 + e.phase; circle(Math.cos(a) * 31, Math.sin(a) * 31, 6, "#67e8f9");
    } else {
      ctx.fillStyle = "#b51f4d"; ctx.beginPath(); ctx.moveTo(0, -e.r - 8); ctx.lineTo(e.r + 6, 0); ctx.lineTo(0, e.r + 6); ctx.lineTo(-e.r - 6, 0); ctx.fill();
      ellipse(0, -2, 12, 7, false, "#fff"); circle(0, -2, 4, "#17050b");
    }
    ctx.restore();
  }

  function drawShip(target, x, y, scale = 1, flash = false, ship = "fighter", style = avatar) {
    const hull = flash ? "#ffffff" : (style.hull || avatar.hull);
    const accent = style.accent || avatar.accent;
    const glow = style.glow || avatar.glow;
    target.save();
    target.translate(x, y);
    target.scale(scale, scale);
    target.lineJoin = "round";

    target.fillStyle = "#0007";
    target.beginPath(); target.ellipse(0, 44, 34, 8, 0, 0, Math.PI * 2); target.fill();

    if (ship === "shuttle") {
      target.fillStyle = "#0f1524";
      target.beginPath(); target.roundRect(-22, -6, 44, 34, 11); target.fill();
      target.fillStyle = hull;
      target.beginPath(); target.moveTo(0, -34); target.lineTo(22, 8); target.lineTo(16, 32); target.lineTo(-16, 32); target.lineTo(-22, 8); target.fill();
      target.fillStyle = accent;
      target.beginPath(); target.roundRect(-8, -14, 16, 28, 6); target.fill();
      target.fillStyle = glow; circleOn(target, 0, -6, 5);
      target.fillStyle = "#dce7ef"; target.beginPath(); target.roundRect(-6, 13, 12, 10, 4); target.fill();
      target.fillStyle = glow; target.fillRect(-18, 28, 10, 10); target.fillRect(8, 28, 10, 10);
      target.strokeStyle = accent; target.lineWidth = 4;
      target.beginPath(); target.moveTo(-18, 14); target.lineTo(-30, 18); target.stroke();
      target.beginPath(); target.moveTo(18, 14); target.lineTo(30, 18); target.stroke();
    } else if (ship === "interceptor") {
      target.fillStyle = hull;
      target.beginPath(); target.moveTo(0, -34); target.lineTo(20, -8); target.lineTo(14, 30); target.lineTo(-14, 30); target.lineTo(-20, -8); target.fill();
      target.fillStyle = "#121a2e";
      target.beginPath(); target.moveTo(0, -28); target.lineTo(7, 0); target.lineTo(0, 25); target.lineTo(-7, 0); target.fill();
      target.fillStyle = accent;
      target.beginPath(); target.moveTo(-30, -2); target.lineTo(-10, -12); target.lineTo(-14, 2); target.lineTo(-10, 16); target.fill();
      target.beginPath(); target.moveTo(30, -2); target.lineTo(10, -12); target.lineTo(14, 2); target.lineTo(10, 16); target.fill();
      target.fillStyle = glow; circleOn(target, 0, -8, 4); circleOn(target, 0, 18, 4);
      target.fillStyle = "#dce7ef"; target.beginPath(); target.roundRect(-7, 6, 14, 12, 5); target.fill();
      target.strokeStyle = glow; target.lineWidth = 3;
      target.beginPath(); target.moveTo(-24, 18); target.lineTo(-34, 30); target.stroke();
      target.beginPath(); target.moveTo(24, 18); target.lineTo(34, 30); target.stroke();
    } else {
      target.fillStyle = hull;
      target.beginPath(); target.moveTo(0, -38); target.lineTo(26, 2); target.lineTo(16, 34); target.lineTo(-16, 34); target.lineTo(-26, 2); target.fill();
      target.fillStyle = "#0d1322";
      target.beginPath(); target.moveTo(0, -30); target.lineTo(11, 0); target.lineTo(0, 24); target.lineTo(-11, 0); target.fill();
      target.fillStyle = accent;
      target.beginPath(); target.roundRect(-18, -4, 36, 15, 6); target.fill();
      target.fillStyle = glow; circleOn(target, 0, -10, 5);
      target.fillStyle = "#dce7ef"; target.beginPath(); target.roundRect(-6, 10, 12, 10, 4); target.fill();
      target.fillStyle = "#7feaff"; target.fillRect(-20, 27, 12, 9); target.fillRect(8, 27, 12, 9);
      target.strokeStyle = accent; target.lineWidth = 4;
      target.beginPath(); target.moveTo(-24, 20); target.lineTo(-34, 30); target.stroke();
      target.beginPath(); target.moveTo(24, 20); target.lineTo(34, 30); target.stroke();
    }

    target.fillStyle = glow;
    target.beginPath(); target.arc(0, 0, 2.5, 0, Math.PI * 2); target.fill();
    target.restore();
  }

  function circleOn(target, x, y, r) {
    target.beginPath(); target.arc(x, y, r, 0, Math.PI * 2); target.fill();
  }

  function drawAvatarPreview() {
    if (!previewCanvas || !previewCtx) return;
    previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    const gradient = previewCtx.createRadialGradient(95, 90, 5, 95, 95, 100);
    gradient.addColorStop(0, "#17365d"); gradient.addColorStop(.5, "#0a1020"); gradient.addColorStop(1, "#04070f");
    previewCtx.fillStyle = gradient; previewCtx.fillRect(0, 0, 190, 190);
    for (let i = 0; i < 34; i++) circleOnPreview((i * 47) % 190, (i * 83) % 190, i % 7 === 0 ? 1.7 : .8);
    drawShip(previewCtx, 95, 106, 1.12, false, avatar.ship, avatar);
  }

  function circleOnPreview(x, y, r) {
    if (!previewCtx) return;
    previewCtx.beginPath(); previewCtx.arc(x, y, r, 0, Math.PI * 2);
    previewCtx.fillStyle = "#ffffff"; previewCtx.fill();
  }

  function drawBoss() {
    const colors = ["#ff315f", "#ff8a24", "#37dff5", "#b6ff35", "#ff4bea"];
    const color = colors[(boss.rank - 1) % colors.length];
    ctx.save(); ctx.translate(boss.x, boss.y);
    ctx.shadowBlur = 20; ctx.shadowColor = color; circle(0, 0, boss.r, "#160b18"); ctx.shadowBlur = 0;
    if (boss.type === 0) {
      ellipse(0, 0, 31, 20, false, "#eee0d4"); ellipse(0, 0, 11, 17, false, "#08040a"); circle(0, 0, 5, color);
    } else if (boss.type === 1) {
      circle(-18, -12, 8, color); circle(18, -12, 8, color);
      ctx.fillStyle = "#4b0716"; ctx.beginPath(); ctx.arc(0, 8, 34, 0, Math.PI); ctx.fill();
      for (let i = -24; i <= 24; i += 8) { ctx.fillStyle = "#fff0df"; ctx.fillRect(i, 8, 5, 13); }
    } else {
      for (let i = 0; i < 9; i++) {
        const a = i / 9 * Math.PI * 2 + elapsed;
        ellipse(Math.cos(a) * 68, Math.sin(a) * 55, 12, 8, false, "#eee"); circle(Math.cos(a) * 68, Math.sin(a) * 55, 4, color);
      }
      circle(0, 0, 27, "#000"); ctx.fillStyle = color; ctx.font = "bold 35px sans-serif"; ctx.textAlign = "center"; ctx.fillText("∅", 0, 12);
    }
    ctx.restore();
    ctx.fillStyle = "#1d1324"; ctx.fillRect(230, 22, 550, 18);
    ctx.fillStyle = color; ctx.fillRect(232, 24, 546 * Math.max(0, boss.hp) / boss.maxHp, 14);
    ctx.fillStyle = "#fff"; ctx.font = "bold 12px monospace"; ctx.textAlign = "center"; ctx.fillText(`BOSS · RANK ${boss.rank}`, 505, 57);
  }

  function drawPlayerBullet(b) {
    const color = ["#75f6ff", "#ffe568", "#ff67e6", "#ffffff"][player.tier];
    ctx.save();
    ctx.shadowColor = color; ctx.shadowBlur = 20;
    ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 3 + player.tier;
    ctx.beginPath(); ctx.moveTo(b.x - b.vx * 1.5, b.y - b.vy * 1.5); ctx.lineTo(b.x, b.y); ctx.stroke();
    circle(b.x, b.y, b.r + 2, color);
    circle(b.x, b.y, Math.max(2, b.r - 2), "#ffffff");
    ctx.restore();
  }
  function drawEnemyBullet(b) {
    ctx.save(); ctx.shadowColor = "#db72ff"; ctx.shadowBlur = 14;
    circle(b.x, b.y, b.r + 2, "#cf67ff"); circle(b.x, b.y, Math.max(2, b.r - 2), "#ffffff");
    ctx.restore();
  }

  function drawHud() {
    const x = 1032;
    ctx.textAlign = "left"; ctx.fillStyle = "#68e5f6"; ctx.font = "bold 20px sans-serif"; ctx.fillText("NEURAL RUSH", x, 38);
    ctx.fillStyle = "#93a2c1"; ctx.font = "12px sans-serif"; ctx.fillText(name, x, 61);
    if (room.enabled && room.code) ctx.fillText(`ROOM ${room.code}`, x, 78);
    ctx.fillStyle = "#fff"; ctx.font = "bold 28px monospace"; ctx.fillText(String(score).padStart(7, "0"), x, 103);
    ctx.fillStyle = "#ffd56a"; ctx.font = "bold 14px monospace"; ctx.fillText(`◈ ${money}   WAVE ${wave}`, x, 132);
    ctx.fillStyle = difficulty === "hard" ? "#ff406c" : "#9daac3"; ctx.fillText(`MODE · ${RULES[difficulty].label}`, x, 157);
    ctx.fillStyle = "#7f8ba6"; ctx.font = "11px monospace"; ctx.fillText("LIFE", x, 190);
    for (let i = 0; i < player.maxHp; i++) circle(x + 11 + i * 28, 212, 9, i < player.hp ? "#ff4f76" : "#283047");
    ctx.fillText("DASH", x, 250); ctx.fillStyle = "#263148"; ctx.fillRect(x, 262, 220, 10); ctx.fillStyle = "#67e8f9"; ctx.fillRect(x, 262, 220 * player.dash / 100, 10);
    ctx.fillStyle = "#ffd56a"; ctx.font = "bold 15px sans-serif"; ctx.fillText(`SHOP · TIER ${player.tier}`, x, 400);
    shopBox(x, 430, "HULL LASER", `공격력 ${player.damage}`, 30 + player.damageLevel * 25);
    shopBox(x, 505, "ENGINE CORE", `연사 ${player.fireDelay}`, 35 + player.rapidLevel * 25);
    shopBox(x, 580, "ARMOR PLATE", `최대 생명 ${player.maxHp}`, 70 + (player.maxHp - RULES[difficulty].hp) * 40);
  }

  function shopBox(x, y, title, detail, price) {
    ctx.fillStyle = money >= price ? "#1a3042" : "#171c2a"; ctx.fillRect(x, y, 220, 60);
    ctx.strokeStyle = money >= price ? "#67e8f9" : "#354057"; ctx.strokeRect(x, y, 220, 60);
    ctx.fillStyle = "#fff"; ctx.font = "bold 12px monospace"; ctx.fillText(title, x + 10, y + 20);
    ctx.fillStyle = "#93a2bc"; ctx.font = "11px sans-serif"; ctx.fillText(detail, x + 10, y + 42);
    ctx.fillStyle = "#ffd56a"; ctx.textAlign = "right"; ctx.fillText(`◈${price}`, x + 210, y + 34); ctx.textAlign = "left";
  }

  function drawWarning() {
    ctx.fillStyle = "#05030ae8"; ctx.fillRect(0, 210, ARENA, 300);
    ctx.strokeStyle = "#ff315f"; ctx.lineWidth = 4; ctx.strokeRect(0, 210, ARENA, 300);
    ctx.fillStyle = "#ff315f"; ctx.textAlign = "center"; ctx.font = "bold 45px monospace"; ctx.fillText("BOSS", ARENA / 2, 295);
    ctx.fillStyle = "#fff"; ctx.font = "bold 22px sans-serif"; ctx.fillText(`RANK ${boss.rank}`, ARENA / 2, 345);
  }

  function drawPause() {
    ctx.fillStyle = "#050712cc"; ctx.fillRect(0, 0, ARENA, H);
    ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.font = "bold 42px sans-serif"; ctx.fillText("PAUSED", ARENA / 2, H / 2);
  }

  function hitCircle(a, b) { return Math.hypot(a.x - b.x, a.y - b.y) < (a.r || 4) + (b.r || 4); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function circle(x, y, r, fill) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); }
  function ellipse(x, y, rx, ry, stroke = false, fill = null) {
    ctx.beginPath(); ctx.ellipse(x, y, Math.max(1, rx), ry, 0, 0, Math.PI * 2);
    if (fill) ctx.fillStyle = fill;
    stroke ? ctx.stroke() : ctx.fill();
  }

  function frame(now) {
    const dt = Math.min(.033, ((now - (last || now)) / 1000));
    last = now; update(dt); draw(); requestAnimationFrame(frame);
  }
  drawAvatarPreview();
  requestAnimationFrame(drawAvatarPreview);
  window.addEventListener("load", drawAvatarPreview);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) drawAvatarPreview();
  });
  requestAnimationFrame(frame);
})();
