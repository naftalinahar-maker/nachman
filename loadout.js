'use strict';

/* ============================================================
   Shared by the 2D and 3D games: robot types, colors, upgrades,
   and the hangar / upgrade screens (plain DOM, no engine code).
   Robot sizes and speeds are in 2D pixel units; the 3D game scales them.
   ============================================================ */

// ---------- robots & colors (chosen in the hangar) ----------
const ROBOTS = {
  striker: { name: 'ברק', desc: 'מהיר וזריז, שריון קל', r: 14, speed: 300, hp: 75, dashCd: 0.9, laserDmg: 10, shape: 'dart',
             bars: { speed: 3, armor: 1, power: 2 } },
  warrior: { name: 'לוחם', desc: 'מאוזן — טוב בהכל', r: 16, speed: 240, hp: 100, dashCd: 1.4, laserDmg: 12, shape: 'arrow',
             bars: { speed: 2, armor: 2, power: 2 } },
  tank:    { name: 'טנק', desc: 'איטי, חזק ועמיד מאוד', r: 20, speed: 185, hp: 150, dashCd: 1.9, laserDmg: 15, shape: 'block',
             bars: { speed: 1, armor: 3, power: 3 } },
};
const ROBOT_ORDER = ['striker', 'warrior', 'tank'];

const COLORS = [
  { name: 'תכלת', hex: '#4ff3ff' },
  { name: 'ירוק', hex: '#4fe07d' },
  { name: 'צהוב', hex: '#ffd447' },
  { name: 'כתום', hex: '#ff9a3d' },
  { name: 'ורוד', hex: '#ff78f0' },
  { name: 'סגול', hex: '#a78bfa' },
];

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

// ---------- upgrades (picked between waves) ----------
const UPGRADES = [
  { id: 'armor',   icon: '🛡️', name: 'שריון עבה',     desc: '+25 שריון מקסימלי, וגם מתקן 25',      apply: p => { p.maxHealth += 25; p.health = Math.min(p.maxHealth, p.health + 25); } },
  { id: 'repair',  icon: '🔧', name: 'תיקון מלא',     desc: 'השריון חוזר למלא',                    apply: p => { p.health = p.maxHealth; }, ok: p => p.health < p.maxHealth * 0.8, repeat: true },
  { id: 'speed',   icon: '⚙️', name: 'מנועים מהירים',  desc: 'הרובוט זז מהר יותר ב-12%',            apply: p => { p.speed *= 1.12; } },
  { id: 'laser',   icon: '🔫', name: 'לייזר חזק',      desc: '+25% נזק ללייזר',                     apply: p => { p.laserDmg *= 1.25; } },
  { id: 'cooling', icon: '❄️', name: 'מערכת קירור',    desc: 'הנשק מתחמם לאט יותר (20%-)',          apply: p => { p.heatPerShot *= 0.8; } },
  { id: 'missile', icon: '🚀', name: 'עוד טיל',        desc: 'יורה טיל נוסף בכל פעם',               apply: p => { p.missileCount++; }, max: 3 },
  { id: 'blade',   icon: '⚔️', name: 'להב ארוך',       desc: 'הלהב מגיע רחוק יותר וחזק יותר',       apply: p => { p.meleeRange *= 1.25; p.meleeDmg *= 1.2; } },
  { id: 'shock',   icon: '💥', name: 'גל הלם על',     desc: 'נטען מהר יותר וגדול יותר',            apply: p => { p.shockCd *= 0.75; p.shockRadius *= 1.12; } },
  { id: 'dash',    icon: '💨', name: 'דאש טורבו',      desc: 'הדאש נטען מהר יותר ב-30%',            apply: p => { p.dashCooldown *= 0.7; } },
];

