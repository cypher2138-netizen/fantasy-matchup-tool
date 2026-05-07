# Fantasy Matchup Tool (Prototype)

This is a plain commissioner-style prototype for your custom fantasy football league.

## What it does
- lets you enter Team A and Team B names
- enter all starting lineups and OT lineups
- select NFL season and week
- fetches ESPN week data through a small backend
- attempts exact player matching first
- shows "did you mean?" fallback suggestions when needed
- calculates Cat1-Cat7 using your corrected scoring rules
- runs overtime only on a 7-7 regulation tie / 3.5 to 3.5 category split
- shows results in your requested report format
- supports Copy Results and Back to Edit Lineups

## Important note
This app uses ESPN's unofficial public data endpoints. ESPN may change those endpoints or response formats at any time.

## Run locally
1. Install Node.js 18+.
2. Open a terminal in this folder.
3. Run:
   npm install
4. Then run:
   npm start
5. Open:
   http://localhost:3000

## Deploy later
This prototype is suitable for deployment on a small Node host such as Vercel, Render, or Railway, but it has not been production-hardened.

## Known limitations
- ESPN data structure is inferred and may need tweaks for some games.
- Team defensive touchdowns/safeties are derived heuristically from scoring play text.
- Kicker distance buckets depend on ESPN stat formatting.
- Version 1 has no saved matchups and no login.
