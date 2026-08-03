import { useEffect, useState } from 'react';
import { api } from '../lib/api';

const FIELDS: [string, string, string][] = [
  ['branchName', 'Branch name', 'The Monal'],
  ['hours', 'Opening hours', '12:00 noon – 11:00 PM, daily'],
  ['address', 'Location line (spoken to callers)', 'Hilltop dining above the city'],
  ['holdMinutes', 'Table hold (minutes)', '15'],
  ['reminderHours', 'WhatsApp reminder — hours before the table', '1'],
  ['bigGroup', 'Large-group threshold', '8'],
  ['managerWhatsApp', 'Manager WhatsApp (escalations)', '923xxxxxxxxx'],
  ['greeting', 'AI first greeting', ''],
];

export default function SettingsPage() {
  const [s, setS] = useState<any>({});
  const [ints, setInts] = useState<any>({});
  const [saved, setSaved] = useState(false);
  useEffect(() => { api('/api/admin/settings').then((r) => { if (r.ok) { setS(r.data.settings); setInts(r.data.integrations); } }); }, []);
  const save = async () => {
    const r = await api('/api/admin/settings', { method: 'PATCH', body: JSON.stringify(s) });
    if (r.ok) { setS(r.data.settings); setSaved(true); setTimeout(() => setSaved(false), 2500); }
  };
  const Dot = ({ on, l, hint }: any) => (
    <div className="flex items-center justify-between rounded-xl border border-gold/10 bg-[#0e1c17] px-4 py-3">
      <div><p className="text-sm font-semibold">{l}</p><p className="text-[11px] text-mut">{hint}</p></div>
      <span className={`pill border ${on ? 'border-em2/50 bg-em2/15 text-em2' : 'border-white/10 bg-white/5 text-mut'}`}>{on ? 'Connected' : 'Not set'}</span>
    </div>
  );
  return (
    <div className="max-w-2xl">
      <h1 className="font-serif text-3xl text-gold2">Settings</h1>
      <p className="mt-1 text-sm text-mut">Branch details the AI speaks from, and the status of each connection.</p>
      <div className="card mt-5 grid gap-3 p-5">
        {FIELDS.map(([k, label, ph]) => (
          <label key={k} className="text-xs font-semibold text-mut">{label}
            <input className="inp mt-1" placeholder={ph} value={s[k] ?? ''} onChange={(e) => setS({ ...s, [k]: e.target.value })} />
          </label>
        ))}
        <div className="flex items-center gap-3">
          <button className="btn-gold" onClick={save}>Save settings</button>
          {saved && <span className="text-sm font-semibold text-em2">✓ Saved</span>}
        </div>
      </div>
      <div className="mt-5 grid gap-2">
        <Dot on={ints.vapi} l="Vapi voice AI" hint="VAPI_API_KEY + VAPI_ASSISTANT_ID in backend .env" />
        <Dot on={ints.vapiPhone} l="Outbound phone number" hint="VAPI_PHONE_NUMBER_ID in backend .env" />
        <Dot on={ints.sheets} l="Google Sheets booking log" hint="Service account email + private key + sheet ID" />
        <Dot on={ints.whatsapp} l="WhatsApp confirmations" hint="Meta WhatsApp Cloud API token + phone number ID" />
      </div>
      <p className="mt-4 text-[11.5px] text-mut">Keys live only in the backend .env file — never in the browser. Every connection is optional: the dashboard works without them, features switch on as keys are added.</p>
    </div>
  );
}
