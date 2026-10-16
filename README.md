# Fieldwise — softball coaching board

A single-page coaching tool for softball (60 ft bases, 200 ft fence).

- Drag fielders, runners and the ball; record steps and play them back
- Starter library of situations (cutoffs, relays, bunt defense, first-and-third, double plays, rundowns)
- Team roster, game lineups per inning, and a rotation chart
- Works on phone, tablet and desktop, with a full-screen Present mode

Everything lives in `index.html`; there is no build step and no server.
Plays, roster and lineups are saved in the browser's local storage on each device.

## Run locally
Open `index.html` in a browser, or serve the folder:

    npx serve .

## Deploy to Vercel
1. Import this repository at vercel.com/new.
2. Framework preset: **Other**. Leave build command and output directory empty.
3. Deploy. Vercel serves `index.html` at the root URL.
