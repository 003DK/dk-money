import calendar
import io
import os
import time
from datetime import date as Date, datetime
from typing import Literal, Optional
from urllib.parse import urlparse
import traceback

import httpx
import pandas as pd
from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import Boolean, Column, Date as SADate, DateTime, Float, Integer, String, UniqueConstraint, create_engine
from sqlalchemy.orm import Session, declarative_base, sessionmaker

from analytics import analyze

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
ALLOWED = {e.strip().lower() for e in os.getenv("ALLOWED_EMAILS", "").split(",") if e.strip()}
DEV_NO_AUTH = os.getenv("DEV_NO_AUTH") == "1"  # local testing only
DB_URL = os.getenv("DATABASE_URL", "sqlite:///dk_money.db").replace("postgres://", "postgresql://", 1)

engine = create_engine(DB_URL, pool_pre_ping=True, connect_args={"check_same_thread": False} if DB_URL.startswith("sqlite") else {})
Session_ = sessionmaker(bind=engine, autoflush=False)
Base = declarative_base()


class Txn(Base):
    __tablename__ = "transactions"
    id = Column(Integer, primary_key=True)
    owner = Column(String(200), index=True, nullable=False)
    type = Column(String(10), nullable=False)
    amount = Column(Float, nullable=False)
    date = Column(SADate, index=True, nullable=False)
    category = Column(String(60), nullable=False)
    mode = Column(String(40), nullable=False)
    note = Column(String(300), default="")
    created_at = Column(DateTime, default=datetime.utcnow)


class Cat(Base):
    __tablename__ = "categories"
    __table_args__ = (UniqueConstraint("owner", "type", "name"),)
    id = Column(Integer, primary_key=True)
    owner = Column(String(200), index=True, nullable=False)
    type = Column(String(10), nullable=False)
    name = Column(String(40), nullable=False)


class Budget(Base):
    __tablename__ = "budgets"
    __table_args__ = (UniqueConstraint("owner", "category"),)
    id = Column(Integer, primary_key=True)
    owner = Column(String(200), index=True, nullable=False)
    category = Column(String(60), nullable=False)  # "__total__" = overall
    amount = Column(Float, nullable=False)


class Goal(Base):
    __tablename__ = "goals"
    id = Column(Integer, primary_key=True)
    owner = Column(String(200), index=True, nullable=False)
    name = Column(String(80), nullable=False)
    target = Column(Float, nullable=False)
    saved = Column(Float, default=0)


class Rec(Base):
    __tablename__ = "recurring"
    id = Column(Integer, primary_key=True)
    owner = Column(String(200), index=True, nullable=False)
    type = Column(String(10), nullable=False)
    amount = Column(Float, nullable=False)
    category = Column(String(60), nullable=False)
    mode = Column(String(40), nullable=False)
    note = Column(String(300), default="")
    day = Column(Integer, nullable=False)
    start = Column(String(7), nullable=False)       # YYYY-MM
    last_run = Column(String(7), nullable=True)     # last month generated


class Ledger(Base):
    """Money between you and friends. amount > 0: friend owes you, amount < 0: you owe friend."""
    __tablename__ = "ledger"
    id = Column(Integer, primary_key=True)
    owner = Column(String(200), index=True, nullable=False)
    friend = Column(String(60), nullable=False)
    amount = Column(Float, nullable=False)
    date = Column(SADate, nullable=False)
    kind = Column(String(10), nullable=False)      # split | settle | manual
    txn_id = Column(Integer, index=True, nullable=True)
    note = Column(String(300), default="")


Base.metadata.create_all(engine)

app = FastAPI(title="DK Money API")


@app.middleware("http")
async def show_errors(request, call_next):
    """Turn crashes into a readable JSON error (keeps CORS headers, so the browser shows the real message)."""
    try:
        return await call_next(request)
    except Exception as e:  # noqa
        traceback.print_exc()
        return JSONResponse({"detail": f"Server error: {type(e).__name__}: {e}"}, status_code=500)


def _origin(o: str) -> str:
    """Normalise: lower-case, no trailing slash, no path (browsers send https://name.github.io in lower case)."""
    o = o.strip().lower()
    p = urlparse(o)
    return f"{p.scheme}://{p.netloc}" if p.scheme and p.netloc else o.rstrip("/")


