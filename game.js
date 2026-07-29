'use strict';

/* ============================== Utilities ============================== */

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function firstName(fullName) { return fullName.split(' ')[0]; }

function safeLocalGet(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch (e) { return fallback; }
}
function safeLocalSet(key, val) {
  try { localStorage.setItem(key, val); } catch (e) { /* storage unavailable, ignore */ }
}

/* ============================== Content data ============================== */

const LAST_NAMES = ['כהן', 'לוי', 'גרין', 'רוזנברג', 'שוורץ', 'פרידמן', 'וייס', 'קפלן', 'אשכולי', 'ברקוביץ'];
const FIRST_M = ['שלמה', 'משה', 'אברהם', 'יעקב', 'מנחם', 'ברוך', 'שמעון', 'נתן'];
const FIRST_F = ['רבקה', 'שרה', 'מרים', 'לאה', 'חנה', 'רחל', 'גולדה', 'פייגה'];

const ARCHETYPES = [
  {
    key: 'shochet', jobTitle: 'השוחט הכשר', gender: 'm',
    locId: 'market1', locLabel: 'דוכן הקצביה בשוק', bgType: 'market', tint: '#b3392b',
    portrait: { skin: '#d9a86c', cloth: '#5a4a3a', apron: true, apronColor: '#f2efe6', facial: 'mustache', hat: 'flatcap', hatColor: '#3a2a1c' },
    alibiPlace: 'בשוק, בודק משלוח בשר טרי מהספק', alibiProof: 'קבלת משלוח עם חותמת שעה מדויקת',
    hidingSpot: 'גיליון העיתון הישן שמונח על דוכן הבשר',
    greet: 'נו, בלש נחמן, מה כבר יש לחקור? יש לי עוף טרי שמחכה לפני שהוא מתקלקל.',
    idle: ['הסכין הזאת חדה כמו שמועה בשכונה שלנו.', 'תגיד לי כשתגלה מי עשה את זה — בינתיים הבשר לא שוחט את עצמו.'],
    nervousIdle: 'למה אתה עדיין כאן, בלש? יש לי... יש לי הרבה עבודה היום.'
  },
  {
    key: 'cantor', jobTitle: 'החזן של בית הכנסת', gender: 'm',
    locId: 'shul1', locLabel: 'הבימה בבית הכנסת', bgType: 'shul', tint: '#3a5a8a',
    portrait: { skin: '#e0b48a', cloth: '#2c2440', facial: 'beard', tallis: true },
    alibiPlace: 'בחזרות מקהלה שנמשכו עד שעה מאוחרת', alibiProof: 'עדותם המשותפת של אנשי המקהלה',
    hidingSpot: 'ניירות התווים המונחים על עמוד התפילה',
    greet: 'הקול שלי מוקדש לתפילה, בלש, לא לרכילות. אבל שאל, אני אשתדל לעזור.',
    idle: ['שיר טוב מרפא את הנשמה, גם כשהיא דואגת.', 'אני מקווה שתמצא את מי שעשה את זה, זה מכביד על כל הקהילה.'],
    nervousIdle: 'הגרון שלי... יבש היום. קשה לי לדבר עכשיו, באמת.'
  },
  {
    key: 'grocer', jobTitle: 'בעלת המכולת', gender: 'f',
    locId: 'market2', locLabel: 'המכולת של השכונה', bgType: 'market', tint: '#4a7a4a',
    portrait: { skin: '#cf9a6a', cloth: '#5a7a5a', apron: true, apronColor: '#e8dcb0', hat: 'scarf', hatColor: '#b3392b' },
    alibiPlace: 'סוגרת את הקופה וסופרת סחורה עד הלילה', alibiProof: 'פנקס הקופה עם רישום השעה המדויק',
    hidingSpot: 'ארגז הסחורה הריק במחסן הקטן',
    greet: 'תרצה תפוח, בלש? זה טרי מהבוקר. עכשיו, מה אתה רוצה לדעת?',
    idle: ['הלקוחות מדברים על זה כל היום, האמת.', 'אני מקווה שתתפוס אותם מהר, זה לא בריא לעסקים בשכונה.'],
    nervousIdle: 'ה... הקופה לא מסתדרת לי היום, סליחה, בוא נדבר אחר כך.'
  },
  {
    key: 'matchmaker', jobTitle: 'השדכנית של השכונה', gender: 'f',
    locId: 'cafe1', locLabel: 'השולחן הקבוע בבית הקפה', bgType: 'cafe', tint: '#9a4a6a',
    portrait: { skin: '#e8c39a', cloth: '#9a4a6a', hat: 'flowerhat', hatColor: '#7a3a5a', facial: 'glasses' },
    alibiPlace: 'בפגישת שידוך חשובה אצל משפחה אחרת', alibiProof: 'מכתב תודה חתום מהמשפחה המדוברת',
    hidingSpot: 'תיק המסמכים האישי, מתחת לפנקס השידוכים',
    greet: 'בלש נחמן! יושב לבד? יש לי בחורה מושלמת בשבילך. אה, ואתה רצית לשאול משהו, נכון?',
    idle: ['רכילות היא לא חטא, זה מקצוע.', 'אני יודעת הכל על כולם בשכונה הזאת. כמעט הכל.'],
    nervousIdle: 'בוא נדבר על משהו אחר, נו? מה שלום אמא שלך?'
  },
  {
    key: 'jeweler', jobTitle: 'הצורף ותכשיטן', gender: 'm',
    locId: 'workshop1', locLabel: 'סדנת הצורף', bgType: 'workshop', tint: '#d99a3d',
    portrait: { skin: '#d9a86c', cloth: '#4a3a2a', apron: true, apronColor: '#3a3a3a', facial: 'loupe' },
    alibiPlace: 'בתערוכת תכשיטים בעיר השכנה', alibiProof: 'כרטיס כניסה לתערוכה עם תאריך מודפס',
    hidingSpot: 'הכספת הקטנה שנשארה פתוחה למחצה',
    greet: 'זהירות עם האצבעות, יש כאן חומרים יקרים. מה אתה מחפש, בלש?',
    idle: ['זהב לא משקר, בלש. אנשים כן.', 'אני מקווה שהעבודה שלי לא תיפגע מכל הבלגן הזה.'],
    nervousIdle: 'האור כאן... חלש היום. קשה לי להראות לך משהו כרגע.'
  },
  {
    key: 'gabbai', jobTitle: 'הגבאי של בית הכנסת', gender: 'm',
    locId: 'shul2', locLabel: 'מחסן הספרים של בית הכנסת', bgType: 'shul', tint: '#6a4a8a',
    portrait: { skin: '#c99a6a', cloth: '#3a3a2a', facial: 'fullbeard', hat: 'kippah', hatColor: '#1c1c3a' },
    alibiPlace: 'מסדר סידורים ומפתחות עד השעות הקטנות', alibiProof: 'עדות של המתפללים האחרונים שיצאו',
    hidingSpot: 'הארון העתיק שבו שמורים ספרי הקהילה',
    greet: 'ברוך הבא, בלש. בית הכנסת פתוח לכולם, גם לחוקרים.',
    idle: ['המפתחות האלה זוכרים כל דלת שנפתחה כאן.', 'אני שומר על המקום הזה עשרים שנה, זה כואב לי אישית.'],
    nervousIdle: 'המפתחות שלי... איפה שמתי את המפתחות שלי. רגע.'
  }
];

