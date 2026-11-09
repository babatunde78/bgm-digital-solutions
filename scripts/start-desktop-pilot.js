'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const pilotEnvironment = require('../desktop/pilot-environment');
const root = path.resolve(__dirname, '..');
const profile = process.argv[2];
if (process.platform !== 'win32' || !profile || !/^[A-Za-z0-9_-]{1,32}$/.test(profile) || process.argv.slice(3).some(value => value !== '--check-only')) {
  process.stderr.write('Windows source pilot: node scripts/start-desktop-pilot.js PROFILE [--check-only]\nUse a short profile label such as review-a; use a different label for an empty restore profile.\n'); process.exit(1);
}
const runtime = path.join(root, 'desktop/node_modules/electron/dist/electron.exe');
const localData = path.join(root, '.product-work/cbd-pilot', profile);
const database = path.join(localData, 'BGM Digital Solutions/CampusBursaryDocuments/bursary.sqlite');
if (!fs.existsSync(runtime) || database.length > 240 || localData.startsWith('\\\\')) {
  process.stderr.write('Electron runtime or a short private local profile path is unavailable. Run npm ci in desktop and keep the database path at most 240 characters.\n'); process.exit(1);
}
if (process.argv.includes('--check-only')) { process.stdout.write(`Pilot preflight passed: ${profile}\nDatabase: ${database}\n`); process.exit(0); }
fs.mkdirSync(localData, { recursive: true });
const environment = pilotEnvironment(localData);
const child = spawn(runtime, [path.join(root, 'desktop')], { cwd: root, env: environment, windowsHide: false, detached: true, stdio: 'ignore' });
child.once('error', () => { process.stderr.write('The isolated source pilot could not start. Check the runtime and profile permissions.\n'); process.exitCode = 1; });
child.once('spawn', () => { process.stdout.write(`Opened synthetic source pilot '${profile}' (process ${child.pid}). Reuse the label to resume; choose a new label for restoration. No production credentials loaded.\n`); child.unref(); });
