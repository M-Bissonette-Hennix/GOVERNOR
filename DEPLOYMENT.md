# Deployment — GitHub Pages + iPhone

## A. Put the release into an empty GitHub repository

1. Create an empty repository on GitHub. Any repository name is acceptable; this package is project-path safe.
2. Extract the release ZIP locally.
3. Upload **the contents of the extracted folder** to the repository root. `index.html`, `.nojekyll`, `sw.js`, `styles.css`, `manifest.webmanifest`, `js/`, and `icons/` must be at the repository root.
4. Commit to the default branch (normally `main`).

## B. Turn on GitHub Pages

1. Open the repository on GitHub.
2. Open **Settings**.
3. In the sidebar, open **Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Choose branch **main** (or your actual publishing branch).
6. Choose folder **/(root)**.
7. Save.
8. When GitHub reports the site is live, open the Pages URL. For a standard project site this is normally `https://YOUR-USERNAME.github.io/REPOSITORY/`.

`.nojekyll` is included so GitHub serves this static application without Jekyll processing.

## C. First browser acceptance check

Before entering personal data:

1. Load the site.
2. Confirm the header says `GOVERNOR · 0.1.0`.
3. Open PORTFOLIO and confirm seven seeded domains appear.
4. Open SYSTEM and request persistent storage.
5. Reload. Confirm the app still opens and your state persists.
6. Put the phone temporarily in Airplane Mode and reopen the installed app after one successful online load; the application shell should remain available offline.

## D. Install on iPhone

1. Open the deployed URL in Safari.
2. Open Safari's Share/Page menu.
3. Choose **Add to Home Screen**.
4. Ensure **Open as Web App** is enabled if iOS presents the option.
5. Tap **Add**.
6. Launch **Governor** from the Home Screen.

Treat the Home Screen installation as the authoritative instance for ongoing data entry.

## E. First-use recommendation

1. Open SYSTEM → **EXPORT JSON BACKUP** once after basic setup to verify your backup path.
2. Open PORTFOLIO and edit frontiers/modes only where the seeded assumptions are no longer correct.
3. Return to NOW and classify the observable state that actually exists.
4. Do not spend the first session tuning every number. Use the system; tune from evidence.

## Updating later

Replace repository files with a newer release and commit. The service worker uses a versioned cache; a release should increment the cache version in `sw.js`. Reloading after deployment allows the new service worker/app shell to take control. Export a JSON backup before major version upgrades.
