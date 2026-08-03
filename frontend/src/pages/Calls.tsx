import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../lib/api';

export default function Calls() {
  const [list, setList] = useState<any[]>([]);
  const [open, setOpen] = useState<any>(null);
  const load = () => api('/api/admin/calls').then((r) => r.ok && setList(r.data));
  useEffect(() => { load(); const t = setInterval(load, 12000); return () => clearInterval(t); }, []);
  const view = async (id: string) => {
    const r = await api(`/api/admin/calls/${id}`);
    if (r.ok) setOpen(r.data);
  };
  const mins = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  return (
    <div>
      <h1 className="font-serif text-3xl text-gold2">Call log</h1>
      <p className="mt-1 text-sm text-mut">Every call the AI handles is logged with its outcome, summary and full transcript.</p>
      <div className="card mt-5 overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead><tr><th className="th">When</th><th className="th">Caller</th><th className="th">Duration</th><th className="th">Outcome</th><th className="th">Summary</th><th className="th"></th></tr></thead>
          <tbody>
            {list.length === 0 && <tr><td className="td text-mut" colSpan={6}>No calls yet — once the Vapi number is live, every call lands here automatically.</td></tr>}
            {list.map((c) => (
              <tr key={c.id}>
                <td className="td whitespace-nowrap">{new Date(c.createdAt).toLocaleString()}</td>
                <td className="td">{c.caller}</td>
                <td className="td">{mins(c.durationSec)}</td>
                <td className="td"><span className="pill border border-gold/30 bg-gold/10 text-gold2">{c.outcome || '—'}</span></td>
                <td className="td max-w-[280px] truncate" title={c.summary}>{c.summary || '—'}</td>
                <td className="td"><button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => view(c.id)}>Transcript</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setOpen(null)}>
          <div className="card max-h-[80vh] w-full max-w-xl overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div><p className="font-serif text-xl text-gold2">Call transcript</p><p className="text-xs text-mut">{open.caller} · {new Date(open.createdAt).toLocaleString()}</p></div>
              <button onClick={() => setOpen(null)} className="rounded-full p-1.5 text-mut hover:bg-white/10"><X size={18} /></button>
            </div>
            {open.summary && <p className="mt-3 rounded-xl border border-gold/15 bg-gold/5 p-3 text-sm text-ink">{open.summary}</p>}
            <pre className="mt-4 whitespace-pre-wrap rounded-xl bg-[#0a1310] p-4 text-[13px] leading-relaxed text-ink/90">{open.transcript || 'No transcript stored for this call.'}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
