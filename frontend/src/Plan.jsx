import { useState } from 'react'
import { api, catName, inr, MODES, TOTAL } from './api'
import { BudgetBars } from './Dashboard'

export default function Plan({ d, cats, onChanged }) {
  const run = async (fn) => { try { await fn(); onChanged() } catch (e) { alert(e.message) } }
  const progress = (c) => d.analytics.budgets?.find((b) => b.category === c.category) || { ...c, limit: c.amount, spent: 0, pct: 0, status: 'ok' }
  const buds = d.budgets.map(progress).sort((a, b) => (a.category === TOTAL ? -1 : b.category === TOTAL ? 1 : b.pct - a.pct))
  const custom = d.categories

  return (
    <>
      <Budgets buds={buds} cats={cats.debit} run={run} />
      <Goals goals={d.goals} run={run} />
      <Recurring list={d.recurring} cats={cats} run={run} />
      <Categories custom={custom} run={run} />
    </>
  )
}

function Budgets({ buds, cats, run }) {
  const [cat, setCat] = useState(TOTAL)
  const [amt, setAmt] = useState('')
  return (
    <div className="card">
      <h3>🎯 Monthly budgets</h3>
      <form className="inline" onSubmit={(e) => { e.preventDefault(); run(() => api.setBudget(cat, Number(amt))).then(() => setAmt('')) }}>
        <select value={cat} onChange={(e) => setCat(e.target.value)}><option value={TOTAL}>{catName(TOTAL)}</option>{cats.map((c) => <option key={c}>{c}</option>)}</select>
        <input type="number" min="1" required placeholder="₹ limit" value={amt} onChange={(e) => setAmt(e.target.value)} />
        <button className="btn">Set</button>
      </form>
      {buds.length ? <><BudgetBars list={buds} /><div className="chips">{buds.map((b) => <button key={b.category} className="chip" onClick={() => run(() => api.setBudget(b.category, 0))}>✕ {catName(b.category).replace(' (all spending)', '')}</button>)}</div></> : <p className="muted">Set a limit and you will get a warning at 80% and when it is crossed. Setting an existing category again updates it.</p>}
    </div>
  )
}

function Goals({ goals, run }) {
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  return (
    <div className="card">
      <h3>🏆 Savings goals</h3>
      <form className="inline" onSubmit={(e) => { e.preventDefault(); run(() => api.addGoal({ name, target: Number(target) })).then(() => { setName(''); setTarget('') }) }}>
        <input required maxLength="80" placeholder="Goal (e.g. New laptop)" value={name} onChange={(e) => setName(e.target.value)} />
        <input type="number" min="1" required placeholder="₹ target" value={target} onChange={(e) => setTarget(e.target.value)} />
        <button className="btn">Add</button>
      </form>
      {goals.map((g) => {
        const pct = Math.min(100, (g.saved / g.target) * 100)
        return (
          <div className="bud" key={g.id}>
            <div className="budtop"><b>{g.name}</b><span className="muted">{inr(g.saved)} / {inr(g.target)} · {Math.round(pct)}%</span></div>
            <div className="track"><i className="goal" style={{ width: pct + '%' }} /></div>
            <div className="acts">
              <button className="link" onClick={() => { const v = Number(prompt('Add how much (₹)? Use a negative number to remove.')); if (v) run(() => api.editGoal(g.id, { name: g.name, target: g.target, saved: Math.max(0, g.saved + v) })) }}>+ Add money</button>
              <button className="link" onClick={() => confirm('Delete goal?') && run(() => api.delGoal(g.id))}>Delete</button>
            </div>
          </div>
        )
      })}
      {!goals.length && <p className="muted">Track what you are saving for. Goal money is tracked separately from your entries.</p>}
    </div>
  )
}

function Recurring({ list, cats, run }) {
  const blank = { type: 'debit', amount: '', category: cats.debit[0], mode: 'UPI', note: '', day: 1 }
  const [f, setF] = useState(blank)
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }))
  return (
    <div className="card">
      <h3>🔁 Recurring entries</h3>
      <p className="muted small">Rent, subscriptions, salary… added automatically on the chosen day every month.</p>
      <form className="grid-form" onSubmit={(e) => { e.preventDefault(); run(() => api.addRec({ ...f, amount: Number(f.amount), day: Number(f.day) })).then(() => setF(blank)) }}>
        <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value, category: cats[e.target.value][0] })}><option value="debit">Debit</option><option value="credit">Credit</option></select>
        <input type="number" min="1" required placeholder="₹ amount" value={f.amount} onChange={(e) => set('amount', e.target.value)} />
        <select value={f.category} onChange={(e) => set('category', e.target.value)}>{cats[f.type].map((c) => <option key={c}>{c}</option>)}</select>
        <select value={f.mode} onChange={(e) => set('mode', e.target.value)}>{MODES.map((c) => <option key={c}>{c}</option>)}</select>
        <input type="number" min="1" max="31" required title="Day of month" placeholder="Day (1-31)" value={f.day} onChange={(e) => set('day', e.target.value)} />
        <input maxLength="300" placeholder="Note (e.g. Netflix)" value={f.note} onChange={(e) => set('note', e.target.value)} />
        <button className="btn primary full">Add recurring</button>
      </form>
      {list.map((r) => <div className="li" key={r.id}><div><b>{r.note || r.category}</b><small>{r.category} · {r.mode} · day {r.day} of every month</small></div><div className="right"><b className={r.type}>{inr(r.amount)}</b><button className="link" onClick={() => confirm('Stop this recurring entry?') && run(() => api.delRec(r.id))}>Stop</button></div></div>)}
    </div>
  )
}

function Categories({ custom, run }) {
  const [edit, setEdit] = useState(null)
  const [val, setVal] = useState('')
  return (
    <div className="card">
      <h3>🏷️ My categories</h3>
      <AddCat run={run} />
      {custom.length ? custom.map((c) => (
        <div className="li" key={c.id}>
          {edit === c.id ? (
            <form className="inline" style={{ margin: 0, flex: 1 }} onSubmit={(e) => { e.preventDefault(); run(() => api.renameCat(c.id, val)).then(() => setEdit(null)) }}>
              <input autoFocus required maxLength="40" value={val} onChange={(e) => setVal(e.target.value)} />
              <button className="btn">Save</button><button type="button" className="link" onClick={() => setEdit(null)}>Cancel</button>
            </form>
          ) : (
            <>
              <div><b>{c.name}</b><small>{c.type === 'debit' ? 'Debit' : 'Credit'}</small></div>
              <div><button className="link" onClick={() => { setEdit(c.id); setVal(c.name) }}>Rename</button>
                <button className="link" onClick={() => confirm(`Remove “${c.name}” from the list? Old entries keep this name.`) && run(() => api.delCat(c.id))}>Remove</button></div>
            </>
          )}
        </div>
      )) : <p className="muted small">Add your own categories here, or pick “＋ New category…” while adding an entry. Renaming updates all your old entries too.</p>}
    </div>
  )
}

function AddCat({ run }) {
  const [type, setType] = useState('debit')
  const [name, setName] = useState('')
  return (
    <form className="inline" onSubmit={(e) => { e.preventDefault(); run(() => api.addCat(type, name.trim())).then(() => setName('')) }}>
      <select value={type} onChange={(e) => setType(e.target.value)}><option value="debit">Debit</option><option value="credit">Credit</option></select>
      <input required maxLength="40" placeholder="New category name" value={name} onChange={(e) => setName(e.target.value)} />
      <button className="btn">Add</button>
    </form>
  )
}