const CASE_TEMPLATES = [
  { stolenItem: 'כתר הכסף של ספר התורה', crimeLocLabel: 'בבית הכנסת', ownerLabel: 'כל הקהילה' },
  { stolenItem: 'גביע הקידוש המשפחתי העתיק', crimeLocLabel: 'בביתו של הרב אשכולי', ownerLabel: 'הרב אשכולי' },
  { stolenItem: 'שעון הכיס של הסבא, מורשת המשפחה', crimeLocLabel: 'בדירתה של גברת פרל', ownerLabel: 'גברת פרל, אלמנה כבודה' },
  { stolenItem: 'תכשיט האירוסין שהוזמן במיוחד', crimeLocLabel: 'בסדנת הצורף', ownerLabel: 'זוג צעיר מהשכונה' }
];

const METHODS = ['מפתח כפול מזויף', 'סולם שהוסתר מאחורי הבניין', 'כלי פריצה מקצועי', 'חלון אחורי שהושאר פתוח בכוונה', 'מפתח רזרבי שהוחלף בשקט', 'עגלת יד קטנה כדי לצאת בלי לעורר חשד'];
const MOTIVES = ['חוב כספי ישן שלא נפרע', 'קנאה על ירושה שהובטחה למישהו אחר', 'סוד ישן שאיים להתגלות', 'תחרות עסקית מרה בין השניים', 'אהבה נכזבת מלפני שנים רבות', 'עלבון כבוד משפחתי שמעולם לא נסלח'];

const OFFICE_FLAVORS = [
  'על הקיר תלויה תעודת הוקרה מהקהילה, קצת עקומה.',
  'ריח של תה צמחים עדיין נודף מהספל על השולחן.',
  'רדיו ישן משדר בשקט את מהדורת החדשות.',
  'תיק התיקים הישנים תפוח מרוב עבודה.',
  'מישהו השאיר כאן מטריה שחורה ישנה, שוב.'
];
const CRIME_FLAVORS = [
  'וילון קרוע מתנפנף בעדינות מהחלון הפתוח.',
  'כוס תה קרה עדיין עומדת על השולחן, לא נגעו בה.',
  'שעון קיר ישן נעצר בדיוק בשעת האירוע.',
  'שטיח מקומט מעיד שמישהו נאבק כאן, או מיהר.'
];
const GENERIC_FLAVORS = [
  'תמונה משפחתית מצהיבה עומדת על המדף.',
  'קופת צדקה נשמעת חצי מלאה כשמנערים אותה.',
  'לוח שנה ישן עדיין פתוח בחודש הקודם.',
  'ניחוח של עוגת דבש טרייה ממלא את החלל.',
  'מישהו שכח כאן זוג משקפי קריאה.'
];

const LOC_LABELS = { office: 'המשרד של נחמן', crimescene: 'זירת הגניבה' };

/* ============================== Case generation ============================== */

let caseCounter = parseInt(safeLocalGet('nachman_case_counter', '0'), 10);
let casesSolvedTotal = parseInt(safeLocalGet('nachman_cases_solved', '0'), 10);

function buildSuspectInstance(archetype, idx) {
  const first = archetype.gender === 'f' ? pick(FIRST_F) : pick(FIRST_M);
  const last = pick(LAST_NAMES);
  const spec = archetype.portrait;
  return {
    instanceId: 'sus' + idx,
    archetypeKey: archetype.key,
    name: `${first} ${last}`,
    jobTitle: archetype.jobTitle,
    locId: archetype.locId,
    locLabel: archetype.locLabel,
    bgType: archetype.bgType,
    tint: archetype.tint,
    portraitSpec: spec,
    portraitURL: makePortraitDataURL(spec),
    greet: archetype.greet,
    idleLines: archetype.idle,
    nervousIdle: archetype.nervousIdle,
    alibiPlace: archetype.alibiPlace,
    alibiProof: archetype.alibiProof,
    hidingSpot: archetype.hidingSpot,
    guilty: false
  };
}

