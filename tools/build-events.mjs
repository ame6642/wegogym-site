// Builds the /events/ listing and one page per event from events/events.json.
// Run: node tools/build-events.mjs   (then commit the generated HTML)
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const events = JSON.parse(readFileSync(new URL("events/events.json", ROOT), "utf8"));
const V = "2"; // bump when events.css or events.js change

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const cat = (c) => c.toLowerCase();
const initials = (s) => s.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
const mapUrl = (e) => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(`${e.venue}, ${e.area}, London`);
const niceDate = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

const head = (title, desc, path) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <link rel="icon" href="/favicon.ico" sizes="48x48">
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <meta name="theme-color" content="#111111">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="WeGoGym">
  <meta property="og:image" content="https://wegogym.club/social-preview.png">
  <meta property="og:url" content="https://wegogym.club${path}">
  <link rel="canonical" href="https://wegogym.club${path}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/events/events.css?v=${V}">
</head>`;

const header = (back) => `
  <header class="ev-header">
    <a class="ev-logo" href="/">WeGoGym</a>
    ${back ? '<a class="ev-header-link" href="/events/">All events</a>' : '<a class="ev-header-link" href="/waitlist/">Join the waitlist</a>'}
  </header>`;

const footer = `
  <footer class="ev-footer">
    <a href="mailto:hello@wegogym.club">hello@wegogym.club</a>
    <a href="/privacy/">Privacy Policy</a>
    <a href="/terms/">Terms of Use</a>
    <span>&copy; 2026 WeGoGym</span>
  </footer>`;

const flyer = (e, big) => `<div class="ev-flyer ev-cat-${cat(e.category)}${big ? " ev-flyer-big" : ""}" aria-hidden="true">
      <span class="ev-flyer-tag">${esc(e.category)} &middot; Free</span>
      <span class="ev-flyer-title">${esc(e.title)}</span>
      <span class="ev-flyer-when">${esc(e.schedule.split(",")[0])}</span>
    </div>`;

const ICON_CAL = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';
const ICON_PIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>';

function eventPage(e) {
  const path = `/events/${e.slug}/`;
  const rule = esc(JSON.stringify(e.rule));
  return `${head(`${e.title} | Free events in London | WeGoGym`, `${e.schedule} at ${e.venue}, ${e.area}. Free. ${e.description}`, path)}
<body class="ev-body ev-detail">
  <div class="ev-backdrop ev-cat-${cat(e.category)}" aria-hidden="true"></div>
${header(true)}
  <main class="ev-wrap" id="main">
    ${flyer(e, true)}
    <section class="ev-info">
      <p class="ev-kicker">${esc(e.category)}</p>
      <h1>${esc(e.title)}</h1>
      <p class="ev-by">by ${esc(e.organiser)}</p>

      <div class="ev-row">${ICON_CAL}<div><strong>${esc(e.schedule)}</strong><span class="ev-next" data-rule="${rule}"></span></div></div>
      <div class="ev-row">${ICON_PIN}<div><strong>${esc(e.venue)}</strong><span>${esc(e.area)} &middot; <a href="${esc(mapUrl(e))}" target="_blank" rel="noopener">Open in maps</a></span></div></div>

      <div class="ev-ticket">
        <div class="ev-ticket-top"><span class="ev-price">Free</span><span class="ev-ticket-note">Recurring event</span></div>
        <a class="ev-btn" href="${esc(e.signupUrl)}" target="_blank" rel="noopener">${esc(e.signupLabel)}</a>
        <p class="ev-ticket-fine">You sign up on the organiser's own page, not on WeGoGym.</p>
      </div>

      <h2>About</h2>
      <p class="ev-about">${esc(e.description)}</p>

      <h2>Hosted by</h2>
      <div class="ev-host"><span class="ev-avatar">${esc(initials(e.organiser))}</span><span>${esc(e.organiser)}</span></div>

      <p class="ev-source">Listed by WeGoGym from the organiser's public information, last checked ${esc(niceDate(e.verified))}. WeGoGym does not run this event; always confirm details with the organiser before you go. <a href="${esc(e.sourceUrl)}" target="_blank" rel="noopener">Source</a>. Are you the organiser? Email <a href="mailto:hello@wegogym.club?subject=${encodeURIComponent("Event listing: " + e.title)}">hello@wegogym.club</a> to update or remove this listing.</p>
    </section>
  </main>

  <div class="ev-sticky">
    <div><span class="ev-price">Free</span><span class="ev-sticky-when">${esc(e.schedule.split(",")[0])}</span></div>
    <a class="ev-btn" href="${esc(e.signupUrl)}" target="_blank" rel="noopener">Sign up</a>
  </div>