const Loadout = {
  STORAGE_KEY: 'rs_loadout', // shared so both games remember the same robot

  load() {
    const out = { robot: 'warrior', color: COLORS[0].hex, hat: 'none', trail: 'none' };
    try {
      const saved = JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '{}');
      if (ROBOTS[saved.robot]) out.robot = saved.robot;
      const premium = PREMIUM_COLORS.find(c => c.hex === saved.color);
      if (COLORS.some(c => c.hex === saved.color) || (premium && Shop.has(premium.id))) out.color = saved.color;
      if (HATS.some(h => h.id === saved.hat) && Shop.has(saved.hat)) out.hat = saved.hat;
      if (TRAILS.some(t => t.id === saved.trail) && Shop.has(saved.trail)) out.trail = saved.trail;
    } catch (e) { /* storage unavailable */ }
    return out;
  },

  save(look) {
    const { robot, color, hat, trail } = look;
    try { localStorage.setItem(this.STORAGE_KEY, JSON.stringify({ robot, color, hat, trail })); } catch (e) { /* ignore */ }
  },

  // the "robot" / "design with points" tabs in the hangar
  bindTabs() {
    for (const t of document.querySelectorAll('#hangarScreen .tab')) {
      t.onclick = () => this.showTab(t.dataset.tab);
    }
  },
  showTab(name) {
    for (const t of document.querySelectorAll('#hangarScreen .tab')) t.classList.toggle('selected', t.dataset.tab === name);
    for (const p of document.querySelectorAll('#hangarScreen .tab-pane')) p.classList.toggle('hidden', p.dataset.pane !== name);
  },

  // fills #robotCards and #colorSwatches; returns { robotKey: canvas } when withPreview
  buildHangar(onRobot, onColor, withPreview) {
    const previews = {};
    const cards = document.getElementById('robotCards');
    const pips = n => '<span class="pips">' + [1, 2, 3].map(k => `<i class="${k <= n ? 'on' : ''}"></i>`).join('') + '</span>';
    ROBOT_ORDER.forEach((key, i) => {
      const def = ROBOTS[key];
      const btn = document.createElement('button');
      btn.className = 'robot-card';
      btn.dataset.robot = key;
      btn.innerHTML = `${withPreview ? '<canvas width="240" height="240"></canvas>' : ''}
        <div class="name">${i + 1}. ${def.name}</div>
        <div class="desc">${def.desc}</div>
        <div class="stat-row"><span>מהירות</span>${pips(def.bars.speed)}</div>
        <div class="stat-row"><span>שריון</span>${pips(def.bars.armor)}</div>
        <div class="stat-row"><span>כוח אש</span>${pips(def.bars.power)}</div>`;
      btn.onclick = () => onRobot(key);
      cards.appendChild(btn);
      if (withPreview) previews[key] = btn.querySelector('canvas');
    });
    const sw = document.getElementById('colorSwatches');
    for (const c of COLORS) {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.title = c.name;
      b.style.background = c.hex;
      b.style.color = c.hex;
      b.dataset.color = c.hex;
      b.onclick = () => onColor(c.hex);
      sw.appendChild(b);
    }
    return previews;
  },

  refreshHangar(robot, color) {
    document.getElementById('hangarScreen').style.setProperty('--pick', color);
    for (const btn of document.querySelectorAll('.robot-card')) btn.classList.toggle('selected', btn.dataset.robot === robot);
    for (const b of document.querySelectorAll('.swatch')) b.classList.toggle('selected', b.dataset.color === color);
  },

  // keyboard in the hangar: 1/2/3 pick a robot, arrows cycle the color
  hangarKey(code, robot, color) {
    const num = { Digit1: 0, Digit2: 1, Digit3: 2, Numpad1: 0, Numpad2: 1, Numpad3: 2 }[code];
    if (num !== undefined) return { robot: ROBOT_ORDER[num] };
    const ci = COLORS.findIndex(c => c.hex === color);
    if (code === 'ArrowDown' || code === 'ArrowLeft') return { color: COLORS[(ci + 1) % COLORS.length].hex };
    if (code === 'ArrowUp' || code === 'ArrowRight') return { color: COLORS[(ci + COLORS.length - 1) % COLORS.length].hex };
    return null;
  },

  numKey(code) {
    return { Digit1: 0, Digit2: 1, Digit3: 2, Numpad1: 0, Numpad2: 1, Numpad3: 2 }[code];
  },

  // three random upgrades the player can still take
  rollUpgrades(p) {
    const pool = UPGRADES.filter(u => (!u.max || (p.upgrades[u.id] || 0) < u.max - 1) && (!u.ok || u.ok(p)));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, 3);
  },

  showUpgradeScreen(wave, choices, p, onChoose) {
    document.getElementById('upgradeTitle').textContent = `שלב ${wave} הושלם!`;
    const box = document.getElementById('upgradeCards');
    box.innerHTML = '';
    choices.forEach((u, i) => {
      const lvl = p.upgrades[u.id] || 0;
      const b = document.createElement('button');
      b.className = 'upgrade-card';
      b.innerHTML = `<div class="num">${i + 1}</div>
        <div class="icon">${u.icon}</div>
        <div class="name">${u.name}</div>
        <div class="desc">${u.desc}</div>
        <div class="level">${u.repeat ? '' : lvl ? `רמה ${lvl} ← ${lvl + 1}` : 'חדש!'}</div>`;
      b.onclick = () => onChoose(u);
      box.appendChild(b);
    });
    document.getElementById('upgradeScreen').classList.remove('hidden');
  },

  applyUpgrade(p, u) {
    u.apply(p);
    p.upgrades[u.id] = (p.upgrades[u.id] || 0) + 1;
    document.getElementById('upgradeScreen').classList.add('hidden');
  },
};
