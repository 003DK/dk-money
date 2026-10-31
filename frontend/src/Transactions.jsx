import { useMemo, useRef, useState } from 'react'
import { api, inr } from './api'

export default function Transactions({ rows, month, onEdit, onRepeat, onChanged }) {
  const [q, setQ] = useState('')
  const [type, setType] = useState('all')
  const [msg, setMsg] = useState('')
  const file = useRef()

  const shown = useMemo(() => rows.filter((r) => r.date.startsWith(month) && (type === 'all' || r.type === type) &&
    (!q || (r.note + r.category + r.mode).toLowerCase().includes(q.toLowerCase()))), [rows, month, q, type])

  async function del(r) {
    if (!confirm(`Delete ${inr(r.amount)} (${r.category})?`)) return
    await api.remove(r.id); onChanged()
  }
  async function exportCsv() {
    const blob = await api.exportCsv()
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'dk-money.csv'; a.click()
  }
  async function importCsv(e) {
    const f = e.target.files[0]; if (!f) return
    try { const r = await api.importCsv(f); setMsg(`Imported ${r.imported}, skipped ${r.skipped}`); onChanged() } catch (err) { setMsg(err.message) }
    e.target.value = ''
  }

  const byDate = shown.reduce((m, r) => ((m[r.date] ||= []).push(r), m), {})
  return (
    <div className="card">
      <div className="toolbar">
        <input placeholder="Search note, category, mode…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={type} onChange={(e) => setType(e.target.value)}><option value="all">All</option><option value="debit">Debit</option><option value="credit">Credit</option></select>
      </div>
      <div className="toolbar small">
        <button className="btn" onClick={exportCsv}>⬇ Export CSV</button>
        <button className="btn" onClick={() => file.current.click()}>⬆ Import CSV</button>
        <input ref={file} type="file" accept=".csv" hidden onChange={importCsv} />
        {msg && <span className="muted">{msg}</span>}
      </div>
      {!shown.length && <p className="muted pad">No entries. Tap + to add one.</p>}
      {Object.entries(byDate).map(([d, list]) => (
        <div key={d}>
          <div className="dayhead">{new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</div>
          {list.map((r) => (
            <div className="li" key={r.id}>
              <div><b>{r.category}</b><small>{r.mode}{r.note ? ' · ' + r.note : ''}</small>
                {r.splits?.length > 0 && <small className="tag">{r.splits.some((x) => x.amount < 0) ? `🤝 paid by ${r.splits[0].friend}` : `🤝 total ${inr(r.amount)} · split with ${r.splits.map((x) => x.friend).join(', ')}`}</small>}</div>
              <div className="right"><b className={r.type}>{r.type === 'debit' ? '-' : '+'}{inr(r.type === 'debit' ? r.my_share : r.amount)}</b>
                <span><button className="link" onClick={() => onEdit(r)}>Edit</button><button className="link" onClick={() => onRepeat(r)}>Repeat</button><button className="link" onClick={() => del(r)}>Delete</button></span></div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
