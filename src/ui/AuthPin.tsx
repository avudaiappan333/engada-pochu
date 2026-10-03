// Auth (cloud: email → OTP → optional PIN) and the device PIN gate.

import { useState } from 'react';
import {
  clearPin,
  sendEmailOtp,
  setPin,
  verifyEmailOtp,
  verifyPin,
} from '../data/auth';

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function AuthScreen({ onAuthed }: { onAuthed: (userId: string) => void }) {
  const [email, setEmail] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Enter a valid email address.');
      return;
    }
    setBusy(true);
    setError(null);
    const r = await sendEmailOtp(email);
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? 'Could not send code.');
      return;
    }
    setStep('code');
  };

  const verify = async () => {
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code from your email.');
      return;
    }
    setBusy(true);
    setError(null);
    const r = await verifyEmailOtp(email, code);
    setBusy(false);
    if (!r.ok || !r.userId) {
      setError(r.error ?? 'Code not accepted.');
      return;
    }
    onAuthed(r.userId);
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card card">
        <div className="auth-logo">🎙️</div>
        <div className="auth-title">
          Engada <span className="accent">Pochu</span>
        </div>
        <div className="auth-sub">
          Sign in with your email. We send a one-time code — no password is stored.
          Your data is tied to this email.
        </div>
        {step === 'email' ? (
          <>
            <Field label="Email">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </Field>
            {error && <div className="muted small" style={{ color: 'var(--danger)' }}>{error}</div>}
            <button className="btn primary" onClick={() => void send()} disabled={busy}>
              {busy ? 'Sending…' : 'Send code'}
            </button>
          </>
        ) : (
          <>
            <Field label={`One-time code sent to ${email}`}>
              <input
                inputMode="numeric"
                value={code}
                maxLength={6}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="123456"
                style={{ textAlign: 'center', letterSpacing: '0.5em' }}
              />
            </Field>
            {error && <div className="muted small" style={{ color: 'var(--danger)' }}>{error}</div>}
            <button className="btn primary" onClick={() => void verify()} disabled={busy}>
              {busy ? 'Checking…' : 'Verify & continue'}
            </button>
            <button className="btn ghost small" onClick={() => { setStep('email'); setCode(''); setError(null); }}>
              ← Change email
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function PinScreen({ email, onOk }: { email: string | null; onOk: () => void }) {
  const [pin, setPinVal] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const ok = await verifyPin(pin);
    setBusy(false);
    if (ok) onOk();
    else setError('Wrong PIN. Try again.');
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card card">
        <div className="auth-logo">🔒</div>
        <div className="auth-title">Enter PIN</div>
        <div className="auth-sub">
          {email ? `Signed in as ${email}` : 'Device PIN'} — your ledger stays locked until you unlock it.
        </div>
        <input
          type="password"
          inputMode="numeric"
          value={pin}
          autoFocus
          maxLength={8}
          onChange={(e) => setPinVal(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
          placeholder="••••"
          style={{ textAlign: 'center', fontSize: '1.4rem', letterSpacing: '0.4em' }}
        />
        {error && <div className="muted small" style={{ color: 'var(--danger)' }}>{error}</div>}
        <button className="btn primary" onClick={() => void submit()} disabled={busy || pin.length < 4}>
          Unlock
        </button>
      </div>
    </div>
  );
}

export function PinSetupCard() {
  const [open, setOpen] = useState(false);
  const [pin, setPinVal] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const save = async () => {
    try {
      await setPin(pin);
      setMsg('PIN set. The app will ask for it on next launch.');
      setPinVal('');
      setOpen(false);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not set PIN');
    }
  };

  if (!open) {
    return (
      <div className="setting-row">
        <div>
          Device PIN
          <div className="desc">Optional 4–8 digit lock, stored only on this device</div>
        </div>
        <button className="btn small" onClick={() => setOpen(true)}>
          Set PIN
        </button>
      </div>
    );
  }
  return (
    <div className="row" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="muted small">Set a 4–8 digit PIN (stored only on this device, never uploaded).</div>
      <input
        type="password"
        inputMode="numeric"
        value={pin}
        maxLength={8}
        onChange={(e) => setPinVal(e.target.value.replace(/\D/g, ''))}
        placeholder="••••"
      />
      {msg && <div className="muted small">{msg}</div>}
      <div className="btn-row">
        <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
        <button className="btn primary" onClick={() => void save()} disabled={pin.length < 4}>
          Save PIN
        </button>
      </div>
    </div>
  );
}

export async function removePin(): Promise<void> {
  await clearPin();
}
