import { useEffect, useState } from 'react';
import { Plus, Trash2, Pencil, Copy, Check } from 'lucide-react';
import { api, getToken } from '../lib/api';

const KINDS = ['Dish', 'Package', 'Policy'];
const EMPTY = { kind: 'Dish', title: '', detail: '', price: '', sort: '0' };

export default function Knowledge() {
  const [list, setList] = useState<any[]>([]);
  const [f, setF] = useState<any>({ ...EMPTY });
  const [editing, setEditing] = useState('');
  const [pack, setPack] = useState('');
  const [copied, setCopied] = useState(false);
  const load = () => api('/api/admin/knowledge').then((r) => r.ok && setList(r.data));
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!f.title.trim()) return;
    const body = JSON.stringify({ ...f, sort: Number(f.sort) || 0 });
    const r = editing
      ? await api(`/api/admin/knowledge/${editing}`, { method: 'PATCH', body })
      : await api('/api/admin/knowledge', { method: 'POST', body });
    if (r.ok) { setF({ ...EMPTY }); setEditing(''); load(); }
  };
  const edit = (k: any) => { setEditing(k.id); setF({ kind: k.kind, title: k.title, detail: k.detail, price: k.price, sort: String(k.sort) }); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const del = async (id: string) => { if (!confirm('Remove this item?')) return; const r = await api(`/api/admin/knowledge/${id}`, { method: 'DELETE' }); if (r.ok) load(); };
  const exportPack = async () => {
    const r = await fetch('/api/admin/knowledge-pack', { headers: { Authorization: `Bearer ${getToken()}` } });
    setPack(await r.text());
  };
  const copy = () => { navigator.clipboard.writeText(pack); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  return (
    <div>
      <h1 className="font-serif text-3xl text-gold2">AI knowledge</h1>
      <p className="mt-1 text-sm text-mut">This is what the receptionist knows: your menu, packages and policies. Edit here, then export the pack and paste it into Vapi — the AI updates in minutes.</p>

      <div className="card mt-5 p-5">
        <p className="text-sm font-bold text-ink">{editing ? 'Edit item' : 'Add an item'}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <select className="inp" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select>
          <input className="inp sm:col-span-2" placeholder="Title — e.g. Monal Special Karahi" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          <input className="inp" placeholder="Price — e.g. Rs 3,200" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
          <input className="inp sm:col-span-4" placeholder="Detail — e.g. chicken or mutton, cooked on order" value={f.detail} onChange={(e) => setF({ ...f, detail: e.target.value })} />
        </div>
        <div className="mt-3 flex gap-2">
          <button className="btn-gold" onClick={save}><Plus size={16} /> {editing ? 'Save changes' : 'Add'}</button>
          {editing && <button className="btn-ghost" onClick={() => { setEditing(''); setF({ ...EMPTY }); }}>Cancel</button>}
        </div>
      </div>

      {KINDS.map((kind) => (
        <div key={kind} className="card mt-5 overflow-hidden">
          <p className="border-b border-gold/10 px-5 py-3 text-[11px] font-bold uppercase tracking-widest text-gold2">{kind === 'Dish' ? 'Menu' : kind === 'Package' ? 'Packages & events' : 'Policies'}</p>
          <table className="w-full">
            <tbody>
              {list.filter((k) => k.kind === kind).map((k) => (
                <tr key={k.id}>
                  <td className="td"><b>{k.title}</b>{k.detail && <div className="text-xs text-mut">{k.detail}</div>}</td>
                  <td className="td w-28 text-gold2">{k.price}</td>
                  <td className="td w-24 text-right">
                    <button onClick={() => edit(k)} className="rounded-full p-1.5 text-mut hover:text-gold2"><Pencil size={14} /></button>
                    <button onClick={() => del(k.id)} className="rounded-full p-1.5 text-mut hover:text-red-300"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <div className="card mt-5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-ink">Export knowledge pack for Vapi</p>
            <p className="text-xs text-mut">Generates the exact text to paste into the Vapi assistant's knowledge.</p>
          </div>
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={exportPack}>Generate</button>
            {pack && <button className="btn-gold" onClick={copy}>{copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copied' : 'Copy'}</button>}
          </div>
        </div>
        {pack && <pre className="mt-4 whitespace-pre-wrap rounded-xl bg-[#0a1310] p-4 text-[12.5px] leading-relaxed text-ink/90">{pack}</pre>}
      </div>
    </div>
  );
}
