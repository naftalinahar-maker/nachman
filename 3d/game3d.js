'use strict';

/* ============================================================
   ROGUE STEEL 3D — the robot-battle arena rendered with Three.js.
   Gameplay runs on the XZ ground plane (same rules as the 2D game);
   Three.js only draws it. Arrows move, one key per attack, Esc pauses.
   ============================================================ */

// ---------- utility ----------
const TAU = Math.PI * 2;
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function rand(a, b) { return a + Math.random() * (b - a); }
function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }
function dist(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }
// angle convention: direction (sin a, cos a) on (x, z), so mesh.rotation.y = a faces it
function angleTo(ax, az, bx, bz) { return Math.atan2(bx - ax, bz - az); }
function angleDiff(a, b) { const d = b - a; return Math.atan2(Math.sin(d), Math.cos(d)); }
function lerp(a, b, t) { return a + (b - a) * t; }

function circleRectCollide(cx, cz, cr, o) {
  const nx = clamp(cx, o.x, o.x + o.w);
  const nz = clamp(cz, o.z, o.z + o.d);
  const dx = cx - nx, dz = cz - nz;
  return dx * dx + dz * dz < cr * cr;
}

function resolveCircleRect(e, o) {
  const nx = clamp(e.x, o.x, o.x + o.w);
  const nz = clamp(e.z, o.z, o.z + o.d);
  let dx = e.x - nx, dz = e.z - nz;
  let d = Math.hypot(dx, dz);
  if (d === 0) { dx = 1; dz = 0; d = 1; }
  if (d < e.r) {
    e.x += (dx / d) * (e.r - d);
    e.z += (dz / d) * (e.r - d);
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
  block() { this.tone(1100, 0.06, 'square', 0.05, 1500); },
  sniperCharge() { this.tone(300, 1.2, 'sine', 0.05, 1400); },
  sniperShot() { this.tone(1400, 0.2, 'sawtooth', 0.09, 200); },
  blink() { this.tone(900, 0.15, 'triangle', 0.08, 250); },
  fuse() { this.tone(1200, 0.05, 'square', 0.05); },
  explosion() { this.noise(0.35, 0.28); this.tone(90, 0.3, 'sine', 0.15, 30); },
  dash() { this.tone(200, 0.15, 'sine', 0.1, 500); },
  powerup() { this.tone(500, 0.12, 'triangle', 0.12, 900); },
  overheat() { this.tone(140, 0.4, 'sawtooth', 0.1, 60); },
  playerHit() { this.tone(160, 0.18, 'square', 0.14, 70); },
  gameOver() { this.tone(220, 0.6, 'sawtooth', 0.15, 40); },
};

// ---------- input ----------
// Keyboard: arrows move, one key per attack. On-screen attack buttons
// feed the same codes through `virtual` so touch/mouse users can play too.
const Input = {
  keys: new Set(),
  virtual: new Set(),
  init() {
    window.addEventListener('keydown', e => {
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

// ---------- shared meshes / materials ----------
const ARENA_W = 60, ARENA_D = 40; // x in [-30, 30], z in [-20, 20]
const HALF_W = ARENA_W / 2, HALF_D = ARENA_D / 2;
const SHOT_Y = 1.9;

const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.SphereGeometry(1, 12, 10),
  spark: new THREE.BoxGeometry(0.18, 0.18, 0.18),
  ring: new THREE.RingGeometry(0.88, 1, 48),
};
const glowMats = new Map();
function glowMat(color) {
  if (!glowMats.has(color)) glowMats.set(color, new THREE.MeshBasicMaterial({ color }));
  return glowMats.get(color);
}
function metal(color, emissive, emissiveIntensity) {
  return new THREE.MeshStandardMaterial({
    color, metalness: 0.6, roughness: 0.4,
    emissive: emissive || 0x000000, emissiveIntensity: emissiveIntensity || 0,
  });
}
function part(geo, mat, sx, sy, sz, x, y, z) {
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

// ---------- particles ----------
class Particle {
  constructor(game, x, y, z, vx, vy, vz, life, color, size) {
    this.vx = vx; this.vy = vy; this.vz = vz;
    this.life = life; this.maxLife = life; this.size = size;
    this.mesh = new THREE.Mesh(GEO.spark, glowMat(color));
    this.mesh.position.set(x, y, z);
    game.scene.add(this.mesh);
  }
  update(dt) {
    const p = this.mesh.position;
    p.x += this.vx * dt; p.y += this.vy * dt; p.z += this.vz * dt;
    this.vy -= 14 * dt;
    if (p.y < 0.1) { p.y = 0.1; this.vy *= -0.4; }
    this.vx *= 0.95; this.vz *= 0.95;
    this.life -= dt;
    const s = this.size * clamp(this.life / this.maxLife, 0, 1);
    this.mesh.scale.set(s, s, s);
    this.mesh.rotation.x += dt * 8;
    return this.life > 0;
  }
}

function burst(game, x, y, z, color, count, speed, life) {
  for (let i = 0; i < count && game.particles.length < 500; i++) {
    const a = rand(0, TAU), s = rand(speed * 0.3, speed);
    game.particles.push(new Particle(game, x, y, z,
      Math.sin(a) * s, rand(1, speed * 0.8), Math.cos(a) * s,
      rand(life * 0.5, life), color, rand(0.8, 1.6)));
  }
}

// ---------- bullets ----------
class Bullet {
  constructor(game, x, z, angle, speed, dmg, owner, color, r) {
    this.x = x; this.z = z;
    this.vx = Math.sin(angle) * speed;
    this.vz = Math.cos(angle) * speed;
    this.dmg = dmg; this.owner = owner;
    this.r = r; this.dead = false;
    this.mesh = new THREE.Mesh(GEO.sphere, glowMat(color));
    this.mesh.scale.set(r, r, r * 2.2);
    this.mesh.rotation.y = angle;
    this.mesh.position.set(x, SHOT_Y, z);
    game.scene.add(this.mesh);
  }
  update(dt, game) {
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    if (Math.abs(this.x) > HALF_W + 2 || Math.abs(this.z) > HALF_D + 2) this.dead = true;
    for (const o of game.obstacles) {
      if (circleRectCollide(this.x, this.z, this.r, o)) { this.dead = true; break; }
    }
    this.mesh.position.set(this.x, SHOT_Y, this.z);
  }
}

// homing rocket: steers toward the nearest enemy and explodes on impact
class Missile extends Bullet {
  constructor(game, x, z, angle) {
    super(game, x, z, angle, 22, 40, 'player', 0xffd447, 0.35);
    game.scene.remove(this.mesh);
    this.mesh = new THREE.Group();
    const body = part(new THREE.ConeGeometry(0.3, 1.1, 8), metal(0xffd447, 0xffd447, 0.6), 1, 1, 1, 0, 0, 0);
    body.rotation.x = Math.PI / 2; // cone tip points along +Z
    this.mesh.add(body);
    this.mesh.add(part(GEO.sphere, glowMat(0xff8f3d), 0.22, 0.22, 0.22, 0, 0, -0.6));
    game.scene.add(this.mesh);
    this.angle = angle;
    this.blast = 4.7;
    this.turnRate = 4.2;
    this.life = 2.6;
  }
  update(dt, game) {
    let target = null, best = Infinity;
    for (const e of game.enemies) {
      const d = dist(this.x, this.z, e.x, e.z);
      if (!e.dead && d < best) { best = d; target = e; }
    }
    if (target) {
      const diff = angleDiff(this.angle, angleTo(this.x, this.z, target.x, target.z));
      this.angle += clamp(diff, -this.turnRate * dt, this.turnRate * dt);
    }
    const speed = Math.hypot(this.vx, this.vz) + 16 * dt;
    this.vx = Math.sin(this.angle) * speed;
    this.vz = Math.cos(this.angle) * speed;
    this.mesh.rotation.y = this.angle;
    if (Math.random() < 0.7) {
      game.particles.push(new Particle(game, this.x, SHOT_Y, this.z, rand(-1, 1), rand(0, 1.5), rand(-1, 1), 0.4, 0x8a8f99, 1.4));
    }
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
      const d = dist(this.x, this.z, e.x, e.z);
      if (d < this.blast + e.r) {
        e.takeDamage(this.dmg * (d < e.r + this.r ? 1 : 0.6), game);
        const a = angleTo(this.x, this.z, e.x, e.z);
        e.knockX += Math.sin(a) * 16;
        e.knockZ += Math.cos(a) * 16;
      }
    }
    Audio_.explosion();
    burst(game, this.x, SHOT_Y, this.z, 0xffd447, 22, 12, 0.6);
    game.addRing(this.x, this.z, 0.6, this.blast, 0.3, 0xffd447);
    game.shake = Math.min(1.2, game.shake + 0.4);
  }
}

// one entry per attack: key and cooldown (seconds)
const ATTACKS = {
  laser:   { code: 'KeyZ' },
  missile: { code: 'KeyX', cooldown: 1.1 },
  melee:   { code: 'KeyC', cooldown: 0.55 },
  shock:   { code: 'KeyV', cooldown: 7 },
};

// ---------- power-ups ----------
const POWERUP_TYPES = {
  health: { color: 0x4fe07d },
  overdrive: { color: 0xffd447 },
  shield: { color: 0x4ff3ff },
};

class PowerUp {
  constructor(game, x, z, type) {
    this.x = x; this.z = z; this.type = type; this.r = 0.9;
    this.life = 9; this.bob = rand(0, TAU); this.dead = false;
    const color = POWERUP_TYPES[type].color;
    this.mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.6), metal(color, color, 0.8));
    this.mesh.castShadow = true;
    game.scene.add(this.mesh);
  }
  update(dt) {
    this.life -= dt;
    this.bob += dt * 4;
    this.mesh.position.set(this.x, 1 + Math.sin(this.bob) * 0.25, this.z);
    this.mesh.rotation.y += dt * 2;
    this.mesh.visible = this.life > 3 || Math.sin(this.life * 20) > -0.3;
    if (this.life <= 0) this.dead = true;
  }
}

// ---------- robot model ----------
// Builds a walking biped: legs swing from the hips, the right arm is the gun.
function makeRobot(bodyColor, glowColor, scale) {
  const root = new THREE.Group();
  const rig = new THREE.Group();
  rig.scale.setScalar(scale);
  root.add(rig);
  const armor = metal(bodyColor);
  const dark = metal(0x1b232a);
  const glow = metal(glowColor, glowColor, 1.2);

  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.38, 1.05, 0);
    hip.add(part(GEO.box, dark, 0.32, 0.6, 0.32, 0, -0.3, 0));
    hip.add(part(GEO.box, armor, 0.38, 0.5, 0.42, 0, -0.75, 0.02));
    hip.add(part(GEO.box, dark, 0.44, 0.14, 0.6, 0, -1.0, 0.08));
    rig.add(hip);
    legs.push(hip);
  }
  const torso = new THREE.Group();
  torso.position.y = 1.1;
  torso.add(part(GEO.box, armor, 1.25, 0.95, 0.8, 0, 0.55, 0));
  torso.add(part(GEO.box, dark, 0.9, 0.3, 0.7, 0, 0.0, 0));
  torso.add(part(GEO.sphere, glow, 0.16, 0.16, 0.08, 0, 0.6, 0.41));
  // head with visor
  torso.add(part(GEO.box, armor, 0.55, 0.42, 0.55, 0, 1.25, 0));
  torso.add(part(GEO.box, glow, 0.45, 0.1, 0.05, 0, 1.28, 0.28));
  // shoulders + arms (right arm carries the cannon)
  for (const side of [-1, 1]) {
    torso.add(part(GEO.box, armor, 0.4, 0.4, 0.5, side * 0.8, 0.85, 0));
    torso.add(part(GEO.box, dark, 0.26, 0.7, 0.26, side * 0.8, 0.35, 0.05));
  }
  const cannon = part(new THREE.CylinderGeometry(0.12, 0.16, 0.9, 10), dark, 1, 1, 1, 0.8, 0.05, 0.45);
  cannon.rotation.x = Math.PI / 2;
  torso.add(cannon);
  torso.add(part(GEO.sphere, glow, 0.1, 0.1, 0.1, 0.8, 0.05, 0.92));
  // plasma blade on the left arm, visible only while slashing
  const blade = part(GEO.box, metal(0xff78f0, 0xff78f0, 1.5), 0.08, 0.08, 1.6, -0.8, 0.05, 0.8);
  blade.visible = false;
  torso.add(blade);
  rig.add(torso);

  return { root, rig, legs, torso, blade, glow, armor };
}