# added last = outermost, so CORS headers are on every response, including errors
app.add_middleware(
    CORSMiddleware,
    allow_origins=[_origin(o) for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()],
    allow_methods=["*"], allow_headers=["*"],
)

_cache: dict[str, tuple[str, float]] = {}


def user(authorization: Optional[str] = Header(None)) -> str:
    if DEV_NO_AUTH:
        return "dev@local"
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Missing token")
    token = authorization[7:]
    hit = _cache.get(token)
    if hit and hit[1] > time.time():
        email = hit[0]
    else:
        if not SUPABASE_URL.startswith("http"):
            raise HTTPException(500, "SUPABASE_URL on Render is missing or wrong (must start with https://)")
        if not SUPABASE_ANON_KEY:
            raise HTTPException(500, "SUPABASE_ANON_KEY on Render is missing")
        try:
            r = httpx.get(f"{SUPABASE_URL}/auth/v1/user", headers={"Authorization": f"Bearer {token}", "apikey": SUPABASE_ANON_KEY}, timeout=15)
        except Exception as e:  # any network / URL problem
            raise HTTPException(503, f"Cannot reach Supabase auth: {type(e).__name__}. Check SUPABASE_URL on Render.")
        if r.status_code != 200:
            raise HTTPException(401, f"Supabase rejected the login (status {r.status_code}). Sign out and sign in again; if it repeats, check SUPABASE_ANON_KEY on Render.")
        email = (r.json().get("email") or "").lower()
        _cache[token] = (email, time.time() + 300)
    if not ALLOWED or email not in ALLOWED:
        raise HTTPException(403, f"Email '{email}' is not in ALLOWED_EMAILS on Render" if ALLOWED else "ALLOWED_EMAILS is not set on Render")
    return email


def db():
    s = Session_()
    try:
        yield s
    finally:
        s.close()


class SplitIn(BaseModel):
    friend: str = Field(min_length=1, max_length=60)
    amount: float = Field(gt=-1e10, lt=1e10)   # + friend owes you, - you owe friend


class TxnIn(BaseModel):
    splits: list[SplitIn] = []
    type: Literal["credit", "debit"]
    amount: float = Field(gt=0, lt=1e10)
    date: Date
    category: str = Field(min_length=1, max_length=60)
    mode: str = Field(min_length=1, max_length=40)
    note: str = Field("", max_length=300)


def out(t: Txn, sm: Optional[dict] = None) -> dict:
    sp = (sm or {}).get(t.id, [])
    mine = max(t.amount - sum(x["amount"] for x in sp if x["amount"] > 0), 0) if t.type == "debit" else t.amount
    return {"id": t.id, "type": t.type, "amount": t.amount, "my_share": round(mine, 2), "splits": sp,
            "date": t.date.isoformat(), "category": t.category, "mode": t.mode, "note": t.note or ""}


def _split_map(s: Session, me: str) -> dict:
    m: dict = {}
    for r in s.query(Ledger).filter(Ledger.owner == me, Ledger.kind == "split"):
        m.setdefault(r.txn_id, []).append({"friend": r.friend, "amount": r.amount})
    return m


def _check_splits(body: "TxnIn"):
    if not body.splits:
        return
    if body.type != "debit":
        raise HTTPException(400, "Only debit entries can be shared")
    if any(x.amount == 0 for x in body.splits):
        raise HTTPException(400, "A friend's share cannot be 0")
    if sum(x.amount for x in body.splits if x.amount > 0) > body.amount + 0.01:
        raise HTTPException(400, "Friends' shares are more than the total amount")


def _save_splits(s: Session, me: str, t: Txn, splits: list):
    s.query(Ledger).filter(Ledger.owner == me, Ledger.txn_id == t.id, Ledger.kind == "split").delete()
    for x in splits:
        s.add(Ledger(owner=me, friend=x.friend.strip(), amount=x.amount, date=t.date, kind="split", txn_id=t.id, note=""))


def _eff_rows(s: Session, me: str) -> list:
    """Rows for analysis: debits count only YOUR share."""
    sm = _split_map(s, me)
    rows = []
    for t in s.query(Txn).filter(Txn.owner == me).all():
        r = out(t, sm)
        if t.type == "debit":
            r["amount"] = r["my_share"]
        rows.append(r)
    return rows


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/transactions")
def list_txns(month: Optional[str] = None, me: str = Depends(user), s: Session = Depends(db)):
    q = s.query(Txn).filter(Txn.owner == me)
    if month:
        y, m = map(int, month.split("-"))
        start = Date(y, m, 1)
        end = Date(y + (m == 12), m % 12 + 1, 1)
        q = q.filter(Txn.date >= start, Txn.date < end)
    sm = _split_map(s, me)
    return [out(t, sm) for t in q.order_by(Txn.date.desc(), Txn.id.desc()).all()]


