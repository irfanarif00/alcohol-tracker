# Alcohol Consumption Tracker

A lightweight web app for logging how much alcohol (in ml) people drink and warning them to space out their drinks. Built for a shared device (e.g. a kiosk at an event or venue): each person is identified by a free-text **User ID**, and all data is stored locally in the browser — there is no backend, account system, or server.

## Features

- **Per-user tracking** — enter a User ID with substring autocomplete; load an existing user or create a new one.
- **Log drinks** — record an amount in ml, timestamped automatically.
- **Waiting-time warning** — set the minutes to wait between drinks (default 60); a warning shows if a user tries to drink too soon.
- **Statistics** — total consumption, consumption in the last 2 hours, and time since last drink.
- **CSV export** — download a single user's records, or all users' data with per-user and grand totals.

## Tech stack

- [Vite](https://vitejs.dev/) + [React 18](https://react.dev/)
- [Tailwind CSS](https://tailwindcss.com/) (with dark mode)
- [date-fns](https://date-fns.org/) for time calculations
- [lucide-react](https://lucide.dev/) for icons
- Data persisted in the browser's `localStorage`

## Getting started

```bash
npm install      # install dependencies
npm run dev      # start the dev server (with hot reload)
```

Then open the URL Vite prints (default http://localhost:5173).

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server with HMR |
| `npm run build` | Build the production bundle to `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm run deploy` | Build and publish `dist/` to the `gh-pages` branch |

## Deployment

The app is deployed to **GitHub Pages** via the `gh-pages` package:

```bash
npm run deploy
```

> **Note:** `vite.config.js` sets `base: '/alcohol-tracker/'`. This must match the repository name, or assets will fail to load on the deployed site.

## Data & privacy

All data lives in the browser's `localStorage` on the device running the app. There is no isolation between users — anyone using the same browser can view, add to, and export every user's records. This is intended for a single shared/kiosk device, not multi-user or multi-device use. Clearing the browser's storage erases all records.