// ---------- obstacles ----------
class Obstacle {
  constructor(game, x, z, w, d) {
    this.x = x; this.z = z; this.w = w; this.d = d;
    const h = rand(2.5, 4);
    const m = new THREE.Mesh(GEO.box, metal(0x1b232a));
    m.scale.set(w, h, d);
    m.position.set(x + w / 2, h / 2, z + d / 2);
    m.castShadow = m.receiveShadow = true;
    game.scene.add(m);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(GEO.box), new THREE.LineBasicMaterial({ color: 0x4ff3ff, transparent: true, opacity: 0.45 }));
    edge.scale.copy(m.scale);
    edge.position.copy(m.position);
    game.scene.add(edge);
    this.meshes = [m, edge];
  }
}

// ---------- player ----------
class Player {
  constructor(game) {
    this.x = 0; this.z = 0; this.r = 1.0;
    this.angle = Math.PI; // face away from the camera
    this.speed = 15;
    this.maxHealth = 100; this.health = 100;
    this.maxHeat = 100; this.heat = 0;
    this.overheated = false;
    this.fireRate = 0.09; this.fireTimer = 0;
    this.heatPerShot = 9;
    this.heatDecay = 38;
    this.overheatDecay = 22;
    this.dashCooldown = 1.4; this.dashTimer = 0;
    this.dashDuration = 0.18; this.dashing = 0;
    this.dashSpeed = 45;
    this.dashDx = 0; this.dashDz = -1;
    this.cooldowns = { missile: 0, melee: 0, shock: 0 };
    this.invuln = 0;
    this.hitFlash = 0;
    this.overdriveTimer = 0;
    this.shieldTimer = 0;
    this.slashTimer = 0;
    this.walk = 0;
    this.alive = true;

    this.model = makeRobot(0xdff7ff, 0x4ff3ff, 1.3);
    game.scene.add(this.model.root);
    this.shieldMesh = new THREE.Mesh(GEO.sphere, new THREE.MeshBasicMaterial({ color: 0x4ff3ff, transparent: true, opacity: 0.18, depthWrite: false }));
    this.shieldMesh.scale.setScalar(1.8);
    this.shieldMesh.position.y = 1.4;
    this.model.root.add(this.shieldMesh);
  }

  get effectiveFireRate() { return this.overdriveTimer > 0 ? this.fireRate * 0.45 : this.fireRate; }
  get effectiveHeatPerShot() { return this.overdriveTimer > 0 ? this.heatPerShot * 0.4 : this.heatPerShot; }