function generateCase() {
  caseCounter++;
  safeLocalSet('nachman_case_counter', String(caseCounter));

  const template = pick(CASE_TEMPLATES);
  const method = pick(METHODS);
  const motive = pick(MOTIVES);
  const chosenArchetypes = shuffle(ARCHETYPES).slice(0, 4);
  const suspects = chosenArchetypes.map((a, i) => buildSuspectInstance(a, i));
  const guiltyIndex = randInt(0, suspects.length - 1);
  suspects[guiltyIndex].guilty = true;
  const guiltySuspect = suspects[guiltyIndex];

  const c = {
    id: caseCounter,
    stolenItem: template.stolenItem,
    crimeLocLabel: template.crimeLocLabel,
    ownerLabel: template.ownerLabel,
    method, motive,
    suspects,
    guiltySuspect,
    foundClueIds: new Set(),
    foundOrder: [],
    spotFoundIds: new Set(),
    wrongAccusations: 0
  };

  c.clues = [];
  c.clues.push({
    id: 'method_trace',
    text: `בזירת הגניבה ${c.crimeLocLabel} נמצאו סימנים ל${c.method}. מי שעשה זאת ידע בדיוק מה הוא עושה.`
  });
  suspects.forEach(s => {
    if (s.guilty) {
      c.clues.push({
        id: 'motive_' + s.instanceId,
        forSuspect: s.instanceId,
        text: `מאחורי ${s.hidingSpot} התגלה מסמך מטריד: ${c.motive}. זה הקשר בין ${s.name} לבין העלמותו/ה של ${c.stolenItem}.`
      });
    } else {
      c.clues.push({
        id: 'alibi_' + s.instanceId,
        forSuspect: s.instanceId,
        clears: true,
        text: `${s.name} (${s.jobTitle}) מציג/ה ${s.alibiProof}, שמוכיח שבזמן הגניבה היה/תה ${s.alibiPlace}. נראה ש${firstName(s.name)} נקי/ה מחשד.`
      });
    }
  });

  c.locations = buildLocationsMap(c);
  return c;
}

function buildLocationsMap(c) {
  const map = {};
  map.office = {
    label: LOC_LABELS.office, bgType: 'office', tint: '#d99a3d',
    spots: [
      { id: 'office_decor', kind: 'examine', x: 22, y: 55, tip: 'הביטו סביב המשרד', text: pick(OFFICE_FLAVORS) }
    ]
  };
  map.crimescene = {
    label: LOC_LABELS.crimescene, bgType: 'crimescene', tint: '#3a5a8a',
    spots: [
      { id: 'method_trace', kind: 'examine', x: 36, y: 80, tip: 'בדקו את הזירה', isClue: true },
      { id: 'crime_decor', kind: 'examine', x: 80, y: 42, tip: 'הביטו מסביב', text: pick(CRIME_FLAVORS) }
    ]
  };
  c.suspects.forEach(s => {
    map[s.locId] = {
      label: s.locLabel, bgType: s.bgType, tint: s.tint, suspectId: s.instanceId,
      spots: [
        { id: 'talk_' + s.instanceId, kind: 'talk', x: 58, y: 82, tip: 'שוחחו עם ' + s.name, suspectId: s.instanceId },
        { id: 'decor_' + s.instanceId, kind: 'examine', x: 86, y: 38, tip: 'משהו מעניין כאן', text: pick(GENERIC_FLAVORS) }
      ]
    };
  });
  return map;
}

function introBrief(c) {
  const names = c.suspects.map(s => s.name).join(', ');
  return `אתמול בלילה נעלם/ה ${c.stolenItem} ${c.crimeLocLabel}. ${c.ownerLabel} בהלם גמור. מי שביצע את הגניבה השתמש/ה כנראה ב${c.method} כדי לחמוק בלי להשאיר עקבות מיותרים.<br><br>` +
    `ארבעה תושבים מוכרים היו בסביבה באותו הערב: <b>${names}</b>.<br><br>` +
    `בלש נחמן — השכונה כולה סומכת עליך. חפשו רמזים, אספו חפצים, ושוחחו עם התושבים. כשתאספו את כל הרמזים, פתחו את הפנקס והצביעו על האשם.`;
}

/* ============================== Pixel art rendering ============================== */

const GW = 240, GH = 160;
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

function R(x, y, w, h, color) { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); }

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) + amt, g = ((n >> 8) & 0xff) + amt, b = (n & 0xff) + amt;
  r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
  return '#' + (1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1);
}

function drawFloor(y, h, base) {
  R(0, y, GW, h, base);
  for (let x = -10; x < GW; x += 20) R(x, y, 1, h, shade(base, -22));
}

function drawWindow(x, y, w, h, skyTop, skyBottom) {
  R(x - 2, y - 2, w + 4, h + 4, '#1c130c');
  R(x, y, w, h, skyTop);
  R(x, y + h * 0.6, w, h * 0.4, skyBottom);
  R(x + w * 0.6, y + h * 0.15, 5, 5, '#f2e6b8');
}

