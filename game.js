'use strict';

/* ============================================================
   ROGUE STEEL — top-down arcade robot combat.
   No RPG systems: no leveling, no inventory, no dialogue.
   Score-based wave survival with skill-based movement/aim/heat.
   ============================================================ */

// ---------- utility ----------
const TAU = Math.PI * 2;
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function rand(a, b) { return a + Math.random() * (b - a); }
function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }
function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
function angleTo(ax, ay, bx, by) { return Math.atan2(by - ay, bx - ax); }
function lerp(a, b, t) { return a + (b - a) * t; }

function circleRectCollide(cx, cy, cr, rx, ry, rw, rh) {
  const nx = clamp(cx, rx, rx + rw);
  const ny = clamp(cy, ry, ry + rh);
  const dx = cx - nx, dy = cy - ny;
  return (dx * dx + dy * dy) < cr * cr;
}

// resolve a circle out of a rect (push out along shortest axis)
function resolveCircleRect(entity, rx, ry, rw, rh) {
  const cx = entity.x, cy = entity.y, cr = entity.r;
  const nx = clamp(cx, rx, rx + rw);
  const ny = clamp(cy, ry, ry + rh);
  let dx = cx - nx, dy = cy - ny;
  let d = Math.hypot(dx, dy);
  if (d === 0) { dx = 1; dy = 0; d = 1; }
  if (d < cr) {
    const push = cr - d;
    entity.x += (dx / d) * push;
    entity.y += (dy / d) * push;
  }
}

// ---------- audio (synthesized, no external assets) ----------
const Audio_ = {
  ctx: null,
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  },
  tone(freq, dur, type, vol, sweepTo) {
    try {
      const ctx = this.ensure();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      if (sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, sweepTo), ctx.currentTime + dur);
      gain.gain.setValueAtTime(vol || 0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + dur);
    } catch (e) { /* audio not available */ }
  },
  noise(dur, vol) {
    try {
      const ctx = this.ensure();
      const bufSize = ctx.sampleRate * dur;
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(vol || 0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      src.connect(gain).connect(ctx.destination);
      src.start();
    } catch (e) { /* audio not available */ }
  },
  shoot() { this.tone(rand(760, 840), 0.08, 'sawtooth', 0.06, 220); },
  enemyShoot() { this.tone(rand(300, 360), 0.1, 'square', 0.05, 120); },
  hit() { this.noise(0.08, 0.12); },
  explosion() { this.noise(0.35, 0.28); this.tone(90, 0.3, 'sine', 0.15, 30); },
  dash() { this.tone(200, 0.15, 'sine', 0.1, 500); },
  powerup() { this.tone(500, 0.12, 'triangle', 0.12, 900); },
  overheat() { this.tone(140, 0.4, 'sawtooth', 0.1, 60); },
  playerHit() { this.tone(160, 0.18, 'square', 0.14, 70); },
  gameOver() { this.tone(220, 0.6, 'sawtooth', 0.15, 40); },
};

