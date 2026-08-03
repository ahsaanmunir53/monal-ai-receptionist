import { useState, useRef } from 'react';
import { PhoneOutgoing, Sparkles, Check, Stethoscope, ShieldCheck, Mic, MicOff } from 'lucide-react';
import Vapi from '@vapi-ai/web';
import { api } from '../lib/api';


export default function TestCall() {
  const [profile, setProfile] = useState<'pakistani' | 'urdu' | 'english'>('pakistani');
  const [ears, setEars] = useState<'urdu' | 'english' | 'auto'>('urdu');
  const [voice, setVoice] = useState<'jenny' | 'neha' | '11labs'>('jenny');
  const [syncing, setSyncing] = useState(false);
  const [sync, setSync] = useState<any>(null);
  const [num, setNum] = useState('+92');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [diag, setDiag] = useState<any>(null);
  const [diagBusy, setDiagBusy] = useState(false);
  const [vfy, setVfy] = useState<any>(null);
  const [vfyBusy, setVfyBusy] = useState(false);
  const [web, setWeb] = useState<{ live: boolean; err: string; msgs: { who: string; text: string }[] }>({ live: false, err: '', msgs: [] });
  const vapiRef = useRef<any>(null);

  const doSync = async () => {
    setSyncing(true); setSync(null);
    const r = await api('/api/admin/vapi/sync', { method: 'POST', body: JSON.stringify({ profile, ears, voice }) });
    setSyncing(false);
    setSync(r.ok ? r.data : { error: r.data.error || 'Sync failed', tried: r.data.tried });
  };
  const ring = async () => {
    setBusy(true); setMsg(null);
    const r = await api('/api/admin/test-call', { method: 'POST', body: JSON.stringify({ number: num }) });
    setBusy(false);
    setMsg(r.ok ? { ok: true, text: '📞 Calling now — answer and talk to the receptionist!' } : { ok: false, text: r.data.error || 'Call failed.' });
  };
  const verify = async () => {
    setVfyBusy(true); setVfy(null);
    const r = await api('/api/admin/vapi/verify');
    setVfyBusy(false);
    setVfy(r.ok ? r.data : { error: r.data.error || 'Could not read the assistant' });
  };

  const startWebCall = async () => {
    setWeb({ live: false, err: '', msgs: [] });
    const k = await api('/api/admin/vapi/web-key');
    if (!k.ok || !k.data.publicKey) {
      return setWeb({ live: false, err: 'Add VAPI_PUBLIC_KEY to backend/.env (Vapi → Organization → API Keys → Public key), then restart.', msgs: [] });
    }
    try {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        return setWeb({ live: false, err: 'Microphone blocked. Allow mic access in the browser (padlock icon in the address bar) and try again. Note: mic only works on localhost or https.', msgs: [] });
      }
      const v = new Vapi(k.data.publicKey);
      vapiRef.current = v;
      v.on('call-start', () => setWeb((w) => ({ ...w, live: true, err: '' })));
      v.on('call-end', () => setWeb((w) => ({ ...w, live: false })));
      v.on('error', (e: any) => setWeb((w) => ({ ...w, live: false, err: String(e?.message || e) })));
      v.on('message', (m: any) => {
        if (m?.type === 'transcript' && m.transcriptType === 'final') {
          setWeb((w) => ({ ...w, msgs: [...w.msgs, { who: m.role === 'assistant' ? 'AI' : 'YOU', text: m.transcript }] }));
        }
      });
      await v.start(k.data.assistantId);
    } catch (e: any) {
      setWeb({ live: false, err: String(e?.message || e), msgs: [] });
    }
  };
  const stopWebCall = () => { try { vapiRef.current?.stop(); } catch { /* ignore */ } setWeb((w) => ({ ...w, live: false })); };

  const diagnose = async () => {
    setDiagBusy(true); setDiag(null);
    const r = await api('/api/admin/vapi/diagnose');
    setDiagBusy(false);
    setDiag(r.ok ? r.data : { error: r.data.error || 'Could not read calls' });
  };

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-serif text-3xl text-gold2">Ring a phone</h1>
      <p className="mt-1 text-sm text-mut">Configure the receptionist, call any phone, and inspect exactly what the AI heard.</p>

      <div className="card mt-6 p-6">
        <p className="flex items-center gap-2 text-sm font-bold text-ink"><Sparkles size={16} className="text-gold2" /> Step 1 — Configure the receptionist</p>
        <div className="mt-4 grid gap-3">
          {[
            { id: 'pakistani', title: '🇵🇰 Pakistani — Urdu + English', tag: 'RECOMMENDED',
              desc: 'South-Asian voice speaking Roman Urdu ("Ji bilkul! Kitne afraad hain?") and English. Understands both, mixes naturally. This is the reliable one.' },
            { id: 'urdu', title: '📜 Pure Urdu script voice (Uzma)', tag: '',
              desc: 'Authentic Azure Urdu voice. She replies in Urdu script ONLY — even to English callers. Use only if you want 100% Urdu.' },
            { id: 'english', title: '🇬🇧 English only', tag: '',
              desc: 'Clean English replies for English-speaking callers.' },
          ].map((p) => (
            <button key={p.id} onClick={() => setProfile(p.id as any)}
              className={`rounded-2xl border p-4 text-left transition ${profile === p.id ? 'border-gold bg-gold/10' : 'border-gold/15 hover:border-gold/40'}`}>
              <p className="text-sm font-bold text-gold2">{p.title}
                {p.tag && <span className="pill ml-1 border border-em2/40 bg-em2/15 text-[9px] text-em2">{p.tag}</span>}</p>
              <p className="mt-1 text-xs text-mut">{p.desc}</p>
            </button>
          ))}
        </div>

        <div className="mt-5">
          <p className="text-[11px] uppercase tracking-widest text-mut">What the AI listens for (the “ears”)</p>
          <p className="mt-1 text-xs text-mut">Now using Deepgram — unlike Whisper it never invents words when the line is bad.</p>
          <div className="mt-2 grid gap-2">
            {[
              { id: 'urdu', label: 'Urdu + English callers', hint: 'Best for Pakistani callers mixing both. Start here.' },
              { id: 'english', label: 'English callers only', hint: 'Most accurate if the caller speaks pure English.' },
              { id: 'auto', label: 'Auto-detect', hint: 'Multilingual model — flexible, slightly less accurate.' },
            ].map((e) => (
              <label key={e.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-2.5 text-sm ${ears === e.id ? 'border-gold bg-gold/10 text-gold2' : 'border-gold/15 text-mut'}`}>
                <input type="radio" className="mt-1 accent-[#d4a94b]" checked={ears === e.id} onChange={() => setEars(e.id as any)} />
                <span><b>{e.label}</b><br /><span className="text-xs opacity-80">{e.hint}</span></span>
              </label>
            ))}
          </div>
        </div>

        <div className="mt-5">
          <p className="text-[11px] uppercase tracking-widest text-mut">Voice</p>
          <div className="mt-2 grid gap-2">
            {[
              { id: 'jenny', label: 'Azure Jenny — most stable', hint: 'Never screeches. Speaks Roman Urdu clearly. Start here.' },
              { id: 'neha', label: 'Vapi Neha — South Asian accent', hint: 'More Pakistani-sounding, but can distort on some lines.' },
              { id: '11labs', label: 'ElevenLabs Sarah — most human', hint: 'Warmest voice. Uses ElevenLabs credits.' },
            ].map((v) => (
              <label key={v.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-2.5 text-sm ${voice === v.id ? 'border-gold bg-gold/10 text-gold2' : 'border-gold/15 text-mut'}`}>
                <input type="radio" className="mt-1 accent-[#d4a94b]" checked={voice === v.id} onChange={() => setVoice(v.id as any)} />
                <span><b>{v.label}</b><br /><span className="text-xs opacity-80">{v.hint}</span></span>
              </label>
            ))}
          </div>
        </div>

        <button onClick={doSync} disabled={syncing} className="btn-gold mt-4 w-full justify-center disabled:opacity-50">{syncing ? 'Configuring…' : '⚡ Configure assistant now'}</button>
        {sync?.error && (
          <div className="mt-3 rounded-xl border border-red-400/40 bg-red-400/10 p-3">
            <p className="text-sm font-semibold text-red-300">{sync.error}</p>
            {sync.tried?.map((t: string) => <p key={t} className="mt-1 text-[11px] text-red-200/70">• {t}</p>)}
          </div>
        )}
        {sync?.ok && (
          <div className="mt-4 grid gap-1.5 rounded-xl border border-em2/30 bg-em2/10 p-4 text-sm">
            {sync.liveNumber && <p className="mb-1 text-base font-bold text-gold2">📞 Your AI line: {sync.liveNumber}</p>}
            <p className="mb-1 text-xs text-ink/80">{sync.mode}</p>
            {[['Engine', sync.applied.engine], ['Voice', sync.applied.voice], ['Greeting', sync.applied.greeting], ['Understands', sync.applied.language], ['Booking', sync.applied.booking]]
              .filter(([, v]) => v).map(([k, v]) => (
                <p key={k as string} className="flex items-start gap-2 text-ink/90"><Check size={15} className="mt-0.5 shrink-0 text-em2" /><span><b>{k}:</b> {v}</span></p>
              ))}
            {sync.applied.earsWarning && <p className="mt-2 rounded-lg border border-gold/40 bg-gold/10 p-2.5 text-xs font-semibold text-gold2">{sync.applied.earsWarning}</p>}
            {sync.live && (
              <div className="mt-3 rounded-lg border border-gold/25 bg-black/25 p-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gold2">Read back live from Vapi — this is what will actually speak</p>
                <p className="mt-1.5 text-xs text-ink/90"><b>Voice:</b> {sync.live.voice}</p>
                <p className="text-xs text-ink/90"><b>Ears:</b> {sync.live.ears} · <b>Brain:</b> {sync.live.brain}</p>
                <p className="text-xs text-ink/90"><b>It will say:</b> “{sync.live.greeting}”</p>
                <p className={`mt-1 text-xs font-semibold ${sync.live.hasRealMenu ? 'text-em2' : 'text-red-400'}`}>{sync.live.hasRealMenu ? '✅' : '❌'} real menu · {sync.live.promptChars?.toLocaleString()} chars</p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card mt-5 p-6 text-center">
        <p className="text-sm font-bold text-ink">Step 2 — Call a phone</p>
        <div className="mx-auto mt-3 grid h-14 w-14 place-items-center rounded-full border border-gold bg-gradient-to-br from-em2 to-em text-xl">🦚</div>
        <input className="inp mt-3 text-center text-lg tracking-wider" value={num} onChange={(e) => setNum(e.target.value)} placeholder="+9230xxxxxxxx" />
        <button onClick={ring} disabled={busy} className="btn-gold mt-4 w-full justify-center disabled:opacity-50"><PhoneOutgoing size={17} /> {busy ? 'Dialing…' : 'Call this number now'}</button>
        {msg && <p className={`mt-4 text-sm font-semibold ${msg.ok ? 'text-em2' : 'text-red-400'}`}>{msg.text}</p>}
      </div>

      {/* VERIFY what is really installed */}
      <div className="card mt-5 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-sm font-bold text-ink"><ShieldCheck size={16} className="text-gold2" /> Verify — what is actually live on Vapi right now?</p>
            <p className="mt-1 text-xs text-mut">Reads the assistant back from Vapi. If Configure didn't take effect, this shows it instantly.</p>
          </div>
          <button onClick={verify} disabled={vfyBusy} className="btn-ghost disabled:opacity-50">{vfyBusy ? 'Checking…' : 'Verify installed config'}</button>
        </div>
        {vfy?.error && <p className="mt-3 text-sm font-semibold text-red-400">{vfy.error}</p>}
        {vfy && !vfy.error && (
          <div className="mt-4 grid gap-1.5 text-sm">
            {[['Brain', vfy.model], ['Ears', vfy.transcriber], ['Voice', vfy.voice], ['Prompt size', `${vfy.promptChars.toLocaleString()} characters`]].map(([k, v]) => (
              <p key={k as string} className="text-ink/90"><b className="text-gold2">{k}:</b> {v}</p>
            ))}
            <p className="mt-1 text-xs text-mut">First message: “{vfy.firstMessage}”</p>
            <div className="mt-2 grid gap-1">
              {[['Sana identity', vfy.hasSana], ['Real menu (Cheese Naan)', vfy.hasRealMenu], ['All 4 branches', vfy.hasBranches], ['Delivery & orders', vfy.hasDelivery], ['Bad-line handling', vfy.hasBadLineRule]].map(([k, ok]) => (
                <p key={k as string} className={`text-xs font-semibold ${ok ? 'text-em2' : 'text-red-400'}`}>{ok ? '✅' : '❌'} {k}{!ok && ' — press ⚡ Configure again'}</p>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* BROWSER CALL — clean audio, proves phone-line vs config */}
      <div className="card mt-5 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-sm font-bold text-ink"><Mic size={16} className="text-gold2" /> Talk in the browser (clean audio — no phone line)</p>
            <p className="mt-1 text-xs text-mut">Same receptionist, through your laptop mic. If she understands you perfectly here but not on the phone, the phone line's audio is the problem — not the AI. Also makes a great demo.</p>
          </div>
          {!web.live
            ? <button onClick={startWebCall} className="btn-gold"><Mic size={16} /> Start talking</button>
            : <button onClick={stopWebCall} className="btn-ghost"><MicOff size={16} /> End call</button>}
        </div>
        {web.err && <p className="mt-3 text-sm font-semibold text-red-400">{web.err}</p>}
        {web.live && <p className="mt-3 text-sm font-semibold text-em2">🎙️ Live — speak now (Urdu or English).</p>}
        {web.msgs.length > 0 && (
          <div className="mt-3 grid max-h-72 gap-1.5 overflow-y-auto">
            {web.msgs.map((m, i) => (
              <p key={i} className={`rounded-lg px-3 py-2 text-[13px] ${m.who === 'AI' ? 'bg-em2/10 text-ink/90' : 'bg-gold/10 text-gold2'}`}>
                <b className="text-[10px] uppercase tracking-widest opacity-70">{m.who}</b><br />{m.text}
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="card mt-5 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-sm font-bold text-ink"><Stethoscope size={16} className="text-gold2" /> Step 3 — What did the AI actually hear?</p>
            <p className="mt-1 text-xs text-mut">Pulls your real call transcripts from Vapi. If a call went wrong, this shows precisely why.</p>
          </div>
          <button onClick={diagnose} disabled={diagBusy} className="btn-ghost disabled:opacity-50">{diagBusy ? 'Reading…' : 'Inspect my last calls'}</button>
        </div>
        {diag?.error && <p className="mt-3 text-sm font-semibold text-red-400">{diag.error}</p>}
        {diag?.calls?.length === 0 && <p className="mt-3 text-sm text-mut">No calls found yet — make one first.</p>}
        {diag?.calls?.map((c: any) => (
          <div key={c.id} className="mt-4 rounded-xl border border-gold/15 bg-[#0a1310] p-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-mut">
              <span className="pill border border-gold/30 bg-gold/10 text-gold2">{c.status}</span>
              <span>{c.durationSec}s</span>
              {c.endedReason && <span>· ended: {c.endedReason}</span>}
              <span>· {new Date(c.when).toLocaleString()}</span>
            </div>
            {c.summary && <p className="mt-2 rounded-lg border border-em2/25 bg-em2/10 p-2.5 text-xs text-ink/90">{c.summary}</p>}
            <div className="mt-3 grid gap-1.5">
              {c.turns.length === 0 && <p className="text-xs italic text-mut">No transcript stored — usually means the call never carried audio.</p>}
              {c.turns.map((t: any, i: number) => (
                <p key={i} className={`rounded-lg px-3 py-2 text-[13px] ${t.who === 'AI' ? 'bg-em2/10 text-ink/90' : 'bg-gold/10 text-gold2'}`}>
                  <b className="text-[10px] uppercase tracking-widest opacity-70">{t.who}</b><br />{t.text}
                </p>
              ))}
            </div>
            {c.structuredData && <pre className="mt-3 overflow-x-auto rounded-lg bg-black/30 p-3 text-[11px] text-mut">{JSON.stringify(c.structuredData, null, 2)}</pre>}
          </div>
        ))}
      </div>
    </div>
  );
}