function bgOffice(tint) {
  R(0, 0, GW, GH, '#3a2a1c');
  drawFloor(100, 60, '#2a1c12');
  drawWindow(14, 16, 56, 46, '#4a3a6a', '#2a2444');
  for (let i = 0; i < 7; i++) R(14, 18 + i * 6, 56, 2, '#1c130c');
  R(70, 108, 140, 42, '#5a3a22');
  R(74, 150, 10, 10, '#2a1c12');
  R(196, 150, 10, 10, '#2a1c12');
  R(178, 92, 20, 16, '#241a12');
  R(184, 96, 8, 8, '#f2c94c');
  R(186, 98, 4, 4, '#fff3c4');
  R(214, 30, 4, 78, '#241a12');
  R(202, 26, 26, 10, tint);
  R(198, 20, 34, 8, tint);
  R(90, 112, 34, 4, '#e8dcb0');
  R(95, 118, 24, 3, '#c9b48a');
}

function bgCrimescene(tint) {
  R(0, 0, GW, GH, '#241a2c');
  drawFloor(100, 60, '#1c1428');
  drawWindow(160, 16, 50, 46, '#12102a', '#0a0818');
  R(178, 24, 10, 10, '#e8dcc4');
  R(30, 90, 34, 30, shade(tint, -40));
  R(30, 116, 34, 4, '#0c0810');
  R(20, 130, 3, 3, '#f2efe6');
  R(28, 134, 3, 3, '#f2efe6');
  R(36, 132, 3, 3, '#f2efe6');
  R(44, 128, 3, 3, '#f2efe6');
  R(150, 96, 40, 8, '#3a2c1c');
  R(150, 104, 6, 20, '#3a2c1c');
  R(184, 104, 6, 20, '#3a2c1c');
  R(60, 60, 20, 30, '#1c1428');
  R(64, 60, 12, 3, '#4a3a5a');
}

function bgShul(tint) {
  R(0, 0, GW, GH, '#2a2038');
  drawFloor(102, 58, '#241c30');
  R(90, 10, 60, 60, '#1c1628');
  R(96, 16, 48, 48, tint);
  for (let i = 0; i < 4; i++) R(96 + i * 12, 16, 2, 48, '#1c1628');
  R(88, 96, 10, 4, '#4a3a2a');
  R(60, 96, 10, 4, '#4a3a2a');
  R(150, 96, 10, 4, '#4a3a2a');
  for (let bx = 10; bx < 230; bx += 46) { R(bx, 118, 34, 8, '#3a2a1c'); R(bx, 128, 34, 20, '#2c2016'); }
  R(112, 6, 16, 6, '#d99a3d');
  R(116, 0, 8, 8, '#d99a3d');
}

function bgMarket(tint) {
  R(0, 0, GW, GH, '#2c2418');
  drawFloor(104, 56, '#241c10');
  for (let x = 0; x < GW; x += 20) { R(x, 8, 10, 14, tint); R(x + 10, 8, 10, 14, '#e8dcc4'); }
  R(0, 22, GW, 6, '#1c130c');
  R(20, 34, 60, 50, '#4a3a22');
  for (let i = 0; i < 3; i++) { R(28 + i * 20, 40, 14, 14, shade(tint, 30)); }
  R(160, 34, 60, 50, '#4a3a22');
  for (let i = 0; i < 3; i++) { R(168 + i * 20, 40, 14, 20, shade(tint, -10)); }
  R(90, 98, 60, 10, '#5a4a30');
}

function bgCafe(tint) {
  R(0, 0, GW, GH, '#3a2c2a');
  R(0, 90, GW, 70, '#4a3634');
  for (let x = 0; x < GW; x += 16) for (let y = 90; y < GH; y += 16) {
    if (((x / 16) + (y / 16)) % 2 === 0) R(x, y, 16, 16, '#3a2826');
  }
  drawWindow(16, 16, 60, 50, '#5a4a70', '#3a3060');
  R(150, 110, 30, 26, '#241a12');
  R(150, 100, 30, 4, '#e8dcc4');
  R(160, 90, 3, 12, '#8a6a30');
  R(60, 118, 26, 20, '#241a12');
  R(60, 110, 26, 4, '#e8dcc4');
  R(200, 30, 20, 22, tint);
}

function bgWorkshop(tint) {
  R(0, 0, GW, GH, '#241c14');
  drawFloor(104, 56, '#1c140e');
  R(20, 30, 100, 60, '#3a2c1c');
  R(30, 40, 14, 10, '#5a5a5a');
  R(50, 40, 14, 10, tint);
  R(70, 40, 14, 10, '#5a5a5a');
  R(90, 40, 14, 10, tint);
  R(160, 40, 46, 50, '#1c1c1c');
  R(168, 50, 30, 30, '#2c2c2c');
  R(178, 60, 4, 4, tint);
  R(30, 96, 60, 8, '#4a3a2a');
  R(190, 100, 5, 20, '#1a1a1a');
}

const BG_DRAWERS = { office: bgOffice, crimescene: bgCrimescene, shul: bgShul, market: bgMarket, cafe: bgCafe, workshop: bgWorkshop };

function bgAlley() {
  R(0, 0, GW, GH, '#141020');
  for (let i = 0; i < 6; i++) {
    const bw = 30 + (i % 3) * 10;
    R(i * 42, 30 + (i % 2) * 10, bw, 90, '#1c1830');
    for (let wy = 36; wy < 100; wy += 14) for (let wx = 4; wx < bw - 4; wx += 12) {
      if (((wx + wy + i * 7) % 5) === 0) R(i * 42 + wx, wy + (i % 2) * 10, 6, 8, '#e8c94c55');
    }
  }
  R(190, 14, 16, 16, '#e8e0c4');
  drawFloor(120, 40, '#221c30');
  for (let x = 0; x < GW; x += 60) R(x, 120, 3, 40, '#0c0a14');
}

