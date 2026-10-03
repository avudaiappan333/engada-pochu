# Engada Pochu — Requirements & Architecture (v1)

**"Where did it go?"** — a voice-controlled personal expense tracker for Android,
built as a web app → Capacitor → APK.

Status: requirements collected (5 stages of questions), architecture pending approval.

---

## 1. Confirmed decisions

### 1.1 Language
- v1: **English voice commands + English UI only.**
- Tamil phase later (UI, commands, mixed speech, spoken responses) — architecture
  keeps i18n hooks so text can be externalised, but v1 ships English.

### 1.2 Voice
- Online voice is acceptable in v1.
- Browser: Web Speech API (webkitSpeechRecognition) — free, no key, online.
- Android APK: `@capacitor-community/speech-recognition` → native Android
  SpeechRecognizer — free, no key, supports offline if Google's offline language
  pack is installed on the phone.
- Live transcript shown while speaking.
- Nothing uncertain is ever auto-saved: Speak → transcript → parser → confirmation
  card → user confirms → save.
- Voice commands must not be the only path — manual entry always available.

### 1.3 Storage & sync
- **Cloud (Supabase) is the source of truth from day one.**
- Local: IndexedDB full cache + outbox queue + last_sync_at (offline cache + auto-sync).
- Offline must fully work: view, manual add, edit, delete, search, filters, totals,
  insights. Only voice (browser) and sync need internet; the app states this clearly.
- Conflict rule: last-write-wins by `updated_at` (single user); conflicts surfaced in
  a sync log in Settings — never silently dropped.
- Deletions use tombstones (soft delete) so deletes propagate.
- Sync triggers: app open, network recovery, every 60 s in foreground; batch push.
- UI status pill: `Synced ✓ / N pending / Offline`.

### 1.4 Authentication
- Supabase **email OTP** (free, no credit card).
- Optional **6-digit device PIN**: hashed on device (salted SHA-256), stored in
  IndexedDB, never uploaded; gate before data is shown.
- New phone: 30-second email-OTP re-login; data follows the email account.
- Sign-out in Settings (confirms local cache wipe).

### 1.5 Data rules
- Whole rupees only in v1 (schema stores numeric(14,2) — relaxable later).
- INR only in v1 (schema has `currency` — multi-currency ready).
- Person optional per transaction (no-person entries allowed, e.g. "spent 500 on food").
- Category optional: explicit **"No category" bucket** (never silently filed under Other).
- Unknown spoken person → confirmation card shows `Name (new)`; editable before save;
  saved people are added to the people list.
- Fuzzy name matching (Levenshtein): suggest "Did you mean Ravi?" — never silent change.
- Person management: rename (transactions follow) + safe delete (person removed,
  transactions **kept** with a "deleted person" marker).
- Delete + Undo: 6-second undo window; restore preserves all original fields.
- Editable fields: amount, person, category, direction, note, date/time.
- Import conflicts: **skip existing, add only new** (match by id, else
  occurred_at+amount+person+direction); file validated, count shown,
  "X added, Y skipped" preview before and after; never silently overwrites/deletes.
- Export: JSON (full backup incl. people, categories, settings) + CSV (transactions).
- On every save: **clear all active filters → re-render → new transaction visible** (§22 rule).

### 1.6 Categories
- 11 built-ins seeded at signup:
  🍔 Food, ⛽ Petrol, 🏠 Rent, 🛒 Shopping, 💡 Bills, 🚕 Travel,
  💊 Medical, 📱 Recharge, 🎓 Education, 💰 Salary, 🎁 Other.
- Users can add + rename custom categories.
- Learned suggestions: most-frequent category per person (and per recurring pattern)
  shown on the confirmation card as a one-tap suggestion — **never auto-applied**.

### 1.7 Amount parsing
- Supported: `500`, `500 rupees`, `₹500`, `1,000`, `1,00,000` (Indian grouping),
  `2k`, `2K`, `5 hundred`, `5 thousand`, `a thousand`, `1 lakh`, `half lakh`,
  `quarter lakh`, `1 and a half lakh`.
- Normalised to integer rupees: `2k → 2000`, `1 lakh → 100000`, `half lakh → 50000`.
- Decimals NOT in v1 (manual entry rejects/notes them; parser ignores fractional speech).
- Display format: Indian grouping (₹1,00,000).

### 1.8 Multi-transaction sentences
- "sent 200 to Ravi and 100 to Priya" → one confirmation card listing both rows;
  user confirms all (or edits individually); nothing saved silently.

### 1.9 Voice queries (v1, English, map 1:1 to UI filters)
- Person: "show Ravi"
- Date range: "today", "this week", "this month", "last month"
- Direction: "sent only", "received only"
- Category: "show food"
- Natural combinations work: "show food this month".

### 1.10 Dashboard (always visible, even when list is filtered)
- Total Sent, Total Received, Balance = Received − Sent.

### 1.11 Insights (full set chosen)
- Period totals: Today / This week / This month / Previous month (sent, received, net).
- Category breakdown of spending (categorised sent entries only) for selected period.
- Person-wise balances: per person Sent / Received / Net — direction-correct wording,
  **no automatic "X owes you" claims** unless the data supports it.
