/* ============================================================
   MESSI: TWO-FOOTED
   A twin-stick dribbling game. Each thumbstick drives one leg.
   Vanilla canvas, no dependencies, no external assets.
   ============================================================ */
(() => {
  'use strict';

  // ── Constants ────────────────────────────────────────────────
  const FIELD = Object.freeze({
    w: 34,
    h: 56,
    cx: 17,
    goalHalf: 6,
    goalDepth: 2.6,
    boxW: 20,
    boxD: 9,
    sixW: 12,
    sixD: 4.2,
  });

  const START_TIME = 75;
  const GOAL_TIME_BONUS = 6;
  const MAX_SPEED = 7.7;
  const FOOT_REACH = 1.82;
  const BALL_RADIUS = 0.46;
  const FOOT_RADIUS = 0.47;
  const COMBO_WINDOW = 11;

  const COLORS = Object.freeze({
    sky: '#7fd6ff',
    skyDeep: '#3aa8e0',
    gold: '#ffd166',
    coral: '#ff6b5e',
    paper: '#f4fbff',
    ink: '#06121d',
    grassTop: '#2b935b',
    grassBottom: '#0c5434',
    skin: '#cf936d',
    skinShade: '#a86f50',
  });

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const hypot = Math.hypot;
  const TAU = Math.PI * 2;

  function hash(n) {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
    return s - Math.floor(s);
  }

  function norm(x, y) {
    const m = hypot(x, y);
    return m > 0.0001 ? { x: x / m, y: y / m, m } : { x: 0, y: 0, m: 0 };
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  function ellipsePath(ctx, x, y, rx, ry, rot = 0) {
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, TAU);
  }

  // ── DOM ──────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  let ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  const hud = $('hud');
  const titleScreen = $('titleScreen');
  const howScreen = $('howScreen');
  const pauseScreen = $('pauseScreen');
  const finalScreen = $('finalScreen');
  const timerEl = $('timer');
  const scoreEl = $('score');
  const goalsEl = $('goals');
  const difficultyEl = $('difficulty');
  const timeStat = $('timeStat');
  const comboEl = $('combo');
  const toastEl = $('toast');
  const goalBanner = $('goalBanner');
  const goalWord = $('goalWord');
  const goalSub = $('goalSub');
  const hintStrip = $('hintStrip');
  const titleBest = $('titleBest');
  const newBestEl = $('newBest');
  const muteBtn = $('muteBtn');
  const gamepadHint = document.querySelector('.gamepad-hint');

  // ── Tiny persistence ─────────────────────────────────────────
  const STORE_KEY = 'messi-two-footed-v1';
  function loadStore() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return { best: 0, bestGoals: 0, muted: false };
      const data = JSON.parse(raw);
      return {
        best: Number(data.best) || 0,
        bestGoals: Number(data.bestGoals) || 0,
        muted: Boolean(data.muted),
      };
    } catch {
      return { best: 0, bestGoals: 0, muted: false };
    }
  }
  function saveStore() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* private mode */ }
  }
  const store = loadStore();

  // ── Sound ────────────────────────────────────────────────────
  class SoundEngine {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.ambient = null;
      this.ambientGain = null;
      this.noiseBuffer = null;
      this.muted = store.muted;
      this.intensity = 0;
    }

    init() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        const ac = new AC();
        this.ctx = ac;
        this.master = ac.createGain();
        this.master.gain.value = this.muted ? 0 : 0.55;
        this.master.connect(ac.destination);

        const length = Math.floor(ac.sampleRate * 1.2);
        const buffer = ac.createBuffer(1, length, ac.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
        this.noiseBuffer = buffer;

        // A soft stadium bed: filtered noise plus a low, slow swell.
        const source = ac.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        const filter = ac.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 520;
        filter.Q.value = 0.4;
        const gain = ac.createGain();
        gain.gain.value = 0.018;
        source.connect(filter).connect(gain).connect(this.master);
        source.start();
        this.ambient = source;
        this.ambientGain = gain;
        if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      } catch { /* audio is a bonus */ }
    }

    setIntensity(value) {
      this.intensity = value;
      if (!this.ctx || !this.ambientGain) return;
      const target = this.muted ? 0 : 0.012 + value * 0.03;
      this.ambientGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.4);
    }

    tone(freq, dur, opts = {}) {
      if (!this.ctx || this.muted) return;
      const ac = this.ctx;
      const t = ac.currentTime;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = opts.type || 'sine';
      osc.frequency.setValueAtTime(freq, t);
      if (opts.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t + dur);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.volume || 0.06), t + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(this.master);
      osc.start(t);
      osc.stop(t + dur + 0.03);
    }

    noise(dur, opts = {}) {
      if (!this.ctx || !this.noiseBuffer || this.muted) return;
      const ac = this.ctx;
      const t = ac.currentTime;
      const src = ac.createBufferSource();
      src.buffer = this.noiseBuffer;
      const filter = ac.createBiquadFilter();
      filter.type = opts.type || 'bandpass';
      filter.frequency.setValueAtTime(opts.freq || 900, t);
      if (opts.to) filter.frequency.exponentialRampToValueAtTime(Math.max(40, opts.to), t + dur);
      filter.Q.value = opts.q || 0.7;
      const gain = ac.createGain();
      const vol = opts.volume || 0.06;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(vol, t + (opts.attack || 0.01));
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(filter).connect(gain).connect(this.master);
      src.start(t, Math.random() * 0.5);
      src.stop(t + dur + 0.05);
    }

    kick(power = 10) {
      const p = clamp(power / 26, 0.14, 1);
      this.tone(150 + p * 60, 0.11 + p * 0.06, { type: 'sine', to: 48, volume: 0.035 + p * 0.1 });
      this.noise(0.055 + p * 0.045, { type: 'bandpass', freq: 750 + p * 900, q: 0.8, volume: 0.02 + p * 0.06 });
    }

    step() {
      this.noise(0.035, { type: 'lowpass', freq: 320, volume: 0.006 });
    }

    tackle() {
      this.tone(86, 0.19, { type: 'triangle', to: 42, volume: 0.12 });
      this.noise(0.17, { type: 'lowpass', freq: 480, volume: 0.1 });
    }

    save() {
      this.tone(220, 0.1, { type: 'square', to: 140, volume: 0.035 });
      this.noise(0.08, { type: 'bandpass', freq: 450, volume: 0.05 });
    }

    whistle(long = false) {
      const d = long ? 0.85 : 0.28;
      this.tone(2180, d, { type: 'sine', volume: 0.025, to: 2260 });
      this.tone(2490, d * 0.95, { type: 'sine', volume: 0.018, to: 2420 });
    }

    goal() {
      const notes = [392, 523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, i) => {
        setTimeout(() => this.tone(f, 0.55, { type: 'triangle', volume: 0.045 }), i * 82);
      });
      this.noise(1.4, { type: 'bandpass', freq: 720, q: 0.35, volume: 0.14, attack: 0.08 });
      this.noise(0.5, { type: 'highpass', freq: 2400, volume: 0.05, attack: 0.02 });
    }

    click() {
      this.tone(780, 0.05, { type: 'sine', volume: 0.028 });
    }

    setMuted(muted) {
      this.muted = muted;
      store.muted = muted;
      saveStore();
      muteBtn.classList.toggle('is-muted', muted);
      muteBtn.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
      muteBtn.setAttribute('title', muted ? 'Unmute sound' : 'Mute sound');
      if (this.master && this.ctx) {
        this.master.gain.setTargetAtTime(muted ? 0 : 0.55, this.ctx.currentTime, 0.04);
      }
      this.setIntensity(this.intensity);
    }
  }
  const sound = new SoundEngine();
  sound.setMuted(store.muted);

  // ── View & resize ────────────────────────────────────────────
  const view = {
    s: 12, ox: 0, oy: 0, topPad: 80, availH: 700, wide: false, camH: 60, dpr: 1,
  };
  let W = 1;
  let H = 1;
  let isCoarse = window.matchMedia?.('(pointer: coarse)').matches || false;
  let backdrop = null;
  let pitchCanvas = null;
  const PITCH_PAD = { left: 1.5, top: 3.5, right: 1.5, bottom: 3.5 };

  function resize() {
    W = Math.max(1, window.innerWidth);
    H = Math.max(1, window.innerHeight);
    // Keep the backing store near a one-megapixel budget. Crisp on phones,
    // and still readable on a software-rendered desktop.
    const budget = 820000;
    const cap = Math.sqrt(budget / Math.max(1, W * H));
    const dpr = clamp(Math.min(window.devicePixelRatio || 1, 1.6, cap), 0.7, 2);
    view.dpr = dpr;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    isCoarse = window.matchMedia?.('(pointer: coarse)').matches || isCoarse;

    const narrow = W < 700;
    const topPad = clamp(narrow ? 106 : 118, 88, H * 0.34);
    const bottomPad = 12;
    const availW = W - (narrow ? 14 : 28);
    const availH = H - topPad - bottomPad;
    const wide = W / H > 1.05 && H < 1100;

    view.topPad = topPad;
    view.availH = availH;
    view.wide = wide;

    if (wide) {
      const winH = clamp(availH / 18, 22, 38);
      const s = Math.min(availW / FIELD.w, availH / winH);
      view.s = Math.max(5.5, s);
      view.ox = W / 2 - (FIELD.w / 2) * view.s;
      view.camH = availH / view.s;
      game.camera.top = clamp(
        game.player.y - view.camH * 0.6 - 6,
        -4,
        FIELD.h - view.camH + 7
      );
      view.oy = topPad - game.camera.top * view.s;
    } else {
      const s = Math.min(availW / FIELD.w, availH / (FIELD.h + 4.6));
      view.s = Math.max(5, s);
      view.ox = W / 2 - (FIELD.w / 2) * view.s;
      view.oy = topPad + (availH - FIELD.h * view.s) / 2;
      view.camH = availH / view.s;
    }

    buildBackdrop();
    buildGrassSpecks();
    buildPitchCanvas();
  }

  function sx(x) { return view.ox + x * view.s + game.shakeX; }
  function sy(y) { return view.oy + y * view.s + game.shakeY; }
  function ss(v) { return v * view.s; }

  // ── Input ────────────────────────────────────────────────────
  const keys = new Set();
  const touchInput = {
    left: { active: false, id: null, cx: 0, cy: 0, x: 0, y: 0 },
    right: { active: false, id: null, cx: 0, cy: 0, x: 0, y: 0 },
  };
  let debugSticks = null;
  let gamepadConnected = false;
  let lastGamepadCount = 0;

  function stickRadius() {
    return clamp(Math.min(W, H) * 0.085, 40, 64);
  }

  function stickRest(side) {
    const r = stickRadius();
    const y = H - r - 26 - (isCoarse ? 10 : 14);
    return {
      x: side === 'left' ? r + 24 : W - r - 24,
      y,
      r,
    };
  }

  function readKeyboard() {
    const lx = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    const ly = (keys.has('KeyS') ? 1 : 0) - (keys.has('KeyW') ? 1 : 0);
    const rx = (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0);
    const ry = (keys.has('ArrowDown') ? 1 : 0) - (keys.has('ArrowUp') ? 1 : 0);
    const l = norm(lx, ly);
    const r = norm(rx, ry);
    return {
      left: { x: l.x * Math.min(1, l.m), y: l.y * Math.min(1, l.m), mag: Math.min(1, l.m) },
      right: { x: r.x * Math.min(1, r.m), y: r.y * Math.min(1, r.m), mag: Math.min(1, r.m) },
    };
  }

  function deadzone(v, dz = 0.16) {
    const a = Math.abs(v);
    if (a <= dz) return 0;
    return Math.sign(v) * ((a - dz) / (1 - dz));
  }

  function readGamepad() {
    let best = null;
    try {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const pad of pads) {
        if (!pad || !pad.connected) continue;
        const lx = deadzone(pad.axes[0] || 0);
        const ly = deadzone(pad.axes[1] || 0);
        const rx = deadzone(pad.axes[2] || 0);
        const ry = deadzone(pad.axes[3] || 0);
        const lm = Math.min(1, hypot(lx, ly));
        const rm = Math.min(1, hypot(rx, ry));
        if (!best || lm + rm > best.left.mag + best.right.mag) {
          best = {
            left: { x: lx, y: ly, mag: lm },
            right: { x: rx, y: ry, mag: rm },
          };
        }
      }
    } catch { /* ignore */ }
    return best;
  }

  function readInput() {
    if (debugSticks) {
      return {
        left: { ...debugSticks.left },
        right: { ...debugSticks.right },
      };
    }
    const kb = readKeyboard();
    const gp = readGamepad();
    const result = {
      left: { x: kb.left.x, y: kb.left.y, mag: kb.left.mag },
      right: { x: kb.right.x, y: kb.right.y, mag: kb.right.mag },
    };
    if (gp) {
      if (gp.left.mag > result.left.mag) result.left = gp.left;
      if (gp.right.mag > result.right.mag) result.right = gp.right;
    }
    if (touchInput.left.active) {
      result.left = { x: touchInput.left.x, y: touchInput.left.y, mag: hypot(touchInput.left.x, touchInput.left.y) };
    }
    if (touchInput.right.active) {
      result.right = { x: touchInput.right.x, y: touchInput.right.y, mag: hypot(touchInput.right.x, touchInput.right.y) };
    }
    return result;
  }

  function resetTouchSide(side) {
    const t = touchInput[side];
    t.active = false;
    t.id = null;
    t.x = 0;
    t.y = 0;
  }

  function onPointerDown(event) {
    if (game.mode !== 'playing') return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (event.clientY < H * 0.34) return;
    const side = event.clientX < W / 2 ? 'left' : 'right';
    const t = touchInput[side];
    if (t.active) return;
    const r = stickRadius();
    t.active = true;
    t.id = event.pointerId;
    t.cx = clamp(event.clientX, r + 14, W - r - 14);
    t.cy = clamp(event.clientY, H * 0.34 + r, H - r - 16);
    t.x = 0;
    t.y = 0;
    try { canvas.setPointerCapture(event.pointerId); } catch { /* ignore */ }
    event.preventDefault();
  }

  function onPointerMove(event) {
    for (const side of ['left', 'right']) {
      const t = touchInput[side];
      if (!t.active || t.id !== event.pointerId) continue;
      const r = stickRadius();
      let dx = event.clientX - t.cx;
      let dy = event.clientY - t.cy;
      const max = r * 0.74;
      const m = hypot(dx, dy);
      if (m > max * 1.35) {
        // Drag the floating base a little if the thumb travels far.
        const excess = (m - max * 1.35) / m;
        t.cx += dx * excess;
        t.cy += dy * excess;
        dx = event.clientX - t.cx;
        dy = event.clientY - t.cy;
      }
      const nm = norm(dx, dy);
      const amount = clamp(nm.m / max, 0, 1);
      const dz = 0.1;
      const curved = amount <= dz ? 0 : (amount - dz) / (1 - dz);
      t.x = nm.x * curved;
      t.y = nm.y * curved;
      event.preventDefault();
    }
  }

  function onPointerUp(event) {
    for (const side of ['left', 'right']) {
      if (touchInput[side].active && touchInput[side].id === event.pointerId) resetTouchSide(side);
    }
  }

  window.addEventListener('pointerdown', onPointerDown, { passive: false });
  window.addEventListener('pointermove', onPointerMove, { passive: false });
  window.addEventListener('pointerup', onPointerUp, { passive: false });
  window.addEventListener('pointercancel', onPointerUp, { passive: false });

  window.addEventListener('keydown', (event) => {
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
      keys.add(event.code);
      event.preventDefault();
    }
    if (event.code === 'Escape' || event.code === 'KeyP') {
      event.preventDefault();
      if (!howScreen.hidden) closeHow();
      else if (game.mode === 'playing') pauseGame();
      else if (game.mode === 'paused') resumeGame();
    }
    if (event.code === 'KeyM') toggleMute();
  }, { passive: false });

  window.addEventListener('keyup', (event) => {
    keys.delete(event.code);
  });

  window.addEventListener('blur', () => {
    keys.clear();
    resetTouchSide('left');
    resetTouchSide('right');
    if (game.mode === 'playing') pauseGame();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.mode === 'playing') pauseGame();
  });

  function detectGamepad() {
    let count = 0;
    try {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const pad of pads) if (pad && pad.connected) count++;
    } catch { /* ignore */ }
    if (count !== lastGamepadCount) {
      lastGamepadCount = count;
      gamepadConnected = count > 0;
      if (gamepadHint) gamepadHint.hidden = !gamepadConnected;
    }
  }
  window.addEventListener('gamepadconnected', detectGamepad);
  window.addEventListener('gamepaddisconnected', detectGamepad);

  // ── Game state ───────────────────────────────────────────────
  const game = {
    mode: 'title',
    previousMode: 'title',
    anim: 0,
    clock: 0,
    timeLeft: START_TIME,
    score: 0,
    goals: 0,
    combo: 1,
    bestCombo: 1,
    comboTimer: 0,
    goalTimer: 0,
    goalFlash: 0,
    shake: 0,
    shakeX: 0,
    shakeY: 0,
    slowmo: 1,
    hintTimer: 0,
    kickoffFlash: 0,
    kickoffGrace: 0,
    lastGoalDistance: 0,
    stats: { shots: 0, saves: 0, tackles: 0, beaten: 0, longest: 0 },
    camera: { top: 0 },
    player: null,
    ball: null,
    defenders: [],
    keeper: null,
    particles: [],
    floaters: [],
    confetti: [],
    rings: [],
    trail: [],
    specks: [],
    lastStepSound: 0,
    layers: { backdrop: true, crowd: true, pitch: true, boards: true, goals: true, entities: true, effects: true, sticks: true },
  };

  function makeFoot(side, x, y) {
    return { side, x, y, vx: 0, vy: 0, kickCd: 0, swing: 0, flick: 0, flickArm: 0, prevStick: { x: 0, y: 0 } };
  }

  function makePlayer() {
    return {
      x: FIELD.cx,
      y: 26.5,
      vx: 0,
      vy: 0,
      lean: 0,
      bounce: 0,
      stumble: 0,
      possession: false,
      gait: 0,
      feet: [
        makeFoot(-1, FIELD.cx - 0.55, 26.8),
        makeFoot(1, FIELD.cx + 0.55, 26.8),
      ],
    };
  }

  function makeBall() {
    return {
      x: FIELD.cx,
      y: 24.2,
      vx: 0,
      vy: 0,
      rot: 0,
      spin: 0,
      radius: BALL_RADIUS,
      immune: 0,
      controlLock: 0,
      ripple: null,
    };
  }

  function makeKeeper() {
    return {
      x: FIELD.cx,
      y: 2.05,
      homeX: FIELD.cx,
      vx: 0,
      vy: 0,
      lean: 0,
      dive: 0,
      saveCd: 0,
      feet: [makeFoot(-1, FIELD.cx - 0.4, 2.7), makeFoot(1, FIELD.cx + 0.4, 2.7)],
    };
  }

  function defenderCountForGoals(goals) {
    return 2 + Math.min(3, Math.floor(goals / 2));
  }

  function makeDefender(index, total) {
    const spread = total <= 1 ? 0 : index / (total - 1);
    return {
      x: 9 + spread * 16 + rand(-1.4, 1.4),
      y: 17 + rand(0, 9),
      vx: 0,
      vy: 0,
      lean: rand(-0.2, 0.2),
      gait: rand(0, TAU),
      speed: 4.35 + game.goals * 0.19 + rand(-0.18, 0.22),
      tackleCd: 0,
      stun: 0,
      beatenCd: 0,
      lastBallY: 40,
      shirt: index % 3 === 0 ? '#c93a42' : index % 3 === 1 ? '#d94b46' : '#b92e3c',
      skin: ['#bb7e5b', '#8a5b3e', '#d7a078', '#6f452e'][index % 4],
      hair: ['#1e1713', '#33231b', '#0f0d0c', '#604027'][index % 4],
      feet: [makeFoot(-1, 0, 0), makeFoot(1, 0, 0)],
    };
  }

  function spawnDefenders(count, reset = true) {
    game.defenders = [];
    for (let i = 0; i < count; i++) {
      const d = makeDefender(i, count);
      game.defenders.push(d);
    }
    if (reset) {
      // Open up the kickoff lane; defenders sit deeper but not stacked.
      game.defenders.forEach((d, i) => {
        d.x = 11 + (i / Math.max(1, count - 1)) * 12 + rand(-1, 1);
        d.y = 10 + (i % 2) * 5 + rand(-1.1, 1.1);
        d.feet[0].x = d.x - 0.43;
        d.feet[0].y = d.y + 0.28;
        d.feet[1].x = d.x + 0.43;
        d.feet[1].y = d.y + 0.28;
      });
    }
  }

  function resetEntities(full = false) {
    game.player = makePlayer();
    game.ball = makeBall();
    game.keeper = makeKeeper();
    game.particles.length = 0;
    game.floaters.length = 0;
    game.rings.length = 0;
    game.trail.length = 0;
    if (full) {
      game.defenders = [];
      spawnDefenders(2, true);
    } else {
      const count = defenderCountForGoals(game.goals);
      const oldCount = game.defenders.length;
      spawnDefenders(count, true);
      if (count > oldCount && game.mode === 'playing') {
        showToast(`DEFENDERS +${count - oldCount}`, 'warn', 1200);
      }
    }
    if (view.wide) {
      game.camera.top = clamp(
        game.player.y - view.camH * 0.6 - 6,
        -4,
        FIELD.h - view.camH + 7
      );
      view.oy = view.topPad - game.camera.top * view.s;
    }
  }

  // ── UI helpers ───────────────────────────────────────────────
  let toastTimer = 0;
  function showToast(text, tone = '', duration = 1300) {
    toastEl.textContent = text;
    toastEl.className = `toast show ${tone}`.trim();
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.className = 'toast'; }, duration);
  }

  let goalBannerTimer = 0;
  function showGoalBanner(word, sub) {
    goalWord.textContent = word;
    goalSub.textContent = sub;
    goalBanner.classList.add('show');
    goalBanner.setAttribute('aria-hidden', 'false');
    clearTimeout(goalBannerTimer);
    goalBannerTimer = setTimeout(() => {
      goalBanner.classList.remove('show');
      goalBanner.setAttribute('aria-hidden', 'true');
    }, 1750);
  }

  function updateComboUI() {
    if (game.combo > 1 && game.comboTimer > 0) {
      comboEl.innerHTML = `×${game.combo}<span>COMBO</span>`;
      comboEl.classList.add('show');
    } else {
      comboEl.classList.remove('show');
    }
  }

  function padScore(n) {
    return String(Math.max(0, Math.round(n))).padStart(4, '0');
  }

  function updateHud() {
    const seconds = Math.max(0, Math.ceil(game.timeLeft));
    const mm = Math.floor(seconds / 60);
    const ss = seconds % 60;
    timerEl.textContent = `${mm}:${String(ss).padStart(2, '0')}`;
    scoreEl.textContent = padScore(game.score);
    goalsEl.textContent = `${game.goals} ${game.goals === 1 ? 'GOAL' : 'GOALS'}`;
    difficultyEl.textContent = `${game.defenders.length} DEFENDERS`;
    timeStat.classList.toggle('is-low', game.timeLeft <= 10 && game.mode === 'playing');
    updateComboUI();
  }

  function hideAllScreens() {
    for (const el of [titleScreen, howScreen, pauseScreen, finalScreen]) el.hidden = true;
  }

  function showTitle() {
    game.mode = 'title';
    game.previousMode = 'title';
    hideAllScreens();
    titleScreen.hidden = false;
    hud.classList.add('is-dim');
    hud.setAttribute('aria-hidden', 'true');
    goalBanner.classList.remove('show');
    comboEl.classList.remove('show');
    hintStrip.classList.remove('is-gone');
    game.confetti.length = 0;
    resetEntities(true);
    titleBest.textContent = padScore(store.best);
    sound.setIntensity(0.15);
    sound.setMuted(store.muted);
  }

  function startMatch() {
    sound.init();
    hideAllScreens();
    hud.hidden = false;
    hud.classList.remove('is-dim');
    hud.setAttribute('aria-hidden', 'false');
    game.mode = 'playing';
    game.timeLeft = START_TIME;
    game.score = 0;
    game.goals = 0;
    game.combo = 1;
    game.bestCombo = 1;
    game.comboTimer = 0;
    game.goalTimer = 0;
    game.goalFlash = 0;
    game.kickoffFlash = 1;
    game.kickoffGrace = 1.5;
    game.clock = 0;
    game.hintTimer = 0;
    game.stats = { shots: 0, saves: 0, tackles: 0, beaten: 0, longest: 0 };
    game.lastGoalDistance = 0;
    game.slowmo = 1;
    hintStrip.classList.remove('is-gone');
    resetEntities(true);
    updateHud();
    showToast('KICK OFF', 'good', 850);
    sound.whistle(false);
    sound.setIntensity(0.5);
    requestAnimationFrame(() => canvas.focus?.());
  }

  function pauseGame() {
    if (game.mode !== 'playing') return;
    game.previousMode = game.mode;
    game.mode = 'paused';
    pauseScreen.hidden = false;
    hud.classList.add('is-dim');
    resetTouchSide('left');
    resetTouchSide('right');
    keys.clear();
    sound.setIntensity(0.08);
  }

  function resumeGame() {
    if (game.mode !== 'paused') return;
    game.mode = 'playing';
    pauseScreen.hidden = true;
    hud.classList.remove('is-dim');
    sound.init();
    sound.setIntensity(0.5);
  }

  function quitToTitle() {
    pauseScreen.hidden = true;
    finalScreen.hidden = true;
    showTitle();
  }

  function endMatch() {
    if (game.mode === 'over') return;
    game.mode = 'over';
    game.timeLeft = 0;
    updateHud();
    sound.whistle(true);
    sound.setIntensity(0.15);
    resetTouchSide('left');
    resetTouchSide('right');
    keys.clear();

    const isBest = game.score > store.best;
    if (isBest) {
      store.best = game.score;
      store.bestGoals = game.goals;
      saveStore();
    }
    $('finalScore').textContent = padScore(game.score);
    $('finalGoals').textContent = String(game.goals);
    $('finalCombo').textContent = `×${game.bestCombo}`;
    $('finalBeaten').textContent = String(game.stats.beaten);
    newBestEl.hidden = !isBest;
    titleBest.textContent = padScore(store.best);
    finalScreen.hidden = false;
    hud.classList.add('is-dim');
    if (isBest) {
      spawnConfetti(150);
      setTimeout(() => spawnConfetti(80), 350);
    }
  }

  function openHow() {
    sound.init();
    sound.click();
    howScreen.hidden = false;
    titleScreen.hidden = true;
  }

  function closeHow() {
    sound.click();
    howScreen.hidden = true;
    if (game.mode === 'title') titleScreen.hidden = false;
  }

  function toggleMute() {
    sound.init();
    sound.setMuted(!sound.muted);
    sound.click();
    if (!sound.muted) {
      showToast('SOUND ON', 'good', 700);
    } else {
      showToast('SOUND OFF', '', 700);
    }
  }

  // ── Buttons ──────────────────────────────────────────────────
  $('playBtn').addEventListener('click', () => { sound.click(); startMatch(); });
  $('againBtn').addEventListener('click', () => { sound.click(); startMatch(); });
  $('homeBtn').addEventListener('click', () => { sound.click(); quitToTitle(); });
  $('pauseBtn').addEventListener('click', () => {
    if (game.mode === 'playing') { sound.click(); pauseGame(); }
  });
  $('resumeBtn').addEventListener('click', () => { sound.click(); resumeGame(); });
  $('quitBtn').addEventListener('click', () => { sound.click(); quitToTitle(); });
  $('howBtn').addEventListener('click', openHow);
  $('closeHowBtn').addEventListener('click', closeHow);
  $('gotItBtn').addEventListener('click', closeHow);
  muteBtn.addEventListener('click', toggleMute);
  muteBtn.classList.toggle('is-muted', store.muted);
  muteBtn.setAttribute('aria-label', store.muted ? 'Unmute sound' : 'Mute sound');

  // ── Particles & effects ──────────────────────────────────────
  function spawnBurst(x, y, color, count = 8, speed = 7, type = 'dot') {
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU);
      const v = rand(speed * 0.25, speed);
      game.particles.push({
        x, y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: rand(0.28, 0.7),
        maxLife: 0.7,
        size: rand(0.045, 0.13),
        color,
        type,
        rot: rand(0, TAU),
        vr: rand(-9, 9),
      });
    }
  }

  function spawnRing(x, y, color = COLORS.sky, size = 1.2) {
    game.rings.push({ x, y, r: 0.2, max: size, life: 0.45, maxLife: 0.45, color });
  }

  function addFloater(x, y, text, color = COLORS.paper, size = 1.1) {
    game.floaters.push({ x, y, text, color, size, life: 1.1, maxLife: 1.1 });
  }

  function spawnConfetti(count) {
    const palette = [COLORS.sky, '#f7fdff', COLORS.gold, '#7cf0c3', '#ff8b78'];
    for (let i = 0; i < count; i++) {
      game.confetti.push({
        x: rand(0, W),
        y: rand(-H * 0.5, -10),
        vx: rand(-50, 50),
        vy: rand(80, 250),
        w: rand(3, 8),
        h: rand(5, 12),
        rot: rand(0, TAU),
        vr: rand(-9, 9),
        color: palette[randInt(0, palette.length - 1)],
        life: rand(2.2, 4.4),
      });
    }
  }

  // ── Player update ────────────────────────────────────────────
  function updatePlayer(dt, input) {
    const p = game.player;
    const L = input.left;
    const R = input.right;

    const ax = (L.x + R.x) * 0.5;
    const ay = (L.y + R.y) * 0.5;
    const inputMag = Math.min(1, hypot(ax, ay) * 1.52);
    const stumbleScale = p.stumble > 0 ? 0.28 : 1;
    const targetSpeed = MAX_SPEED * inputMag * stumbleScale;
    const desired = norm(ax, ay);

    const accel = inputMag > 0.03 ? 12 : 15;
    p.vx = lerp(p.vx, desired.x * targetSpeed, Math.min(1, dt * accel));
    p.vy = lerp(p.vy, desired.y * targetSpeed, Math.min(1, dt * accel));
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.x = clamp(p.x, 1.1, FIELD.w - 1.1);
    p.y = clamp(p.y, 1.2, FIELD.h - 1.15);

    const speed = hypot(p.vx, p.vy);
    p.lean = lerp(p.lean, clamp(p.vx / MAX_SPEED * 0.24 + (R.x - L.x) * 0.07, -0.3, 0.3), Math.min(1, dt * 8));
    p.bounce = lerp(p.bounce, speed > 0.4 ? Math.sin(game.anim * 13) * 0.035 : Math.sin(game.anim * 2.2) * 0.012, Math.min(1, dt * 10));
    p.gait += speed * dt * 2.3;
    p.stumble = Math.max(0, p.stumble - dt);

    // Independent leg control. Each stick pulls its own foot around the hips.
    // Pushing both sticks out from rest is a run, not a flick, so the opening
    // touch stays a dribble. A single-stick or mid-run snap is a strike.
    const dl = hypot(L.x - p.feet[0].prevStick.x, L.y - p.feet[0].prevStick.y);
    const dr = hypot(R.x - p.feet[1].prevStick.x, R.y - p.feet[1].prevStick.y);
    const runPush = dl > 0.35 && dr > 0.35 &&
      hypot(p.feet[0].prevStick.x, p.feet[0].prevStick.y) < 0.2 &&
      hypot(p.feet[1].prevStick.x, p.feet[1].prevStick.y) < 0.2;

    for (let i = 0; i < 2; i++) {
      const foot = p.feet[i];
      const sv = i === 0 ? L : R;
      const delta = i === 0 ? dl : dr;
      const prevMag = hypot(foot.prevStick.x, foot.prevStick.y);
      const now = performance.now();
      const sampleDt = clamp((now - (foot.lastSampleAt || now)) / 1000, 1 / 240, 0.25);
      foot.lastSampleAt = now;
      foot.flick = Math.max(0, foot.flick - dt * 2.2);
      foot.flickArm = Math.max(0, foot.flickArm - dt);
      const fromRest = prevMag < 0.2;
      const flickSpeed = delta / sampleDt;
      if (!runPush && (fromRest ? delta > 0.4 : (delta > 0.9 && flickSpeed > 4.5))) {
        foot.flick = Math.max(foot.flick, Math.min(1, delta * 3));
        foot.flickFromRest = fromRest;
        if (fromRest) foot.flickArm = 0.18;
      }
      foot.prevStick.x = sv.x;
      foot.prevStick.y = sv.y;

      const restX = p.x + (i === 0 ? -0.56 : 0.56);
      const restY = p.y + 0.22;
      const tx = clamp(restX + sv.x * FOOT_REACH, 0.55, FIELD.w - 0.55);
      const ty = clamp(restY + sv.y * FOOT_REACH, 0.7, FIELD.h - 0.6);

      const k = 138;
      const damping = 18.5;
      foot.vx += ((tx - foot.x) * k - foot.vx * damping) * dt;
      foot.vy += ((ty - foot.y) * k - foot.vy * damping) * dt;
      const fm = hypot(foot.vx, foot.vy);
      if (fm > 31) {
        foot.vx = (foot.vx / fm) * 31;
        foot.vy = (foot.vy / fm) * 31;
      }
      foot.x = clamp(foot.x + foot.vx * dt, 0.5, FIELD.w - 0.5);
      foot.y = clamp(foot.y + foot.vy * dt, 0.55, FIELD.h - 0.45);
      foot.kickCd = Math.max(0, foot.kickCd - dt);

      // A foot step makes a faint grass rustle when the body is really moving.
      if (speed > 4.6 && foot.kickCd <= 0 && Math.random() < dt * 2.4) {
        game.particles.push({
          x: foot.x + rand(-0.12, 0.12), y: foot.y + rand(0, 0.12),
          vx: rand(-0.4, 0.4) - p.vx * 0.06, vy: rand(-0.2, 0.3),
          life: rand(0.16, 0.32), maxLife: 0.32, size: rand(0.03, 0.065),
          color: 'rgba(185,235,160,0.5)', type: 'dot', rot: 0, vr: 0,
        });
      }
    }

    // If both thumbs start a run within a moment of each other, the first
    // stick's jump should not be read as a shot. A mid-run direction change is
    // still a strike because its flick did not start from rest.
    const lAct = hypot(L.x, L.y) > 0.25;
    const rAct = hypot(R.x, R.y) > 0.25;
    const nL = norm(L.x, L.y);
    const nR = norm(R.x, R.y);
    const aligned = lAct && rAct && (nL.x * nR.x + nL.y * nR.y) > 0.5;
    for (const foot of p.feet) {
      foot.suppressShot = !!foot.flickFromRest && aligned;
    }

    const b = game.ball;
    p.possession = hypot(b.x - p.x, b.y - p.y) < 3.1;

    // Resolve both feet against the ball.
    resolveFootBall(p.feet[0], L);
    resolveFootBall(p.feet[1], R);
  }

  function resolveFootBall(foot, stick) {
    const b = game.ball;
    const dx = b.x - foot.x;
    const dy = b.y - foot.y;
    const minDist = BALL_RADIUS + FOOT_RADIUS;
    const dist = hypot(dx, dy);
    if (dist > minDist || dist < 0.0001) return;
    const nx = dx / dist;
    const ny = dy / dist;
    const goalSide = b.y < game.player.y + 0.5;

    // Push the ball out of the boot first.
    b.x = foot.x + nx * (minDist + 0.006);
    b.y = foot.y + ny * (minDist + 0.006);

    const footSpeed = hypot(foot.vx, foot.vy);
    const along = foot.vx * nx + foot.vy * ny;
    const stickMag = hypot(stick.x, stick.y);
    const aim = norm(stick.x, stick.y);

    // A sharp flick is a strike. Aim follows the stick so a quick up-right
    // snap puts the ball toward the top-right corner.
    if (foot.flick > 0.45 && foot.flickArm <= 0 && stickMag > 0.3 && b.immune <= 0 && !foot.suppressShot) {
      const shotPower = 12 + foot.flick * 6 + stickMag * 3;
      b.vx = aim.x * shotPower + foot.vx * 0.14;
      b.vy = aim.y * shotPower + foot.vy * 0.14;
      b.controlLock = 0.9;
      b.immune = 0.45;
      foot.flick = 0;
      game.stats.shots++;
      (window.__shotLog ||= []).push({ t: game.anim, side: foot.side, rest: foot.flickFromRest, sup: foot.suppressShot, arm: foot.flickArm });
      sound.kick(shotPower);
      spawnBurst(b.x, b.y, 'rgba(210,246,255,0.9)', Math.round(5 + shotPower * 0.4), 4 + shotPower * 0.16);
      spawnRing(b.x, b.y, goalSide ? COLORS.sky : COLORS.paper, 1 + shotPower * 0.03);
      return;
    }

    // A running push is a dribble touch; both boots arriving together should
    // still only add up to one clean touch.
    let power = Math.max(0, along) * 0.78 + 0.7 + stickMag * 1.5;

    // Standing touches are gentle nudges; moving feet are passes.
    if (footSpeed < 1.2 && stickMag < 0.14) power *= 0.36;
    if (b.immune > 0) power *= 0.5;

    const other = game.player.feet[foot === game.player.feet[0] ? 1 : 0];
    if (hypot(b.x - other.x, b.y - other.y) < minDist + 0.04) power *= 0.5;

    b.vx += nx * power + foot.vx * 0.2;
    b.vy += ny * power + foot.vy * 0.2;
    const bm = hypot(b.vx, b.vy);
    if (bm > 34) {
      b.vx = (b.vx / bm) * 34;
      b.vy = (b.vy / bm) * 34;
    }

    if (foot.kickCd <= 0 && power > 4.6) {
      foot.kickCd = 0.085;
      sound.kick(power);
      spawnBurst(b.x, b.y, 'rgba(210,246,255,0.8)', Math.round(3 + power * 0.35), 3.5 + power * 0.15);
      spawnRing(b.x, b.y, goalSide ? COLORS.sky : COLORS.paper, 0.8 + power * 0.028);
    }
  }

  // Close control: when the ball is at Messi's feet and moving with him, it is
  // drawn toward a point just ahead of his stride. This turns raw kicks into
  // dribbles without taking the ball out of the physics simulation.
  function applyDribbleControl(dt) {
    const b = game.ball;
    const p = game.player;
    const pSpeed = hypot(p.vx, p.vy);
    if (b.controlLock > 0 || pSpeed < 0.7 || b.y < 1.0) return;
    if (hypot(b.x - p.x, b.y - p.y) > 3.1) return;

    const dir = norm(p.vx, p.vy);
    const targetX = p.x + dir.x * 1.45;
    const targetY = p.y + dir.y * 1.45;
    const k = 16;
    b.vx += (targetX - b.x) * k * dt;
    b.vy += (targetY - b.y) * k * dt;

    // The ball should lead the run, never outrun it while under close control.
    const cap = Math.max(pSpeed * 1.06, 2.6);
    const m = hypot(b.vx, b.vy);
    if (m > cap) {
      b.vx = (b.vx / m) * cap;
      b.vy = (b.vy / m) * cap;
    }
  }

  // ── Ball update ──────────────────────────────────────────────
  function updateBall(dt) {
    const b = game.ball;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.rot += (hypot(b.vx, b.vy) * 0.26 + b.spin) * dt;
    b.spin *= Math.pow(0.93, dt * 60);

    const friction = Math.pow(0.9952, dt * 60);
    b.vx *= friction;
    b.vy *= friction;
    if (Math.abs(b.vx) < 0.008) b.vx = 0;
    if (Math.abs(b.vy) < 0.008) b.vy = 0;
    b.immune = Math.max(0, b.immune - dt);
    b.controlLock = Math.max(0, b.controlLock - dt);
    if (b.ripple) {
      b.ripple.t += dt;
      if (b.ripple.t > 1.25) b.ripple = null;
    }

    // Boards and touchlines.
    const r = b.radius;
    if (b.x < r) { b.x = r; b.vx = Math.abs(b.vx) * 0.72; bounceDust(b.x, b.y); }
    if (b.x > FIELD.w - r) { b.x = FIELD.w - r; b.vx = -Math.abs(b.vx) * 0.72; bounceDust(b.x, b.y); }
    if (b.y > FIELD.h - r) { b.y = FIELD.h - r; b.vy = -Math.abs(b.vy) * 0.72; bounceDust(b.x, b.y); }

    const inMouth = b.x > FIELD.cx - FIELD.goalHalf + 0.25 && b.x < FIELD.cx + FIELD.goalHalf - 0.25;
    if (b.y < r && !inMouth) {
      b.y = r;
      b.vy = Math.abs(b.vy) * 0.7;
      bounceDust(b.x, b.y);
    }

    // Posts are solid little circles.
    for (const px of [FIELD.cx - FIELD.goalHalf, FIELD.cx + FIELD.goalHalf]) {
      const dx = b.x - px;
      const dy = b.y - 0;
      const d = hypot(dx, dy);
      const rr = r + 0.17;
      if (d < rr && d > 0.001) {
        const nx = dx / d;
        const ny = dy / d;
        b.x = px + nx * rr;
        b.y = ny * rr;
        const dot = b.vx * nx + b.vy * ny;
        b.vx -= 1.55 * dot * nx;
        b.vy -= 1.55 * dot * ny;
        b.vx *= 0.8;
        b.vy *= 0.8;
        sound.tone(980, 0.09, { type: 'triangle', volume: 0.035, to: 620 });
        spawnBurst(b.x, b.y, 'rgba(255,255,255,0.9)', 5, 3);
      }
    }

    if (b.y < -0.05 && inMouth && game.mode === 'playing') {
      scoreGoal();
    }

    if (b.y < -FIELD.goalDepth - 1.4) {
      b.y = -FIELD.goalDepth - 1.4;
      b.vy = Math.abs(b.vy) * 0.3;
    }

    // Ball trail.
    if (hypot(b.vx, b.vy) > 7) {
      game.trail.push({ x: b.x, y: b.y, life: 0.24, maxLife: 0.24 });
      if (game.trail.length > 16) game.trail.shift();
    }
    for (const t of game.trail) t.life -= dt;
    while (game.trail.length && game.trail[0].life <= 0) game.trail.shift();
  }

  function bounceDust(x, y) {
    if (Math.random() < 0.7) spawnBurst(x, y, 'rgba(188,235,170,0.55)', 3, 2.4);
  }

  // ── Goalkeeper ───────────────────────────────────────────────
  function updateKeeper(dt) {
    const k = game.keeper;
    const b = game.ball;
    const inFlight = b.vy < -5 && b.y < 16 && b.y > 0;
    let targetX = clamp(b.x, FIELD.cx - FIELD.goalHalf + 1.15, FIELD.cx + FIELD.goalHalf - 1.15);

    if (inFlight) {
      const t = Math.max(0.08, b.y / Math.max(1, -b.vy));
      const predicted = b.x + b.vx * t;
      targetX = clamp(predicted, FIELD.cx - FIELD.goalHalf + 0.65, FIELD.cx + FIELD.goalHalf - 0.65);
    }

    const speed = 5.4 + game.goals * 0.13;
    const dx = targetX - k.x;
    k.vx = lerp(k.vx, clamp(dx * 3.2, -speed, speed), Math.min(1, dt * 7));
    k.x += k.vx * dt;
    k.x = clamp(k.x, FIELD.cx - FIELD.goalHalf + 0.8, FIELD.cx + FIELD.goalHalf - 0.8);
    k.lean = clamp(k.vx * 0.08, -0.3, 0.3);
    k.dive = lerp(k.dive, Math.min(1, Math.abs(k.vx) / 5), Math.min(1, dt * 8));
    k.saveCd = Math.max(0, k.saveCd - dt);

    // Feet shuffle under the keeper.
    for (let i = 0; i < 2; i++) {
      const f = k.feet[i];
      const tx = k.x + (i === 0 ? -0.45 : 0.45) + k.vx * 0.04;
      const ty = k.y + 0.62;
      f.vx += ((tx - f.x) * 70 - f.vx * 13) * dt;
      f.vy += ((ty - f.y) * 70 - f.vy * 13) * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
    }

    const bd = hypot(b.x - k.x, b.y - k.y);
    if (bd < 0.92 && b.y < 7.2 && b.vy < 0 && k.saveCd <= 0) {
      const nx = (b.x - k.x) / Math.max(0.001, bd);
      const ny = (b.y - k.y) / Math.max(0.001, bd);
      b.x = k.x + nx * 0.95;
      b.y = k.y + ny * 0.95;
      b.vy = Math.abs(b.vy) * 0.38 + 4.4;
      b.vx += nx * 3.4 + rand(-2.6, 2.6);
      k.saveCd = 1.15;
      game.stats.saves++;
      game.shake = Math.max(game.shake, 0.25);
      sound.save();
      spawnRing(b.x, b.y, COLORS.gold, 1.5);
      showToast('SAVED!', '', 850);
      addFloater(b.x, b.y - 0.8, 'SAVED', COLORS.gold, 0.9);
    }
  }

  // ── Defenders ────────────────────────────────────────────────
  function updateDefenders(dt) {
    const p = game.player;
    const b = game.ball;

    for (let i = 0; i < game.defenders.length; i++) {
      const d = game.defenders[i];
      d.tackleCd = Math.max(0, d.tackleCd - dt);
      d.stun = Math.max(0, d.stun - dt);
      d.beatenCd = Math.max(0, d.beatenCd - dt);

      // Count a defender beaten when the ball is carried past them upfield.
      if (d.lastBallY >= d.y - 0.35 && b.y < d.y - 0.6 && d.beatenCd <= 0 && hypot(b.x - p.x, b.y - p.y) < 5.2) {
        game.stats.beaten++;
        d.beatenCd = 3.2;
        addFloater(d.x, d.y - 1.3, 'BEAT', COLORS.sky, 0.78);
        spawnBurst(d.x, d.y, 'rgba(127,214,255,0.7)', 5, 3);
      }
      d.lastBallY = b.y;

      if (d.stun <= 0) {
        const lead = 0.14;
        let tx = b.x + b.vx * lead;
        let ty = b.y + b.vy * lead;
        const side = i % 2 === 0 ? 1 : -1;
        tx += side * 0.5;
        // The nearest defender presses; the others cover the lane to goal.
        const distToBall = hypot(b.x - d.x, b.y - d.y);
        if (distToBall > 6.5 && game.defenders.length > 2 && i > 1) {
          tx = lerp(b.x, FIELD.cx, 0.4);
          ty = Math.max(6, b.y - 4.5);
        }

        const move = norm(tx - d.x, ty - d.y);
        let speed = d.speed * (1 + Math.min(0.15, game.goals * 0.01));
        if (game.ball.y < 8) speed *= 0.8;
        d.vx = lerp(d.vx, move.x * speed, Math.min(1, dt * 5.8));
        d.vy = lerp(d.vy, move.y * speed, Math.min(1, dt * 5.8));

        // Separation, so defenders do not fuse into one blob.
        for (let j = 0; j < game.defenders.length; j++) {
          if (j === i) continue;
          const o = game.defenders[j];
          const dx = d.x - o.x;
          const dy = d.y - o.y;
          const dist = hypot(dx, dy);
          if (dist < 2.5 && dist > 0.001) {
            d.vx += (dx / dist) * (2.5 - dist) * dt * 5.5;
            d.vy += (dy / dist) * (2.5 - dist) * dt * 5.5;
          }
        }
        // Don't barge straight through Messi.
        const pdx = d.x - p.x;
        const pdy = d.y - p.y;
        const pd = hypot(pdx, pdy);
        if (pd < 1.7 && pd > 0.001) {
          d.vx += (pdx / pd) * (1.7 - pd) * dt * 10;
          d.vy += (pdy / pd) * (1.7 - pd) * dt * 10;
        }
      } else {
        d.vx *= Math.pow(0.9, dt * 60);
        d.vy *= Math.pow(0.9, dt * 60);
      }

      d.x = clamp(d.x + d.vx * dt, 1.2, FIELD.w - 1.2);
      d.y = clamp(d.y + d.vy * dt, 3.1, FIELD.h - 1.2);
      d.lean = lerp(d.lean, clamp(d.vx * 0.05, -0.25, 0.25), Math.min(1, dt * 7));
      d.gait += hypot(d.vx, d.vy) * dt * 2.4;

      for (let f = 0; f < 2; f++) {
        const foot = d.feet[f];
        const stride = Math.sin(d.gait + f * Math.PI) * 0.24 * Math.min(1, hypot(d.vx, d.vy) / 4);
        const tx = d.x + (f === 0 ? -0.43 : 0.43) + d.vx * 0.03;
        const ty = d.y + 0.28 + stride + d.vy * 0.03;
        foot.vx += ((tx - foot.x) * 80 - foot.vx * 15) * dt;
        foot.vy += ((ty - foot.y) * 80 - foot.vy * 15) * dt;
        foot.x += foot.vx * dt;
        foot.y += foot.vy * dt;
      }

      // Tackle.
      if (game.mode === 'playing' && d.tackleCd <= 0 && d.stun <= 0 && game.kickoffGrace <= 0) {
        const dist = hypot(b.x - d.x, b.y - d.y);
        if (dist < 1.18 && b.y > 4.2) {
          tackleBall(d);
        }
      }
    }

    // Keep bodies readable: no defender standing inside Messi or a team-mate.
    for (let i = 0; i < game.defenders.length; i++) {
      const d = game.defenders[i];
      const pdx = d.x - p.x;
      const pdy = d.y - p.y;
      const pd = hypot(pdx, pdy);
      if (pd < 1.4 && pd > 0.001) {
        d.x = p.x + (pdx / pd) * 1.4;
        d.y = p.y + (pdy / pd) * 1.4;
      }
      for (let j = i + 1; j < game.defenders.length; j++) {
        const o = game.defenders[j];
        const dx = o.x - d.x;
        const dy = o.y - d.y;
        const dist = hypot(dx, dy);
        if (dist < 1.5 && dist > 0.001) {
          const push = (1.5 - dist) * 0.5;
          d.x -= (dx / dist) * push;
          d.y -= (dy / dist) * push;
          o.x += (dx / dist) * push;
          o.y += (dy / dist) * push;
        }
      }
    }
  }

  function tackleBall(d) {
    const b = game.ball;
    const p = game.player;
    const away = norm(b.x - FIELD.cx, b.y - 1.4);
    b.vx = away.x * 13 + rand(-3, 3);
    b.vy = Math.max(2.2, away.y * 13 + rand(-1, 2));
    b.immune = 0.55;
    d.tackleCd = 2.3;
    d.stun = 0.3;
    p.stumble = 0.72;
    p.vx *= 0.2;
    p.vy *= 0.2;
    game.combo = 1;
    game.comboTimer = 0;
    game.stats.tackles++;
    game.shake = Math.max(game.shake, 0.65);
    sound.tackle();
    spawnBurst(b.x, b.y, 'rgba(255,209,102,0.85)', 10, 5);
    spawnRing(b.x, b.y, COLORS.coral, 1.8);
    showToast('TACKLED!', 'warn', 1000);
    game.floaters = game.floaters.filter((f) => f.text !== 'TACKLED');
    addFloater(b.x, b.y - 0.9, 'TACKLED', COLORS.coral, 0.9);
    updateComboUI();
  }

  // ── Goal ─────────────────────────────────────────────────────
  function scoreGoal() {
    if (game.mode !== 'playing') return;
    const b = game.ball;
    const p = game.player;
    const distance = hypot(b.x - FIELD.cx, b.y);
    game.lastGoalDistance = distance;

    const quick = game.comboTimer > 0;
    game.combo = quick ? Math.min(5, game.combo + 1) : 1;
    game.comboTimer = COMBO_WINDOW;
    game.bestCombo = Math.max(game.bestCombo, game.combo);

    const distanceBonus = Math.round(distance * 4);
    const points = Math.round((100 + distanceBonus) * game.combo);
    game.score += points;
    game.goals++;
    game.stats.longest = Math.max(game.stats.longest, distance);
    game.timeLeft = Math.min(99, game.timeLeft + GOAL_TIME_BONUS);
    game.goalTimer = 2.3;
    game.mode = 'goal';
    game.slowmo = 0.32;
    game.goalFlash = 1;
    game.shake = Math.max(game.shake, 0.9);
    b.ripple = { x: b.x, t: 0 };
    b.vx *= 0.25;
    b.vy = Math.min(b.vy, -2);

    const words = distance > 22 ? ['SCREAMER', 'FROM RANGE', 'TOP BINS'] :
      game.combo >= 4 ? ['UNREAL', 'MAGIC', 'GOLAZO'] :
        game.combo >= 2 ? ['GOLAZO', 'MAGIC', 'CLINICAL'] : ['GOAL', 'GOLAZO', 'NICE'];
    const word = words[randInt(0, words.length - 1)];
    const sub = `+${points} PTS  ·  +${GOAL_TIME_BONUS} SEC`;
    showGoalBanner(word, sub);

    if (game.combo > 1) {
      showToast(`×${game.combo} COMBO!`, 'good', 1300);
    }
    sound.goal();
    sound.setIntensity(0.95);
    spawnConfetti(80 + game.combo * 25);
    spawnRing(b.x, b.y, COLORS.gold, 3.2);
    addFloater(b.x, b.y - 1.2, `+${points}`, COLORS.gold, 1.5);
    for (let i = 0; i < 16; i++) {
      spawnBurst(b.x + rand(-0.3, 0.3), b.y + rand(-0.3, 0.3), i % 3 === 0 ? COLORS.gold : 'rgba(220,248,255,0.85)', 1, 8);
    }
    updateHud();
    updateComboUI();
  }

  function finishGoalCelebration() {
    game.mode = 'playing';
    game.goalTimer = 0;
    game.slowmo = 1;
    game.player = makePlayer();
    game.ball = makeBall();
    game.keeper = makeKeeper();
    game.particles.length = 0;
    game.rings.length = 0;
    game.trail.length = 0;
    const count = defenderCountForGoals(game.goals);
    const oldCount = game.defenders.length;
    spawnDefenders(count, true);
    if (count > oldCount) showToast(`DEFENDERS +${count - oldCount}`, 'warn', 1300);
    sound.setIntensity(0.55);
    updateHud();
  }

  // ── Attract mode ─────────────────────────────────────────────
  function updateAttract(dt) {
    const p = game.player;
    const b = game.ball;
    const t = game.anim;
    p.x = lerp(p.x, FIELD.cx, Math.min(1, dt * 2.5));
    p.y = lerp(p.y, 26.5, Math.min(1, dt * 2.5));
    p.vx = 0;
    p.vy = 0;
    p.bounce = Math.sin(t * 2.1) * 0.012;
    p.lean = Math.sin(t * 0.75) * 0.045;
    b.x = FIELD.cx + Math.sin(t * 0.9) * 1.55;
    b.y = 24.4 + Math.cos(t * 1.8) * 0.34;
    b.rot += dt * 0.8;

    // Alternate little toe taps around the ball.
    const tap = Math.sin(t * 3.2);
    const feetTargets = [
      { x: b.x - 0.55 - (tap > 0 ? 0.24 : 0), y: b.y + 0.52 + (tap > 0 ? 0.15 : 0) },
      { x: b.x + 0.55 + (tap < 0 ? 0.24 : 0), y: b.y + 0.52 + (tap < 0 ? 0.15 : 0) },
    ];
    for (let i = 0; i < 2; i++) {
      const f = p.feet[i];
      const target = feetTargets[i];
      f.vx += ((target.x - f.x) * 26 - f.vx * 8) * dt;
      f.vy += ((target.y - f.y) * 26 - f.vy * 8) * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
    }
    p.possession = true;
  }

  // ── Update orchestration ─────────────────────────────────────
  let reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false;

  function updateParticles(dt) {
    for (let i = game.particles.length - 1; i >= 0; i--) {
      const p = game.particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.pow(0.94, dt * 60);
      p.vy *= Math.pow(0.95, dt * 60);
      p.rot += p.vr * dt;
      if (p.life <= 0) game.particles.splice(i, 1);
    }
    for (let i = game.rings.length - 1; i >= 0; i--) {
      const r = game.rings[i];
      r.life -= dt;
      r.r = lerp(r.r, r.max, Math.min(1, dt * 10));
      if (r.life <= 0) game.rings.splice(i, 1);
    }
    for (let i = game.floaters.length - 1; i >= 0; i--) {
      const f = game.floaters[i];
      f.life -= dt;
      f.y -= dt * 1.2;
      if (f.life <= 0) game.floaters.splice(i, 1);
    }
    for (let i = game.confetti.length - 1; i >= 0; i--) {
      const c = game.confetti[i];
      c.life -= dt;
      c.vy += 55 * dt;
      c.x += c.vx * dt + Math.sin((game.anim + i) * 2.6) * 12 * dt;
      c.y += c.vy * dt;
      c.rot += c.vr * dt;
      if (c.life <= 0 || c.y > H + 30) game.confetti.splice(i, 1);
    }
  }

  function updateCamera(dt) {
    if (!view.wide) {
      view.oy = view.topPad + (view.availH - FIELD.h * view.s) / 2;
      game.camera.top = 0;
    } else {
      const focusY = game.mode === 'goal'
        ? lerp(game.player.y, game.ball.y, 0.55)
        : game.player.y * 0.76 + game.ball.y * 0.24;
      const target = clamp(
        focusY - view.camH * 0.6 - 6,
        -4,
        FIELD.h - view.camH + 7
      );
      game.camera.top = lerp(game.camera.top, target, Math.min(1, dt * 3.4));
      view.oy = view.topPad - game.camera.top * view.s;
    }

    game.shake = Math.max(0, game.shake - dt * 2.5);
    const amp = reducedMotion ? 0 : game.shake * game.shake * 11;
    game.shakeX = (Math.random() * 2 - 1) * amp;
    game.shakeY = (Math.random() * 2 - 1) * amp;
  }

  function update(dtReal) {
    game.anim += dtReal;
    detectGamepad();

    if (game.mode === 'paused') {
      updateParticles(dtReal * 0.15);
      return;
    }

    if (game.mode === 'goal') {
      game.slowmo = lerp(game.slowmo, 1, Math.min(1, dtReal * 2.4));
      const dt = dtReal * game.slowmo;
      updateBall(dt);
      updateParticles(dtReal);
      game.goalTimer -= dtReal;
      game.goalFlash = Math.max(0, game.goalFlash - dtReal * 1.8);
      game.comboTimer = Math.max(0, game.comboTimer - dtReal);
      if (game.comboTimer <= 0) {
        game.combo = 1;
        updateComboUI();
      }
      updateCamera(dtReal);
      if (game.goalTimer <= 0) finishGoalCelebration();
      game.shake = Math.max(0, game.shake - dtReal * 2.5);
      return;
    }

    if (game.mode === 'over') {
      updateParticles(dtReal);
      updateCamera(dtReal);
      return;
    }

    if (game.mode === 'title') {
      updateAttract(dtReal);
      updateParticles(dtReal * 0.4);
      updateCamera(dtReal);
      return;
    }

    // Playing.
    game.clock += dtReal;
    game.timeLeft -= dtReal;
    game.kickoffFlash = Math.max(0, game.kickoffFlash - dtReal * 2.2);
    game.kickoffGrace = Math.max(0, game.kickoffGrace - dtReal);
    game.hintTimer += dtReal;
    if (game.hintTimer > 11) hintStrip.classList.add('is-gone');

    if (game.comboTimer > 0) {
      game.comboTimer -= dtReal;
      if (game.comboTimer <= 0) {
        game.combo = 1;
        updateComboUI();
      }
    }

    const input = readInput();
    updatePlayer(dtReal, input);
    applyDribbleControl(dtReal);
    updateDefenders(dtReal);
    updateKeeper(dtReal);
    updateBall(dtReal);
    updateParticles(dtReal);
    updateCamera(dtReal);

    // Crowd swells as the ball gets near goal.
    const danger = 1 - clamp(game.ball.y / FIELD.h, 0, 1);
    sound.setIntensity(0.35 + danger * 0.55);

    if (game.timeLeft <= 0) endMatch();
  }

  // ── Backdrop / stadium pre-render ────────────────────────────
  let crowdFlashes = [];

  function buildBackdrop() {
    if (!game.player) return;
    const dpr = view.dpr || 1;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(W * dpr));
    c.height = Math.max(1, Math.round(H * dpr));
    const g = c.getContext('2d');
    g.scale(dpr, dpr);

    // Deep stadium night.
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#071925');
    bg.addColorStop(0.42, '#04111c');
    bg.addColorStop(1, '#020a11');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);

    const pW = FIELD.w * view.s;
    const pL = W / 2 - pW / 2;
    const pR = W / 2 + pW / 2;
    const pT = view.wide ? view.topPad : view.oy;
    const pB = pT + FIELD.h * view.s;

    const bands = [
      { x: 0, y: 0, w: Math.max(0, pL - 24), h: H },
      { x: pR + 24, y: 0, w: Math.max(0, W - pR - 24), h: H },
      { x: pL - 24, y: 0, w: (pR - pL) + 48, h: Math.max(0, pT - 26) },
      { x: pL - 24, y: pB + 24, w: (pR - pL) + 48, h: Math.max(0, H - pB - 24) },
    ];

    crowdFlashes = [];
    let seed = 11;

    for (const band of bands) {
      if (band.w < 18 || band.h < 14) continue;
      const grad = g.createLinearGradient(band.x, band.y, band.x + band.w * 0.4, band.y + band.h);
      grad.addColorStop(0, '#071722');
      grad.addColorStop(0.48, '#0a2030');
      grad.addColorStop(1, '#030d16');
      g.fillStyle = grad;
      g.fillRect(band.x, band.y, band.w, band.h);

      // Stand railings.
      g.strokeStyle = 'rgba(134, 186, 213, 0.09)';
      g.lineWidth = 1;
      const railStep = 52;
      if (band.w > band.h) {
        for (let y = band.y + 26; y < band.y + band.h; y += railStep) {
          g.beginPath(); g.moveTo(band.x, y); g.lineTo(band.x + band.w, y); g.stroke();
        }
      } else {
        for (let x = band.x + 26; x < band.x + band.w; x += railStep) {
          g.beginPath(); g.moveTo(x, band.y); g.lineTo(x, band.y + band.h); g.stroke();
        }
      }

      // Crowd speckle. Deterministic, so it doesn't shimmer between frames.
      const dotStep = 13;
      for (let y = band.y + 8; y < band.y + band.h - 4; y += dotStep) {
        for (let x = band.x + 7; x < band.x + band.w - 4; x += dotStep) {
          const r1 = hash(seed++ * 1.7);
          if (r1 < 0.34) continue;
          const r2 = hash(seed++ * 2.3);
          const r3 = hash(seed++ * 3.1);
          const jx = x + (r2 - 0.5) * 7;
          const jy = y + (r3 - 0.5) * 6;
          const palette = ['#8ba8b7', '#c5dbe5', '#5d7c8d', '#7fd6ff', '#e6f5fb', '#ffd166'];
          const pick = r2 < 0.08 ? 3 : r2 < 0.12 ? 4 : r2 < 0.14 ? 5 : Math.floor(r3 * 3);
          g.globalAlpha = 0.22 + r1 * 0.5;
          g.fillStyle = palette[pick];
          const size = r2 > 0.86 ? 2.4 : 1.5;
          g.fillRect(jx, jy, size, size);
        }
      }
      g.globalAlpha = 1;

      // A few camera flashes live in the crowd.
      const flashes = Math.max(2, Math.round((band.w * band.h) / 42000));
      for (let i = 0; i < flashes; i++) {
        crowdFlashes.push({
          x: band.x + 10 + hash(seed++ * 1.3) * Math.max(1, band.w - 20),
          y: band.y + 10 + hash(seed++ * 2.7) * Math.max(1, band.h - 20),
          phase: hash(seed++ * 4.1) * TAU,
          speed: 0.6 + hash(seed++ * 5.3) * 1.8,
        });
      }
    }

    // Stadium structure: dark panels and tunnel mouths.
    g.fillStyle = 'rgba(1, 7, 12, 0.45)';
    g.fillRect(0, H - 66, W, 66);
    g.strokeStyle = 'rgba(137, 193, 221, 0.07)';
    g.lineWidth = 1;
    for (let i = 0; i < 7; i++) {
      const x = (W / 6) * i;
      g.beginPath(); g.moveTo(x, H - 66); g.lineTo(x, H); g.stroke();
    }

    // Soft ambient pools.
    const pool = g.createRadialGradient(W * 0.5, H * 0.48, 10, W * 0.5, H * 0.48, Math.max(W, H) * 0.62);
    pool.addColorStop(0, 'rgba(83, 174, 219, 0.12)');
    pool.addColorStop(0.5, 'rgba(40, 112, 151, 0.04)');
    pool.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = pool;
    g.fillRect(0, 0, W, H);

    // Floodlight bloom, baked once.
    g.save();
    g.globalCompositeOperation = 'screen';
    const spots = [
      { x: W * 0.04, y: -H * 0.05, r: H * 0.75, a: 0.11 },
      { x: W * 0.96, y: -H * 0.05, r: H * 0.75, a: 0.11 },
      { x: W * 0.12, y: H * 1.02, r: H * 0.55, a: 0.05 },
      { x: W * 0.88, y: H * 1.02, r: H * 0.55, a: 0.05 },
    ];
    for (const spot of spots) {
      const grad = g.createRadialGradient(spot.x, spot.y, 0, spot.x, spot.y, spot.r);
      grad.addColorStop(0, `rgba(155, 224, 255, ${spot.a})`);
      grad.addColorStop(0.35, `rgba(80, 170, 220, ${spot.a * 0.35})`);
      grad.addColorStop(1, 'rgba(30, 100, 150, 0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
    }
    g.restore();

    backdrop = c;
  }

  function buildGrassSpecks() {
    const arr = [];
    for (let i = 0; i < 220; i++) {
      arr.push({
        x: hash(i * 2.13) * FIELD.w,
        y: hash(i * 3.71 + 4) * FIELD.h,
        len: 0.04 + hash(i * 5.17) * 0.1,
        alpha: 0.035 + hash(i * 7.9) * 0.075,
        angle: hash(i * 9.3) * TAU,
      });
    }
    game.specks = arr;
  }

  // The pitch, markings, grass and advertising hoardings never change, so they
  // are painted once into a single offscreen texture. That keeps the per-frame
  // cost to one blit even on software-rendered browsers.
  function buildPitchCanvas() {
    if (!game.player) return;
    const s = view.s;
    const dpr = view.dpr || 1;
    const worldW = PITCH_PAD.left + FIELD.w + PITCH_PAD.right;
    const worldH = PITCH_PAD.top + FIELD.h + PITCH_PAD.bottom;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(worldW * s * dpr));
    c.height = Math.max(1, Math.round(worldH * s * dpr));
    const g = c.getContext('2d');
    g.scale(dpr, dpr);

    const oldCtx = ctx;
    const oldOx = view.ox;
    const oldOy = view.oy;
    const oldShakeX = game.shakeX;
    const oldShakeY = game.shakeY;
    ctx = g;
    view.ox = PITCH_PAD.left * s;
    view.oy = PITCH_PAD.top * s;
    game.shakeX = 0;
    game.shakeY = 0;
    drawPitch();
    drawAdBoards();
    ctx = oldCtx;
    view.ox = oldOx;
    view.oy = oldOy;
    game.shakeX = oldShakeX;
    game.shakeY = oldShakeY;
    pitchCanvas = c;
  }

  function drawFloodlights() {
    const spots = [
      { x: W * 0.04, y: -H * 0.05, r: H * 0.75, a: 0.11 },
      { x: W * 0.96, y: -H * 0.05, r: H * 0.75, a: 0.11 },
      { x: W * 0.12, y: H * 1.02, r: H * 0.55, a: 0.05 },
      { x: W * 0.88, y: H * 1.02, r: H * 0.55, a: 0.05 },
    ];
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (const spot of spots) {
      const grad = ctx.createRadialGradient(spot.x, spot.y, 0, spot.x, spot.y, spot.r);
      grad.addColorStop(0, `rgba(155, 224, 255, ${spot.a})`);
      grad.addColorStop(0.35, `rgba(80, 170, 220, ${spot.a * 0.35})`);
      grad.addColorStop(1, 'rgba(30, 100, 150, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  function drawCrowdFlashes() {
    ctx.save();
    for (const f of crowdFlashes) {
      const s = Math.sin(game.anim * f.speed + f.phase);
      if (s < 0.985) continue;
      const a = (s - 0.985) / 0.015;
      const r = 12 + a * 22;
      const grad = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
      grad.addColorStop(0, `rgba(245, 253, 255, ${0.55 * a})`);
      grad.addColorStop(0.18, `rgba(170, 231, 255, ${0.28 * a})`);
      grad.addColorStop(1, 'rgba(127, 214, 255, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(f.x - r, f.y - r, r * 2, r * 2);
    }
    ctx.restore();
  }

  // ── Pitch ────────────────────────────────────────────────────
  function drawPitch() {
    const s = view.s;
    const px = sx(0);
    const py = sy(0);
    const pw = FIELD.w * s;
    const ph = FIELD.h * s;

    // Ground shadow.
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    roundRectPath(ctx, px - s * 0.35, py + s * 0.22, pw + s * 0.7, ph + s * 0.6, s * 0.5);
    ctx.fill();
    ctx.restore();

    ctx.save();
    roundRectPath(ctx, px, py, pw, ph, Math.max(1, s * 0.15));
    ctx.clip();

    const grass = ctx.createLinearGradient(px, py, px + pw * 0.2, py + ph);
    grass.addColorStop(0, COLORS.grassTop);
    grass.addColorStop(0.44, '#1f7d49');
    grass.addColorStop(1, COLORS.grassBottom);
    ctx.fillStyle = grass;
    ctx.fillRect(px, py, pw, ph);

    // Mowing bands.
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255, 255, 255, 0.022)' : 'rgba(0, 32, 18, 0.055)';
      ctx.fillRect(px, py + (i / 14) * ph, pw, ph / 14 + 0.5);
    }

    // A warm pool of light through the centre.
    const light = ctx.createRadialGradient(px + pw * 0.5, py + ph * 0.56, 0, px + pw * 0.5, py + ph * 0.56, ph * 0.62);
    light.addColorStop(0, 'rgba(210, 255, 210, 0.055)');
    light.addColorStop(0.7, 'rgba(140, 230, 170, 0.016)');
    light.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = light;
    ctx.fillRect(px, py, pw, ph);

    // Grass detail.
    for (const speck of game.specks) {
      const gx = px + speck.x * s;
      const gy = py + speck.y * s;
      ctx.strokeStyle = `rgba(215, 255, 210, ${speck.alpha})`;
      ctx.lineWidth = Math.max(0.6, s * 0.018);
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(gx + Math.cos(speck.angle) * speck.len * s, gy + Math.sin(speck.angle) * speck.len * s);
      ctx.stroke();
    }

    // Worn goalmouths.
    for (const gy of [0, FIELD.h]) {
      const wear = ctx.createRadialGradient(px + pw / 2, py + gy * s, 0, px + pw / 2, py + gy * s, s * 8);
      wear.addColorStop(0, 'rgba(174, 156, 92, 0.10)');
      wear.addColorStop(0.5, 'rgba(150, 136, 80, 0.04)');
      wear.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = wear;
      ctx.fillRect(px, py + gy * s - s * 8, pw, s * 16);
    }

    ctx.restore();

    // White markings.
    ctx.save();
    ctx.strokeStyle = 'rgba(235, 251, 255, 0.82)';
    ctx.fillStyle = 'rgba(235, 251, 255, 0.82)';
    ctx.lineWidth = clamp(s * 0.072, 1, 2.2);
    ctx.lineJoin = 'round';

    ctx.strokeRect(px, py, pw, ph);
    ctx.beginPath();
    ctx.moveTo(px, py + ph / 2);
    ctx.lineTo(px + pw, py + ph / 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px + pw / 2, py + ph / 2, s * 5.6, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px + pw / 2, py + ph / 2, s * 0.11, 0, TAU);
    ctx.fill();

    // Penalty + six-yard boxes, both ends.
    for (const top of [true, false]) {
      const baseY = top ? py : py + ph;
      const dir = top ? 1 : -1;
      ctx.strokeRect(px + (pw - s * FIELD.boxW) / 2, baseY, s * FIELD.boxW, dir * s * FIELD.boxD);
      ctx.strokeRect(px + (pw - s * FIELD.sixW) / 2, baseY, s * FIELD.sixW, dir * s * FIELD.sixD);
      ctx.beginPath();
      ctx.arc(px + pw / 2, baseY + dir * s * 6.6, s * 0.11, 0, TAU);
      ctx.fill();

      ctx.beginPath();
      if (top) ctx.arc(px + pw / 2, baseY + s * 6.6, s * 5.45, Math.PI * 0.18, Math.PI * 0.82);
      else ctx.arc(px + pw / 2, baseY - s * 6.6, s * 5.45, Math.PI * 1.18, Math.PI * 1.82);
      ctx.stroke();
    }

    // Corner arcs.
    const cr = s * 0.85;
    for (const [cx, cy, a0] of [
      [px, py, 0],
      [px + pw, py, Math.PI / 2],
      [px, py + ph, -Math.PI / 2],
      [px + pw, py + ph, Math.PI],
    ]) {
      ctx.beginPath();
      ctx.arc(cx, cy, cr, a0, a0 + Math.PI / 2);
      ctx.stroke();
    }

    // Goal line glint.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = clamp(s * 0.11, 1.2, 3);
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + pw, py);
    ctx.stroke();
    ctx.restore();
  }

  function drawAdBoards() {
    const s = view.s;
    const labels = ['MESSI · 10', 'OMG', 'TWO STICKS', 'ARGENTINA', 'PLAY'];
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const drawBoard = (x, y, w, h, vertical) => {
      ctx.fillStyle = '#071b2a';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(127, 214, 255, 0.75)';
      ctx.fillRect(x, y, w, Math.max(1, h * 0.055));
      ctx.fillStyle = '#0d2b3f';
      ctx.fillRect(x, y + h * 0.87, w, h * 0.13);
      if (vertical) {
        ctx.save();
        ctx.translate(x + w / 2, y + h / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = 'rgba(222, 246, 255, 0.82)';
        ctx.font = `${Math.max(6, s * 0.42)}px "Bebas Neue", sans-serif`;
        ctx.fillText(labels[Math.floor(y / Math.max(1, h) * 5 + 1) % labels.length], 0, 0);
        ctx.restore();
      } else {
        ctx.fillStyle = 'rgba(222, 246, 255, 0.82)';
        ctx.font = `${Math.max(6, s * 0.42)}px "Bebas Neue", sans-serif`;
        const count = Math.max(2, Math.round(w / (s * 4)));
        for (let i = 0; i < count; i++) {
          ctx.fillText(labels[(i + Math.floor(x / (w + 1))) % labels.length], x + (i + 0.5) * (w / count), y + h * 0.44);
        }
      }
    };

    drawBoard(sx(-1.32), sy(0), s * 0.92, FIELD.h * s, true);
    drawBoard(sx(FIELD.w + 0.4), sy(0), s * 0.92, FIELD.h * s, true);
    drawBoard(sx(0), sy(-3.32), FIELD.w * s, s * 0.58, false);
    drawBoard(sx(0), sy(FIELD.h + 2.74), FIELD.w * s, s * 0.5, false);
    ctx.restore();
  }

  function drawGoal(top = true) {
    const s = view.s;
    const goalHalf = FIELD.goalHalf;
    const x0 = sx(FIELD.cx - goalHalf);
    const x1 = sx(FIELD.cx + goalHalf);
    const lineY = sy(top ? 0 : FIELD.h);
    const depth = FIELD.goalDepth * s * (top ? -1 : 1);
    const backY = lineY + depth;
    const ripple = top ? game.ball.ripple : null;

    ctx.save();

    // Net body.
    const g = ctx.createLinearGradient(0, lineY, 0, backY);
    g.addColorStop(0, 'rgba(202, 238, 255, 0.06)');
    g.addColorStop(1, 'rgba(202, 238, 255, 0.015)');
    ctx.fillStyle = g;
    ctx.fillRect(x0, Math.min(lineY, backY), x1 - x0, Math.abs(depth));

    // Net mesh, with an impact bulge.
    const cols = 15;
    const rows = 5;
    ctx.strokeStyle = 'rgba(220, 247, 255, 0.22)';
    ctx.lineWidth = clamp(s * 0.026, 0.5, 1.2);
    for (let c = 0; c <= cols; c++) {
      const bx = x0 + (c / cols) * (x1 - x0);
      ctx.beginPath();
      ctx.moveTo(bx, lineY);
      ctx.lineTo(bx, backY);
      ctx.stroke();
    }
    for (let r = 0; r <= rows; r++) {
      ctx.beginPath();
      for (let c = 0; c <= cols; c++) {
        const bx = x0 + (c / cols) * (x1 - x0);
        let by = lineY + (r / rows) * depth;
        if (ripple) {
          const impactX = sx(ripple.x);
          const strength = Math.max(0, 1 - Math.abs(bx - impactX) / (s * 4.6));
          by += Math.sin(ripple.t * 18 - r * 0.6) * s * 0.17 * strength * Math.max(0, 1 - ripple.t / 1.25);
        }
        if (c === 0) ctx.moveTo(bx, by);
        else ctx.lineTo(bx, by);
      }
      ctx.stroke();
    }

    // Back rail.
    ctx.strokeStyle = 'rgba(240, 253, 255, 0.55)';
    ctx.lineWidth = clamp(s * 0.07, 1, 2.2);
    ctx.beginPath(); ctx.moveTo(x0, backY); ctx.lineTo(x1, backY); ctx.stroke();

    // Posts.
    ctx.fillStyle = '#effcff';
    for (const px of [x0, x1]) {
      ctx.beginPath();
      ctx.arc(px, lineY, clamp(s * 0.13, 1.6, 4), 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
      ctx.beginPath();
      ctx.ellipse(px + s * 0.06, lineY + s * 0.12, s * 0.16, s * 0.09, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#effcff';
    }

    // Side frame shadows.
    ctx.strokeStyle = 'rgba(7, 26, 41, 0.55)';
    ctx.lineWidth = clamp(s * 0.09, 1, 2.5);
    ctx.beginPath();
    ctx.moveTo(x0, lineY);
    ctx.lineTo(x0, backY);
    ctx.moveTo(x1, lineY);
    ctx.lineTo(x1, backY);
    ctx.stroke();

    ctx.restore();
  }

  // ── Entity rendering ─────────────────────────────────────────
  function drawGroundShadow(px, py, rx, ry, alpha = 0.34) {
    ctx.fillStyle = `rgba(0, 8, 13, ${alpha})`;
    ellipsePath(ctx, px + rx * 0.18, py, rx, ry);
    ctx.fill();
    ctx.fillStyle = `rgba(0, 8, 13, ${alpha * 0.35})`;
    ellipsePath(ctx, px + rx * 0.28, py + ry * 0.18, rx * 0.72, ry * 0.72);
    ctx.fill();
  }

  function drawBall() {
    const b = game.ball;
    const s = view.s;
    const px = sx(b.x);
    const py = sy(b.y);
    const r = b.radius * s;
    const speed = hypot(b.vx, b.vy);

    drawGroundShadow(px + r * 0.5, py + r * 0.62, r * 1.16, r * 0.76, 0.42);

    if (speed > 6) {
      ctx.save();
      for (const t of game.trail) {
        const a = clamp(t.life / t.maxLife, 0, 1) * 0.13;
        ctx.fillStyle = `rgba(230, 250, 255, ${a})`;
        ctx.beginPath();
        ctx.arc(sx(t.x), sy(t.y), r * (0.5 + a * 1.5), 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    const g = ctx.createRadialGradient(px - r * 0.36, py - r * 0.46, r * 0.08, px, py, r * 1.08);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.4, '#f4fbfc');
    g.addColorStop(0.78, '#c7d7da');
    g.addColorStop(1, '#7f939a');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, TAU);
    ctx.fill();

    // Pentagon patches.
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(b.rot);
    ctx.fillStyle = 'rgba(16, 34, 42, 0.78)';
    const centerPatch = r * 0.26;
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU - Math.PI / 2;
      const x = Math.cos(a) * centerPatch;
      const y = Math.sin(a) * centerPatch;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU - Math.PI / 2;
      const cx = Math.cos(a) * r * 0.64;
      const cy = Math.sin(a) * r * 0.64;
      const pr = r * 0.18;
      ctx.beginPath();
      for (let j = 0; j < 5; j++) {
        const aa = (j / 5) * TAU + a;
        const x = cx + Math.cos(aa) * pr;
        const y = cy + Math.sin(aa) * pr;
        if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    ctx.strokeStyle = 'rgba(9, 27, 36, 0.28)';
    ctx.lineWidth = Math.max(0.6, s * 0.026);
    ctx.beginPath();
    ctx.arc(px, py, r, 0, TAU);
    ctx.stroke();

    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
    ctx.lineWidth = Math.max(0.6, r * 0.12);
    ctx.beginPath();
    ctx.arc(px - r * 0.18, py - r * 0.2, r * 0.62, Math.PI * 1.05, Math.PI * 1.62);
    ctx.stroke();
    ctx.restore();
  }

  function drawLeg(s, hipX, hipY, footX, footY, side, sockColor, bootColor) {
    const dx = footX - hipX;
    const dy = footY - hipY;
    const dist = Math.max(0.001, hypot(dx, dy));
    const nx = dx / dist;
    const ny = dy / dist;
    const kneeDist = Math.min(dist * 0.58, s * 0.6);
    const outward = side * s * (0.17 + Math.min(0.16, dist / (s * 8)));
    const kneeX = hipX + nx * kneeDist + outward;
    const kneeY = hipY + ny * kneeDist + s * 0.03;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Dark silhouette under both segments.
    ctx.strokeStyle = 'rgba(8, 21, 29, 0.42)';
    ctx.lineWidth = s * 0.34;
    ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(kneeX, kneeY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(kneeX, kneeY); ctx.lineTo(footX, footY); ctx.stroke();

    // Thigh.
    ctx.strokeStyle = COLORS.skin;
    ctx.lineWidth = s * 0.26;
    ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(kneeX, kneeY); ctx.stroke();

    // Sock, with an Argentina band.
    ctx.strokeStyle = sockColor;
    ctx.lineWidth = s * 0.225;
    ctx.beginPath(); ctx.moveTo(kneeX, kneeY); ctx.lineTo(footX, footY); ctx.stroke();
    const bandX = lerp(kneeX, footX, 0.66);
    const bandY = lerp(kneeY, footY, 0.66);
    ctx.strokeStyle = 'rgba(94, 190, 233, 0.9)';
    ctx.lineWidth = s * 0.055;
    ctx.beginPath();
    ctx.moveTo(bandX - nx * s * 0.02, bandY - ny * s * 0.02);
    ctx.lineTo(bandX + nx * s * 0.02, bandY + ny * s * 0.02);
    ctx.stroke();

    // Boot.
    const angle = Math.atan2(dy, dx);
    ctx.save();
    ctx.translate(footX, footY);
    ctx.rotate(angle);
    ctx.fillStyle = bootColor;
    ellipsePath(ctx, s * 0.06, 0, s * 0.32, s * 0.185);
    ctx.fill();
    ctx.strokeStyle = 'rgba(235, 250, 255, 0.8)';
    ctx.lineWidth = Math.max(0.5, s * 0.035);
    ctx.beginPath();
    ctx.moveTo(-s * 0.08, -s * 0.12);
    ctx.quadraticCurveTo(s * 0.12, -s * 0.16, s * 0.23, -s * 0.02);
    ctx.stroke();
    ctx.restore();
  }

  function drawArm(s, shoulderX, shoulderY, handX, handY, side, jersey) {
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(8, 21, 29, 0.38)';
    ctx.lineWidth = s * 0.24;
    ctx.beginPath(); ctx.moveTo(shoulderX, shoulderY); ctx.lineTo(handX, handY); ctx.stroke();

    // Sleeve.
    const sx2 = lerp(shoulderX, handX, 0.42);
    const sy2 = lerp(shoulderY, handY, 0.42);
    ctx.strokeStyle = jersey;
    ctx.lineWidth = s * 0.19;
    ctx.beginPath(); ctx.moveTo(shoulderX, shoulderY); ctx.lineTo(sx2, sy2); ctx.stroke();

    // Forearm.
    ctx.strokeStyle = COLORS.skin;
    ctx.lineWidth = s * 0.14;
    ctx.beginPath(); ctx.moveTo(sx2, sy2); ctx.lineTo(handX, handY); ctx.stroke();
    ctx.fillStyle = COLORS.skin;
    ctx.beginPath(); ctx.arc(handX, handY, s * 0.085, 0, TAU); ctx.fill();
  }

  function drawPlayer() {
    const p = game.player;
    const s = view.s;
    const px = sx(p.x);
    const py = sy(p.y) + p.bounce * s;
    const sway = Math.sin(p.gait) * s * 0.05;

    drawGroundShadow(px + s * 0.14, py + s * 0.34, s * 0.96, s * 0.62, 0.46);

    if (p.possession && game.mode === 'playing') {
      const pulse = 0.5 + Math.sin(game.anim * 5) * 0.5;
      ctx.save();
      ctx.strokeStyle = `rgba(127, 214, 255, ${0.12 + pulse * 0.1})`;
      ctx.lineWidth = Math.max(1, s * 0.035);
      ctx.setLineDash([s * 0.22, s * 0.18]);
      ellipsePath(ctx, px, py + s * 0.25, s * 1.3, s * 0.82);
      ctx.stroke();
      ctx.restore();
    }

    // Legs.
    for (let i = 0; i < 2; i++) {
      const foot = p.feet[i];
      const hipX = px + (i === 0 ? -0.35 : 0.35) * s;
      const hipY = py + 0.35 * s;
      drawLeg(s, hipX, hipY, sx(foot.x), sy(foot.y), i === 0 ? -1 : 1,
        i === 0 ? '#f6fcff' : '#f6fcff', '#0b151d');
    }

    // Arms swing against the legs.
    const swing = Math.sin(p.gait) * s * 0.12;
    drawArm(s, px - 0.53 * s, py - 0.34 * s, px - 0.8 * s + sway, py + 0.18 * s + swing, -1, '#dff4ff');
    drawArm(s, px + 0.53 * s, py - 0.34 * s, px + 0.8 * s + sway, py + 0.18 * s - swing, 1, '#dff4ff');

    // Shorts.
    ctx.save();
    ctx.translate(px, py + 0.17 * s);
    ctx.rotate(p.lean * 0.35);
    ctx.fillStyle = '#111a22';
    roundRectPath(ctx, -0.58 * s, -0.1 * s, 1.16 * s, 0.55 * s, 0.16 * s);
    ctx.fill();
    ctx.fillStyle = 'rgba(127, 214, 255, 0.55)';
    ctx.fillRect(-0.58 * s, 0.22 * s, 1.16 * s, 0.055 * s);
    ctx.restore();

    // Torso / jersey.
    ctx.save();
    ctx.translate(px, py - 0.16 * s);
    ctx.rotate(p.lean);
    const bw = 0.56 * s;
    const bh = 0.78 * s;
    ctx.fillStyle = 'rgba(4, 15, 23, 0.35)';
    roundRectPath(ctx, -bw - s * 0.026, -bh - s * 0.02, bw * 2 + s * 0.052, bh * 2 + s * 0.04, bw * 0.6);
    ctx.fill();

    roundRectPath(ctx, -bw, -bh, bw * 2, bh * 2, bw * 0.58);
    ctx.fillStyle = '#f5fdff';
    ctx.fill();
    ctx.save();
    ctx.clip();
    // Sky-blue stripes.
    ctx.fillStyle = 'rgba(116, 199, 239, 0.96)';
    ctx.fillRect(-bw * 0.78, -bh, bw * 0.34, bh * 2);
    ctx.fillRect(-bw * 0.12, -bh, bw * 0.34, bh * 2);
    ctx.fillRect(bw * 0.55, -bh, bw * 0.36, bh * 2);
    // Fine fabric sheen.
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(-bw, -bh, bw * 0.3, bh * 2);
    ctx.fillStyle = 'rgba(0,38,58,0.09)';
    ctx.fillRect(bw * 0.56, -bh, bw * 0.44, bh * 2);
    ctx.restore();

    // Collar.
    ctx.fillStyle = '#082231';
    ctx.beginPath();
    ctx.moveTo(-bw * 0.25, -bh * 0.98);
    ctx.lineTo(0, -bh * 0.6);
    ctx.lineTo(bw * 0.25, -bh * 0.98);
    ctx.closePath();
    ctx.fill();

    // Number 10 on the back.
    ctx.fillStyle = '#0b2233';
    ctx.font = `${Math.max(7, s * 0.44)}px "Bebas Neue", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('10', 0, bh * 0.22);

    ctx.restore();

    // Head + hair.
    const headX = px + p.lean * s * 0.32 + sway * 0.3;
    const headY = py - 1.08 * s;
    ctx.fillStyle = 'rgba(5, 16, 24, 0.35)';
    ctx.beginPath(); ctx.arc(headX + s * 0.05, headY + s * 0.06, s * 0.35, 0, TAU); ctx.fill();

    ctx.fillStyle = COLORS.skin;
    ctx.beginPath(); ctx.arc(headX, headY, s * 0.335, 0, TAU); ctx.fill();

    // Hair cap, leaving a forehead crescent at the front.
    ctx.fillStyle = '#211813';
    ctx.beginPath();
    ctx.arc(headX, headY + s * 0.04, s * 0.325, -0.18, Math.PI + 0.18);
    ctx.lineTo(headX + s * 0.325, headY + s * 0.04);
    ctx.closePath();
    ctx.fill();

    // A little face/forehead.
    ctx.fillStyle = COLORS.skin;
    ctx.beginPath();
    ctx.ellipse(headX, headY - s * 0.18, s * 0.19, s * 0.09, 0, 0, TAU);
    ctx.fill();

    // Hair part.
    ctx.strokeStyle = 'rgba(0,0,0,0.32)';
    ctx.lineWidth = Math.max(0.6, s * 0.025);
    ctx.beginPath();
    ctx.moveTo(headX - s * 0.04, headY - s * 0.28);
    ctx.quadraticCurveTo(headX + s * 0.15, headY - s * 0.02, headX + s * 0.22, headY + s * 0.2);
    ctx.stroke();

    // Ear.
    ctx.fillStyle = COLORS.skinShade;
    ctx.beginPath(); ctx.arc(headX + s * 0.31, headY + s * 0.04, s * 0.045, 0, TAU); ctx.fill();
  }

  function drawDefender(d) {
    const s = view.s;
    const px = sx(d.x);
    const py = sy(d.y);
    drawGroundShadow(px + s * 0.13, py + s * 0.32, s * 0.86, s * 0.55, 0.4);

    for (let i = 0; i < 2; i++) {
      const foot = d.feet[i];
      const hipX = px + (i === 0 ? -0.31 : 0.31) * s;
      const hipY = py + 0.32 * s;
      drawLeg(s, hipX, hipY, sx(foot.x), sy(foot.y), i === 0 ? -1 : 1, '#f2f8fa', '#111a20');
    }

    // Arms.
    const swing = Math.sin(d.gait) * s * 0.1;
    drawArm(s, px - 0.48 * s, py - 0.28 * s, px - 0.7 * s, py + 0.2 * s + swing, -1, d.shirt);
    drawArm(s, px + 0.48 * s, py - 0.28 * s, px + 0.7 * s, py + 0.2 * s - swing, 1, d.shirt);

    // Shorts.
    ctx.fillStyle = '#151b21';
    roundRectPath(ctx, px - 0.5 * s, py + 0.08 * s, s, 0.45 * s, s * 0.14);
    ctx.fill();

    // Torso.
    ctx.save();
    ctx.translate(px, py - 0.18 * s);
    ctx.rotate(d.lean);
    const bw = 0.5 * s;
    const bh = 0.72 * s;
    roundRectPath(ctx, -bw, -bh, bw * 2, bh * 2, bw * 0.56);
    ctx.fillStyle = d.shirt;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(-bw * 0.2, -bh, bw * 0.22, bh * 2);
    ctx.fillRect(bw * 0.48, -bh, bw * 0.2, bh * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(-bw, -bh, bw * 0.28, bh * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.14)';
    ctx.fillRect(bw * 0.58, -bh, bw * 0.42, bh * 2);
    ctx.restore();
    ctx.fillStyle = 'rgba(255, 246, 232, 0.82)';
    ctx.font = `${Math.max(6, s * 0.34)}px "Bebas Neue", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(2 + (d.y | 0) % 8), 0, bh * 0.2);
    ctx.restore();

    // Head.
    const headX = px + d.lean * s * 0.3;
    const headY = py - 1.02 * s;
    ctx.fillStyle = d.skin;
    ctx.beginPath(); ctx.arc(headX, headY, s * 0.3, 0, TAU); ctx.fill();
    ctx.fillStyle = d.hair;
    ctx.beginPath();
    ctx.arc(headX, headY + s * 0.035, s * 0.29, -0.18, Math.PI + 0.18);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = d.skin;
    ctx.beginPath();
    ctx.ellipse(headX, headY - s * 0.16, s * 0.16, s * 0.075, 0, 0, TAU);
    ctx.fill();

    if (d.stun > 0) {
      ctx.fillStyle = 'rgba(255, 227, 150, 0.9)';
      for (let i = 0; i < 3; i++) {
        const a = game.anim * 6 + (i / 3) * TAU;
        ctx.beginPath();
        ctx.arc(headX + Math.cos(a) * s * 0.45, headY - s * 0.4 + Math.sin(a) * s * 0.12, s * 0.035, 0, TAU);
        ctx.fill();
      }
    }
  }

  function drawKeeper() {
    const k = game.keeper;
    const s = view.s;
    const px = sx(k.x);
    const py = sy(k.y);
    drawGroundShadow(px + s * 0.13, py + s * 0.32, s * 0.9, s * 0.58, 0.42);

    for (let i = 0; i < 2; i++) {
      const foot = k.feet[i];
      drawLeg(s, px + (i === 0 ? -0.3 : 0.3) * s, py + 0.3 * s, sx(foot.x), sy(foot.y), i === 0 ? -1 : 1, '#e7fbff', '#1d2b36');
    }

    // Gloves out wide when a shot is on.
    const gloveSpread = s * (0.86 + k.dive * 0.26);
    drawArm(s, px - 0.5 * s, py - 0.25 * s, px - gloveSpread, py + 0.05 * s, -1, '#d9f451');
    drawArm(s, px + 0.5 * s, py - 0.25 * s, px + gloveSpread, py + 0.05 * s, 1, '#d9f451');
    ctx.fillStyle = '#7cf0c3';
    ctx.beginPath(); ctx.arc(px - gloveSpread, py + 0.05 * s, s * 0.14, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(px + gloveSpread, py + 0.05 * s, s * 0.14, 0, TAU); ctx.fill();

    ctx.fillStyle = '#121b21';
    roundRectPath(ctx, px - 0.52 * s, py + 0.06 * s, s, 0.42 * s, s * 0.13);
    ctx.fill();

    ctx.save();
    ctx.translate(px, py - 0.18 * s);
    ctx.rotate(k.lean);
    const bw = 0.54 * s;
    const bh = 0.73 * s;
    roundRectPath(ctx, -bw, -bh, bw * 2, bh * 2, bw * 0.55);
    ctx.fillStyle = '#d9f451';
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = 'rgba(20, 55, 40, 0.28)';
    ctx.fillRect(-bw * 0.1, -bh, bw * 0.2, bh * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(-bw * 0.62, -bh, bw * 0.12, bh * 2);
    ctx.fillRect(bw * 0.5, -bh, bw * 0.12, bh * 2);
    ctx.restore();
    ctx.fillStyle = '#14392a';
    ctx.font = `${Math.max(6, s * 0.36)}px "Bebas Neue", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('1', 0, bh * 0.18);
    ctx.restore();

    const headX = px + k.lean * s * 0.3;
    const headY = py - 1.04 * s;
    ctx.fillStyle = '#d7a078';
    ctx.beginPath(); ctx.arc(headX, headY, s * 0.3, 0, TAU); ctx.fill();
    ctx.fillStyle = '#221812';
    ctx.beginPath();
    ctx.arc(headX, headY + s * 0.035, s * 0.29, -0.18, Math.PI + 0.18);
    ctx.closePath();
    ctx.fill();
  }

  function drawParticles() {
    const s = view.s;
    ctx.save();
    for (const p of game.particles) {
      const a = clamp(p.life / p.maxLife, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      const px = sx(p.x);
      const py = sy(p.y);
      if (p.type === 'grass') {
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(p.rot);
        ctx.fillRect(-s * p.size * 0.5, -s * p.size * 0.18, s * p.size, s * p.size * 0.36);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(px, py, Math.max(0.6, s * p.size), 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    for (const r of game.rings) {
      const a = clamp(r.life / r.maxLife, 0, 1);
      ctx.strokeStyle = r.color;
      ctx.globalAlpha = a * 0.5;
      ctx.lineWidth = Math.max(0.7, s * 0.045);
      ctx.beginPath();
      ctx.ellipse(sx(r.x), sy(r.y), s * r.r, s * r.r * 0.66, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of game.floaters) {
      const a = clamp(f.life / f.maxLife, 0, 1);
      ctx.globalAlpha = Math.min(1, a * 2.2);
      ctx.font = `${Math.max(10, s * f.size)}px "Bebas Neue", sans-serif`;
      ctx.fillStyle = f.color;
      ctx.strokeStyle = 'rgba(4, 14, 23, 0.55)';
      ctx.lineWidth = Math.max(2, s * 0.06);
      ctx.strokeText(f.text, sx(f.x), sy(f.y));
      ctx.fillText(f.text, sx(f.x), sy(f.y));
    }
    ctx.restore();
  }

  function drawConfetti() {
    ctx.save();
    for (const c of game.confetti) {
      const a = clamp(c.life, 0, 1);
      ctx.globalAlpha = Math.min(1, a);
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot);
      ctx.fillStyle = c.color;
      ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
      ctx.restore();
    }
    ctx.restore();
  }

  function drawSticks() {
    if (game.mode !== 'playing' && game.mode !== 'paused' && game.mode !== 'goal') return;
    const s = view.s;
    const kb = readKeyboard();
    const gp = readGamepad();
    const sides = ['left', 'right'];

    for (const side of sides) {
      const t = touchInput[side];
      const rest = stickRest(side);
      const centerX = t.active ? t.cx : rest.x;
      const centerY = t.active ? t.cy : rest.y;
      const r = rest.r;
      const color = side === 'left' ? COLORS.sky : COLORS.gold;
      let vx = t.active ? t.x : (side === 'left' ? kb.left.x : kb.right.x);
      let vy = t.active ? t.y : (side === 'left' ? kb.left.y : kb.right.y);
      if (!t.active && gp) {
        const gpv = side === 'left' ? gp.left : gp.right;
        if (gpv.mag > hypot(vx, vy)) { vx = gpv.x; vy = gpv.y; }
      }
      const active = t.active || hypot(vx, vy) > 0.08;

      // Tether to the controlled boot.
      const foot = game.player.feet[side === 'left' ? 0 : 1];
      ctx.save();
      ctx.strokeStyle = color;
      ctx.globalAlpha = active ? 0.22 : 0.08;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 7]);
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(sx(foot.x), sy(foot.y));
      ctx.stroke();
      ctx.restore();

      // Base ring.
      ctx.save();
      const glow = ctx.createRadialGradient(centerX, centerY, r * 0.1, centerX, centerY, r * 1.2);
      glow.addColorStop(0, side === 'left' ? 'rgba(127,214,255,0.075)' : 'rgba(255,209,102,0.07)');
      glow.addColorStop(0.7, 'rgba(255,255,255,0.012)');
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(centerX, centerY, r * 1.2, 0, TAU); ctx.fill();

      ctx.strokeStyle = active ? color : 'rgba(206, 240, 255, 0.24)';
      ctx.globalAlpha = active ? 0.82 : 0.62;
      ctx.lineWidth = active ? 1.8 : 1.2;
      ctx.beginPath(); ctx.arc(centerX, centerY, r, 0, TAU); ctx.stroke();

      // Tick marks.
      ctx.globalAlpha = active ? 0.6 : 0.34;
      ctx.lineWidth = 1;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        const inner = r + 4;
        const outer = r + (i % 2 === 0 ? 9 : 6);
        ctx.beginPath();
        ctx.moveTo(centerX + Math.cos(a) * inner, centerY + Math.sin(a) * inner);
        ctx.lineTo(centerX + Math.cos(a) * outer, centerY + Math.sin(a) * outer);
        ctx.stroke();
      }
      ctx.restore();

      // Knob.
      const kx = centerX + vx * r * 0.58;
      const ky = centerY + vy * r * 0.58;
      ctx.save();
      ctx.fillStyle = 'rgba(5, 18, 29, 0.6)';
      ctx.beginPath(); ctx.arc(kx, ky, r * 0.34 + 3, 0, TAU); ctx.fill();
      const knob = ctx.createRadialGradient(kx - r * 0.1, ky - r * 0.11, r * 0.03, kx, ky, r * 0.34);
      knob.addColorStop(0, side === 'left' ? '#e2f7ff' : '#fff4cf');
      knob.addColorStop(0.45, color);
      knob.addColorStop(1, side === 'left' ? '#2c82ab' : '#b57f2d');
      ctx.fillStyle = knob;
      ctx.beginPath(); ctx.arc(kx, ky, r * 0.34, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.48)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(kx, ky, r * 0.34, 0, TAU); ctx.stroke();

      // L / R glyph.
      ctx.fillStyle = 'rgba(5, 23, 36, 0.8)';
      ctx.font = `${Math.max(11, r * 0.35)}px "Bebas Neue", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(side === 'left' ? 'L' : 'R', kx, ky + 1);
      ctx.restore();

      // Label.
      ctx.save();
      const label = isCoarse || t.active ? (side === 'left' ? 'LEFT LEG' : 'RIGHT LEG') : (side === 'left' ? 'WASD' : 'ARROWS');
      ctx.fillStyle = active ? color : 'rgba(203, 238, 255, 0.45)';
      ctx.font = `700 ${Math.max(6.5, Math.min(8, s * 0.34))}px Outfit, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.letterSpacing = '2px';
      ctx.fillText(label, centerX, centerY + r + 15);
      ctx.restore();
    }
  }

  function drawMiniMap() {
    if (!view.wide || game.mode === 'title' || game.mode === 'over') return;
    if (game.camera.top <= 1.2) return;
    const x = W - 20;
    const y0 = view.topPad + 54;
    const h = 142;
    const s = view.s;
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = 'rgba(190, 232, 255, 0.28)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0 + h); ctx.stroke();
    // Goal notch.
    ctx.strokeStyle = COLORS.sky;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x - 5, y0); ctx.lineTo(x + 5, y0); ctx.stroke();
    ctx.fillStyle = 'rgba(196, 238, 255, 0.6)';
    ctx.font = '700 6px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('GOAL', x, y0 - 8);

    const dot = (wx, wy, color, radius) => {
      const py = y0 + clamp(wy / FIELD.h, 0, 1) * h;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(x, py, radius, 0, TAU); ctx.fill();
    };
    for (const d of game.defenders) dot(d.x, d.y, 'rgba(255, 107, 94, 0.9)', 2.1);
    dot(game.ball.x, game.ball.y, COLORS.gold, 2.5);
    dot(game.player.x, game.player.y, COLORS.sky, 3);
    ctx.restore();
  }

  function drawKickoffFlash() {
    if (game.kickoffFlash > 0.01) {
      ctx.save();
      ctx.globalAlpha = game.kickoffFlash * 0.16;
      ctx.fillStyle = '#dff6ff';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    if (game.goalFlash > 0.01) {
      ctx.save();
      ctx.globalAlpha = game.goalFlash * 0.24;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  // ── Main render ──────────────────────────────────────────────
  function render() {
    const dpr = view.dpr || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (game.layers.backdrop && backdrop) ctx.drawImage(backdrop, 0, 0, W, H);

    if (game.layers.crowd) drawCrowdFlashes();
    if (game.layers.pitch) {
      if (pitchCanvas) {
        const s = view.s;
        ctx.drawImage(
          pitchCanvas,
          sx(-PITCH_PAD.left),
          sy(-PITCH_PAD.top),
          (PITCH_PAD.left + FIELD.w + PITCH_PAD.right) * s,
          (PITCH_PAD.top + FIELD.h + PITCH_PAD.bottom) * s
        );
      } else {
        drawPitch();
        drawAdBoards();
      }
    }
    if (game.layers.goals) { drawGoal(true); drawGoal(false); }

    if (game.layers.entities) {
      if (game.mode !== 'title') {
        // Players are sorted by y for depth; the ball stays on top so it is
        // never lost between a defender's legs in a crowded box.
        const entities = [
          { y: game.keeper.y, draw: drawKeeper },
          ...game.defenders.map((d) => ({ y: d.y, draw: () => drawDefender(d) })),
          { y: game.player.y, draw: drawPlayer },
        ];
        entities.sort((a, b) => a.y - b.y);
        for (const e of entities) e.draw();
        drawBall();
      } else {
        drawKeeper();
        for (const d of game.defenders) drawDefender(d);
        drawPlayer();
        drawBall();
      }
    }

    if (game.layers.effects) {
      drawParticles();
      drawConfetti();
      drawKickoffFlash();
      drawMiniMap();
    }
    if (game.layers.sticks) drawSticks();
  }

  // ── Loop ─────────────────────────────────────────────────────
  let lastFrame = 0;
  let hudAccumulator = 0;
  let fpsFrames = 0;
  let fpsSince = 0;

  function frame(now) {
    if (!lastFrame) { lastFrame = now; fpsSince = now; }
    const realDt = clamp((now - lastFrame) / 1000, 0, 0.25);
    lastFrame = now;
    if (document.hidden) {
      requestAnimationFrame(frame);
      return;
    }
    // Fixed simulation steps keep the match running at wall-clock speed even
    // on software-rendered or low-power devices.
    let remaining = realDt;
    let guard = 0;
    while (remaining > 0.0001 && guard++ < 24) {
      const step = Math.min(1 / 60, remaining);
      update(step);
      remaining -= step;
    }
    render();
    hudAccumulator += realDt;
    if (hudAccumulator > 0.09) {
      hudAccumulator = 0;
      if (game.mode !== 'title') updateHud();
    }
    fpsFrames++;
    if (now - fpsSince >= 1000) {
      game.fps = Math.round((fpsFrames * 1000) / (now - fpsSince));
      fpsFrames = 0;
      fpsSince = now;
    }
    requestAnimationFrame(frame);
  }

  // ── Boot ─────────────────────────────────────────────────────
  function boot() {
    resetEntities(true);
    spawnDefenders(2, true);
    resize();
    showTitle();
    updateHud();
    detectGamepad();
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', () => setTimeout(resize, 120));
    if (window.matchMedia) {
      try {
        window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => {
          reducedMotion = e.matches;
        });
      } catch { /* older Safari */ }
    }
    const params = new URLSearchParams(location.search);
    if (params.get('play') === '1') startMatch();
    requestAnimationFrame(frame);
  }

  // ── Debug / test hook ────────────────────────────────────────
  window.__MESSI__ = {
    get state() {
      return {
        mode: game.mode,
        time: game.timeLeft,
        score: game.score,
        goals: game.goals,
        combo: game.combo,
        defenders: game.defenders.length,
        ball: { x: game.ball.x, y: game.ball.y, vx: game.ball.vx, vy: game.ball.vy },
        player: { x: game.player.x, y: game.player.y, feet: game.player.feet.map((f) => ({ x: f.x, y: f.y })) },
        stats: { ...game.stats },
      };
    },
    start: startMatch,
    title: showTitle,
    pause: pauseGame,
    resume: resumeGame,
    end: endMatch,
    goal: () => {
      if (game.mode !== 'playing') return;
      game.ball.x = FIELD.cx;
      game.ball.y = -0.2;
      scoreGoal();
      return true;
    },
    setSticks(left, right) {
      const l = { x: Number(left?.x) || 0, y: Number(left?.y) || 0 };
      const r = { x: Number(right?.x) || 0, y: Number(right?.y) || 0 };
      debugSticks = { left: { ...l, mag: hypot(l.x, l.y) }, right: { ...r, mag: hypot(r.x, r.y) } };
    },
    clearSticks() { debugSticks = null; },
    setTime(seconds) { game.timeLeft = Number(seconds) || 0; updateHud(); },
    setScore(points) { game.score = Number(points) || 0; updateHud(); },
    resize,
    render,
    field: FIELD,
    game,
  };

  boot();
})();
