/**
 * server.js — The ePlane Co. Clay Studio Full-Stack Server
 * Vercel-ready: works as a serverless function and as a local Express server.
 */

'use strict';

// Load .env (local dev) before anything reads process.env. No-ops on Vercel.
require('./db/load-env');

const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const { initDB } = require('./db/init');
const { sendOTPEmail, sendNewUserNotification, sendApprovalEmail, isMailerConfigured } = require('./db/mailer');

/* ════════════════════════════════════════════
   CONFIG
   ════════════════════════════════════════════ */

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRY = '7d';

if (!JWT_SECRET) {
  console.warn('⚠️  JWT_SECRET environment variable is not set. Using insecure default — set it in Vercel!');
}
const EFFECTIVE_JWT_SECRET = JWT_SECRET || 'eplane-studio-insecure-fallback-set-jwt-secret-env-var';

// Admin emails — set via environment variables in Vercel dashboard
// Vercel: Project → Settings → Environment Variables
// Add: ADMIN_EMAIL_1=rahul.sp@eplane.ai  and  ADMIN_EMAIL_2=rajan.sunjay@eplane.ai
const ADMIN_EMAILS = [
  process.env.ADMIN_EMAIL_1,
  process.env.ADMIN_EMAIL_2,
].filter(Boolean).map(e => e.trim().toLowerCase());

const ALLOWED_DOMAIN = '@eplane.ai';

/* ════════════════════════════════════════════
   DB (initialized once, reused across requests)
   ════════════════════════════════════════════ */

let db;
let dbReady = false;
let dbInitPromise = null;

async function getDB() {
  if (dbReady) return db;
  if (!dbInitPromise) {
    dbInitPromise = initDB().then(database => {
      db = database;
      dbReady = true;
      return db;
    });
  }
  return dbInitPromise;
}

/* ════════════════════════════════════════════
   APP
   ════════════════════════════════════════════ */

const app = express();

// Trust the upstream proxy (Vercel / any TLS-terminating host) so req.secure
// and req.protocol reflect the original client connection.
app.set('trust proxy', 1);

/* ────────────────────────────────────────────
   COOKIE OPTIONS — adapt to HTTP (local) vs HTTPS (prod)
   A "Secure" cookie is silently dropped by browsers over plain HTTP,
   which would break login + every authenticated action in local dev.
   ──────────────────────────────────────────── */
