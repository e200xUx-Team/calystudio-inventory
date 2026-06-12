/**
 * THE ePlANE CO. — CLAY STUDIO DASHBOARD
 * public/app.js — Full-stack client (fetch API, no localStorage)
 *
 * Auth:    POST /api/auth/login|signup|logout   GET /api/auth/me
 * Data:    GET/POST/PUT/DELETE /api/inventory|projects|borrows
 * Admin:   GET /api/admin/users   PATCH /api/admin/users/:id
 */

'use strict';

/* ════════════════════════════════════════════
   STATE
   ════════════════════════════════════════════ */

let currentUser = null;   // { name, email, role }
let authMode = 'login';
let currentView = 'dashboard';
let invSearch = '';
let invCategory = 'All';
let chartInstances = {};
let confirmCallback = null;

// In-memory cache — refreshed from API on every view change
window._D = { inventory: [], projects: [], borrows: [] };

const $ = id => document.getElementById(id);

/* ════════════════════════════════════════════
   API LAYER  — wraps all fetch calls
   ════════════════════════════════════════════ */

// Base URL for the backend API.
// If running frontend on Live Server (e.g. port 5500), request port 3000. Otherwise, use relative path.
const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? (window.location.port && window.location.port !== '3000' ? 'http://localhost:3000' : '')
  : '';

async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',   // send httpOnly JWT cookie
  };
  if (body !== undefined) opts.body = JSON.stringify(body);

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, opts);
  } catch (netErr) {
    // fetch() only rejects on a network-level failure (server down, wrong URL,
    // CORS, offline) — never on HTTP error codes. Make that obvious.
    const e = new Error("Can't reach the server. Make sure the dashboard server is running and that you opened the app at the address it prints (e.g. http://localhost:3000) — not the index.html file directly.");
    e.status = 0;
    e.network = true;
    throw e;
  }
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    // Attach HTTP status to the error so callers can branch on it
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.pending = data.pending || false;
    throw err;
  }
  return data;
}

const GET = path => api('GET', path);
const POST = (path, b) => api('POST', path, b);
const PUT = (path, b) => api('PUT', path, b);
const PATCH = (path, b) => api('PATCH', path, b);
const DELETE = path => api('DELETE', path);

/* ════════════════════════════════════════════
   TOAST NOTIFICATIONS
   ════════════════════════════════════════════ */