  update(dt, game) {
    // movement: up = away from the camera (-z)
    let mx = 0, mz = 0;
    if (Input.down('ArrowUp')) mz -= 1;
    if (Input.down('ArrowDown')) mz += 1;
    if (Input.down('ArrowLeft')) mx -= 1;
    if (Input.down('ArrowRight')) mx += 1;
    const mlen = Math.hypot(mx, mz);
    if (mlen > 0) { mx /= mlen; mz /= mlen; }

    this.dashTimer = Math.max(0, this.dashTimer - dt);
    if (this.dashing > 0) {
      this.dashing -= dt;
      this.invuln = Math.max(this.invuln, 0.05);
    } else if ((Input.down('ShiftLeft') || Input.down('ShiftRight')) && this.dashTimer <= 0 && mlen > 0) {
      this.dashing = this.dashDuration;
      this.dashTimer = this.dashCooldown;
      this.invuln = this.dashDuration + 0.1;
      Audio_.dash();
      burst(game, this.x, 1, this.z, 0x4ff3ff, 14, 10, 0.4);
    }

    if (this.dashing > 0) {
      this.x += this.dashDx * this.dashSpeed * dt;
      this.z += this.dashDz * this.dashSpeed * dt;
    } else {
      if (mlen > 0) { this.dashDx = mx; this.dashDz = mz; }
      this.x += mx * this.speed * dt;
      this.z += mz * this.speed * dt;
    }
    this.x = clamp(this.x, -HALF_W + this.r, HALF_W - this.r);
    this.z = clamp(this.z, -HALF_D + this.r, HALF_D - this.r);
    for (const o of game.obstacles) resolveCircleRect(this, o);

    // facing follows movement; attacks get a gentle aim-assist inside a cone
    if (mlen > 0 && this.dashing <= 0) {
      const diff = angleDiff(this.angle, Math.atan2(mx, mz));
      this.angle += clamp(diff, -12 * dt, 12 * dt);
    }
    this.walk += dt * (mlen > 0 ? 11 : 0);
    const aim = this.aimAngle(game);

    // heat
    if (this.overheated) {
      this.heat -= this.overheatDecay * dt;
      if (this.heat <= 0) { this.heat = 0; this.overheated = false; }
    } else {
      this.heat = Math.max(0, this.heat - this.heatDecay * dt * (this.firing ? 0.15 : 1));
    }

    // laser
    this.fireTimer -= dt;
    this.firing = false;
    if (Input.down(ATTACKS.laser.code) && !this.overheated && this.fireTimer <= 0) {
      this.fireTimer = this.effectiveFireRate;
      this.firing = true;
      this.heat = Math.min(this.maxHeat, this.heat + this.effectiveHeatPerShot);
      if (this.heat >= this.maxHeat) { this.overheated = true; Audio_.overheat(); }
      const mz0 = this.muzzle();
      game.bullets.push(new Bullet(game, mz0.x, mz0.z, aim + rand(-0.03, 0.03), 39,
        12 + (this.overdriveTimer > 0 ? 3 : 0), 'player', 0x4ff3ff, 0.22));
      Audio_.shoot();
    }

    for (const k in this.cooldowns) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);

    if (Input.down(ATTACKS.missile.code) && this.cooldowns.missile <= 0) {
      this.cooldowns.missile = ATTACKS.missile.cooldown;
      game.bullets.push(new Missile(game, this.x + Math.sin(aim) * 1.3, this.z + Math.cos(aim) * 1.3, aim));
      Audio_.missile();
    }
    if (Input.down(ATTACKS.melee.code) && this.cooldowns.melee <= 0) {
      this.cooldowns.melee = ATTACKS.melee.cooldown;
      this.meleeAttack(game);
    }
    if (Input.down(ATTACKS.shock.code) && this.cooldowns.shock <= 0) {
      this.cooldowns.shock = ATTACKS.shock.cooldown;
      this.shockwave(game);
    }

    this.invuln = Math.max(0, this.invuln - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.overdriveTimer = Math.max(0, this.overdriveTimer - dt);
    this.shieldTimer = Math.max(0, this.shieldTimer - dt);
    this.slashTimer = Math.max(0, this.slashTimer - dt);
    this.syncModel();
  }

  // gun barrel tip in world space (the cannon sits on the right arm)
  muzzle() {
    const s = Math.sin(this.angle), c = Math.cos(this.angle);
    return { x: this.x + s * 1.6 + c * 1.0, z: this.z + c * 1.6 - s * 1.0 };
  }

  // snap toward the closest enemy within ~35° of facing, else shoot straight ahead
  aimAngle(game) {
    let best = null, bestD = Infinity;
    for (const e of game.enemies) {
      if (e.dead) continue;
      const a = angleTo(this.x, this.z, e.x, e.z);
      const d = dist(this.x, this.z, e.x, e.z);
      if (Math.abs(angleDiff(this.angle, a)) < 0.6 && d < 38 && d < bestD) { bestD = d; best = a; }
    }
    return best ?? this.angle;
  }

  // plasma blade: wide arc in front of the robot, heavy damage and knockback
  meleeAttack(game) {
    const range = this.r + 3.6, halfArc = 1.15;
    for (const e of game.enemies) {
      if (e.dead) continue;
      const d = dist(this.x, this.z, e.x, e.z);
      if (d > range + e.r) continue;
      const a = angleTo(this.x, this.z, e.x, e.z);
      if (Math.abs(angleDiff(this.angle, a)) > halfArc && d > this.r + e.r) continue;
      if (e.blocksFrom(this.x, this.z)) { game.shieldSpark(e, this.x, this.z); continue; }
      e.takeDamage(32 + (this.overdriveTimer > 0 ? 10 : 0), game);
      e.knockX += Math.sin(a) * 32;
      e.knockZ += Math.cos(a) * 32;
    }
    // the blade also cuts enemy bullets out of the air
    for (const b of game.bullets) {
      if (b.owner !== 'enemy') continue;
      const a = angleTo(this.x, this.z, b.x, b.z);
      if (dist(this.x, this.z, b.x, b.z) < range && Math.abs(angleDiff(this.angle, a)) < halfArc) b.dead = true;
    }
    this.slashTimer = 0.18;
    game.addSlash(this.x, this.z, this.angle, range, halfArc);
    Audio_.slash();
  }

  // shockwave: hits everything around the robot and erases nearby enemy bullets
  shockwave(game) {
    const radius = 10.6;
    for (const e of game.enemies) {
      if (e.dead) continue;
      const d = dist(this.x, this.z, e.x, e.z);
      if (d > radius + e.r) continue;
      e.takeDamage(22, game);
      const a = angleTo(this.x, this.z, e.x, e.z);
      e.knockX += Math.sin(a) * 44;
      e.knockZ += Math.cos(a) * 44;
    }
    for (const b of game.bullets) {
      if (b.owner === 'enemy' && dist(this.x, this.z, b.x, b.z) < radius) b.dead = true;
    }
    this.invuln = Math.max(this.invuln, 0.3);
    game.addRing(this.x, this.z, this.r, radius, 0.45, 0x4ff3ff);
    game.shake = Math.min(1.4, game.shake + 0.7);
    Audio_.shockwave();
  }

  takeDamage(amount, game) {
    if (this.invuln > 0 || this.shieldTimer > 0 || !this.alive) return;
    this.health -= amount;
    this.hitFlash = 0.25;
    this.invuln = 0.5;
    Audio_.playerHit();
    game.shake = Math.min(1.2, game.shake + amount * 0.04);
    burst(game, this.x, 1.5, this.z, 0xff5b4d, 10, 8, 0.4);
    if (this.health <= 0) { this.health = 0; this.alive = false; }
  }

  syncModel() {
    const m = this.model;
    m.root.position.set(this.x, 0, this.z);
    m.root.rotation.y = this.angle;
    const swing = Math.sin(this.walk) * 0.6;
    m.legs[0].rotation.x = swing;
    m.legs[1].rotation.x = -swing;
    m.rig.position.y = Math.abs(Math.cos(this.walk)) * 0.08;
    m.torso.rotation.x = this.dashing > 0 ? 0.35 : 0;
    m.torso.rotation.y = this.slashTimer > 0 ? lerp(-0.9, 0.9, 1 - this.slashTimer / 0.18) : 0;
    m.blade.visible = this.slashTimer > 0;
    m.armor.emissive.setHex(this.hitFlash > 0 ? 0xff3322 : 0x000000);
    m.armor.emissiveIntensity = this.hitFlash > 0 ? 0.8 : 0;
    m.glow.emissive.setHex(this.overheated ? 0xff5b4d : this.overdriveTimer > 0 ? 0xffd447 : 0x4ff3ff);
    m.root.visible = !(this.invuln > 0 && this.dashing <= 0 && Math.sin(performance.now() / 30) > 0.3);
    this.shieldMesh.visible = this.shieldTimer > 0;
  }
}

