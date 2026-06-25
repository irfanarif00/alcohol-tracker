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

There is **no test framework** configured — no test runner, no test files, no `test` script. Don't assume one exists.

## Architecture

A client-only single-page app: **Vite + React 18 + Tailwind CSS**. There is **no backend** — all state persists in the browser's `localStorage`. Essentially the entire application lives in **`src/App.jsx`** (a single component plus module-level helper functions); `src/main.jsx` is just the React mount point.

### Data model (localStorage)

Two keys hold all app state:
- `alcoholTracker` → `{ [userId: string]: Array<{ timestamp: ISOString, amount: number }> }` — every user keyed by a free-text ID, each holding a list of drink records (amount in **ml**).
- `waitingTime` → integer minutes to enforce between drinks (default `60`).

All reads/writes go through the `getStoredUsers`/`saveUsers`/`getStoredWaitingTime`/`saveWaitingTime` helpers at the top of `App.jsx`. There is no schema validation or migration — changing the shape of a record requires handling pre-existing localStorage data.

### App behavior

The single `App` component drives everything via local React state:
- **User selection** — free-text User ID with substring-match autocomplete; Search loads an existing user's records or prompts to create a new (empty) user.
- **Logging** — adds a `{ timestamp: now, amount }` record to the active user.
- **Waiting-time warning** — compares minutes since the user's last drink against the configurable `waitingMinutes`; shows a red banner with remaining wait time if too soon.
- **Stats** — total ml, ml in the last 2 hours (window is hard-coded), and time since last drink.
- **CSV export** — `downloadCSV` (current user) and `downloadAllUsersCSV` (all users, with per-user and grand totals); both build CSV strings client-side and trigger a Blob download.

All time math uses **`date-fns`**; the `Download` icon is from **`lucide-react`**. Dark-mode styling is applied via Tailwind `dark:` classes throughout.

### Deployment

Hosted on **GitHub Pages**. `vite.config.js` sets `base: '/alcohol-tracker/'` — this must match the repo name or assets 404 on the deployed site. `npm run deploy` pushes the built `dist/` to the `gh-pages` branch via the `gh-pages` package.

## Notable constraints

- **No data isolation** — every visitor to the same browser shares and can export all users' data. Suitable for a single shared/kiosk device, not multi-tenant use.
- **No edit/delete** of records or users once created.
- **CSV is built by naive comma-joining** — values aren't quoted or escaped, so a User ID or value containing `,` / `"` will corrupt the output.