function toast(msg, type = 'success') {
  let container = $('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

/* ════════════════════════════════════════════
   PAGE LOADER
   ════════════════════════════════════════════ */

function showLoader() { const l = $('page-loader'); if (l) l.style.display = 'flex'; $('content').style.display = 'none'; }
function hideLoader() { const l = $('page-loader'); if (l) l.style.display = 'none'; $('content').style.display = ''; }

/* ════════════════════════════════════════════
   BOOT — check session on page load
   ════════════════════════════════════════════ */

window.addEventListener('DOMContentLoaded', async () => {
  // Show a startup message while the serverless function warms up
  const authDesc = document.querySelector('.auth-desc');
  const originalDesc = authDesc ? authDesc.innerHTML : '';
  if (authDesc) {
    authDesc.innerHTML = '<span style="color:var(--blue)">⏳ Connecting to server…</span>';
  }

  // Warm up the DB first (Vercel cold start can take a few seconds)
  try {
    await fetch(`${API_BASE}/api/health`, { credentials: 'include' });
  } catch (_) { /* ignore */ }

  // Remove the pre-JS cold-start loader, show auth screen
  const loader = document.getElementById('cold-start-loader');
  if (loader) loader.remove();

  if (authDesc) authDesc.innerHTML = originalDesc;

  try {
    const me = await GET('/api/auth/me');
    if (me.loggedIn) {
      currentUser = { name: me.name, email: me.email, role: me.role };
      bootApp();
    }
  } catch (e) {
    // Not logged in — auth screen is already visible
    if (authDesc) authDesc.innerHTML = originalDesc;
  }
});

/* ════════════════════════════════════════════
   AUTH
   ════════════════════════════════════════════ */

function switchAuthTab(mode) {
  authMode = mode;
  $('tab-login').classList.toggle('active', mode === 'login');
  $('tab-signup').classList.toggle('active', mode === 'signup');
  $('auth-name').style.display = mode === 'signup' ? 'block' : 'none';
  $('auth-submit').textContent = mode === 'login' ? 'Sign In' : 'Create Account';
  $('auth-err').textContent = '';

  const titleEl = document.querySelector('.auth-title');
  if (titleEl) titleEl.textContent = mode === 'login' ? 'Welcome back' : 'Create account';
  const descEl = document.querySelector('.auth-desc');
  if (descEl) descEl.innerHTML = mode === 'login'
    ? 'Sign in with your <strong>@eplane.ai</strong> company email'
    : 'Register with your <strong>@eplane.ai</strong> company email';
}

async function doAuth() {
  const email = $('auth-email').value.trim().toLowerCase();
  const pass = $('auth-pass').value;
  const name = $('auth-name').value.trim();
  const errEl = $('auth-err');

  if (!email || !pass) { errEl.textContent = 'Please fill in all fields.'; return; }
  if (pass.length < 6) { errEl.textContent = 'Password must be 6+ characters.'; return; }

  $('auth-submit').disabled = true;
  $('auth-submit').textContent = authMode === 'login' ? 'Signing in…' : 'Creating account…';
  errEl.textContent = '';

  try {
    if (authMode === 'signup') {
      if (!name) { errEl.textContent = 'Please enter your full name.'; return; }
      const res = await POST('/api/auth/signup', { email, name, password: pass });
      if (res.pending) {
        errEl.style.color = 'var(--amber)';
        errEl.textContent = '✓ Account created! Waiting for admin approval before you can log in.';
        return;
      }
      // Admin auto-approved
      currentUser = { name: res.name, email, role: res.role };
      bootApp();
    } else {
      const res = await POST('/api/auth/login', { email, password: pass });
      currentUser = { name: res.name, email: res.email, role: res.role };
      bootApp();
    }
  } catch (e) {
    errEl.style.color = 'var(--red)';
    if (e.pending) {
      errEl.style.color = 'var(--amber)';
      errEl.textContent = '⏳ ' + e.message;
    } else {
      errEl.textContent = e.message;
    }
  } finally {
    $('auth-submit').disabled = false;
    $('auth-submit').textContent = authMode === 'login' ? 'Sign In' : 'Create Account';
  }
}

/* ════════════════════════════════════════════
   FORGOT PASSWORD — 3-step OTP flow
   ════════════════════════════════════════════ */

// Tracks which step we're on: 'email' | 'otp' | 'newpass'
let forgotStep = 'email';
let forgotEmail = '';
let forgotResetToken = '';

function showForgotPassword() {
  forgotStep = 'email';
  forgotEmail = '';
  forgotResetToken = '';
  $('forgot-panel').style.display = 'block';
  $('forgot-row').style.display = 'none';
  $('auth-email').style.display = 'none';
  $('auth-name').style.display = 'none';
  $('auth-pass').style.display = 'none';
  $('auth-submit').style.display = 'none';
  document.querySelector('.auth-tabs').style.display = 'none';
  document.querySelector('.auth-hint').style.display = 'none';
  $('auth-err').textContent = '';
  // NOTE: #forgot-err lives inside the panel and is created by renderForgotStep(),
  // so it must be rendered first before we can touch it.
  renderForgotStep();
}

function hideForgotPassword() {
  $('forgot-panel').style.display = 'none';
  $('forgot-row').style.display = '';
  $('auth-email').style.display = '';
  $('auth-name').style.display = authMode === 'signup' ? 'block' : 'none';
  $('auth-pass').style.display = '';
  $('auth-submit').style.display = '';
  document.querySelector('.auth-tabs').style.display = '';
  document.querySelector('.auth-hint').style.display = '';
  $('auth-err').textContent = '';
}

function renderForgotStep() {
  const panel = $('forgot-panel');
  if (forgotStep === 'email') {
    panel.innerHTML = `
      <div style="border-top:1px solid var(--border);margin-bottom:16px;padding-top:16px;">
        <div style="font-weight:700;font-size:15px;color:var(--navy);margin-bottom:4px;">Reset your password</div>
        <div style="font-size:12px;color:var(--faint);">Enter your @eplane.ai email — we'll send a 6-digit OTP.</div>
      </div>
      <input class="auth-input" id="fp-email" type="email" placeholder="your@eplane.ai" style="margin-bottom:8px;" />
      <div id="forgot-err" style="font-size:12px;min-height:18px;margin-bottom:8px;color:var(--red);font-weight:600;"></div>
      <button class="auth-btn" id="forgot-submit" onclick="doForgotStep()">Send OTP</button>
      <div style="text-align:center;margin-top:12px;">
        <span class="auth-link" onclick="hideForgotPassword()">← Back to Sign In</span>
      </div>
    `;
    const existingEmail = $('auth-email') ? $('auth-email').value.trim() : '';
    if (existingEmail) $('fp-email').value = existingEmail;
  } else if (forgotStep === 'otp') {
    panel.innerHTML = `
      <div style="border-top:1px solid var(--border);margin-bottom:16px;padding-top:16px;">
        <div style="font-weight:700;font-size:15px;color:var(--navy);margin-bottom:4px;">Enter OTP</div>
        <div style="font-size:12px;color:var(--faint);">A 6-digit code was sent to <strong>${forgotEmail}</strong>. Valid for 10 minutes.</div>
      </div>
      <input class="auth-input" id="fp-otp" type="text" placeholder="6-digit OTP" maxlength="6"
        style="margin-bottom:8px;letter-spacing:6px;font-size:20px;font-weight:700;text-align:center;"
        oninput="this.value=this.value.replace(/[^0-9]/g,'')" />
      <div id="forgot-err" style="font-size:12px;min-height:18px;margin-bottom:8px;color:var(--red);font-weight:600;"></div>
      <button class="auth-btn" id="forgot-submit" onclick="doForgotStep()">Verify OTP</button>
      <div style="text-align:center;margin-top:12px;">
        <span class="auth-link" onclick="forgotStep='email';renderForgotStep()">← Resend OTP</span>
      </div>
    `;
    setTimeout(() => { if ($('fp-otp')) $('fp-otp').focus(); }, 50);
  } else if (forgotStep === 'newpass') {
    panel.innerHTML = `
      <div style="border-top:1px solid var(--border);margin-bottom:16px;padding-top:16px;">
        <div style="font-weight:700;font-size:15px;color:var(--navy);margin-bottom:4px;">Set new password</div>
        <div style="font-size:12px;color:var(--faint);">Choose a strong password for <strong>${forgotEmail}</strong>.</div>
      </div>
      <input class="auth-input" id="fp-newpass" type="password" placeholder="New password (min 6 chars)" style="margin-bottom:8px;" />
      <input class="auth-input" id="fp-confirmpass" type="password" placeholder="Confirm new password" style="margin-bottom:8px;" />
      <div id="forgot-err" style="font-size:12px;min-height:18px;margin-bottom:8px;color:var(--red);font-weight:600;"></div>
      <button class="auth-btn" id="forgot-submit" onclick="doForgotStep()">Update Password</button>
    `;
    setTimeout(() => { if ($('fp-newpass')) $('fp-newpass').focus(); }, 50);
  }
}

async function doForgotStep() {
  const errEl = $('forgot-err');
  errEl.textContent = '';
  const btn = $('forgot-submit');

  if (forgotStep === 'email') {
    const email = ($('fp-email').value || '').trim().toLowerCase();
    if (!email) { errEl.textContent = 'Please enter your email.'; return; }
    if (!email.endsWith('@eplane.ai')) { errEl.textContent = 'Only @eplane.ai accounts are allowed.'; return; }
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      const res = await POST('/api/auth/forgot-password', { email });
      forgotEmail = email;
      forgotStep = 'otp';
      renderForgotStep();
      // If the server isn't configured to send email (local/dev), it returns the
      // code directly so the flow stays usable. Prefill it and tell the user.
      if (res && res.devOtp) {
        if ($('fp-otp')) $('fp-otp').value = res.devOtp;
        if ($('forgot-err')) {
          $('forgot-err').style.color = 'var(--amber)';
          $('forgot-err').textContent = 'Email isn\'t set up, so we filled the code in for you.';
        }
      }
    } catch (e) {
      errEl.textContent = e.message || 'Failed to send OTP. Try again.';
      btn.disabled = false; btn.textContent = 'Send OTP';
    }

  } else if (forgotStep === 'otp') {
    const otp = ($('fp-otp').value || '').trim();
    if (otp.length !== 6) { errEl.textContent = 'Enter the 6-digit OTP from your email.'; return; }
    btn.disabled = true; btn.textContent = 'Verifying…';
    try {
      const res = await POST('/api/auth/verify-otp', { email: forgotEmail, otp });
      forgotResetToken = res.resetToken;
      forgotStep = 'newpass';
      renderForgotStep();
    } catch (e) {
      errEl.textContent = e.message || 'Invalid OTP. Please try again.';
      btn.disabled = false; btn.textContent = 'Verify OTP';
    }

  } else if (forgotStep === 'newpass') {
    const newPassword = ($('fp-newpass').value || '');
    const confirm = ($('fp-confirmpass').value || '');
    if (newPassword.length < 6) { errEl.textContent = 'Password must be at least 6 characters.'; return; }
    if (newPassword !== confirm) { errEl.textContent = 'Passwords do not match.'; return; }
    btn.disabled = true; btn.textContent = 'Updating…';
    try {
      await POST('/api/auth/reset-password', { resetToken: forgotResetToken, newPassword });
      hideForgotPassword();
      // Pre-fill email and show success
      if ($('auth-email')) $('auth-email').value = forgotEmail;
      const authErr = $('auth-err');
      authErr.style.color = 'green';
      authErr.textContent = '✓ Password updated! Please sign in with your new password.';
    } catch (e) {
      errEl.textContent = e.message || 'Failed to update password. Please start again.';
      btn.disabled = false; btn.textContent = 'Update Password';
    }
  }
}

// Keep old name as alias so HTML onclick still works
function doForgotPassword() { doForgotStep(); }

function bootApp() {
  const ini = currentUser.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  $('sidebar-avatar').textContent = ini;
  $('sidebar-username').textContent = currentUser.name;
  $('sidebar-role').textContent = currentUser.role === 'admin' ? 'Studio Admin' : 'Studio Member';

  // Show admin nav item for admins
  if (currentUser.role === 'admin') {
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = '');
  }

  $('auth-screen').style.display = 'none';
  $('app').classList.remove('app-hidden');

  go('dashboard');
}

async function logout() {
  try { await POST('/api/auth/logout'); } catch (e) { /* ignore */ }
  currentUser = null;
  window._D = { inventory: [], projects: [], borrows: [] };
  $('auth-screen').style.display = 'flex';
  $('app').classList.add('app-hidden');
  $('auth-err').textContent = '';
  $('auth-err').style.color = '';
  closeSidebar();
}

