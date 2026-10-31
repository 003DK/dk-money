import { supabase } from './supabase'
const BASE = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '')

async function req(path, opts = {}) {
  const { data } = await supabase.auth.getSession()
  const headers = { Authorization: `Bearer ${data.session?.access_token}` }
  if (opts.body && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json'
  const res = await fetch(BASE + path, { ...opts, headers })
  if (!res.ok) {
    let msg = res.statusText
    try { const j = await res.json(); msg = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail) } catch {}
    throw new Error(msg)
  }
  return opts.blob ? res.blob() : res.json()
}

export const api = {
  wake: () => fetch(BASE + '/health').catch(() => {}),
  list: () => req('/transactions'),
  add: (t) => req('/transactions', { method: 'POST', body: JSON.stringify(t) }),
  edit: (id, t) => req(`/transactions/${id}`, { method: 'PUT', body: JSON.stringify(t) }),
  remove: (id) => req(`/transactions/${id}`, { method: 'DELETE' }),
  analytics: (month) => req('/analytics' + (month ? `?month=${month}` : '')),
  exportCsv: () => req('/export', { blob: true }),
  importCsv: (file) => { const f = new FormData(); f.append('file', file); return req('/import', { method: 'POST', body: f }) },
}

export const inr = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN')
export const DEBIT_CATS = ['Food', 'Groceries', 'Travel', 'Bills & Recharge', 'Rent / EMI', 'Shopping', 'Entertainment', 'Health', 'Education', 'Friends & Family', 'Investment', 'Other']
export const CREDIT_CATS = ['Salary', 'Business', 'Refund', 'Received from friend', 'Interest', 'Investment return', 'Other']
export const MODES = ['UPI', 'Cash', 'Debit Card', 'Credit Card', 'Net Banking', 'Wallet', 'Other']
export const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10) }