${footer}
  <script src="/events/events.js?v=${V}" defer></script>
</body>
</html>
`;
}

function listPage() {
  const cats = [...new Set(events.map((e) => e.category))].sort();
  const cards = events.map((e) => `
      <li class="ev-card" data-cat="${esc(cat(e.category))}" data-rule="${esc(JSON.stringify(e.rule))}">
        <a href="/events/${esc(e.slug)}/">
          ${flyer(e, false)}
          <span class="ev-card-title">${esc(e.title)}</span>
          <span class="ev-card-when"><span class="ev-next-short"></span>${esc(e.schedule)}</span>
          <span class="ev-card-where">${esc(e.area)} &middot; Free</span>
        </a>
      </li>`).join("");
  return `${head("Free recurring events in London | WeGoGym", "Free weekly and monthly events across London: parkruns, run clubs, outdoor fitness, wellbeing walks and museum lates.", "/events/")}
<body class="ev-body ev-list">
${header(false)}
  <main class="ev-list-wrap" id="main">
    <h1>Free events in London</h1>
    <p class="ev-lede">Recurring, free and open to everyone. Pick one, sign up with the organiser, and turn up.</p>
    <div class="ev-filters" role="group" aria-label="Filter by type" hidden>
      <button type="button" class="ev-chip is-on" data-filter="all" aria-pressed="true">All</button>
      ${cats.map((c) => `<button type="button" class="ev-chip" data-filter="${esc(cat(c))}" aria-pressed="false">${esc(c)}</button>`).join("\n      ")}
    </div>
    <ul class="ev-grid">${cards}
    </ul>
    <p class="ev-source">Listed by WeGoGym from organisers' public information. WeGoGym does not run these events. Organisers can email <a href="mailto:hello@wegogym.club">hello@wegogym.club</a> to update or remove a listing.</p>
  </main>
${footer}
  <script src="/events/events.js?v=${V}" defer></script>
</body>
</html>
`;
}

// Check every event first, so a bad entry stops the build before anything is deleted.
const CATEGORIES = ["Running", "Fitness", "Walking", "Culture"]; // each needs a colour in events.css
const seen = new Set();
for (const e of events) {
  for (const k of ["slug", "title", "organiser", "category", "rule", "schedule", "venue", "area", "description", "signupUrl", "signupLabel", "sourceUrl", "verified"]) {
    if (!e[k]) throw new Error(`${e.slug || "?"}: missing ${k}`);
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.slug)) throw new Error(`${e.slug}: slug must be lowercase letters, digits and hyphens`);
  if (seen.has(e.slug)) throw new Error(`duplicate slug ${e.slug}`);
  seen.add(e.slug);
  if (!CATEGORIES.includes(e.category)) throw new Error(`${e.slug}: category must be one of ${CATEGORIES.join(", ")}`);
  if (!/^https:\/\//.test(e.signupUrl) || !/^https:\/\//.test(e.sourceUrl)) throw new Error(`${e.slug}: links must be https`);
}

// Remove only previously generated event folders (ones holding an index.html), so a deleted
// event's page does not linger and any other folder here is left alone.
const dir = new URL("events/", ROOT);
for (const d of readdirSync(dir, { withFileTypes: true })) {
  const sub = new URL(d.name + "/", dir);
  if (d.isDirectory() && /^[a-z0-9-]+$/.test(d.name) && existsSync(new URL("index.html", sub))) rmSync(sub, { recursive: true });
}
for (const e of events) {
  mkdirSync(new URL(e.slug + "/", dir), { recursive: true });
  writeFileSync(new URL(e.slug + "/index.html", dir), eventPage(e));
}
writeFileSync(new URL("index.html", dir), listPage());
console.log(`built ${events.length} event pages and the listing`);
