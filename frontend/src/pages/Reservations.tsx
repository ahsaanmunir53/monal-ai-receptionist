import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { api } from '../lib/api';

const EMPTY = { name: '', phone: '', party: '2', day: 'Today', time: '', type: 'Dinner', notes: '' };
const STATUS = ['Confirmed', 'Seated', 'Completed', 'No-show', 'Cancelled'];
const badge: Record<string, string> = {
  Confirmed: 'border-em2/50 bg-em2/15 text-em2', Seated: 'border-gold/50 bg-gold/15 text-gold2',
  Completed: 'border-white/20 bg-white/10 text-ink', 'No-show': 'border-red-400/40 bg-red-400/10 text-red-300',
  Cancelled: 'border-white/10 bg-white/5 text-mut',
};

export default function Reservations() {
  const [list, setList] = useState<any[]>([]);
  const [f, setF] = useState<any>({ ...EMPTY });
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<any>(null);
  const [transcript, setTranscript] = useState<any>(null);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const known = useRef<Set<string> | null>(null);

  const load = async () => {
    const r = await api('/api/admin/reservations');
    if (!r.ok) return;
    const ids = new Set<string>(r.data.map((x: any) => x.id));
    if (known.current) {
      const fresh = r.data.filter((x: any) => !known.current!.has(x.id)).map((x: any) => x.id);
      if (fresh.length) { setFlash(new Set(fresh)); setTimeout(() => setFlash(new Set()), 4000); }
    }
    known.current = ids;
    setList(r.data);
  };
  useEffect(() => { load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, []);

  const add = async () => {
    if (!f.name.trim() || !f.time.trim()) return setErr('Name and time are required.');
    setErr('');
    const r = await api('/api/admin/reservations', { method: 'POST', body: JSON.stringify({ ...f, party: Number(f.party) || 2 }) });
    if (r.ok) { setF({ ...EMPTY }); setShow(false); load(); }
  };
  const setStatus = async (id: string, status: string) => {
    const r = await api(`/api/admin/reservations/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    if (r.ok) setList((l) => l.map((x) => (x.id === id ? r.data : x)));
  };
  const del = async (id: string) => {
    if (!confirm('Delete this reservation?')) return;
    const r = await api(`/api/admin/reservations/${id}`, { method: 'DELETE' });
    if (r.ok) setList((l) => l.filter((x) => x.id !== id));
  };
  const viewDetail = (r: any) => { setOpen(r); setTranscript(null); };
  const viewCall = async () => {
    if (!open?.callId) return;
    const r = await api(`/api/admin/calls/${open.callId}`);
    if (r.ok) setTranscript(r.data);
  };
  const when = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl text-gold2">Reservations</h1>
          <p className="mt-1 text-sm text-mut">AI bookings appear here live (new rows glow). Click any row for full details.</p>
        </div>
        <button className="btn-gold" onClick={() => setShow((s) => !s)}><Plus size={16} /> Add manually</button>
      </div>

      {show && (
        <div className="card mt-5 p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <input className="inp" placeholder="Guest name *" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            <input className="inp" placeholder="Phone / WhatsApp" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
            <input className="inp" type="number" min={1} placeholder="Party size" value={f.party} onChange={(e) => setF({ ...f, party: e.target.value })} />
            <input className="inp" placeholder="Day — e.g. Saturday" value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} />
            <input className="inp" placeholder="Time — e.g. 8:00 PM *" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} />
            <select className="inp" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
              {['Dinner', 'Lunch', 'High-Tea', 'Birthday', 'Event', 'Pre-order', 'Takeaway', 'Delivery'].map((t) => <option key={t}>{t}</option>)}
            </select>
            <input className="inp sm:col-span-3" placeholder="Notes (window table, décor…)" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </div>
          {err && <p className="mt-2 text-sm font-semibold text-red-400">{err}</p>}
          <div className="mt-4"><button className="btn-gold" onClick={add}>Save reservation</button></div>
        </div>
      )}

      <div className="card mt-5 overflow-x-auto">
        <table className="w-full min-w-[960px]">
          <thead><tr>
            <th className="th">Guest</th><th className="th">Party</th><th className="th">Day & time</th>
            <th className="th">Type</th><th className="th">Booked at</th><th className="th">Reminder</th><th className="th">Source</th><th className="th">Status</th><th className="th"></th>
          </tr></thead>
          <tbody>
            {list.length === 0 && <tr><td className="td text-mut" colSpan={9}>No reservations yet — the first AI booking will appear here automatically.</td></tr>}
            {list.map((r) => (
              <tr key={r.id} onClick={() => viewDetail(r)} className={`cursor-pointer transition hover:bg-white/[.03] ${flash.has(r.id) ? 'flash-row' : ''}`}>
                <td className="td">
                  <b className={r.name.includes('unclear') ? 'text-gold2' : ''}>{r.name}</b>
                  {r.phone && <div className="text-xs text-mut">{r.phone}</div>}
                </td>
                <td className="td">{r.party}</td>
                <td className="td">{r.day} · {r.time}</td>
                <td className="td">{r.type}</td>
                <td className="td whitespace-nowrap text-xs text-mut">{when(r.createdAt)}</td>
                <td className="td whitespace-nowrap text-xs">
                  {r.reminderSent ? <span className="pill border border-em2/40 bg-em2/10 text-em2">⏰ sent</span>
                    : r.reminderAt ? <span className="pill border border-gold/30 bg-gold/10 text-gold2">⏰ {new Date(r.reminderAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    : <span className="text-mut">—</span>}
                </td>
                <td className="td"><span className={`pill border ${r.source === 'AI call' ? 'border-em2/40 bg-em2/10 text-em2' : 'border-gold/30 bg-gold/10 text-gold2'}`}>{r.source}</span></td>
                <td className="td" onClick={(e) => e.stopPropagation()}>
                  <select value={r.status} onChange={(e) => setStatus(r.id, e.target.value)}
                    className={`rounded-full border bg-transparent px-2 py-1 text-[11px] font-bold outline-none ${badge[r.status] || ''}`}>
                    {STATUS.map((s) => <option key={s} className="bg-card text-ink">{s}</option>)}
                  </select>
                </td>
                <td className="td" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => del(r.id)} className="rounded-full p-1.5 text-mut hover:bg-red-400/10 hover:text-red-300"><Trash2 size={15} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setOpen(null)}>
          <div className="card max-h-[85vh] w-full max-w-xl overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <p className="font-serif text-2xl text-gold2">{open.name}</p>
                <p className="text-xs text-mut">Reserved {when(open.createdAt)} · via {open.source}</p>
              </div>
              <button onClick={() => setOpen(null)} className="rounded-full p-1.5 text-mut hover:bg-white/10"><X size={18} /></button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              {[['Party', `${open.party} guests`], ['Day', open.day], ['Time', open.time], ['Type', open.type],
                ['Phone', open.phone || '—'], ['Status', open.status]].map(([k, v]) => (
                <div key={k as string} className="rounded-xl border border-gold/10 bg-[#0e1c17] px-4 py-3">
                  <p className="text-[10px] uppercase tracking-widest text-mut">{k}</p>
                  <p className="mt-0.5 font-semibold">{v}</p>
                </div>
              ))}
            </div>
            {open.notes && <div className="mt-3 rounded-xl border border-gold/15 bg-gold/5 p-4 text-sm">{open.notes}</div>}
            {open.callId && (
              <div className="mt-4">
                {!transcript
                  ? <button className="btn-ghost" onClick={viewCall}>📞 View the call that made this booking</button>
                  : <>
                      {transcript.summary && <p className="rounded-xl border border-em2/25 bg-em2/10 p-3 text-sm">{transcript.summary}</p>}
                      <pre className="mt-3 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-xl bg-[#0a1310] p-4 text-[12.5px] leading-relaxed text-ink/90">{transcript.transcript || 'No transcript stored.'}</pre>
                    </>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
