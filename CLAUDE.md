# wegogym-site

Static site for wegogym.club, served by GitHub Pages from this branch: a push here is live.

- Never name a class or id so an ad blocker hides it (no `ad-`, `ads`, `banner`, `sponsor`,
  `promo` and similar). The admin page used `ad-` and its code box vanished in Opera GX on
  2026-11-15. The admin prefix is `wgg-`.
- Before pushing, run `node tools/check-adblock.mjs` (needs `npm i --no-save playwright@1`;
  set `CHROME_PATH` to use a local Chrome). It also runs on GitHub on every push and weekly.
- When you change a CSS or JS file that a page loads with `?v=`, bump the `?v=` value in that
  page so browsers do not keep the old copy.
