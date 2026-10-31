import { useState } from 'react'
import { api, inr, today } from './api'

const KINDS = {
  recv: { label: 'They paid me back', sign: -1, kind: 'settle' },
  paid: { label: 'I paid them back', sign: 1, kind: 'settle' },
  lent: { label: 'They owe me (I lent / paid for them)', sign: 1, kind: 'manual' },
  owe: { label: 'I owe them (they paid for me)', sign: -1, kind: 'manual' },
}
const fmt = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

function RecordForm({ friend, balance = 0, names, onDone }) {
  const [name, setName] = useState(friend || '')
  const [k, setK] = useState(balance < 0 ? 'paid' : 'recv')
  const [amt, setAmt] = useState(balance ? String(Math.abs(balance)) : '')
  const [date, setDate] = useState(today())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e) {
    e.preventDefault(); setBusy(true)
    try {
      await api.ledger({ friend: name.trim(), amount: KINDS[k].sign * Number(amt), date, kind: KINDS[k].kind, note })
      setAmt(''); setNote(''); onDone()
    } catch (err) { alert(err.message) }
    setBusy(false)
  }
  return (
    <form className="grid-form" onSubmit={submit}>
      {!friend && <><datalist id="frn">{names.map((n) => <option key={n} value={n} />)}</datalist>
        <input required list="frn" placeholder="Friend name" value={name} onChange={(e) => setName(e.target.value)} /></>}
      <select value={k} onChange={(e) => setK(e.target.value)} className={friend ? 'full' : ''}>{Object.entries(KINDS).map(([key, v]) => <option key={key} value={key}>{v.label}</option>)}</select>
      <input type="number" min="0.01" step="0.01" required placeholder="₹ amount" value={amt} onChange={(e) => setAmt(e.target.value)} />
      <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
      <input className="full" maxLength="300" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <button className="btn primary full" disabled={busy}>{busy ? 'Saving…' : 'Save record'}</button>
    </form>
  )
}

function reminder(f) {
  const lines = f.items.slice(0, 12).map((i) => {
    const what = i.kind === 'settle' ? (i.amount < 0 ? 'Paid by you' : 'Paid to you') : i.label || 'Shared expense'
    return `• ${fmt(i.date)} ${what}: ${i.amount > 0 ? '' : '-'}${inr(Math.abs(i.amount))}`
  })
  const head = f.balance > 0 ? `Hi ${f.name}, quick tally 😊` : `Tally with ${f.name}`
  const tail = f.balance > 0 ? `Pending from you: ${inr(f.balance)}` : f.balance < 0 ? `I owe you: ${inr(-f.balance)}` : 'All settled ✅'
  return [head, ...lines, tail].join('\n')
}

async function shareText(text) {
  try {
    if (navigator.share) return await navigator.share({ text })
    await navigator.clipboard.writeText(text); alert('Copied. Paste it in WhatsApp.')
  } catch {}
}

function FriendCard({ f, names, onChanged }) {
  const [open, setOpen] = useState(false)
  const cls = f.balance > 0 ? 'credit' : f.balance < 0 ? 'debit' : 'muted'
  const txt = f.balance > 0 ? `owes you ${inr(f.balance)}` : f.balance < 0 ? `you owe ${inr(-f.balance)}` : 'settled ✅'
  return (
    <div className="card">
      <div className="li" style={{ cursor: 'pointer', border: 0, padding: 0 }} onClick={() => setOpen(!open)}>
        <div><b>{f.name}</b><small>{f.items.length} record{f.items.length > 1 ? 's' : ''}</small></div>
        <b className={cls}>{txt} {open ? '▴' : '▾'}</b>
      </div>
      {open && (
        <>
          <div className="acts"><button className="link" onClick={() => shareText(reminder(f))}>📤 Share / copy reminder</button></div>
          {f.items.map((i) => (
            <div className="li" key={i.id}>
              <div><b>{i.kind === 'settle' ? (i.amount < 0 ? 'They paid you' : 'You paid them') : i.kind === 'manual' ? (i.amount > 0 ? 'They owe you' : 'You owe them') : i.label || 'Shared expense'}</b>
                <small>{fmt(i.date)}{i.total ? ` · total ${inr(i.total)}` : ''}{i.kind !== 'split' && i.label ? ' · ' + i.label : ''}</small></div>
              <div className="right"><b className={i.amount > 0 ? 'credit' : 'debit'}>{i.amount > 0 ? '+' : '-'}{inr(Math.abs(i.amount))}</b>
                {i.kind !== 'split' && <button className="link" onClick={async () => { if (confirm('Delete this record?')) { await api.delLedger(i.id); onChanged() } }}>Delete</button>}</div>
            </div>
          ))}
          <details><summary className="link">Record a payment for {f.name}</summary><RecordForm friend={f.name} balance={f.balance} names={names} onDone={onChanged} /></details>
        </>
      )}
    </div>
  )
}

export default function Friends({ friends, onChanged }) {
  const owed = friends.filter((f) => f.balance > 0).reduce((t, f) => t + f.balance, 0)
  const owe = friends.filter((f) => f.balance < 0).reduce((t, f) => t - f.balance, 0)
  const names = friends.map((f) => f.name)
  return (
    <>
      <div className="kpis">
        <div className="kpi"><span>Friends owe you</span><b className="credit">{inr(owed)}</b></div>
        <div className="kpi"><span>You owe friends</span><b className="debit">{inr(owe)}</b></div>
      </div>
      <div className="card">
        <h3>🤝 How it works</h3>
        <p className="muted small">Add a normal entry (like rent), tick <b>“Shared with friends”</b> and enter each friend’s share. Only your share counts as your expense, and the rest appears here. When a friend pays you back, record it below so the balance goes to zero.</p>
        <details><summary className="link">＋ Record a payment or a loan</summary><RecordForm names={names} onDone={onChanged} /></details>
      </div>
      {friends.length ? friends.map((f) => <FriendCard key={f.name.toLowerCase()} f={f} names={names} onChanged={onChanged} />) : <p className="muted pad">No friend records yet.</p>}
    </>
  )
}
