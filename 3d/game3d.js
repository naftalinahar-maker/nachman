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
// `shape` picks the variant: 'dart' = slim with back fins, 'block' = wide with a rocket pod.
function makeRobot(bodyColor, glowColor, scale, shape, hat) {
  const root = new THREE.Group();
  const rig = new THREE.Group();
  rig.scale.setScalar(scale);
  if (shape === 'dart') rig.scale.x *= 0.85;
  if (shape === 'block') rig.scale.x *= 1.15;
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
  if (shape === 'dart') {
    // swept-back fins and an antenna
    for (const side of [-1, 1]) {
      const fin = part(GEO.box, glow, 0.07, 0.55, 0.75, side * 0.42, 0.95, -0.55);
      fin.rotation.x = -0.5;
      fin.rotation.z = side * 0.35;
      torso.add(fin);
    }
    torso.add(part(GEO.box, dark, 0.05, 0.5, 0.05, 0.18, 1.65, 0));
    torso.add(part(GEO.sphere, glow, 0.07, 0.07, 0.07, 0.18, 1.92, 0));
  } else if (shape === 'block') {
    // rocket pod on the left shoulder + heavy backpack
    torso.add(part(GEO.box, armor, 0.55, 0.45, 0.75, -0.85, 1.3, -0.05));
    for (const dx of [-0.13, 0.13]) torso.add(part(GEO.sphere, glow, 0.09, 0.09, 0.05, -0.85 + dx, 1.3, 0.33));
    torso.add(part(GEO.box, dark, 0.9, 0.7, 0.4, 0, 0.6, -0.55));
    torso.add(part(GEO.box, glow, 0.6, 0.08, 0.05, 0, 0.75, -0.76));
  }
  addHat3D(torso, hat, glowColor);
  rig.add(torso);

  return { root, rig, legs, torso, blade, glow, armor };
}

