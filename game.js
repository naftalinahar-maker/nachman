'use strict';

/* ============================================================
   ROGUE STEEL — top-down arcade robot combat.
   Score-based wave survival with skill-based movement/aim/heat.
   Pick a robot + color in the hangar, choose one upgrade after each wave.
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
  missile() { this.tone(260, 0.25, 'triangle', 0.1, 520); this.noise(0.15, 0.06); },
  slash() { this.noise(0.1, 0.1); this.tone(520, 0.1, 'square', 0.06, 180); },
  shockwave() { this.tone(70, 0.5, 'sine', 0.25, 30); this.noise(0.4, 0.18); },
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
// Keyboard-only: arrows move, one key per attack. On-screen attack buttons
// feed the same codes through `virtual` so touch/mouse users can play too.
const Input = {
  keys: new Set(),
  virtual: new Set(),
  init() {
    window.addEventListener('keydown', e => {
      if (isTyping(e)) return;
      this.keys.add(e.code);
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.virtual.clear(); });
    for (const btn of document.querySelectorAll('[data-code]')) {
      const code = btn.dataset.code;
      const release = () => this.virtual.delete(code);
      btn.addEventListener('pointerdown', e => { e.preventDefault(); this.virtual.add(code); });
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointerleave', release);
      btn.addEventListener('pointercancel', release);
    }
  },
  down(code) { return this.keys.has(code) || this.virtual.has(code); },
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

// homing rocket: steers toward the nearest enemy and explodes on impact
class Missile extends Bullet {
  constructor(x, y, angle) {
    super(x, y, angle, 360, 40, 'player', '#ffd447', 6);
    this.angle = angle;
    this.blast = 75;
    this.turnRate = 4.2;
    this.life = 2.6;
  }
  update(dt, game) {
    let target = null, best = Infinity;
    for (const e of game.enemies) {
      const d = dist(this.x, this.y, e.x, e.y);
      if (!e.dead && d < best) { best = d; target = e; }
    }
    if (target) {
      let diff = angleTo(this.x, this.y, target.x, target.y) - this.angle;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.angle += clamp(diff, -this.turnRate * dt, this.turnRate * dt);
    }
    const speed = Math.hypot(this.vx, this.vy) + 260 * dt;
    this.vx = Math.cos(this.angle) * speed;
    this.vy = Math.sin(this.angle) * speed;
    game.particles.push(new Particle(this.x, this.y, rand(-20, 20), rand(-20, 20), 0.35, '#8a8f99', rand(2, 4)));
    super.update(dt, game);
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
    if (this.dead) this.explode(game);
  }
  explode(game) {
    if (this.exploded) return;
    this.exploded = true;
    this.dead = true;
    for (const e of game.enemies) {
      if (e.dead) continue;
      const d = dist(this.x, this.y, e.x, e.y);
      if (d < this.blast + e.r) {
        e.takeDamage(this.dmg * (d < e.r + this.r ? 1 : 0.6), game);
        const a = angleTo(this.x, this.y, e.x, e.y);
        e.knockX += Math.cos(a) * 260;
        e.knockY += Math.sin(a) * 260;
      }
    }
    Audio_.explosion();
    burst(game, this.x, this.y, '#ffd447', 22, 240, 0.5);
    game.effects.push({ kind: 'ring', x: this.x, y: this.y, r0: 10, r1: this.blast, life: 0.3, maxLife: 0.3, color: '255,212,71' });
    game.shake = Math.min(18, game.shake + 6);
  }
  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    ctx.fillStyle = '#ffd447';
    ctx.shadowColor = '#ffd447';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(-6, 5);
    ctx.lineTo(-6, -5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ff8f3d';
    ctx.fillRect(-10, -2, 4, 4);
    ctx.restore();
  }
}

// one entry per attack: key, cooldown (seconds), HUD element id
const ATTACKS = {
  laser:   { code: 'KeyZ' },
  missile: { code: 'KeyX', cooldown: 1.1 },
  melee:   { code: 'KeyC', cooldown: 0.55 },
  shock:   { code: 'KeyV', cooldown: 7 },
};

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
  constructor(x, y, robotKey, color, look) {
    const def = ROBOTS[robotKey] || ROBOTS.warrior;
    this.hat = (look && look.hat) || 'none';
    this.trail = (look && look.trail) || 'none';
    this.trailTimer = 0;
    this.def = def;
    this.shape = def.shape;
    this.color = color || '#4ff3ff';
    this.rgb = hexToRgb(this.color);
    this.x = x; this.y = y; this.r = def.r;
    this.angle = 0;
    this.speed = def.speed;
    this.maxHealth = def.hp; this.health = def.hp;
    this.maxHeat = 100; this.heat = 0;
    this.overheated = false;
    this.fireRate = 0.09; this.fireTimer = 0;
    this.heatPerShot = 9;
    this.heatDecay = 38;
    this.overheatDecay = 22;
    this.laserDmg = def.laserDmg;
    this.missileCount = 1;
    this.missileCd = ATTACKS.missile.cooldown;
    this.meleeCd = ATTACKS.melee.cooldown;
    this.meleeRange = 58; this.meleeDmg = 32;
    this.shockCd = ATTACKS.shock.cooldown;
    this.shockRadius = 170;
    this.upgrades = {};
    this.dashCooldown = def.dashCd; this.dashTimer = 0;
    this.dashDuration = 0.18; this.dashing = 0;
    this.dashSpeed = 720;
    this.cooldowns = { missile: 0, melee: 0, shock: 0 };
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
    if (Input.down('ArrowUp')) my -= 1;
    if (Input.down('ArrowDown')) my += 1;
    if (Input.down('ArrowLeft')) mx -= 1;
    if (Input.down('ArrowRight')) mx += 1;
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
      burst(game, this.x, this.y, this.color, 14, 200, 0.4);
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

    // trail bought in the hangar: little particles behind the robot while it moves
    this.trailTimer -= dt;
    if (this.trail !== 'none' && mlen > 0 && this.trailTimer <= 0) {
      this.trailTimer = 0.03;
      const bx = this.x - Math.cos(this.angle) * this.r * 0.8, by = this.y - Math.sin(this.angle) * this.r * 0.8;
      game.particles.push(new Particle(bx + rand(-4, 4), by + rand(-4, 4), rand(-25, 25), rand(-25, 25),
        this.trail === 'fire' ? 0.45 : 0.6, Shop.trailColor(this.trail, this.color), this.trail === 'fire' ? rand(3, 5) : rand(2, 3.5)));
    }

    // facing follows movement; attacks get a gentle aim-assist inside a cone
    if (mlen > 0 && this.dashing <= 0) {
      let diff = Math.atan2(my, mx) - this.angle;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.angle += clamp(diff, -12 * dt, 12 * dt);
    }
    const aim = this.aimAngle(game);

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
    if (Input.down(ATTACKS.laser.code) && !this.overheated) {
      if (this.fireTimer <= 0) {
        this.fireTimer = this.effectiveFireRate;
        this._firing = true;
        this.heat = Math.min(this.maxHeat, this.heat + this.effectiveHeatPerShot);
        if (this.heat >= this.maxHeat) { this.overheated = true; Audio_.overheat(); }
        const spread = rand(-0.03, 0.03);
        game.bullets.push(new Bullet(
          this.x + Math.cos(aim) * 22,
          this.y + Math.sin(aim) * 22,
          aim + spread, 620, this.laserDmg + (this.overdriveTimer > 0 ? 3 : 0), 'player', this.color, 4
        ));
        Audio_.shoot();
        burst(game, this.x + Math.cos(aim) * 22, this.y + Math.sin(aim) * 22, '#bff9ff', 3, 80, 0.15);
      }
    }

    for (const k in this.cooldowns) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);

    if (Input.down(ATTACKS.missile.code) && this.cooldowns.missile <= 0) {
      this.cooldowns.missile = this.missileCd;
      for (let i = 0; i < this.missileCount; i++) {
        const off = (i - (this.missileCount - 1) / 2) * 0.35;
        game.bullets.push(new Missile(this.x + Math.cos(aim) * 22, this.y + Math.sin(aim) * 22, aim + off));
      }
      Audio_.missile();
    }

    if (Input.down(ATTACKS.melee.code) && this.cooldowns.melee <= 0) {
      this.cooldowns.melee = this.meleeCd;
      this.meleeAttack(game);
    }

    if (Input.down(ATTACKS.shock.code) && this.cooldowns.shock <= 0) {
      this.cooldowns.shock = this.shockCd;
      this.shockwave(game);
    }

    this.invuln = Math.max(0, this.invuln - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.overdriveTimer = Math.max(0, this.overdriveTimer - dt);
    this.shieldTimer = Math.max(0, this.shieldTimer - dt);
  }

  // snap toward the closest enemy within ~35° of facing, else shoot straight ahead
  aimAngle(game) {
    let best = null, bestD = Infinity;
    for (const e of game.enemies) {
      if (e.dead) continue;
      const a = angleTo(this.x, this.y, e.x, e.y);
      let diff = a - this.angle;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      const d = dist(this.x, this.y, e.x, e.y);
      if (Math.abs(diff) < 0.6 && d < 600 && d < bestD) { bestD = d; best = a; }
    }
    return best ?? this.angle;
  }

  // plasma blade: wide arc in front of the robot, heavy damage and knockback
  meleeAttack(game) {
    const range = this.r + this.meleeRange, halfArc = 1.15;
    for (const e of game.enemies) {
      if (e.dead) continue;
      const d = dist(this.x, this.y, e.x, e.y);
      if (d > range + e.r) continue;
      let diff = angleTo(this.x, this.y, e.x, e.y) - this.angle;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      if (Math.abs(diff) > halfArc && d > this.r + e.r) continue;
      e.takeDamage(this.meleeDmg + (this.overdriveTimer > 0 ? 10 : 0), game);
      const a = angleTo(this.x, this.y, e.x, e.y);
      e.knockX += Math.cos(a) * 520;
      e.knockY += Math.sin(a) * 520;
    }
    // the blade also cuts enemy bullets out of the air
    for (const b of game.bullets) {
      if (b.owner !== 'enemy') continue;
      let diff = angleTo(this.x, this.y, b.x, b.y) - this.angle;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      if (dist(this.x, this.y, b.x, b.y) < range && Math.abs(diff) < halfArc) b.dead = true;
    }
    game.effects.push({ kind: 'slash', x: this.x, y: this.y, angle: this.angle, range, halfArc, life: 0.16, maxLife: 0.16 });
    Audio_.slash();
  }

  // shockwave: hits everything around the robot and erases nearby enemy bullets
  shockwave(game) {
    const radius = this.shockRadius;
    for (const e of game.enemies) {
      if (e.dead) continue;
      const d = dist(this.x, this.y, e.x, e.y);
      if (d > radius + e.r) continue;
      e.takeDamage(22, game);
      const a = angleTo(this.x, this.y, e.x, e.y);
      e.knockX += Math.cos(a) * 700;
      e.knockY += Math.sin(a) * 700;
    }
    for (const b of game.bullets) {
      if (b.owner === 'enemy' && dist(this.x, this.y, b.x, b.y) < radius) b.dead = true;
    }
    this.invuln = Math.max(this.invuln, 0.3);
    game.effects.push({ kind: 'ring', x: this.x, y: this.y, r0: this.r, r1: radius, life: 0.4, maxLife: 0.4, color: this.rgb });
    game.shake = Math.min(20, game.shake + 10);
    Audio_.shockwave();
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
      ctx.strokeStyle = `rgba(${this.rgb},0.7)`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, this.r + 8, 0, TAU);
      ctx.stroke();
    }
    if (this.invuln > 0 && this.dashing <= 0) {
      ctx.globalAlpha = 0.5 + 0.3 * Math.sin(performance.now() / 30);
    }

    ctx.rotate(this.angle);
    this.drawBody(ctx);
    ctx.restore();
  }
}

// shared by the arena and the hangar preview
function drawRobotBody(ctx, shape, r, color, opts) {
  const o = opts || {};
  const stroke = o.hitFlash ? '#ff8f80' : color;
  ctx.lineWidth = 2.5;
  ctx.fillStyle = '#132028';
  ctx.strokeStyle = stroke;

  if (shape === 'block') {
    // treads
    ctx.fillStyle = '#0c1419';
    ctx.fillRect(-r * 0.95, -r * 0.95, r * 1.7, r * 0.42);
    ctx.fillRect(-r * 0.95, r * 0.53, r * 1.7, r * 0.42);
    ctx.strokeRect(-r * 0.95, -r * 0.95, r * 1.7, r * 0.42);
    ctx.strokeRect(-r * 0.95, r * 0.53, r * 1.7, r * 0.42);
    ctx.fillStyle = '#132028';
    ctx.beginPath();
    ctx.rect(-r * 0.75, -r * 0.6, r * 1.4, r * 1.2);
    ctx.fill(); ctx.stroke();
  } else if (shape === 'dart') {
    ctx.beginPath();
    ctx.moveTo(r * 1.15, 0);
    ctx.lineTo(-r * 0.6, r * 0.95);
    ctx.lineTo(-r * 0.25, 0);
    ctx.lineTo(-r * 0.6, -r * 0.95);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(r * 0.2, r * 0.8);
    ctx.lineTo(-r * 0.9, r * 0.6);
    ctx.lineTo(-r * 0.9, -r * 0.6);
    ctx.lineTo(r * 0.2, -r * 0.8);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
  }

  // turret barrel
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = o.glow ? 16 : 6;
  const bw = shape === 'block' ? 8 : 6;
  ctx.fillRect(r * 0.1, -bw / 2, r * (shape === 'block' ? 1.0 : 1.1), bw);
  ctx.shadowBlur = 0;

  // core
  ctx.beginPath();
  ctx.fillStyle = o.overheated ? '#ff5b4d' : color;
  ctx.arc(0, 0, shape === 'block' ? 6 : 5, 0, TAU);
  ctx.fill();

  drawHat2D(ctx, o.hat, r, color);
}

Player.prototype.drawBody = function (ctx) {
  drawRobotBody(ctx, this.shape, this.r, this.color, {
    hitFlash: this.hitFlash > 0, glow: this.overdriveTimer > 0, overheated: this.overheated, hat: this.hat,
  });
};

// ---------- enemy types ----------
const ENEMY_DEFS = {
  scout: {
    r: 13, hp: 22, speed: 190, color: '#ff5b4d', score: 60, shape: 'dart',
    contactDmg: 12, behavior: 'charge',
  },
  gunner: {
    r: 15, hp: 34, speed: 110, color: '#ff8f3d', score: 90, shape: 'square',
    contactDmg: 8, behavior: 'ranged', fireRate: 1.3, bulletSpeed: 300, bulletDmg: 8,
  },
  heavy: {
    r: 24, hp: 90, speed: 70, color: '#c23bff', score: 160, shape: 'hex',
    contactDmg: 10, behavior: 'slam', slamRadius: 90, slamDmg: 26, slamCharge: 1.1,
  },
  wasp: {
    r: 12, hp: 18, speed: 230, color: '#ffe14d', score: 80, shape: 'wasp',
    contactDmg: 10, behavior: 'zigzag',
  },
  spreader: {
    r: 16, hp: 40, speed: 90, color: '#ff5fa2', score: 110, shape: 'tri',
    contactDmg: 8, behavior: 'spread', fireRate: 1.7, bulletSpeed: 260, bulletDmg: 7,
  },
  splitter: {
    r: 20, hp: 55, speed: 105, color: '#9dff4d', score: 120, shape: 'circle',
    contactDmg: 10, behavior: 'charge', splits: true,
  },
  mini: {
    r: 9, hp: 10, speed: 215, color: '#9dff4d', score: 20, shape: 'dart',
    contactDmg: 6, behavior: 'charge',
  },
  boss: {
    r: 40, hp: 800, speed: 85, color: '#ff2d55', score: 900, shape: 'boss',
    contactDmg: 20, behavior: 'boss', fireRate: 0.5, bulletSpeed: 260, bulletDmg: 10,
  },
};

// built-in enemy, or one made in the enemy builder ('c_<id>')
function enemyDef(type) {
  if (ENEMY_DEFS[type]) return ENEMY_DEFS[type];
  const c = CustomEnemies.get(type);
  return c ? CustomEnemies.toDef(c) : ENEMY_DEFS.scout;
}


class Enemy {
  constructor(x, y, type) {
    const d = enemyDef(type);
    this.type = type;
    this.zig = rand(0, TAU);
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
      if (this.def.splits) {
        for (const s of [-1, 1]) {
          const m = new Enemy(this.x + s * this.r * 0.6, this.y - s * this.r * 0.6, 'mini');
          m.knockX = s * 220; m.knockY = -s * 220;
          game.enemies.push(m);
        }
      }
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
    } else if (this.behavior === 'zigzag') {
      this.zig += dt * 6;
      const za = a + Math.sin(this.zig) * 1.0;
      this.x += Math.cos(za) * this.speed * dt;
      this.y += Math.sin(za) * this.speed * dt;
      this.angle = za;
    } else if (this.behavior === 'ranged' || this.behavior === 'spread') {
      const desired = 260;
      const dir = d < desired - 20 ? -1 : d > desired + 20 ? 1 : 0;
      this.x += Math.cos(a) * dir * this.speed * dt;
      this.y += Math.sin(a) * dir * this.speed * dt;
      this.fireTimer -= dt;
      if (this.fireTimer <= 0 && d < 520) {
        this.fireTimer = this.def.fireRate * rand(0.85, 1.15);
        const angles = this.behavior === 'spread' ? [a - 0.28, a, a + 0.28] : [a];
        for (const sa of angles) game.bullets.push(new Bullet(this.x, this.y, sa, this.def.bulletSpeed, this.def.bulletDmg, 'enemy', this.color, 5));
        Audio_.enemyShoot();
      }
    } else if (this.behavior === 'slam') {
      if (this.slamTelegraph > 0) {
        this.slamTelegraph -= dt;
        if (this.slamTelegraph <= 0) {
          if (d < this.def.slamRadius + this.r) {
            p.takeDamage(this.def.slamDmg, game);
          }
          burst(game, this.x, this.y, this.color, 24, 220, 0.4);
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
      ctx.strokeStyle = `rgba(${hexToRgb(this.color)},${0.8 - t * 0.4})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, this.def.slamRadius * t, 0, TAU);
      ctx.stroke();
    }

    ctx.rotate(this.angle);
    drawEnemyShape2D(ctx, this.def.shape, this.r, this.color, this.hitFlash > 0);

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
    this.state = 'start'; // start | hangar | playing | upgrade | paused | gameover
    const saved = Loadout.load();
    this.robotKey = saved.robot;
    this.colorHex = saved.color;
    this.hat = saved.hat;
    this.trail = saved.trail;
    this.upgradeLog = [];
    this.levelStartLog = [];
    this.reset();
    this.lastTime = performance.now();
    Input.init();
    this.bindUI();
    requestAnimationFrame(this.loop.bind(this));
  }

  reset() {
    this.player = new Player(this.W / 2, this.H / 2, this.robotKey, this.colorHex, { hat: this.hat, trail: this.trail });
    this.levels = Campaign.build();
    this.pointsEarned = 0;
    this.bullets = [];
    this.enemies = [];
    this.particles = [];
    this.effects = [];
    this.powerups = [];
    this.obstacles = this.makeObstacles();
    this.score = 0;
    this.wave = 0;
    this.shake = 0;
    this.spawnQueue = [];
    this.spawnTimer = 0;
    this.waveActive = false;
    this.waveBannerTimer = 0;
    this.upgradeTimer = 0;
    this.upgradeChoices = [];
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
    document.getElementById('startBtn').onclick = () => this.openHangar();
    document.getElementById('restartBtn').onclick = () => this.startGame();
    document.getElementById('retryBtn').onclick = () => this.retryLevel();
    document.getElementById('victoryAgainBtn').onclick = () => this.startGame();
    document.getElementById('victoryHangarBtn').onclick = () => this.openHangar();
    document.getElementById('builderBtnStart').onclick = () => this.openBuilder('startScreen');
    document.getElementById('builderBtnHangar').onclick = () => this.openBuilder('hangarScreen');
    document.getElementById('victoryBuilderBtn').onclick = () => this.openBuilder('victoryScreen');
    Loadout.bindTabs();
    Shop.build(document.getElementById('designPane'),
      () => ({ color: this.colorHex, hat: this.hat, trail: this.trail }),
      patch => this.applyLook(patch));
    document.getElementById('changeRobotBtn').onclick = () => this.openHangar();
    document.getElementById('battleBtn').onclick = () => this.startGame();
    this.buildHangar();
    document.getElementById('resumeBtn').onclick = () => this.togglePause(false);
    window.addEventListener('keydown', e => {
      if (this.state === 'builder') { if (e.code === 'Escape') Builder.close(); return; }
      if (isTyping(e)) return;
      if (e.code === 'KeyP' || e.code === 'Escape') {
        if (this.state === 'playing') this.togglePause(true);
        else if (this.state === 'paused') this.togglePause(false);
      }
      if (e.code === 'Enter') {
        if (this.state === 'start') this.openHangar();
        else if (this.state === 'hangar' || this.state === 'victory') this.startGame();
        else if (this.state === 'gameover') this.retryLevel();
      }
      const num = Loadout.numKey(e.code);
      if (this.state === 'hangar') {
        const pick = Loadout.hangarKey(e.code, this.robotKey, this.colorHex);
        if (pick && pick.robot) this.selectRobot(pick.robot);
        if (pick && pick.color) this.selectColor(pick.color);
      } else if (this.state === 'upgrade' && num !== undefined && this.upgradeChoices[num]) {
        this.chooseUpgrade(this.upgradeChoices[num]);
      }
    });
  }

  // ---------- hangar: pick robot + color ----------
  buildHangar() {
    this.previews = Loadout.buildHangar(k => this.selectRobot(k), c => this.selectColor(c), true);
    this.refreshHangar();
  }

  selectRobot(key) { this.robotKey = key; Audio_.powerup(); this.saveLoadout(); this.refreshHangar(); }
  selectColor(hex) { this.colorHex = hex; Audio_.tone(700, 0.08, 'triangle', 0.08, 1000); this.saveLoadout(); this.refreshHangar(); }

  saveLoadout() { Loadout.save({ robot: this.robotKey, color: this.colorHex, hat: this.hat, trail: this.trail }); }

  // something from the "design with points" tab was bought or picked
  applyLook(patch) {
    if (patch.color) this.colorHex = patch.color;
    if (patch.hat) this.hat = patch.hat;
    if (patch.trail) this.trail = patch.trail;
    Audio_.powerup();
    this.saveLoadout();
    this.refreshHangar();
  }

  refreshHangar() {
    Loadout.refreshHangar(this.robotKey, this.colorHex);
    Shop.refresh();
    this.drawPreviews(performance.now());
  }

  drawPreviews(now) {
    for (const key of ROBOT_ORDER) {
      const cv = this.previews[key];
      const c = cv.getContext('2d');
      c.clearRect(0, 0, cv.width, cv.height);
      const selected = key === this.robotKey;
      const color = selected ? this.colorHex : '#6f8790';
      c.save();
      c.translate(cv.width / 2, cv.height / 2);
      c.scale(3.2, 3.2);
      c.rotate(-Math.PI / 2 + (selected ? Math.sin(now / 600) * 0.5 : 0));
      drawRobotBody(c, ROBOTS[key].shape, ROBOTS[key].r, color, { glow: selected, hat: selected ? this.hat : 'none' });
      c.restore();
    }
  }

  openHangar() {
    this.state = 'hangar';
    for (const id of ['startScreen', 'gameOverScreen', 'victoryScreen']) document.getElementById(id).classList.add('hidden');
    document.getElementById('hud').classList.add('hidden');
    document.getElementById('hangarScreen').classList.remove('hidden');
    this.refreshHangar();
  }

  // ---------- enemy builder: opens over a menu screen and returns to it ----------
  openBuilder(fromId) {
    const prev = this.state;
    this.state = 'builder';
    document.getElementById(fromId).classList.add('hidden');
    Builder.open(() => {
      this.state = prev;
      document.getElementById(fromId).classList.remove('hidden');
      this.levels = Campaign.build();
      if (prev === 'hangar') this.refreshHangar();
    });
  }

  // ---------- upgrades between waves ----------
  showUpgrades() {
    this.upgradeChoices = Loadout.rollUpgrades(this.player);
    this.state = 'upgrade';
    Input.keys.clear(); Input.virtual.clear();
    Loadout.showUpgradeScreen(this.wave, this.upgradeChoices, this.player, u => this.chooseUpgrade(u));
    Audio_.tone(440, 0.15, 'triangle', 0.1, 880);
  }

  chooseUpgrade(u) {
    if (this.state !== 'upgrade') return;
    const p = this.player;
    Loadout.applyUpgrade(p, u);
    this.upgradeLog.push(u.id);
    Audio_.powerup();
    burst(this, p.x, p.y, p.color, 24, 180, 0.5);
    this.state = 'playing';
    this.lastTime = performance.now();
    this.nextWave();
  }

  togglePause(pause) {
    if (pause) { this.state = 'paused'; document.getElementById('pauseScreen').classList.remove('hidden'); }
    else { this.state = 'playing'; document.getElementById('pauseScreen').classList.add('hidden'); }
  }

  // fromLevel/log let "try this level again" rebuild the robot with the upgrades it had then
  startGame(fromLevel, log) {
    this.reset();
    this.upgradeLog = (log || []).slice();
    const p = this.player;
    for (const id of this.upgradeLog) {
      const u = UPGRADES.find(x => x.id === id);
      if (u) { u.apply(p); p.upgrades[id] = (p.upgrades[id] || 0) + 1; }
    }
    p.health = p.maxHealth;
    this.wave = (fromLevel || 1) - 1;
    this.state = 'playing';
    for (const id of ['startScreen', 'gameOverScreen', 'hangarScreen', 'upgradeScreen', 'victoryScreen']) document.getElementById(id).classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('highscore').textContent = localStorage.getItem('rs_highscore') || 0;
    document.getElementById('score').textContent = 0;
    Points.refresh();
    this.nextWave();
  }

  retryLevel() { this.startGame(Math.min(this.wave, this.levels.length), this.levelStartLog); }

  get level() { return this.levels[this.wave - 1]; }

  nextWave() {
    this.wave++;
    this.levelStartLog = this.upgradeLog.slice();
    document.getElementById('wave').textContent = `${this.wave}/${this.levels.length}`;
    Campaign.showIntro(this.wave, this.levels.length, this.level.type);
    this.spawnQueue = Campaign.spawnList(this.level);
    this.spawnTimer = 2.2; // let the "new enemy" card show first
    this.waveActive = true;
  }

  earn(n) {
    n = Math.round(n);
    this.pointsEarned += n;
    Points.add(n);
  }

  onVictory() {
    this.state = 'victory';
    Campaign.hideIntro();
    this.earn(300);
    Audio_.tone(523, 0.18, 'triangle', 0.15, 784);
    setTimeout(() => Audio_.tone(784, 0.3, 'triangle', 0.15, 1046), 180);
    const hs = Math.max(this.score, Number(localStorage.getItem('rs_highscore') || 0));
    localStorage.setItem('rs_highscore', hs);
    document.getElementById('victoryStats').textContent = `ניקוד: ${this.score}   |   הרווחת ${this.pointsEarned} נקודות 💰 (כולל 300 בונוס ניצחון)`;
    document.getElementById('victoryScreen').classList.remove('hidden');
    document.getElementById('hud').classList.add('hidden');
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
    this.earn(enemy.def.score / 10);
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
      this.earn(5 * this.wave);
      this.upgradeTimer = 1.2; // short breather, then the upgrade screen (or the win screen)
    } else if (this.upgradeTimer > 0) {
      this.upgradeTimer -= dt;
      if (this.upgradeTimer <= 0) {
        this.upgradeTimer = 0;
        if (this.level.final) this.onVictory(); else this.showUpgrades();
        return;
      }
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
            if (b instanceof Missile) { b.explode(this); break; }
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

    for (const fx of this.effects) fx.life -= dt;
    this.effects = this.effects.filter(fx => fx.life > 0);

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
    const p = this.player;
    this.setSlot('slotLaser', p.overheated ? 1 : 0, p.overheated);
    this.setSlot('slotMissile', p.cooldowns.missile / p.missileCd);
    this.setSlot('slotMelee', p.cooldowns.melee / p.meleeCd);
    this.setSlot('slotShock', p.cooldowns.shock / p.shockCd);
    this.setSlot('slotDash', p.dashTimer / p.dashCooldown);
  }

  // fill a HUD attack slot's cooldown shade (0 = ready, 1 = just used)
  setSlot(id, frac, blocked) {
    const el = document.getElementById(id);
    el.querySelector('.cd').style.height = clamp(frac, 0, 1) * 100 + '%';
    el.classList.toggle('ready', frac <= 0 && !blocked);
  }

  onGameOver() {
    this.state = 'gameover';
    Audio_.gameOver();
    const hs = Math.max(this.score, Number(localStorage.getItem('rs_highscore') || 0));
    localStorage.setItem('rs_highscore', hs);
    Campaign.hideIntro();
    document.getElementById('finalStats').textContent = `הגעת לשלב ${this.wave} מתוך ${this.levels.length}   |   ניקוד: ${this.score}   |   הרווחת ${this.pointsEarned} נקודות 💰`;
    document.getElementById('retryBtn').textContent = `נסה שוב את שלב ${this.wave}`;
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
    for (const fx of this.effects) this.drawEffect(ctx, fx);
    for (const b of this.bullets) b.draw(ctx);
    if (this.player.alive) this.player.draw(ctx);

    ctx.restore();
  }

  drawEffect(ctx, fx) {
    const t = 1 - fx.life / fx.maxLife;
    ctx.save();
    if (fx.kind === 'ring') {
      ctx.strokeStyle = `rgba(${fx.color},${1 - t})`;
      ctx.lineWidth = 6 * (1 - t) + 1;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, lerp(fx.r0, fx.r1, t), 0, TAU);
      ctx.stroke();
    } else if (fx.kind === 'slash') {
      ctx.translate(fx.x, fx.y);
      ctx.rotate(fx.angle);
      ctx.fillStyle = `rgba(255,120,240,${0.55 * (1 - t)})`;
      ctx.shadowColor = '#ff78f0';
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(0, 0, fx.range, -fx.halfArc, fx.halfArc);
      ctx.arc(0, 0, fx.range * 0.45, fx.halfArc, -fx.halfArc, true);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  loop(now) {
    const dt = Math.min(0.033, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.update(dt);
    this.draw();
    if (this.state === 'hangar') this.drawPreviews(now);
    requestAnimationFrame(this.loop.bind(this));
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('game');
  window.game = new Game(canvas);
});
