import { useState } from 'react'

const KEY = 'dk_pin'
const hash = async (s) => {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('dkmoney:' + s))
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
}
export const hasPin = () => !!localStorage.getItem(KEY)
export const clearPin = () => localStorage.removeItem(KEY)

// mode: 'set' (create a PIN) or 'enter' (unlock)
export default function PinLock({ mode, onDone, onSkip, onSignOut }) {
  const [pin, setPin] = useState('')
  const [first, setFirst] = useState('')
  const [err, setErr] = useState('')
  const creating = mode === 'set'
  const confirming = creating && first

  async function press(d) {
    const next = (pin + d).slice(0, 4)
    setPin(next); setErr('')
    if (next.length < 4) return
    if (mode === 'enter') {
      if ((await hash(next)) === localStorage.getItem(KEY)) onDone()
      else { setErr('Wrong PIN'); setPin('') }
    } else if (!first) { setFirst(next); setPin('') }
    else if (first === next) { localStorage.setItem(KEY, await hash(next)); onDone() }
    else { setErr('PINs did not match. Start again.'); setFirst(''); setPin('') }
  }

  return (
    <div className="center">
      <div className="card pin">
        <div className="logo">🔒</div>
        <h2>{creating ? (confirming ? 'Confirm your PIN' : 'Create a 4-digit PIN') : 'Enter PIN'}</h2>
        <div className="dots">{[0, 1, 2, 3].map((i) => <span key={i} className={i < pin.length ? 'on' : ''} />)}</div>
        {err && <p className="err">{err}</p>}
        <div className="keys">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => <button key={n} onClick={() => press(n)}>{n}</button>)}
          <button onClick={() => setPin(pin.slice(0, -1))}>⌫</button>
          <button onClick={() => press(0)}>0</button>
        </div>
        {creating && <button className="link" onClick={onSkip}>Skip for now</button>}
        {!creating && <button className="link" onClick={onSignOut}>Forgot PIN? Sign out</button>}
      </div>
    </div>
  )
}
