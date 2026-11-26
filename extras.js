'use strict';

/* ============================================================
   Shared by the 2D and 3D games (load after loadout.js):
   - Points: earned in battle, spent on looks in the hangar
   - Cosmetics: special colors, hats, trails
   - Enemy info + a 2D drawing of every enemy shape
   - Custom enemies (the enemy builder) and the level list
   - Screens that are the same in both games (builder, level intro, victory)
   Sizes and speeds are in 2D pixel units; the 3D game scales them.
   ============================================================ */

function safeGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
}
function safeSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// ---------- points (shared by both games) ----------
const Points = {
  KEY: 'rs_points',
  get() { return Math.max(0, Number(safeGet(this.KEY, 0)) || 0); },
  add(n) { const v = this.get() + Math.max(0, Math.round(n)); safeSet(this.KEY, v); this.refresh(); return v; },
  spend(n) {
    const v = this.get();
    if (v < n) return false;
    safeSet(this.KEY, v - n);
    this.refresh();
    return true;
  },
  refresh() { for (const el of document.querySelectorAll('.pointsVal')) el.textContent = this.get(); },
};

// ---------- cosmetics bought with points ----------
const PREMIUM_COLORS = [
  { id: 'gold',   name: 'זהב',      hex: '#ffc83d', price: 100 },
  { id: 'red',    name: 'אדום',     hex: '#ff3b3b', price: 100 },
  { id: 'white',  name: 'לבן',      hex: '#f4f8ff', price: 150 },
  { id: 'lime',   name: 'ירוק זוהר', hex: '#a6ff1f', price: 150 },
  { id: 'blue',   name: 'כחול עמוק', hex: '#3d6bff', price: 200 },
];
const HATS = [
  { id: 'none',    name: 'בלי',     icon: '✖️', price: 0 },
  { id: 'antenna', name: 'אנטנה',   icon: '📡', price: 80 },
  { id: 'horns',   name: 'קרניים',  icon: '🐂', price: 150 },
  { id: 'mohawk',  name: 'רכס',     icon: '🦔', price: 200 },
  { id: 'crown',   name: 'כתר',     icon: '👑', price: 300 },
];
const TRAILS = [
  { id: 'none',    name: 'בלי',      icon: '✖️', price: 0 },
  { id: 'sparks',  name: 'ניצוצות',  icon: '✨', price: 100 },
  { id: 'fire',    name: 'אש',       icon: '🔥', price: 200 },
  { id: 'rainbow', name: 'קשת',      icon: '🌈', price: 350 },
];

