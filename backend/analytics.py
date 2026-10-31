"""Pandas-based analysis for DK Money."""
import calendar
from datetime import date

import pandas as pd


def inr(n: float) -> str:
    n = round(n)
    s = str(abs(n))
    if len(s) > 3:
        head, tail, parts = s[:-3], s[-3:], []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        s = ",".join(parts) + "," + tail
    return ("-" if n < 0 else "") + "₹" + s


def _group(d: pd.DataFrame, col: str):
    if d.empty:
        return []
    g = d.groupby(col).amount.sum().sort_values(ascending=False)
    g = g[g > 0]
    total = g.sum()
    if not total:
        return []
    return [{"name": k, "amount": round(float(v), 2), "pct": round(float(v / total * 100), 1)} for k, v in g.items()]


def analyze(rows: list[dict], month: str | None = None, budgets: dict | None = None) -> dict:
    today = date.today()
    cur_ym = today.strftime("%Y-%m")
    if not rows:
        return {"month": month or cur_ym, "months": [], "empty": True}

    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["date"])
    df["amount"] = df["amount"].astype(float)
    df["ym"] = df["date"].dt.strftime("%Y-%m")
    months = sorted(df.ym.unique())
    if not month or month not in months:
        month = cur_ym if cur_ym in months else months[-1]

    cur = df[df.ym == month]
    exp = cur[cur.type == "debit"]
    inc = cur[cur.type == "credit"]
    expense, income = float(exp.amount.sum()), float(inc.amount.sum())

    y, m = map(int, month.split("-"))
    dim = calendar.monthrange(y, m)[1]
    elapsed = today.day if month == cur_ym else dim
    avg_daily = expense / elapsed if elapsed else 0
    projected = avg_daily * dim if month == cur_ym else None

    # daily series with cumulative net
    days = pd.date_range(f"{month}-01", periods=dim)
    d_deb = exp.groupby("date").amount.sum().reindex(days, fill_value=0)
    d_cre = inc.groupby("date").amount.sum().reindex(days, fill_value=0)
    cum = (d_cre - d_deb).cumsum()
    daily = [{"day": d.day, "debit": round(float(d_deb[d]), 2), "credit": round(float(d_cre[d]), 2), "net": round(float(cum[d]), 2)} for d in days]

    # weekday pattern
    wk = exp.groupby(exp.date.dt.dayofweek).amount.sum().reindex(range(7), fill_value=0)
    weekday = [{"name": n, "amount": round(float(wk[i]), 2)} for i, n in enumerate(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])]

    # 12-month trend
    piv = df.pivot_table(index="ym", columns="type", values="amount", aggfunc="sum", fill_value=0).reindex(columns=["credit", "debit"], fill_value=0)
    trend = [{"month": k, "income": round(float(r.credit), 2), "expense": round(float(r.debit), 2), "net": round(float(r.credit - r.debit), 2)} for k, r in piv.tail(12).iterrows()]

    # month-over-month by category
    prev_ym = (pd.Period(month) - 1).strftime("%Y-%m")
    prev_exp = df[(df.ym == prev_ym) & (df.type == "debit")]
    prev_total = float(prev_exp.amount.sum())
    c_now = exp.groupby("category").amount.sum()
    c_prev = prev_exp.groupby("category").amount.sum()
    mom = []
    for c in sorted(set(c_now.index) | set(c_prev.index)):
        a, b = float(c_now.get(c, 0)), float(c_prev.get(c, 0))
        mom.append({"category": c, "current": round(a, 2), "previous": round(b, 2), "change_pct": round((a - b) / b * 100, 1) if b else None})
    mom.sort(key=lambda r: -abs(r["current"] - r["previous"]))

    # anomalies: unusually large spend for its category (needs history)
    all_exp = df[df.type == "debit"]
    anomalies = []
    for c, g in all_exp.groupby("category"):
        if len(g) < 5:
            continue
        mu, sd = g.amount.mean(), g.amount.std()
        thr = max(mu + 2 * sd, mu * 1.5)
        for _, r in exp[(exp.category == c) & (exp.amount > thr)].iterrows():
            anomalies.append({"date": r.date.strftime("%Y-%m-%d"), "category": c, "amount": float(r.amount), "note": r.note or "", "typical": round(float(mu), 2)})
    anomalies.sort(key=lambda r: -r["amount"])

    # recurring spends: same note appearing in 2+ months with similar amount
    rec = []
    d2 = all_exp.copy()
    d2["key"] = d2.note.fillna("").str.strip().str.lower()
    d2 = d2[d2.key != ""]
    for k, g in d2.groupby("key"):
        if g.ym.nunique() >= 2 and g.amount.mean() > 0 and g.amount.std(ddof=0) / g.amount.mean() < 0.2:
            rec.append({"name": g.note.iloc[-1], "category": g.category.iloc[-1], "avg_amount": round(float(g.amount.mean()), 2), "months": int(g.ym.nunique())})
    rec.sort(key=lambda r: -r["avg_amount"])

    top = [{"date": r.date.strftime("%Y-%m-%d"), "category": r.category, "note": r.note or "", "amount": float(r.amount)} for _, r in exp.nlargest(5, "amount").iterrows()]

    by_cat = _group(exp, "category")
    by_mode = _group(exp, "mode")

    # budgets: category -> monthly limit ("__total__" = overall)
    bud, safe = [], None
    for cat, lim in (budgets or {}).items():
        spent = expense if cat == "__total__" else float(c_now.get(cat, 0))
        pct = spent / lim * 100 if lim else 0
        bud.append({"category": cat, "limit": lim, "spent": round(spent, 2), "pct": round(pct, 1),
                    "status": "over" if pct >= 100 else "warn" if pct >= 80 else "ok"})
    bud.sort(key=lambda b: (b["category"] != "__total__", -b["pct"]))
    if budgets and "__total__" in budgets and month == cur_ym:
        safe = max(budgets["__total__"] - expense, 0) / (dim - today.day + 1)
    no_spend = sum(1 for d in daily[:elapsed] if d["debit"] == 0)

    # plain-language insights
    ins = []
    for b in bud:
        nm = "Overall" if b["category"] == "__total__" else b["category"]
        if b["status"] == "over":
            ins.append(f"🚨 {nm} budget exceeded: {inr(b['spent'])} of {inr(b['limit'])}.")
        elif b["status"] == "warn":
            ins.append(f"⚠️ {nm} budget is {b['pct']:.0f}% used ({inr(b['spent'])} of {inr(b['limit'])}).")
    if safe is not None:
        ins.append(f"You can spend about {inr(safe)} per day for the rest of the month and stay within your overall budget.")
    if expense > 0 and by_cat:
        ins.append(f"{by_cat[0]['name']} is your biggest spend: {inr(by_cat[0]['amount'])} ({by_cat[0]['pct']}% of expenses).")
    if income > 0:
        rate = (income - expense) / income * 100
        ins.append(f"You saved {rate:.0f}% of your income this month." if rate >= 0 else f"You spent {inr(expense - income)} more than you earned this month.")
    if prev_total > 0 and expense > 0:
        ch = (expense - prev_total) / prev_total * 100
        ins.append(f"Spending is {abs(ch):.0f}% {'higher' if ch > 0 else 'lower'} than last month ({inr(prev_total)}).")
    if projected and not safe:
        ins.append(f"At this pace you will spend about {inr(projected)} by month end.")
    if expense > 0:
        wend = float(wk[5] + wk[6])
        if wend / expense > 0.4:
            ins.append(f"Weekends make up {wend / expense * 100:.0f}% of your spending. Plan a weekend budget.")
        small = exp[exp.amount <= 100]
        if len(small) >= 10:
            ins.append(f"{len(small)} small payments (₹100 or less) added up to {inr(float(small.amount.sum()))}.")
        cash = next((x for x in by_mode if x["name"].lower() == "cash"), None)
        if cash and cash["pct"] > 30:
            ins.append(f"{cash['pct']}% of spend is in cash, which is hard to track. Note it down as you go.")
    if no_spend >= 3:
        ins.append(f"{no_spend} no-spend days so far this month. Nice.")
    if anomalies:
        ins.append(f"{len(anomalies)} unusually large expense(s) compared to your normal for that category.")

    return {
        "empty": False, "month": month, "months": months,
        "summary": {"income": round(income, 2), "expense": round(expense, 2), "net": round(income - expense, 2),
                    "savings_rate": round((income - expense) / income * 100, 1) if income else None,
                    "count": int(len(cur)), "avg_daily": round(avg_daily, 2), "no_spend_days": no_spend,
                    "projected": round(projected, 2) if projected else None, "prev_expense": round(prev_total, 2)},
        "safe_per_day": round(safe, 2) if safe is not None else None, "budgets": bud,
        "by_category": by_cat, "by_mode": by_mode, "income_by_category": _group(inc, "category"),
        "daily": daily, "weekday": weekday, "trend": trend, "mom": mom[:8],
        "top_expenses": top, "anomalies": anomalies[:6], "recurring": rec[:6], "insights": ins,
    }
