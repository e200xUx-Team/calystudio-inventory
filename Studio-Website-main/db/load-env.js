'use strict';

/**
 * load-env.js — minimal, dependency-free .env loader.
 *
 * Reads a .env file from the project root and copies any keys that aren't
 * already set into process.env. Vercel injects env vars directly (and ships
 * no .env file), so this safely no-ops in production.
 *
 * Require this BEFORE anything that reads process.env.
 */

const fs = require('fs');
const path = require('path');

(function loadEnv() {
  try {
    const envPath = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) return;

    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    let loaded = 0;
    for (let line of lines) {
      line = line.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      // Strip surrounding quotes if present
      if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key && !(key in process.env)) {
        process.env[key] = val;
        loaded++;
      }
    }
    if (loaded) console.log(`[env] Loaded ${loaded} variable(s) from .env`);
  } catch (e) {
    console.warn('[env] Could not load .env:', e.message);
  }
})();
