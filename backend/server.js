import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  dueReminders, markReminded,
  listTables, setTable, freeTable, autoAssignTable, releaseTableFor,
  addReservation, listReservations, updateReservation, deleteReservation, cancelByNamePhone,
  addCall, listCalls, getCall,
  listKnowledge, addKnowledge, updateKnowledge, deleteKnowledge,
  allSettings, setSetting, getSetting,
} from './db.js';

dotenv.config();
const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'Monal@2026';

/* ================= auth ================= */
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    return res.json({ token: jwt.sign({ u: username }, JWT_SECRET, { expiresIn: '12h' }) });
  }
  res.status(401).json({ error: 'Invalid username or password.' });
});
function auth(req, res, next) {
  try {
    const t = (req.headers.authorization || '').replace('Bearer ', '');
    jwt.verify(t, JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: 'Unauthorized' }); }
}

/* ================= integrations (all optional, key-gated, FREE tiers) ================= */
const integrations = () => ({
  vapi: !!(process.env.VAPI_API_KEY && process.env.VAPI_ASSISTANT_ID),
  vapiPhone: !!process.env.VAPI_PHONE_NUMBER_ID,
  sheets: !!(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY && process.env.GOOGLE_SHEET_ID),
  whatsapp: !!(process.env.WHATSAPP_TOKEN && !/PASTE_FULL/.test(process.env.WHATSAPP_TOKEN) && process.env.WHATSAPP_PHONE_NUMBER_ID),
});

/* ---- Google Sheets append (service-account JWT, no heavy SDK) ---- */
async function sheetsToken() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let key = process.env.GOOGLE_PRIVATE_KEY || '';
  key = key.replace(/\\n/g, '\n');
  const assertion = jwt.sign(
    { iss: email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token' },
    key, { algorithm: 'RS256', expiresIn: '1h' }
  );
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('Sheets auth failed: ' + JSON.stringify(d));
  return d.access_token;
}
async function appendToSheet(resv) {
  if (!integrations().sheets) return false;
  try {
    const token = await sheetsToken();
    const values = [[new Date().toLocaleString(), resv.name, resv.phone, resv.party, resv.day, resv.time, resv.type, resv.notes, resv.status]];
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${process.env.GOOGLE_SHEET_ID}/values/A1:append?valueInputOption=USER_ENTERED`;
    const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ values }) });
    if (!r.ok) console.warn('Sheets append failed:', await r.text());
    return r.ok;
  } catch (e) { console.warn('Sheets error:', e.message); return false; }
}

/* ---- WhatsApp Cloud API (Meta free tier) ---- */
async function sendWhatsApp(toRaw, text) {
  if (!integrations().whatsapp || !toRaw) return false;
  const to = String(toRaw).replace(/[^0-9]/g, '').replace(/^0/, '92');
  try {
    const r = await fetch(`https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
    });
    if (!r.ok) console.warn('WhatsApp send failed:', await r.text());
    return r.ok;
  } catch (e) { console.warn('WhatsApp error:', e.message); return false; }
}
function confirmationText(r) {
  const hold = getSetting('holdMinutes');
  const isOrder = ['Delivery', 'Takeaway', 'Pre-order'].includes(r.type);
  if (isOrder) {
    return `✅ The Monal — ${r.type} Order Confirmed\n\nName: ${r.name}${r.notes ? `\n${r.notes.split(' | ').join('\n')}` : ''}\nWhen: ${r.day} ${r.time}\n\nThank you for ordering from The Monal! 🦚`;
  }
  return `✅ The Monal — Reservation Confirmed\n\nGuest: ${r.name}\nParty: ${r.party} guests\nDay: ${r.day} at ${r.time}${r.notes ? `\nNotes: ${r.notes}` : ''}\n\nYour table will be held ${hold} minutes past the reserved time. We look forward to hosting you! 🦚`;
}

/* ================= VAPI WEBHOOK =================
   Point the Vapi assistant's Server URL here: POST /api/vapi/webhook
   Handles: tool-calls (create_reservation / cancel_reservation / notify_manager)
   and end-of-call-report (logs the call + transcript). */
app.post('/api/vapi/webhook', async (req, res) => {
  const secret = process.env.VAPI_WEBHOOK_SECRET;
  if (secret && req.headers['x-vapi-secret'] !== secret) return res.status(401).json({ error: 'bad secret' });

  const msg = req.body?.message || {};
  try {
    if (msg.type === 'tool-calls') {
      const callerNumber = msg.call?.customer?.number || '';
      const results = [];
      for (const tc of msg.toolCallList || []) {
        const name = tc?.function?.name || tc?.name;
        let args = tc?.function?.arguments ?? tc?.arguments ?? {};
        if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
        let result = 'ok';

        if (name === 'create_reservation') {
          if (!args.phone && callerNumber) args.phone = callerNumber;
          const r = addReservation({ ...args, source: 'AI call' });
          appendToSheet(r);
          sendWhatsApp(r.phone, confirmationText(r));
          result = `Reservation confirmed for ${r.name}, party of ${r.party}, ${r.day} at ${r.time}. Confirmation sent on WhatsApp.`;
        } else if (name === 'cancel_reservation') {
          const c = cancelByNamePhone(args.name, args.phone);
          result = c ? `Reservation for ${c.name} on ${c.day} at ${c.time} has been cancelled.` : 'No matching confirmed reservation found.';
        } else if (name === 'notify_manager') {
          if (!args.phone && callerNumber) args.phone = callerNumber;
          const mgr = getSetting('managerWhatsApp') || process.env.MANAGER_WHATSAPP;
          sendWhatsApp(mgr, `📞 Monal AI — manager needed\nCaller: ${args.phone || 'unknown'}\n${args.summary || ''}`);
          result = 'The manager has been notified and will call back shortly.';
        } else {
          result = 'Unknown tool.';
        }
        results.push({ toolCallId: tc.id, result });
      }
      return res.json({ results });
    }

    if (msg.type === 'end-of-call-report') {
      const call = msg.call || {};
      const transcript = (msg.artifact?.messages || msg.transcript || [])
        .map ? (msg.artifact?.messages || []).map((m) => `${m.role === 'bot' || m.role === 'assistant' ? 'AI' : 'Caller'}: ${m.message || m.content || ''}`).join('\n')
        : String(msg.transcript || '');
      addCall({
        id: call.id,
        caller: call.customer?.number || 'Unknown',
        durationSec: Math.round((msg.durationSeconds ?? msg.durationMs / 1000) || 0),
        outcome: msg.analysis?.successEvaluation || (msg.endedReason || ''),
        summary: msg.analysis?.summary || msg.summary || '',
        transcript,
      });
      return res.json({ ok: true });
    }

    res.json({ ok: true, ignored: msg.type || 'unknown' });
  } catch (e) {
    console.error('Webhook error:', e);
    res.status(200).json({ results: [{ result: 'error handled' }] });
  }
});