const Shop = {
  KEY: 'rs_owned',
  owned() { const list = safeGet(this.KEY, []); return new Set(Array.isArray(list) ? list : []); },
  has(id) { return id === 'none' || this.owned().has(id); },
  give(id) { const s = this.owned(); s.add(id); safeSet(this.KEY, [...s]); },

  // color of the trail particle right now (hex string)
  trailColor(trail, playerHex) {
    if (trail === 'sparks') return Math.random() < 0.5 ? '#ffffff' : playerHex;
    if (trail === 'fire') return pickOne(['#ff4b1f', '#ff9a3d', '#ffd447']);
    if (trail === 'rainbow') {
      const hue = Math.floor((performance.now() / 60) % 12) * 30; // 12 steps so 3D can reuse materials
      return hslHex(hue, 100, 60);
    }
    return null;
  },

  // Builds the "design with points" tab inside the hangar.
  // look = { color, hat, trail }; onChange(patch) is called when the player equips something.
  build(container, getLook, onChange) {
    const msg = () => container.querySelector('.shop-msg');
    const say = (text, bad) => { const m = msg(); m.textContent = text; m.classList.toggle('bad', !!bad); };
    const tryGet = (id, price, name, apply) => {
      if (this.has(id)) { apply(); return; }
      if (Points.spend(price)) {
        this.give(id);
        say(`קנית ${name}! 🎉`);
        apply();
      } else {
        say(`חסרות לך ${price - Points.get()} נקודות ל${name}. נצח עוד אויבים!`, true);
      }
    };
    container.innerHTML = `
      <p class="shop-intro">מנצחים אויבים ← מקבלים נקודות 💰 ← קונים עיצוב לרובוט</p>
      <h3 class="section-title">צבעים מיוחדים</h3>
      <div class="shop-row" data-kind="color"></div>
      <h3 class="section-title">כובע</h3>
      <div class="shop-row" data-kind="hat"></div>
      <h3 class="section-title">שובל (מאחורי הרובוט כשהוא זז)</h3>
      <div class="shop-row" data-kind="trail"></div>
      <div class="shop-msg"></div>`;
    const rowColor = container.querySelector('[data-kind="color"]');
    for (const c of PREMIUM_COLORS) {
      const b = document.createElement('button');
      b.className = 'shop-item';
      b.dataset.id = c.id;
      b.innerHTML = `<span class="dot" style="background:${c.hex};color:${c.hex}"></span><span class="nm">${c.name}</span><span class="price"></span>`;
      b.onclick = () => tryGet(c.id, c.price, c.name, () => onChange({ color: c.hex }));
      rowColor.appendChild(b);
    }
    for (const [kind, list] of [['hat', HATS], ['trail', TRAILS]]) {
      const row = container.querySelector(`[data-kind="${kind}"]`);
      for (const it of list) {
        const b = document.createElement('button');
        b.className = 'shop-item';
        b.dataset.id = it.id;
        b.innerHTML = `<span class="ic">${it.icon}</span><span class="nm">${it.name}</span><span class="price"></span>`;
        b.onclick = () => tryGet(it.id, it.price, it.name, () => onChange({ [kind]: it.id }));
        row.appendChild(b);
      }
    }
    this.container = container;
    this.getLook = getLook;
  },

  refresh() {
    if (!this.container) return;
    const look = this.getLook();
    const price = { ...Object.fromEntries(PREMIUM_COLORS.map(c => [c.id, c.price])), ...Object.fromEntries([...HATS, ...TRAILS].map(i => [i.id, i.price])) };
    for (const row of this.container.querySelectorAll('.shop-row')) {
      const kind = row.dataset.kind;
      for (const b of row.querySelectorAll('.shop-item')) {
        const id = b.dataset.id;
        const owned = this.has(id);
        const selected = kind === 'color' ? PREMIUM_COLORS.find(c => c.id === id).hex === look.color : look[kind] === id;
        b.classList.toggle('selected', selected);
        b.classList.toggle('locked', !owned);
        b.classList.toggle('cant', !owned && Points.get() < price[id]);
        b.querySelector('.price').textContent = owned ? (selected ? '✓ עליך' : 'שלך') : `💰 ${price[id]}`;
      }
    }
    Points.refresh();
  },
};

function pickOne(arr) { return arr[(Math.random() * arr.length) | 0]; }
function hslHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return '#' + [f(0), f(8), f(4)].map(v => v.toString(16).padStart(2, '0')).join('');
}

