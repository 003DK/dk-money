import { useState } from 'react'
import { api, CREDIT_CATS, DEBIT_CATS, MODES, today } from './api'

export default function TxnForm({ initial, onClose, onSaved }) {
  const [f, setF] = useState(initial || { type: 'debit', amount: '', date: today(), category: 'Food', mode: 'UPI', note: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const cats = f.type === 'debit' ? DEBIT_CATS : CREDIT_CATS
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }))

  function setType(type) {
    setF((p) => ({ ...p, type, category: (type === 'debit' ? DEBIT_CATS : CREDIT_CATS)[0] }))
  }

  async function save(e) {
    e.preventDefault()
    setBusy(true); setErr('')
    try {
      const body = { type: f.type, amount: Number(f.amount), date: f.date, category: f.category, mode: f.mode, note: f.note.trim() }
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
        <label>Amount (₹)<input type="number" inputMode="decimal" min="0.01" step="0.01" required autoFocus value={f.amount} onChange={(e) => set('amount', e.target.value)} /></label>
        <label>Date<input type="date" required value={f.date} max={today()} onChange={(e) => set('date', e.target.value)} /></label>
        <div className="two">
          <label>Category<select value={f.category} onChange={(e) => set('category', e.target.value)}>{[...new Set([...cats, f.category])].map((c) => <option key={c}>{c}</option>)}</select></label>
          <label>Payment mode<select value={f.mode} onChange={(e) => set('mode', e.target.value)}>{[...new Set([...MODES, f.mode])].map((c) => <option key={c}>{c}</option>)}</select></label>
        </div>
        <label>Note<input type="text" maxLength="300" placeholder="e.g. Lunch with friends" value={f.note} onChange={(e) => set('note', e.target.value)} /></label>
        {err && <p className="err">{err}</p>}
        <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </form>
    </div>
  )
}
