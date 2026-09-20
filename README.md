# GOVERNOR v0.1.0

A local-first, backend-free personal state and trajectory governor designed for a single operator. It is not a to-do list, habit tracker, mood journal, or medical application.

## Core doctrine

GOVERNOR handles two separate control problems:

1. **State Governor** — restore enough operational capacity to act. When initiation is impaired, the interface contracts to one executable transition at a time through Anchor mode.
2. **Trajectory Governor** — once capacity exists, allocate it across a small portfolio using continuity condition, depth condition, strategic mode, ignition cost, current capacity, and protected omissions.

There is no accumulated hour debt, streak system, XP, confetti, or catch-up ledger. A CONTACT dose is not reported as ADVANCE. Deep engagement can be explicitly protected from interruption.

## Included v0.1.0 features

- iPhone-installable PWA shell
- GitHub Pages project-path-safe assets
- service-worker offline shell
- IndexedDB local persistence
- persistent-storage request/status
- seeded personal portfolio: Paid Work, Chess, Cyber Mastery, Physical, Office of Method, Fiction, Reading
- behavioral state routing: Down / Online / Functional / Already Working
- Anchor mode with one-action aperture and CAN'T decomposition
- Recovery Floor logic
- wake-episode tracking
- late/second-wake suppression of normal catch-up planning
- operational envelope: discretionary time, cognitive endurance, fixed work
- Daily Contract: fixed work, one primary advance, context-ceiling-aware continuity, physical slot, protected omissions, unresolved pressure
- continuity bands: GREEN / WATCH / PRESSURE / BREACH
- dose taxonomy: CONTACT / MAINTENANCE / ADVANCE / SURGE
- active block timer
- PROTECT THIS deep-work mode
- manual override
- 7-day and 28-day factual review
- editable trajectory settings and admission-control warning
- JSON export/import
- destructive local wipe guard
- no backend, account, telemetry, notification service, AI API, npm, or build step

## Clinical boundary

GOVERNOR is an organizational instrument, not treatment. Medication actions only ask whether prescribed instructions were handled; the app never recommends dose changes or missed-dose compensation. Persistent major changes in mood, sleep, appetite, or functioning should be discussed with a qualified clinician. In the U.S., if you are at risk of harming yourself or cannot keep yourself safe, call or text 988; use emergency services for immediate danger.

## Repository layout

```text
.
├── .nojekyll
├── index.html
├── manifest.webmanifest
├── styles.css
├── sw.js
├── VERSION
├── CHANGELOG.md
├── ACCEPTANCE-TESTS.md
├── DEPLOYMENT.md
├── README.md
├── icons/
│   ├── icon-180.png
│   ├── icon-192.png
│   ├── icon-512.png
│   └── maskable-512.png
└── js/
    ├── app.js
    ├── controller.js
    ├── db.js
    └── model.js
```

## Local test

Do not open `index.html` via `file://`; service workers and module behavior require HTTP.

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080/`.

## Data model

IndexedDB database: `personal-state-governor`, schema v1.

Stores:

- `kv` — settings
- `domains` — active trajectory configuration
- `days` — daily controller state and contracts
- `wakeEpisodes` — manually bounded wake episodes
- `blocks` — actual work/contact doses
- `events` — reserved for future operational events

All personal records remain on the device/browser unless explicitly exported. GitHub receives only static application code.

## Important iPhone storage note

The installed Home Screen web app should be treated as the authoritative instance. Browser and installed-web-app storage can be isolated. Export JSON backups periodically, especially before clearing Safari/site data or changing devices.

## Version policy

v0.1.0 deliberately excludes cloud sync, push notifications, AI, calendar integration, gamification, detailed medical tracking, and direct merging of FOUNDATION / 28 or CAPTUREDMIRAGE. Those systems remain separate execution engines.
