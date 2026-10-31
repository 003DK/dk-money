import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { inr } from './api'
import { Empty } from './Dashboard'

export default function Insights({ a }) {
  return (
    <>
      <div className="card">
        <h3>💡 Smart insights</h3>
        {a.insights.length ? <ul className="ins">{a.insights.map((t, i) => <li key={i}>{t}</li>)}</ul> : <Empty text="Add more entries to get insights." />}
      </div>

      <div className="card">
        <h3>Compared with last month (by category)</h3>
        {a.mom.length ? (
          <div className="scroll"><table><thead><tr><th>Category</th><th>This month</th><th>Last month</th><th>Change</th></tr></thead><tbody>
            {a.mom.map((r) => <tr key={r.category}><td>{r.category}</td><td>{inr(r.current)}</td><td>{inr(r.previous)}</td>
              <td className={r.current > r.previous ? 'debit' : 'credit'}>{r.change_pct == null ? 'new' : (r.change_pct > 0 ? '+' : '') + r.change_pct + '%'}</td></tr>)}
          </tbody></table></div>
        ) : <Empty text="No data" />}
      </div>

      <div className="card">
        <h3>Spending by weekday</h3>
        <ResponsiveContainer width="100%" height={200}><BarChart data={a.weekday}><CartesianGrid strokeDasharray="3 3" stroke="var(--bd)" /><XAxis dataKey="name" /><YAxis width={45} /><Tooltip formatter={(v) => inr(v)} contentStyle={{ background: 'var(--card)', border: '1px solid var(--bd)' }} /><Bar dataKey="amount" fill="#7a4fc2" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
      </div>

      <div className="grid2">
        <div className="card">
          <h3>Top 5 expenses</h3>
          {a.top_expenses.length ? a.top_expenses.map((t, i) => <div className="li" key={i}><div><b>{t.category}</b><small>{t.date}{t.note ? ' · ' + t.note : ''}</small></div><b className="debit">{inr(t.amount)}</b></div>) : <Empty text="No data" />}
        </div>
        <div className="card">
          <h3>⚠️ Unusually large</h3>
          {a.anomalies.length ? a.anomalies.map((t, i) => <div className="li" key={i}><div><b>{t.category}</b><small>{t.date} · usually about {inr(t.typical)}</small></div><b className="debit">{inr(t.amount)}</b></div>) : <Empty text="Nothing unusual. Needs 5+ entries per category." />}
        </div>
      </div>

      <div className="card">
        <h3>🔁 Recurring payments detected</h3>
        {a.recurring.length ? a.recurring.map((t, i) => <div className="li" key={i}><div><b>{t.name}</b><small>{t.category} · seen in {t.months} months</small></div><b>{inr(t.avg_amount)}</b></div>) : <Empty text="Repeated payments with the same note and amount show up here." />}
      </div>
    </>
  )
}