- Spending trend: daily bars, last 30 days (sent vs received).
- Recurring detection (badge only): 3+ occurrences, same person+category (or
  category-only), amount within ±10%, cadence ~25–35 days → "Possible recurring"
  badge on entries. **No auto-generation of future transactions, no reminders in v1.**

### 1.12 UI / theme / feedback
- Style: **Midnight Neon** — bg `#050816`, primary `#7C3AED`, secondary `#00D4FF`,
  sent `#E07856`, received `#00D4FF`. Dark, modern, rounded cards, large mic button,
  strong hierarchy, minimal clutter, mobile-first.
- Theme: **dark only** (single theme).
- Spoken feedback: short English phrase after save (e.g. "Sent five hundred rupees to
  Ravi."), ON by default, toggle in Settings. Native SpeechSynthesis (free, on-device).
- Haptics (Android native vibration): mic start (double tick), recognition OK (single
  tick), save (strong tick), delete (strong tick), error (short buzz).
- Mic state machine: `Idle → Listening → Processing → Confirmation → Saved | Error`,
  each state visually distinct.

### 1.13 No fake data
- Production app starts with 0 transactions, ₹0 sent, ₹0 received, ₹0 balance.
- No demo users/expenses anywhere; test fixtures live only in test files.

---

## 2. Technology stack (all free)

| Layer | Choice | Notes |
|---|---|---|
| Build | Vite | fast on 4 GB RAM laptop |
| Framework | React + TypeScript | beginner-friendly, maintainable |
| Styling | Plain CSS with design tokens | no UI kit; Midnight Neon |
| Local DB | IndexedDB (thin custom wrapper) | offline cache + outbox + settings + PIN |
| Cloud | Supabase free tier (Postgres, Auth, RLS) | 500 MB DB, 50k MAU, no credit card; auto-pause after ~1 week inactivity (resume 1-click) |
| Voice (web) | Web Speech API | online, no key |
| Voice (Android) | @capacitor-community/speech-recognition | native recognizer, no key, offline-capable |
| TTS | SpeechSynthesis | on-device |
| Packaging | Capacitor → Android → APK | same codebase |
| Tests | Vitest (unit) + manual checklist | parser is the critical path |
| CI/CD | GitHub Actions | APK artifacts |

Bundle target < 200 KB gz; simple windowed list rendering for long histories.

---

## 3. Architecture

```
UI (React screens, Midnight Neon)
        │  screens call business logic only — never storage directly
        ▼
Business Logic Layer
  • voice parser (text → candidate transactions / queries)
  • number normaliser (Indian forms)
  • fuzzy name matcher + "did you mean"
  • category suggestion (most-frequent per person)
  • filters/search, totals, insights, recurring detector
  • sync engine (outbox, cursor, conflict log)
        │                              │
        ▼                              ▼
Local Data Layer (IndexedDB)        Voice Layer (adapter interface)
  • transactions/people/categories   • Web: Web Speech API
    (full cache)                     • Android: native SpeechRecognizer
  • outbox (pending ops + tombstones)• TTS for spoken feedback
  • last_sync_at, PIN, settings
        │
        │  push outbox / pull since last_sync_at
        ▼
Cloud Data Layer — Supabase Postgres
  RLS: all tables scoped to auth.uid() (server-enforced)
```

### Sync protocol (v1, single user)
1. Write: UI → business logic → IndexedDB (optimistic) → outbox.
2. Push: batch outbox rows as upserts (JSONB payload + version = updated_at);
   server applies; cleared on ack.
3. Pull: on open / network back / 60 s — fetch rows with `updated_at > last_sync_at`;
   merge into cache; advance cursor.
4. Conflict: if local base version < server updated_at → server wins; event recorded
   in Settings → Sync log. (Rare for one user.)
5. Delete: tombstone (deleted_at) pushed like an upsert.

### Auth
- Supabase Auth email OTP → on first login: create profile + seed 11 built-in
  categories (idempotent DB function or app-side upsert).
- Optional PIN: salted SHA-256 in IndexedDB; verified before cache is shown.

---

## 4. Data model (Postgres)

```sql
profiles(
  id uuid PK REFERENCES auth.users(id),
  created_at timestamptz default now(),
  updated_at timestamptz,
  settings jsonb default '{}'            -- e.g. {spokenFeedback:true}
)

categories(
  id uuid PK default gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  name text NOT NULL,
  emoji text,
  is_builtin boolean default false,
  deleted_at timestamptz,
  created_at, updated_at,
  UNIQUE (user_id, lower(name))         -- among non-deleted
)

people(
  id uuid PK default gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  name text NOT NULL,
  deleted_at timestamptz,
  created_at, updated_at,
  UNIQUE (user_id, lower(name))         -- among non-deleted
)

transactions(
  id uuid PK default gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  person_id uuid NULL REFERENCES people(id),      -- NULL = no-person entry
  category_id uuid NULL REFERENCES categories(id),-- NULL = "No category"
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  currency char(3) NOT NULL default 'INR',
  direction text NOT NULL check (direction in ('sent','received')),
  note text,
  source text NOT NULL check (source in ('voice','manual')),
  raw_speech text,                       -- only when source = 'voice'
  occurred_at timestamptz NOT NULL default now(),
  created_at timestamptz default now(),
  updated_at timestamptz,
  deleted_at timestamptz                 -- tombstone
)
-- Indexes: (user_id, occurred_at desc), (user_id, person_id),
--          (user_id, category_id), (user_id, updated_at) for sync pulls
-- RLS on every table: user_id = auth.uid()
```

Computed (never stored): totals, person-wise net, trends, category breakdown,
suggestions, recurring badges.

---

## 5. API / permission plan

| API | Purpose | Free tier | Key | Frontend-safe | Without it |
|---|---|---|---|---|---|
| Web Speech API | browser voice | free, unlimited | none | n/a | manual entry; Android uses native |
| Android SpeechRecognizer | APK voice | free | none | n/a | manual entry |
| Supabase | storage + OTP auth | 500 MB, 50k MAU, no card | public anon key only | yes — RLS rows server-enforced per user | offline cache serves everything |

- No paid services. No analytics/crash SDKs. No third-party trackers.
- Financial data only in the user's own Supabase project, TLS in transit.
- No financial data in client logs; raw_speech stored as user data (included in export).
- Android permissions (each justified):
  - RECORD_AUDIO — the core feature is voice.
  - MODIFY_AUDIO_SETTINGS — recognizer manages audio gain.
  - INTERNET — voice service + Supabase sync.
  - (No storage/camera/location permissions.)

---

## 6. Android APK & GitHub Actions

- One-time local: `npx cap add android` (scaffolds `android/` from template — no
  Android Studio required; committed to the repo).
- CI workflow (`.github/workflows/android.yml`):
  1. checkout, Node 20, JDK 17 (runner has Android SDK preinstalled)
  2. `npm ci` → `npm run build` (web)
  3. `npx cap sync android`
  4. `./gradlew assembleDebug` (every push) and `./gradlew assembleRelease` (tagged
     releases / manual dispatch)
  5. sign release with keystore from GitHub Secrets
     (ANDROID_KEYSTORE_BASE64, KEYSTORE_PASSWORD, KEY_ALIAS, KEY_ALIAS_PASSWORD —
     generated once on the laptop with JDK `keytool`)
  6. upload `*.apk` as a workflow artifact
- Download: GitHub → repo → **Actions** → run → **Artifacts** → `engada-pochu.apk`.
- Debug APK = quick self-testing build (throwaway debug signing key).
- Release APK = your keystore, smaller, the installable one.
- Free GitHub plan: ~2,000 action-minutes/month; one build ≈ 5–10 min.

---

## 7. Screens

1. Auth — email → OTP → optional PIN
2. Home (tab) — Sent/Received/Balance cards (always visible) + mic hero + last 10
3. Transactions (tab) — search, filter sheet (direction/person/category/date/amount), sort
4. Confirmation card — Amount/Person/Type/Category/Note + Edit/Retry/Cancel/Confirm;
   "Did you mean Ravi?"; multi-transaction card
5. Add manual — full form incl. date/time
6. Transaction detail — edit all fields; delete → "Entry deleted [Undo]" (6 s)
7. People (tab) — Sent/Received/Net per person; detail; rename; safe delete
8. Insights (tab) — period totals, category breakdown, 30-day trend, recurring badges
9. Settings — PIN, spoken feedback toggle, Export JSON/CSV, Import JSON (preview
   counts + skip-existing), sync status/log, sign out
10. Mic states: Idle / Listening (live transcript) / Processing / Confirmation /
    Saved / Error — visually distinct

---

## 8. Testing plan

Unit (Vitest): parser (all §8 examples, number forms incl. `2k`, `5 thousand`,
`1 lakh`, `half lakh`, Indian grouping), multi-transaction split, direction verbs,
fuzzy matching, query→filter mapping, sync merge/conflict logic, amount normaliser.
Manual checklist: add/edit/delete/undo/search/filter/refresh; save→refresh→close→
reopen persistence; offline mode (flight mode); voice examples:
"sent 500 to Ravi", "received 1000 from Priya", "sent 200 to Ravi and 100 to Priya".

---

## 9. Build stages

1. Scaffold + local data layer + core ledger UI (manual entry, dashboard, filters,
   undo) — fully offline in browser.
2. Supabase: schema, RLS, auth (email OTP + PIN), sync engine.
3. Voice: recognition + live transcript, parser, confirmation card, fuzzy names,
   spoken feedback, haptics.
4. Insights: periods, categories, trends, person-wise, recurring badge.
5. Export/Import with conflict preview, person management, polish.
6. Capacitor + Android + GitHub Actions APK workflow.

## 10. Open items (post-v1, explicitly deferred)

- Tamil phase: UI, commands, mixed speech, spoken responses.
- Recurring reminders / scheduled entry offers (with explicit approval).
- Cloud provider migration to Zoho Catalyst (data-layer adapter swap).
- Light theme (if ever wanted).
