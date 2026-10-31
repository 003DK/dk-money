import { useState } from 'react'
import { supabase } from './supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const allowed = (import.meta.env.VITE_ALLOWED_EMAIL || '').toLowerCase()

  async function submit(e) {
    e.preventDefault()
    setErr('')
    if (allowed && email.trim().toLowerCase() !== allowed) return setErr('This email is not allowed.')
    setBusy(true)
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: window.location.origin + window.location.pathname } })
    setBusy(false)
    error ? setErr(error.message) : setSent(true)
  }

  return (
    <div className="center">
      <form className="card login" onSubmit={submit}>
        <div className="logo">💰</div>
        <h1>DK Money</h1>
        <p className="muted">Sign in with your email. We will send you a one-tap login link.</p>
        {sent ? (
          <p className="ok">Check your inbox and open the link on this device.</p>
        ) : (
          <>
            <input type="email" required placeholder="you@gmail.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            {err && <p className="err">{err}</p>}
            <button className="btn primary" disabled={busy}>{busy ? 'Sending…' : 'Send login link'}</button>
          </>
        )}
      </form>
    </div>
  )
}
