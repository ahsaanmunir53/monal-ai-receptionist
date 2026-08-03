# The Monal AI Receptionist — SETUP GUIDE (the real product)

This is the full production system: **React dashboard + Node/Express backend + SQLite database + Vapi webhook + Google Sheets + WhatsApp**.
Same architecture as the Fatima Hope build you already run. Everything below uses **free tiers only**.

---

## 0. Run it locally right now (no keys needed)

```
cd backend  && npm install && node server.js      # http://localhost:5100
cd frontend && npm install && npm run build       # backend serves the built dashboard
```
Open http://localhost:5100 → login `admin / Monal@2026` (change in `backend/.env`).
It boots with realistic demo data (3 reservations, 2 call transcripts, the full menu) so **the dashboard already looks alive for a pitch** — before a single key is added.

---

## 1. THE KEYS I NEED FROM YOU (all free)

Copy `backend/.env.example` → `backend/.env` and fill these. Send me the values (or fill them yourself) and every feature switches on automatically — the dashboard's Settings page shows green per connection.

### A. Required (you set these yourself, 1 minute)
| Key | What it is |
|---|---|
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Dashboard login for Monal's manager |
| `JWT_SECRET` | Any long random string |

### B. Vapi — the voice AI (free account + trial credits)
Go to **vapi.ai → sign up (free)**. Trial credits cover the whole demo phase.
| Key | Where to find it |
|---|---|
| `VAPI_API_KEY` | Dashboard → Organization → API Keys |
| `VAPI_ASSISTANT_ID` | Create an Assistant (steps in §3) → copy its ID |
| `VAPI_PHONE_NUMBER_ID` | Phone Numbers → get a **free number** → copy its ID |
| `VAPI_WEBHOOK_SECRET` | You invent it (e.g. `monal-webhook-secret`) and paste the same value in Vapi's assistant → Server URL secret |

### C. Google Sheets — the booking sheet (free)
1. console.cloud.google.com → new project → enable **Google Sheets API**.
2. IAM → **Service Accounts** → create one → Keys → **Add key (JSON)** → download.
3. From that JSON give me: `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL`, and `private_key` → `GOOGLE_PRIVATE_KEY` (paste with the `\n`s intact — the code handles them).
4. Create a Google Sheet, **Share it with the service-account email** (Editor), copy the ID from its URL → `GOOGLE_SHEET_ID`.

### D. WhatsApp Cloud API — confirmations (Meta free tier: 1,000 conversations/month)
1. developers.facebook.com → create app (type: Business) → add **WhatsApp** product.
2. From WhatsApp → API Setup: the temporary token → `WHATSAPP_TOKEN` (later generate a permanent one), and the **Phone number ID** → `WHATSAPP_PHONE_NUMBER_ID`.
3. `MANAGER_WHATSAPP` = the duty manager's number (escalations), e.g. `923001234567`.
   *Note: on the free test tier, recipient numbers must be added as test recipients in Meta until the business is verified.*

### E. Database — **nothing needed.** SQLite, same as Fatima Hope. Zero keys, zero cost.

---

## 2. What the backend exposes

| Endpoint | Purpose |
|---|---|
| `POST /api/vapi/webhook` | **Vapi calls this.** Handles `create_reservation`, `cancel_reservation`, `notify_manager` tool-calls + end-of-call reports (logs transcript). Secured by `x-vapi-secret`. |
| `POST /api/admin/login` | Dashboard auth (12h JWT) |
| `GET/POST/PATCH/DELETE /api/admin/reservations` | Live bookings CRUD |
| `GET /api/admin/calls`, `/calls/:id` | Call log + transcripts |
| `GET/POST/PATCH/DELETE /api/admin/knowledge` | Menu / packages / policies the AI knows |
| `GET /api/admin/knowledge-pack` | One-click text pack to paste into Vapi |
| `GET/PATCH /api/admin/settings` | Branch settings + integration status |
| `POST /api/admin/test-call` | **Ring any phone** — Vapi outbound call from the dashboard |

Bookings from the AI hit three places at once: this dashboard (live), the Google Sheet (append), and the guest's WhatsApp.

---

## 3. Wire Vapi to this backend (10 minutes)

1. Vapi → **Assistants → Create**. Model: GPT-4o-mini (or Claude Haiku). System prompt: paste **MONAL-VAPI-PROMPT.txt**. First message: `السلام علیکم، دی مونال میں خوش آمدید! How may I help you today?`
2. Transcriber: **Deepgram**, language `multi` (handles Urdu/English mixing). Voice: Azure `ur-PK-UzmaNeural` (or ElevenLabs for premium).
3. **Server URL** (Messaging): `https://YOUR-BACKEND.onrender.com/api/vapi/webhook` · Secret: your `VAPI_WEBHOOK_SECRET`. Enable **end-of-call report**.
4. **Tools → Create** these three (type: function, "server url" inherits the assistant's):
```json
{ "name": "create_reservation",
  "description": "Book a table once name, party size, day and time are known.",
  "parameters": { "type": "object", "properties": {
    "name": {"type":"string"}, "phone": {"type":"string"},
    "party": {"type":"number"}, "day": {"type":"string"},
    "time": {"type":"string"}, "notes": {"type":"string"} },
    "required": ["name","party","day","time"] } }
```
```json
{ "name": "cancel_reservation",
  "description": "Cancel an existing booking by guest name and/or phone.",
  "parameters": { "type":"object", "properties": {
    "name":{"type":"string"}, "phone":{"type":"string"} } } }
```
```json
{ "name": "notify_manager",
  "description": "Escalate complaints or unusual requests to the duty manager.",
  "parameters": { "type":"object", "properties": {
    "phone":{"type":"string"}, "summary":{"type":"string"} }, "required":["summary"] } }
```
5. Attach the assistant to your free Vapi number. Copy the three IDs into `.env`. Done — real calls now flow into the dashboard.
6. Knowledge: dashboard → **AI knowledge → Generate → Copy** → paste into the assistant (prompt bottom or a knowledge file). Menu change at Monal = edit here, re-paste — live in minutes.

---

## 4. Deploy (free)

- **Render free web service**: root = this folder, build `cd frontend && npm install && npm run build && cd ../backend && npm install`, start `node backend/server.js`, add the `.env` values in Environment. Free-tier notes: the service **sleeps after idle** (first call wakes it ~30s) and the **disk resets on redeploy** (SQLite data is demo-safe, not production-safe).
- **When Monal signs**: flip to Starter ($7) + 1 GB disk ($0.25) exactly like Fatima Hope — data becomes permanent, no sleeping. That cost sits inside your Rs 150k/month with room to spare.
- The demo pitch site (`Monal-AI-Receptionist.html`) hosts free on Netlify alongside.

---

## 5. The pitch flow with this system

1. Open the **dashboard** on the projector — it's already alive with data.
2. Dashboard → **Ring a phone** → type the manager's number → their phone rings → they talk to the AI.
3. While they're still on the call: the **Reservations page updates live**, the Google Sheet row appears, their WhatsApp buzzes with the confirmation.
4. Show **AI knowledge**: change a karahi price in front of them → "your chef changes the menu, your receptionist knows in one minute."
That sequence is the close.