function isSecureRequest(req) {
  return req.secure
    || req.protocol === 'https'
    || (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function authCookieOptions(req) {
  const secure = isSecureRequest(req);
  return {
    httpOnly: true,
    secure,                        // only mark Secure when actually on HTTPS
    sameSite: secure ? 'None' : 'Lax',
    path: '/',
    maxAge: 7 * 24 * 3600 * 1000,
  };
}

// ── CORS ─────────────────────────────────────
app.use((req, res, next) => {
  const origin = req.headers.origin;
  // Allow local dev and any Vercel deployment of this project
  const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
  ];
  // Also allow the app's own Vercel URL automatically
  const vercelUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null;
  if (vercelUrl) allowedOrigins.push(vercelUrl);

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ── Health / warmup endpoint — hit this first to wake up the DB ──
app.get('/api/health', async (req, res) => {
  try {
    await getDB();
    res.json({ ok: true, ts: Date.now() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── DB middleware: ensure DB is ready before any /api route ──
app.use('/api', async (req, res, next) => {
  try {
    await getDB();
    next();
  } catch (err) {
    console.error('DB init error:', err);
    res.status(500).json({ error: 'Database initialization failed.', detail: err.message });
  }
});

/* ════════════════════════════════════════════
   AUTH MIDDLEWARE
   ════════════════════════════════════════════ */

function requireAuth(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated.' });

  try {
    const payload = jwt.verify(token, EFFECTIVE_JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id);
    if (!user) return res.status(401).json({ error: 'User not found.' });
    if (user.status === 'rejected') return res.status(403).json({ error: 'Your account has been rejected.' });
    if (user.status === 'pending') return res.status(403).json({ error: 'Your account is pending admin approval.', pending: true });
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Session expired. Please sign in again.' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
  next();
}

/* ════════════════════════════════════════════
   AUTH ROUTES
   ════════════════════════════════════════════ */

app.post('/api/auth/signup', async (req, res) => {
  const { email, name, password } = req.body;

  if (!email || !name || !password)
    return res.status(400).json({ error: 'Email, name, and password are required.' });

  const cleanEmail = email.trim().toLowerCase();
  const cleanName = name.trim();

  if (!cleanEmail.endsWith(ALLOWED_DOMAIN))
    return res.status(400).json({ error: `Only ${ALLOWED_DOMAIN} email addresses are allowed.` });

  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
  if (existing) return res.status(409).json({ error: 'An account with this email already exists.' });

  const isAdmin = ADMIN_EMAILS.includes(cleanEmail);
  const role = isAdmin ? 'admin' : 'user';
  const status = isAdmin ? 'approved' : 'pending';
  const hash = bcrypt.hashSync(password, 10);

  const result = db.prepare(`
    INSERT INTO users (email, name, password, role, status)
    VALUES (?, ?, ?, ?, ?)
  `).run(cleanEmail, cleanName, hash, role, status);

  if (isAdmin) {
    const token = jwt.sign({ id: result.lastInsertRowid, role }, EFFECTIVE_JWT_SECRET, { expiresIn: JWT_EXPIRY });
    res.cookie('token', token, authCookieOptions(req));
    return res.json({ ok: true, name: cleanName, role, status: 'approved' });
  }

  // Notify all admins about new signup (background, don't block response)
  try {
    const admins = db.prepare(`SELECT email, name FROM users WHERE role = 'admin' AND status = 'approved'`).all();
    for (const admin of admins) {
      sendNewUserNotification({
        adminEmail: admin.email,
        adminName: admin.name,
        newUserName: cleanName,
        newUserEmail: cleanEmail,
      }).catch(e => console.error('[Mailer] Signup notify error:', e.message));
    }
  } catch (e) {
    console.error('[Mailer] Failed to notify admins:', e.message);
  }

  return res.status(202).json({
    ok: true,
    pending: true,
    message: 'Account created. An admin has been notified and will approve your access shortly.',
  });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required.' });

  const cleanEmail = email.trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);

  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Invalid email or password.' });

  if (user.status === 'rejected')
    return res.status(403).json({ error: 'Your account has been rejected. Contact an admin.' });

  if (user.status === 'pending')
    return res.status(403).json({
      error: 'Your account is pending admin approval.',
      pending: true,
    });

  const token = jwt.sign({ id: user.id, role: user.role }, EFFECTIVE_JWT_SECRET, { expiresIn: JWT_EXPIRY });
  res.cookie('token', token, authCookieOptions(req));

  return res.json({ ok: true, name: user.name, role: user.role, email: user.email });
});

// Step 1: Request OTP
app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required.' });

  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail.endsWith('@eplane.ai'))
    return res.status(400).json({ error: 'Only @eplane.ai accounts are permitted.' });

  const user = db.prepare('SELECT id, name, email FROM users WHERE email = ?').get(cleanEmail);

  // Always return ok — don't reveal if account exists
  if (!user) return res.json({ ok: true, message: 'If this email exists, an OTP has been sent.' });

  // Generate 6-digit OTP, valid 10 minutes
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  // Delete old OTPs for this email, save new one
  db.prepare('DELETE FROM otp_tokens WHERE email = ?').run(cleanEmail);
  db.prepare('INSERT INTO otp_tokens (email, otp, expires_at) VALUES (?, ?, ?)').run(cleanEmail, otp, expiresAt);

  // If email delivery isn't configured (no Gmail creds), there's no inbox to
  // receive the code. On a non-production deployment we return the OTP directly
  // so the reset flow is still usable; in production we never expose it.
  if (!isMailerConfigured()) {
    console.log(`\n🔐 [DEV OTP] ${cleanEmail} → ${otp}  (email delivery not configured)\n`);
    const isProd = !!process.env.VERCEL || process.env.NODE_ENV === 'production';
    if (!isProd) {
      return res.json({
        ok: true,
        devOtp: otp,
        message: 'Email delivery is not set up, so the code is shown here for testing.',
      });
    }
    return res.status(500).json({
      error: 'Email service is not configured. Ask an admin to set GMAIL_USER and GMAIL_APP_PASS.',
    });
  }

  try {
    await sendOTPEmail({ to: cleanEmail, name: user.name, otp });
  } catch (e) {
    console.error('[Mailer] OTP send error:', e.message);
    return res.status(500).json({ error: 'Failed to send OTP email. Check GMAIL_USER and GMAIL_APP_PASS env vars.' });
  }

  return res.json({ ok: true, message: 'OTP sent to your email.' });
});

// Step 2: Verify OTP
app.post('/api/auth/verify-otp', (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return res.status(400).json({ error: 'Email and OTP are required.' });

  const cleanEmail = email.trim().toLowerCase();
  const record = db.prepare(
    'SELECT * FROM otp_tokens WHERE email = ? AND used = 0 ORDER BY id DESC LIMIT 1'
  ).get(cleanEmail);

  if (!record) return res.status(400).json({ error: 'No OTP found. Please request a new one.' });
  if (new Date(record.expires_at) < new Date())
    return res.status(400).json({ error: 'OTP has expired. Please request a new one.' });
  if (record.otp !== otp.trim())
    return res.status(400).json({ error: 'Invalid OTP. Please check your email and try again.' });

  // Mark OTP as used — valid for 5 min reset window
  db.prepare('UPDATE otp_tokens SET used = 1 WHERE id = ?').run(record.id);

  // Issue a short-lived reset token (5 min)
  const resetToken = jwt.sign({ email: cleanEmail, purpose: 'password-reset' }, EFFECTIVE_JWT_SECRET, { expiresIn: '5m' });
  return res.json({ ok: true, resetToken });
});

// Step 3: Set new password
app.post('/api/auth/reset-password', (req, res) => {
  const { resetToken, newPassword } = req.body;
  if (!resetToken || !newPassword)
    return res.status(400).json({ error: 'Reset token and new password are required.' });
  if (newPassword.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  let payload;
  try {
    payload = jwt.verify(resetToken, EFFECTIVE_JWT_SECRET);
  } catch (e) {
    return res.status(400).json({ error: 'Reset link expired. Please start again.' });
  }

  if (payload.purpose !== 'password-reset')
    return res.status(400).json({ error: 'Invalid reset token.' });

  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password = ? WHERE email = ?').run(hash, payload.email);

  return res.json({ ok: true, message: 'Password updated. You can now sign in.' });
});

app.post('/api/auth/logout', (req, res) => {
  const secure = isSecureRequest(req);
  res.clearCookie('token', { httpOnly: true, secure, sameSite: secure ? 'None' : 'Lax', path: '/' });
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const token = req.cookies?.token;
  if (!token) return res.json({ loggedIn: false });

  try {
    const payload = jwt.verify(token, EFFECTIVE_JWT_SECRET);
    const user = db.prepare('SELECT id, email, name, role, status FROM users WHERE id = ?').get(payload.id);
    if (!user || user.status !== 'approved') return res.json({ loggedIn: false });
    return res.json({ loggedIn: true, name: user.name, role: user.role, email: user.email });
  } catch (e) {
    return res.json({ loggedIn: false });
  }
});

/* ════════════════════════════════════════════
   INVENTORY ROUTES
   ════════════════════════════════════════════ */

app.get('/api/inventory', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM inventory ORDER BY id').all();
  res.json(rows.map(dbRowToInvItem));
});

app.post('/api/inventory', requireAuth, (req, res) => {
  const { name, cat, unit, price, total, used, threshold, project_id, mr_number } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required.' });

  const usedClamped = Math.min(parseFloat(used) || 0, parseFloat(total) || 0);

  const r = db.prepare(`
    INSERT INTO inventory (name, cat, unit, price, total, used, threshold, project_id, mr_number, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(name, cat || 'Other', unit || 'units', parseFloat(price) || 0,
    parseFloat(total) || 0, usedClamped, parseFloat(threshold) || 1,
    project_id || '', mr_number || '');

  const row = db.prepare('SELECT * FROM inventory WHERE id = ?').get(r.lastInsertRowid);
  res.status(201).json(dbRowToInvItem(row));
});

app.put('/api/inventory/:id', requireAuth, (req, res) => {
  const { name, cat, unit, price, total, used, threshold, project_id, mr_number } = req.body;
  const id = parseInt(req.params.id);
  const existing = db.prepare('SELECT id FROM inventory WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Item not found.' });

  const usedClamped = Math.min(parseFloat(used) || 0, parseFloat(total) || 0);

  db.prepare(`
    UPDATE inventory SET
      name=?, cat=?, unit=?, price=?, total=?,
      used=?, threshold=?, project_id=?, mr_number=?,
      updated_at=datetime('now')
    WHERE id=?
  `).run(name, cat, unit, parseFloat(price) || 0, parseFloat(total) || 0,
    usedClamped, parseFloat(threshold) || 1, project_id || '', mr_number || '', id);

  const row = db.prepare('SELECT * FROM inventory WHERE id = ?').get(id);
  res.json(dbRowToInvItem(row));
});

app.delete('/api/inventory/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM inventory WHERE id = ?').run(parseInt(req.params.id));
  res.json({ ok: true });
});

/* ════════════════════════════════════════════
   PROJECTS ROUTES
   ════════════════════════════════════════════ */

app.get('/api/projects', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM projects ORDER BY created_at').all();
  res.json(rows.map(dbRowToProject));
});

app.post('/api/projects', requireAuth, (req, res) => {
  const { name, desc, budget, progress, status, deadline } = req.body;
  if (!name) return res.status(400).json({ error: 'Project name is required.' });

  const id = 'p' + Date.now();
  db.prepare(`
    INSERT INTO projects (id, name, desc, budget, progress, status, deadline, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(id, name, desc || '', parseFloat(budget) || 0,
    Math.min(100, Math.max(0, parseInt(progress) || 0)),
    status || 'active', deadline || '');

  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  res.status(201).json(dbRowToProject(row));
});

app.put('/api/projects/:id', requireAuth, (req, res) => {
  const { name, desc, budget, progress, status, deadline } = req.body;
  const id = req.params.id;
  const existing = db.prepare('SELECT id FROM projects WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Project not found.' });

  db.prepare(`
    UPDATE projects SET
      name=?, desc=?, budget=?, progress=?,
      status=?, deadline=?, updated_at=datetime('now')
    WHERE id=?
  `).run(name, desc || '', parseFloat(budget) || 0,
    Math.min(100, Math.max(0, parseInt(progress) || 0)),
    status || 'active', deadline || '', id);

  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  res.json(dbRowToProject(row));
});

app.delete('/api/projects/:id', requireAuth, (req, res) => {
  const id = req.params.id;
  db.prepare("UPDATE inventory SET project_id='' WHERE project_id=?").run(id);
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  res.json({ ok: true });
});

/* ════════════════════════════════════════════
   BORROW TRACKER ROUTES
   Track items another team has borrowed from the studio.
   ════════════════════════════════════════════ */

app.get('/api/borrows', requireAuth, (req, res) => {
  // Outstanding (not returned) first, then most recent borrow date
  const rows = db.prepare('SELECT * FROM borrows ORDER BY returned ASC, borrow_date DESC, id DESC').all();
  res.json(rows.map(dbRowToBorrow));
});

app.post('/api/borrows', requireAuth, (req, res) => {
  const { person, team, item, date, returned, return_date, notes } = req.body;
  if (!person || !person.trim()) return res.status(400).json({ error: 'Borrower name is required.' });
  if (!item || !item.trim()) return res.status(400).json({ error: 'Item name is required.' });

  const isReturned = returned ? 1 : 0;
  const r = db.prepare(`
    INSERT INTO borrows (person_name, team, item_name, borrow_date, return_date, returned, notes, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(person.trim(), (team || '').trim(), item.trim(), date || '',
    isReturned ? (return_date || new Date().toISOString().slice(0, 10)) : '',
    isReturned, (notes || '').trim());

  const row = db.prepare('SELECT * FROM borrows WHERE id = ?').get(r.lastInsertRowid);
  res.status(201).json(dbRowToBorrow(row));
});

app.put('/api/borrows/:id', requireAuth, (req, res) => {
  const { person, team, item, date, returned, return_date, notes } = req.body;
  const id = parseInt(req.params.id);
  const existing = db.prepare('SELECT id FROM borrows WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Borrow record not found.' });

  const isReturned = returned ? 1 : 0;
  db.prepare(`
    UPDATE borrows SET
      person_name=?, team=?, item_name=?, borrow_date=?,
      return_date=?, returned=?, notes=?, updated_at=datetime('now')
    WHERE id=?
  `).run((person || '').trim(), (team || '').trim(), (item || '').trim(), date || '',
    isReturned ? (return_date || new Date().toISOString().slice(0, 10)) : '',
    isReturned, (notes || '').trim(), id);

  const row = db.prepare('SELECT * FROM borrows WHERE id = ?').get(id);
  res.json(dbRowToBorrow(row));
});

app.delete('/api/borrows/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM borrows WHERE id = ?').run(parseInt(req.params.id));
  res.json({ ok: true });
});

/* ════════════════════════════════════════════
   ADMIN ROUTES
   ════════════════════════════════════════════ */

app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT id, email, name, role, status, created_at FROM users ORDER BY created_at DESC
  `).all();
  res.json(users);
});

app.patch('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const { status } = req.body;
  const id = parseInt(req.params.id);

  if (!['approved', 'rejected'].includes(status))
    return res.status(400).json({ error: 'Status must be approved or rejected.' });

  const user = db.prepare('SELECT id, email, name, role FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (user.role === 'admin')
    return res.status(400).json({ error: 'Cannot change admin account status.' });

  db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, id);

  // Email the user to let them know the decision
  sendApprovalEmail({
    to: user.email,
    name: user.name,
    approved: status === 'approved',
  }).catch(e => console.error('[Mailer] Approval notify error:', e.message));

  res.json({ ok: true });
});

/* ════════════════════════════════════════════
   DATA SHAPE HELPERS
   ════════════════════════════════════════════ */

function dbRowToInvItem(row) {
  return {
    id: row.id, name: row.name, cat: row.cat, unit: row.unit,
    price: row.price, total: row.total, used: row.used,
    threshold: row.threshold, project: row.project_id || '',
    mrNumber: row.mr_number || '',
  };
}

function dbRowToProject(row) {
  return {
    id: row.id, name: row.name, desc: row.desc || '',
    budget: row.budget, progress: row.progress,
    status: row.status, deadline: row.deadline || '',
  };
}

function dbRowToBorrow(row) {
  return {
    id: row.id,
    person: row.person_name,
    team: row.team || '',
    item: row.item_name,
    date: row.borrow_date || '',
    returned: !!row.returned,
    returnDate: row.return_date || '',
    notes: row.notes || '',
  };
}

/* ════════════════════════════════════════════
   CATCH-ALL — SPA routing
   ════════════════════════════════════════════ */

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ════════════════════════════════════════════
   START (local dev only — Vercel uses module.exports)
   ════════════════════════════════════════════ */

// Pre-warm the DB on start
getDB().catch(err => console.error('DB init failed:', err));

if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`\n🎨 ePlane Clay Studio → http://localhost:${PORT}\n`);
  });
}

// Required for Vercel serverless
module.exports = app;