// ---------- enemies ----------
const ENEMY_DEFS = {
  scout:  { name: 'רחפן', r: 0.8, hp: 22, speed: 12, color: 0xff5b4d, score: 60, contactDmg: 12, behavior: 'charge' },
  gunner: { name: 'תותחן', r: 0.95, hp: 34, speed: 7, color: 0xff8f3d, score: 90, contactDmg: 8, behavior: 'ranged',
            fireRate: 1.3, bulletSpeed: 19, bulletDmg: 8 },
  heavy:  { name: 'כבד', r: 1.5, hp: 90, speed: 4.4, color: 0xc23bff, score: 160, contactDmg: 10, behavior: 'slam',
            slamRadius: 5.6, slamDmg: 26, slamCharge: 1.1 },
  boss:   { r: 2.5, hp: 620, speed: 5.3, color: 0xff2d55, score: 900, contactDmg: 20, behavior: 'boss',
            fireRate: 0.5, bulletSpeed: 16, bulletDmg: 10 },
  // rolls in, arms a short fuse and blows up — also explodes when destroyed
  bomber: { name: 'מתאבד', r: 0.9, hp: 18, speed: 9.5, color: 0xffe14d, score: 70, contactDmg: 0, behavior: 'bomber',
            fuse: 0.8, triggerRange: 2.8, blastRadius: 4.5, blastDmg: 28 },
  // keeps far away, paints you with a laser, then fires one fast, heavy round
  sniper: { name: 'צלף', r: 0.9, hp: 26, speed: 6, color: 0x9dff4f, score: 120, contactDmg: 6, behavior: 'sniper',
            aimTime: 1.3, lockTime: 0.4, cooldown: 2.6, bulletSpeed: 50, bulletDmg: 22 },
  // turns slowly; the front shield stops lasers and blade hits — flank it or use missiles/shockwave
  shield: { name: 'נושא מגן', r: 1.3, hp: 70, speed: 5, color: 0x4d7cff, score: 150, contactDmg: 14, behavior: 'shield',
            turnRate: 1.6, frontShield: 1.0 },
  // hovering mothership that keeps launching mini drones
  carrier: { name: 'ספינת אם', r: 1.8, hp: 120, speed: 3.5, color: 0x3dffc5, score: 220, contactDmg: 10, behavior: 'carrier',
             launchEvery: 4, maxMinis: 6 },
  mini:   { r: 0.5, hp: 8, speed: 14, color: 0x3dffc5, score: 20, contactDmg: 8, behavior: 'charge' },
  // teleports around you and answers with a three-shot spread
  blinker: { name: 'מבזיק', r: 0.85, hp: 30, speed: 0, color: 0xff4fd8, score: 140, contactDmg: 6, behavior: 'blink',
             blinkEvery: 2.2, bulletSpeed: 20, bulletDmg: 9 },
};

// which enemies a wave can roll, and from which wave each one shows up
const ROSTER = [
  { type: 'scout', from: 1, weight: 5 },
  { type: 'gunner', from: 2, weight: 3 },
  { type: 'bomber', from: 2, weight: 2 },
  { type: 'heavy', from: 3, weight: 1.5 },
  { type: 'sniper', from: 3, weight: 1.5 },
  { type: 'shield', from: 4, weight: 1.5 },
  { type: 'blinker', from: 6, weight: 1.5 },
  { type: 'carrier', from: 7, weight: 0.8 },
];

function makeEnemyModel(type, def) {
  const root = new THREE.Group();
  const armor = metal(0x6a3a3e, def.color, 0.3);
  const glow = metal(def.color, def.color, 1.2);
  const parts = { root, armor, glow };
  if (type === 'scout' || type === 'mini') {
    // hovering arrowhead drone
    const drone = new THREE.Group();
    drone.scale.setScalar(def.r / 0.8);
    const body = part(new THREE.ConeGeometry(0.7, 1.6, 4), armor, 1, 1, 1, 0, 1.0, 0);
    body.rotation.x = Math.PI / 2;
    drone.add(body);
    drone.add(part(GEO.sphere, glow, 0.25, 0.25, 0.25, 0, 1.0, -0.5));
    root.add(drone);
    parts.hover = true;
  } else if (type === 'bomber') {
    // spiked rolling mine with a blinking fuse light on top
    const body = new THREE.Group();
    body.position.y = 0.9;
    body.add(part(GEO.sphere, armor, 0.8, 0.8, 0.8, 0, 0, 0));
    const spike = new THREE.ConeGeometry(0.16, 0.5, 6);
    for (const [x, y, z] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const m = part(spike, armor, 1, 1, 1, x * 0.9, y * 0.9, z * 0.9);
      m.lookAt(x * 2, y * 2, z * 2);
      m.rotateX(Math.PI / 2);
      body.add(m);
    }
    root.add(body);
    root.add(part(GEO.sphere, glow, 0.22, 0.22, 0.22, 0, 1.85, 0));
    parts.roll = body;
  } else if (type === 'sniper') {
    const r = makeRobot(0x4a6a3a, def.color, 0.95);
    r.armor.emissive.setHex(def.color); r.armor.emissiveIntensity = 0.12;
    const rifle = part(new THREE.CylinderGeometry(0.07, 0.1, 2.4, 8), metal(0x1b232a), 1, 1, 1, 0.8, 0.1, 1.1);
    rifle.rotation.x = Math.PI / 2;
    r.torso.add(rifle);
    r.torso.add(part(GEO.box, r.glow, 0.12, 0.12, 0.3, 0.8, 0.28, 0.6)); // scope
    root.add(r.root);
    parts.armor = r.armor; parts.robot = r;
  } else if (type === 'shield') {
    root.add(part(GEO.box, armor, 1.5, 1.1, 1.4, 0, 1.0, -0.1));
    root.add(part(GEO.box, armor, 0.8, 0.5, 0.7, 0, 1.8, -0.2));
    root.add(part(GEO.box, glow, 0.6, 0.12, 0.05, 0, 1.85, 0.16));
    for (const side of [-1, 1]) root.add(part(GEO.box, metal(0x1b232a), 0.4, 0.6, 1.8, side * 0.9, 0.3, -0.1));
    // curved energy shield covering the front arc
    const arc = def.frontShield;
    const plate = new THREE.Mesh(
      new THREE.CylinderGeometry(1.8, 1.8, 2.2, 20, 1, true, -arc, arc * 2),
      new THREE.MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 0.8, transparent: true, opacity: 0.45, side: THREE.DoubleSide }));
    plate.position.y = 1.2;
    root.add(plate);
    parts.plate = plate;
  } else if (type === 'carrier') {
    const ship = new THREE.Group();
    ship.position.y = 1.8;
    ship.add(part(new THREE.CylinderGeometry(1.6, 2.0, 0.6, 16), armor, 1, 1, 1, 0, 0, 0));
    ship.add(part(GEO.sphere, armor, 0.9, 0.5, 0.9, 0, 0.35, 0));
    for (let i = 0; i < 6; i++) {
      const a = (TAU / 6) * i;
      ship.add(part(GEO.sphere, glow, 0.18, 0.18, 0.18, Math.sin(a) * 1.85, -0.05, Math.cos(a) * 1.85));
    }
    root.add(ship);
    parts.hover = true;
    parts.spin = ship;
  } else if (type === 'blinker') {
    root.add(part(new THREE.OctahedronGeometry(0.7), armor, 1, 1.4, 1, 0, 1.5, 0));
    const rings = new THREE.Group();
    rings.position.y = 1.5;
    const torus = new THREE.TorusGeometry(1.05, 0.06, 8, 32);
    const r1 = part(torus, glow, 1, 1, 1, 0, 0, 0);
    const r2 = part(torus, glow, 1, 1, 1, 0, 0, 0);
    r1.rotation.x = Math.PI / 2;
    r2.rotation.y = Math.PI / 2;
    rings.add(r1, r2);
    root.add(rings);
    parts.hover = true;
    parts.spin = rings;
  } else if (type === 'gunner') {
    const r = makeRobot(0x9a5a3a, def.color, 1.05);
    r.armor.emissive.setHex(def.color); r.armor.emissiveIntensity = 0.12;
    root.add(r.root);
    parts.armor = r.armor; parts.robot = r;
  } else if (type === 'heavy') {
    root.add(part(new THREE.CylinderGeometry(1.4, 1.6, 1.6, 6), armor, 1, 1, 1, 0, 0.9, 0));
    root.add(part(new THREE.CylinderGeometry(0.8, 1.1, 0.8, 6), armor, 1, 1, 1, 0, 2.0, 0));
    root.add(part(GEO.box, glow, 0.9, 0.18, 0.1, 0, 2.05, 0.8));
    for (const side of [-1, 1]) root.add(part(GEO.box, armor, 0.6, 1.4, 0.6, side * 1.7, 1.4, 0.2));
  } else if (type === 'boss') {
    const r = makeRobot(0x7a2a38, def.color, 2.4);
    r.armor.emissive.setHex(def.color); r.armor.emissiveIntensity = 0.15;
    root.add(r.root);
    r.torso.add(part(GEO.box, glow, 0.2, 0.6, 0.2, 0, 1.75, 0)); // antenna
    parts.armor = r.armor; parts.robot = r;
  }
  root.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return parts;
}