@app.post("/transactions", status_code=201)
def add_txn(body: TxnIn, me: str = Depends(user), s: Session = Depends(db)):
    _check_splits(body)
    t = Txn(owner=me, **body.model_dump(exclude={"splits"}))
    s.add(t); s.commit(); s.refresh(t)
    _save_splits(s, me, t, body.splits); s.commit()
    return out(t, _split_map(s, me))


def _get(s: Session, me: str, tid: int) -> Txn:
    t = s.query(Txn).filter(Txn.id == tid, Txn.owner == me).first()
    if not t:
        raise HTTPException(404, "Not found")
    return t


@app.put("/transactions/{tid}")
def edit_txn(tid: int, body: TxnIn, me: str = Depends(user), s: Session = Depends(db)):
    _check_splits(body)
    t = _get(s, me, tid)
    for k, v in body.model_dump(exclude={"splits"}).items():
        setattr(t, k, v)
    s.commit(); s.refresh(t)
    _save_splits(s, me, t, body.splits); s.commit()
    return out(t, _split_map(s, me))


@app.delete("/transactions/{tid}")
def del_txn(tid: int, me: str = Depends(user), s: Session = Depends(db)):
    s.delete(_get(s, me, tid))
    s.query(Ledger).filter(Ledger.owner == me, Ledger.txn_id == tid, Ledger.kind == "split").delete()
    s.commit()
    return {"deleted": tid}


@app.get("/analytics")
def analytics(month: Optional[str] = None, me: str = Depends(user), s: Session = Depends(db)):
    return _clean(analyze(_eff_rows(s, me), month, _budgets(s, me)))


@app.get("/export")
def export(me: str = Depends(user), s: Session = Depends(db)):
    sm = _split_map(s, me)
    rows = [out(t, sm) for t in s.query(Txn).filter(Txn.owner == me).order_by(Txn.date).all()]
    for r in rows:
        r["split_with"] = ", ".join(f"{x['friend']} {x['amount']:g}" for x in r["splits"])
    df = pd.DataFrame(rows, columns=["date", "type", "amount", "my_share", "category", "mode", "note", "split_with"])
    return Response(df.to_csv(index=False), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=dk-money.csv"})


@app.post("/import")
async def import_csv(file: UploadFile = File(...), me: str = Depends(user), s: Session = Depends(db)):
    try:
        df = pd.read_csv(io.BytesIO(await file.read()))
    except Exception:
        raise HTTPException(400, "Could not read CSV")
    df.columns = [c.strip().lower() for c in df.columns]
    if not {"date", "type", "amount"} <= set(df.columns):
        raise HTTPException(400, "CSV needs columns: date, type, amount (optional: category, mode, note)")
    tmap = {"credit": "credit", "cr": "credit", "income": "credit", "debit": "debit", "dr": "debit", "expense": "debit"}
    n = 0
    for _, r in df.iterrows():
        typ = tmap.get(str(r["type"]).strip().lower())
        d = pd.to_datetime(r["date"], dayfirst=True, errors="coerce")
        try:
            amt = float(str(r["amount"]).replace(",", ""))
        except ValueError:
            continue
        if not typ or pd.isna(d) or amt <= 0:
            continue
        g = lambda c, dflt: (str(r[c]).strip() if c in df.columns and pd.notna(r[c]) and str(r[c]).strip() else dflt)
        s.add(Txn(owner=me, type=typ, amount=amt, date=d.date(), category=g("category", "Other")[:60], mode=g("mode", "Other")[:40], note=g("note", "")[:300]))
        n += 1
    s.commit()
    return {"imported": n, "skipped": int(len(df) - n)}


# ---------- categories, budgets, goals, recurring ----------
class CatIn(BaseModel):
    type: Literal["credit", "debit"]
    name: str = Field(min_length=1, max_length=40)


class BudgetIn(BaseModel):
    category: str = Field(min_length=1, max_length=60)
    amount: float = Field(ge=0, lt=1e10)


class GoalIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    target: float = Field(gt=0, lt=1e10)
    saved: float = Field(0, ge=0, lt=1e10)


class RecIn(BaseModel):
    type: Literal["credit", "debit"]
    amount: float = Field(gt=0, lt=1e10)
    category: str = Field(min_length=1, max_length=60)
    mode: str = Field(min_length=1, max_length=40)
    note: str = Field("", max_length=300)
    day: int = Field(ge=1, le=31)


def _clean(o):
    """Replace NaN / infinity (not valid JSON) with None, recursively."""
    if isinstance(o, float):
        return o if o == o and o not in (float("inf"), float("-inf")) else None
    if isinstance(o, dict):
        return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, list):
        return [_clean(v) for v in o]
    return o


