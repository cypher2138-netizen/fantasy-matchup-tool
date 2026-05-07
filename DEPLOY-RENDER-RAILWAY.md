# Deploy on Render or Railway

This package is tuned for longer-running backend requests than the Vercel build.

## Render
1. Create a new GitHub repo or use your existing `fantasy-matchup-tool` repo.
2. Replace the repo contents with the files in this package.
3. Log in to Render.
4. Click **New +** -> **Web Service**.
5. Connect your GitHub repo.
6. Render should detect:
   - Build command: `npm install`
   - Start command: `npm start`
7. Deploy.

## Railway
1. Push these files to GitHub.
2. Log in to Railway.
3. Click **New Project** -> **Deploy from GitHub repo**.
4. Select the repo.
5. Railway should detect the app automatically from `railway.json`.
6. Deploy.

## Notes
- This build fetches ESPN week summaries with concurrency limits and short request timeouts.
- It also caches week data in memory for 10 minutes to avoid repeated long fetches.
- It is still based on unofficial ESPN data, so some player-stat mapping may need adjustment after live testing.
