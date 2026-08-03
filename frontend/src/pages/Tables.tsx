import { useEffect, useState } from 'react';
import { Armchair, X } from 'lucide-react';
import { api } from '../lib/api';

const AREAS = ['Indoor', 'Outdoor', 'Hall'];

export default function Tables() {
  const [tables, setTables] = useState<any[]>([]);
  const [resv, setResv] = useState<any[]>([]);
  const [seat, setSeat] = useState<any>(null);

  const load = () => {
    api('/api/admin/tables').then((r) => r.ok && setTables(r.data));
    api('/api/admin/reservations').then((r) => r.ok && setResv(r.data.filter((x: any) => x.status === 'Confirmed')));
  };
  useEffect(() => { load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, []);

  const free = async (id: string) => { const r = await api(`/api/admin/tables/${id}/free`, { method: 'POST' }); if (r.ok) load(); };
  const doSeat = async (tableId: string, reservationId: string) => {
    const r = await api(`/api/admin/tables/${tableId}/seat`, { method: 'POST', body: JSON.stringify({ reservationId }) });
    if (r.ok) { setSeat(null); load(); }
  };

  const freeCount = tables.filter((t) => t.status === 'Free').length;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl text-gold2">Floor plan</h1>
          <p className="mt-1 text-sm text-mut">Every AI booking is seated automatically. Tap a table to free it or seat a guest.</p>
        </div>
        <p className="text-sm"><b className="font-serif text-2xl text-em2">{freeCount}</b> <span className="text-mut">of {tables.length} tables free</span></p>
      </div>

      {AREAS.map((area) => {
        const rows = tables.filter((t) => t.area === area);
        if (!rows.length) return null;
        return (
          <div key={area} className="mt-6">
            <p className="text-[11px] font-bold uppercase tracking-widest text-gold2">{area}</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {rows.map((t) => {
                const busy = t.status === 'Reserved';
                return (
                  <div key={t.id}
                    className={`rounded-2xl border p-4 transition ${busy ? 'border-gold/50 bg-gold/10' : 'border-em2/30 bg-em2/5'}`}>
                    <div className="flex items-center justify-between">
                      <p className="font-serif text-xl text-ink">{t.label}</p>
                      <span className={`pill border ${busy ? 'border-gold/50 bg-gold/15 text-gold2' : 'border-em2/50 bg-em2/15 text-em2'}`}>
                        {busy ? 'Reserved' : 'Free'}
                      </span>
                    </div>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-mut"><Armchair size={13} /> Seats {t.capacity}</p>
                    {busy ? (
                      <>
                        <p className="mt-2 text-sm font-semibold text-gold2">{t.guest}</p>
                        <p className="text-xs text-mut">{t.time}</p>
                        <button onClick={() => free(t.id)} className="btn-ghost mt-3 w-full justify-center py-1.5 text-xs">Free this table</button>
                      </>
                    ) : (
                      <button onClick={() => setSeat(t)} className="btn-ghost mt-3 w-full justify-center py-1.5 text-xs">Seat a guest</button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {seat && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setSeat(null)}>
          <div className="card max-h-[75vh] w-full max-w-md overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <p className="font-serif text-xl text-gold2">Seat a guest at {seat.label}</p>
                <p className="text-xs text-mut">{seat.area} · seats {seat.capacity}</p>
              </div>
              <button onClick={() => setSeat(null)} className="rounded-full p-1.5 text-mut hover:bg-white/10"><X size={18} /></button>
            </div>
            <div className="mt-4 grid gap-2">
              {resv.length === 0 && <p className="text-sm text-mut">No confirmed reservations waiting.</p>}
              {resv.map((r) => (
                <button key={r.id} onClick={() => doSeat(seat.id, r.id)}
                  className="rounded-xl border border-gold/15 px-4 py-3 text-left hover:border-gold hover:bg-gold/5">
                  <p className="text-sm font-semibold">{r.name} <span className="text-mut">· {r.party} guests</span></p>
                  <p className="text-xs text-mut">{r.day} {r.time} · {r.type}{r.notes ? ` · ${r.notes}` : ''}</p>
                  {r.party > seat.capacity && <p className="mt-1 text-[11px] font-semibold text-red-400">⚠ Party larger than this table ({seat.capacity} seats)</p>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
