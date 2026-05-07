# Fantasy Matchup Tool (Render/Railway build)

This is the plain commissioner-style build of the fantasy matchup tool.

## Why this build exists
The Vercel deployment timed out on `/api/matchups/calculate` because the ESPN week-data fetch was too heavy for that environment. This build is tuned for Render or Railway, where longer backend requests are a better fit.

## Included improvements
- Render and Railway deployment files
- reduced ESPN request bottleneck with concurrent summary fetches
- short network timeouts on ESPN calls
- simple in-memory 10-minute cache per season/week
- same plain UI and scoring behavior as the earlier prototype

## Run locally
```bash
npm install
npm start
```

Then open `http://localhost:3000`.