// ---------- hats, drawn from above (2D game + hangar previews) ----------
// ctx is already at the robot's center and rotated so +x is forward.
function drawHat2D(ctx, hat, r, color) {
  if (!hat || hat === 'none') return;
  ctx.save();
  ctx.lineWidth = 2;
  if (hat === 'antenna') {
    ctx.strokeStyle = '#cfe3e8';
    ctx.beginPath(); ctx.moveTo(-r * 0.1, 0); ctx.lineTo(-r * 0.75, -r * 0.55); ctx.stroke();
    ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(-r * 0.75, -r * 0.55, r * 0.17, 0, Math.PI * 2); ctx.fill();
  } else if (hat === 'horns') {
    ctx.fillStyle = '#f2ead3'; ctx.strokeStyle = '#8a7a55';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(-r * 0.1, s * r * 0.25);
      ctx.quadraticCurveTo(r * 0.2, s * r * 0.95, r * 0.75, s * r * 0.8);
      ctx.lineTo(r * 0.15, s * r * 0.3);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
  } else if (hat === 'mohawk') {
    ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 6;
    for (let i = 0; i < 4; i++) {
      const x = -r * 0.7 + i * r * 0.35;
      ctx.beginPath();
      ctx.moveTo(x, -r * 0.16); ctx.lineTo(x + r * 0.42, 0); ctx.lineTo(x, r * 0.16);
      ctx.closePath(); ctx.fill();
    }
  } else if (hat === 'crown') {
    ctx.fillStyle = '#ffc83d'; ctx.strokeStyle = '#8a5a00'; ctx.shadowColor = '#ffc83d'; ctx.shadowBlur = 10;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (Math.PI * 2 / 10) * i;
      const rr = i % 2 === 0 ? r * 0.5 : r * 0.28;
      const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ff3b6b';
    ctx.beginPath(); ctx.arc(0, 0, r * 0.13, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

// ---------- enemies ----------
// Shapes the builder can choose from (the boss shape is only for the boss).
const ENEMY_SHAPES = [
  { id: 'dart',   name: 'חץ' },
  { id: 'square', name: 'קובייה' },
  { id: 'hex',    name: 'משושה' },
  { id: 'tri',    name: 'משולש' },
  { id: 'circle', name: 'כדור' },
  { id: 'wasp',   name: 'חרק' },
];
const ENEMY_BEHAVIORS = [
  { id: 'charge', name: 'רץ אליך',     desc: 'רץ ישר אל הרובוט שלך ומתנגש' },
  { id: 'zigzag', name: 'מתפתל',       desc: 'רץ אליך בזיגזג — קשה לפגוע בו' },
  { id: 'ranged', name: 'יורה',        desc: 'שומר מרחק ויורה עליך' },
  { id: 'spread', name: 'יורה משולש',  desc: 'יורה שלושה כדורים בבת אחת' },
  { id: 'slam',   name: 'מרסק',        desc: 'מתקרב וקופץ על הרצפה — גל מכה' },
];
const ENEMY_COLORS = ['#ff5b4d', '#ff8f3d', '#ffe14d', '#9dff4d', '#3dffc5', '#3db5ff', '#c23bff', '#ff5fa2', '#ffffff'];

// name, description, shape and color of the built-in enemies (shown when a new enemy arrives)
const ENEMY_INFO = {
  scout:    { name: 'צופה',        desc: 'רץ ישר אליך ומתנגש',           shape: 'dart',   color: '#ff5b4d', r: 13 },
  gunner:   { name: 'תותחן',       desc: 'שומר מרחק ויורה עליך',         shape: 'square', color: '#ff8f3d', r: 15 },
  heavy:    { name: 'כבד',         desc: 'מתקרב וקופץ על הרצפה — זוזו!', shape: 'hex',    color: '#c23bff', r: 24 },
  wasp:     { name: 'צרעה',        desc: 'מהירה ומתפתלת — קשה לפגוע בה', shape: 'wasp',   color: '#ffe14d', r: 12 },
  spreader: { name: 'מפזר',        desc: 'יורה שלושה כדורים בבת אחת',     shape: 'tri',    color: '#ff5fa2', r: 16 },
  splitter: { name: 'מתפצל',       desc: 'כשמשמידים אותו — הוא מתפצל לשניים!', shape: 'circle', color: '#9dff4d', r: 20 },
  mini:     { name: 'קטנצ׳יק',      desc: 'חצי של מתפצל',                  shape: 'dart',   color: '#9dff4d', r: 9 },
  boss:     { name: 'הבוס הגדול',  desc: 'הקרב האחרון! תנצחו אותו ותסיימו את המשחק', shape: 'boss', color: '#ff2d55', r: 40 },
};

// ctx is at the enemy's center and rotated so +x faces the player.
function drawEnemyShape2D(ctx, shape, r, color, flash) {
  const TAU2 = Math.PI * 2;
  ctx.fillStyle = flash ? '#ffffff' : '#1a0f10';
  ctx.strokeStyle = flash ? '#ffffff' : color;
  ctx.lineWidth = 2.5;
  const poly = pts => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath(); ctx.fill(); ctx.stroke();
  };
  const ngon = (n, rr, inner) => {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (TAU2 / n) * i;
      const q = inner && i % 2 ? rr * inner : rr;
      pts.push([Math.cos(a) * q, Math.sin(a) * q]);
    }
    poly(pts);
  };
  const accent = flash ? '#fff' : color;

  if (shape === 'dart') {
    poly([[r, 0], [-r * 0.8, r * 0.75], [-r * 0.4, 0], [-r * 0.8, -r * 0.75]]);
  } else if (shape === 'square') {
    ctx.beginPath(); ctx.rect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6); ctx.fill(); ctx.stroke();
    ctx.fillStyle = accent; ctx.fillRect(0, -2.5, r * 1.1, 5);
  } else if (shape === 'hex') {
    ngon(6, r);
  } else if (shape === 'tri') {
    poly([[r, 0], [-r * 0.7, r * 0.9], [-r * 0.7, -r * 0.9]]);
    ctx.fillStyle = accent;
    for (const a of [-0.45, 0, 0.45]) {
      ctx.save(); ctx.rotate(a); ctx.fillRect(r * 0.2, -2, r * 0.95, 4); ctx.restore();
    }
  } else if (shape === 'circle') {
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-r * 0.15, -r); ctx.lineTo(r * 0.15, -r * 0.3); ctx.lineTo(-r * 0.1, r * 0.3); ctx.lineTo(r * 0.1, r); ctx.stroke();
  } else if (shape === 'wasp') {
    // wings
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = flash ? '#fff' : color;
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.ellipse(-r * 0.1, s * r * 0.75, r * 0.55, r * 0.3, s * 0.5, 0, TAU2); ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = flash ? '#ffffff' : '#1a0f10';
    ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.42, 0, 0, TAU2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = accent; ctx.lineWidth = 2;
    for (const x of [-0.45, -0.1]) { ctx.beginPath(); ctx.moveTo(x * r, -r * 0.4); ctx.lineTo(x * r, r * 0.4); ctx.stroke(); }
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(-r * 1.4, -r * 0.12); ctx.lineTo(-r * 1.4, r * 0.12); ctx.closePath(); ctx.fill();
  } else { // boss
    ngon(8, r, 0.7);
    ctx.fillStyle = accent; ctx.fillRect(0, -4, r * 1.2, 8);
  }

  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.25, 0, TAU2);
  ctx.fill();
}