/* ================= admin: reservations ================= */
app.get('/api/admin/reservations', auth, (_q, res) => res.json(listReservations()));
app.post('/api/admin/reservations', auth, async (req, res) => {
  const r = addReservation({ ...req.body, source: 'Manual' });
  autoAssignTable(r);
  const at = computeReminderAt(r);
  if (at) updateReservation(r.id, { reminderAt: at });
  appendToSheet(r);
  if (req.body.sendWhatsApp) sendWhatsApp(r.phone, confirmationText(r));
  res.status(201).json(r);
});
app.patch('/api/admin/reservations/:id', auth, (req, res) => {
  const r = updateReservation(req.params.id, req.body || {});
  if (r && ['Cancelled', 'Completed', 'No-show'].includes(r.status)) releaseTableFor(r.id);
  r ? res.json(r) : res.status(404).json({ error: 'Not found' });
});
app.delete('/api/admin/reservations/:id', auth, (req, res) => {
  releaseTableFor(req.params.id);
  return deleteReservation(req.params.id) ? res.json({ ok: true }) : res.status(404).json({ error: 'Not found' });
});

/* ================= admin: tables (floor plan) ================= */
app.get('/api/admin/tables', auth, (_q, res) => res.json(listTables()));
app.patch('/api/admin/tables/:id', auth, (req, res) => {
  const t = setTable(req.params.id, req.body || {});
  t ? res.json(t) : res.status(404).json({ error: 'Not found' });
});
app.post('/api/admin/tables/:id/free', auth, (req, res) => {
  const t = freeTable(req.params.id);
  t ? res.json(t) : res.status(404).json({ error: 'Not found' });
});
/** seat an existing reservation at a specific table */
app.post('/api/admin/tables/:id/seat', auth, (req, res) => {
  const r = listReservations().find((x) => x.id === req.body?.reservationId);
  if (!r) return res.status(404).json({ error: 'Reservation not found' });
  releaseTableFor(r.id);
  const t = setTable(req.params.id, { status: 'Reserved', reservationId: r.id, guest: r.name, time: `${r.day} ${r.time}`.trim() });
  t ? res.json(t) : res.status(404).json({ error: 'Table not found' });
});

/* ================= admin: calls ================= */
app.get('/api/admin/calls', auth, (_q, res) => res.json(listCalls()));
app.get('/api/admin/calls/:id', auth, (req, res) => {
  const c = getCall(req.params.id);
  c ? res.json(c) : res.status(404).json({ error: 'Not found' });
});

/* ================= admin: knowledge ================= */
app.get('/api/admin/knowledge', auth, (_q, res) => res.json(listKnowledge()));
app.post('/api/admin/knowledge', auth, (req, res) => res.status(201).json(addKnowledge(req.body || {})));
app.patch('/api/admin/knowledge/:id', auth, (req, res) => {
  const k = updateKnowledge(req.params.id, req.body || {});
  k ? res.json(k) : res.status(404).json({ error: 'Not found' });
});
app.delete('/api/admin/knowledge/:id', auth, (req, res) =>
  deleteKnowledge(req.params.id) ? res.json({ ok: true }) : res.status(404).json({ error: 'Not found' }));

function knowledgePackText() {
  const s = allSettings();
  const items = listKnowledge();
  const sec = (kind, label) => {
    const rows = items.filter((i) => i.kind === kind);
    if (!rows.length) return '';
    return `\n${label}:\n` + rows.map((i) => `- ${i.title}${i.price ? ` — ${i.price}` : ''}${i.detail ? ` (${i.detail})` : ''}`).join('\n');
  };
  return `THE MONAL — KNOWLEDGE PACK
Branch: ${s.branchName}
Hours: ${s.hours}
Location: ${s.address}
Table hold: ${s.holdMinutes} minutes past reserved time. No booking fee. Groups of ${s.bigGroup}+ also confirmed by phone.
${sec('Dish', 'MENU HIGHLIGHTS')}
${sec('Package', 'PACKAGES & EVENTS')}
${sec('Policy', 'POLICIES')}`;
}
/* Knowledge pack export — paste into Vapi's knowledge / prompt */
app.get('/api/admin/knowledge-pack', auth, (_q, res) => res.type('text/plain').send(knowledgePackText()));

/* ================= admin: settings & status ================= */
app.get('/api/admin/settings', auth, (_q, res) => res.json({ settings: allSettings(), integrations: integrations() }));
app.patch('/api/admin/settings', auth, (req, res) => {
  for (const [k, v] of Object.entries(req.body || {})) setSetting(k, v);
  res.json({ settings: allSettings() });
});
app.get('/api/admin/stats', auth, (_q, res) => {
  const rs = listReservations();
  const today = new Date().toDateString();
  const todayRs = rs.filter((r) => new Date(r.createdAt).toDateString() === today);
  const calls = listCalls();
  const todayCalls = calls.filter((c) => new Date(c.createdAt).toDateString() === today);
  const tbl = listTables();
  res.json({
    tablesFree: tbl.filter((t) => t.status === 'Free').length,
    tablesTotal: tbl.length,
    reservationsToday: todayRs.length,
    guestsToday: todayRs.reduce((a, r) => a + (r.status !== 'Cancelled' ? r.party : 0), 0),
    callsToday: todayCalls.length,
    totalReservations: rs.length,
    integrations: integrations(),
  });
});

/* ================= ONE-CLICK VAPI ASSISTANT SETUP =================
   Fixes "AI does not talk / no Urdu / awkward stops / nothing in DB":
   configures the assistant fully via Vapi's API — prompt, greeting,
   Urdu-capable voice, multilingual transcriber, webhook + 3 tools. */