// hats bought with points sit on top of the head (head top is at y 1.46 in torso space)
function addHat3D(torso, hat, glowColor) {
  if (!hat || hat === 'none') return;
  if (hat === 'antenna') {
    torso.add(part(GEO.box, metal(0xcfe3e8), 0.05, 0.6, 0.05, -0.12, 1.75, -0.05));
    torso.add(part(GEO.sphere, metal(glowColor, glowColor, 1.4), 0.11, 0.11, 0.11, -0.12, 2.08, -0.05));
  } else if (hat === 'horns') {
    const bone = metal(0xf2ead3);
    for (const side of [-1, 1]) {
      const h = part(new THREE.ConeGeometry(0.1, 0.55, 8), bone, 1, 1, 1, side * 0.3, 1.62, 0.05);
      h.rotation.z = -side * 0.6;
      h.rotation.x = 0.25;
      torso.add(h);
    }
  } else if (hat === 'mohawk') {
    const m = metal(glowColor, glowColor, 0.9);
    for (let i = 0; i < 4; i++) {
      const sp = part(new THREE.ConeGeometry(0.08, 0.4 - Math.abs(i - 1.5) * 0.06, 6), m, 1, 1, 1, 0, 1.62, 0.2 - i * 0.14);
      sp.rotation.x = -0.25;
      torso.add(sp);
    }
  } else if (hat === 'crown') {
    const gold = metal(0xffc83d, 0xffa000, 0.45);
    torso.add(part(new THREE.CylinderGeometry(0.3, 0.28, 0.16, 14, 1, true), gold, 1, 1, 1, 0, 1.55, 0));
    for (let i = 0; i < 6; i++) {
      const a = (TAU / 6) * i;
      torso.add(part(new THREE.ConeGeometry(0.06, 0.2, 5), gold, 1, 1, 1, Math.sin(a) * 0.29, 1.72, Math.cos(a) * 0.29));
    }
    torso.add(part(GEO.sphere, metal(0xff3b6b, 0xff3b6b, 0.8), 0.06, 0.06, 0.06, 0, 1.56, 0.3));
  }
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
// the shared robot table is in 2D pixels; 16 px = 1 world unit
const PX = 1 / 16;
const MODEL_SCALE = { dart: 1.1, arrow: 1.3, block: 1.55 };

class Player {
  constructor(game, robotKey, colorHex, look) {
    const def = ROBOTS[robotKey] || ROBOTS.warrior;
    this.colorHex = colorHex || '#4ff3ff';
    this.hat = (look && look.hat) || 'none';
    this.trail = (look && look.trail) || 'none';
    this.trailTimer = 0;
    this.def = def;
    this.color = parseInt((colorHex || '#4ff3ff').slice(1), 16);
    this.scale = MODEL_SCALE[def.shape] || 1.3;
    this.x = 0; this.z = 0; this.r = def.r * PX;
    this.angle = Math.PI; // face away from the camera
    this.speed = def.speed * PX;
    this.maxHealth = def.hp; this.health = def.hp;
    this.laserDmg = def.laserDmg;
    this.missileCount = 1;
    this.missileCd = ATTACKS.missile.cooldown;
    this.meleeCd = ATTACKS.melee.cooldown;
    this.meleeRange = 3.6; this.meleeDmg = 32;
    this.shockCd = ATTACKS.shock.cooldown;
    this.shockRadius = 10.6;
    this.upgrades = {};
    this.maxHeat = 100; this.heat = 0;
    this.overheated = false;
    this.fireRate = 0.09; this.fireTimer = 0;
    this.heatPerShot = 9;
    this.heatDecay = 38;
    this.overheatDecay = 22;
    this.dashCooldown = def.dashCd; this.dashTimer = 0;
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

    const tint = new THREE.Color(0xdff7ff).lerp(new THREE.Color(this.color), 0.5).getHex();
    this.model = makeRobot(tint, this.color, this.scale, def.shape, this.hat);
    game.scene.add(this.model.root);
    this.shieldMesh = new THREE.Mesh(GEO.sphere, new THREE.MeshBasicMaterial({ color: this.color, transparent: true, opacity: 0.18, depthWrite: false }));
    this.shieldMesh.scale.setScalar(1.8 * this.scale / 1.3);
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
      burst(game, this.x, 1, this.z, this.color, 14, 10, 0.4);
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

    // trail bought in the hangar: little sparks behind the robot while it moves
    this.trailTimer -= dt;
    if (this.trail !== 'none' && mlen > 0 && this.trailTimer <= 0 && game.particles.length < 450) {
      this.trailTimer = 0.035;
      const bx = this.x - Math.sin(this.angle) * this.r, bz = this.z - Math.cos(this.angle) * this.r;
      const hex = Shop.trailColor(this.trail, this.colorHex);
      game.particles.push(new Particle(game, bx + rand(-0.3, 0.3), rand(0.4, 1.2), bz + rand(-0.3, 0.3),
        rand(-1, 1), rand(0.5, 2.5), rand(-1, 1), 0.5, parseInt(hex.slice(1), 16), this.trail === 'fire' ? 1.5 : 1.1));
    }

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
        this.laserDmg + (this.overdriveTimer > 0 ? 3 : 0), 'player', this.color, 0.22));
      Audio_.shoot();
    }

    for (const k in this.cooldowns) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);

    if (Input.down(ATTACKS.missile.code) && this.cooldowns.missile <= 0) {
      this.cooldowns.missile = this.missileCd;
      for (let i = 0; i < this.missileCount; i++) {
        const a = aim + (i - (this.missileCount - 1) / 2) * 0.35;
        game.bullets.push(new Missile(game, this.x + Math.sin(a) * 1.3, this.z + Math.cos(a) * 1.3, a));
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
    this.slashTimer = Math.max(0, this.slashTimer - dt);
    this.syncModel();
  }

  // gun barrel tip in world space (the cannon sits on the right arm)
  muzzle() {
    const s = Math.sin(this.angle), c = Math.cos(this.angle);
    const k = this.scale / 1.3;
    return { x: this.x + (s * 1.6 + c * 1.0) * k, z: this.z + (c * 1.6 - s * 1.0) * k };
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
    const range = this.r + this.meleeRange, halfArc = 1.15;
    for (const e of game.enemies) {
      if (e.dead) continue;
      const d = dist(this.x, this.z, e.x, e.z);
      if (d > range + e.r) continue;
      const a = angleTo(this.x, this.z, e.x, e.z);
      if (Math.abs(angleDiff(this.angle, a)) > halfArc && d > this.r + e.r) continue;
      e.takeDamage(this.meleeDmg + (this.overdriveTimer > 0 ? 10 : 0), game);
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
    const radius = this.shockRadius;
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
    game.addRing(this.x, this.z, this.r, radius, 0.45, this.color);
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
    m.glow.emissive.setHex(this.overheated ? 0xff5b4d : this.overdriveTimer > 0 ? 0xffd447 : this.color);
    m.root.visible = !(this.invuln > 0 && this.dashing <= 0 && Math.sin(performance.now() / 30) > 0.3);
    this.shieldMesh.visible = this.shieldTimer > 0;
  }
}

// ---------- enemies ----------
const ENEMY_DEFS = {
  scout:    { r: 0.8, hp: 22, speed: 12, color: 0xff5b4d, score: 60, contactDmg: 12, behavior: 'charge', shape: 'dart' },
  gunner:   { r: 0.95, hp: 34, speed: 7, color: 0xff8f3d, score: 90, contactDmg: 8, behavior: 'ranged', shape: 'square',
              fireRate: 1.3, bulletSpeed: 19, bulletDmg: 8 },
  heavy:    { r: 1.5, hp: 90, speed: 4.4, color: 0xc23bff, score: 160, contactDmg: 10, behavior: 'slam', shape: 'hex',
              slamRadius: 5.6, slamDmg: 26, slamCharge: 1.1 },
  wasp:     { r: 0.75, hp: 18, speed: 14.4, color: 0xffe14d, score: 80, contactDmg: 10, behavior: 'zigzag', shape: 'wasp' },
  spreader: { r: 1.0, hp: 40, speed: 5.6, color: 0xff5fa2, score: 110, contactDmg: 8, behavior: 'spread', shape: 'tri',
              fireRate: 1.7, bulletSpeed: 16, bulletDmg: 7 },
  splitter: { r: 1.25, hp: 55, speed: 6.6, color: 0x9dff4d, score: 120, contactDmg: 10, behavior: 'charge', shape: 'circle', splits: true },
  mini:     { r: 0.56, hp: 10, speed: 13.4, color: 0x9dff4d, score: 20, contactDmg: 6, behavior: 'charge', shape: 'dart' },
  boss:     { r: 2.5, hp: 800, speed: 5.3, color: 0xff2d55, score: 900, contactDmg: 20, behavior: 'boss', shape: 'boss',
              fireRate: 0.5, bulletSpeed: 16, bulletDmg: 10 },
};

// built-in enemy, or one made in the enemy builder ('c_<id>', stats in 2D pixels → scaled here)
function enemyDef(type) {
  if (ENEMY_DEFS[type]) return ENEMY_DEFS[type];
  const c = CustomEnemies.get(type);
  if (!c) return ENEMY_DEFS.scout;
  const d = CustomEnemies.toDef(c);
  return { ...d, r: d.r * PX, speed: d.speed * PX, bulletSpeed: d.bulletSpeed * PX, slamRadius: d.slamRadius * PX,
           color: parseInt(d.color.slice(1), 16) };
}

// model size each shape was built for; other sizes are scaled from it
const SHAPE_BASE_R = { dart: 0.8, square: 0.95, hex: 1.5, boss: 2.5, wasp: 0.75, tri: 1.0, circle: 1.25 };


function makeEnemyModel(def) {
  const root = new THREE.Group();
  const body = new THREE.Group(); // scaled to the enemy's size
  root.add(body);
  const armor = metal(0x6a3a3e, def.color, 0.3);
  const glow = metal(def.color, def.color, 1.2);
  const parts = { root, armor, glow };
  const shape = SHAPE_BASE_R[def.shape] ? def.shape : 'dart';
  body.scale.setScalar(def.r / SHAPE_BASE_R[shape]);
  if (shape === 'dart') {
    // hovering arrowhead drone
    const cone = part(new THREE.ConeGeometry(0.7, 1.6, 4), armor, 1, 1, 1, 0, 1.0, 0);
    cone.rotation.x = Math.PI / 2;
    body.add(cone);
    body.add(part(GEO.sphere, glow, 0.25, 0.25, 0.25, 0, 1.0, -0.5));
    parts.hover = true;
  } else if (shape === 'square') {
    const r = makeRobot(0x9a5a3a, def.color, 1.05);
    r.armor.emissive.setHex(def.color); r.armor.emissiveIntensity = 0.12;
    body.add(r.root);
    parts.armor = r.armor; parts.robot = r;
  } else if (shape === 'hex') {
    body.add(part(new THREE.CylinderGeometry(1.4, 1.6, 1.6, 6), armor, 1, 1, 1, 0, 0.9, 0));
    body.add(part(new THREE.CylinderGeometry(0.8, 1.1, 0.8, 6), armor, 1, 1, 1, 0, 2.0, 0));
    body.add(part(GEO.box, glow, 0.9, 0.18, 0.1, 0, 2.05, 0.8));
    for (const side of [-1, 1]) body.add(part(GEO.box, armor, 0.6, 1.4, 0.6, side * 1.7, 1.4, 0.2));
  } else if (shape === 'wasp') {
    // striped flying bug with flapping wings and a stinger
    body.add(part(GEO.sphere, armor, 0.38, 0.32, 0.85, 0, 1.3, 0));
    for (const z of [-0.15, -0.45]) body.add(part(GEO.box, glow, 0.62, 0.5, 0.08, 0, 1.3, z));
    body.add(part(GEO.sphere, glow, 0.16, 0.16, 0.16, 0, 1.38, 0.78));
    const sting = part(new THREE.ConeGeometry(0.1, 0.5, 6), glow, 1, 1, 1, 0, 1.3, -1.05);
    sting.rotation.x = -Math.PI / 2;
    body.add(sting);
    const wingMat = new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.45, side: THREE.DoubleSide });
    parts.wings = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.25, 1.55, 0);
      const w = part(GEO.box, wingMat, 0.9, 0.03, 0.45, side * 0.45, 0, 0);
      pivot.add(w);
      body.add(pivot);
      parts.wings.push({ pivot, side });
    }
    parts.hover = true;
  } else if (shape === 'tri') {
    // three-sided turret with a fan of barrels
    const pyr = part(new THREE.ConeGeometry(1.0, 1.5, 3), armor, 1, 1, 1, 0, 0.75, 0);
    body.add(pyr);
    body.add(part(GEO.sphere, glow, 0.22, 0.22, 0.22, 0, 1.55, 0));
    for (const a of [-0.45, 0, 0.45]) {
      const holder = new THREE.Group();
      holder.position.y = 0.8;
      holder.rotation.y = a;
      const barrel = part(new THREE.CylinderGeometry(0.09, 0.11, 0.9, 8), glow, 1, 1, 1, 0, 0, 0.85);
      barrel.rotation.x = Math.PI / 2;
      holder.add(barrel);
      body.add(holder);
    }
  } else if (shape === 'circle') {
    // rolling ball with a glowing crack around the middle
    body.add(part(GEO.sphere, armor, 1.1, 1.1, 1.1, 0, 1.15, 0));
    const ring = part(new THREE.TorusGeometry(1.12, 0.07, 8, 28), glow, 1, 1, 1, 0, 1.15, 0);
    ring.rotation.y = Math.PI / 2;
    body.add(ring);
    body.add(part(GEO.sphere, glow, 0.22, 0.22, 0.22, 0, 1.25, 1.05));
    parts.hover = true;
  } else { // boss
    const r = makeRobot(0x7a2a38, def.color, 2.4);
    r.armor.emissive.setHex(def.color); r.armor.emissiveIntensity = 0.15;
    body.add(r.root);
    r.torso.add(part(GEO.box, glow, 0.2, 0.6, 0.2, 0, 1.75, 0)); // antenna
    parts.armor = r.armor; parts.robot = r;
  }
  root.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return parts;
}

