// App shell: auth phases, ledger provider, tabs, mic state, sheets.

import { useCallback, useEffect, useState } from 'react';
import { CLOUD_ENABLED, supabase } from './data/config';
import { ensureProfile, getSessionUserId, hasPin, onAuthChange } from './data/auth';
import { repo } from './data/repo';
import { syncEngine } from './data/sync';
import { LedgerProvider, useLedger } from './ui/context';
import { AuthScreen, PinScreen } from './ui/AuthPin';
import { HomeScreen } from './ui/Home';
import { DetailSheet, ListScreen } from './ui/List';
import { ConfirmSheet } from './ui/Confirm';
import { ManualSheet } from './ui/Manual';
import { PeopleScreen } from './ui/People';
import { InsightsScreen } from './ui/Insights';
import { SettingsSheet } from './ui/Settings';
import { useVoice } from './voice/useVoice';
import { EMPTY_FILTER, type QueryFilter, type Tx } from './domain/types';
import { Icon, SyncPill } from './ui/components';

type Tab = 'home' | 'list' | 'people' | 'insights';

function Shell() {
  const { people, cats, txs, setFilters, cloud, sync, pushToast } = useLedger();
  const [tab, setTab] = useState<Tab>('home');
  const [showManual, setShowManual] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ cands: import('./domain/types').ParsedCandidate[]; raw: string; key: number } | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    if (CLOUD_ENABLED && supabase) {
      void supabase.auth.getSession().then(({ data }) => {
        setEmail(data.session?.user?.email ?? null);
      });
    }
  }, []);

  const mic = useVoice(
    { people, categories: cats },
    {
      onCandidates: (cands, raw) => setConfirm({ cands, raw, key: Date.now() }),
      onQuery: (f: QueryFilter) => {
        setFilters({ ...EMPTY_FILTER, ...f });
        pushToast('Filter applied');
        setTab('list');
      },
      onSaved: () => {},
      onDone: () => setConfirm(null),
    },
  );

  const detailTx: Tx | null = detailId ? (txs.find((t) => t.id === detailId) ?? null) : null;

  const openMic = useCallback(() => {
    if (mic.state === 'listening') mic.stopListening();
    else mic.start();
  }, [mic]);

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          Engada <span className="accent">Pochu</span>
        </div>
        <div className="top-actions">
          <SyncPill state={sync.state} pending={sync.pending} cloud={cloud} />
          <button className="icon-btn" onClick={() => setShowManual(true)} aria-label="Add manually">
            <Icon name="plus" />
          </button>
          <button className="icon-btn" onClick={() => setShowSettings(true)} aria-label="Settings">
            <Icon name="gear" />
          </button>
        </div>
      </div>

      {tab === 'home' && (
        <HomeScreen
          mic={mic}
          onOpenMic={openMic}
          onOpenManual={() => setShowManual(true)}
          onOpenTx={(id) => setDetailId(id)}
          onGoList={() => setTab('list')}
        />
      )}
      {tab === 'list' && <ListScreen onOpenTx={(id) => setDetailId(id)} onBack={() => setTab('home')} />}
      {tab === 'people' && <PeopleScreen onOpenTx={(id) => setDetailId(id)} />}
      {tab === 'insights' && <InsightsScreen onOpenTx={(id) => setDetailId(id)} />}

      <nav className="tabbar">
        <div className="tabbar-inner">
          <button className={`tab ${tab === 'home' ? 'on' : ''}`} onClick={() => setTab('home')}>
            <Icon name="home" />
            <span>Home</span>
          </button>
          <button className={`tab ${tab === 'list' ? 'on' : ''}`} onClick={() => setTab('list')}>
            <Icon name="list" />
            <span>Entries</span>
          </button>
          <button
            className={`tab-mic ${mic.state === 'listening' ? 'listening' : ''}`}
            onClick={() => {
              setTab('home');
              if (mic.state !== 'listening' && mic.state !== 'processing' && mic.state !== 'confirming') {
                mic.start();
              }
            }}
            aria-label="Voice input"
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z" fill="#fff" />
              <path d="M6.5 11.5a5.5 5.5 0 0 0 11 0" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M12 17.5V21" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
          <button className={`tab ${tab === 'people' ? 'on' : ''}`} onClick={() => setTab('people')}>
            <Icon name="people" />
            <span>People</span>
          </button>
          <button className={`tab ${tab === 'insights' ? 'on' : ''}`} onClick={() => setTab('insights')}>
            <Icon name="insights" />
            <span>Insights</span>
          </button>
        </div>
      </nav>

      {showManual && <ManualSheet onClose={() => setShowManual(false)} />}
      {showSettings && (
        <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && setShowSettings(false)}>
          <div className="sheet" style={{ maxHeight: '92vh' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0 }}>Settings</h2>
              <button className="btn small" onClick={() => setShowSettings(false)}>✕</button>
            </div>
            <SettingsSheet email={email} onClose={() => setShowSettings(false)} onSignedOut={() => setTab('home')} />
          </div>
        </div>
      )}
      {detailTx && <DetailSheet tx={detailTx} onClose={() => setDetailId(null)} />}
      {confirm && (
        <ConfirmSheet
          key={confirm.key}
          cands={confirm.cands}
          raw={confirm.raw}
          mic={mic}
          onCancel={() => { setConfirm(null); mic.cancel(); }}
          onRetry={() => { setConfirm(null); mic.retry(); }}
          onConfirmed={() => {}}
        />
      )}
    </div>
  );
}

export default function App() {
  const [phase, setPhase] = useState<'boot' | 'auth' | 'pin' | 'main'>('boot');
  const [email, setEmail] = useState<string | null>(null);

  // One-time boot: decide auth phase from the saved session (or local mode).
  useEffect(() => {
    let on = true;
    (async () => {
      if (!CLOUD_ENABLED) {
        repo.bindUser('local');
        setPhase('main');
        return;
      }
      const uid = await getSessionUserId();
      if (!on) return;
      if (!uid) {
        setPhase('auth');
        return;
      }
      repo.bindUser(uid);
      let sessEmail: string | null = null;
      if (supabase) {
        const { data } = await supabase.auth.getSession();
        sessEmail = data.session?.user?.email ?? null;
      }
      setEmail(sessEmail);
      try {
        await ensureProfile(uid);
      } catch {
        // seeding retried on next sync
      }
      if (await hasPin()) setPhase('pin');
      else setPhase('main');
    })();
    const un = onAuthChange((uid) => {
      if (uid) setPhase('main');
    });
    return () => {
      on = false;
      un();
    };
  }, []);

  if (phase === 'boot') {
    return (
      <div className="auth-wrap">
        <div className="muted">Loading Engada Pochu…</div>
      </div>
    );
  }
  if (phase === 'auth') {
    return (
      <AuthScreen
        onAuthed={(uid) => {
          void (async () => {
            repo.bindUser(uid);
            try {
              await ensureProfile(uid);
            } catch {
              // retried on sync
            }
            const pin = await hasPin();
            setPhase(pin ? 'pin' : 'main');
          })();
        }}
      />
    );
  }
  if (phase === 'pin') {
    return <PinScreen email={email} onOk={() => setPhase('main')} />;
  }

  return (
    <LedgerProvider>
      <Shell />
    </LedgerProvider>
  );
}