class Enemy {
  constructor(game, x, z, type) {
    const d = ENEMY_DEFS[type];
    this.type = type; this.def = d;
    this.x = x; this.z = z; this.r = d.r;
    this.hp = d.hp; this.maxHp = d.hp;
    this.speed = d.speed;
    this.behavior = d.behavior;
    this.angle = 0;
    this.hitFlash = 0;
    this.dead = false;
    this.fireTimer = rand(0.3, d.fireRate || 1);
    this.slamTelegraph = 0;
    this.knockX = 0; this.knockZ = 0;
    this.bossPattern = 0;
    this.bossTimer = 2;
    this.walk = rand(0, TAU);
    this.angle = angleTo(x, z, game.player.x, game.player.z);
    this.aimLeft = 0; this.aimAngle = this.angle; // sniper
    this.fuseLeft = 0;                            // bomber
    this.launchTimer = 1.5;                       // carrier
    this.blinkTimer = rand(1, d.blinkEvery || 1); // blinker
    this.volleyTimer = 0;

    this.model = makeEnemyModel(type, d);
    game.scene.add(this.model.root);

    if (this.behavior === 'sniper') {
      this.laser = new THREE.Mesh(GEO.box, new THREE.MeshBasicMaterial({ color: d.color, transparent: true, depthWrite: false }));
      this.laser.visible = false;
      game.scene.add(this.laser);
    }

    if (this.behavior === 'slam') {
      this.slamRing = new THREE.Mesh(GEO.ring, new THREE.MeshBasicMaterial({ color: d.color, transparent: true, side: THREE.DoubleSide }));
      this.slamRing.rotation.x = -Math.PI / 2;
      this.slamRing.visible = false;
      game.scene.add(this.slamRing);
    }
    // billboard health bar
    this.hpBar = new THREE.Group();
    const w = Math.max(1.6, this.r * 2);
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.18), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6 }));
    this.hpFill = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.18), new THREE.MeshBasicMaterial({ color: 0x4fe07d }));
    this.hpFill.position.z = 0.01;
    this.hpBar.add(bg, this.hpFill);
    this.hpBarW = w;
    this.hpBar.visible = false;
    game.scene.add(this.hpBar);
  }

  takeDamage(amount, game) {
    this.hp -= amount;
    this.hitFlash = 0.12;
    burst(game, this.x, 1.2, this.z, this.def.color, 5, 6, 0.3);
    if (this.hp <= 0 && !this.dead) {
      this.dead = true;
      Audio_.explosion();
      const big = this.type === 'boss';
      burst(game, this.x, 1.2, this.z, this.def.color, big ? 70 : 20, big ? 18 : 11, 0.8);
      burst(game, this.x, 1.2, this.z, 0xffd447, big ? 30 : 8, big ? 14 : 8, 0.5);
      game.addRing(this.x, this.z, 0.5, big ? 9 : 3, 0.35, this.def.color);
      game.shake = Math.min(1.6, game.shake + (big ? 1.2 : 0.3));
      game.onEnemyKilled(this);
      if (this.behavior === 'bomber') this.detonate(game);
    }
  }

  // true when a hit coming from (x, z) lands on the front shield
  blocksFrom(x, z) {
    return !!this.def.frontShield && Math.abs(angleDiff(this.angle, angleTo(this.x, this.z, x, z))) < this.def.frontShield;
  }

  detonate(game) {
    if (this.detonated) return;
    this.detonated = true;
    this.dead = true;
    const R = this.def.blastRadius, p = game.player;
    if (dist(this.x, this.z, p.x, p.z) < R + p.r) p.takeDamage(this.def.blastDmg, game);
    for (const e of game.enemies) {
      if (e !== this && !e.dead && dist(this.x, this.z, e.x, e.z) < R + e.r) e.takeDamage(this.def.blastDmg * 0.6, game);
    }
    Audio_.explosion();
    burst(game, this.x, 1, this.z, 0xffe14d, 30, 14, 0.7);
    burst(game, this.x, 1, this.z, 0xff5b4d, 14, 10, 0.5);
    game.addRing(this.x, this.z, 0.5, R, 0.35, 0xffe14d);
    game.shake = Math.min(1.6, game.shake + 0.6);
  }

  // pick a free spot 9–14 units from the player and jump there
  blink(game) {
    const p = game.player;
    for (let tries = 0; tries < 12; tries++) {
      const a = rand(0, TAU), d = rand(9, 14);
      const x = clamp(p.x + Math.sin(a) * d, -HALF_W + 2, HALF_W - 2);
      const z = clamp(p.z + Math.cos(a) * d, -HALF_D + 2, HALF_D - 2);
      if (game.obstacles.some(o => circleRectCollide(x, z, this.r + 0.5, o))) continue;
      burst(game, this.x, 1.5, this.z, this.def.color, 12, 8, 0.4);
      game.addRing(this.x, this.z, 1.5, 0.2, 0.25, this.def.color);
      this.x = x; this.z = z;
      game.addRing(x, z, 0.2, 2.5, 0.3, this.def.color);
      Audio_.blink();
      return;
    }
  }

  update(dt, game) {
    const p = game.player;
    const a = angleTo(this.x, this.z, p.x, p.z);
    if (this.behavior !== 'shield') this.angle = a;
    const d = dist(this.x, this.z, p.x, p.z);
    let moving = false;
    const step = (dir, mul) => {
      this.x += Math.sin(a) * dir * this.speed * (mul || 1) * dt;
      this.z += Math.cos(a) * dir * this.speed * (mul || 1) * dt;
      moving = dir !== 0;
    };

    if (this.behavior === 'charge') {
      step(1);
    } else if (this.behavior === 'ranged') {
      const desired = 16;
      step(d < desired - 1.2 ? -1 : d > desired + 1.2 ? 1 : 0);
      this.fireTimer -= dt;
      if (this.fireTimer <= 0 && d < 32) {
        this.fireTimer = this.def.fireRate * rand(0.85, 1.15);
        game.bullets.push(new Bullet(game, this.x, this.z, a, this.def.bulletSpeed, this.def.bulletDmg, 'enemy', 0xff8f3d, 0.3));
        Audio_.enemyShoot();
      }
    } else if (this.behavior === 'slam') {
      if (this.slamTelegraph > 0) {
        this.slamTelegraph -= dt;
        if (this.slamTelegraph <= 0) {
          if (d < this.def.slamRadius + this.r) p.takeDamage(this.def.slamDmg, game);
          burst(game, this.x, 0.3, this.z, this.def.color, 24, 12, 0.5);
          game.addRing(this.x, this.z, 0.5, this.def.slamRadius, 0.3, this.def.color);
          game.shake = Math.min(1.2, game.shake + 0.5);
        }
      } else if (d < this.def.slamRadius) {
        this.slamTelegraph = this.def.slamCharge;
      } else {
        step(1);
      }
    } else if (this.behavior === 'bomber') {
      if (this.fuseLeft > 0) {
        const before = this.fuseLeft;
        this.fuseLeft -= dt;
        if (Math.floor(before * 10) !== Math.floor(this.fuseLeft * 10)) Audio_.fuse();
        step(1, 0.4);
        if (this.fuseLeft <= 0) { this.detonate(game); return; }
      } else {
        step(1);
        if (d < this.def.triggerRange + p.r) this.fuseLeft = this.def.fuse;
      }
    } else if (this.behavior === 'sniper') {
      if (this.aimLeft > 0) {
        this.aimLeft -= dt;
        // tracks you at first, then locks so a sidestep dodges the shot
        if (this.aimLeft > this.def.lockTime) this.aimAngle = a;
        this.angle = this.aimAngle;
        if (this.aimLeft <= 0) {
          this.fireTimer = this.def.cooldown;
          game.bullets.push(new Bullet(game, this.x + Math.sin(this.aimAngle) * 1.5, this.z + Math.cos(this.aimAngle) * 1.5,
            this.aimAngle, this.def.bulletSpeed, this.def.bulletDmg, 'enemy', this.def.color, 0.35));
          Audio_.sniperShot();
        }
      } else {
        const desired = 24;
        step(d < desired - 2 ? -1 : d > desired + 2 ? 1 : 0);
        this.fireTimer -= dt;
        if (this.fireTimer <= 0 && d < 45) { this.aimLeft = this.def.aimTime; Audio_.sniperCharge(); }
      }
    } else if (this.behavior === 'shield') {
      this.angle += clamp(angleDiff(this.angle, a), -this.def.turnRate * dt, this.def.turnRate * dt);
      this.x += Math.sin(this.angle) * this.speed * dt;
      this.z += Math.cos(this.angle) * this.speed * dt;
      moving = true;
    } else if (this.behavior === 'carrier') {
      const desired = 20;
      step(d < desired - 2 ? -1 : d > desired + 2 ? 1 : 0);
      this.launchTimer -= dt;
      if (this.launchTimer <= 0) {
        this.launchTimer = this.def.launchEvery;
        const alive = game.enemies.filter(e => e.mother === this && !e.dead).length;
        for (let i = 0; i < 2 && alive + i < this.def.maxMinis; i++) {
          const side = i === 0 ? -1 : 1;
          const mini = new Enemy(game, this.x + Math.cos(a) * side * 2, this.z - Math.sin(a) * side * 2, 'mini');
          mini.mother = this;
          game.spawnLater.push(mini);
          burst(game, mini.x, 1.5, mini.z, this.def.color, 6, 5, 0.3);
        }
      }
    } else if (this.behavior === 'blink') {
      this.blinkTimer -= dt;
      if (this.blinkTimer <= 0) {
        this.blinkTimer = this.def.blinkEvery * rand(0.85, 1.15);
        this.blink(game);
        this.volleyTimer = 0.5;
      }
      if (this.volleyTimer > 0) {
        this.volleyTimer -= dt;
        if (this.volleyTimer <= 0) {
          for (const off of [-0.25, 0, 0.25]) {
            game.bullets.push(new Bullet(game, this.x, this.z, a + off, this.def.bulletSpeed, this.def.bulletDmg, 'enemy', this.def.color, 0.3));
          }
          Audio_.enemyShoot();
        }
      }
    } else if (this.behavior === 'boss') {
      this.bossTimer -= dt;
      const desired = 18;
      step(d < desired - 2 ? -1 : d > desired + 2 ? 1 : 0, 0.6);
      if (this.bossTimer <= 0) {
        this.bossTimer = rand(1.8, 2.6);
        this.bossPattern = (this.bossPattern + 1) % 2;
      }
      this.fireTimer -= dt;
      if (this.fireTimer <= 0) {
        if (this.bossPattern === 0) {
          this.fireTimer = this.def.fireRate;
          game.bullets.push(new Bullet(game, this.x, this.z, a, this.def.bulletSpeed, this.def.bulletDmg, 'enemy', 0xff2d55, 0.4));
        } else {
          this.fireTimer = this.def.fireRate * 2.2;
          const n = 10;
          for (let i = 0; i < n; i++) {
            game.bullets.push(new Bullet(game, this.x, this.z, (TAU / n) * i + this.bossTimer, this.def.bulletSpeed * 0.8, this.def.bulletDmg, 'enemy', 0xff2d55, 0.4));
          }
        }
        Audio_.enemyShoot();
      }
    }

    // knockback integration
    if (Math.abs(this.knockX) > 0.05 || Math.abs(this.knockZ) > 0.05) {
      this.x += this.knockX * dt;
      this.z += this.knockZ * dt;
      this.knockX *= 0.85; this.knockZ *= 0.85;
    }

    this.x = clamp(this.x, -HALF_W + this.r, HALF_W - this.r);
    this.z = clamp(this.z, -HALF_D + this.r, HALF_D - this.r);
    for (const o of game.obstacles) resolveCircleRect(this, o);

    // contact damage with player
    if (d < this.r + p.r) {
      p.takeDamage(this.contactDmg() * dt * 3, game);
      const push = (this.r + p.r) - d || 0.1;
      this.x += ((this.x - p.x) / (d || 1)) * push * 0.5;
      this.z += ((this.z - p.z) / (d || 1)) * push * 0.5;
    }

    this.hitFlash = Math.max(0, this.hitFlash - dt);
    if (moving) this.walk += dt * 9;
    this.syncModel(game);
  }

  contactDmg() { return this.def.contactDmg; }

  syncModel(game) {
    const m = this.model;
    m.root.position.set(this.x, 0, this.z);
    m.root.rotation.y = this.angle;
    if (m.hover) m.root.position.y = Math.sin(this.walk * 0.7 + performance.now() / 400) * 0.2;
    if (m.spin) m.spin.rotation.y += 0.03;
    if (m.roll) m.roll.rotation.x += 0.12;
    if (this.behavior === 'bomber') {
      const rate = this.fuseLeft > 0 ? 40 : 6;
      m.glow.emissiveIntensity = Math.sin(performance.now() / 1000 * rate) > 0 ? 2.5 : 0.3;
    }
    if (this.laser) {
      this.laser.visible = this.aimLeft > 0;
      if (this.laser.visible) {
        const len = 70;
        this.laser.position.set(this.x + Math.sin(this.aimAngle) * len / 2, SHOT_Y, this.z + Math.cos(this.aimAngle) * len / 2);
        this.laser.rotation.y = this.aimAngle;
        const locked = this.aimLeft <= this.def.lockTime;
        this.laser.scale.set(locked ? 0.14 : 0.05, locked ? 0.14 : 0.05, len);
        this.laser.material.opacity = locked ? 0.9 : 0.35 + 0.2 * Math.sin(performance.now() / 50);
      }
    }
    if (m.robot) {
      const swing = Math.sin(this.walk) * 0.5;
      m.robot.legs[0].rotation.x = swing;
      m.robot.legs[1].rotation.x = -swing;
    }
    if (this.behavior === 'slam') {
      const charging = this.slamTelegraph > 0;
      this.slamRing.visible = charging;
      if (charging) {
        const t = 1 - this.slamTelegraph / this.def.slamCharge;
        this.slamRing.position.set(this.x, 0.06, this.z);
        this.slamRing.scale.setScalar(Math.max(0.01, this.def.slamRadius * t));
        this.slamRing.material.opacity = 0.9 - t * 0.4;
        m.root.position.y = Math.sin(t * Math.PI) * 0.8;
      }
    }
    const flash = this.hitFlash > 0;
    m.armor.emissive.setHex(flash ? 0xffffff : this.def.color);
    m.armor.emissiveIntensity = flash ? 1 : 0.3;

    this.hpBar.visible = this.hp < this.maxHp;
    if (this.hpBar.visible) {
      const t = clamp(this.hp / this.maxHp, 0, 1);
      this.hpBar.position.set(this.x, this.type === 'boss' ? 6.2 : this.r * 2 + 1.4, this.z);
      this.hpBar.quaternion.copy(game.camera.quaternion);
      this.hpFill.scale.x = Math.max(0.001, t);
      this.hpFill.position.x = -this.hpBarW * (1 - t) / 2;
      this.hpFill.material.color.setHex(t > 0.5 ? 0x4fe07d : t > 0.25 ? 0xffd447 : 0xff5b4d);
    }
  }

  dispose(game) {
    game.scene.remove(this.model.root, this.hpBar);
    if (this.laser) game.scene.remove(this.laser);
    if (this.slamRing) game.scene.remove(this.slamRing);
  }
}

