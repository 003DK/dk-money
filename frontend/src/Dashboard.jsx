import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { catName, inr } from './api'

export const COLORS = ['#0f7b5f', '#2f6fd0', '#d98a1c', '#c0483d', '#7a4fc2', '#2a9db0', '#8c8c3a', '#d0568f', '#6b7280']
const tip = { contentStyle: { background: 'var(--card)', border: '1px solid var(--bd)', borderRadius: 8 }, formatter: (v) => inr(v) }
const k = (v) => (v >= 1000 ? Math.round(v / 100) / 10 + 'k' : v)
const mlabel = (m) => new Date(m + '-01').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })

export function BudgetBars({ list }) {
  return list.map((b) => (
    <div className="bud" key={b.category}>
      <div className="budtop"><b>{catName(b.category)}</b><span className={b.status === 'ok' ? 'muted' : b.status === 'warn' ? 'warn' : 'debit'}>{inr(b.spent)} / {inr(b.limit)} · {Math.round(b.pct)}%</span></div>
      <div className="track"><i className={b.status} style={{ width: Math.min(b.pct, 100) + '%' }} /></div>
    </div>
  ))
}

export const Empty = ({ text }) => <p className="muted pad">{text}</p>

export default function Dashboard({ a, owed = 0 }) {
  const s = a.summary
  const cats = a.by_category
  return (
    <>
      <div className="kpis">
        <div className="kpi"><span>Income</span><b className="credit">{inr(s.income)}</b></div>
        <div className="kpi"><span>Expense (your share)</span><b className="debit">{inr(s.expense)}</b></div>
        <div className="kpi"><span>Balance (net)</span><b>{inr(s.net)}</b></div>
        {owed > 0 && <div className="kpi"><span>Friends owe you</span><b className="credit">{inr(owed)}</b></div>}
        <div className="kpi"><span>Saved</span><b>{s.savings_rate == null ? '–' : s.savings_rate + '%'}</b></div>
        <div className="kpi"><span>{a.safe_per_day != null ? 'Safe to spend / day' : 'Avg per day'}</span><b>{inr(a.safe_per_day ?? s.avg_daily)}</b></div>
        <div className="kpi"><span>{s.projected ? 'Projected month' : 'Last month'}</span><b>{inr(s.projected ?? s.prev_expense)}</b></div>
      </div>

      {a.budgets.length > 0 && <div className="card"><h3>Budgets this month</h3><BudgetBars list={a.budgets} /></div>}

      <div className="card">
        <h3>Spending by category</h3>
        {cats.length ? (
          <div className="piewrap">
            <ResponsiveContainer width="100%" height={220}>
              <PieChart><Pie data={cats} dataKey="amount" nameKey="name" innerRadius={55} outerRadius={95} paddingAngle={2}>{cats.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip {...tip} /></PieChart>
            </ResponsiveContainer>
            <div className="legend">{cats.map((c, i) => <div key={c.name}><s style={{ background: COLORS[i % COLORS.length] }} />{c.name}<em>{inr(c.amount)} · {c.pct}%</em></div>)}</div>
          </div>
        ) : <Empty text="No expenses this month." />}
      </div>

      <div className="grid2">
        <div className="card">
          <h3>Payment mode</h3>
          {a.by_mode.length ? <ResponsiveContainer width="100%" height={210}><BarChart data={a.by_mode} layout="vertical" margin={{ left: 10 }}><XAxis type="number" tickFormatter={k} /><YAxis type="category" dataKey="name" width={90} /><Tooltip {...tip} /><Bar dataKey="amount" radius={4}>{a.by_mode.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Bar></BarChart></ResponsiveContainer> : <Empty text="No data" />}
        </div>
        <div className="card">
          <h3>Daily spending</h3>
          <ResponsiveContainer width="100%" height={210}><BarChart data={a.daily}><CartesianGrid strokeDasharray="3 3" stroke="var(--bd)" /><XAxis dataKey="day" /><YAxis tickFormatter={k} width={40} /><Tooltip {...tip} /><Bar dataKey="debit" name="Spent" fill="#c0483d" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer>
        </div>
      </div>

      <div className="card">
        <h3>Income vs expense (last 12 months)</h3>
        <ResponsiveContainer width="100%" height={240}><BarChart data={a.trend.map((t) => ({ ...t, label: mlabel(t.month) }))}><CartesianGrid strokeDasharray="3 3" stroke="var(--bd)" /><XAxis dataKey="label" /><YAxis tickFormatter={k} width={40} /><Tooltip {...tip} /><Legend /><Bar dataKey="income" name="Income" fill="#0f7b5f" radius={[3, 3, 0, 0]} /><Bar dataKey="expense" name="Expense" fill="#c0483d" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer>
      </div>

      <div className="card">
        <h3>Running balance this month</h3>
        <ResponsiveContainer width="100%" height={200}><AreaChart data={a.daily}><CartesianGrid strokeDasharray="3 3" stroke="var(--bd)" /><XAxis dataKey="day" /><YAxis tickFormatter={k} width={40} /><Tooltip {...tip} /><Area dataKey="net" name="Net" stroke="#2f6fd0" fill="#2f6fd033" /></AreaChart></ResponsiveContainer>
      </div>
    </>
  )
}
