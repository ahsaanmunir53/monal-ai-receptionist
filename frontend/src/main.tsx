import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import { LayoutDashboard, CalendarCheck, Armchair, PhoneCall, BookOpen, Settings as Cog, PhoneOutgoing, LogOut } from 'lucide-react';
import './index.css';
import { api, setToken, getToken, logout } from './lib/api';
import Overview from './pages/Overview';
import Reservations from './pages/Reservations';
import Calls from './pages/Calls';
import Knowledge from './pages/Knowledge';
import SettingsPage from './pages/Settings';
import Tables from './pages/Tables';
import TestCall from './pages/TestCall';

function Login() {
  const nav = useNavigate();
  const [u, setU] = useState('admin');
  const [p, setP] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setErr('');
    const r = await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ username: u, password: p }) });
    setBusy(false);
    if (!r.ok) return setErr(r.data.error || 'Login failed');
    setToken(r.data.token); nav('/app');
  };
  return (
    <div className="grid min-h-screen place-items-center px-4"
      style={{ background: 'radial-gradient(900px 500px at 80% -10%, rgba(42,157,117,.22), transparent 60%), radial-gradient(700px 400px at -10% 110%, rgba(212,169,75,.14), transparent 55%), #0b1512' }}>
      <div className="card w-full max-w-sm p-8">
        <div className="mb-6 text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full border-2 border-gold bg-gradient-to-br from-em2 to-em text-3xl shadow-[0_0_30px_rgba(212,169,75,.3)]">🦚</div>
          <h1 className="mt-4 font-serif text-2xl text-gold2">The Monal</h1>
          <p className="text-xs uppercase tracking-[0.2em] text-mut">AI Receptionist Dashboard</p>
        </div>
        <div className="grid gap-3">
          <input className="inp" placeholder="Username" value={u} onChange={(e) => setU(e.target.value)} />
          <input className="inp" type="password" placeholder="Password" value={p} onChange={(e) => setP(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
          {err && <p className="text-sm font-semibold text-red-400">{err}</p>}
          <button onClick={go} disabled={busy} className="btn-gold justify-center disabled:opacity-50">{busy ? 'Signing in…' : 'Sign in'}</button>
        </div>
      </div>
    </div>
  );
}

const NAV = [
  { to: '/app', end: true, label: 'Overview', icon: LayoutDashboard },
  { to: '/app/reservations', label: 'Reservations', icon: CalendarCheck },
  { to: '/app/tables', label: 'Floor plan', icon: Armchair },
  { to: '/app/calls', label: 'Call log', icon: PhoneCall },
  { to: '/app/knowledge', label: 'AI knowledge', icon: BookOpen },
  { to: '/app/test-call', label: 'Ring a phone', icon: PhoneOutgoing },
  { to: '/app/settings', label: 'Settings', icon: Cog },
];

function Shell({ children }: { children: React.ReactNode }) {
  if (!getToken()) return <Navigate to="/" replace />;
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-gold/10 bg-[#0a1310] p-4 md:flex">
        <div className="mb-8 flex items-center gap-3 px-2 pt-2">
          <span className="grid h-10 w-10 place-items-center rounded-full border border-gold bg-gradient-to-br from-em2 to-em text-lg">🦚</span>
          <div>
            <p className="font-serif text-lg leading-tight text-gold2">The Monal</p>
            <p className="text-[10px] uppercase tracking-widest text-mut">AI Receptionist</p>
          </div>
        </div>
        <nav className="grid gap-1">
          {NAV.map(({ to, end, label, icon: Ic }) => (
            <NavLink key={to} to={to} end={end as any}
              className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${isActive ? 'bg-gold/15 text-gold2' : 'text-mut hover:bg-white/5 hover:text-ink'}`}>
              <Ic className="h-4.5 w-4.5" size={18} /> {label}
            </NavLink>
          ))}
        </nav>
        <button onClick={logout} className="mt-auto flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-mut hover:bg-white/5 hover:text-ink">
          <LogOut size={18} /> Sign out
        </button>
      </aside>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between border-b border-gold/10 bg-[#0a1310]/70 px-5 py-3 backdrop-blur md:hidden">
          <span className="font-serif text-gold2">🦚 The Monal</span>
          <button onClick={logout} className="text-xs font-bold text-mut">Sign out</button>
        </div>
        <div className="mx-auto max-w-6xl p-5 md:p-8">{children}</div>
        <div className="flex flex-wrap gap-2 border-t border-gold/10 px-5 py-3 md:hidden">
          {NAV.map(({ to, label }) => (
            <NavLink key={to} to={to} className={({ isActive }) => `rounded-full border px-3 py-1.5 text-[11px] font-bold ${isActive ? 'border-gold text-gold2' : 'border-gold/20 text-mut'}`}>{label}</NavLink>
          ))}
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/app" element={<Shell><Overview /></Shell>} />
        <Route path="/app/reservations" element={<Shell><Reservations /></Shell>} />
        <Route path="/app/tables" element={<Shell><Tables /></Shell>} />
        <Route path="/app/calls" element={<Shell><Calls /></Shell>} />
        <Route path="/app/knowledge" element={<Shell><Knowledge /></Shell>} />
        <Route path="/app/test-call" element={<Shell><TestCall /></Shell>} />
        <Route path="/app/settings" element={<Shell><SettingsPage /></Shell>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