// ---------- custom enemies (the builder) ----------
const CustomEnemies = {
  KEY: 'rs_custom_enemies',
  MAX: 5,
  all() {
    const list = safeGet(this.KEY, []);
    return Array.isArray(list) ? list.filter(c => c && c.id) : [];
  },
  saveAll(list) { safeSet(this.KEY, list.slice(0, this.MAX)); },
  get(key) { return this.all().find(c => 'c_' + c.id === key); },
  blank() {
    return { id: '', name: '', shape: 'dart', color: ENEMY_COLORS[3], behavior: 'charge', size: 2, speed: 3, armor: 3, power: 3, splits: false };
  },
  // enemy stats in 2D pixel units
  toDef(c) {
    const r = [11, 16, 24][clampInt(c.size, 1, 3) - 1];
    const sp = clampInt(c.speed, 1, 5), ar = clampInt(c.armor, 1, 5), pw = clampInt(c.power, 1, 5);
    return {
      r, shape: c.shape, color: c.color, behavior: c.behavior, splits: !!c.splits, custom: true,
      hp: Math.round((10 + ar * 14) * (r > 20 ? 1.5 : 1)),
      speed: 50 + sp * 34,
      score: 30 + (sp + ar + pw) * 10,
      contactDmg: 5 + pw * 2,
      fireRate: 2.1 - pw * 0.22, bulletSpeed: 220 + pw * 20, bulletDmg: 3 + pw * 2,
      slamRadius: r * 3.8, slamDmg: 10 + pw * 4, slamCharge: 1.1,
    };
  },
  info(key) {
    const c = this.get(key);
    if (!c) return null;
    const d = this.toDef(c);
    return { name: c.name, desc: 'אויב שבנית בעצמך!', shape: c.shape, color: c.color, r: d.r, custom: true };
  },
};
function clampInt(v, lo, hi) { v = Math.round(Number(v) || lo); return v < lo ? lo : v > hi ? hi : v; }