/* ════════════════════════════════════════════
   DATA LOADING
   ════════════════════════════════════════════ */

async function loadAllData() {
  const [inventory, projects, borrows] = await Promise.all([
    GET('/api/inventory'),
    GET('/api/projects'),
    GET('/api/borrows'),
  ]);
  window._D = { inventory, projects, borrows };
}

/* ════════════════════════════════════════════
   NAVIGATION
   ════════════════════════════════════════════ */

async function go(view) {
  currentView = view;
  closeSidebar();

  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navEl = $('nav-' + view);
  if (navEl) navEl.classList.add('active');

  const titles = { dashboard: 'Dashboard', inventory: 'Inventory', projects: 'Projects', borrows: 'Borrow Tracker', analytics: 'Analytics', admin: 'User Management' };
  const subs = { dashboard: 'Studio overview & live metrics', inventory: 'Track all materials — Remaining = Total − Used', projects: 'Cost tracking & project management', borrows: 'Who borrowed what from the studio — and whether it\'s back', analytics: 'Visual spend & usage breakdown', admin: 'Approve or reject pending @eplane.ai accounts' };

  $('page-title').textContent = titles[view] || view;
  $('page-sub').textContent = subs[view] || '';

  const actionsEl = $('topbar-actions');
  if (view === 'inventory') {
    actionsEl.innerHTML = `<button class="btn btn-outline btn-sm" onclick="openPDF()">↓ PDF</button><button class="btn btn-primary btn-sm" onclick="openItemDrawer('add')">+ Add Item</button>`;
  } else if (view === 'projects') {
    actionsEl.innerHTML = `<button class="btn btn-primary btn-sm" onclick="openProjDrawer('new')">+ New Project</button>`;
  } else if (view === 'borrows') {
    actionsEl.innerHTML = `<button class="btn btn-primary btn-sm" onclick="openBorrowDrawer('new')">+ Log Borrow</button>`;
  } else if (view === 'analytics') {
    actionsEl.innerHTML = `<button class="btn btn-outline btn-sm" onclick="openPDF()">↓ PDF Report</button>`;
  } else if (view === 'admin') {
    actionsEl.innerHTML = '';
  } else {
    actionsEl.innerHTML = `<button class="btn btn-outline btn-sm" onclick="openPDF()">↓ PDF</button><button class="btn btn-primary btn-sm" onclick="openItemDrawer('add')">+ Add Item</button>`;
  }

  showLoader();
  destroyCharts();

  try {
    if (view === 'admin') {
      await renderAdmin();
    } else {
      await loadAllData();
      renderView();
    }
    updateBadges();
  } catch (e) {
    hideLoader();
    toast('Failed to load data: ' + e.message, 'error');
  }
}

function updateBadges() {
  const D = window._D;
  const out = (D.borrows || []).filter(b => !b.returned).length;
  const badge = $('borrow-badge');
  if (badge) { badge.textContent = out; badge.style.display = out > 0 ? 'inline' : 'none'; }
}

/* ════════════════════════════════════════════
   MOBILE SIDEBAR
   ════════════════════════════════════════════ */

function toggleSidebar() {
  const sb = $('sidebar'), hb = $('hamburger'), ov = $('sb-overlay');
  if (sb.classList.contains('open')) { closeSidebar(); }
  else { sb.classList.add('open'); hb.classList.add('open'); ov.classList.add('visible'); }
}

function closeSidebar() {
  $('sidebar').classList.remove('open');
  const hb = $('hamburger'); if (hb) hb.classList.remove('open');
  const ov = $('sb-overlay'); if (ov) ov.classList.remove('visible');
}

/* ════════════════════════════════════════════
   RENDER DISPATCHER
   ════════════════════════════════════════════ */

function renderView() {
  hideLoader();
  const D = window._D;
  if (!D) return;
  switch (currentView) {
    case 'dashboard': renderDashboard(D); break;
    case 'inventory': renderInventory(D); break;
    case 'projects': renderProjects(D); break;
    case 'borrows': renderBorrows(D); break;
    case 'analytics': renderAnalytics(D); break;
  }
}

/* ════════════════════════════════════════════
   HELPERS
   ════════════════════════════════════════════ */