// ---------- input ----------
const Input = {
  keys: new Set(),
  mouse: { x: 0, y: 0, down: false },
  init(canvas) {
    window.addEventListener('keydown', e => {
      this.keys.add(e.code);
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    canvas.addEventListener('mousemove', e => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = (e.clientX - r.left) * (canvas.width / r.width);
      this.mouse.y = (e.clientY - r.top) * (canvas.height / r.height);
    });
    canvas.addEventListener('mousedown', () => this.mouse.down = true);
    window.addEventListener('mouseup', () => this.mouse.down = false);
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  },
  down(code) { return this.keys.has(code); },
};

// ---------- particles ----------
class Particle {
  constructor(x, y, vx, vy, life, color, size) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.life = life; this.maxLife = life;
    this.color = color; this.size = size;
  }
  update(dt) {
    this.x += this.vx * dt; this.y += this.vy * dt;
    this.vx *= 0.94; this.vy *= 0.94;
    this.life -= dt;
    return this.life > 0;
  }
  draw(ctx) {
    const t = clamp(this.life / this.maxLife, 0, 1);
    ctx.globalAlpha = t;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size * t, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function burst(game, x, y, color, count, speed, life) {
  for (let i = 0; i < count; i++) {
    const a = rand(0, TAU);
    const s = rand(speed * 0.3, speed);
    game.particles.push(new Particle(x, y, Math.cos(a) * s, Math.sin(a) * s, rand(life * 0.5, life), color, rand(2, 4)));
  }
}

// ---------- bullets ----------
class Bullet {
  constructor(x, y, angle, speed, dmg, owner, color, radius) {
    this.x = x; this.y = y;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.dmg = dmg; this.owner = owner; // 'player' | 'enemy'
    this.color = color || (owner === 'player' ? '#4ff3ff' : '#ff5b4d');
    this.r = radius || 4;
    this.dead = false;
    this.trail = [];
  }
  update(dt, game) {
    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > 4) this.trail.shift();
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (this.x < -20 || this.x > game.W + 20 || this.y < -20 || this.y > game.H + 20) this.dead = true;
    for (const o of game.obstacles) {
      if (circleRectCollide(this.x, this.y, this.r, o.x, o.y, o.w, o.h)) { this.dead = true; break; }
    }
  }
  draw(ctx) {
    ctx.strokeStyle = this.color;
    ctx.lineWidth = this.r;
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.5;
    if (this.trail.length > 1) {
      ctx.beginPath();
      ctx.moveTo(this.trail[0].x, this.trail[0].y);
      for (const p of this.trail) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, TAU);
    ctx.fill();
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

// ---------- power-ups ----------
const POWERUP_TYPES = {
  health: { color: '#4fe07d', symbol: '+' },
  overdrive: { color: '#ffd447', symbol: '⚡' },
  shield: { color: '#4ff3ff', symbol: '◈' },
};

class PowerUp {
  constructor(x, y, type) {
    this.x = x; this.y = y; this.type = type; this.r = 12;
    this.life = 9; this.bob = rand(0, TAU); this.dead = false;
  }
  update(dt) {
    this.life -= dt;
    this.bob += dt * 4;
    if (this.life <= 0) this.dead = true;
  }
  draw(ctx) {
    const def = POWERUP_TYPES[this.type];
    const y = this.y + Math.sin(this.bob) * 4;
    ctx.save();
    ctx.translate(this.x, y);
    if (this.life < 3) ctx.globalAlpha = 0.4 + 0.4 * Math.abs(Math.sin(this.life * 8));
    ctx.strokeStyle = def.color;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, this.r, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.shadowColor = def.color;
    ctx.shadowBlur = 10;
    ctx.fillStyle = def.color;
    ctx.font = 'bold 14px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(def.symbol, 0, 1);
    ctx.restore();
  }
}

// ---------- obstacles ----------
class Obstacle {
  constructor(x, y, w, h) { this.x = x; this.y = y; this.w = w; this.h = h; }
  draw(ctx) {
    ctx.fillStyle = '#1b232a';
    ctx.strokeStyle = 'rgba(79,243,255,0.25)';
    ctx.lineWidth = 2;
    ctx.fillRect(this.x, this.y, this.w, this.h);
    ctx.strokeRect(this.x, this.y, this.w, this.h);
  }
}

// ---------- player ----------
class Player {
  constructor(x, y) {
    this.x = x; this.y = y; this.r = 16;
    this.angle = 0;
    this.speed = 240;
    this.maxHealth = 100; this.health = 100;
    this.maxHeat = 100; this.heat = 0;
    this.overheated = false;
    this.fireRate = 0.09; this.fireTimer = 0;
    this.heatPerShot = 9;
    this.heatDecay = 38;
    this.overheatDecay = 22;
    this.dashCooldown = 1.4; this.dashTimer = 0;
    this.dashDuration = 0.18; this.dashing = 0;
    this.dashSpeed = 720;
    this.invuln = 0;
    this.hitFlash = 0;
    this.overdriveTimer = 0;
    this.shieldTimer = 0;
    this.alive = true;
  }

  get effectiveFireRate() { return this.overdriveTimer > 0 ? this.fireRate * 0.45 : this.fireRate; }
  get effectiveHeatPerShot() { return this.overdriveTimer > 0 ? this.heatPerShot * 0.4 : this.heatPerShot; }

  update(dt, game) {
    // movement
    let mx = 0, my = 0;
    if (Input.down('KeyW') || Input.down('ArrowUp')) my -= 1;
    if (Input.down('KeyS') || Input.down('ArrowDown')) my += 1;
    if (Input.down('KeyA') || Input.down('ArrowLeft')) mx -= 1;
    if (Input.down('KeyD') || Input.down('ArrowRight')) mx += 1;
    const mlen = Math.hypot(mx, my);
    if (mlen > 0) { mx /= mlen; my /= mlen; }

    this.dashTimer = Math.max(0, this.dashTimer - dt);
    if (this.dashing > 0) {
      this.dashing -= dt;
      this.invuln = Math.max(this.invuln, 0.05);
    } else if ((Input.down('ShiftLeft') || Input.down('ShiftRight')) && this.dashTimer <= 0 && mlen > 0) {
      this.dashing = this.dashDuration;
      this.dashTimer = this.dashCooldown;
      this.invuln = this.dashDuration + 0.1;
      Audio_.dash();
      burst(game, this.x, this.y, '#4ff3ff', 14, 200, 0.4);
    }

    const curSpeed = this.dashing > 0 ? this.dashSpeed : this.speed;
    if (this.dashing > 0) {
      this.x += this._dashDx * curSpeed * dt;
      this.y += this._dashDy * curSpeed * dt;
    } else {
      if (mlen > 0) { this._dashDx = mx; this._dashDy = my; }
      this.x += mx * curSpeed * dt;
      this.y += my * curSpeed * dt;
    }

    this.x = clamp(this.x, this.r, game.W - this.r);
    this.y = clamp(this.y, this.r, game.H - this.r);
    for (const o of game.obstacles) resolveCircleRect(this, o.x, o.y, o.w, o.h);

    // aim
    this.angle = angleTo(this.x, this.y, Input.mouse.x, Input.mouse.y);

    // heat
    if (this.overheated) {
      this.heat -= this.overheatDecay * dt;
      if (this.heat <= 0) { this.heat = 0; this.overheated = false; }
    } else {
      this.heat = Math.max(0, this.heat - this.heatDecay * dt * (this._firing ? 0.15 : 1));
    }

    // firing
    this.fireTimer -= dt;
    this._firing = false;
    if ((Input.mouse.down || Input.down('Space')) && !this.overheated) {
      if (this.fireTimer <= 0) {
        this.fireTimer = this.effectiveFireRate;
        this._firing = true;
        this.heat = Math.min(this.maxHeat, this.heat + this.effectiveHeatPerShot);
        if (this.heat >= this.maxHeat) { this.overheated = true; Audio_.overheat(); }
        const spread = rand(-0.03, 0.03);
        game.bullets.push(new Bullet(
          this.x + Math.cos(this.angle) * 22,
          this.y + Math.sin(this.angle) * 22,
          this.angle + spread, 620, 12 + (this.overdriveTimer > 0 ? 3 : 0), 'player', '#4ff3ff', 4
        ));
        Audio_.shoot();
        burst(game, this.x + Math.cos(this.angle) * 22, this.y + Math.sin(this.angle) * 22, '#bff9ff', 3, 80, 0.15);
      }
    }

    this.invuln = Math.max(0, this.invuln - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.overdriveTimer = Math.max(0, this.overdriveTimer - dt);
    this.shieldTimer = Math.max(0, this.shieldTimer - dt);
  }

  takeDamage(amount, game) {
    if (this.invuln > 0 || this.shieldTimer > 0 || !this.alive) return;
    this.health -= amount;
    this.hitFlash = 0.25;
    this.invuln = 0.5;
    Audio_.playerHit();
    game.shake = Math.min(18, game.shake + amount * 0.6);
    burst(game, this.x, this.y, '#ff5b4d', 10, 140, 0.35);
    if (this.health <= 0) { this.health = 0; this.alive = false; }
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);

    if (this.shieldTimer > 0) {
      ctx.strokeStyle = 'rgba(79,243,255,0.7)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, this.r + 8, 0, TAU);
      ctx.stroke();
    }
    if (this.invuln > 0 && this.dashing <= 0) {
      ctx.globalAlpha = 0.5 + 0.3 * Math.sin(performance.now() / 30);
    }

    // treads/body base
    ctx.rotate(this.angle);

    // body
    const flashColor = this.hitFlash > 0 ? '#ff8f80' : '#dff7ff';
    ctx.fillStyle = '#132028';
    ctx.strokeStyle = flashColor;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(this.r, 0);
    ctx.lineTo(this.r * 0.2, this.r * 0.8);
    ctx.lineTo(-this.r * 0.9, this.r * 0.6);
    ctx.lineTo(-this.r * 0.9, -this.r * 0.6);
    ctx.lineTo(this.r * 0.2, -this.r * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // turret barrel
    ctx.fillStyle = '#4ff3ff';
    ctx.shadowColor = '#4ff3ff';
    ctx.shadowBlur = this.overdriveTimer > 0 ? 16 : 6;
    ctx.fillRect(this.r * 0.1, -3, this.r * 1.1, 6);
    ctx.shadowBlur = 0;

    // core
    ctx.beginPath();
    ctx.fillStyle = this.overheated ? '#ff5b4d' : '#4ff3ff';
    ctx.arc(0, 0, 5, 0, TAU);
    ctx.fill();

    ctx.restore();
  }
}

// ---------- enemy types ----------
const ENEMY_DEFS = {
  scout: {
    r: 13, hp: 22, speed: 190, color: '#ff5b4d', score: 60,
    contactDmg: 12, behavior: 'charge',
  },
  gunner: {
    r: 15, hp: 34, speed: 110, color: '#ff8f3d', score: 90,
    contactDmg: 8, behavior: 'ranged', fireRate: 1.3, bulletSpeed: 300, bulletDmg: 8,
  },
  heavy: {
    r: 24, hp: 90, speed: 70, color: '#c23bff', score: 160,
    contactDmg: 10, behavior: 'slam', slamRadius: 90, slamDmg: 26, slamCharge: 1.1,
  },
  boss: {
    r: 40, hp: 620, speed: 85, color: '#ff2d55', score: 900,
    contactDmg: 20, behavior: 'boss', fireRate: 0.5, bulletSpeed: 260, bulletDmg: 10,
  },
};

class Enemy {
  constructor(x, y, type) {
    const d = ENEMY_DEFS[type];
    this.type = type;
    this.x = x; this.y = y; this.r = d.r;
    this.hp = d.hp; this.maxHp = d.hp;
    this.speed = d.speed;
    this.color = d.color;
    this.contactDmg = d.contactDmg;
    this.behavior = d.behavior;
    this.def = d;
    this.angle = 0;
    this.hitFlash = 0;
    this.dead = false;
    this.state = 'seek';
    this.stateTimer = rand(0.5, 1.5);
    this.fireTimer = rand(0.3, d.fireRate || 1);
    this.slamTelegraph = 0;
    this.chargeVec = { x: 0, y: 0 };
    this.knockX = 0; this.knockY = 0;
    this.bossPattern = 0;
    this.bossTimer = 2;
  }

  takeDamage(amount, game) {
    this.hp -= amount;
    this.hitFlash = 0.12;
    burst(game, this.x, this.y, this.color, 5, 90, 0.25);
    if (this.hp <= 0 && !this.dead) {
      this.dead = true;
      Audio_.explosion();
      burst(game, this.x, this.y, this.color, this.type === 'boss' ? 60 : 18, this.type === 'boss' ? 320 : 180, 0.6);
      game.shake = Math.min(20, game.shake + (this.type === 'boss' ? 16 : 5));
      game.onEnemyKilled(this);
    }
  }

  update(dt, game) {
    const p = game.player;
    const a = angleTo(this.x, this.y, p.x, p.y);
    this.angle = a;
    const d = dist(this.x, this.y, p.x, p.y);

    if (this.behavior === 'charge') {
      this.x += Math.cos(a) * this.speed * dt;
      this.y += Math.sin(a) * this.speed * dt;
    } else if (this.behavior === 'ranged') {
      const desired = 260;
      const dir = d < desired - 20 ? -1 : d > desired + 20 ? 1 : 0;
      this.x += Math.cos(a) * dir * this.speed * dt;
      this.y += Math.sin(a) * dir * this.speed * dt;
      this.fireTimer -= dt;
      if (this.fireTimer <= 0 && d < 520) {
        this.fireTimer = this.def.fireRate * rand(0.85, 1.15);
        game.bullets.push(new Bullet(this.x, this.y, a, this.def.bulletSpeed, this.def.bulletDmg, 'enemy', '#ff8f3d', 5));
        Audio_.enemyShoot();
      }
    } else if (this.behavior === 'slam') {
      if (this.slamTelegraph > 0) {
        this.slamTelegraph -= dt;
        if (this.slamTelegraph <= 0) {
          if (d < this.def.slamRadius + this.r) {
            p.takeDamage(this.def.slamDmg, game);
          }
          burst(game, this.x, this.y, '#c23bff', 24, 220, 0.4);
          game.shake = Math.min(16, game.shake + 8);
        }
      } else if (d < this.def.slamRadius) {
        this.slamTelegraph = this.def.slamCharge;
      } else {
        this.x += Math.cos(a) * this.speed * dt;
        this.y += Math.sin(a) * this.speed * dt;
      }
    } else if (this.behavior === 'boss') {
      this.bossTimer -= dt;
      const desired = 300;
      const dir = d < desired - 30 ? -1 : d > desired + 30 ? 1 : 0;
      this.x += Math.cos(a) * dir * this.speed * 0.6 * dt;
      this.y += Math.sin(a) * dir * this.speed * dt * 0.6;
      if (this.bossTimer <= 0) {
        this.bossTimer = rand(1.8, 2.6);
        this.bossPattern = (this.bossPattern + 1) % 2;
      }
      this.fireTimer -= dt;
      if (this.fireTimer <= 0) {
        if (this.bossPattern === 0) {
          this.fireTimer = this.def.fireRate;
          game.bullets.push(new Bullet(this.x, this.y, a, this.def.bulletSpeed, this.def.bulletDmg, 'enemy', '#ff2d55', 6));
          Audio_.enemyShoot();
        } else {
          this.fireTimer = this.def.fireRate * 2.2;
          const n = 8;
          for (let i = 0; i < n; i++) {
            game.bullets.push(new Bullet(this.x, this.y, (TAU / n) * i, this.def.bulletSpeed * 0.8, this.def.bulletDmg, 'enemy', '#ff2d55', 6));
          }
          Audio_.enemyShoot();
        }
      }
    }

    // knockback integration
    if (Math.abs(this.knockX) > 0.5 || Math.abs(this.knockY) > 0.5) {
      this.x += this.knockX * dt;
      this.y += this.knockY * dt;
      this.knockX *= 0.85; this.knockY *= 0.85;
    }

    this.x = clamp(this.x, this.r, game.W - this.r);
    this.y = clamp(this.y, this.r, game.H - this.r);
    for (const o of game.obstacles) resolveCircleRect(this, o.x, o.y, o.w, o.h);

    // contact damage with player
    if (d < this.r + p.r) {
      p.takeDamage(this.contactDmg * dt * 3, game);
      const push = (this.r + p.r) - d || 1;
      const nx = (this.x - p.x) / (d || 1), ny = (this.y - p.y) / (d || 1);
      this.x += nx * push * 0.5;
      this.y += ny * push * 0.5;
    }

    this.hitFlash = Math.max(0, this.hitFlash - dt);
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);

    if (this.behavior === 'slam' && this.slamTelegraph > 0) {
      const t = 1 - this.slamTelegraph / this.def.slamCharge;
      ctx.strokeStyle = `rgba(194,59,255,${0.8 - t * 0.4})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, this.def.slamRadius * t, 0, TAU);
      ctx.stroke();
    }

    ctx.rotate(this.angle);
    const flash = this.hitFlash > 0;
    ctx.fillStyle = flash ? '#ffffff' : '#1a0f10';
    ctx.strokeStyle = flash ? '#ffffff' : this.color;
    ctx.lineWidth = 2.5;

    if (this.type === 'scout') {
      ctx.beginPath();
      ctx.moveTo(this.r, 0);
      ctx.lineTo(-this.r * 0.8, this.r * 0.75);
      ctx.lineTo(-this.r * 0.4, 0);
      ctx.lineTo(-this.r * 0.8, -this.r * 0.75);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    } else if (this.type === 'gunner') {
      ctx.beginPath();
      ctx.rect(-this.r * 0.8, -this.r * 0.8, this.r * 1.6, this.r * 1.6);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = flash ? '#fff' : this.color;
      ctx.fillRect(0, -2.5, this.r * 1.1, 5);
    } else if (this.type === 'heavy') {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (TAU / 6) * i;
        const px = Math.cos(a) * this.r, py = Math.sin(a) * this.r;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    } else if (this.type === 'boss') {
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (TAU / 8) * i;
        const rr = i % 2 === 0 ? this.r : this.r * 0.7;
        const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = flash ? '#fff' : this.color;
      ctx.fillRect(0, -4, this.r * 1.2, 8);
    }

    ctx.fillStyle = flash ? '#fff' : this.color;
    ctx.beginPath();
    ctx.arc(0, 0, this.r * 0.25, 0, TAU);
    ctx.fill();

    ctx.restore();

    // health bar
    if (this.hp < this.maxHp) {
      const w = this.r * 2;
      const t = clamp(this.hp / this.maxHp, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(this.x - w / 2, this.y - this.r - 12, w, 5);
      ctx.fillStyle = t > 0.5 ? '#4fe07d' : t > 0.25 ? '#ffd447' : '#ff5b4d';
      ctx.fillRect(this.x - w / 2, this.y - this.r - 12, w * t, 5);
    }
  }
}

// ---------- game ----------
class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.W = canvas.width;
    this.H = canvas.height;
    this.state = 'start'; // start | playing | paused | gameover
    this.reset();
    this.lastTime = performance.now();
    Input.init(canvas);
    this.bindUI();
    requestAnimationFrame(this.loop.bind(this));
  }

  reset() {
    this.player = new Player(this.W / 2, this.H / 2);
    this.bullets = [];
    this.enemies = [];
    this.particles = [];
    this.powerups = [];
    this.obstacles = this.makeObstacles();
    this.score = 0;
    this.wave = 0;
    this.shake = 0;
    this.spawnQueue = [];
    this.spawnTimer = 0;
    this.waveActive = false;
    this.waveBannerTimer = 0;
  }

  makeObstacles() {
    const list = [];
    const margin = 120;
    const spots = [
      [this.W * 0.25, this.H * 0.3], [this.W * 0.75, this.H * 0.3],
      [this.W * 0.25, this.H * 0.7], [this.W * 0.75, this.H * 0.7],
      [this.W * 0.5, this.H * 0.5],
    ];
    for (const [sx, sy] of spots) {
      const w = rand(50, 90), h = rand(50, 90);
      list.push(new Obstacle(sx - w / 2, sy - h / 2, w, h));
    }
    return list.filter(o => dist(o.x + o.w / 2, o.y + o.h / 2, this.W / 2, this.H / 2) > 60);
  }

  bindUI() {
    document.getElementById('startBtn').onclick = () => this.startGame();
    document.getElementById('restartBtn').onclick = () => this.startGame();
    document.getElementById('resumeBtn').onclick = () => this.togglePause(false);
    window.addEventListener('keydown', e => {
      if (e.code === 'KeyP' || e.code === 'Escape') {
        if (this.state === 'playing') this.togglePause(true);
        else if (this.state === 'paused') this.togglePause(false);
      }
      if (e.code === 'Enter') {
        if (this.state === 'start' || this.state === 'gameover') this.startGame();
      }
    });
  }

  togglePause(pause) {
    if (pause) { this.state = 'paused'; document.getElementById('pauseScreen').classList.remove('hidden'); }
    else { this.state = 'playing'; document.getElementById('pauseScreen').classList.add('hidden'); }
  }

  startGame() {
    this.reset();
    this.state = 'playing';
    document.getElementById('startScreen').classList.add('hidden');
    document.getElementById('gameOverScreen').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('highscore').textContent = localStorage.getItem('rs_highscore') || 0;
    this.nextWave();
  }

  nextWave() {
    this.wave++;
    document.getElementById('wave').textContent = this.wave;
    const banner = document.getElementById('waveBanner');
    banner.textContent = `גל ${this.wave}`;
    banner.classList.remove('hidden');
    void banner.offsetWidth;
    banner.classList.remove('hidden');
    clearTimeout(this._bannerTO);
    this._bannerTO = setTimeout(() => banner.classList.add('hidden'), 1500);

    const list = [];
    const n = 3 + this.wave * 2;
    for (let i = 0; i < n; i++) {
      let type = 'scout';
      const roll = Math.random();
      if (this.wave >= 2 && roll < 0.3) type = 'gunner';
      if (this.wave >= 3 && roll < 0.15) type = 'heavy';
      list.push(type);
    }
    if (this.wave % 5 === 0) list.push('boss');
    this.shuffle(list);
    this.spawnQueue = list;
    this.spawnTimer = 0.6;
    this.waveActive = true;
  }

  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  spawnPos() {
    const side = (Math.random() * 4) | 0;
    const pad = 30;
    if (side === 0) return { x: rand(pad, this.W - pad), y: pad };
    if (side === 1) return { x: this.W - pad, y: rand(pad, this.H - pad) };
    if (side === 2) return { x: rand(pad, this.W - pad), y: this.H - pad };
    return { x: pad, y: rand(pad, this.H - pad) };
  }

  onEnemyKilled(enemy) {
    this.score += enemy.def.score;
    document.getElementById('score').textContent = this.score;
    if (Math.random() < 0.18) {
      const type = pick(['health', 'overdrive', 'shield']);
      this.powerups.push(new PowerUp(enemy.x, enemy.y, type));
    }
  }

  update(dt) {
    if (this.state !== 'playing') return;

    this.player.update(dt, this);
    if (!this.player.alive) { this.onGameOver(); return; }

    // spawn queue
    if (this.spawnQueue.length > 0) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnTimer = 0.55;
        const type = this.spawnQueue.shift();
        const pos = this.spawnPos();
        this.enemies.push(new Enemy(pos.x, pos.y, type));
      }
    } else if (this.waveActive && this.enemies.length === 0) {
      this.waveActive = false;
      this.score += 50 * this.wave;
      document.getElementById('score').textContent = this.score;
      setTimeout(() => { if (this.state === 'playing') this.nextWave(); }, 1400);
    }

    for (const e of this.enemies) e.update(dt, this);
    this.enemies = this.enemies.filter(e => !e.dead);

    for (const b of this.bullets) b.update(dt, this);

    // bullet collisions
    for (const b of this.bullets) {
      if (b.dead) continue;
      if (b.owner === 'player') {
        for (const e of this.enemies) {
          if (e.dead) continue;
          if (dist(b.x, b.y, e.x, e.y) < b.r + e.r) {
            e.takeDamage(b.dmg, this);
            const knock = 90;
            e.knockX += Math.cos(Math.atan2(e.y - b.y, e.x - b.x)) * knock;
            e.knockY += Math.sin(Math.atan2(e.y - b.y, e.x - b.x)) * knock;
            b.dead = true;
            break;
          }
        }
      } else if (b.owner === 'enemy') {
        const p = this.player;
        if (dist(b.x, b.y, p.x, p.y) < b.r + p.r) {
          p.takeDamage(b.dmg, this);
          b.dead = true;
        }
      }
    }
    this.bullets = this.bullets.filter(b => !b.dead);

    for (const pu of this.powerups) pu.update(dt);
    for (const pu of this.powerups) {
      if (pu.dead) continue;
      if (dist(pu.x, pu.y, this.player.x, this.player.y) < pu.r + this.player.r) {
        this.applyPowerup(pu.type);
        pu.dead = true;
      }
    }
    this.powerups = this.powerups.filter(p => !p.dead);

    for (const pt of this.particles) pt.update(dt);
    this.particles = this.particles.filter(p => p.life > 0);

    this.shake = Math.max(0, this.shake - dt * 40);

    this.updateHUD();
  }

  applyPowerup(type) {
    Audio_.powerup();
    if (type === 'health') this.player.health = Math.min(this.player.maxHealth, this.player.health + 34);
    if (type === 'overdrive') this.player.overdriveTimer = 6;
    if (type === 'shield') this.player.shieldTimer = 5;
    burst(this, this.player.x, this.player.y, POWERUP_TYPES[type].color, 16, 150, 0.4);
  }

  updateHUD() {
    document.getElementById('healthFill').style.width = clamp(this.player.health / this.player.maxHealth, 0, 1) * 100 + '%';
    document.getElementById('heatFill').style.width = clamp(this.player.heat / this.player.maxHeat, 0, 1) * 100 + '%';
    const dashPct = 1 - clamp(this.player.dashTimer / this.player.dashCooldown, 0, 1);
    document.getElementById('dashFill').style.width = dashPct * 100 + '%';
    document.getElementById('overheatWarning').classList.toggle('hidden', !this.player.overheated);
  }

  onGameOver() {
    this.state = 'gameover';
    Audio_.gameOver();
    const hs = Math.max(this.score, Number(localStorage.getItem('rs_highscore') || 0));
    localStorage.setItem('rs_highscore', hs);
    document.getElementById('finalStats').textContent = `ניקוד: ${this.score}   |   גל: ${this.wave}   |   שיא: ${hs}`;
    document.getElementById('gameOverScreen').classList.remove('hidden');
    document.getElementById('hud').classList.add('hidden');
  }

  draw() {
    const ctx = this.ctx;
    ctx.save();
    ctx.clearRect(0, 0, this.W, this.H);

    if (this.shake > 0.1) {
      ctx.translate(rand(-this.shake, this.shake), rand(-this.shake, this.shake));
    }

    // background grid
    ctx.fillStyle = '#070b0f';
    ctx.fillRect(-30, -30, this.W + 60, this.H + 60);
    ctx.strokeStyle = 'rgba(79,243,255,0.06)';
    ctx.lineWidth = 1;
    const grid = 40;
    for (let x = 0; x <= this.W; x += grid) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this.H); ctx.stroke();
    }
    for (let y = 0; y <= this.H; y += grid) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.W, y); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(79,243,255,0.35)';
    ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, this.W - 4, this.H - 4);

    for (const o of this.obstacles) o.draw(ctx);
    for (const pu of this.powerups) pu.draw(ctx);
    for (const pt of this.particles) pt.draw(ctx);
    for (const e of this.enemies) e.draw(ctx);
    for (const b of this.bullets) b.draw(ctx);
    if (this.player.alive) this.player.draw(ctx);

    ctx.restore();
  }

  loop(now) {
    const dt = Math.min(0.033, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.update(dt);
    this.draw();
    requestAnimationFrame(this.loop.bind(this));
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('game');
  new Game(canvas);
});
