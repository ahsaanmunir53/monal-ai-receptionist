import { useEffect, useState } from 'react';
import { PhoneCall, CalendarCheck } from 'lucide-react';
import { api } from '../lib/api';

export default function Overview() {
  const [s, setS] = useState<any>(null);
  const [rs, setRs] = useState<any[]>([]);
  const [calls, setCalls] = useState<any[]>([]);
  useEffect(() => {
    const load = () => {
      api('/api/admin/stats').then((r) => r.ok && setS(r.data));
      api('/api/admin/reservations').then((r) => r.ok && setRs(r.data.slice(0, 5)));
      api('/api/admin/calls').then((r) => r.ok && setCalls(r.data.slice(0, 3)));
    };
    load(); const t = setInterval(load, 8000); return () => clearInterval(t);
  }, []);
  const I = s?.integrations || {};
  const Stat = ({ v, l }: { v: any; l: string }) => (
    <div className="card p-6 text-center">
      <p className="font-serif text-4xl text-gold2">{v ?? '—'}</p>
      <p className="mt-1 text-[11px] uppercase tracking-widest text-mut">{l}</p>
    </div>
  );
  const Dot = ({ on, l }: { on: boolean; l: string }) => (
    <span className={`pill border ${on ? 'border-em2/50 bg-em2/15 text-em2' : 'border-white/10 bg-white/5 text-mut'}`}>{on ? '●' : '○'} {l}</span>
  );
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl text-gold2">The Monal — live desk 🦚</h1>
          <p className="mt-1 text-sm text-mut">Everything your AI receptionist does, as it happens.</p>
        </div>
        <span className="pill flex items-center gap-2 border border-em2/50 bg-em2/15 px-3 py-1.5 text-em2">
          <span className="relative flex h-2.5 w-2.5"><span className="absolute h-full w-full animate-ping rounded-full bg-em2 opacity-60"></span><span className="relative h-2.5 w-2.5 rounded-full bg-em2"></span></span>
          AI RECEPTIONIST ONLINE
        </span>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat v={s?.reservationsToday} l="Reservations today" />
        <Stat v={s?.guestsToday} l="Guests booked today" />
        <Stat v={s?.callsToday} l="Calls handled today" />
        <Stat v={s ? `${s.tablesFree}/${s.tablesTotal}` : null} l="Tables free now" />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <div className="card overflow-hidden">
          <p className="flex items-center gap-2 border-b border-gold/10 px-5 py-3 text-[11px] font-bold uppercase tracking-widest text-gold2"><CalendarCheck size={14} /> Latest bookings</p>
          <div>
            {rs.length === 0 && <p className="px-5 py-6 text-sm text-mut">Waiting for the first booking…</p>}
            {rs.map((r) => (
              <div key={r.id} className="flex items-center justify-between border-b border-white/5 px-5 py-3 last:border-0">
                <div>
                  <p className="text-sm font-semibold">{r.name} <span className="text-mut">· {r.party} guests</span></p>
                  <p className="text-xs text-mut">{r.day} at {r.time}{r.notes ? ` — ${r.notes}` : ''}</p>
                </div>
                <span className={`pill border ${r.source === 'AI call' ? 'border-em2/40 bg-em2/10 text-em2' : 'border-gold/30 bg-gold/10 text-gold2'}`}>{r.source}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card overflow-hidden">
          <p className="flex items-center gap-2 border-b border-gold/10 px-5 py-3 text-[11px] font-bold uppercase tracking-widest text-gold2"><PhoneCall size={14} /> Recent calls</p>
          <div>
            {calls.length === 0 && <p className="px-5 py-6 text-sm text-mut">No calls yet.</p>}
            {calls.map((c) => (
              <div key={c.id} className="border-b border-white/5 px-5 py-3 last:border-0">
                <p className="text-sm font-semibold">{c.caller} <span className="pill ml-1 border border-gold/30 bg-gold/10 text-gold2">{c.outcome || 'Call'}</span></p>
                <p className="mt-0.5 line-clamp-2 text-xs text-mut">{c.summary || '—'}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card mt-5 p-5">
        <p className="text-sm font-bold text-ink">Connections</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Dot on={!!I.vapi} l="Vapi voice AI" />
          <Dot on={!!I.vapiPhone} l="Phone number" />
          <Dot on={!!I.sheets} l="Google Sheet" />
          <Dot on={!!I.whatsapp} l="WhatsApp confirmations" />
        </div>
      </div>
    </div>
  );
}
