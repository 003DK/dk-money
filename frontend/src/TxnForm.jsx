import { useState } from 'react'
import { api, inr, MODES, today } from './api'

const r2 = (n) => Math.round(n * 100) / 100

export default function TxnForm({ initial, cats, friends = [], onNewCat, onClose, onSaved }) {
  const [f, setF] = useState(initial ? { ...initial, amount: String(initial.amount) } : { type: 'debit', amount: '', date: today(), category: 'Food', mode: 'UPI', note: '' })
  const sp = initial?.splits || []
  const [share, setShare] = useState(sp.length > 0)
  const [payer, setPayer] = useState(sp.some((x) => x.amount < 0) ? 'friend' : 'me')
  const [rows, setRows] = useState(sp.filter((x) => x.amount > 0).length ? sp.filter((x) => x.amount > 0).map((x) => ({ friend: x.friend, amount: String(x.amount) })) : [{ friend: '', amount: '' }])
  const [payerName, setPayerName] = useState(sp.find((x) => x.amount < 0)?.friend || '')
  const [newCat, setNewCat] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }))
  const list = cats[f.type]
  const total = Number(f.amount) || 0
  const sharedSum = rows.reduce((t, x) => t + (Number(x.amount) || 0), 0)

  const setType = (type) => { setF((p) => ({ ...p, type, category: cats[type][0] })); if (type === 'credit') setShare(false) }
  const setRow = (i, k, v) => setRows((p) => p.map((x, j) => (j === i ? { ...x, [k]: v } : x)))

  function splitEqually() {
    const names = rows.filter((x) => x.friend.trim())
    if (!total || !names.length) return setErr('Enter the total amount and at least one friend name first.')
    setErr('')
    const each = r2(total / (names.length + 1))
    setRows((p) => p.map((x) => (x.friend.trim() ? { ...x, amount: String(each) } : x)))
  }

  async function addCategory() {
    const name = (newCat || '').trim()
    if (!name) return setNewCat(null)
    try { await onNewCat(f.type, name); set('category', name); setNewCat(null) } catch (e) { setErr(e.message) }
  }

  async function save(e) {
    e.preventDefault()
    setErr('')
    let splits = []
    if (f.type === 'debit' && share) {
      if (payer === 'me') {
        splits = rows.filter((x) => x.friend.trim() && Number(x.amount) > 0).map((x) => ({ friend: x.friend.trim(), amount: Number(x.amount) }))
        if (sharedSum > total + 0.01) return setErr("Friends' shares are more than the total.")
      } else {
        if (!payerName.trim()) return setErr('Enter the friend who paid.')
        splits = [{ friend: payerName.trim(), amount: -total }]
      }
    }
    setBusy(true)
    try {
      const body = { type: f.type, amount: total, date: f.date, category: f.category, mode: f.mode, note: f.note.trim(), splits }
      initial?.id ? await api.edit(initial.id, body) : await api.add(body)
      onSaved()
    } catch (e2) { setErr(e2.message); setBusy(false) }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div className="sheethead"><h2>{initial?.id ? 'Edit entry' : 'Add entry'}</h2><button type="button" className="link" onClick={onClose}>✕</button></div>
        <div className="seg">
          <button type="button" className={f.type === 'debit' ? 'on debit' : ''} onClick={() => setType('debit')}>Debit (spent)</button>
          <button type="button" className={f.type === 'credit' ? 'on credit' : ''} onClick={() => setType('credit')}>Credit (received)</button>
        </div>
        <label>{share && payer === 'friend' ? 'Your share (₹)' : share ? 'Total paid (₹)' : 'Amount (₹)'}
          <input type="number" inputMode="decimal" min="0.01" step="0.01" required autoFocus value={f.amount} onChange={(e) => set('amount', e.target.value)} /></label>
        <label>Date<input type="date" required value={f.date} onChange={(e) => set('date', e.target.value)} /></label>
        <div className="two">
          <label>Category
            <select value={f.category} onChange={(e) => (e.target.value === '__new__' ? setNewCat('') : set('category', e.target.value))}>
              {[...new Set([...list, f.category])].map((c) => <option key={c}>{c}</option>)}<option value="__new__">＋ New category…</option>
            </select></label>
          <label>Payment mode<select value={f.mode} onChange={(e) => set('mode', e.target.value)}>{[...new Set([...MODES, f.mode])].map((c) => <option key={c}>{c}</option>)}</select></label>
        </div>
        {newCat !== null && (
          <div className="newcat">
            <input autoFocus maxLength="40" placeholder={`New ${f.type} category name`} value={newCat} onChange={(e) => setNewCat(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCategory())} />
            <button type="button" className="btn" onClick={addCategory}>Add</button>
            <button type="button" className="link" onClick={() => setNewCat(null)}>Cancel</button>
          </div>
        )}
        <label>Note<input type="text" maxLength="300" placeholder="e.g. October rent" value={f.note} onChange={(e) => set('note', e.target.value)} /></label>

        {f.type === 'debit' && (
          <div className="splitbox">
            <label className="check"><input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} /> Shared with friends (split)</label>
            {share && (
              <>
                <div className="seg small">
                  <button type="button" className={payer === 'me' ? 'on credit' : ''} onClick={() => setPayer('me')}>I paid</button>
                  <button type="button" className={payer === 'friend' ? 'on credit' : ''} onClick={() => setPayer('friend')}>A friend paid</button>
                </div>
                {payer === 'me' ? (
                  <>
                    <datalist id="fr">{friends.map((n) => <option key={n} value={n} />)}</datalist>
                    {rows.map((x, i) => (
                      <div className="srow" key={i}>
                        <input list="fr" placeholder="Friend name" value={x.friend} onChange={(e) => setRow(i, 'friend', e.target.value)} />
                        <input type="number" inputMode="decimal" min="0" step="0.01" placeholder="Their share ₹" value={x.amount} onChange={(e) => setRow(i, 'amount', e.target.value)} />
                        {rows.length > 1 && <button type="button" className="link" onClick={() => setRows((p) => p.filter((_, j) => j !== i))}>✕</button>}
                      </div>
                    ))}
                    <div className="acts">
                      <button type="button" className="link" onClick={() => setRows((p) => [...p, { friend: '', amount: '' }])}>＋ Add friend</button>
                      <button type="button" className="link" onClick={splitEqually}>Split equally</button>
                    </div>
                    <p className="muted small">Your share: <b>{inr(Math.max(total - sharedSum, 0))}</b>. Friends owe you <b>{inr(sharedSum)}</b>. Only your share counts as your expense.</p>
                  </>
                ) : (
                  <>
                    <datalist id="fr">{friends.map((n) => <option key={n} value={n} />)}</datalist>
                    <input list="fr" placeholder="Friend who paid" value={payerName} onChange={(e) => setPayerName(e.target.value)} />
                    <p className="muted small">Enter only <b>your share</b> above. It is added to your expenses and you will owe {payerName || 'your friend'} {inr(total)}.</p>
                  </>
                )}
              </>
            )}
          </div>
        )}
        {err && <p className="err">{err}</p>}
        <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </form>
    </div>
  )
}