class Enemy {
  constructor(game, x, z, type) {
    const d = enemyDef(type);
    this.type = type; this.def = d;
    this.zig = rand(0, TAU);
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

    this.model = makeEnemyModel(d);
    game.scene.add(this.model.root);

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
      if (this.def.splits) {
        for (const s of [-1, 1]) {
          const m = new Enemy(game, this.x + s * this.r * 0.6, this.z - s * this.r * 0.6, 'mini');
          m.knockX = s * 14; m.knockZ = -s * 14;
          game.enemies.push(m);
        }
      }
    }
  }

  update(dt, game) {
    const p = game.player;
    const a = angleTo(this.x, this.z, p.x, p.z);
    this.angle = a;
    const d = dist(this.x, this.z, p.x, p.z);
    let moving = false;
    const step = (dir, mul) => {
      this.x += Math.sin(a) * dir * this.speed * (mul || 1) * dt;
      this.z += Math.cos(a) * dir * this.speed * (mul || 1) * dt;
      moving = dir !== 0;
    };

    if (this.behavior === 'charge') {
      step(1);
    } else if (this.behavior === 'zigzag') {
      this.zig += dt * 6;
      const za = a + Math.sin(this.zig) * 1.0;
      this.x += Math.sin(za) * this.speed * dt;
      this.z += Math.cos(za) * this.speed * dt;
      this.angle = za;
      moving = true;
    } else if (this.behavior === 'ranged' || this.behavior === 'spread') {
      const desired = 16;
      step(d < desired - 1.2 ? -1 : d > desired + 1.2 ? 1 : 0);
      this.fireTimer -= dt;
      if (this.fireTimer <= 0 && d < 32) {
        this.fireTimer = this.def.fireRate * rand(0.85, 1.15);
        const angles = this.behavior === 'spread' ? [a - 0.28, a, a + 0.28] : [a];
        for (const sa of angles) game.bullets.push(new Bullet(game, this.x, this.z, sa, this.def.bulletSpeed, this.def.bulletDmg, 'enemy', this.def.color, 0.3));
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
    if (m.hover) m.root.position.y = Math.sin(this.walk * 0.7) * 0.2;
    if (m.wings) for (const w of m.wings) w.pivot.rotation.z = w.side * Math.sin(performance.now() / 35) * 0.6;
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
    this.state = 'start'; // start | hangar | playing | upgrade | paused | gameover
    const saved = Loadout.load();
    this.robotKey = saved.robot;
    this.colorHex = saved.color;
    this.hat = saved.hat;
    this.trail = saved.trail;
    this.upgradeLog = [];
    this.levelStartLog = [];
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
    this.makePlayer();
    this.bullets = [];
    this.enemies = [];
    this.particles = [];
    this.powerups = [];
    this.effects = [];
    this.obstacles = this.makeObstacles();
    this.score = 0;
    this.wave = 0;
    this.shake = 0;
    this.spawnQueue = [];
    this.spawnTimer = 0;
    this.waveActive = false;
    this.upgradeTimer = 0;
    this.upgradeChoices = [];
    this.camFocus.set(0, 0, 0);
    this.levels = Campaign.build();
    this.pointsEarned = 0;
    this.player.syncModel();
  }

  // (re)build the player's robot from the current hangar choice
  makePlayer() {
    if (this.player) this.scene.remove(this.player.model.root);
    this.player = new Player(this, this.robotKey, this.colorHex, { hat: this.hat, trail: this.trail });
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
    Loadout.buildHangar(k => this.selectRobot(k), c => this.selectColor(c), false);
    document.getElementById('resumeBtn').onclick = () => this.togglePause(false);
    window.addEventListener('keydown', e => {
      if (this.state === 'builder') { if (e.code === 'Escape') Builder.close(); return; }
      if (isTyping(e)) return;
      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (this.state === 'playing') this.togglePause(true);
        else if (this.state === 'paused') this.togglePause(false);
      }
      if (e.code === 'Enter') {
        if (this.state === 'start') this.openHangar();
        else if (this.state === 'hangar' || this.state === 'victory') this.startGame();
        else if (this.state === 'gameover') this.retryLevel();
      }
      if (this.state === 'hangar') {
        const pick = Loadout.hangarKey(e.code, this.robotKey, this.colorHex);
        if (pick && pick.robot) this.selectRobot(pick.robot);
        if (pick && pick.color) this.selectColor(pick.color);
      } else if (this.state === 'upgrade') {
        const num = Loadout.numKey(e.code);
        if (num !== undefined && this.upgradeChoices[num]) this.chooseUpgrade(this.upgradeChoices[num]);
      }
    });
  }

  // ---------- hangar: the chosen robot turns on the arena floor ----------
  openHangar() {
    this.state = 'hangar';
    for (const id of ['startScreen', 'gameOverScreen', 'victoryScreen']) document.getElementById(id).classList.add('hidden');
    document.getElementById('hud').classList.add('hidden');
    document.getElementById('hangarScreen').classList.remove('hidden');
    Campaign.hideIntro();
    this.reset();
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

  // something from the "design with points" tab was bought or picked
  applyLook(patch) {
    if (patch.color) this.colorHex = patch.color;
    if (patch.hat) this.hat = patch.hat;
    if (patch.trail) this.trail = patch.trail;
    Audio_.powerup();
    this.afterLoadoutChange();
  }

  selectRobot(key) {
    this.robotKey = key;
    Audio_.powerup();
    this.afterLoadoutChange();
  }

  selectColor(hex) {
    this.colorHex = hex;
    Audio_.tone(700, 0.08, 'triangle', 0.08, 1000);
    this.afterLoadoutChange();
  }

  afterLoadoutChange() {
    Loadout.save({ robot: this.robotKey, color: this.colorHex, hat: this.hat, trail: this.trail });
    const angle = this.player.angle;
    this.makePlayer();
    this.player.angle = angle;
    burst(this, 0, 1.5, 0, this.player.color, 18, 8, 0.6);
    this.refreshHangar();
  }

  refreshHangar() { Loadout.refreshHangar(this.robotKey, this.colorHex); Shop.refresh(); }

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
    burst(this, p.x, 1.5, p.z, p.color, 24, 10, 0.6);
    this.state = 'playing';
    this.lastTime = performance.now();
    this.nextWave();
  }

  togglePause(pause) {
    this.state = pause ? 'paused' : 'playing';
    document.getElementById('pauseScreen').classList.toggle('hidden', !pause);
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
    document.getElementById('score').textContent = 0;
    document.getElementById('highscore').textContent = this.loadHighscore();
    Points.refresh();
    this.nextWave();
  }

  retryLevel() { this.startGame(Math.min(this.wave, this.levels.length), this.levelStartLog); }

  loadHighscore() {
    try { return Number(localStorage.getItem('rs3d_highscore') || 0); } catch (e) { return 0; }
  }

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
    for (let i = 0; i < 4; i++) burst(this, this.player.x + rand(-3, 3), 2, this.player.z + rand(-3, 3), pick([0xffd447, 0x4ff3ff, 0xff78f0, 0x4fe07d]), 30, 14, 1.2);
    const hs = Math.max(this.score, this.loadHighscore());
    try { localStorage.setItem('rs3d_highscore', hs); } catch (e) { /* storage blocked */ }
    document.getElementById('victoryStats').textContent = `ניקוד: ${this.score}   |   הרווחת ${this.pointsEarned} נקודות 💰 (כולל 300 בונוס ניצחון)`;
    document.getElementById('victoryScreen').classList.remove('hidden');
    document.getElementById('hud').classList.add('hidden');
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
    this.earn(enemy.def.score / 10);
    if (Math.random() < 0.18) {
      this.powerups.push(new PowerUp(this, enemy.x, enemy.z, pick(['health', 'overdrive', 'shield'])));
    }
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

    for (const b of this.bullets) if (!b.dead) b.update(dt, this);
    for (const b of this.bullets) {
      if (b.dead) continue;
      if (b.owner === 'player') {
        for (const e of this.enemies) {
          if (e.dead || dist(b.x, b.z, e.x, e.z) >= b.r + e.r) continue;
          if (b instanceof Missile) { b.explode(this); break; }
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
    burst(this, this.player.x, 1.5, this.player.z, this.player.color, 60, 16, 1);
    this.scene.remove(this.player.model.root);
    const hs = Math.max(this.score, this.loadHighscore());
    try { localStorage.setItem('rs3d_highscore', hs); } catch (e) { /* storage blocked */ }
    Campaign.hideIntro();
    document.getElementById('finalStats').textContent = `הגעת לשלב ${this.wave} מתוך ${this.levels.length}   |   ניקוד: ${this.score}   |   הרווחת ${this.pointsEarned} נקודות 💰`;
    document.getElementById('retryBtn').textContent = `נסה שוב את שלב ${this.wave}`;
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
    if (this.state === 'hangar') {
      // close-up of the robot, turning slowly in the upper part of the screen
      this.player.angle += dt * 0.8;
      this.player.syncModel();
      const k = this.camDist || 1;
      this.camera.position.set(0, 7.5 * k, 14 * k);
      this.camera.lookAt(0, -2.2, 0);
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
    if (this.state === 'gameover' || this.state === 'victory') {
      for (const pt of this.particles) pt.update(dt);
      this.particles = this.prune(this.particles, p => p.life <= 0);
    }
    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
  }
}

window.game = new Game(document.getElementById('game3d'));