def _budgets(s: Session, me: str) -> dict:
    return {b.category: b.amount for b in s.query(Budget).filter(Budget.owner == me)}


def _owned(s: Session, model, me: str, oid: int):
    o = s.query(model).filter(model.id == oid, model.owner == me).first()
    if not o:
        raise HTTPException(404, "Not found")
    return o


@app.post("/categories", status_code=201)
def add_cat(body: CatIn, me: str = Depends(user), s: Session = Depends(db)):
    name = body.name.strip()
    if not s.query(Cat).filter(Cat.owner == me, Cat.type == body.type, Cat.name == name).first():
        s.add(Cat(owner=me, type=body.type, name=name)); s.commit()
    return {"type": body.type, "name": name}


@app.put("/categories/{cid}")
def rename_cat(cid: int, body: dict, me: str = Depends(user), s: Session = Depends(db)):
    c = _owned(s, Cat, me, cid)
    name = str(body.get("name", "")).strip()[:40]
    if not name:
        raise HTTPException(400, "Name required")
    if name != c.name and s.query(Cat).filter(Cat.owner == me, Cat.type == c.type, Cat.name == name).first():
        raise HTTPException(400, "That category already exists")
    old = c.name
    s.query(Txn).filter(Txn.owner == me, Txn.type == c.type, Txn.category == old).update({"category": name})
    s.query(Rec).filter(Rec.owner == me, Rec.type == c.type, Rec.category == old).update({"category": name})
    if c.type == "debit" and not s.query(Budget).filter(Budget.owner == me, Budget.category == name).first():
        s.query(Budget).filter(Budget.owner == me, Budget.category == old).update({"category": name})
    c.name = name
    s.commit()
    return {"ok": True}


@app.delete("/categories/{cid}")
def del_cat(cid: int, me: str = Depends(user), s: Session = Depends(db)):
    s.delete(_owned(s, Cat, me, cid)); s.commit()
    return {"deleted": cid}


@app.put("/budgets")
def set_budget(body: BudgetIn, me: str = Depends(user), s: Session = Depends(db)):
    b = s.query(Budget).filter(Budget.owner == me, Budget.category == body.category).first()
    if body.amount == 0:
        if b:
            s.delete(b)
    elif b:
        b.amount = body.amount
    else:
        s.add(Budget(owner=me, category=body.category, amount=body.amount))
    s.commit()
    return {"ok": True}


@app.post("/goals", status_code=201)
def add_goal(body: GoalIn, me: str = Depends(user), s: Session = Depends(db)):
    g = Goal(owner=me, **body.model_dump()); s.add(g); s.commit()
    return {"id": g.id}


@app.put("/goals/{gid}")
def edit_goal(gid: int, body: GoalIn, me: str = Depends(user), s: Session = Depends(db)):
    g = _owned(s, Goal, me, gid)
    g.name, g.target, g.saved = body.name, body.target, body.saved
    s.commit()
    return {"ok": True}


@app.delete("/goals/{gid}")
def del_goal(gid: int, me: str = Depends(user), s: Session = Depends(db)):
    s.delete(_owned(s, Goal, me, gid)); s.commit()
    return {"deleted": gid}


@app.post("/recurring", status_code=201)
def add_rec(body: RecIn, me: str = Depends(user), s: Session = Depends(db)):
    r = Rec(owner=me, start=Date.today().strftime("%Y-%m"), **body.model_dump())
    s.add(r); s.commit()
    return {"id": r.id}


@app.delete("/recurring/{rid}")
def del_rec(rid: int, me: str = Depends(user), s: Session = Depends(db)):
    s.delete(_owned(s, Rec, me, rid)); s.commit()
    return {"deleted": rid}