function drawPerson(cx, feetY, spec, scale) {
  scale = scale || 1;
  const skin = spec.skin || '#d9a86c';
  const cloth = spec.cloth || '#4a3a2a';
  const pants = spec.pants || shade(cloth, -30);
  const s = scale;
  R(cx - 9 * s, feetY - 20 * s, 8 * s, 20 * s, pants);
  R(cx + 1 * s, feetY - 20 * s, 8 * s, 20 * s, pants);
  R(cx - 15 * s, feetY - 46 * s, 30 * s, 28 * s, cloth);
  R(cx - 19 * s, feetY - 44 * s, 5 * s, 22 * s, cloth);
  R(cx + 14 * s, feetY - 44 * s, 5 * s, 22 * s, cloth);
  R(cx - 19 * s, feetY - 24 * s, 5 * s, 5 * s, skin);
  R(cx + 14 * s, feetY - 24 * s, 5 * s, 5 * s, skin);
  if (spec.apron) R(cx - 13 * s, feetY - 34 * s, 26 * s, 20 * s, spec.apronColor || '#e8e2d0');
  if (spec.tallis) { R(cx - 15 * s, feetY - 46 * s, 30 * s, 5 * s, '#f2efe6'); R(cx - 15 * s, feetY - 41 * s, 30 * s, 2 * s, '#2a2a4a'); }
  R(cx - 4 * s, feetY - 50 * s, 8 * s, 5 * s, skin);
  R(cx - 9 * s, feetY - 66 * s, 18 * s, 17 * s, skin);
  if (spec.facial === 'mustache') R(cx - 5 * s, feetY - 53 * s, 10 * s, 3 * s, '#2a2018');
  if (spec.facial === 'beard') R(cx - 8 * s, feetY - 53 * s, 16 * s, 8 * s, '#2a2018');
  if (spec.facial === 'fullbeard') R(cx - 9 * s, feetY - 53 * s, 18 * s, 13 * s, '#d8d0c0');
  if (spec.facial === 'glasses') { R(cx - 8 * s, feetY - 60 * s, 6 * s, 4 * s, '#1a1a1a'); R(cx + 2 * s, feetY - 60 * s, 6 * s, 4 * s, '#1a1a1a'); }
  if (spec.facial === 'loupe') R(cx + 6 * s, feetY - 62 * s, 5 * s, 5 * s, '#3a3a3a');
  if (spec.hair) R(cx - 9 * s, feetY - 67 * s, 18 * s, 5 * s, spec.hair);
  if (spec.hat === 'flatcap') { R(cx - 10 * s, feetY - 70 * s, 20 * s, 5 * s, spec.hatColor); R(cx - 6 * s, feetY - 74 * s, 16 * s, 5 * s, spec.hatColor); }
  if (spec.hat === 'kippah') R(cx - 6 * s, feetY - 70 * s, 12 * s, 5 * s, spec.hatColor);
  if (spec.hat === 'scarf') { R(cx - 11 * s, feetY - 69 * s, 22 * s, 8 * s, spec.hatColor); R(cx - 11 * s, feetY - 50 * s, 6 * s, 16 * s, spec.hatColor); R(cx + 5 * s, feetY - 50 * s, 6 * s, 16 * s, spec.hatColor); }
  if (spec.hat === 'flowerhat') { R(cx - 14 * s, feetY - 72 * s, 28 * s, 6 * s, spec.hatColor); R(cx - 6 * s, feetY - 77 * s, 12 * s, 6 * s, spec.hatColor); R(cx + 8 * s, feetY - 79 * s, 4 * s, 4 * s, '#e8c84a'); }
}

// Detective Nachman's own look: fedora + trench coat, used only in the finale chase.
const NACHMAN_SPEC = { skin: '#d9a86c', cloth: '#5a4632', facial: 'mustache' };
function drawNachmanFedora(cx, feetY, scale) {
  drawPerson(cx, feetY, NACHMAN_SPEC, scale);
  const s = scale || 1;
  R(cx - 13 * s, feetY - 71 * s, 26 * s, 4 * s, '#2a2018');
  R(cx - 8 * s, feetY - 78 * s, 16 * s, 8 * s, '#2a2018');
}

function makePortraitDataURL(spec) {
  const off = document.createElement('canvas');
  off.width = 40; off.height = 40;
  const c2 = off.getContext('2d');
  c2.imageSmoothingEnabled = false;
  c2.fillStyle = '#20140c'; c2.fillRect(0, 0, 40, 40);
  const draw = (x, y, w, h, color) => { c2.fillStyle = color; c2.fillRect(x, y, w, h); };
  const skin = spec.skin || '#d9a86c', cloth = spec.cloth || '#4a3a2a';
  draw(2, 28, 36, 12, cloth);
  if (spec.apron) draw(8, 30, 24, 10, spec.apronColor || '#e8e2d0');
  if (spec.tallis) { draw(2, 28, 36, 4, '#f2efe6'); draw(2, 31, 36, 1, '#2a2a4a'); }
  draw(15, 22, 10, 8, skin);
  draw(8, 6, 24, 22, skin);
  if (spec.facial === 'mustache') draw(13, 19, 14, 3, '#2a2018');
  if (spec.facial === 'beard') draw(9, 19, 22, 10, '#2a2018');
  if (spec.facial === 'fullbeard') draw(8, 19, 24, 15, '#d8d0c0');
  if (spec.facial === 'glasses') { draw(10, 12, 8, 5, '#1a1a1a'); draw(22, 12, 8, 5, '#1a1a1a'); }
  if (spec.facial === 'loupe') draw(25, 10, 6, 6, '#3a3a3a');
  if (spec.hair) draw(8, 5, 24, 5, spec.hair);
  if (spec.hat === 'flatcap') { draw(5, 1, 30, 6, spec.hatColor); draw(11, -3, 20, 6, spec.hatColor); }
  if (spec.hat === 'kippah') draw(14, 0, 12, 5, spec.hatColor);
  if (spec.hat === 'scarf') { draw(4, 0, 32, 8, spec.hatColor); draw(4, 6, 7, 22, spec.hatColor); draw(29, 6, 7, 22, spec.hatColor); }
  if (spec.hat === 'flowerhat') { draw(2, 0, 36, 7, spec.hatColor); draw(12, -5, 16, 7, spec.hatColor); draw(28, -6, 5, 5, '#e8c84a'); }
  return off.toDataURL();
}