// ---------- levels ----------
// Every level brings one new enemy. Enemies you built get a level of their own,
// right before the final boss. Beat the boss and the game is won.
const Campaign = {
  BASE: [
    { type: 'scout',    mix: [['scout', 6]] },
    { type: 'gunner',   mix: [['scout', 4], ['gunner', 4]] },
    { type: 'heavy',    mix: [['scout', 4], ['gunner', 3], ['heavy', 2]] },
    { type: 'wasp',     mix: [['wasp', 6], ['gunner', 3], ['scout', 3]] },
    { type: 'spreader', mix: [['spreader', 4], ['wasp', 3], ['heavy', 2], ['scout', 3]] },
    { type: 'splitter', mix: [['splitter', 4], ['spreader', 2], ['gunner', 3], ['wasp', 3]] },
  ],
  FINAL: { type: 'boss', mix: [['boss', 1], ['scout', 4], ['gunner', 3], ['wasp', 2]], final: true },

  build() {
    const levels = this.BASE.slice();
    for (const c of CustomEnemies.all()) {
      const key = 'c_' + c.id;
      levels.push({ type: key, mix: [[key, 5], ['scout', 3], ['gunner', 2]] });
    }
    levels.push(this.FINAL);
    return levels;
  },

  // shuffled list of enemy keys to spawn for one level
  spawnList(level) {
    const list = [];
    for (const [type, n] of level.mix) for (let i = 0; i < n; i++) list.push(type);
    const boss = list.indexOf('boss');
    if (boss >= 0) list.splice(boss, 1);
    for (let i = list.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [list[i], list[j]] = [list[j], list[i]];
    }
    if (boss >= 0) list.splice(2, 0, 'boss'); // the boss walks in early, its helpers keep coming
    return list;
  },

  info(type) { return ENEMY_INFO[type] || CustomEnemies.info(type) || ENEMY_INFO.scout; },

  // big card in the middle of the screen: "level 3 of 7 — new enemy: ..."
  showIntro(levelNum, total, type) {
    const info = this.info(type);
    const el = document.getElementById('levelIntro');
    el.querySelector('.li-level').textContent = levelNum === total ? `שלב ${levelNum} מתוך ${total} — השלב האחרון!` : `שלב ${levelNum} מתוך ${total}`;
    el.querySelector('.li-new').textContent = info.custom ? 'האויב שלך מגיע!' : type === 'boss' ? 'בוס!' : 'אויב חדש!';
    el.querySelector('.li-name').textContent = info.name;
    el.querySelector('.li-desc').textContent = info.desc;
    const cv = el.querySelector('canvas');
    const c = cv.getContext('2d');
    c.clearRect(0, 0, cv.width, cv.height);
    c.save();
    c.translate(cv.width / 2, cv.height / 2);
    c.scale(38 / info.r, 38 / info.r);
    c.rotate(-Math.PI / 2);
    drawEnemyShape2D(c, info.shape, info.r, info.color, false);
    c.restore();
    el.style.setProperty('--enemy', info.color);
    el.classList.add('hidden');
    void el.offsetWidth; // restart the CSS animation
    el.classList.remove('hidden');
    clearTimeout(this.introTO);
    this.introTO = setTimeout(() => el.classList.add('hidden'), 2800);
  },
  hideIntro() { clearTimeout(this.introTO); document.getElementById('levelIntro').classList.add('hidden'); },
};

