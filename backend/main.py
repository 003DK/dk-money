import io
import os
import time
from datetime import date as Date, datetime
from typing import Literal, Optional

import httpx
import pandas as pd
from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import Column, Date as SADate, DateTime, Float, Integer, String, create_engine
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


Base.metadata.create_all(engine)

app = FastAPI(title="DK Money API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()],
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
        try:
            r = httpx.get(f"{SUPABASE_URL}/auth/v1/user", headers={"Authorization": f"Bearer {token}", "apikey": SUPABASE_ANON_KEY}, timeout=10)
        except httpx.HTTPError:
            raise HTTPException(503, "Auth service unreachable")
        if r.status_code != 200:
            raise HTTPException(401, "Invalid or expired session")
        email = (r.json().get("email") or "").lower()
        _cache[token] = (email, time.time() + 300)
    if not ALLOWED or email not in ALLOWED:
        raise HTTPException(403, "This email is not allowed")
    return email


def db():
    s = Session_()
    try:
        yield s
    finally:
        s.close()


class TxnIn(BaseModel):
    type: Literal["credit", "debit"]
    amount: float = Field(gt=0, lt=1e10)
    date: Date
    category: str = Field(min_length=1, max_length=60)
    mode: str = Field(min_length=1, max_length=40)
    note: str = Field("", max_length=300)


def out(t: Txn) -> dict:
    return {"id": t.id, "type": t.type, "amount": t.amount, "date": t.date.isoformat(), "category": t.category, "mode": t.mode, "note": t.note or ""}


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
    return [out(t) for t in q.order_by(Txn.date.desc(), Txn.id.desc()).all()]


@app.post("/transactions", status_code=201)
def add_txn(body: TxnIn, me: str = Depends(user), s: Session = Depends(db)):
    t = Txn(owner=me, **body.model_dump())
    s.add(t); s.commit(); s.refresh(t)
    return out(t)


def _get(s: Session, me: str, tid: int) -> Txn:
    t = s.query(Txn).filter(Txn.id == tid, Txn.owner == me).first()
    if not t:
        raise HTTPException(404, "Not found")
    return t


@app.put("/transactions/{tid}")
def edit_txn(tid: int, body: TxnIn, me: str = Depends(user), s: Session = Depends(db)):
    t = _get(s, me, tid)
    for k, v in body.model_dump().items():
        setattr(t, k, v)
    s.commit(); s.refresh(t)
    return out(t)


@app.delete("/transactions/{tid}")
def del_txn(tid: int, me: str = Depends(user), s: Session = Depends(db)):
    s.delete(_get(s, me, tid)); s.commit()
    return {"deleted": tid}


@app.get("/analytics")
def analytics(month: Optional[str] = None, me: str = Depends(user), s: Session = Depends(db)):
    rows = [out(t) for t in s.query(Txn).filter(Txn.owner == me).all()]
    return analyze(rows, month)


@app.get("/export")
def export(me: str = Depends(user), s: Session = Depends(db)):
    rows = [out(t) for t in s.query(Txn).filter(Txn.owner == me).order_by(Txn.date).all()]
    df = pd.DataFrame(rows, columns=["date", "type", "amount", "category", "mode", "note"])
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