const MONAL_PROMPT = readFileSync(join(__dirname, 'prompt-monal.md'), 'utf8');

function buildVapiPayload(voiceId, publicUrl) {
  const st = allSettings();
  const localMode = !publicUrl;
  let prompt = MONAL_PROMPT;
  prompt += `\n\n============================================================
CRITICAL OVERRIDES (these outrank anything above)
============================================================
${localMode
  ? `TOOLS: You have NO functions to call. Every confirmation, WhatsApp message, and record is handled AUTOMATICALLY after the call. Where the instructions above mention send_whatsapp_confirmation or any function, simply tell the caller their WhatsApp confirmation is on its way — never mention tools, systems, or functions.`
  : `TOOLS: The ONLY functions that exist are create_reservation, cancel_reservation and notify_manager. Ignore any other function names mentioned above (send_whatsapp_confirmation etc.) — WhatsApp is sent automatically when you call create_reservation.`}`;
  prompt += `

SPOKEN OUTPUT RULES (you are being HEARD, not read):
- NEVER read punctuation aloud. Never say the words "slash", "bracket", "dash", "asterisk" or "hyphen".
- The notes above use "/" only to separate options for YOU — never speak it. Choose ONE option and say it naturally.
- Never read out placeholders, section headings, or anything in square brackets.
- Say phone numbers digit by digit, and prices as words ("one thousand seventy-five rupees").

WHEN YOU DID NOT HEAR SOMETHING CLEARLY (speak like a real human, never like a machine):
- Do NOT repeat your question word-for-word. Instead say it the way a person would:
  English: "Sorry, the line isn't very clear — could you please say that again?"
  Urdu:    "معذرت، آواز صاف نہیں آ رہی — کیا آپ یہ بات دوبارہ کہہ سکتے ہیں؟"
- If it is a number, help them: "How many guests? For example — four, six, or eight?" / "کتنے افراد؟ مثلاً چار، چھ، یا آٹھ؟"
- If you still cannot hear it after that second attempt, do NOT ask again. Say warmly:
  English: "The line keeps breaking up — let me have our team call you right back to confirm."
  Urdu:    "لائن ٹھیک نہیں آ رہی — میں اپنی ٹیم سے کہتی ہوں کہ آپ کو ابھی کال کریں۔"
- NEVER ask the same question a third time. That is a serious failure.
- Same rule for names, dates, times and addresses.

ENDING THE CALL (important):
- Once the booking/order is confirmed, or the caller's question is fully answered, ask ONCE: "Aur koi khidmat?" / "Anything else I can help with?"
- If they say no, or say thanks/bye: give the warm sign-off — "Shukriya! Aap ki booking confirm ho gayi hai. Allah Hafiz." — and then END THE CALL immediately using your end-call ability. Do not keep talking. Do not restart the conversation.
- NEVER greet twice. If you have already said Assalam-o-Alaikum once, never say it again in the same call.

BRANCH — DO NOT ASK AT THE START:
- The default branch is LAHORE. Assume Lahore unless the caller names another branch themselves.
- NEVER open the call with "which branch?" and NEVER offer the branch list unless the caller asks about another city.
- Only if the caller mentions Rawalpindi, Murree or Peshawar do you switch to that branch's details.

RESERVATION INTAKE — COLLECT THESE, IN THIS ORDER:
  1. NAME       — "Aap ka naam?" / "May I have your name?"   <- always first
  2. GUESTS     — "Kitne afraad?" / "How many guests?"
  3. DAY        — "Kis din?" / "Which day?"
  4. TIME       — "Kis waqt?" / "What time?"
  5. OCCASION   — "Ye dinner hai, lunch, high-tea buffet, birthday, ya koi event?"
  6. WHATSAPP NUMBER (MANDATORY — never skip, never assume):
       Ask: "Aap ka WhatsApp number bata dijiye — confirmation aur reminder us par bhej doon gi." / "May I have your WhatsApp number? I'll send the confirmation and a reminder there."
       They MUST say the number. Listen to the digits, then READ THEM BACK for confirmation:
         "Zero three zero zero, one two three four five six seven — theek hai?"
       If they say "isi number pe" (this same number), reply: "Ji bilkul, isi number par bhej doon gi." and mark it as the calling number.
       Never finish a booking without a WhatsApp number.
Optional: indoor/outdoor seating, special requests. Never ask which branch.

CLOSING A BOOKING — THIS EXACT SEQUENCE, NEVER SKIP A STEP:
STEP 1. Summarise in ONE sentence and ask for a yes:
   "Rimsha, 6 guests, Today 6:00 PM, dinner — confirm karoon?"
STEP 2. They say yes / ji / haan / theek hai / ok. Now you MUST say the confirmation out loud:
   "Shukriya Rimsha! Aap ki booking confirm ho gayi hai. WhatsApp par confirmation aa jayegi, aur ek ghante pehle reminder bhi. Aur koi khidmat?"
STEP 3. They say no / nothing else / thanks. Now you MUST say the sign-off, word for word:
   "Shukriya! Allah Hafiz."
STEP 4. Immediately END THE CALL using your end-call ability.

ABSOLUTE RULES:
- NEVER hang up right after "confirm karoon?" — you must hear their yes first.
- NEVER hang up without saying "Allah Hafiz" (or "Thank you for calling Monal, have a wonderful day" in English).
- The words "Allah Hafiz" are your signal to end the call — say them, then end.
- If the caller says bye/shukriya/khuda hafiz first, reply "Shukriya! Allah Hafiz." and end the call.

SLOT MEMORY (booking OR order — follow strictly):
Track what the caller has ALREADY told you. NEVER re-ask for a detail already given — not even to double-check (confirm it in your summary instead). If several details arrive in one sentence, accept them all. Ask only for what is missing, one short question at a time. Never invent or assume a missing detail.

HEARING DISCIPLINE (phone audio is unreliable):
- ONE reply per caller turn. Say your one thing, then STOP and listen. Never send two replies in a row, never repeat a question you just asked — if silence, wait.
- NUMBERS: repeat the party size back in words ("Eight guests, correct?"). If a number could be confused (7 vs 70, 15 vs 50, 13 vs 30), ask "seven, or seventy?" — NEVER assume the larger.
- NAMES & ADDRESSES: repeat back once and accept corrections.
- Didn't catch something? Say "Sorry, I didn't catch that" — never guess, never repeat the full question.
- The moment the caller confirms the final summary with yes / جی / haan / theek hai / ok — it is DONE. Thank them, sign off warmly (Allah Hafiz / thank you), do not ask anything more.`;
  // The menu in the prompt file is AUTHORITATIVE. Dashboard items are only appended
  // as ADDITIONS (specials/updates) — never as an override of the real menu.
  const customItems = listKnowledge().filter((k) => !k.seed);
  if (customItems.length) {
    const lines = customItems.map((i) => `- ${i.title}${i.price ? ` — ${i.price}` : ''}${i.detail ? ` (${i.detail})` : ''}`).join('\n');
    prompt += `\n\n============================================================
TODAY'S ADDITIONS FROM THE MANAGER DASHBOARD (in addition to the menu above)
============================================================
${lines}`;
  }
  prompt += `\n\nTable hold: ${st.holdMinutes} minutes past reserved time. Groups of ${st.bigGroup}+ are also confirmed by phone by our team.`;
  const tools = [
    { type: 'function', function: { name: 'create_reservation',
        description: 'Book a table once name, party size, day and time are known.',
        parameters: { type: 'object', properties: {
          name: { type: 'string' }, phone: { type: 'string' }, party: { type: 'number' },
          day: { type: 'string' }, time: { type: 'string' }, notes: { type: 'string' } },
          required: ['name', 'party', 'day', 'time'] } } },
    { type: 'function', function: { name: 'cancel_reservation',
        description: 'Cancel an existing booking by guest name and/or phone.',
        parameters: { type: 'object', properties: { name: { type: 'string' }, phone: { type: 'string' } } } } },
    { type: 'function', function: { name: 'notify_manager',
        description: 'Escalate complaints or unusual requests to the duty manager.',
        parameters: { type: 'object', properties: { phone: { type: 'string' }, summary: { type: 'string' } }, required: ['summary'] } } },
  ];
  const payload = {
    name: 'Monal AI Receptionist',
    firstMessage: st.greeting || 'Assalam o alaikum! Welcome to The Monal — how may I help you today?',
    firstMessageMode: 'assistant-speaks-first',
    model: { provider: 'openai', model: 'gpt-4o', temperature: 0.3, maxTokens: 250,
      messages: [{ role: 'system', content: prompt }] },
    transcriber: { provider: 'deepgram', model: 'nova-3', language: 'multi' },
    voice: { provider: 'azure', voiceId: voiceId || 'ur-PK-UzmaNeural',
      chunkPlan: { enabled: true, minCharacters: 70 } },
    // ===== TURN-TAKING (this is what stops double/repeated replies) =====
    // Wait for the caller to actually FINISH before answering. onNumberSeconds gives
    // extra grace while they're saying digits ("seven..." vs "seventy") — the exact
    // failure we hit. Without this, phone audio gets chopped and the AI answers each fragment.
    startSpeakingPlan: {
      waitSeconds: 0.5,
      transcriptionEndpointingPlan: { onPunctuationSeconds: 0.25, onNoPunctuationSeconds: 1.2, onNumberSeconds: 0.9 },
    },
    stopSpeakingPlan: { numWords: 3, voiceSeconds: 0.25, backoffSeconds: 1.2 },
    backgroundDenoisingEnabled: true,
    silenceTimeoutSeconds: 30,
    maxDurationSeconds: 600,
    endCallFunctionEnabled: true,
    endCallPhrases: ['Allah Hafiz', 'Khuda Hafiz', 'Allah hafiz'],
    endCallMessage: 'Shukriya! Allah Hafiz.',
    // After every call, Vapi's analyzer extracts the booking as clean JSON — this is
    // what lets a LOCALHOST dashboard receive real bookings (we poll and read it).
    analysisPlan: {
      summaryPlan: { enabled: true },
      structuredDataPlan: {
        enabled: true,
        schema: { type: 'object', properties: {
          booked: { type: 'boolean', description: 'true if the assistant STATED the booking as confirmed to the caller (e.g. "aap ki booking confirm ho gayi hai"), OR the caller agreed to the summary. Reservations need party+day+time. Orders need items (and address for delivery). Only false if the call ended before the details were settled.' },
          bookingType: { type: 'string', description: 'one of: reservation, birthday, corporate_dinner, pre_order, takeaway, delivery' },
          branch: { type: 'string', description: 'Lahore, Rawalpindi, Murree or Peshawar — as the caller chose' },
          name: { type: 'string', description: 'the guest name, in English letters. Empty if the caller never gave a name.' },
          party: { type: 'number', description: 'guests count; 0 if never stated' },
          day: { type: 'string', description: 'IN ENGLISH ONLY — e.g. "Today", "Tomorrow", "Friday", "15 July". Translate Urdu/Hindi to English. Empty if never stated.' },
          time: { type: 'string', description: 'IN ENGLISH ONLY — e.g. "9:00 PM". Translate "نو بجے"/"नौ बजे" to "9:00 PM". Empty if never stated.' },
          occasion: { type: 'string', description: 'Dinner, Lunch, High-Tea, Birthday, Party or Event — as the caller said' },
          seating: { type: 'string', description: 'Indoor or Outdoor, if stated' },
          whatsapp: { type: 'string', description: 'WhatsApp number given for confirmation, if different from the calling number' },
          items: { type: 'string', description: 'ordered items with quantities, e.g. "2x Monal Special Karahi, 4x Naan" — only for orders' },
          address: { type: 'string', description: 'full delivery address — only for delivery' },
          total: { type: 'number', description: 'total PKR quoted, if any' },
          notes: { type: 'string', description: 'décor, special requests — only what the caller said' },
        } },
      },
    },
  };
  if (!localMode) {
    payload.model.tools = tools;
    payload.server = { url: `${publicUrl.replace(/\/$/, '')}/api/vapi/webhook`, secret: process.env.VAPI_WEBHOOK_SECRET || undefined };
    payload.serverMessages = ['tool-calls', 'end-of-call-report'];
  }
  return payload;
}

