'use strict';

/**
 * db/init.js — Database initialization & seed
 */

require('./load-env');

const { createDatabase } = require('./sqlite-shim');
const bcrypt = require('bcryptjs');

async function initDB() {
  const db = await createDatabase();

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  /* ══════════════════════════════════════
     SCHEMA
     ══════════════════════════════════════ */

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      email      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
      name       TEXT    NOT NULL,
      password   TEXT    NOT NULL,
      role       TEXT    NOT NULL DEFAULT 'user'    CHECK(role   IN ('admin','user')),
      status     TEXT    NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS inventory (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      cat        TEXT    NOT NULL DEFAULT 'Other',
      unit       TEXT    NOT NULL DEFAULT 'units',
      price      REAL    NOT NULL DEFAULT 0,
      total      REAL    NOT NULL DEFAULT 0,
      used       REAL    NOT NULL DEFAULT 0,
      threshold  REAL    NOT NULL DEFAULT 1,
      project_id TEXT    DEFAULT '',
      mr_number  TEXT    DEFAULT '',
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS projects (
      id         TEXT    PRIMARY KEY,
      name       TEXT    NOT NULL,
      desc       TEXT    DEFAULT '',
      budget     REAL    NOT NULL DEFAULT 0,
      progress   INTEGER NOT NULL DEFAULT 0,
      status     TEXT    NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','on-hold')),
      deadline   TEXT    DEFAULT '',
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS borrows (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      person_name TEXT    NOT NULL,
      team        TEXT    DEFAULT '',
      item_name   TEXT    NOT NULL,
      borrow_date TEXT    DEFAULT '',
      return_date TEXT    DEFAULT '',
      returned    INTEGER NOT NULL DEFAULT 0,
      notes       TEXT    DEFAULT '',
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS otp_tokens (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      email      TEXT    NOT NULL,
      otp        TEXT    NOT NULL,
      expires_at TEXT    NOT NULL,
      used       INTEGER NOT NULL DEFAULT 0
    );
  `);

  /* ══════════════════════════════════════
     ADMINS — ensured on EVERY startup (from .env / dashboard vars),
     so changing a password in .env always takes effect, and admins
     work even on an already-seeded database.
     ══════════════════════════════════════ */
  ensureAdmins(db);

  /* ══════════════════════════════════════
     SAMPLE DATA — only if the DB has no inventory yet (first run)
     ══════════════════════════════════════ */

  const invCount = db.prepare('SELECT COUNT(*) AS n FROM inventory').get();
  if (!invCount || invCount.n === 0) {
    console.log('🌱 Seeding sample data…');

    // ── Sample inventory ────────────────────────────────────────────
    const insertInv = db.prepare(`
      INSERT INTO inventory (name, cat, unit, price, total, used, threshold, project_id, mr_number)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const seedInventory = [
      ['Polymer Clay – White', 'Clay & Armature', 'kg', 18, 10, 3, 2, '', 'MR-001'],
      ['Aluminum Wire 1.5mm', 'Clay & Armature', 'kg', 12, 5, 4.5, 1, 'p1', 'MR-002'],
      ['Acrylic Paint Set', 'Paints & Finishes', 'packs', 35, 4, 1, 1, '', 'MR-003'],
      ['Silicone Mold Rubber', 'Mold Materials', 'liters', 55, 3, 2.8, 0.5, 'p2', 'MR-004'],
      ['Sculpting Loop Tools', 'Sculpting Tools', 'units', 8, 12, 2, 3, '', 'MR-005'],
      ['Epoxy Primer Coat', 'Paints & Finishes', 'liters', 28, 6, 1.5, 1, 'p1', 'MR-006'],
    ];
    for (const row of seedInventory) insertInv.run(...row);

    // ── Sample projects ─────────────────────────────────────────────
    const insertProj = db.prepare(`
      INSERT INTO projects (id, name, desc, budget, progress, status, deadline)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const seedProjects = [
      ['p1', 'Dragon Scale Series', 'Fantasy dragon commission', 450, 65, 'active', '2025-08-30'],
      ['p2', 'Portrait Commission', 'Client: Mr. Ashoka', 280, 30, 'active', '2025-07-15'],
      ['p3', 'Studio Display Set', 'Internal display models', 180, 90, 'active', '2025-06-01'],
    ];
    for (const row of seedProjects) insertProj.run(...row);

    // ── Sample borrow records ──────────────────────────────────────
    const insertBorrow = db.prepare(`
      INSERT INTO borrows (person_name, team, item_name, borrow_date, return_date, returned, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const seedBorrows = [
      ['Arjun Mehta',  'Design Studio', 'Silicone Mold Rubber', '2026-06-02', '',           0, 'For prototype casting'],
      ['Karthik R',    'Workshop',      'Sculpting Loop Tools',  '2026-06-08', '',           0, '2 loop tools'],
      ['Priya Nair',   'Marketing',     'Acrylic Paint Set',     '2026-05-28', '2026-06-05', 1, 'Returned full set'],
    ];
    for (const row of seedBorrows) insertBorrow.run(...row);

    console.log('✅ Database seeded.');
  }

  return db;
}

/* ════════════════════════════════════════════
   ensureAdmins — create/refresh admin accounts from env vars.
   Runs on every startup so admin credentials in .env (or the Vercel
   dashboard) are always the source of truth.
   ════════════════════════════════════════════ */
function ensureAdmins(db) {
  const IS_VERCEL = !!process.env.VERCEL_ENV || process.env.VERCEL === '1';
  const admins = [];

  if (process.env.ADMIN_EMAIL_1 && process.env.ADMIN_PASS_1)
    admins.push({ email: process.env.ADMIN_EMAIL_1, name: process.env.ADMIN_NAME_1 || 'Admin', password: process.env.ADMIN_PASS_1 });

  if (process.env.ADMIN_EMAIL_2 && process.env.ADMIN_PASS_2)
    admins.push({ email: process.env.ADMIN_EMAIL_2, name: process.env.ADMIN_NAME_2 || 'Admin', password: process.env.ADMIN_PASS_2 });

  // No admin env vars at all → seed a default LOCAL admin so the app is usable
  // out of the box in development. Never do this on Vercel.
  if (admins.length === 0) {
    if (!IS_VERCEL) {
      admins.push({ email: 'admin@eplane.ai', name: 'Studio Admin', password: 'admin123' });
      console.warn('⚠️  No ADMIN_* vars found — using DEFAULT LOCAL admin: admin@eplane.ai / admin123');
      console.warn('    Set ADMIN_EMAIL_1 / ADMIN_NAME_1 / ADMIN_PASS_1 in .env to use your real accounts.');
    } else {
      console.warn('⚠️  No ADMIN_EMAIL_1 / ADMIN_PASS_1 set in Vercel env vars. No admin accounts created.');
      return;
    }
  }

  for (const a of admins) {
    const email = a.email.trim().toLowerCase();
    const hash = bcrypt.hashSync(a.password, 10);
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      db.prepare("UPDATE users SET name = ?, password = ?, role = 'admin', status = 'approved' WHERE id = ?")
        .run(a.name, hash, existing.id);
      console.log(`  ✓ Admin ready (updated): ${email}`);
    } else {
      db.prepare("INSERT INTO users (email, name, password, role, status) VALUES (?, ?, ?, 'admin', 'approved')")
        .run(email, a.name, hash);
      console.log(`  ✓ Admin ready (created): ${email}`);
    }
  }
}

module.exports = { initDB };

if (require.main === module) {
  initDB().then(() => console.log('Done.')).catch(console.error);
}