/* ============================== State ============================== */

let state = 'menu';
let currentCase = null;
let currentLocId = null;

const el = id => document.getElementById(id);
const topbar = el('topbar'), navbar = el('navbar'), toastEl = el('toast');
const hotspotsEl = el('hotspots');
const dialogueBar = el('dialogueBar'), dlgPortrait = el('dlgPortrait'), dlgName = el('dlgName'), dlgText = el('dlgText');

let toastTimer = null;
function toast(msg, ms) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), ms || 2200);
}

function updateTopbar() {
  el('caseTitle').textContent = `תיק #${currentCase.id}: העלמות ${currentCase.stolenItem}`;
  el('cluesCount').textContent = `${currentCase.foundClueIds.size}/${currentCase.clues.length}`;
  el('casesSolved').textContent = casesSolvedTotal;
}

function buildNavbar() {
  navbar.innerHTML = '';
  const ids = ['office', 'crimescene', ...currentCase.suspects.map(s => s.locId)];
  ids.forEach(locId => {
    const loc = currentCase.locations[locId];
    const btn = document.createElement('button');
    btn.className = 'nav-btn';
    btn.textContent = loc.label;
    btn.addEventListener('click', () => goToLocation(locId));
    btn.dataset.locId = locId;
    navbar.appendChild(btn);
  });
  highlightNav();
}
function highlightNav() {
  [...navbar.children].forEach(b => b.classList.toggle('active', b.dataset.locId === currentLocId));
}

function goToLocation(locId) {
  currentLocId = locId;
  highlightNav();
  closeDialogue();
  renderScene();
  buildHotspots();
}

function renderScene() {
  const loc = currentCase.locations[currentLocId];
  const drawer = BG_DRAWERS[loc.bgType];
  drawer(loc.tint);
  if (loc.suspectId) {
    const s = currentCase.suspects.find(x => x.instanceId === loc.suspectId);
    const talkSpot = loc.spots.find(sp => sp.kind === 'talk');
    const cx = (talkSpot.x / 100) * GW;
    const feetY = (talkSpot.y / 100) * GH;
    drawPerson(cx, feetY, s.portraitSpec, 0.95);
  }
}

function buildHotspots() {
  hotspotsEl.innerHTML = '';
  const loc = currentCase.locations[currentLocId];
  loc.spots.forEach(spot => {
    const b = document.createElement('button');
    b.className = 'hotspot' + (currentCase.spotFoundIds.has(spot.id) ? ' found' : '');
    b.style.left = spot.x + '%';
    b.style.top = spot.y + '%';
    b.innerHTML = `<span class="glyph">${spot.kind === 'talk' ? '💬' : '🔍'}</span><span class="tip">${spot.tip}</span>`;
    b.addEventListener('click', () => onHotspotClick(spot));
    hotspotsEl.appendChild(b);
  });
}

function onHotspotClick(spot) {
  currentCase.spotFoundIds.add(spot.id);
  buildHotspots();
  if (spot.kind === 'talk') {
    const s = currentCase.suspects.find(x => x.instanceId === spot.suspectId);
    openDialogueSuspect(s);
  } else if (spot.isClue) {
    const clue = currentCase.clues.find(c => c.id === 'method_trace');
    addClue(clue);
    openDialogueObject('בדיקת הזירה', clue.text);
  } else {
    openDialogueObject('תצפית', spot.text);
  }
}

function addClue(clue) {
  if (currentCase.foundClueIds.has(clue.id)) return;
  currentCase.foundClueIds.add(clue.id);
  currentCase.foundOrder.push(clue.text);
  updateTopbar();
  toast('📔 רמז חדש נוסף לפנקס הבלש!');
}

function openDialogueSuspect(s) {
  dialogueBar.classList.remove('hidden');
  dlgPortrait.style.backgroundImage = `url(${s.portraitURL})`;
  dlgPortrait.textContent = '';
  dlgName.textContent = `${s.name} — ${s.jobTitle}`;
  const clue = currentCase.clues.find(c => c.forSuspect === s.instanceId);
  let text = s.greet;
  if (clue && !currentCase.foundClueIds.has(clue.id)) {
    text += '<br><br>' + clue.text;
    addClue(clue);
  } else {
    text += '<br><br>' + (s.guilty ? s.nervousIdle : pick(s.idleLines));
  }
  dlgText.innerHTML = text;
}

function openDialogueObject(title, text) {
  dialogueBar.classList.remove('hidden');
  dlgPortrait.style.backgroundImage = '';
  dlgPortrait.textContent = '🔍';
  dlgName.textContent = title;
  dlgText.innerHTML = text;
}

function closeDialogue() { dialogueBar.classList.add('hidden'); }