// ---------- game ----------
class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 300);
    this.camFocus = new THREE.Vector3(0, 0, 0);
    this.state = 'start'; // start | playing | paused | gameover
    this.buildScene();
    this.reset();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    Input.init();
    this.bindUI();
    this.lastTime = performance.now();
    this.renderer.setAnimationLoop(() => this.loop());
  }

  buildScene() {
    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05070a);
    scene.fog = new THREE.Fog(0x05070a, 55, 110);

    scene.add(new THREE.HemisphereLight(0x9fdfff, 0x202030, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.25);
    sun.position.set(-18, 40, 22);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -38, right: 38, top: 30, bottom: -30, near: 1, far: 100 });
    scene.add(sun);
    const rim = new THREE.PointLight(0x4ff3ff, 0.5, 70);
    rim.position.set(0, 18, 0);
    scene.add(rim);

    // floor + grid
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_W, ARENA_D), new THREE.MeshStandardMaterial({ color: 0x0b1116, metalness: 0.3, roughness: 0.8 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    const pts = [];
    for (let x = -HALF_W; x <= HALF_W; x += 2.5) pts.push(x, 0.01, -HALF_D, x, 0.01, HALF_D);
    for (let z = -HALF_D; z <= HALF_D; z += 2.5) pts.push(-HALF_W, 0.01, z, HALF_W, 0.01, z);
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    scene.add(new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ color: 0x4ff3ff, transparent: true, opacity: 0.08 })));

    // glowing low walls around the arena
    const wallMat = metal(0x10181e, 0x4ff3ff, 0.35);
    const walls = [
      [0, -HALF_D - 0.5, ARENA_W + 2, 1], [0, HALF_D + 0.5, ARENA_W + 2, 1],
      [-HALF_W - 0.5, 0, 1, ARENA_D], [HALF_W + 0.5, 0, 1, ARENA_D],
    ];
    for (const [x, z, w, d] of walls) {
      const m = part(GEO.box, wallMat, w, 1.2, d, x, 0.6, z);
      m.receiveShadow = true;
      scene.add(m);
    }
  }

  reset() {
    for (const list of [this.bullets, this.enemies, this.particles, this.powerups, this.effects]) {
      if (!list) continue;
      for (const o of list) o.dispose ? o.dispose(this) : this.scene.remove(o.mesh);
    }
    for (const o of this.obstacles || []) this.scene.remove(...o.meshes);
    if (this.player) this.scene.remove(this.player.model.root);

    this.player = new Player(this);
    this.bullets = [];
    this.enemies = [];
    this.particles = [];
    this.powerups = [];
    this.effects = [];
    this.spawnLater = [];
    this.obstacles = this.makeObstacles();
    this.score = 0;
    this.wave = 0;
    this.shake = 0;
    this.spawnQueue = [];
    this.spawnTimer = 0;
    this.waveActive = false;
    this.nextWaveTimer = 0;
    this.camFocus.set(0, 0, 0);
    this.player.syncModel();
  }

  makeObstacles() {
    const list = [];
    for (const [sx, sz] of [[-15, -8], [15, -8], [-15, 8], [15, 8], [0, -13], [0, 13]]) {
      const w = rand(3, 5.5), d = rand(3, 5.5);
      list.push(new Obstacle(this, sx - w / 2, sz - d / 2, w, d));
    }
    return list;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // pull the camera back on narrow screens so the arena still fits
    this.camDist = w / h < 1.2 ? 1.6 : 1;
    this.camera.updateProjectionMatrix();
  }

  bindUI() {
    document.getElementById('startBtn').onclick = () => this.startGame();
    document.getElementById('restartBtn').onclick = () => this.startGame();
    document.getElementById('resumeBtn').onclick = () => this.togglePause(false);
    window.addEventListener('keydown', e => {
      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (this.state === 'playing') this.togglePause(true);
        else if (this.state === 'paused') this.togglePause(false);
      }
      if (e.code === 'Enter' && (this.state === 'start' || this.state === 'gameover')) this.startGame();
    });
  }

  togglePause(pause) {
    this.state = pause ? 'paused' : 'playing';
    document.getElementById('pauseScreen').classList.toggle('hidden', !pause);
  }

  startGame() {
    this.reset();
    this.state = 'playing';
    document.getElementById('startScreen').classList.add('hidden');
    document.getElementById('gameOverScreen').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('score').textContent = 0;
    document.getElementById('highscore').textContent = this.loadHighscore();
    this.nextWave();
  }

  loadHighscore() {
    try { return Number(localStorage.getItem('rs3d_highscore') || 0); } catch (e) { return 0; }
  }

  nextWave() {
    this.wave++;
    document.getElementById('wave').textContent = this.wave;
    // every newly unlocked enemy type is guaranteed to appear in its first wave
    const fresh = ROSTER.filter(r => r.from === this.wave).map(r => r.type);
    const banner = document.getElementById('waveBanner');
    let text = this.wave % 5 === 0 ? `גל ${this.wave} — בוס!` : `גל ${this.wave}`;
    if (fresh.length) text += ` · אויב חדש: ${fresh.map(t => ENEMY_DEFS[t].name).join(', ')}`;
    banner.textContent = text;
    banner.classList.add('hidden');
    void banner.offsetWidth; // restart the CSS animation
    banner.classList.remove('hidden');
    clearTimeout(this.bannerTO);
    this.bannerTO = setTimeout(() => banner.classList.add('hidden'), 1500);

    const pool = ROSTER.filter(r => r.from <= this.wave);
    const total = pool.reduce((sum, r) => sum + r.weight, 0);
    const list = [...fresh];
    const n = 3 + this.wave * 2;
    while (list.length < n) {
      let roll = Math.random() * total;
      const entry = pool.find(r => (roll -= r.weight) < 0) || pool[0];
      list.push(entry.type);
    }
    if (this.wave % 5 === 0) list.push('boss');
    for (let i = list.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [list[i], list[j]] = [list[j], list[i]];
    }
    this.spawnQueue = list;
    this.spawnTimer = 0.6;
    this.waveActive = true;
  }

  spawnPos() {
    const pad = 2;
    const side = (Math.random() * 4) | 0;
    if (side === 0) return { x: rand(-HALF_W + pad, HALF_W - pad), z: -HALF_D + pad };
    if (side === 1) return { x: HALF_W - pad, z: rand(-HALF_D + pad, HALF_D - pad) };
    if (side === 2) return { x: rand(-HALF_W + pad, HALF_W - pad), z: HALF_D - pad };
    return { x: -HALF_W + pad, z: rand(-HALF_D + pad, HALF_D - pad) };
  }

  onEnemyKilled(enemy) {
    this.score += enemy.def.score;
    document.getElementById('score').textContent = this.score;
    if (Math.random() < 0.18) {
      this.powerups.push(new PowerUp(this, enemy.x, enemy.z, pick(['health', 'overdrive', 'shield'])));
    }
  }

  shieldSpark(e, x, z) {
    const a = angleTo(e.x, e.z, x, z);
    burst(this, e.x + Math.sin(a) * 1.8, 1.4, e.z + Math.cos(a) * 1.8, 0x8fb0ff, 5, 6, 0.25);
    Audio_.block();
  }

  // expanding ground ring (shockwave, explosions, slams)
  addRing(x, z, r0, r1, life, color) {
    const mesh = new THREE.Mesh(GEO.ring, new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.08, z);
    this.scene.add(mesh);
    this.effects.push({ mesh, life, maxLife: life, update: t => {
      mesh.scale.setScalar(lerp(r0, r1, t));
      mesh.material.opacity = 1 - t;
    } });
  }

  // flat arc in front of the robot for the plasma blade
  addSlash(x, z, angle, range, halfArc) {
    const geo = new THREE.RingGeometry(range * 0.35, range, 24, 1, -halfArc, halfArc * 2);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff78f0, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2;
    const holder = new THREE.Group();
    holder.position.set(x, 1.0, z);
    holder.rotation.y = angle - Math.PI / 2; // ring's 0 rad (+x) → facing direction
    holder.add(mesh);
    this.scene.add(holder);
    this.effects.push({ mesh: holder, life: 0.18, maxLife: 0.18, update: t => {
      mesh.material.opacity = 0.7 * (1 - t);
    }, dispose: () => { this.scene.remove(holder); geo.dispose(); } });
  }

  update(dt) {
    if (this.state !== 'playing') return;

    this.player.update(dt, this);
    if (!this.player.alive) { this.onGameOver(); return; }

    if (this.spawnQueue.length > 0) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnTimer = 0.55;
        const pos = this.spawnPos();
        const e = new Enemy(this, pos.x, pos.z, this.spawnQueue.shift());
        this.enemies.push(e);
        this.addRing(pos.x, pos.z, 0.3, 2.5, 0.4, e.def.color);
      }
    } else if (this.waveActive && this.enemies.length === 0) {
      this.waveActive = false;
      this.score += 50 * this.wave;
      document.getElementById('score').textContent = this.score;
      this.nextWaveTimer = 1.4;
    } else if (!this.waveActive) {
      this.nextWaveTimer -= dt;
      if (this.nextWaveTimer <= 0) this.nextWave();
    }

    for (const e of this.enemies) if (!e.dead) e.update(dt, this);
    this.enemies.push(...this.spawnLater);
    this.spawnLater = [];

    for (const b of this.bullets) if (!b.dead) b.update(dt, this);
    for (const b of this.bullets) {
      if (b.dead) continue;
      if (b.owner === 'player') {
        for (const e of this.enemies) {
          if (e.dead || dist(b.x, b.z, e.x, e.z) >= b.r + e.r) continue;
          if (b instanceof Missile) { b.explode(this); break; }
          if (e.blocksFrom(b.x, b.z)) { b.dead = true; this.shieldSpark(e, b.x, b.z); break; }
          e.takeDamage(b.dmg, this);
          const a = angleTo(b.x, b.z, e.x, e.z);
          e.knockX += Math.sin(a) * 5.6;
          e.knockZ += Math.cos(a) * 5.6;
          b.dead = true;
          break;
        }
      } else if (dist(b.x, b.z, this.player.x, this.player.z) < b.r + this.player.r) {
        this.player.takeDamage(b.dmg, this);
        b.dead = true;
      }
    }

    for (const pu of this.powerups) {
      pu.update(dt);
      if (!pu.dead && dist(pu.x, pu.z, this.player.x, this.player.z) < pu.r + this.player.r) {
        this.applyPowerup(pu.type);
        pu.dead = true;
      }
    }

    for (const pt of this.particles) pt.update(dt);
    for (const fx of this.effects) {
      fx.life -= dt;
      fx.update(clamp(1 - fx.life / fx.maxLife, 0, 1));
    }

    this.enemies = this.prune(this.enemies, e => e.dead);
    this.bullets = this.prune(this.bullets, b => b.dead);
    this.powerups = this.prune(this.powerups, p => p.dead);
    this.particles = this.prune(this.particles, p => p.life <= 0);
    this.effects = this.prune(this.effects, fx => fx.life <= 0);

    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.updateHUD();
  }

  // drop finished objects from a list and take their meshes out of the scene
  prune(list, isDone) {
    const keep = [];
    for (const o of list) {
      if (!isDone(o)) { keep.push(o); continue; }
      if (o.dispose) o.dispose(this);
      else this.scene.remove(o.mesh);
    }
    return keep;
  }

  applyPowerup(type) {
    Audio_.powerup();
    const p = this.player;
    if (type === 'health') p.health = Math.min(p.maxHealth, p.health + 34);
    if (type === 'overdrive') p.overdriveTimer = 6;
    if (type === 'shield') p.shieldTimer = 5;
    burst(this, p.x, 1.2, p.z, POWERUP_TYPES[type].color, 16, 8, 0.5);
  }

  updateHUD() {
    const p = this.player;
    document.getElementById('healthFill').style.width = clamp(p.health / p.maxHealth, 0, 1) * 100 + '%';
    document.getElementById('heatFill').style.width = clamp(p.heat / p.maxHeat, 0, 1) * 100 + '%';
    document.getElementById('overheatWarning').classList.toggle('hidden', !p.overheated);
    this.setSlot('slotLaser', p.overheated ? 1 : 0, p.overheated);
    this.setSlot('slotMissile', p.cooldowns.missile / ATTACKS.missile.cooldown);
    this.setSlot('slotMelee', p.cooldowns.melee / ATTACKS.melee.cooldown);
    this.setSlot('slotShock', p.cooldowns.shock / ATTACKS.shock.cooldown);
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
    burst(this, this.player.x, 1.5, this.player.z, 0x4ff3ff, 60, 16, 1);
    this.scene.remove(this.player.model.root);
    const hs = Math.max(this.score, this.loadHighscore());
    try { localStorage.setItem('rs3d_highscore', hs); } catch (e) { /* storage blocked */ }
    document.getElementById('finalStats').textContent = `ניקוד: ${this.score}   |   גל: ${this.wave}   |   שיא: ${hs}`;
    document.getElementById('gameOverScreen').classList.remove('hidden');
    document.getElementById('hud').classList.add('hidden');
  }

  updateCamera(dt) {
    const p = this.player;
    // follow the player loosely, but keep most of the arena in view
    this.camFocus.x = lerp(this.camFocus.x, p.x * 0.75, clamp(dt * 4, 0, 1));
    this.camFocus.z = lerp(this.camFocus.z, p.z * 0.7, clamp(dt * 4, 0, 1));
    if (this.state === 'start') {
      const t = performance.now() / 6000;
      this.camera.position.set(Math.sin(t) * 40, 26, Math.cos(t) * 40);
      this.camera.lookAt(0, 0, 0);
      return;
    }
    const k = this.camDist || 1;
    const sx = this.shake > 0.01 ? rand(-this.shake, this.shake) : 0;
    const sz = this.shake > 0.01 ? rand(-this.shake, this.shake) : 0;
    this.camera.position.set(this.camFocus.x + sx, 27 * k, this.camFocus.z + 21 * k + sz);
    this.camera.lookAt(this.camFocus.x + sx, 0, this.camFocus.z + sz);
  }

  loop() {
    const now = performance.now();
    const dt = Math.min(0.033, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.update(dt);
    // keep particles settling and the camera moving on the game-over screen
    if (this.state === 'gameover') {
      for (const pt of this.particles) pt.update(dt);
      this.particles = this.prune(this.particles, p => p.life <= 0);
    }
    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
  }
}

new Game(document.getElementById('game3d'));
