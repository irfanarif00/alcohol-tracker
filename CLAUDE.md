# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # install dependencies
npm run dev          # start Vite dev server with HMR
npm run build        # production build to dist/
npm run preview      # serve the production build locally
npm run deploy       # build (via predeploy) and publish dist/ to the gh-pages branch
npx eslint .         # lint (no `lint` script defined; eslint.config.js is the flat config)
```

**SD-card / noexec constraint**: The working directory (`/mnt/sdcard/…`) is mounted `noexec` and does not support symlinks, so `npm install` and `npx vite build` fail here. Always run builds in a temp dir:

```bash
D=$(mktemp -d)
cp -r src public index.html package.json vite.config.js postcss.config.js tailwind.config.js "$D"/
cd "$D" && npm install && npx vite build --base=/   # for local preview
# OR: npx vite build                                # for GH Pages (base from vite.config.js)
```

For local preview after building:
```bash
setsid python3 -m http.server 8080 --bind 0.0.0.0 --directory "$D/dist" \
  > /tmp/at-server.log 2>&1 < /dev/null & disown
```

There is **no test framework** configured — no test runner, no test files, no `test` script. Don't assume one exists.

**Do NOT rebuild or restart the server after code changes unless the user explicitly asks.**

## Architecture

A client-only single-page app: **Vite + React 18 + Tailwind CSS**. There is **no backend** — all state persists in the browser's `localStorage`. The entire application lives in **`src/App.jsx`** (a single component plus module-level helper functions); `src/main.jsx` is just the React mount point.

### Key dependencies

| Package | Purpose |
|---|---|
| `react` / `react-dom` ^18 | UI framework |
| `tailwindcss` | Utility-first styling (`darkMode: 'class'`) |
| `date-fns` | All time arithmetic |
| `lucide-react` | Icons (Download, Settings, Eye, EyeOff, …) |
| `recharts` ^3.9 | 6-hour consumption bar chart |
| `vite` | Build tool |
| `gh-pages` | Deploy script |

### Data model (localStorage)

| Key | Shape | Notes |
|---|---|---|
| `alcoholTracker` | `{ [userId: string]: Array<{ timestamp: ISOString, amount: number }> }` | All user records; amount in **standard drinks** (not ml) |
| `waitingTime` | integer minutes | Time to enforce between drinks (default 60) |
| `almostReadyPct` | integer 1–99 | % of wait remaining at which warning turns yellow (default 11) |
| `confirmPct` | integer 1–99 | % of wait remaining at which a confirmation popup appears (default 89) |
| `theme` | `'light'` \| `'dark'` | Persisted theme preference |

All reads/writes go through helpers at the top of `App.jsx`:
- `getStoredUsers()` / `saveUsers(users)`
- `getStoredWaitingTime()` / `saveWaitingTime(minutes)`
- `getStoredPct(key, fallback)` for `almostReadyPct` and `confirmPct`

User IDs are always **normalised to lowercase** via `normalizeId = (id) => id.trim().toLowerCase()`.

There is no schema validation or migration — changing the shape of a record requires handling pre-existing localStorage data.

### App behaviour

The single `App` component drives everything via local React state:

**User selection**
- Free-text search with substring-match autocomplete dropdown.
- A-Z letter tabs + scrollable name chips above the search bar let staff tap a name directly.
- Search is case-insensitive; IDs stored as lowercase.
- After selecting a name the dropdown closes and `justRecorded` is reset to `false`.

**Logging a drink**
- Amount field accepts up to 2 decimal places.
- Preset buttons (0.25, 0.5, 0.75, 0.8, 0.9, 1, 1.2, 1.5) replace the field value when tapped.
- If the last drink was within `confirmPct`% of the waiting window, a confirmation popup appears before saving.
- On save, `justRecorded = true` triggers a green "Recorded" banner showing the next-allowed time.

**Waiting-time warnings** (three states)
- **Green** — shown immediately after logging (justRecorded = true). Clears when another user is searched.
- **Red** — shown when the user is searched and they are within the wait window (> almostReadyPct% remaining).
- **Yellow/amber** — shown when the user is searched and the wait is almost over (≤ almostReadyPct% remaining).

**Statistics panel** (visible when a user is loaded)
- Total drinks logged.
- Drinks in the last 2 hours (hard-coded window).
- Time since last drink.
- 6-hour rolling bar chart: 12 × 30-minute buckets via Recharts. Dark/light bar colours adapt to theme.

**Settings modal** (gear icon, top-right)
- Adjust waiting time (minutes).
- Adjust Almost Ready threshold % and Confirm threshold %.
- Toggle light/dark theme.
- Download encrypted backup (see below).
- Import encrypted backup (see below).
- Reset to Defaults — restores all settings to defaults (with confirmation popup).
- Reset Data — wipes all user records from localStorage (with confirmation popup).

**Encrypted backup export**
- Two passphrase fields (must match); each has an eye-toggle to reveal/hide.
- Encryption: PBKDF2-SHA256 (250 000 iterations, random 16-byte salt) → AES-256-GCM (random 12-byte IV).
- Output is a `.json` file containing base64-encoded ciphertext + all crypto parameters.
- A "?" help button shows a popup with a Node.js snippet to decrypt offline.

**Encrypted backup import**
- Prompts for the passphrase, then offers **Merge** (deduplicates records by `timestamp|amount`, normalises IDs to lowercase) or **Replace** (overwrites all data).

### Module-level constants

```js
const AMOUNT_PRESETS = [0.25, 0.5, 0.75, 0.8, 0.9, 1, 1.2, 1.5];
const DEFAULT_WAITING_MINUTES = 60;
const DEFAULT_ALMOST_READY_PCT = 11;
const DEFAULT_CONFIRM_PCT = 89;
const CHART_BUCKET_MINUTES = 30;
const CHART_BUCKETS = 12;       // 6 hours total
const PBKDF2_ITERATIONS = 250000;
```

### Shared Tailwind style tokens (defined at module level)

```js
const card = 'rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700/70 dark:bg-gray-800/60';
const primaryBtn = 'inline-flex items-center justify-center gap-2 rounded-xl bg-teal-700 px-5 py-3 ...';
const inputCls = 'w-full min-w-0 rounded-xl border border-gray-300 bg-white px-4 py-3 text-base ...';
```

### Modal render order (all `fixed inset-0`)

| z-index | Modal | State flag |
|---|---|---|
| z-50 | Settings / config | `showConfig` |
| z-[60] | Reset confirm | `resetConfirm` |
| z-[60] | Encrypt prompt | `showEncryptPrompt` |
| z-[60] | Import modal | `showImport` |
| z-[60] | Encryption help | `showEncryptHelp` |
| (inline) | "Add another drink?" confirm | `showConfirm` |

### Deployment

Hosted on **GitHub Pages** via **GitHub Actions** (`.github/workflows/deploy.yml`): any push to `main` triggers a build and deploy automatically.

`vite.config.js` sets `base: '/alcohol-tracker/'` — this must match the repo name or assets 404. For local preview builds, override: `npx vite build --base=/`.

Manual deploy (fallback):
```bash
npx gh-pages -d dist -b gh-pages \
  -r https://github.com/irfanarif00/alcohol-tracker.git \
  -u "irfanarif00 <21116999+irfanarif00@users.noreply.github.com>"
```

Pushing the workflow file requires the `workflow` OAuth scope. If `git push` is rejected with "refusing to allow an OAuth App to create or update workflow", run:
```bash
gh auth refresh -h github.com -s workflow
```

## Typography & theme

- **Fonts**: Fraunces (serif, headings) + IBM Plex Sans (sans-serif, body) — loaded from Google Fonts in `index.html`.
- **Palette**: Teal (`teal-700` primary) + cool gray neutrals.
- **Dark mode**: `darkMode: 'class'` in `tailwind.config.js`. A pre-paint inline script in `index.html` reads `localStorage.theme` (or system preference) and adds the `dark` class before first paint to avoid a flash.

## Notable constraints

- **No data isolation** — every visitor to the same browser shares and can see all users' data. Designed for a single shared/kiosk device, not multi-tenant use.
- **No edit/delete** — records and users cannot be removed individually (only full Reset Data wipe).
- **Backup export is the only portability path** — to move data to a new device, export an encrypted backup and import it on the new device.
