'use strict';
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const QRCode = require('qrcode');

const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const STATUSES = ['active', 'lost', 'stolen', 'decommissioned'];

/* ---------- Database ---------- */
const db = new Database(path.join(__dirname, 'assets.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','officer')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name TEXT NOT NULL,
  department TEXT,
  phone TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id TEXT NOT NULL UNIQUE COLLATE NOCASE,
  serial_number TEXT NOT NULL UNIQUE COLLATE NOCASE,
  type TEXT NOT NULL,
  brand TEXT,
  model TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  qr_token TEXT NOT NULL UNIQUE,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  registered_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS verification_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES devices(id),
  officer_id INTEGER NOT NULL REFERENCES users(id),
  method TEXT NOT NULL CHECK (method IN ('qr','manual')),
  result TEXT NOT NULL CHECK (result IN ('verified','mismatch')),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_devices_employee ON devices(employee_id);
CREATE INDEX IF NOT EXISTS idx_logs_device ON verification_logs(device_id);
`);

// First run: create the initial administrator.
if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
  const username = (process.env.ADMIN_USER || 'admin').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
  db.prepare('INSERT INTO users (name, username, password_hash, role) VALUES (?,?,?,?)')
    .run('Administrator', username, bcrypt.hashSync(password, 12), 'admin');
  console.log(`Created first administrator "${username}". Sign in and change the password.`);
}

/* ---------- Helpers ---------- */
const clean = (v) => (typeof v === 'string' ? v.trim() : '');
const isUnique = (e) => e && String(e.code).startsWith('SQLITE_CONSTRAINT');

const DEVICE_COLS = `d.id, d.asset_id, d.serial_number, d.type, d.brand, d.model, d.status, d.created_at,
  e.id AS owner_pk, e.employee_id AS owner_code, e.full_name AS owner_name,
  e.department AS owner_department, e.phone AS owner_phone`;
const DEVICE_FROM = 'FROM devices d JOIN employees e ON e.id = d.employee_id';

function currentUser(req) {
  const s = req.session.user;
  if (!s) return null;
  const u = db.prepare('SELECT id, name, username, role, active FROM users WHERE id = ?').get(s.id);
  return u && u.active ? u : null;
}

// Re-checks the account on every request, so deactivating an officer takes effect immediately.
const guard = (...roles) => (req, res, next) => {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: 'Please sign in.' });
  if (roles.length && !roles.includes(u.role)) {
    return res.status(403).json({ error: 'You do not have permission to do that.' });
  }
  req.user = u;
  next();
};

/* ---------- App ---------- */
const app = express();
if (isProd) app.set('trust proxy', 1);
app.use(express.json({ limit: '50kb' }));
app.use(session({
  name: 'sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: isProd, maxAge: 8 * 3600 * 1000 },
}));
app.use('/vendor/html5-qrcode', express.static(path.join(__dirname, 'node_modules/html5-qrcode')));
app.use(express.static(path.join(__dirname, 'public')));

// State-changing requests must be JSON (blocks plain cross-site form posts).
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && !req.is('application/json')) {
    return res.status(415).json({ error: 'JSON body required.' });
  }
  next();
});

/* ---------- Auth ---------- */
const attempts = new Map();

app.post('/api/login', (req, res) => {
  const a = attempts.get(req.ip) || { n: 0, until: 0 };
  if (a.until > Date.now()) {
    return res.status(429).json({ error: 'Too many failed attempts. Try again in a few minutes.' });
  }
  const username = clean(req.body.username).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!(u && u.active && bcrypt.compareSync(password, u.password_hash))) {
    a.n += 1;
    if (a.n >= 5) { a.until = Date.now() + 5 * 60 * 1000; a.n = 0; }
    attempts.set(req.ip, a);
    return res.status(401).json({ error: 'Wrong username or password.' });
  }
  attempts.delete(req.ip);
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Could not start a session.' });
    req.session.user = { id: u.id };
    res.json({ id: u.id, name: u.name, username: u.username, role: u.role });
  });
});

app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.get('/api/me', guard(), (req, res) => {
  const { id, name, username, role } = req.user;
  res.json({ id, name, username, role });
});

app.post('/api/me/password', guard(), (req, res) => {
  const current = typeof req.body.current === 'string' ? req.body.current : '';
  const next = typeof req.body.next === 'string' ? req.body.next : '';
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(current, row.password_hash)) {
    return res.status(400).json({ error: 'Current password is wrong.' });
  }
  if (next.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(next, 12), req.user.id);
  res.json({ ok: true });
});

/* ---------- Officers (administrator only) ---------- */
app.get('/api/officers', guard('admin'), (req, res) => {
  res.json(db.prepare("SELECT id, name, username, active, created_at FROM users WHERE role = 'officer' ORDER BY name").all());
});

app.post('/api/officers', guard('admin'), (req, res) => {
  const name = clean(req.body.name);
  const username = clean(req.body.username).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!name || !username) return res.status(400).json({ error: 'Name and username are required.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  try {
    const r = db.prepare("INSERT INTO users (name, username, password_hash, role) VALUES (?,?,?,'officer')")
      .run(name, username, bcrypt.hashSync(password, 12));
    res.status(201).json({ id: r.lastInsertRowid });
  } catch (e) {
    if (isUnique(e)) return res.status(409).json({ error: 'That username is already taken.' });
    throw e;
  }
});

app.patch('/api/officers/:id', guard('admin'), (req, res) => {
  const r = db.prepare("UPDATE users SET active = ? WHERE id = ? AND role = 'officer'")
    .run(req.body.active ? 1 : 0, req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Officer not found.' });
  res.json({ ok: true });
});

app.post('/api/officers/:id/password', guard('admin'), (req, res) => {
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  const r = db.prepare("UPDATE users SET password_hash = ? WHERE id = ? AND role = 'officer'")
    .run(bcrypt.hashSync(password, 12), req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Officer not found.' });
  res.json({ ok: true });
});

/* ---------- Employees ---------- */
app.get('/api/employees', guard('admin', 'officer'), (req, res) => {
  const q = `%${clean(req.query.q)}%`;
  res.json(db.prepare(`SELECT id, employee_id, full_name, department, phone, created_at FROM employees
    WHERE employee_id LIKE ? OR full_name LIKE ? OR department LIKE ? ORDER BY full_name LIMIT 500`).all(q, q, q));
});

app.post('/api/employees', guard('officer'), (req, res) => {
  const employee_id = clean(req.body.employee_id);
  const full_name = clean(req.body.full_name);
  if (!employee_id || !full_name) return res.status(400).json({ error: 'Employee ID and full name are required.' });
  try {
    const r = db.prepare('INSERT INTO employees (employee_id, full_name, department, phone, created_by) VALUES (?,?,?,?,?)')
      .run(employee_id, full_name, clean(req.body.department), clean(req.body.phone), req.user.id);
    res.status(201).json({ id: r.lastInsertRowid });
  } catch (e) {
    if (isUnique(e)) return res.status(409).json({ error: 'That employee ID is already registered.' });
    throw e;
  }
});

/* ---------- Devices ---------- */
app.get('/api/devices', guard('admin', 'officer'), (req, res) => {
  const q = `%${clean(req.query.q)}%`;
  res.json(db.prepare(`SELECT ${DEVICE_COLS} ${DEVICE_FROM}
    WHERE d.asset_id LIKE ? OR d.serial_number LIKE ? OR e.full_name LIKE ? OR e.employee_id LIKE ?
    ORDER BY d.id DESC LIMIT 500`).all(q, q, q, q));
});

app.post('/api/devices', guard('officer'), (req, res) => {
  const serial = clean(req.body.serial_number);
  const type = clean(req.body.type);
  const owner = db.prepare('SELECT id FROM employees WHERE id = ?').get(Number(req.body.employee_id));
  if (!serial || !type) return res.status(400).json({ error: 'Device type and serial number are required.' });
  if (!owner) return res.status(400).json({ error: 'Choose a registered employee as the owner.' });
  const next = db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM devices').get().n;
  const asset_id = 'AST-' + String(next).padStart(6, '0');
  const qr_token = crypto.randomBytes(12).toString('hex');
  try {
    const r = db.prepare(`INSERT INTO devices (asset_id, serial_number, type, brand, model, qr_token, employee_id, registered_by)
      VALUES (?,?,?,?,?,?,?,?)`)
      .run(asset_id, serial, type, clean(req.body.brand), clean(req.body.model), qr_token, owner.id, req.user.id);
    res.status(201).json({ id: r.lastInsertRowid, asset_id });
  } catch (e) {
    if (isUnique(e)) return res.status(409).json({ error: 'A device with that serial number is already registered.' });
    throw e;
  }
});

app.patch('/api/devices/:id', guard('officer'), (req, res) => {
  const status = clean(req.body.status);
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Unknown status.' });
  const r = db.prepare('UPDATE devices SET status = ? WHERE id = ?').run(status, req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Device not found.' });
  res.json({ ok: true });
});

// The QR code holds only a random token. Personal data stays in the database.
app.get('/api/devices/:id/qr', guard('admin', 'officer'), async (req, res) => {
  const d = db.prepare(`SELECT d.asset_id, d.qr_token, e.full_name AS owner_name ${DEVICE_FROM} WHERE d.id = ?`).get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Device not found.' });
  const dataUrl = await QRCode.toDataURL(d.qr_token, { margin: 1, width: 320, errorCorrectionLevel: 'M' });
  res.json({ dataUrl, asset_id: d.asset_id, owner_name: d.owner_name });
});

/* ---------- Verification (security officers) ---------- */
const findDevice = (code) => db.prepare(`SELECT ${DEVICE_COLS} ${DEVICE_FROM}
  WHERE d.qr_token = ? OR d.asset_id = ? COLLATE NOCASE`).get(code, code);

app.get('/api/verify/:code', guard('officer'), (req, res) => {
  const code = clean(req.params.code);
  const device = findDevice(code);
  if (device) return res.json({ kind: 'device', device });

  const employee = db.prepare(`SELECT id, employee_id, full_name, department, phone FROM employees
    WHERE employee_id = ? COLLATE NOCASE`).get(code);
  if (employee) {
    const devices = db.prepare(`SELECT ${DEVICE_COLS} ${DEVICE_FROM} WHERE d.employee_id = ? ORDER BY d.id`).all(employee.id);
    return res.json({ kind: 'employee', employee, devices });
  }
  res.status(404).json({ error: 'No device or employee matches that code.' });
});

app.post('/api/verify/:code', guard('officer'), (req, res) => {
  const device = findDevice(clean(req.params.code));
  if (!device) return res.status(404).json({ error: 'Device not found.' });
  const result = clean(req.body.result);
  const method = clean(req.body.method);
  if (!['verified', 'mismatch'].includes(result)) return res.status(400).json({ error: 'Choose verified or mismatch.' });
  if (!['qr', 'manual'].includes(method)) return res.status(400).json({ error: 'Unknown verification method.' });
  db.prepare('INSERT INTO verification_logs (device_id, officer_id, method, result, note) VALUES (?,?,?,?,?)')
    .run(device.id, req.user.id, method, result, clean(req.body.note).slice(0, 500));
  res.status(201).json({ ok: true });
});

app.get('/api/logs', guard('admin', 'officer'), (req, res) => {
  res.json(db.prepare(`SELECT l.id, l.created_at, l.method, l.result, l.note,
      d.asset_id, e.full_name AS owner_name, u.name AS officer_name
    FROM verification_logs l
    JOIN devices d ON d.id = l.device_id
    JOIN employees e ON e.id = d.employee_id
    JOIN users u ON u.id = l.officer_id
    ORDER BY l.id DESC LIMIT 200`).all());
});

/* ---------- Errors ---------- */
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

app.listen(PORT, () => console.log(`Asset control running at http://localhost:${PORT}`));