// ---------- the enemy builder screen ----------
const Builder = {
  draft: null,
  open(onClose) {
    this.onClose = onClose;
    this.newDraft();
    this.renderList();
    document.getElementById('builderScreen').classList.remove('hidden');
    const loop = now => {
      if (document.getElementById('builderScreen').classList.contains('hidden')) return;
      this.drawPreview(now);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  },
  close() {
    document.getElementById('builderScreen').classList.add('hidden');
    if (this.onClose) this.onClose();
  },
  newDraft() {
    this.draft = CustomEnemies.blank();
    this.draft.color = pickOne(ENEMY_COLORS);
    this.draft.shape = pickOne(ENEMY_SHAPES).id;
    this.say('');
    this.refreshForm();
  },
  say(text, bad) {
    const m = document.getElementById('bMsg');
    m.textContent = text;
    m.classList.toggle('bad', !!bad);
  },

  build() {
    const root = document.getElementById('builderScreen');
    const chips = (id, items, render, key) => {
      const box = root.querySelector('#' + id);
      for (const it of items) {
        const b = document.createElement('button');
        b.className = 'chip';
        b.dataset.val = it.id || it;
        b.innerHTML = render(it);
        b.onclick = () => { this.draft[key] = it.id || it; this.refreshForm(); };
        box.appendChild(b);
      }
    };
    chips('bShapes', ENEMY_SHAPES, s => s.name, 'shape');
    chips('bColors', ENEMY_COLORS, c => `<span class="dot" style="background:${c};color:${c}"></span>`, 'color');
    chips('bBehaviors', ENEMY_BEHAVIORS, b => b.name, 'behavior');
    for (const st of root.querySelectorAll('.stepper')) {
      const k = st.dataset.k, max = Number(st.dataset.max);
      st.innerHTML = `<button class="step minus">−</button><span class="pips"></span><button class="step plus">+</button>`;
      st.querySelector('.pips').innerHTML = Array.from({ length: max }, () => '<i></i>').join('');
      st.querySelector('.minus').onclick = () => { this.draft[k] = Math.max(1, this.draft[k] - 1); this.refreshForm(); };
      st.querySelector('.plus').onclick = () => { this.draft[k] = Math.min(max, this.draft[k] + 1); this.refreshForm(); };
    }
    root.querySelector('#bName').oninput = e => { this.draft.name = e.target.value; };
    root.querySelector('#bSplits').onchange = e => { this.draft.splits = e.target.checked; this.refreshForm(); };
    root.querySelector('#bSave').onclick = () => this.save();
    root.querySelector('#bNew').onclick = () => this.newDraft();
    root.querySelector('#bClose').onclick = () => this.close();
  },

  refreshForm() {
    const root = document.getElementById('builderScreen');
    const d = this.draft;
    for (const [id, key] of [['bShapes', 'shape'], ['bColors', 'color'], ['bBehaviors', 'behavior']]) {
      for (const b of root.querySelectorAll(`#${id} .chip`)) b.classList.toggle('selected', b.dataset.val === d[key]);
    }
    for (const st of root.querySelectorAll('.stepper')) {
      st.querySelectorAll('.pips i').forEach((i, n) => i.classList.toggle('on', n < d[st.dataset.k]));
    }
    root.querySelector('#bName').value = d.name;
    root.querySelector('#bSplits').checked = d.splits;
    root.querySelector('#bBehaviorDesc').textContent = ENEMY_BEHAVIORS.find(b => b.id === d.behavior).desc;
    root.querySelector('#bSave').textContent = d.id ? '💾 שמור שינויים' : '💾 שמור אויב';
    root.style.setProperty('--enemy', d.color);
    const def = CustomEnemies.toDef(d);
    root.querySelector('#bStats').innerHTML =
      `<div>❤️ חיים: <b>${def.hp}</b></div><div>👟 מהירות: <b>${d.speed}</b>/5</div><div>💥 נזק: <b>${d.power}</b>/5</div><div>⭐ ניקוד: <b>${def.score}</b></div>`;
  },

  drawPreview(now) {
    const cv = document.getElementById('bPreview');
    const c = cv.getContext('2d');
    const d = this.draft;
    const r = CustomEnemies.toDef(d).r;
    c.clearRect(0, 0, cv.width, cv.height);
    c.save();
    c.translate(cv.width / 2, cv.height / 2);
    c.scale(3.2, 3.2); // bigger enemies look bigger, the biggest still fits
    c.rotate(-Math.PI / 2 + Math.sin(now / 700) * 0.6);
    drawEnemyShape2D(c, d.shape, r, d.color, false);
    c.restore();
  },

  save() {
    const d = this.draft;
    const name = (d.name || '').trim();
    if (!name) { this.say('תן שם לאויב שלך ✏️', true); document.getElementById('bName').focus(); return; }
    const list = CustomEnemies.all();
    if (!d.id && list.length >= CustomEnemies.MAX) { this.say(`אפשר עד ${CustomEnemies.MAX} אויבים. מחק אחד כדי לבנות חדש.`, true); return; }
    const rec = { ...d, name: name.slice(0, 14) };
    if (rec.id) {
      const i = list.findIndex(c => c.id === rec.id);
      if (i >= 0) list[i] = rec; else list.push(rec);
    } else {
      rec.id = Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36);
      list.push(rec);
    }
    CustomEnemies.saveAll(list);
    this.draft = { ...rec };
    this.say(`${rec.name} נשמר! הוא יחכה לך בשלב לפני הבוס 😈`);
    this.renderList();
    this.refreshForm();
  },

  renderList() {
    const box = document.getElementById('bList');
    const list = CustomEnemies.all();
    box.innerHTML = list.length ? '' : '<div class="b-empty">עוד לא בנית אויבים. בנה את הראשון!</div>';
    for (const c of list) {
      const item = document.createElement('div');
      item.className = 'b-item';
      item.innerHTML = `<canvas width="60" height="60"></canvas><span class="nm">${escapeHtml(c.name)}</span>
        <button class="b-edit" title="ערוך">✏️</button><button class="b-del" title="מחק">🗑️</button>`;
      const cv = item.querySelector('canvas'), cx = cv.getContext('2d');
      const r = CustomEnemies.toDef(c).r;
      cx.translate(30, 30); cx.scale(20 / r, 20 / r); cx.rotate(-Math.PI / 2);
      drawEnemyShape2D(cx, c.shape, r, c.color, false);
      item.querySelector('.b-edit').onclick = () => { this.draft = { ...CustomEnemies.blank(), ...c }; this.say(''); this.refreshForm(); };
      item.querySelector('.b-del').onclick = () => {
        CustomEnemies.saveAll(CustomEnemies.all().filter(x => x.id !== c.id));
        if (this.draft.id === c.id) this.newDraft();
        this.say(`${c.name} נמחק`);
        this.renderList();
      };
      box.appendChild(item);
    }
  },
};

