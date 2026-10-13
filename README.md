# Cut Line

Cut Line is a fantasy football desk for the current NFL season. Connect a Sleeper league or an ESPN league and it shows your roster, record, and playoff picture, then ranks waiver claims, free agents, and drop candidates. The goal is the playoff cut. The ranks are a heuristic, not a guarantee.

## Run it

```bash
npm install
npm run dev
```

The dev server listens on [http://127.0.0.1:43123](http://127.0.0.1:43123).

## Add it to your phone

Cut Line is an installable web app. Open it in Safari or Chrome on your phone, over HTTPS. A phone cannot install a localhost address.

- iPhone: tap Share, then Add to Home Screen. The icon is the cut football.
- Android: tap Install, or the browser menu, then Add to Home screen.

The same hint is on the desk until the app is already running from the home screen. Installed, it opens standalone, with the status bar and home-indicator insets left clear of the controls.

```bash
npm test
npm run lint
```

## Connect a league

Sleeper asks for a username only. League data comes from the public [Sleeper API](https://docs.sleeper.com/). There is no password.

ESPN asks for a league id, a season, and the `espn_s2` and `SWID` cookies copied from a browser where you are already logged in. Cut Line does not collect an ESPN username or password, and it does not log in for you. Public ESPN leagues can load with the cookie fields left blank. Private leagues need the cookies.

Connection details, including ESPN cookies, stay in this browser's `localStorage`. League reads go through Next.js route handlers so the browser is not blocked by CORS. Cookies are not written on the server.

Either platform still loads if the other is disconnected or failing.

## How the ranks work

A weekly score blends this week's projection, when the API sends one, with the average of up to the last three scored weeks. Lineup holes from injuries, bye weeks, and missing positions raise players who can fill them. Waiver claims are add/drop pairs for players locked on waivers. Free agents are unlocked adds. Drops are the lowest-value players outside the lineup worth protecting. The same explanation is on the board.

The NFL week comes from Sleeper's NFL state. Bye weeks come from the ESPN scoreboard.

## Limits

- Sleeper does not label every free agent as on waivers. A player is treated as on waivers only when they were dropped inside the league's waiver-clear window. Everyone else available is a free agent.
- ESPN FAAB claims do not get a dollar bid. The read API used here does not include the remaining budget.
- Individual defensive players are shown on the roster, and pickup ranks cover offense, kickers, and team defense.
- Recommendations are not projections of future performance and they are not instructions from the league.
