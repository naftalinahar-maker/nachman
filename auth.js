// מסך התחברות באימייל וסיסמה (Firebase Auth), משותף לגרסת הדו-ממד והתלת-ממד.
(function () {
  const cfg = window.FIREBASE_CONFIG || {};
  const configured = !!(cfg.apiKey && window.firebase);
  const $ = id => document.getElementById(id);

  const screen = document.createElement('div');
  screen.id = 'loginScreen';
  screen.className = 'overlay';
  screen.innerHTML = `
    <div class="panel">
      <h1>ROGUE STEEL</h1>
      <p class="subtitle" id="authTitle">התחברו כדי להתחיל לשחק</p>
      <form id="authForm" class="auth-form" novalidate>
        <input id="authEmail" type="email" placeholder="אימייל" autocomplete="email" dir="ltr" required>
        <input id="authPass" type="password" placeholder="סיסמה (לפחות 6 תווים)" autocomplete="current-password" dir="ltr" required>
        <div id="authMsg" class="auth-msg"></div>
        <button id="authSubmit" class="btn" type="submit">התחברות</button>
      </form>
      <div class="auth-links">
        <a href="#" id="authToggle">אין לכם חשבון? הרשמה</a>
        <a href="#" id="authReset">שכחתי סיסמה</a>
      </div>
      <div class="auth-links"><a href="#" id="authGuest">לשחק כאורח</a></div>
    </div>`;
  document.getElementById('app').appendChild(screen);

  const userBar = document.createElement('div');
  userBar.id = 'userBar';
  userBar.className = 'user-bar hidden';
  userBar.innerHTML = `<span id="userEmail"></span> <a href="#" id="authLogout">התנתקות</a>`;
  const startPanel = document.querySelector('#startScreen .panel');
  if (startPanel) startPanel.prepend(userBar);

  // בזמן שמסך ההתחברות פתוח, מקשים לא יגיעו למשחק (למשל Enter לא יתחיל קרב)
  window.addEventListener('keydown', e => {
    if (!screen.classList.contains('hidden')) e.stopImmediatePropagation();
  }, true);

  let signup = false;
  const msg = (t, ok) => { $('authMsg').textContent = t || ''; $('authMsg').className = 'auth-msg' + (ok ? ' ok' : ''); };
  const setMode = s => {
    signup = s;
    $('authTitle').textContent = s ? 'יצירת חשבון חדש' : 'התחברו כדי להתחיל לשחק';
    $('authSubmit').textContent = s ? 'הרשמה' : 'התחברות';
    $('authToggle').textContent = s ? 'כבר יש לכם חשבון? התחברות' : 'אין לכם חשבון? הרשמה';
    $('authPass').autocomplete = s ? 'new-password' : 'current-password';
    msg('');
  };
  const showGame = label => {
    screen.classList.add('hidden');
    $('userEmail').textContent = label;
    userBar.classList.remove('hidden');
  };
  const showLogin = () => { screen.classList.remove('hidden'); userBar.classList.add('hidden'); };

  const errors = {
    'auth/invalid-email': 'כתובת האימייל לא תקינה',
    'auth/missing-password': 'צריך לכתוב סיסמה',
    'auth/weak-password': 'הסיסמה קצרה מדי (לפחות 6 תווים)',
    'auth/email-already-in-use': 'כבר יש חשבון עם האימייל הזה, נסו להתחבר',
    'auth/invalid-credential': 'האימייל או הסיסמה לא נכונים',
    'auth/wrong-password': 'הסיסמה לא נכונה',
    'auth/user-not-found': 'אין חשבון עם האימייל הזה',
    'auth/too-many-requests': 'יותר מדי ניסיונות, חכו קצת ונסו שוב',
    'auth/network-request-failed': 'אין חיבור לאינטרנט'
  };
  const errText = e => errors[e && e.code] || 'משהו השתבש, נסו שוב';

  $('authToggle').onclick = e => { e.preventDefault(); setMode(!signup); };
  $('authGuest').onclick = e => { e.preventDefault(); showGame('משחקים כאורח'); };

  if (!configured) {
    msg('ההתחברות באימייל עוד לא הופעלה. אפשר לשחק כאורח.');
    $('authSubmit').disabled = true;
    $('authForm').onsubmit = e => e.preventDefault();
    $('authReset').onclick = e => e.preventDefault();
    $('authLogout').onclick = e => { e.preventDefault(); showLogin(); };
    return;
  }

  firebase.initializeApp(cfg);
  const auth = firebase.auth();

  $('authForm').onsubmit = async e => {
    e.preventDefault();
    const email = $('authEmail').value.trim(), pass = $('authPass').value;
    $('authSubmit').disabled = true;
    msg('רגע...', true);
    try {
      if (signup) await auth.createUserWithEmailAndPassword(email, pass);
      else await auth.signInWithEmailAndPassword(email, pass);
      msg('');
    } catch (err) { msg(errText(err)); }
    $('authSubmit').disabled = false;
  };
  $('authReset').onclick = async e => {
    e.preventDefault();
    const email = $('authEmail').value.trim();
    if (!email) return msg('כתבו קודם את האימייל שלכם');
    try { await auth.sendPasswordResetEmail(email); msg('שלחנו לכם מייל לאיפוס הסיסמה', true); }
    catch (err) { msg(errText(err)); }
  };
  $('authLogout').onclick = e => { e.preventDefault(); auth.signOut(); showLogin(); };

  auth.onAuthStateChanged(user => { if (user) showGame(user.email); else showLogin(); });
})();