/* ============================== Notebook & Accusation ============================== */

function openNotebook() {
  el('notebookScreen').classList.remove('hidden');
  const list = el('suspectList');
  list.innerHTML = '';
  currentCase.suspects.forEach(s => {
    const alibiClue = currentCase.clues.find(c => c.forSuspect === s.instanceId && c.clears);
    const cleared = alibiClue && currentCase.foundClueIds.has(alibiClue.id);
    const card = document.createElement('div');
    card.className = 'suspect-card' + (cleared ? ' cleared' : '');
    card.innerHTML = `<div class="portrait" style="background-image:url(${s.portraitURL})"></div>
      <div class="s-name">${s.name}</div>
      <div class="s-job">${s.jobTitle}</div>
      <div class="s-status">${cleared ? '✓ מנוקה/ה מחשד' : '⚠ עדיין חשוד/ה'}</div>`;
    list.appendChild(card);
  });
  const clueList = el('clueList');
  clueList.innerHTML = currentCase.foundOrder.map(t => `<div class="clue-item">${t}</div>`).join('') ||
    '<div class="clue-item">עדיין לא נאספו רמזים. המשיכו לחקור בשכונה.</div>';
  el('accuseBtn').disabled = currentCase.foundClueIds.size < currentCase.clues.length;
}
function closeNotebook() { el('notebookScreen').classList.add('hidden'); }

let selectedAccuseId = null;
function openAccuse() {
  closeNotebook();
  selectedAccuseId = null;
  el('accuseScreen').classList.remove('hidden');
  const grid = el('accuseGrid');
  grid.innerHTML = '';
  currentCase.suspects.forEach(s => {
    const card = document.createElement('div');
    card.className = 'accuse-card';
    card.dataset.id = s.instanceId;
    card.innerHTML = `<div class="portrait" style="background-image:url(${s.portraitURL})"></div>
      <div class="s-name">${s.name}</div><div class="s-job">${s.jobTitle}</div>`;
    card.addEventListener('click', () => {
      selectedAccuseId = s.instanceId;
      [...grid.children].forEach(c => c.classList.toggle('selected', c === card));
      el('confirmAccuseBtn').disabled = false;
    });
    grid.appendChild(card);
  });
  el('confirmAccuseBtn').disabled = true;
}
function closeAccuse() { el('accuseScreen').classList.add('hidden'); }

function confirmAccuse() {
  if (!selectedAccuseId) return;
  const suspect = currentCase.suspects.find(s => s.instanceId === selectedAccuseId);
  if (suspect.guilty) {
    closeAccuse();
    startBattleFlow(suspect);
  } else {
    currentCase.wrongAccusations++;
    toast(`❌ טעות! ${suspect.name} חף/ה מפשע: ${suspect.alibiPlace}.`, 3200);
  }
}

/* ============================== Battle ============================== */

const battle = {
  active: false, lanes: [60, 120, 180], playerLane: 1, playerX: 120,
  hearts: 3, crookHp: 100, crookLane: 1, crookMoveTimer: 0,
  projectiles: [], spawnTimer: 0, throwCd: 0, throws: [], crook: null, lastTs: 0
};

function startBattleFlow(guiltySuspect) {
  el('battleIntroTitle').textContent = 'תפסתם את הגנב/ת!';
  el('battleIntroText').innerHTML = `${guiltySuspect.name} מבין/ה שנתפס/ה ונמלט/ת עם ${currentCase.stolenItem} לסמטה האחורית. נחמן, זה הרגע — תעצרו אותו/ה!`;
  el('battleIntroScreen').classList.remove('hidden');
  battle.crook = guiltySuspect;
}

function resetBattleRound() {
  battle.hearts = 3;
  battle.crookHp = 100;
  battle.playerLane = 1;
  battle.playerX = battle.lanes[1];
  battle.crookLane = 1;
  battle.crookMoveTimer = 0;
  battle.projectiles = [];
  battle.throws = [];
  battle.spawnTimer = 1;
  battle.throwCd = 0;
}

function beginBattle() {
  el('battleIntroScreen').classList.add('hidden');
  hotspotsEl.innerHTML = '';
  closeDialogue();
  resetBattleRound();
  battle.active = true;
  state = 'battle';
  topbar.classList.add('hidden');
  navbar.classList.add('hidden');
  el('battleHud').classList.remove('hidden');
  el('battleControls').classList.remove('hidden');
  el('crookName').textContent = `${battle.crook.name} בורח/ת!`;
  renderHearts();
  renderCrookBar();
  battle.lastTs = performance.now();
}

function renderHearts() { el('playerHearts').textContent = '❤️'.repeat(Math.max(0, battle.hearts)) + '🖤'.repeat(3 - Math.max(0, battle.hearts)); }
function renderCrookBar() { el('crookFill').style.width = Math.max(0, battle.crookHp) + '%'; }

function battleMove(dir) {
  if (!battle.active) return;
  battle.playerLane = Math.max(0, Math.min(2, battle.playerLane + dir));
}
function battleThrow() {
  if (!battle.active || battle.throwCd > 0) return;
  battle.throwCd = 0.55;
  battle.throws.push({ x: battle.playerX, y: 140, lane: battle.playerLane });
}

