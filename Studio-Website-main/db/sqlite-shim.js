'use strict';

/**
 * sqlite-shim.js — Vercel-compatible SQLite via sql.js (WASM)
 *
 * Key fixes for Vercel:
 * 1. DB stored in /tmp (only writable path on Vercel serverless)
 * 2. WASM file located explicitly from node_modules path
 * 3. Single shared instance reused across requests (avoids re-init on every call)
 */

const fs = require('fs');
const path = require('path');

// Use /tmp on Vercel (writable), local db/ folder for dev
const IS_VERCEL = !!process.env.VERCEL_ENV || process.env.VERCEL === '1';
const DB_PATH = IS_VERCEL
  ? '/tmp/studio.db'
  : path.join(__dirname, 'studio.db');

// Singleton — only initialize once per process
let _sharedDB = null;

class ShimDatabase {
  constructor(db) {
    this._db = db;
  }

  pragma(sql) {
    try { this._db.run(`PRAGMA ${sql};`); } catch (_) { }
  }

  exec(sql) {
    this._db.run(sql);
    this._save();
  }

  prepare(sql) {
    return new ShimStatement(this, sql);
  }

  _save() {
    try {
      const data = this._db.export();
      fs.writeFileSync(DB_PATH, Buffer.from(data));
    } catch (e) {
      console.error('[DB] Save error:', e.message);
    }
  }
}

class ShimStatement {
  constructor(wrapper, sql) {
    this.wrapper = wrapper;
    this.sql = sql;
  }

  _exec(args) {
    const params = (args.length === 1 && Array.isArray(args[0])) ? args[0] : args;
    const stmt = this.wrapper._db.prepare(this.sql);
    if (params.length) stmt.bind(params);
    return stmt;
  }

  run(...args) {
    const stmt = this._exec(args);
    stmt.step();
    stmt.free();
    const [[lastInsertRowid]] = this.wrapper._db.exec('SELECT last_insert_rowid()')[0]?.values || [[0]];
    const [[changes]] = this.wrapper._db.exec('SELECT changes()')[0]?.values || [[0]];
    this.wrapper._save();
    return { lastInsertRowid, changes };
  }

  get(...args) {
    const stmt = this._exec(args);
    const row = stmt.step() ? stmt.getAsObject() : undefined;
    stmt.free();
    return row;
  }

  all(...args) {
    const stmt = this._exec(args);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }
}

async function createDatabase() {
  if (_sharedDB) return _sharedDB;   // reuse singleton

  // Locate the sql.js WASM file explicitly — required on Vercel
  const wasmPath = path.join(
    path.dirname(require.resolve('sql.js')),
    'sql-wasm.wasm'
  );

  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({
    locateFile: () => wasmPath,
  });

  let fileBuffer;
  if (fs.existsSync(DB_PATH)) {
    fileBuffer = fs.readFileSync(DB_PATH);
  }

  const db = new SQL.Database(fileBuffer);
  _sharedDB = new ShimDatabase(db);
  return _sharedDB;
}

module.exports = { createDatabase };
