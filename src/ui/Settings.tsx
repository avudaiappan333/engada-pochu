// Settings: account, PIN, spoken feedback, export/import (with conflict
// preview — never silent overwrites), sync status + conflict log, sign out.

import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { useLedger } from './context';
import { PinSetupCard, removePin } from './AuthPin';
import {
  buildCSV,
  buildExport,
  previewImport,
  repo,
  newId,
  type ExportBundle,
} from '../data/repo';
import { syncEngine } from '../data/sync';
import { signOutAll } from '../data/auth';
import { CLOUD_ENABLED } from '../data/config';
import { hasPin } from '../data/auth';
import { fmtINR } from '../domain/amounts';
import type { Category, Person, Tx } from '../domain/types';

async function exportFile(filename: string, content: string, mime: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const res = await Filesystem.writeFile({
      path: filename,
      data: content,
      directory: Directory.Documents,
      recursive: true,
    });
    try {
      await Share.share({ title: 'Engada Pochu backup', files: [res.uri] });
    } catch {
      // user dismissed share sheet — file still saved
    }
  } else {
    const blob = new Blob([content], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
}

export function SettingsSheet({
  email,
  onSignedOut,
  onClose,
}: {
  email: string | null;
  onSignedOut: () => void;
  onClose: () => void;
}) {
  const { txs, people, cats, sync, pushToast } = useLedger();
  const [spoken, setSpoken] = useState(true);
  const [pinExists, setPinExists] = useState(false);
  const [log, setLog] = useState<{ at: string; note: string }[]>([]);
  const [importPreview, setImportPreview] = useState<{
    willAdd: number;
    willSkip: number;
    valid: number;
    invalid: number;
    peopleToAdd: number;
    categoriesToAdd: number;
    bundle: ExportBundle;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => {
    void hasPin().then(setPinExists);
    void syncEngine.syncLog().then((l) => setLog(l.map((x) => ({ at: x.at, note: `${x.kind} · ${x.note}` }))));
  };
  useEffect(refresh, []);

  const toggleSpoken = async () => {
    const next = !spoken;
    setSpoken(next);
    await repo.setMeta('settings', { ...((await repo.getMeta<Record<string, unknown>>('settings')) ?? {}), spoken_feedback: next });
  };

  const doExportJSON = async () => {
    const bundle = buildExport(txs, people, cats);
    const stamp = new Date().toISOString().slice(0, 10);
    await exportFile(`engada-pochu-backup-${stamp}.json`, JSON.stringify(bundle, null, 2), 'application/json');
    pushToast('Backup exported ✓');
  };

  const doExportCSV = async () => {
    const stamp = new Date().toISOString().slice(0, 10);
    await exportFile(`engada-pochu-${stamp}.csv`, buildCSV(txs, people, cats), 'text/csv');
    pushToast('CSV exported ✓');
  };

  const onImportFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const res = previewImport(parsed, txs, people, cats);
      if (!res.ok) {
        pushToast(res.error ?? 'Import failed.');
        return;
      }
      setImportPreview({
        willAdd: res.preview.willAdd,
        willSkip: res.preview.willSkip,
        valid: res.preview.valid,
        invalid: res.preview.invalid,
        peopleToAdd: res.preview.peopleToAdd,
        categoriesToAdd: res.preview.categoriesToAdd,
        bundle: res.bundle as ExportBundle,
      });
    } catch {
      pushToast('Could not read that file (invalid JSON?).');
    }
  };

  const applyImport = async () => {
    if (!importPreview) return;
    const b = importPreview.bundle;
    const existingPeople = people;
    const existingCats = cats;
    for (const p of b.people) {
      if (!p || p.deleted_at) continue;
      if (existingPeople.some((x) => x.id === p.id || x.name.toLowerCase() === String(p.name).toLowerCase())) continue;
      await repo.upsertPerson({ ...p, user_id: repo.userId } as Person);
    }
    for (const c of b.categories) {
      if (!c || c.deleted_at) continue;
      if (existingCats.some((x) => x.id === c.id || x.name.toLowerCase() === String(c.name).toLowerCase())) continue;
      await repo.upsertCategory({ ...c, user_id: repo.userId } as Category);
    }
    const known = await repo.listTransactions();
    const sigs = new Set(
      known.filter((t) => !t.deleted_at).map((t) => `${t.occurred_at}|${t.amount}|${t.person_id ?? ''}|${t.direction}`),
    );
    const ids = new Set(known.map((t) => t.id));
    let added = 0;
    for (const t of b.transactions) {
      if (!t || typeof t.id !== 'string') continue;
      const sig = `${t.occurred_at}|${t.amount}|${t.person_id ?? ''}|${t.direction}`;
      if (ids.has(t.id) || sigs.has(sig)) continue; // skip existing
      await repo.saveTransaction({
        ...t,
        user_id: repo.userId,
        deleted_at: null,
        updated_at: null,
      } as Tx);
      added++;
    }
    pushToast(`Import done — ${added} added, existing entries untouched.`);
    setImportPreview(null);
  };

  const stamp = (s: string | null) =>
    s ? new Date(s).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

  return (
    <div className="content">
      <div className="card">
        <h3>Account</h3>
        <div className="setting-row">
          <div>
            {CLOUD_ENABLED ? email ?? 'Cloud account' : 'Local only mode'}
            <div className="desc">
              {CLOUD_ENABLED
                ? 'Data synced to your Supabase project. Email OTP login.'
                : 'Supabase is not configured — all data stays on this device.'}
            </div>
          </div>
        </div>
        <div className="setting-row">
          <div>
            Sync
            <div className="desc">
              {sync.state === 'disabled'
                ? 'Disabled (local mode)'
                : `${sync.state === 'synced' ? 'Synced' : sync.state} · last ${stamp(sync.last_sync_at)}`}
            </div>
          </div>
          <span className={`sync-pill ${sync.state === 'synced' ? 'ok' : sync.state === 'offline' ? 'offline' : 'pending'}`}>
            {sync.state === 'synced' ? '✓' : sync.pending > 0 ? `${sync.pending}` : sync.state}
          </span>
        </div>
        {sync.error && <div className="muted small" style={{ color: 'var(--danger)' }}>{sync.error}</div>}
        {log.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div className="muted small" style={{ marginBottom: 4 }}>Sync notes (rare conflicts are recorded here, never silent):</div>
            {log.slice(0, 5).map((l, i) => (
              <div key={i} className="small muted">• {stamp(l.at)} — {l.note}</div>
            ))}
          </div>
        )}
        {CLOUD_ENABLED && (
          <div className="btn-row" style={{ marginTop: 10 }}>
            <button
              className="btn danger"
              onClick={() => {
                void signOutAll().then(() => {
                  pushToast('Signed out. Local data cleared.');
                  onSignedOut();
                  onClose();
                });
              }}
            >
              Sign out & clear this device
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <h3>Security</h3>
        {pinExists ? (
          <div className="setting-row">
            <div>
              Device PIN
              <div className="desc">Enabled — asked on every launch</div>
            </div>
            <button className="btn small" onClick={() => { void removePin(); setPinExists(false); pushToast('PIN removed.'); }}>
              Remove PIN
            </button>
          </div>
        ) : (
          <PinSetupCard />
        )}
      </div>

      <div className="card">
        <h3>Voice</h3>
        <div className="setting-row">
          <div>
            Spoken confirmation
            <div className="desc">Short English phrase after a save (on-device TTS, no API)</div>
          </div>
          <div className={`toggle ${spoken ? 'on' : ''}`} onClick={() => void toggleSpoken()} role="switch" aria-checked={spoken} />
        </div>
      </div>

      <div className="card">
        <h3>Backup & data</h3>
        <div className="btn-row">
          <button className="btn" onClick={() => void doExportJSON()}>Export JSON</button>
          <button className="btn" onClick={() => void doExportCSV()}>Export CSV</button>
        </div>
        <div className="divider" />
        <div className="muted small" style={{ marginBottom: 8 }}>
          Import JSON backup — existing entries are never overwritten or deleted;
          you’ll see a preview before anything is written.
        </div>
        <button className="btn" onClick={() => fileRef.current?.click()}>Import JSON…</button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onImportFile(f);
            e.target.value = '';
          }}
        />
        {importPreview && (
          <div className="card" style={{ marginTop: 10, borderColor: 'rgba(0,212,255,0.5)' }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Import preview</div>
            <div className="small">
              • {importPreview.valid} valid transactions{importPreview.invalid > 0 ? `, ${importPreview.invalid} invalid (ignored)` : ''}
              <br />• <b style={{ color: 'var(--ok)' }}>{importPreview.willAdd} will be added</b>
              <br />• {importPreview.willSkip} already exist → skipped
              <br />• +{importPreview.peopleToAdd} new people, +{importPreview.categoriesToAdd} new categories
            </div>
            <div className="btn-row" style={{ marginTop: 10 }}>
              <button className="btn" onClick={() => setImportPreview(null)}>Cancel</button>
              <button className="btn primary" onClick={() => void applyImport()}>Apply import</button>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <h3>About</h3>
        <div className="muted small">
          Engada Pochu v1.0 — “Where did it go?”
          <br />
          Voice: Web Speech API (browser) / native Android recognizer (APK) — both free, no API key.
          <br />
          Totals for all time: {fmtINR(txs.reduce((a, t) => (!t.deleted_at && t.direction === 'sent' ? a + t.amount : a), 0))} sent / {fmtINR(txs.reduce((a, t) => (!t.deleted_at && t.direction === 'received' ? a + t.amount : a), 0))} received.
        </div>
      </div>
    </div>
  );
}

export { newId };
