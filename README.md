# Engada Pochu 🎙️

**"Where did it go?"** — a voice-controlled personal expense tracker for Android.

Say *"sent 500 to Ravi"* → the app shows a confirmation card → you confirm → it's saved.
Nothing uncertain is ever saved silently.

Built as a **web app → Capacitor → Android APK**. No Android Studio required.

---

## Quick start (local, no backend)

```bash
npm install
npm run dev        # open http://localhost:5173
```

Without Supabase configured, the app runs in **Local only** mode: everything works
(IndexedDB on-device), the sync pill says "Local only". Voice needs a supporting
browser (Chrome/Edge) + internet. Manual entry always works.

### Tests & build

```bash
npm test           # 71 unit tests (parser, numbers, fuzzy, insights, data layer)
npm run build      # typecheck + production build → dist/
```

## Cloud backend (optional but recommended)

1. Free account at <https://supabase.com> (no credit card).
2. New project → **SQL Editor** → paste `supabase/schema.sql` → Run.
3. **Authentication → Providers → Email**: keep email enabled (OTP flow).
4. **Project Settings → API**: copy URL + anon key into `.env`:

```bash
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

5. `npm run dev` again — sign in with your email, you get an OTP, done.
   Data syncs (offline changes queue and push when you're back online).

## Android APK (on YOUR machine, low-spec friendly)

The `android/` folder is committed. You only need **Node + JDK 17+** — no Android
Studio. (JDK: `winget install Microsoft.OpenJDK.17` or adoptium.net.)

```bash
npm install
npm run build
npx cap sync android
cd android
set ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk   (or install cmdline-tools once)
gradlew assembleDebug
:: APK → android\app\build\outputs\apk\debug\app-debug.apk
```

`assembleRelease` works only when `android/keystore.properties` exists (see below).

### Release signing (do ONCE, then store safely)

```bash
keytool -genkeypair -v -keystore release.keystore -alias engadapochu ^
  -keyalg RSA -keysize 2048 -validity 10000
```
Then create `android/keystore.properties` (already git-ignored):
```
storeFile=release.keystore
storePassword=<your password>
keyAlias=engadapochu
keyPassword=<same password>
```
**Keep the .keystore file somewhere safe** — losing it means future updates can't be
signed with the same identity.

## Building the APK via GitHub Actions (no local Android at all)

1. Push this folder to a GitHub repo (`git init` is done here if you haven't pushed).
2. The workflow `.github/workflows/android.yml` runs on every push to `main`:
   `npm ci → npm run build → cap sync → gradlew assembleDebug (+ release if secrets set)`.
3. Debug APK: appears in **repo → Actions → run → Artifacts → engada-pochu-apk**.
4. Signed release APK: add 4 repo **Settings → Secrets and variables → Actions**:
   - `ANDROID_KEYSTORE_BASE64` = `base64 android/release.keystore`
   - `ANDROID_KEYSTORE_PASSWORD` = the keystore password
   - `ANDROID_KEY_ALIAS` = `engadapochu`
   - `ANDROID_KEY_ALIAS_PASSWORD` = the key password
5. Install the APK on your phone (allow "install unknown apps").

## What's inside

- **Voice**: browser Web Speech API / Android native recognizer (both free, no API
  key). Live transcript, live parsing, confirmation card for every save.
- **Parser**: directions (sent/paid/gave vs received/got/gave me), Indian number
  forms (2k, 5 thousand, 1 lakh, half lakh, 1 and a half lakh, 1,00,000),
  multi-transaction sentences, fuzzy name suggestions ("Did you mean Ravi?"),
  voice filter queries ("show Ravi", "this month", "sent only", "show food").
- **Ledger**: edit everything (incl. date/time), delete + 6 s Undo, search, filters
  (direction/person/category/date/amount), dashboard totals always visible,
  filters auto-clear on save so entries never "disappear".
- **People**: per-person Sent/Received/Net (direction-correct), rename, safe delete
  (transactions are never deleted).
- **Insights**: today/week/month/last-month totals, category breakdown, 30-day
  trend, recurring-transaction badges (detection only — never auto-creates entries).
- **Data**: JSON/CSV export, JSON import with conflict preview (skip-existing —
  nothing is ever silently overwritten or deleted).
- **Security**: email OTP + optional on-device PIN; row-level security on the
  backend (your rows are only reachable with your session); PIN never leaves the
  device; no analytics, no crash SDKs, no third-party trackers.

## Permissions (Android)

| Permission | Why |
|---|---|
| `RECORD_AUDIO` | The core feature — you speak transactions. |
| `MODIFY_AUDIO_SETTINGS` | The recognizer manages mic gain. |
| `INTERNET` | Voice service (when online) + Supabase sync. |

## Project layout

```
src/
  domain/   pure business logic (parser, numbers, fuzzy, insights) — fully unit-tested
  data/     IndexedDB cache + outbox, Supabase client, auth/PIN, sync engine
  voice/    voice adapters (web + native), TTS/haptics, mic state hook
  ui/       React screens (Midnight Neon, dark)
tests/      Vitest unit tests
supabase/   schema.sql
.github/    android.yml (APK builds)
android/    committed Capacitor Android project
```

## Notes

- v1 is English voice + English UI (Tamil phase is next, by design).
- Whole rupees in v1; the schema already supports decimals and other currencies.
- Local mode (no Supabase) is fully supported — data stays in the app on the device.
