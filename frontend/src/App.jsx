import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import { supabase } from './supabase'
import Login from './Login'
import PinLock, { clearPin, hasPin } from './PinLock'
import TxnForm from './TxnForm'
import Dashboard, { Empty } from './Dashboard'
import Insights from './Insights'
import Transactions from './Transactions'

const ALLOWED = (import.meta.env.VITE_ALLOWED_EMAIL || '').toLowerCase()
const TABS = [['dash', '📊', 'Dashboard'], ['txn', '🧾', 'Entries'], ['ins', '💡', 'Insights']]

export default function App() {
  const [session, setSession] = useState(undefined)
  const [locked, setLocked] = useState(true)
  const [pinSetup, setPinSetup] = useState(false)
  const [tab, setTab] = useState('dash')
  const [month, setMonth] = useState('')
  const [a, setA] = useState(null)
  const [rows, setRows] = useState([])
  const [form, setForm] = useState(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  // auto-lock after 1 minute in background
  useEffect(() => {
    let t
    const h = () => { if (document.hidden) t = setTimeout(() => hasPin() && setLocked(true), 60000); else clearTimeout(t) }
    document.addEventListener('visibilitychange', h)
    return () => document.removeEventListener('visibilitychange', h)
  }, [])

  const email = session?.user?.email?.toLowerCase()
  const denied = session && ALLOWED && email !== ALLOWED

  const load = useCallback(async (m) => {
    setLoading(true); setErr('')
    try {
      const [an, list] = await Promise.all([api.analytics(m), api.list()])
      setA(an); setRows(list); if (an.month) setMonth(an.month)
    } catch (e) { setErr(e.message) }
    setLoading(false)
  }, [])

  useEffect(() => { if (session && !denied && !locked) { api.wake(); load(month || undefined) } }, [session, denied, locked]) // eslint-disable-line

  async function signOut() { clearPin(); setLocked(true); await supabase.auth.signOut() }

  if (session === undefined) return <div className="center muted">Loading…</div>
  if (!session) return <Login />
  if (denied) return <div className="center"><div className="card login"><h2>Access denied</h2><p className="muted">{email} is not allowed.</p><button className="btn" onClick={signOut}>Sign out</button></div></div>
  if (locked) {
    if (!hasPin() && !pinSetup) return <PinLock mode="set" onDone={() => setLocked(false)} onSkip={() => { setPinSetup(true); setLocked(false) }} />
    if (hasPin()) return <PinLock mode="enter" onDone={() => setLocked(false)} onSignOut={signOut} />
  }

  const months = a?.months?.length ? [...a.months].reverse() : []
  const saved = () => { setForm(null); load(month || undefined) }
  const changeMonth = (m) => { setMonth(m); load(m) }

  return (
    <div className="app">
      <header>
        <h1>💰 DK Money</h1>
        <div className="hright">
          {months.length > 0 && <select value={month} onChange={(e) => changeMonth(e.target.value)}>{months.map((m) => <option key={m} value={m}>{new Date(m + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</option>)}</select>}
          {hasPin() && <button className="link" title="Lock" onClick={() => setLocked(true)}>🔒</button>}
          <button className="link" onClick={signOut}>Sign out</button>
        </div>
      </header>
      <nav>{TABS.map(([k, ic, t]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}><span>{ic}</span>{t}</button>)}</nav>
      <main>
        {err && <div className="card err">{err.includes('fetch') ? 'Cannot reach the server. It may be waking up (free plan), try again in a minute.' : err}</div>}
        {loading && !a && <p className="muted pad">Loading… the free server can take ~30 seconds to wake up.</p>}
        {a?.empty && <div className="card"><Empty text="No entries yet. Tap + to add your first one." /></div>}
        {a && !a.empty && tab === 'dash' && <Dashboard a={a} />}
        {a && !a.empty && tab === 'ins' && <Insights a={a} />}
        {a && !a.empty && tab === 'txn' && <Transactions rows={rows} month={month} onEdit={setForm} onChanged={saved} />}
      </main>
      <button className="fab" onClick={() => setForm({})} aria-label="Add entry">+</button>
      {form && <TxnForm initial={form.id ? form : null} onClose={() => setForm(null)} onSaved={saved} />}
    </div>
  )
}