function calcRemaining(item) { return Math.max(0, item.total - item.used); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
function itemStatus(item) {
  const r = calcRemaining(item);
  if (r <= item.threshold) return 'critical';
  if (r <= item.threshold * 2) return 'warn';
  return 'ok';
}
function statusPill(s) {
  const m = { ok: ['pill-ok', 'OK'], warn: ['pill-warn', 'Low'], critical: ['pill-crit', 'Critical'] };
  const [cls, lbl] = m[s] || ['pill-gray', s];
  return `<span class="pill ${cls}">${lbl}</span>`;
}
function progressBarHTML(pct, status) {
  const fc = status === 'critical' ? 'fill-crit' : status === 'warn' ? 'fill-warn' : 'fill-ok';
  return `<div class="progress-wrap"><div class="progress-track"><div class="progress-fill ${fc}" style="width:${pct}%"></div></div><span class="progress-pct">${pct}%</span></div>`;
}
function projStatusPill(s) {
  const m = { active: 'pill-blue', completed: 'pill-ok', 'on-hold': 'pill-warn' };
  return `<span class="pill ${m[s] || 'pill-gray'}">${s}</span>`;
}
function projectSpent(projId, inv) {
  return inv.filter(i => i.project === projId).reduce((s, i) => s + i.price * i.used, 0);
}
function fmtMoney(n) {
  return '₹' + parseFloat(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/* ════════════════════════════════════════════
   DASHBOARD VIEW
   ════════════════════════════════════════════ */

function renderDashboard(D) {
  const inv = D.inventory;
  const total = inv.length, spend = inv.reduce((s, i) => s + i.price * i.total, 0);
  const inuse = inv.filter(i => i.used > 0).length, crit = inv.filter(i => itemStatus(i) === 'critical').length;
  const remVal = inv.reduce((s, i) => s + i.price * calcRemaining(i), 0);
  const out = (D.borrows || []).filter(b => !b.returned).length;
  const inuseRatio = total > 0 ? Math.round((inuse / total) * 100) : 0;

  const projCards = D.projects.slice(0, 3).map(p => {
    const spent = projectSpent(p.id, inv);
    return `<div style="padding:12px 16px;border-bottom:1px solid #f7f8fb;cursor:pointer" onclick="go('projects')">
      <div style="display:flex;justify-content:space-between;margin-bottom:6px">
        <span style="font-size:12px;font-weight:800;color:var(--navy)">${p.name}</span>
        <span style="font-size:12px;font-weight:800;color:var(--blue)">${fmtMoney(spent)}</span>
      </div>
      <div style="height:4px;background:#f0f4ff;border-radius:10px;overflow:hidden;margin-bottom:4px">
        <div style="height:100%;background:linear-gradient(90deg,var(--blue),#60a5fa);width:${p.progress}%"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--faint);font-weight:600">
        <span>${p.progress}% done</span><span>Budget ${fmtMoney(p.budget)}</span>
      </div></div>`;
  }).join('');

  const borrowRows = (D.borrows || []).slice(0, 4).map(b => {
    const dc = b.returned ? 'dot-done' : 'dot-overdue';
    const bc = b.returned ? 'badge-done' : 'badge-overdue';
    const label = b.returned ? 'Returned' : 'Out';
    const meta = [b.team, b.item].filter(Boolean).join(' · ');
    return `<div class="task-row"><div class="task-dot ${dc}"></div><div><div class="task-name">${esc(b.person)}</div><div style="font-size:10px;color:var(--faint);font-weight:500;margin-top:1px">${esc(meta)}</div><span class="task-badge ${bc}">${label}</span></div></div>`;
  }).join('');

  $('content').innerHTML = `
    <div class="metrics-grid">
      <div class="metric-card"><div class="metric-accent" style="background:var(--blue)"></div><div class="metric-label">Total Items</div><div class="metric-value">${total}</div><div class="metric-sub sub-blue">${inuse} currently in use</div></div>
      <div class="metric-card"><div class="metric-accent" style="background:var(--green)"></div><div class="metric-label">Total Invested</div><div class="metric-value">${fmtMoney(spend)}</div><div class="metric-sub sub-green">Remaining ${fmtMoney(remVal)}</div></div>
      <div class="metric-card"><div class="metric-accent" style="background:var(--amber)"></div><div class="metric-label">Items In Use</div><div class="metric-value">${inuse}</div><div class="metric-sub sub-amber">${inuseRatio}% of stock active</div></div>
      <div class="metric-card"><div class="metric-accent" style="background:var(--red)"></div><div class="metric-label">Critical Stock</div><div class="metric-value">${crit}</div><div class="metric-sub sub-red">${out} item${out !== 1 ? 's' : ''} out on loan</div></div>
    </div>
    <div class="grid-2col">
      <div><div class="panel">
        <div class="panel-header"><div><div class="panel-title">Inventory Snapshot</div><div class="panel-sub">Live usage — Remaining = Total − Used</div></div><button class="btn btn-primary btn-sm" onclick="go('inventory')">View All</button></div>
        <div class="table-scroll"><table class="inv-table"><thead><tr><th>Material</th><th>MR Number</th><th>Total</th><th>Used</th><th>Remaining</th><th>Usage</th><th>Status</th></tr></thead><tbody id="dash-table"></tbody></table></div>
      </div></div>
      <div>
        <div class="panel" style="margin-bottom:16px">
          <div class="panel-header"><div><div class="panel-title">Projects</div><div class="panel-sub">Cost tracking</div></div><button class="btn btn-outline btn-sm" onclick="go('projects')">All</button></div>
          ${projCards || '<div class="empty-state"><div class="empty-title">No projects yet</div></div>'}
        </div>
        <div class="panel">
          <div class="panel-header"><div><div class="panel-title">Borrowed Items</div><div class="panel-sub">Out on loan to other teams</div></div><button class="btn btn-outline btn-sm" onclick="go('borrows')">All</button></div>
          ${borrowRows || '<div class="empty-state"><div class="empty-title">Nothing on loan</div></div>'}
        </div>
      </div>
    </div>`;
  buildInvTableRows('dash-table', D.inventory.slice(0, 5), false);
}

/* ════════════════════════════════════════════
   INVENTORY VIEW
   ════════════════════════════════════════════ */

function renderInventory(D) {
  const cats = ['All', ...new Set(D.inventory.map(i => i.cat))];
  const catOpts = cats.map(c => `<option value="${c}"${invCategory === c ? ' selected' : ''}>${c}</option>`).join('');
  const filtered = filterInventory();

  $('content').innerHTML = `
    <div class="panel">
      <div class="panel-header"><div><div class="panel-title">All Materials</div><div class="panel-sub">${D.inventory.length} items tracked</div></div><button class="btn btn-primary btn-sm" onclick="openItemDrawer('add')">+ Add Item</button></div>
      <div class="filter-bar">
        <input class="search-input" placeholder="Search materials, MR number…" value="${invSearch}"
          oninput="invSearch=this.value; buildInvTableRows('inv-full', filterInventory(), true)" />
        <select class="filter-select" onchange="invCategory=this.value; renderView()">${catOpts}</select>
      </div>
      <div class="table-scroll">
        <table class="inv-table">
          <thead><tr><th>Material</th><th>Category</th><th>MR Number</th><th>Price</th><th>Total</th><th>Used</th><th>Remaining</th><th>Usage</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody id="inv-full"></tbody>
        </table>
        ${filtered.length === 0 ? '<div class="empty-state"><div class="empty-icon">📦</div><div class="empty-title">No materials found</div></div>' : ''}
      </div>
    </div>`;
  buildInvTableRows('inv-full', filtered, true);
}

function filterInventory() {
  return window._D.inventory.filter(i => {
    const q = invSearch.toLowerCase();
    const mQ = !q || i.name.toLowerCase().includes(q) || i.cat.toLowerCase().includes(q) || (i.mrNumber || '').toLowerCase().includes(q);
    return mQ && (invCategory === 'All' || i.cat === invCategory);
  });
}

function buildInvTableRows(tbodyId, items, showActions) {
  const el = $(tbodyId);
  if (!el) return;
  el.innerHTML = '';
  items.forEach(item => {
    const rem = calcRemaining(item), pct = item.total > 0 ? Math.round((item.used / item.total) * 100) : 0;
    const status = itemStatus(item);
    const remColor = status === 'critical' ? 'var(--red)' : status === 'warn' ? 'var(--amber)' : 'var(--text)';
    const mrHtml = item.mrNumber
      ? `<span style="background:#eff6ff;padding:2px 7px;border-radius:5px;font-size:9px;font-weight:800;color:#1e40af">MR# ${item.mrNumber}</span>`
      : '<span style="color:var(--faint);font-size:9px">—</span>';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><div class="item-name">${item.name}</div><div class="item-sub">${showActions ? (item.mrNumber ? `<span style="font-size:9px;font-weight:700;color:var(--blue)">MR#</span> ${item.mrNumber}` : '—') : item.cat}</div></td>
      ${showActions ? `<td><span class="pill pill-blue" style="font-size:8px">${item.cat}</span></td>` : ''}
      <td>${mrHtml}</td>
      ${showActions ? `<td style="font-weight:700;color:var(--blue);white-space:nowrap">${fmtMoney(item.price)}/${item.unit}</td>` : ''}
      <td style="font-weight:700;color:#374151;white-space:nowrap">${item.total} ${item.unit}</td>
      <td><input class="used-input" type="number" value="${item.used}" min="0" max="${item.total}" step="0.1" onchange="updateUsed(${item.id},this.value,this)" /></td>
      <td><span class="remaining-val" id="rem-${item.id}" style="color:${remColor}">${rem.toFixed(1)} ${item.unit}</span></td>
      <td style="min-width:100px">${progressBarHTML(pct, status)}</td>
      <td>${statusPill(status)}</td>
      ${showActions ? `<td style="white-space:nowrap"><button class="btn-icon" onclick="openItemDrawer('edit',${item.id})" title="Edit">✎</button><button class="btn-icon" onclick="confirmDelete('item',${item.id})" title="Delete" style="color:var(--red)">✕</button></td>` : ''}
    `;
    el.appendChild(tr);
  });
}

/* ════════════════════════════════════════════
   AUTO-CALC: Remaining = Total − Used  + API SAVE
   ════════════════════════════════════════════ */

async function updateUsed(id, rawValue, inputEl) {
  const item = window._D.inventory.find(i => i.id === id);
  if (!item) return;

  const newUsed = Math.min(Math.max(0, parseFloat(rawValue) || 0), item.total);
  inputEl.value = newUsed;
  item.used = newUsed;

  // ── Core logic: Remaining = Total − Used ──
  const remaining = Math.max(0, item.total - newUsed);
  const pct = item.total > 0 ? Math.round((newUsed / item.total) * 100) : 0;
  const status = itemStatus(item);
  const isBad = status !== 'ok';

  // DOM update (instant — no waiting for API)
  const remEl = $('rem-' + id);
  if (remEl) {
    remEl.textContent = remaining.toFixed(1) + ' ' + item.unit;
    remEl.style.color = status === 'critical' ? 'var(--red)' : status === 'warn' ? 'var(--amber)' : 'var(--text)';
    remEl.classList.remove('pulse-green', 'pulse-orange');
    void remEl.offsetWidth;
    remEl.classList.add(isBad ? 'pulse-orange' : 'pulse-green');
  }
  const barEl = remEl?.closest('tr')?.querySelector('.progress-fill');
  if (barEl) { barEl.style.width = pct + '%'; barEl.className = 'progress-fill ' + (status === 'critical' ? 'fill-crit' : status === 'warn' ? 'fill-warn' : 'fill-ok'); }
  const pctEl = remEl?.closest('tr')?.querySelector('.progress-pct');
  if (pctEl) pctEl.textContent = pct + '%';
  const pillEl = remEl?.closest('tr')?.querySelector('.pill');
  if (pillEl) pillEl.outerHTML = statusPill(status);

  // Persist to server (debounced to avoid hammering on rapid changes)
  clearTimeout(item._saveTimer);
  item._saveTimer = setTimeout(async () => {
    try {
      await PUT(`/api/inventory/${id}`, {
        name: item.name, cat: item.cat, unit: item.unit, price: item.price,
        total: item.total, used: newUsed, threshold: item.threshold,
        project_id: item.project, mr_number: item.mrNumber,
      });
    } catch (e) {
      toast('Failed to save used quantity: ' + e.message, 'error');
    }
  }, 600);

  updateBadges();
}

/* ════════════════════════════════════════════
   PROJECTS VIEW
   ════════════════════════════════════════════ */

function renderProjects(D) {
  const inv = D.inventory;
  const cards = D.projects.map(p => {
    const spent = projectSpent(p.id, inv), over = spent > p.budget;
    const il = inv.filter(i => i.project === p.id).length;
    const skVal = inv.filter(i => i.project === p.id).reduce((s, i) => s + i.price * calcRemaining(i), 0);
    return `<div class="project-card">
      <div class="proj-top"><div class="proj-name">${p.name}</div>${projStatusPill(p.status)}</div>
      <div class="proj-desc">${p.desc || 'No description'} · Due: ${p.deadline || 'TBD'}</div>
      <div class="proj-cost">${fmtMoney(spent)} <span style="font-size:11px;font-weight:600;color:var(--faint)">spent</span></div>
      <div class="proj-budget">Budget: ${fmtMoney(p.budget)} · ${p.budget > 0 ? Math.round((spent / p.budget) * 100) : 0}% used ${over ? '⚠️ Over budget' : ''}</div>
      <div class="proj-progress-track"><div class="proj-progress-fill" style="width:${p.progress}%"></div></div>
      <div class="proj-meta"><span>${p.progress}% complete</span><span>${il} material${il !== 1 ? 's' : ''} · Stock ${fmtMoney(skVal)}</span></div>
      <div class="proj-actions">
        <button class="btn btn-outline btn-sm" onclick="openProjDrawer('edit','${p.id}')">✎ Edit</button>
        <button class="btn btn-danger btn-sm"  onclick="confirmDelete('project','${p.id}')">✕ Delete</button>
      </div></div>`;
  }).join('');

  const sumRows = D.projects.map(p => {
    const spent = projectSpent(p.id, inv);
    const stock = inv.filter(i => i.project === p.id).reduce((s, i) => s + i.price * calcRemaining(i), 0);
    return `<tr><td style="font-weight:700">${p.name}</td><td>${fmtMoney(p.budget)}</td><td style="color:var(--blue);font-weight:800">${fmtMoney(spent)}</td><td style="color:var(--green);font-weight:700">${fmtMoney(stock)}</td><td>${spent > p.budget ? statusPill('critical') : statusPill('ok')}</td></tr>`;
  }).join('');

  $('content').innerHTML = `
    <div class="grid-3col" style="margin-bottom:16px">
      ${cards || '<div style="grid-column:1/-1"><div class="empty-state"><div class="empty-icon">🎨</div><div class="empty-title">No projects yet</div></div></div>'}
    </div>
    <div class="panel">
      <div class="panel-header"><div class="panel-title">Project Cost Summary</div></div>
      <div class="table-scroll"><table class="inv-table"><thead><tr><th>Project</th><th>Budget</th><th>Spent</th><th>Stock Value</th><th>Budget Status</th></tr></thead><tbody>${sumRows}</tbody></table></div>
    </div>`;
}

/* ════════════════════════════════════════════
   BORROW TRACKER VIEW
   ════════════════════════════════════════════ */

function renderBorrows(D) {
  const borrows = D.borrows || [];
  const out = borrows.filter(b => !b.returned);
  const back = borrows.filter(b => b.returned);

  function row(b) {
    const dc = b.returned ? 'dot-done' : 'dot-overdue';
    const badge = b.returned
      ? '<span class="task-badge badge-done">Returned</span>'
      : '<span class="task-badge badge-overdue">Out on loan</span>';
    const meta = [
      b.team ? `Team: <strong>${esc(b.team)}</strong>` : '',
      b.date ? `Borrowed: ${esc(b.date)}` : '',
      b.returned && b.returnDate ? `Returned: ${esc(b.returnDate)}` : '',
    ].filter(Boolean).join(' · ');
    return `
      <div class="task-row">
        <div class="task-dot ${dc}"></div>
        <div style="flex:1;min-width:0">
          <div class="task-name">${esc(b.item)} <span style="color:var(--faint);font-weight:600">→ ${esc(b.person)}</span></div>
          <div style="font-size:10px;color:var(--faint);font-weight:500;margin-top:2px">${meta || 'No details'}</div>
          ${b.notes ? `<div style="font-size:10px;color:var(--muted);margin-top:2px">“${esc(b.notes)}”</div>` : ''}
          ${badge}
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0;align-items:flex-start">
          ${b.returned
        ? `<button class="btn btn-outline btn-xs" onclick="toggleBorrowReturned(${b.id},false)">↩ Mark Out</button>`
        : `<button class="btn btn-success btn-xs" onclick="toggleBorrowReturned(${b.id},true)">✓ Mark Returned</button>`}
          <button class="btn-icon" onclick="openBorrowDrawer('edit',${b.id})" title="Edit">✎</button>
          <button class="btn-icon" onclick="confirmDelete('borrow',${b.id})" title="Delete" style="color:var(--red)">✕</button>
        </div>
      </div>`;
  }

  function section(title, arr, color) {
    if (!arr.length) return '';
    return `<div class="panel" style="margin-bottom:14px">
      <div class="panel-header"><div class="panel-title"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:7px"></span>${title} (${arr.length})</div></div>
      ${arr.map(row).join('')}</div>`;
  }

  const html = section('Out on loan', out, 'var(--red)')
    + section('Returned', back, 'var(--green)');

  $('content').innerHTML = html || `<div class="empty-state" style="margin-top:48px"><div class="empty-icon">📦</div><div class="empty-title">Nothing borrowed yet</div><div class="empty-sub">Log it when another team takes something from the studio.</div></div>`;
}

async function toggleBorrowReturned(id, returned) {
  const b = window._D.borrows.find(b => b.id === id);
  if (!b) return;
  try {
    await PUT(`/api/borrows/${id}`, {
      person: b.person, team: b.team, item: b.item, date: b.date,
      returned, return_date: returned ? new Date().toISOString().slice(0, 10) : '',
      notes: b.notes,
    });
    await loadAllData();
    renderView();
    updateBadges();
    toast(returned ? 'Marked as returned' : 'Marked as out on loan');
  } catch (e) {
    toast('Failed to update record: ' + e.message, 'error');
  }
}

/* ════════════════════════════════════════════
   ANALYTICS VIEW
   ════════════════════════════════════════════ */

function renderAnalytics(D) {
  const inv = D.inventory;
  const cats = [...new Set(inv.map(i => i.cat))];
  const ti = inv.reduce((s, i) => s + i.price * i.total, 0);
  const tu = inv.reduce((s, i) => s + i.price * i.used, 0);
  const tr_ = ti - tu;
  const ur = ti > 0 ? ((tu / ti) * 100).toFixed(0) : 0;

  const cs = cats.map(c => inv.filter(i => i.cat === c).reduce((s, i) => s + i.price * i.total, 0));
  const cu = cats.map(c => inv.filter(i => i.cat === c).reduce((s, i) => s + i.price * i.used, 0));
  const cp = cats.map((_, i) => cs[i] > 0 ? Math.round((cu[i] / cs[i]) * 100) : 0);

  const usageBars = cats.map((c, i) => {
    const col = cp[i] > 80 ? 'var(--red)' : cp[i] > 50 ? 'var(--amber)' : 'var(--blue)';
    return `<div style="display:flex;align-items:center;gap:14px;margin-bottom:12px">
      <div style="width:130px;font-size:11px;font-weight:700;color:var(--navy);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c}</div>
      <div class="progress-track" style="flex:1;height:8px"><div style="height:100%;border-radius:10px;background:${col};width:${cp[i]}%;transition:width .6s"></div></div>
      <div style="font-size:11px;font-weight:800;color:var(--navy);min-width:36px;text-align:right">${cp[i]}%</div>
      <div style="font-size:10px;color:var(--faint);min-width:48px;text-align:right">${fmtMoney(cs[i])}</div>
    </div>`;
  }).join('');

  $('content').innerHTML = `
    <div class="metrics-grid" style="margin-bottom:16px">
      <div class="metric-card"><div class="metric-accent" style="background:var(--blue)"></div><div class="metric-label">Total Invested</div><div class="metric-value">${fmtMoney(ti)}</div><div class="metric-sub sub-blue">All stock</div></div>
      <div class="metric-card"><div class="metric-accent" style="background:var(--amber)"></div><div class="metric-label">Consumed</div><div class="metric-value">${fmtMoney(tu)}</div><div class="metric-sub sub-amber">Used value</div></div>
      <div class="metric-card"><div class="metric-accent" style="background:var(--green)"></div><div class="metric-label">Remaining</div><div class="metric-value">${fmtMoney(tr_)}</div><div class="metric-sub sub-green">In stock</div></div>
      <div class="metric-card"><div class="metric-accent" style="background:var(--red)"></div><div class="metric-label">Utilization</div><div class="metric-value">${ur}%</div><div class="metric-sub sub-red">Consumed</div></div>
    </div>
    <div class="grid-2col">
      <div class="panel"><div class="panel-header"><div><div class="panel-title">Spend by Category</div><div class="panel-sub">Invested vs consumed</div></div></div><div style="padding:16px;height:240px;position:relative"><canvas id="chart-cat" role="img"></canvas></div></div>
      <div class="panel"><div class="panel-header"><div><div class="panel-title">Project Budget vs Spent</div></div></div><div style="padding:16px;height:240px;position:relative"><canvas id="chart-proj" role="img"></canvas></div></div>
    </div>
    <div class="panel" style="margin-top:0"><div class="panel-header"><div><div class="panel-title">Usage Rate by Category</div></div></div><div style="padding:14px 18px">${usageBars}</div></div>`;

  hideLoader();

  setTimeout(() => {
    destroyCharts();
    const cc = $('chart-cat'), pc = $('chart-proj');
    if (cc && window.Chart) {
      chartInstances.cat = new Chart(cc, { type: 'bar', data: { labels: cats, datasets: [{ label: 'Invested', data: cs, backgroundColor: 'rgba(37,99,235,.7)', borderRadius: 5 }, { label: 'Used', data: cu, backgroundColor: 'rgba(16,185,129,.7)', borderRadius: 5 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { font: { family: 'Montserrat', size: 9 }, maxRotation: 35 } }, y: { ticks: { font: { family: 'Montserrat', size: 9 }, callback: v => '₹' + v } } } } });
    }
    if (pc && window.Chart) {
      const ps = D.projects.map(p => projectSpent(p.id, inv));
      const pb = D.projects.map(p => p.budget);
      chartInstances.proj = new Chart(pc, { type: 'bar', data: { labels: D.projects.map(p => p.name.split(' ')[0]), datasets: [{ label: 'Budget', data: pb, backgroundColor: 'rgba(37,99,235,.2)', borderRadius: 5, borderWidth: 2, borderColor: 'rgba(37,99,235,.6)' }, { label: 'Spent', data: ps, backgroundColor: 'rgba(245,158,11,.75)', borderRadius: 5 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { font: { family: 'Montserrat', size: 9 } } }, y: { ticks: { font: { family: 'Montserrat', size: 9 }, callback: v => '₹' + v } } } } });
    }
  }, 60);
}

function destroyCharts() {
  Object.values(chartInstances).forEach(c => { try { c.destroy(); } catch (e) { } });
  chartInstances = {};
}

/* ════════════════════════════════════════════
   ADMIN VIEW
   ════════════════════════════════════════════ */

async function renderAdmin() {
  if (currentUser?.role !== 'admin') {
    hideLoader();
    $('content').innerHTML = '<div class="empty-state"><div class="empty-title">Access denied</div></div>';
    return;
  }

  let users;
  try {
    users = await GET('/api/admin/users');
  } catch (e) {
    hideLoader();
    toast('Failed to load users: ' + e.message, 'error');
    return;
  }

  hideLoader();

  const pendingCount = users.filter(u => u.status === 'pending').length;
  const badge = $('pending-badge');
  if (badge) { badge.textContent = pendingCount; badge.style.display = pendingCount > 0 ? 'inline' : 'none'; }

  const rows = users.map(u => {
    const statusCls = `status-${u.status}`;
    const actionBtns = u.role !== 'admin' ? `
      ${u.status !== 'approved' ? `<button class="btn btn-success btn-xs" onclick="adminAction(${u.id},'approved')">✓ Approve</button>` : ''}
      ${u.status !== 'rejected' ? `<button class="btn btn-danger btn-xs"  onclick="adminAction(${u.id},'rejected')" style="margin-left:4px">✕ Reject</button>` : ''}
    ` : '<span class="pill pill-blue" style="font-size:9px">Admin</span>';

    return `<tr>
      <td><div style="font-weight:700;font-size:12px">${u.name}</div><div style="font-size:10px;color:var(--faint)">${u.email}</div></td>
      <td><span class="pill ${u.role === 'admin' ? 'pill-blue' : 'pill-gray'}" style="font-size:9px">${u.role}</span></td>
      <td><span class="${statusCls}">${u.status.charAt(0).toUpperCase() + u.status.slice(1)}</span></td>
      <td style="font-size:10px;color:var(--faint)">${new Date(u.created_at).toLocaleDateString()}</td>
      <td style="white-space:nowrap">${actionBtns}</td>
    </tr>`;
  }).join('');

  $('content').innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <div>
          <div class="panel-title">Studio Members</div>
          <div class="panel-sub">${users.length} accounts · ${pendingCount} pending approval · Only @eplane.ai addresses permitted</div>
        </div>
      </div>
      ${pendingCount > 0 ? `<div style="padding:10px 16px;background:#fffbeb;border-bottom:1px solid #fef3c7;font-size:11px;font-weight:700;color:#92400e">⚠ ${pendingCount} user${pendingCount !== 1 ? 's' : ''} waiting for approval</div>` : ''}
      <div class="table-scroll">
        <table class="admin-table">
          <thead><tr><th>User</th><th>Role</th><th>Status</th><th>Joined</th><th>Actions</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

async function adminAction(userId, status) {
  try {
    await PATCH(`/api/admin/users/${userId}`, { status });
    toast(`User ${status === 'approved' ? 'approved' : 'rejected'} successfully`);
    await renderAdmin();
  } catch (e) {
    toast('Action failed: ' + e.message, 'error');
  }
}

/* ════════════════════════════════════════════
   ITEM DRAWER — ADD / EDIT
   ════════════════════════════════════════════ */

async function openItemDrawer(mode, id) {
  $('item-drawer-title').textContent = mode === 'add' ? 'Add Inventory Item' : 'Edit Item';
  $('item-edit-id').value = '';
  ['f-name', 'f-price', 'f-total', 'f-used', 'f-threshold', 'f-notes'].forEach(fid => $(fid).value = '');

  if (mode === 'edit' && id) {
    const item = window._D.inventory.find(i => i.id === id);
    if (item) {
      $('item-edit-id').value = id;
      $('f-name').value = item.name;
      $('f-cat').value = item.cat;
      $('f-unit').value = item.unit;
      $('f-price').value = item.price;
      $('f-total').value = item.total;
      $('f-used').value = item.used;
      $('f-threshold').value = item.threshold;
      $('f-notes').value = item.mrNumber || '';
      $('f-project').value = item.project || '';
    }
  }
  refreshProjSelect('f-project');
  openOverlay('item-overlay', 'item-drawer');
}

function closeItemDrawer() { closeOverlay('item-overlay', 'item-drawer'); }

async function saveItem() {
  const name = $('f-name').value.trim();
  if (!name) { alert('Material name is required.'); return; }

  const payload = {
    name, cat: $('f-cat').value, unit: $('f-unit').value,
    price: parseFloat($('f-price').value) || 0,
    total: parseFloat($('f-total').value) || 0,
    used: parseFloat($('f-used').value) || 0,
    threshold: parseFloat($('f-threshold').value) || 1,
    project_id: $('f-project').value || '',
    mr_number: $('f-notes').value.trim(),
  };

  const editId = parseInt($('item-edit-id').value);
  const btn = $('item-drawer').querySelector('.btn-primary');
  btn.disabled = true; btn.textContent = 'Saving…';

  try {
    if (editId) {
      await PUT(`/api/inventory/${editId}`, payload);
      toast('Item updated');
    } else {
      await POST('/api/inventory', payload);
      toast('Item added');
    }
    closeItemDrawer();
    await loadAllData();
    renderView();
  } catch (e) {
    toast('Failed to save: ' + e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Save Item';
  }
}

/* ════════════════════════════════════════════
   PROJECT DRAWER — ADD / EDIT
   ════════════════════════════════════════════ */

function openProjDrawer(mode, id) {
  $('proj-drawer-title').textContent = mode === 'edit' ? 'Edit Project' : 'New Project';
  $('proj-edit-id').value = '';
  ['p-name', 'p-desc', 'p-budget', 'p-progress', 'p-deadline'].forEach(fid => $(fid).value = '');
  $('p-status').value = 'active';

  if (mode === 'edit' && id) {
    const p = window._D.projects.find(p => p.id === id);
    if (p) {
      $('proj-edit-id').value = id;
      $('p-name').value = p.name;
      $('p-desc').value = p.desc || '';
      $('p-budget').value = p.budget;
      $('p-progress').value = p.progress;
      $('p-status').value = p.status;
      $('p-deadline').value = p.deadline || '';
    }
  }
  openOverlay('proj-overlay', 'proj-drawer');
}

function closeProjDrawer() { closeOverlay('proj-overlay', 'proj-drawer'); }

async function saveProject() {
  const name = $('p-name').value.trim();
  if (!name) { alert('Project name is required.'); return; }

  const payload = {
    name, desc: $('p-desc').value.trim(),
    budget: parseFloat($('p-budget').value) || 0,
    progress: Math.min(100, Math.max(0, parseInt($('p-progress').value) || 0)),
    status: $('p-status').value,
    deadline: $('p-deadline').value,
  };

  const editId = $('proj-edit-id').value;
  const btn = $('proj-drawer').querySelector('.btn-primary');
  btn.disabled = true; btn.textContent = 'Saving…';

  try {
    if (editId) {
      await PUT(`/api/projects/${editId}`, payload);
      toast('Project updated');
    } else {
      await POST('/api/projects', payload);
      toast('Project created');
    }
    closeProjDrawer();
    await loadAllData();
    renderView();
    refreshProjSelect('f-project');
  } catch (e) {
    toast('Failed to save: ' + e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Save Project';
  }
}

/* ════════════════════════════════════════════
   BORROW DRAWER — ADD / EDIT
   ════════════════════════════════════════════ */

function openBorrowDrawer(mode, id) {
  $('borrow-drawer-title').textContent = mode === 'edit' ? 'Edit Borrow Record' : 'Log Borrowed Item';
  $('borrow-edit-id').value = '';
  $('b-person').value = ''; $('b-team').value = ''; $('b-item').value = '';
  $('b-notes').value = ''; $('b-returned').value = '0';
  $('b-date').value = new Date().toISOString().slice(0, 10);

  // Populate item suggestions from current inventory
  const dl = $('b-item-options');
  if (dl) {
    dl.innerHTML = '';
    [...new Set((window._D.inventory || []).map(i => i.name))].forEach(n => {
      const opt = document.createElement('option'); opt.value = n; dl.appendChild(opt);
    });
  }

  if (mode === 'edit' && id) {
    const b = window._D.borrows.find(b => b.id === id);
    if (b) {
      $('borrow-edit-id').value = id;
      $('b-person').value = b.person;
      $('b-team').value = b.team || '';
      $('b-item').value = b.item;
      $('b-date').value = b.date || '';
      $('b-returned').value = b.returned ? '1' : '0';
      $('b-notes').value = b.notes || '';
    }
  }
  openOverlay('borrow-overlay', 'borrow-drawer');
}

function closeBorrowDrawer() { closeOverlay('borrow-overlay', 'borrow-drawer'); }

async function saveBorrow() {
  const person = $('b-person').value.trim();
  const item = $('b-item').value.trim();
  if (!person) { alert('Borrower name is required.'); return; }
  if (!item) { alert('Item name is required.'); return; }

  const returned = $('b-returned').value === '1';
  const payload = {
    person, team: $('b-team').value.trim(), item,
    date: $('b-date').value,
    returned,
    return_date: returned ? new Date().toISOString().slice(0, 10) : '',
    notes: $('b-notes').value.trim(),
  };

  const editId = parseInt($('borrow-edit-id').value);
  const btn = $('borrow-drawer').querySelector('.btn-primary');
  btn.disabled = true; btn.textContent = 'Saving…';

  try {
    if (editId) {
      await PUT(`/api/borrows/${editId}`, payload);
      toast('Borrow record updated');
    } else {
      await POST('/api/borrows', payload);
      toast('Borrow logged');
    }
    closeBorrowDrawer();
    await loadAllData();
    renderView();
    updateBadges();
  } catch (e) {
    toast('Failed to save: ' + e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Save Record';
  }
}

/* ════════════════════════════════════════════
   DELETE CONFIRM
   ════════════════════════════════════════════ */

function confirmDelete(type, id) {
  const msgs = { item: 'Delete this item? This cannot be undone.', project: 'Delete this project? Linked items will return to Studio Stock.', borrow: 'Delete this borrow record?' };
  $('confirm-msg').textContent = msgs[type] || 'Are you sure?';
  $('confirm-overlay').classList.add('open');

  confirmCallback = async () => {
    closeConfirm();
    try {
      if (type === 'item') await DELETE(`/api/inventory/${id}`);
      if (type === 'project') await DELETE(`/api/projects/${id}`);
      if (type === 'borrow') await DELETE(`/api/borrows/${id}`);
      toast(type.charAt(0).toUpperCase() + type.slice(1) + ' deleted');
      await loadAllData();
      renderView();
      updateBadges();
    } catch (e) {
      toast('Delete failed: ' + e.message, 'error');
    }
  };
  $('confirm-yes').onclick = confirmCallback;
}

function closeConfirm() { $('confirm-overlay').classList.remove('open'); confirmCallback = null; }

/* ════════════════════════════════════════════
   PDF EXPORT
   ════════════════════════════════════════════ */

function openPDF() {
  const D = window._D, inv = D.inventory;
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const totalInv = inv.reduce((s, i) => s + i.price * i.total, 0);
  const remVal = inv.reduce((s, i) => s + i.price * calcRemaining(i), 0);
  const crit = inv.filter(i => itemStatus(i) === 'critical').length;

  const invRows = inv.map(i => {
    const rem = calcRemaining(i), st = itemStatus(i);
    const stLabel = st === 'critical' ? 'Critical' : st === 'warn' ? 'Low' : 'OK';
    const stColor = st === 'critical' ? '#991b1b' : st === 'warn' ? '#92400e' : '#065f46';
    return `<tr style="background:${st === 'critical' ? '#fff0f0' : ''}">
      <td style="padding:7px 9px;font-weight:700">${i.name}</td>
      <td style="padding:7px 9px">${i.cat}</td>
      <td style="padding:7px 9px;color:#2563eb;font-weight:700">${i.mrNumber || '—'}</td>
      <td style="padding:7px 9px">${i.total} ${i.unit}</td>
      <td style="padding:7px 9px">${i.used} ${i.unit}</td>
      <td style="padding:7px 9px;font-weight:800">${rem.toFixed(1)} ${i.unit}</td>
      <td style="padding:7px 9px">${fmtMoney(i.price * calcRemaining(i))}</td>
      <td style="padding:7px 9px;font-weight:800;color:${stColor}">${stLabel}</td>
    </tr>`;
  }).join('');

  const projRows = D.projects.map(p => {
    const spent = projectSpent(p.id, inv), over = spent > p.budget;
    return `<tr>
      <td style="padding:7px 9px;font-weight:700">${esc(p.name)}</td>
      <td style="padding:7px 9px">${fmtMoney(p.budget)}</td>
      <td style="padding:7px 9px;color:#2563eb;font-weight:800">${fmtMoney(spent)}</td>
      <td style="padding:7px 9px">${p.progress}%</td>
      <td style="padding:7px 9px;font-weight:700;color:${over ? '#991b1b' : '#065f46'}">${over ? 'Over Budget' : 'On Track'}</td>
    </tr>`;
  }).join('');

  const borrows = D.borrows || [];
  const borrowRows = borrows.map(b => `<tr>
      <td style="padding:7px 9px;font-weight:700">${esc(b.item)}</td>
      <td style="padding:7px 9px">${esc(b.person)}</td>
      <td style="padding:7px 9px">${esc(b.team || '—')}</td>
      <td style="padding:7px 9px">${esc(b.date || '—')}</td>
      <td style="padding:7px 9px;font-weight:700;color:${b.returned ? '#065f46' : '#991b1b'}">${b.returned ? 'Returned' : 'Out on loan'}</td>
    </tr>`).join('');

  $('pdf-content').innerHTML = `
    <div class="pdf-header-row">
      <div><div class="pdf-company">The ePlane Co.</div><div class="pdf-co-sub">Clay Studio · Inventory Report</div></div>
      <div class="pdf-date">Generated: ${date}<br>Signed in as: ${currentUser?.name || ''}</div>
    </div>
    <div class="pdf-summary">
      <div class="pdf-stat"><div class="pdf-stat-lbl">Total Items</div><div class="pdf-stat-val">${inv.length}</div></div>
      <div class="pdf-stat"><div class="pdf-stat-lbl">Total Invested</div><div class="pdf-stat-val">${fmtMoney(totalInv)}</div></div>
      <div class="pdf-stat"><div class="pdf-stat-lbl">Remaining Value</div><div class="pdf-stat-val">${fmtMoney(remVal)}</div></div>
    </div>
    <div class="pdf-section">Inventory List</div>
    <table class="pdf-table"><thead><tr><th>Material</th><th>Category</th><th>MR Number</th><th>Total</th><th>Used</th><th>Remaining</th><th>Value</th><th>Status</th></tr></thead><tbody>${invRows}</tbody></table>
    <div class="pdf-section">Projects Summary</div>
    <table class="pdf-table"><thead><tr><th>Project</th><th>Budget</th><th>Spent</th><th>Progress</th><th>Status</th></tr></thead><tbody>${projRows}</tbody></table>
    <div class="pdf-section">Borrowed Items</div>
    <table class="pdf-table"><thead><tr><th>Item</th><th>Borrower</th><th>Team</th><th>Date</th><th>Status</th></tr></thead><tbody>${borrowRows || '<tr><td colspan="5" style="padding:10px;text-align:center;color:#9ca3af">Nothing on loan</td></tr>'}</tbody></table>
    <div class="pdf-footer">The ePlane Co. · Clay Studio Inventory System · Confidential · ${date} · ${crit} critical item${crit !== 1 ? 's' : ''} require attention</div>`;

  $('pdf-overlay').classList.add('open');
}

function closePDF() { $('pdf-overlay').classList.remove('open'); }

/* ════════════════════════════════════════════
   OVERLAY HELPERS
   ════════════════════════════════════════════ */

function openOverlay(oid, did) { $(oid).classList.add('open'); $(did).classList.add('open'); }
function closeOverlay(oid, did) { $(oid).classList.remove('open'); $(did).classList.remove('open'); }

function refreshProjSelect(selectId) {
  const sel = $(selectId); if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">— Studio Stock —</option>';
  (window._D.projects || []).forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id; opt.textContent = p.name;
    if (p.id === cur) opt.selected = true;
    sel.appendChild(opt);
  });
}

/* ════════════════════════════════════════════
   KEYBOARD SHORTCUTS
   ════════════════════════════════════════════ */

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeItemDrawer(); closeProjDrawer(); closeBorrowDrawer();
    closePDF(); closeConfirm(); closeSidebar();
  }
});

/* ════════════════════════════════════════════
   BUTTON RIPPLE — click micro-interaction
   Delegated so it also applies to dynamically rendered buttons.
   ════════════════════════════════════════════ */
document.addEventListener('pointerdown', e => {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const btn = e.target.closest('.btn, .btn-icon, .auth-btn');
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  ripple.style.width = ripple.style.height = size + 'px';
  ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
  ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
  // Ensure the button can host an absolutely-positioned child
  const cs = getComputedStyle(btn);
  if (cs.position === 'static') btn.style.position = 'relative';
  if (cs.overflow !== 'hidden') btn.style.overflow = 'hidden';
  btn.appendChild(ripple);
  ripple.addEventListener('animationend', () => ripple.remove());
});