def run_recurring(s: Session, me: str) -> int:
    """Create due entries from recurring rules (once per month per rule)."""
    today, made = Date.today(), 0
    for r in s.query(Rec).filter(Rec.owner == me).all():
        y, m = map(int, (r.last_run or r.start).split("-"))
        if r.last_run:
            y, m = (y + 1, 1) if m == 12 else (y, m + 1)
        while (y, m) <= (today.year, today.month):
            d = Date(y, m, min(r.day, calendar.monthrange(y, m)[1]))
            if d > today:
                break
            s.add(Txn(owner=me, type=r.type, amount=r.amount, date=d, category=r.category, mode=r.mode, note=r.note or f"{r.category} (auto)"))
            r.last_run, made = f"{y}-{m:02d}", made + 1
            y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    if made:
        s.commit()
    return made


@app.get("/bootstrap")
def bootstrap(month: Optional[str] = None, me: str = Depends(user), s: Session = Depends(db)):
    """Everything the app needs in ONE request (fast on phone and handles cold start once)."""
    run_recurring(s, me)
    sm = _split_map(s, me)
    rows = [out(t, sm) for t in s.query(Txn).filter(Txn.owner == me).order_by(Txn.date.desc(), Txn.id.desc()).all()]
    buds = _budgets(s, me)
    return {
        "analytics": _clean(analyze(_eff_rows(s, me), month, buds)),
        "friends": _friends(s, me),
        "transactions": rows,
        "categories": [{"id": c.id, "type": c.type, "name": c.name} for c in s.query(Cat).filter(Cat.owner == me).order_by(Cat.name)],
        "budgets": [{"category": k, "amount": v} for k, v in buds.items()],
        "goals": [{"id": g.id, "name": g.name, "target": g.target, "saved": g.saved} for g in s.query(Goal).filter(Goal.owner == me).order_by(Goal.id)],
        "recurring": [{"id": r.id, "type": r.type, "amount": r.amount, "category": r.category, "mode": r.mode, "note": r.note or "", "day": r.day} for r in s.query(Rec).filter(Rec.owner == me).order_by(Rec.day)],
    }


# ---------- friends (shared expenses) ----------
class LedgerIn(BaseModel):
    friend: str = Field(min_length=1, max_length=60)
    amount: float = Field(gt=-1e10, lt=1e10)  # + friend owes you more, - friend owes you less / you owe friend
    date: Date
    kind: Literal["settle", "manual"]
    note: str = Field("", max_length=300)


def _friends(s: Session, me: str) -> list:
    info = {t.id: (t.category, t.note, t.amount) for t in s.query(Txn).filter(Txn.owner == me)}
    g: dict = {}
    for r in s.query(Ledger).filter(Ledger.owner == me).order_by(Ledger.date.desc(), Ledger.id.desc()):
        f = g.setdefault(r.friend.lower(), {"name": r.friend, "balance": 0.0, "items": []})
        f["balance"] += r.amount
        label, total = r.note or "", None
        if r.kind == "split" and r.txn_id in info:
            cat, note, total = info[r.txn_id]
            label = cat + (f" · {note}" if note else "")
        f["items"].append({"id": r.id, "date": r.date.isoformat(), "amount": r.amount, "kind": r.kind,
                           "label": label, "total": total, "txn_id": r.txn_id})
    out_ = []
    for f in g.values():
        f["balance"] = 0.0 if abs(f["balance"]) < 0.005 else round(f["balance"], 2)
        out_.append(f)
    return sorted(out_, key=lambda f: -abs(f["balance"]))


@app.post("/ledger", status_code=201)
def add_ledger(body: LedgerIn, me: str = Depends(user), s: Session = Depends(db)):
    if body.amount == 0:
        raise HTTPException(400, "Amount cannot be 0")
    s.add(Ledger(owner=me, friend=body.friend.strip(), amount=body.amount, date=body.date, kind=body.kind, note=body.note))
    s.commit()
    return {"ok": True}


@app.delete("/ledger/{lid}")
def del_ledger(lid: int, me: str = Depends(user), s: Session = Depends(db)):
    r = _owned(s, Ledger, me, lid)
    if r.kind == "split":
        raise HTTPException(400, "Edit or delete the original entry instead")
    s.delete(r); s.commit()
    return {"deleted": lid}