app.post('/api/admin/vapi/sync', auth, async (req, res) => {
  if (!process.env.VAPI_API_KEY || !process.env.VAPI_ASSISTANT_ID)
    return res.status(400).json({ error: 'VAPI_API_KEY and VAPI_ASSISTANT_ID must be set in .env first.' });
  const publicUrl = (process.env.PUBLIC_URL || '').trim() || `${req.protocol}://${req.get('host')}`;
  const isLocal = /localhost|127\.0\.0\.1/.test(publicUrl);
  const payload = buildVapiPayload(req.body?.voiceId, isLocal ? '' : publicUrl);
  if (req.body?.dry) return res.json({ dry: true, mode: isLocal ? 'local-polling' : 'webhook', payload });
  const H = { Authorization: `Bearer ${process.env.VAPI_API_KEY}`, 'Content-Type': 'application/json' };
  // best -> good -> safe ladder for Urdu+English understanding
  // ENGINE LADDER — each entry is a full attempt; first one Vapi accepts wins.
  // realtime = speech-to-speech (no transcriber): best Urdu/English mixing, ~300ms, no stutter.
  const profile = req.body?.profile || 'pakistani';

  // HARD RULE: the voice's language MUST match the script of the text it is given.
  // Feeding Roman-Urdu/English to an Urdu-script voice is what produced the gibberish.
  const ROMAN_URDU_RULE = `SCRIPT RULE — ABSOLUTE, NO EXCEPTIONS. READ THIS TWICE:
- The transcription system often gives you the caller's words in Devanagari/Hindi script (e.g. "मुझे reservation करवानी है"). That is ONLY how the transcriber writes it. DO NOT COPY THAT SCRIPT. Understand the meaning, then reply in English letters.
- Every single reply you produce must use ENGLISH LETTERS (A-Z) ONLY.
- FORBIDDEN: Urdu script (اردو), Arabic script, Hindi/Devanagari script (हिंदी). Your voice cannot pronounce these — it produces screeching noise and the caller hears nothing. This is the single worst mistake you can make.
- Caller says "मुझे reservation करवानी है" → you reply "Ji bilkul! Aap ka naam?" (NOT "जी बिल्कुल").
- Caller says "छह" → you reply "Ji, 6 guests. Kis din aur kis waqt?" (NOT "जी 6 guest").
- Urdu is spoken as ROMAN URDU — Urdu written in English letters, exactly how Pakistanis text:
  "Ji bilkul! Kitne afraad hain?" · "Aap ka naam?" · "Kis din aur kis waqt?" · "Shukriya, aap ki booking confirm ho gayi hai."
- English caller → English. Urdu caller → Roman Urdu. Mixed → mix naturally. Never announce the language.
- DAYS, TIMES, NUMBERS: always write in ENGLISH even inside a Roman-Urdu sentence — say "Today", "Tomorrow", "Friday", "9:00 PM", "6 guests". Never "आज", never "نو بجے".
  Correct: "Ji, aaj Friday 9:00 PM, 6 guests — theek hai?"`;

  const PROFILES = {
    pakistani: {
      script: ROMAN_URDU_RULE,
      greeting: 'Assalam o alaikum! Welcome to Monal. Main Sana hoon, aap ki assistant. Aap ki kya khidmat kar sakti hoon?',
      voices: (req.body?.voice === 'neha'
        ? [{ label: 'Vapi South-Asian (Neha)', voice: { provider: 'vapi', voiceId: 'Neha' } }]
        : req.body?.voice === 'azure'
        ? [{ label: 'Azure Jenny — very stable', voice: { provider: 'azure', voiceId: 'en-US-JennyNeural' } }]
        : [{ label: 'ElevenLabs (Sarah) — smooth, no distortion', voice: { provider: '11labs', voiceId: 'sarah', model: 'eleven_turbo_v2_5', stability: 0.65, similarityBoost: 0.75 } }]
      ).concat([{ label: 'Azure Jenny (fallback)', voice: { provider: 'azure', voiceId: 'en-US-JennyNeural' } }]),
    },
    urdu: {
      script: `SCRIPT RULE: You are using a pure Urdu-script voice. Write EVERY reply in Urdu script (اردو) only — even if the caller speaks English, answer in Urdu script. NEVER write English or Roman Urdu; this voice cannot pronounce Latin letters and it will sound like noise.`,
      greeting: 'السلام علیکم، مونال میں خوش آمدید۔ میں ثنا ہوں۔ میں آپ کی کیا مدد کر سکتی ہوں؟',
      voices: [{ label: 'Azure Urdu — Uzma (Urdu script only)', voice: { provider: 'azure', voiceId: 'ur-PK-UzmaNeural' } }],
    },
    english: {
      script: `SCRIPT RULE: Reply in English only, using English letters. Never use Urdu script.`,
      greeting: 'Assalam o alaikum, and welcome to Monal. I am Sana, your virtual assistant. How may I help you today?',
      voices: [
        { label: 'Vapi voice (Neha) — English', voice: { provider: 'vapi', voiceId: 'Neha' } },
        { label: 'Azure English (Jenny)', voice: { provider: 'azure', voiceId: 'en-US-JennyNeural' } },
      ],
    },
  };
  const P = PROFILES[profile] || PROFILES.pakistani;

  // WHY DEEPGRAM: Whisper-family transcribers HALLUCINATE on poor phone audio — on real
  // calls they invented "Evolution", "Harpy the horse", Korean and German. Deepgram
  // outputs what it actually hears (or nothing) and never invents words.
  const LANGS = {
    urdu:    { provider: 'deepgram', model: 'nova-2', language: 'hi', numerals: true,
               keywords: ['Monal:3', 'karahi:2', 'naan:2', 'biryani:2', 'reservation:3', 'delivery:2', 'takeaway:2'] },
    english: { provider: 'deepgram', model: 'nova-2', language: 'en', numerals: true,
               keywords: ['Monal:3', 'karahi:2', 'naan:2', 'biryani:2', 'reservation:3', 'delivery:2', 'takeaway:2'] },
    auto:    { provider: 'deepgram', model: 'nova-3', language: 'multi', numerals: true },
  };
  const EARS = LANGS[req.body?.ears] || LANGS.urdu;
  const ENGINES = P.voices.map((v) => ({
    label: v.label,
    apply: (p) => {
      p.voice = { ...v.voice, chunkPlan: { enabled: true, minCharacters: 60 } };
      p.firstMessage = P.greeting;
      // Rule goes FIRST (models obey the top of the prompt) and is repeated at the end.
      p.model.messages[0].content = `${P.script}\n\n${p.model.messages[0].content}\n\n${P.script}`;
      p.transcriber = EARS;
    },
  }));
  try {
    let d = null, used = null;
    const tried = [];
    for (const eng of ENGINES) {
      const p = JSON.parse(JSON.stringify(payload));
      eng.apply(p);
      const r = await fetch(`https://api.vapi.ai/assistant/${process.env.VAPI_ASSISTANT_ID}`, { method: 'PATCH', headers: H, body: JSON.stringify(p) });
      d = await r.json().catch(() => ({}));
      if (r.ok) { used = eng; Object.assign(payload, p); break; }
      tried.push(`${eng.label}: ${Array.isArray(d?.message) ? d.message.join(' / ') : (d?.message || 'rejected')}`);
    }
    if (!used) return res.status(502).json({ error: 'Vapi rejected every voice option.', tried });
    payload._engineUsed = used.label;
    // read it BACK from Vapi — never report what we hoped, only what is actually stored
    let live = {};
    try {
      const g = await fetch(`https://api.vapi.ai/assistant/${process.env.VAPI_ASSISTANT_ID}`, { headers: H });
      const a = await g.json();
      const sp = a.model?.messages?.find((m) => m.role === 'system')?.content || '';
      live = {
        voice: `${a.voice?.provider} · ${a.voice?.voiceId}`,
        greeting: a.firstMessage,
        ears: a.transcriber ? `${a.transcriber.provider} ${a.transcriber.model || ''}`.trim() : '(none)',
        brain: `${a.model?.provider} · ${a.model?.model}`,
        promptChars: sp.length,
        hasRomanUrduRule: /ROMAN URDU/i.test(sp) || /Urdu script/i.test(sp),
        hasRealMenu: /Cheese Naan/i.test(sp),
      };
    } catch { /* non-fatal */ }
    payload._live = live;

    // attach the assistant to the phone number (so inbound calls reach it) + read the live number
    let liveNumber = '';
    if (process.env.VAPI_PHONE_NUMBER_ID) {
      try {
        await fetch(`https://api.vapi.ai/phone-number/${process.env.VAPI_PHONE_NUMBER_ID}`, {
          method: 'PATCH', headers: H, body: JSON.stringify({ assistantId: process.env.VAPI_ASSISTANT_ID }),
        });
        const pn = await fetch(`https://api.vapi.ai/phone-number/${process.env.VAPI_PHONE_NUMBER_ID}`, { headers: H });
        const pd = await pn.json().catch(() => ({}));
        liveNumber = pd.number || '';
      } catch { /* optional */ }
    }
    res.json({
      ok: true,
      mode: isLocal
        ? 'Local demo mode — bookings appear on this dashboard ~10 seconds after each call ends (auto-sync from Vapi).'
        : 'Realtime webhook — bookings appear during the call.',
      liveNumber,
      applied: {
        prompt: true, greeting: payload.firstMessage.slice(0, 40) + '…',
        engine: payload._engineUsed,
        greeting: payload.firstMessage,
        voice: `${payload.voice.provider} · ${payload.voice.voiceId}`,
        language: 'Urdu + English (mixed sentences supported)',
        earsWarning: /Fallback/.test(payload._engineUsed)
          ? 'Your preferred voice was not available — running the English fallback voice. Try another voice profile.'
          : '',
        booking: isLocal ? 'AI extraction after call (local mode)' : `3 realtime tools + webhook`,
      },
    });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

/* ===== VERIFY: read back exactly what is installed on the Vapi assistant ===== */
app.get('/api/admin/vapi/verify', auth, async (_req, res) => {
  if (!process.env.VAPI_API_KEY || !process.env.VAPI_ASSISTANT_ID)
    return res.status(400).json({ error: 'Vapi keys missing in .env' });
  try {
    const r = await fetch(`https://api.vapi.ai/assistant/${process.env.VAPI_ASSISTANT_ID}`, {
      headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` },
    });
    if (!r.ok) return res.status(502).json({ error: 'Vapi API ' + r.status, detail: (await r.text()).slice(0, 200) });
    const a = await r.json();
    const sp = a.model?.messages?.find((m) => m.role === 'system')?.content || '';
    res.json({
      firstMessage: a.firstMessage || '(none)',
      model: `${a.model?.provider || '?'} · ${a.model?.model || '?'}`,
      transcriber: a.transcriber ? `${a.transcriber.provider} ${a.transcriber.model || a.transcriber.language || ''}`.trim() : '(none — realtime)',
      voice: a.voice ? `${a.voice.provider} · ${a.voice.voiceId}` : '(none)',
      promptChars: sp.length,
      // proof-of-install checks against the real prompt file
      hasSana: /You are "Sana"/i.test(sp),
      hasDelivery: /home delivery/i.test(sp),
      hasRealMenu: /Cheese Naan/i.test(sp),
      hasBranches: /Liberty Chowk/i.test(sp),
      hasBadLineRule: /line isn't very clear/i.test(sp),
      promptHead: sp.slice(0, 220),
    });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

/* ================= CALL DIAGNOSTICS =================
   Pulls the real transcript straight from Vapi so you can SEE what the AI
   heard vs what it said — the fastest way to find any remaining problem. */
app.get('/api/admin/vapi/diagnose', auth, async (_req, res) => {
  if (!process.env.VAPI_API_KEY || !process.env.VAPI_ASSISTANT_ID)
    return res.status(400).json({ error: 'Vapi keys missing in .env' });
  try {
    const r = await fetch(`https://api.vapi.ai/call?assistantId=${process.env.VAPI_ASSISTANT_ID}&limit=5`, {
      headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` },
    });
    if (!r.ok) return res.status(502).json({ error: 'Vapi API error ' + r.status, detail: (await r.text()).slice(0, 300) });
    const calls = await r.json();
    const out = (Array.isArray(calls) ? calls : []).map((c) => ({
      id: c.id,
      when: c.startedAt || c.createdAt,
      status: c.status,
      endedReason: c.endedReason,
      durationSec: c.startedAt && c.endedAt ? Math.round((Date.parse(c.endedAt) - Date.parse(c.startedAt)) / 1000) : 0,
      cost: c.cost,
      turns: (c.artifact?.messages || c.messages || [])
        .filter((m) => ['bot', 'assistant', 'user', 'customer'].includes(m.role))
        .map((m) => ({ who: m.role === 'user' || m.role === 'customer' ? 'CALLER' : 'AI', text: m.message || m.content || '' })),
      summary: c.analysis?.summary || '',
      structuredData: c.analysis?.structuredData || null,
    }));
    res.json({ calls: out });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

/* ===== BROWSER CALL: same assistant, clean laptop audio (no phone line) ===== */
app.get('/api/admin/vapi/web-key', auth, (_q, res) =>
  res.json({ publicKey: process.env.VAPI_PUBLIC_KEY || '', assistantId: process.env.VAPI_ASSISTANT_ID || '' }));

/* ================= the "ring their phone" demo =================
   Dashboard button -> Vapi outbound call to any number. */
app.post('/api/admin/test-call', auth, async (req, res) => {
  const { vapi, vapiPhone } = integrations();
  if (!vapi || !vapiPhone) return res.status(400).json({ error: 'Add VAPI_API_KEY, VAPI_ASSISTANT_ID and VAPI_PHONE_NUMBER_ID in .env first.' });
  const number = String(req.body?.number || '').trim();
  if (!/^\+?\d{10,15}$/.test(number.replace(/[\s-]/g, ''))) return res.status(400).json({ error: 'Enter a full number with country code, e.g. +9230xxxxxxxx' });
  try {
    const r = await fetch('https://api.vapi.ai/call', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assistantId: process.env.VAPI_ASSISTANT_ID,
        phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
        customer: { number: number.startsWith('+') ? number : `+${number}` },
      }),
    });
    const d = await r.json();
    if (!r.ok) return res.status(502).json({ error: d?.message || 'Vapi call failed', detail: d });
    res.json({ ok: true, callId: d.id, status: d.status });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

/* ================= WHATSAPP REMINDERS (1 hour before the table) ================= */
/** Turn "Today" + "9:00 PM" into a real Date, then subtract the reminder lead time. */
function reservationDateTime(day, time) {
  const now = new Date();
  const d = new Date(now);
  const D = String(day || '').toLowerCase().trim();
  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  if (D === 'tomorrow') d.setDate(d.getDate() + 1);
  else if (DAYS.includes(D)) {
    const target = DAYS.indexOf(D);
    let add = (target - d.getDay() + 7) % 7;
    if (add === 0) add = 0;             // today
    d.setDate(d.getDate() + add);
  }
  const m = String(time || '').match(/(\d{1,2}):?(\d{2})?\s*(AM|PM)?/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const mm = parseInt(m[2] || '0', 10);
  const suf = (m[3] || 'PM').toUpperCase();
  if (suf === 'PM' && h < 12) h += 12;
  if (suf === 'AM' && h === 12) h = 0;
  d.setHours(h, mm, 0, 0);
  if (d < now && D === '') d.setDate(d.getDate() + 1);
  return d;
}
export function computeReminderAt(r) {
  const lead = Number(getSetting('reminderHours') || 1);
  const when = reservationDateTime(r.day, r.time);
  if (!when) return '';
  const at = new Date(when.getTime() - lead * 3600 * 1000);
  return at > new Date() ? at.toISOString() : '';   // in the past -> no reminder
}
function reminderText(r) {
  const lead = getSetting('reminderHours') || '1';
  return `⏰ The Monal — Reminder\n\nAssalam o alaikum ${r.name}!\nAap ki booking ${lead} ghante mein hai:\n\n${r.party} guests · ${r.day} ${r.time}${r.notes ? `\n${r.notes}` : ''}\n\nTable ${getSetting('holdMinutes')} minutes tak hold rahega. Aap ka intezar hai! 🦚`;
}
async function runReminders() {
  try {
    const due = dueReminders(new Date().toISOString());
    for (const r of due) {
      const ok = await sendWhatsApp(r.phone, reminderText(r));
      markReminded(r.id);
      console.log(`⏰ Reminder ${ok ? 'sent' : 'skipped (WhatsApp not configured)'} → ${r.name} (${r.day} ${r.time})`);
    }
  } catch (e) { console.warn('Reminder error:', e.message); }
}
if (process.env.NODE_ENV !== 'test') setInterval(runReminders, 60000);

/* ================= VAPI POLLER (makes LOCALHOST work) =================
   Every 8s: pull recently ended calls from Vapi, log them, and create
   reservations from the AI-extracted booking data. Dedupes by call id. */
/* ===== Normalise Devanagari / Urdu day & time into clean English for the dashboard.
   Belt-and-braces: even if the model slips, the manager never sees "आज · नौ बजे". ===== */
const DAY_MAP = {
  'आज': 'Today', 'آج': 'Today', 'aaj': 'Today',
  'कल': 'Tomorrow', 'کل': 'Tomorrow', 'kal': 'Tomorrow',
  'सोमवार': 'Monday', 'पीर': 'Monday', 'منگل': 'Tuesday', 'मंगलवार': 'Tuesday',
  'बुधवार': 'Wednesday', 'بدھ': 'Wednesday', 'जुमेरात': 'Thursday', 'جمعرات': 'Thursday',
  'गुरुवार': 'Thursday', 'शुक्रवार': 'Friday', 'जुमा': 'Friday', 'جمعہ': 'Friday',
  'शनिवार': 'Saturday', 'हफ़्ता': 'Saturday', 'ہفتہ': 'Saturday',
  'रविवार': 'Sunday', 'इतवार': 'Sunday', 'اتوار': 'Sunday',
};
const NUM_WORDS = {
  'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पांच': 5, 'पाँच': 5, 'छह': 6, 'छे': 6,
  'सात': 7, 'आठ': 8, 'नौ': 9, 'दस': 10, 'ग्यारह': 11, 'बारह': 12,
  'ایک': 1, 'دو': 2, 'تین': 3, 'چار': 4, 'پانچ': 5, 'چھ': 6, 'سات': 7, 'آٹھ': 8, 'نو': 9, 'دس': 10,
};
const hasNonLatin = (t) => /[\u0900-\u097F\u0600-\u06FF]/.test(String(t || ''));
function cleanDay(d) {
  const t = String(d || '').trim();
  if (!t) return '';
  for (const k of Object.keys(DAY_MAP)) if (t.includes(k)) return DAY_MAP[k];
  return hasNonLatin(t) ? 'Today' : t;
}
function cleanTime(t) {
  const s0 = String(t || '').trim();
  if (!s0) return '';
  const m = s0.match(/(\d{1,2})\s*[:.]?\s*(\d{2})?\s*(am|pm|AM|PM)?/);
  if (m) {
    let h = parseInt(m[1], 10); const mm = m[2] || '00';
    let suf = (m[3] || '').toUpperCase();
    if (!suf) suf = h >= 1 && h <= 10 ? 'PM' : (h === 12 ? 'PM' : 'PM');
    if (h > 12) { h -= 12; suf = 'PM'; }
    return `${h}:${mm} ${suf}`;
  }
  for (const w of Object.keys(NUM_WORDS)) {
    if (s0.includes(w)) {
      const h = NUM_WORDS[w];
      return `${h > 12 ? h - 12 : h}:00 ${h >= 1 && h <= 10 ? 'PM' : 'PM'}`;
    }
  }
  return hasNonLatin(s0) ? '' : s0;
}
function cleanName(n) {
  const t = String(n || '').trim();
  return (!t || hasNonLatin(t)) ? '' : t;
}

export function processVapiCall(c) {
  if (!c?.id || getCall(c.id)) return null;                      // already processed
  if (!['ended', 'completed'].includes(c.status)) return null;   // still live
  const msgs = c.artifact?.messages || c.messages || [];
  const transcript = msgs
    .filter((m) => ['bot', 'assistant', 'user', 'customer'].includes(m.role))
    .map((m) => `${m.role === 'user' || m.role === 'customer' ? 'Caller' : 'AI'}: ${m.message || m.content || ''}`)
    .join('\n') || String(c.artifact?.transcript || c.transcript || '');
  const started = c.startedAt ? Date.parse(c.startedAt) : 0;
  const ended = c.endedAt ? Date.parse(c.endedAt) : 0;
  const sd = c.analysis?.structuredData || {};
  const bt = String(sd.bookingType || 'reservation').toLowerCase();
  const isOrder = ['delivery', 'takeaway', 'pre_order'].includes(bt);
  // Never lose a real booking: if the caller confirmed but the name didn't transcribe,
  // still save it and flag it for the manager rather than dropping the table.
  sd.name = cleanName(sd.name);
  sd.day = cleanDay(sd.day);
  sd.time = cleanTime(sd.time);
  const complete = isOrder
    ? !!(sd.items && (bt !== 'delivery' || sd.address))
    : !!(sd.party && sd.day && sd.time);
  const booked = (sd.booked === true || sd.booked === 'true') && complete;
  const incomplete = (sd.booked === true || sd.booked === 'true') && !complete;
  addCall({
    id: c.id,
    caller: c.customer?.number || 'Web/Test call',
    durationSec: started && ended ? Math.max(0, Math.round((ended - started) / 1000)) : 0,
    outcome: booked ? 'Reservation' : incomplete ? 'Incomplete booking' : (c.analysis?.successEvaluation || c.endedReason || 'Call'),
    summary: c.analysis?.summary || '',
    transcript,
  });
  let resv = null;
  if (booked) {
    const typeMap = { reservation: 'Dinner', birthday: 'Birthday', corporate_dinner: 'Event', pre_order: 'Pre-order', takeaway: 'Takeaway', delivery: 'Delivery' };
    const OCC = { dinner: 'Dinner', lunch: 'Lunch', 'high-tea': 'High-Tea', hightea: 'High-Tea', buffet: 'High-Tea', birthday: 'Birthday', party: 'Event', event: 'Event' };
    const occ = OCC[String(sd.occasion || '').toLowerCase().trim()];
    const noteBits = [];
    if (sd.seating) noteBits.push(sd.seating + ' seating');
    if (sd.items) noteBits.push('Order: ' + sd.items);
    if (sd.address) noteBits.push('Address: ' + sd.address);
    if (sd.total) noteBits.push('Total: Rs ' + sd.total);
    if (sd.branch) noteBits.push('Branch: ' + sd.branch);
    if (sd.notes) noteBits.push(sd.notes);
    if (!sd.name) noteBits.unshift('⚠ NAME NOT CAPTURED — call back to confirm');
    resv = addReservation({
      name: sd.name || 'Guest (name unclear)', phone: sd.whatsapp || c.customer?.number || '',
      party: sd.party || 0, day: sd.day || 'Today', time: sd.time || (isOrder ? 'ASAP' : ''),
      type: occ || typeMap[bt] || 'Dinner', notes: noteBits.join(' | '),
      source: 'AI call', callId: c.id,
    });
    if (!isOrder) {
      autoAssignTable(resv);
      const at = computeReminderAt(resv);
      if (at) updateReservation(resv.id, { reminderAt: at });
    }
    appendToSheet(resv);
    sendWhatsApp(resv.phone, confirmationText(resv));
  }
  return { call: c.id, reservation: resv?.id || null };
}

async function pollVapi() {
  if (!process.env.VAPI_API_KEY || !process.env.VAPI_ASSISTANT_ID) return;
  try {
    const r = await fetch(`https://api.vapi.ai/call?assistantId=${process.env.VAPI_ASSISTANT_ID}&limit=15`, {
      headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` },
    });
    if (!r.ok) return;
    const calls = await r.json();
    if (Array.isArray(calls)) for (const c of calls) {
      const out = processVapiCall(c);
      if (out?.reservation) console.log(`📞 Synced call ${out.call} → reservation ${out.reservation}`);
    }
  } catch { /* offline / rate-limited — try again next tick */ }
}
if (process.env.VAPI_API_KEY && process.env.NODE_ENV !== 'test') {
  setInterval(pollVapi, 8000);
  setTimeout(pollVapi, 2500);
  console.log('🔄 Vapi auto-sync active — ended calls flow into this dashboard every ~8s.');
}

/* ================= serve the dashboard build ================= */
const CLIENT = join(__dirname, '..', 'frontend', 'dist');
if (existsSync(CLIENT)) {
  app.use(express.static(CLIENT));
  app.get(/^(?!\/api).*/, (_q, res) => res.sendFile(join(CLIENT, 'index.html')));
}

const PORT = process.env.PORT || 5100;
app.listen(PORT, () => console.log(`Monal AI backend running on :${PORT}`));