function updateBattle(dt) {
  const targetX = battle.lanes[battle.playerLane];
  battle.playerX += (targetX - battle.playerX) * Math.min(1, dt * 10);
  if (battle.throwCd > 0) battle.throwCd -= dt;

  battle.crookMoveTimer -= dt;
  if (battle.crookMoveTimer <= 0) {
    battle.crookMoveTimer = 1.1 + Math.random() * 0.8;
    battle.crookLane = randInt(0, 2);
  }

  battle.spawnTimer -= dt;
  if (battle.spawnTimer <= 0) {
    battle.spawnTimer = 1.0 + Math.random() * 0.7;
    battle.projectiles.push({ x: battle.lanes[randInt(0, 2)], y: 32 });
  }
  battle.projectiles.forEach(p => { p.y += dt * 95; });
  battle.projectiles = battle.projectiles.filter(p => {
    if (p.y >= 132 && p.y < 145 && Math.abs(p.x - battle.playerX) < 14) {
      battle.hearts--;
      renderHearts();
      if (battle.hearts <= 0) loseBattleRound();
      return false;
    }
    return p.y < 150;
  });

  battle.throws.forEach(t => { t.y -= dt * 130; });
  battle.throws = battle.throws.filter(t => {
    if (t.y <= 44 && t.y > 20 && t.lane === battle.crookLane) {
      battle.crookHp -= 20;
      renderCrookBar();
      if (battle.crookHp <= 0) winBattle();
      return false;
    }
    return t.y > 20;
  });
}

function drawBattle() {
  bgAlley();
  const crookX = battle.lanes[battle.crookLane];
  drawPerson(crookX, 58, battle.crook.portraitSpec, 0.5);
  battle.projectiles.forEach(p => R(p.x - 3, p.y - 3, 6, 6, '#8a5a3a'));
  battle.throws.forEach(t => R(t.x - 3, t.y - 3, 6, 6, '#e8dcb0'));
  drawNachmanFedora(battle.playerX, 148, 0.85);
}

function loseBattleRound() {
  battle.active = false;
  el('battleIntroTitle').textContent = 'הוא/היא כמעט ברח/ה!';
  el('battleIntroText').textContent = `נחמן, תתאושש! ${battle.crook.name} כמעט חמק/ה, אבל עוד לא נגמר. נסו שוב לתפוס אותו/ה.`;
  el('battleIntroScreen').classList.remove('hidden');
}

function winBattle() {
  battle.active = false;
  state = 'caseClosed';
  el('battleHud').classList.add('hidden');
  el('battleControls').classList.add('hidden');
  casesSolvedTotal++;
  safeLocalSet('nachman_cases_solved', String(casesSolvedTotal));
  el('closedTitle').textContent = 'התיק נסגר!';
  el('closedSubtitle').textContent = `תיק #${currentCase.id} נפתר בהצלחה`;
  el('closedSummary').innerHTML =
    `תפסתם את <b>${battle.crook.name}</b>, ו<b>${currentCase.stolenItem}</b> חוזר/ת בשלום אל ${currentCase.ownerLabel}.<br><br>` +
    `רמזים שנאספו: ${currentCase.foundClueIds.size}/${currentCase.clues.length}<br>` +
    `האשמות שגויות בדרך: ${currentCase.wrongAccusations}<br>` +
    `סה"כ תיקים שנפתרו על ידי בלש נחמן: ${casesSolvedTotal}`;
  el('caseClosedScreen').classList.remove('hidden');
}

let rafId = null;
function loop(ts) {
  rafId = requestAnimationFrame(loop);
  if (state === 'battle' && battle.active) {
    const dt = Math.min(0.05, (ts - battle.lastTs) / 1000);
    battle.lastTs = ts;
    updateBattle(dt);
    drawBattle();
  }
}
requestAnimationFrame(loop);

/* ============================== Flow control ============================== */

function startNewCase() {
  currentCase = generateCase();
  showCaseIntro();
}

function showCaseIntro() {
  state = 'caseIntro';
  el('introTitle').textContent = `תיק #${currentCase.id}: תעלומת ${currentCase.stolenItem}`;
  el('introSubtitle').textContent = `${currentCase.ownerLabel} דיווח/ה על גניבה ${currentCase.crimeLocLabel}`;
  el('introBrief').innerHTML = introBrief(currentCase);
  el('caseIntroScreen').classList.remove('hidden');
}

function beginInvestigation() {
  el('caseIntroScreen').classList.add('hidden');
  state = 'investigate';
  topbar.classList.remove('hidden');
  navbar.classList.remove('hidden');
  updateTopbar();
  buildNavbar();
  goToLocation('office');
}

/* ============================== Wiring ============================== */

el('startBtn').addEventListener('click', () => { el('startScreen').classList.add('hidden'); startNewCase(); });
el('beginInvestigationBtn').addEventListener('click', beginInvestigation);
el('notebookBtn').addEventListener('click', openNotebook);
el('closeNotebookBtn').addEventListener('click', closeNotebook);
el('accuseBtn').addEventListener('click', openAccuse);
el('cancelAccuseBtn').addEventListener('click', closeAccuse);
el('confirmAccuseBtn').addEventListener('click', confirmAccuse);
el('dlgClose').addEventListener('click', closeDialogue);
el('startBattleBtn').addEventListener('click', beginBattle);
el('newCaseBtn').addEventListener('click', () => { el('caseClosedScreen').classList.add('hidden'); startNewCase(); });

el('btnLeft').addEventListener('click', () => battleMove(-1));
el('btnRight').addEventListener('click', () => battleMove(1));
el('btnThrow').addEventListener('click', battleThrow);

window.addEventListener('keydown', e => {
  if (state !== 'battle') return;
  if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') battleMove(-1);
  if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') battleMove(1);
  if (e.key === ' ') { e.preventDefault(); battleThrow(); }
});

renderHearts();
renderCrookBar();
