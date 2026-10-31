import { useCallback, useEffect, useRef, useState } from 'react'
import { api, CREDIT_CATS, DEBIT_CATS, today } from './api'
import { supabase } from './supabase'
import Login from './Login'
import PinLock, { clearPin, hasPin } from './PinLock'
import TxnForm from './TxnForm'
import Dashboard, { Empty } from './Dashboard'
import Insights from './Insights'
import Transactions from './Transactions'
import Plan from './Plan'
import Friends from './Friends'

const ALLOWED = (import.meta.env.VITE_ALLOWED_EMAIL || '').toLowerCase()
const TABS = [['dash', '📊', 'Dashboard'], ['txn', '🧾', 'Entries'], ['ins', '💡', 'Insights'], ['fr', '🤝', 'Friends'], ['plan', '🎯', 'Plan']]

export default function App() {
  const [session, setSession] = useState(undefined)
  const [locked, setLocked] = useState(true)
  const [pinSetup, setPinSetup] = useState(false)
  const [tab, setTab] = useState('dash')
  const [month, setMonth] = useState('')
  const [d, setD] = useState(null)
  const [synced, setSynced] = useState('')
  const [form, setForm] = useState(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const monthRef = useRef('')
  monthRef.current = month

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

  // pull the latest data whenever you come back to the app (keeps phone and laptop in sync)
  useEffect(() => {
    const h = () => { if (!document.hidden && session && !locked && !loading) load(monthRef.current || undefined) }
    document.addEventListener('visibilitychange', h)
    return () => document.removeEventListener('visibilitychange', h)
  })

  const email = session?.user?.email?.toLowerCase()
  const denied = session && ALLOWED && email !== ALLOWED

  const load = useCallback(async (m) => {
    setLoading(true); setErr('')
    try {
      const data = await api.boot(m)
      setD(data); if (data.analytics.month) setMonth(data.analytics.month)
      setSynced(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }))
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

  const a = d?.analytics
  const months = a?.months?.length ? [...a.months].reverse() : []
  const custom = (t) => (d?.categories || []).filter((c) => c.type === t).map((c) => c.name)
  const used = (t) => (d?.transactions || []).filter((r) => r.type === t).map((r) => r.category)
  const cats = {
    debit: [...new Set([...DEBIT_CATS.slice(0, -1), ...custom('debit'), ...used('debit'), 'Other'])],
    credit: [...new Set([...CREDIT_CATS.slice(0, -1), ...custom('credit'), ...used('credit'), 'Other'])],
  }
  const friendNames = (d?.friends || []).map((f) => f.name)
  const owed = (d?.friends || []).filter((f) => f.balance > 0).reduce((t, f) => t + f.balance, 0)
  const newCat = async (type, name) => { await api.addCat(type, name); await load(month || undefined) }
  const saved = () => { setForm(null); load(month || undefined) }
  const changeMonth = (m) => { setMonth(m); load(m) }

  return (
    <div className="app">
      <header>
        <h1>💰 DK Money</h1>
        <div className="hright">
          {months.length > 0 && <select value={month} onChange={(e) => changeMonth(e.target.value)}>{months.map((m) => <option key={m} value={m}>{new Date(m + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</option>)}</select>}
          {hasPin() && <button className="link" title="Lock" onClick={() => setLocked(true)}>🔒</button>}
          <button className="link" title={synced ? 'Last synced ' + synced : ''} onClick={() => load(month || undefined)}>{loading ? '…' : '⟳'}</button>
          <button className="link" onClick={signOut}>Sign out</button>
        </div>
      </header>
      <nav>{TABS.map(([k, ic, t]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}><span>{ic}</span>{t}</button>)}</nav>
      <main>
        {err && <div className="card err">{err.includes('fetch') ? 'Cannot reach the server. It may be waking up (free plan), try again in a minute.' : err}</div>}
        {loading && !d && <p className="muted pad">Loading… the free server can take ~30 seconds to wake up.</p>}
        {a?.empty && tab !== 'plan' && tab !== 'fr' && <div className="card"><Empty text="No entries yet. Tap + to add your first one." /></div>}
        {a && !a.empty && tab === 'dash' && <Dashboard a={a} owed={owed} />}
        {a && !a.empty && tab === 'ins' && <Insights a={a} />}
        {a && !a.empty && tab === 'txn' && <Transactions rows={d.transactions} month={month} onEdit={setForm} onRepeat={(r) => setForm({ ...r, id: undefined, date: today() })} onChanged={saved} />}
        {d && tab === 'fr' && <Friends friends={d.friends} onChanged={() => load(month || undefined)} />}
        {d && tab === 'plan' && <Plan d={d} cats={cats} onChanged={() => load(month || undefined)} />}
        {synced && <p className="muted center-t small">Synced at {synced} · same data on all your devices</p>}
      </main>
      <button className="fab" onClick={() => setForm({})} aria-label="Add entry">+</button>
      {form && <TxnForm initial={form.amount ? form : null} cats={cats} friends={friendNames} onNewCat={newCat} onClose={() => setForm(null)} onSaved={saved} />}
    </div>
  )
}