// ---------- screens shared by both games ----------
(function injectSharedScreens() {
  const app = document.getElementById('app');
  app.insertAdjacentHTML('beforeend', `
  <div id="levelIntro" class="level-intro hidden">
    <div class="li-level"></div>
    <canvas width="120" height="120"></canvas>
    <div class="li-new"></div>
    <div class="li-name"></div>
    <div class="li-desc"></div>
  </div>

  <div id="victoryScreen" class="overlay hidden">
    <div class="panel">
      <div class="trophy">🏆</div>
      <h2 class="win">ניצחת!</h2>
      <p class="subtitle">סיימת את כל השלבים והבסת את הבוס הגדול!</p>
      <p id="victoryStats" class="subtitle"></p>
      <button id="victoryAgainBtn" class="btn">שחק שוב</button>
      <div class="row-links">
        <button id="victoryHangarBtn" class="link-btn as-button">🎨 לעצב את הרובוט</button>
        <button id="victoryBuilderBtn" class="link-btn as-button">🛠️ לבנות אויבים</button>
      </div>
    </div>
  </div>

  <div id="builderScreen" class="overlay hidden">
    <div class="panel wide builder">
      <h2>🛠️ בונה אויבים</h2>
      <div class="builder-grid">
        <div class="builder-preview">
          <canvas id="bPreview" width="220" height="220"></canvas>
          <div id="bStats" class="b-stats"></div>
        </div>
        <div class="builder-form">
          <label class="b-row"><span class="lbl">שם</span><input id="bName" maxlength="14" placeholder="למשל: מפלצת ברזל" autocomplete="off"></label>
          <div class="b-row"><span class="lbl">צורה</span><div id="bShapes" class="chips"></div></div>
          <div class="b-row"><span class="lbl">צבע</span><div id="bColors" class="chips"></div></div>
          <div class="b-row"><span class="lbl">מה הוא עושה</span><div id="bBehaviors" class="chips"></div></div>
          <div class="b-row"><span class="lbl"></span><div id="bBehaviorDesc" class="b-desc"></div></div>
          <div class="b-row"><span class="lbl">גודל</span><div class="stepper" data-k="size" data-max="3"></div></div>
          <div class="b-row"><span class="lbl">מהירות</span><div class="stepper" data-k="speed" data-max="5"></div></div>
          <div class="b-row"><span class="lbl">שריון</span><div class="stepper" data-k="armor" data-max="5"></div></div>
          <div class="b-row"><span class="lbl">כוח</span><div class="stepper" data-k="power" data-max="5"></div></div>
          <label class="b-row check"><span class="lbl"></span><span><input type="checkbox" id="bSplits"> מתפצל לשניים כשמשמידים אותו</span></label>
        </div>
      </div>
      <div class="b-actions">
        <button id="bSave" class="btn">💾 שמור אויב</button>
        <button id="bNew" class="link-btn as-button">➕ אויב חדש</button>
      </div>
      <div id="bMsg" class="shop-msg"></div>
      <h3 class="section-title">האויבים שבנית — כל אחד מקבל שלב משלו לפני הבוס</h3>
      <div id="bList" class="b-list"></div>
      <button id="bClose" class="link-btn as-button">→ חזרה</button>
    </div>
  </div>`);
  Builder.build();
  Points.refresh();
})();

// Typing in a text box must not move the robot or trigger game keys.
function isTyping(e) {
  const t = e.target;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
}
