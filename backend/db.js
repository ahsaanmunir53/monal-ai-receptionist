import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || join(__dirname, 'data');
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, 'monal.db'));
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY, createdAt TEXT, name TEXT, phone TEXT, party INTEGER,
  day TEXT, time TEXT, type TEXT, notes TEXT, status TEXT, source TEXT, callId TEXT
);
CREATE TABLE IF NOT EXISTS calls (
  id TEXT PRIMARY KEY, createdAt TEXT, caller TEXT, durationSec INTEGER,
  outcome TEXT, summary TEXT, transcript TEXT
);
CREATE TABLE IF NOT EXISTS knowledge (
  id TEXT PRIMARY KEY, kind TEXT, title TEXT, detail TEXT, price TEXT, sort INTEGER, seed INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS settings ( key TEXT PRIMARY KEY, value TEXT );
CREATE TABLE IF NOT EXISTS tables (
  id TEXT PRIMARY KEY, label TEXT, capacity INTEGER, area TEXT,
  status TEXT, reservationId TEXT, guest TEXT, time TEXT
);
`);
try { db.exec('ALTER TABLE reservations ADD COLUMN callId TEXT'); } catch { /* exists */ }
try { db.exec('ALTER TABLE knowledge ADD COLUMN seed INTEGER DEFAULT 0'); } catch { /* exists */ }
try { db.exec('ALTER TABLE reservations ADD COLUMN reminderAt TEXT'); } catch { /* exists */ }
try { db.exec('ALTER TABLE reservations ADD COLUMN reminderSent INTEGER DEFAULT 0'); } catch { /* exists */ }

/* ---------- settings ---------- */
const DEFAULTS = {
  branchName: 'The Monal',
  hours: '12:00 noon – 11:00 PM, daily',
  address: 'The Monal — hilltop dining above the city',
  holdMinutes: '15',
  reminderHours: '1',
  bigGroup: '8',
  managerWhatsApp: '',
  greeting: 'Assalam o alaikum, and welcome to Monal. I am Sana, your virtual assistant. How may I help you today?',
};
export function getSetting(key) {
  const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return r ? r.value : (DEFAULTS[key] ?? '');
}
export function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value ?? ''));
}
export function allSettings() {
  const out = { ...DEFAULTS };
  for (const r of db.prepare('SELECT key,value FROM settings').all()) out[r.key] = r.value;
  return out;
}

/* ---------- reservations ---------- */
export function addReservation(r) {
  const row = {
    id: randomUUID(), createdAt: new Date().toISOString(),
    name: r.name || 'Guest', phone: r.phone || '', party: Number(r.party) || 2,
    day: r.day || 'Today', time: r.time || '', type: r.type || 'Dinner',
    notes: r.notes || '', status: r.status || 'Confirmed', source: r.source || 'AI call', callId: r.callId || '',
    reminderAt: r.reminderAt || '', reminderSent: 0,
  };
  db.prepare(`INSERT INTO reservations(id,createdAt,name,phone,party,day,time,type,notes,status,source,callId,reminderAt,reminderSent)
    VALUES(@id,@createdAt,@name,@phone,@party,@day,@time,@type,@notes,@status,@source,@callId,@reminderAt,@reminderSent)`).run(row);
  return row;
}
export function listReservations() {
  return db.prepare('SELECT * FROM reservations ORDER BY createdAt DESC LIMIT 500').all();
}
export function updateReservation(id, patch) {
  const cur = db.prepare('SELECT * FROM reservations WHERE id=?').get(id);
  if (!cur) return null;
  const next = { ...cur, ...patch, id, party: Number(patch.party ?? cur.party) };
  db.prepare(`UPDATE reservations SET name=@name,phone=@phone,party=@party,day=@day,time=@time,
    type=@type,notes=@notes,status=@status,reminderAt=@reminderAt,reminderSent=@reminderSent WHERE id=@id`).run({
      id: next.id, name: next.name, phone: next.phone, party: next.party, day: next.day,
      time: next.time, type: next.type, notes: next.notes, status: next.status,
      reminderAt: next.reminderAt || '', reminderSent: Number(next.reminderSent) || 0,
    });
  return next;
}
export function deleteReservation(id) {
  return db.prepare('DELETE FROM reservations WHERE id=?').run(id).changes > 0;
}
export function cancelByNamePhone(name, phone) {
  const rows = db.prepare('SELECT * FROM reservations WHERE status=? ORDER BY createdAt DESC').all('Confirmed');
  const n = String(name || '').toLowerCase();
  const hit = rows.find((r) => (n && r.name.toLowerCase().includes(n)) || (phone && r.phone && r.phone.includes(phone)));
  if (!hit) return null;
  return updateReservation(hit.id, { status: 'Cancelled' });
}

/* ---------- calls ---------- */
export function addCall(c) {
  const row = {
    id: c.id || randomUUID(), createdAt: new Date().toISOString(),
    caller: c.caller || 'Unknown', durationSec: Number(c.durationSec) || 0,
    outcome: c.outcome || '', summary: c.summary || '', transcript: c.transcript || '',
  };
  db.prepare(`INSERT OR REPLACE INTO calls(id,createdAt,caller,durationSec,outcome,summary,transcript)
    VALUES(@id,@createdAt,@caller,@durationSec,@outcome,@summary,@transcript)`).run(row);
  return row;
}
export function listCalls() {
  return db.prepare('SELECT id,createdAt,caller,durationSec,outcome,summary FROM calls ORDER BY createdAt DESC LIMIT 300').all();
}
export function getCall(id) {
  return db.prepare('SELECT * FROM calls WHERE id=?').get(id);
}

/* ---------- knowledge (what the AI knows) ---------- */
export function listKnowledge() {
  return db.prepare('SELECT * FROM knowledge ORDER BY kind, sort, title').all();
}
export function addKnowledge(k) {
  const row = { id: randomUUID(), kind: k.kind || 'Dish', title: k.title || '', detail: k.detail || '', price: k.price || '', sort: Number(k.sort) || 0 };
  db.prepare('INSERT INTO knowledge(id,kind,title,detail,price,sort) VALUES(@id,@kind,@title,@detail,@price,@sort)').run(row);
  return row;
}
export function updateKnowledge(id, k) {
  const cur = db.prepare('SELECT * FROM knowledge WHERE id=?').get(id);
  if (!cur) return null;
  const next = { ...cur, ...k, id, sort: Number(k.sort ?? cur.sort) };
  db.prepare('UPDATE knowledge SET kind=@kind,title=@title,detail=@detail,price=@price,sort=@sort WHERE id=@id').run(next);
  return next;
}
export function deleteKnowledge(id) {
  return db.prepare('DELETE FROM knowledge WHERE id=?').run(id).changes > 0;
}

/* ---------- first-boot seed (so the pitch demo looks alive) ---------- */
const seeded = db.prepare('SELECT COUNT(*) c FROM knowledge').get().c;
if (!seeded) {
  const K = [
    ['Dish', 'Signature BBQ Platter', 'Seekh kabab, malai boti, chicken tikka — serves 2–3', 'Rs 4,800', 1],
    ['Dish', 'Monal Special Karahi', 'Chicken or mutton, cooked on order', 'Rs 3,200 / 5,900', 2],
    ['Dish', 'Continental Grills', 'Steaks & sizzlers with sides', 'Rs 2,900+', 3],
    ['Dish', 'Weekend High-Tea', 'Buffet, Sat–Sun 4–7 PM', 'Rs 2,499 / head', 4],
    ['Package', 'Birthday Décor Package', 'Balloons, cake table, dedicated server', 'Rs 15,000+', 1],
    ['Package', 'Corporate / Family Events', 'Custom menus for 20–200 guests, events team confirms', 'On request', 2],
    ['Policy', 'Halal', 'All food is fully halal', '', 1],
    ['Policy', 'Table hold', 'Tables held 15 minutes past reserved time; no booking fee', '', 2],
    ['Policy', 'Parking', 'Ample free parking with valet at entrance', '', 3],
  ];
  const ins = db.prepare('INSERT INTO knowledge(id,kind,title,detail,price,sort,seed) VALUES(?,?,?,?,?,?,1)');
  for (const [kind, title, detail, price, sort] of K) ins.run(randomUUID(), kind, title, detail, price, sort);

  addReservation({ name: 'Ahmed Raza', phone: '0300-1234567', party: 6, day: 'Saturday', time: '8:00 PM', source: 'AI call', notes: '' });
  addReservation({ name: 'Sara Ali', phone: '0321-9876543', party: 4, day: 'Friday', time: '9:00 PM', source: 'AI call', notes: 'Window table requested' });
  addReservation({ name: 'Bilal Khan', phone: '0333-5551122', party: 12, day: 'Sunday', time: '1:30 PM', source: 'AI call', notes: 'Birthday décor — large group', type: 'Birthday' });
  addCall({ caller: '0300-1234567', durationSec: 96, outcome: 'Reservation', summary: 'Booked table for 6, Saturday 8 PM (Ahmed Raza). Asked about halal — confirmed.', transcript: 'AI: السلام علیکم، دی مونال میں خوش آمدید! How may I help you today?\nCaller: I want to book a table for Saturday.\nAI: With pleasure — may I have your name?\nCaller: Ahmed Raza.\nAI: For how many guests?\nCaller: Six people, 8 pm.\nAI: Wonderful! Ahmed Raza, your table for 6 is booked for Saturday at 8:00 PM...' });
  addCall({ caller: '0345-2223344', durationSec: 41, outcome: 'Question', summary: 'Asked timings and parking. No booking.', transcript: 'Caller: Ap kitne baje tak khule hain?\nAI: ہم روزانہ دوپہر بارہ سے رات گیارہ بجے تک کھلے ہیں۔...' });
}


/* one-time cleanup: strip any Devanagari/Urdu day-time rows written by older builds */
try {
  const bad = db.prepare("SELECT id,day,time FROM reservations").all()
    .filter((r) => /[\u0900-\u097F\u0600-\u06FF]/.test((r.day || '') + (r.time || '')));
  for (const r of bad) db.prepare('UPDATE reservations SET day=?, time=? WHERE id=?').run('Today', '', r.id);
  if (bad.length) console.log(`Cleaned ${bad.length} reservation(s) with non-English day/time.`);
} catch { /* ignore */ }

/* ================= TABLES (floor plan) ================= */
export function listTables() {
  return db.prepare('SELECT * FROM tables ORDER BY area, capacity, label').all();
}
export function setTable(id, patch) {
  const cur = db.prepare('SELECT * FROM tables WHERE id=?').get(id);
  if (!cur) return null;
  const n = { ...cur, ...patch, id };
  db.prepare('UPDATE tables SET label=@label,capacity=@capacity,area=@area,status=@status,reservationId=@reservationId,guest=@guest,time=@time WHERE id=@id')
    .run({ id: n.id, label: n.label, capacity: n.capacity, area: n.area, status: n.status,
           reservationId: n.reservationId || '', guest: n.guest || '', time: n.time || '' });
  return n;
}
export function freeTable(id) {
  return setTable(id, { status: 'Free', reservationId: '', guest: '', time: '' });
}
/** Seat a reservation at the smallest free table that fits (matching area if requested). */
export function autoAssignTable(r) {
  if (!r) return null;
  const wantArea = /outdoor/i.test(r.notes || '') ? 'Outdoor' : /indoor/i.test(r.notes || '') ? 'Indoor' : null;
  const free = listTables().filter((t) => t.status === 'Free' && t.capacity >= (r.party || 1));
  const pick = (wantArea && free.find((t) => t.area === wantArea)) || free[0];
  if (!pick) return null;
  return setTable(pick.id, { status: 'Reserved', reservationId: r.id, guest: r.name, time: `${r.day} ${r.time}`.trim() });
}
export function releaseTableFor(reservationId) {
  const t = listTables().find((x) => x.reservationId === reservationId);
  return t ? freeTable(t.id) : null;
}

/* seed a floor plan once */
if (!db.prepare('SELECT COUNT(*) c FROM tables').get().c) {
  const T = [];
  for (let i = 1; i <= 6; i++) T.push([`T${i}`, i <= 3 ? 2 : 4, 'Indoor']);
  for (let i = 7; i <= 10; i++) T.push([`T${i}`, 6, 'Indoor']);
  for (let i = 11; i <= 14; i++) T.push([`T${i}`, 4, 'Outdoor']);
  for (let i = 15; i <= 17; i++) T.push([`T${i}`, 8, 'Outdoor']);
  T.push(['T18', 12, 'Hall'], ['T19', 12, 'Hall'], ['T20', 20, 'Hall']);
  const ins = db.prepare('INSERT INTO tables(id,label,capacity,area,status,reservationId,guest,time) VALUES(?,?,?,?,?,?,?,?)');
  for (const [label, cap, area] of T) ins.run(randomUUID(), label, cap, area, 'Free', '', '', '');
}


/* ================= REMINDERS ================= */
/** Reservations whose reminder time has arrived and that haven't been reminded yet. */
export function dueReminders(nowIso) {
  return db.prepare(`SELECT * FROM reservations
    WHERE reminderSent = 0 AND status = 'Confirmed'
      AND reminderAt != '' AND reminderAt <= ?`).all(nowIso);
}
export function markReminded(id) {
  db.prepare('UPDATE reservations SET reminderSent = 1 WHERE id = ?').run(id);
}
