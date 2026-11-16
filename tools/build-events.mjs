// Builds the /events/ listing and one page per event from events/events.json.
// Run: node tools/build-events.mjs   (then commit the generated HTML)
// Images live in events/img/ (organisers' own photos and logos, credited on each page).
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const events = JSON.parse(readFileSync(new URL("events/events.json", ROOT), "utf8"));
const V = "5"; // bump when events.css or events.js change
const CATEGORIES = ["Running", "Fitness", "Walking"]; // each needs a colour in events.css
// Where in London an event is. Central is roughly the area within 3 km of Charing Cross (the City,
// Westminster, the South Bank); everywhere else is the compass direction from there, and south of the
// river counts as South even in the south-east (Bermondsey, Greenwich). Every event sets "region" by hand.
const REGIONS = [["central", "Central"], ["north", "North"], ["east", "East"], ["south", "South"], ["west", "West"]];

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const cat = (c) => c.toLowerCase();
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const initials = (s) => s.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
const niceDate = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const place = (e) => [e.venue, e.address || e.area].filter(Boolean).join(", ");
const directions = (e) => `https://www.google.com/maps/search/?api=1&query=${e.lat}%2C${e.lon}`;
const byHost = (name) => events.filter((x) => x.organiser.name === name).length;
const days = (e) => e.sessions.map((s) => s.label.split(",")[0]).join(", ").replace(/, ([^,]*)$/, " and $1");
const whenShort = (e) => (e.sessions.length === 1 ? "Every " + e.sessions[0].label : "Every " + days(e));

// A static map: OpenStreetMap tiles around the meeting point, darkened in CSS, with a pin at the centre.
function mapHtml(e) {
  const z = 15, n = 2 ** z;
  const px = ((e.lon + 180) / 360) * n * 256;
  const lat = (e.lat * Math.PI) / 180;
  const py = ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n * 256;
  const tx = Math.floor(px / 256), ty = Math.floor(py / 256);
  let tiles = "";
  for (let dy = -1; dy <= 1; dy++) for (let dx = -2; dx <= 2; dx++) {
    tiles += `<img src="https://tile.openstreetmap.org/${z}/${tx + dx}/${ty + dy}.png" style="left:${(dx + 2) * 256}px;top:${(dy + 1) * 256}px" alt="" loading="lazy" width="256" height="256">`;
  }
  const ox = Math.round(px - (tx - 2) * 256), oy = Math.round(py - (ty - 1) * 256);
  return `<a class="ev-map" href="${esc(directions(e))}" target="_blank" rel="noopener" aria-label="Open ${esc(e.venue)} in Google Maps">
          <span class="ev-map-tiles" style="left:calc(50% - ${ox}px);top:calc(50% - ${oy}px)">${tiles}</span>
          <span class="ev-map-pin" aria-hidden="true"></span>
          <span class="ev-map-open">Open in Maps</span>
        </a>
        <p class="ev-map-credit">Map &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors</p>`;
}

const avatar = (o, cls) => o.logo
  ? `<span class="${cls}"><img src="/events/${esc(o.logo)}" alt="" loading="lazy"></span>`
  : `<span class="${cls} ev-initials">${esc(initials(o.name))}</span>`;

const poster = (e) => e.image
  ? `<img src="/events/${esc(e.image)}" alt="${esc(e.title)}" width="900" height="1125">`
  : `<span class="ev-poster ev-cat-${cat(e.category)}"><span class="ev-poster-tag">${esc(e.category)} &middot; Free</span><span class="ev-poster-title">${esc(e.title)}</span><span class="ev-poster-org">${esc(e.organiser.name)}</span></span>`;

const head = (title, desc, path, img) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <link rel="icon" href="/favicon.ico" sizes="48x48">
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <meta name="theme-color" content="#0d0d0d">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="WeGoGym">
  <meta property="og:image" content="https://wegogym.club${img ? "/events/" + esc(img) : "/social-preview.png"}">
  <meta property="og:url" content="https://wegogym.club${path}">
  <link rel="canonical" href="https://wegogym.club${path}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/events/events.css?v=${V}">
</head>`;

const header = `
  <header class="ev-header">
    <a class="ev-logo" href="/">WeGoGym</a>
    <a class="ev-header-link" href="/events/">All events</a>
  </header>`;

const footer = `
  <footer class="ev-footer">
    <a href="mailto:hello@wegogym.club">hello@wegogym.club</a>
    <a href="/privacy/">Privacy Policy</a>
    <a href="/terms/">Terms of Use</a>
    <span>&copy; 2026 WeGoGym</span>
  </footer>`;

const SHARE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>';

function eventPage(e) {
  const path = `/events/${e.slug}/`;
  const o = e.organiser;
  const rules = esc(JSON.stringify(e.sessions.map(({ weekday, time, end }) => ({ weekday, time, end }))));
  const hostCount = byHost(o.name);
  const accent = e.accent ? ` style="--accent-ev:${esc(e.accent)}"` : "";
  const contact = o.email ? `mailto:${o.email}` : o.url;
  return `${head(`${e.title} | ${o.name} | Free in London | WeGoGym`, `${whenShort(e)} at ${e.venue}, ${e.area}. Free. ${e.summary}`, path, e.image)}
<body class="ev-body ev-detail ev-cat-${cat(e.category)}"${accent}>
  <div class="ev-backdrop" aria-hidden="true">${e.image ? `<img src="/events/${esc(e.image)}" alt="">` : ""}</div>
${header}
  <main class="ev-wrap" id="main">
    <figure class="ev-flyer">
      ${poster(e)}
      ${e.imageCredit ? `<figcaption>${esc(e.imageCredit)}</figcaption>` : ""}
    </figure>

    <div class="ev-main">
      <div class="ev-hostbar">
        <a class="ev-hostchip" href="#host">${avatar(o, "ev-av-sm")}<span>${esc(o.name)}</span></a>
        <button type="button" class="ev-icon-btn" data-share aria-label="Share this event">${SHARE}</button>
      </div>

      <h1>${esc(e.title)}</h1>

      <div class="ev-when">
        <strong>${esc(e.venue)}</strong>
        <span class="ev-next" data-rules="${rules}">${esc(whenShort(e))}</span>
      </div>

      <p class="ev-summary">${esc(e.summary)}</p>

      <section class="ev-section">
        <h2>When</h2>
        <ul class="ev-sessions">${e.sessions.map((s) => `
          <li><span class="ev-day">Every ${esc(s.label.split(",")[0])}</span><span class="ev-time">${esc(s.label.split(", ").slice(1).join(", "))}</span>${s.note ? `<span class="ev-note">${esc(s.note)}</span>` : ""}</li>`).join("")}
        </ul>
      </section>

      <section class="ev-section">
        <h2>About this event</h2>
        <p class="ev-about">${esc(e.description)}</p>
        ${e.gallery.length ? `<div class="ev-gallery">${e.gallery.map((g) => `<figure><img src="/events/${esc(g.src)}" alt="${esc(g.caption)}" loading="lazy"><figcaption>${esc(g.caption)}</figcaption></figure>`).join("")}</div>` : ""}
      </section>

      <section class="ev-section">
        ${mapHtml(e)}
        <h2>Location</h2>
        <p class="ev-loc"><strong>${esc(e.venue)}</strong><br>${esc(e.address || e.area)}</p>
      </section>

      <section class="ev-hostcard" id="host">
        <div class="ev-hostcard-top"><span>Hosted by <strong>${esc(o.name)}</strong></span>${hostCount > 1 ? `<a href="/events/?host=${esc(slugify(o.name))}">More events &rsaquo;</a>` : ""}</div>
        ${avatar(o, "ev-av-lg")}
        <p class="ev-host-name">${esc(o.name)}</p>
        <p class="ev-host-stats">${hostCount} ${hostCount === 1 ? "event" : "events"} on WeGoGym</p>
        <p class="ev-host-about">${esc(o.about)}</p>
        <div class="ev-host-btns">
          <a href="${esc(contact)}"${o.email ? "" : ' target="_blank" rel="noopener"'}>Contact</a>
          ${o.instagram ? `<a href="${esc(o.instagram)}" target="_blank" rel="noopener">Instagram</a>` : ""}
          <a href="${esc(o.url)}" target="_blank" rel="noopener">Website</a>
        </div>
      </section>

      <p class="ev-source">Listed by WeGoGym from the organiser's public information, last checked ${esc(niceDate(e.verified))}. WeGoGym does not run this event; confirm details with the organiser before you go. <a href="${esc(e.sourceUrl)}" target="_blank" rel="noopener">Source</a>. Are you the organiser? Email <a href="mailto:hello@wegogym.club?subject=${encodeURIComponent("Event listing: " + e.title)}">hello@wegogym.club</a> to update or remove this listing.</p>
    </div>
  </main>

  <div class="ev-cta">
    <a class="ev-cta-btn" href="${esc(e.signupUrl)}" target="_blank" rel="noopener">${esc(e.signupLabel)} &middot; Free</a>
  </div>
${footer}
  <script src="/events/events.js?v=${V}" defer></script>
</body>
</html>
`;
}

function listPage() {
  const cards = events.map((e) => `
      <li class="ev-card ev-cat-${cat(e.category)}" data-cat="${esc(cat(e.category))}" data-region="${esc(e.region)}" data-host="${esc(slugify(e.organiser.name))}" data-rules="${esc(JSON.stringify(e.sessions.map(({ weekday, time, end }) => ({ weekday, time, end }))))}">
        <a href="/events/${esc(e.slug)}/">
          <span class="ev-card-img">${poster(e)}</span>
          <span class="ev-card-when ev-next-short">${esc(whenShort(e))}</span>
          <span class="ev-card-title">${esc(e.title)}</span>
          <span class="ev-card-where">${esc(e.organiser.name)} &middot; ${esc(e.area)}</span>
        </a>
      </li>`).join("");
  return `${head("Free health and fitness events in London | WeGoGym", "Free weekly runs, outdoor fitness classes and wellbeing walks across London.", "/events/")}
<body class="ev-body ev-list">
${header}
  <main class="ev-list-wrap" id="main">
    <h1>Free in London</h1>
    <p class="ev-lede">Weekly runs, outdoor classes and walks. Free, open to everyone, and you sign up with the organiser.</p>
    <div class="ev-filters" hidden>
      <div class="ev-filter-row" role="group" aria-label="Filter by type" data-group="cat">
        <span class="ev-filter-label">Type</span>
        <button type="button" class="ev-chip is-on" data-filter="all" aria-pressed="true">All</button>
        ${CATEGORIES.map((c) => `<button type="button" class="ev-chip" data-filter="${esc(cat(c))}" aria-pressed="false">${esc(c)}</button>`).join("\n        ")}
      </div>
      <div class="ev-filter-row" role="group" aria-label="Filter by area of London" data-group="region">
        <span class="ev-filter-label">Area</span>
        <button type="button" class="ev-chip is-on" data-filter="all" aria-pressed="true">All London</button>
        ${REGIONS.map(([v, l]) => `<button type="button" class="ev-chip" data-filter="${v}" aria-pressed="false">${l}</button>`).join("\n        ")}
      </div>
    </div>
    <p class="ev-hostfilter" hidden>Showing events by <strong></strong>. <a href="/events/">Show all</a></p>
    <p class="ev-empty" role="status" hidden>No events match both filters. Try a different type or area.</p>
    <ul class="ev-grid">${cards}
    </ul>
    <p class="ev-source">Listed by WeGoGym from organisers' public information; photos belong to the organisers. WeGoGym does not run these events. Organisers can email <a href="mailto:hello@wegogym.club">hello@wegogym.club</a> to update or remove a listing.</p>
  </main>
${footer}
  <script src="/events/events.js?v=${V}" defer></script>
</body>
</html>
`;
}

// Check every event first, so a bad entry stops the build before anything is deleted.
const seen = new Set();
for (const e of events) {
  for (const k of ["slug", "title", "category", "summary", "organiser", "sessions", "venue", "area", "lat", "lon", "description", "signupUrl", "signupLabel", "sourceUrl", "verified"]) {
    if (e[k] === undefined || e[k] === "") throw new Error(`${e.slug || "?"}: missing ${k}`);
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.slug)) throw new Error(`${e.slug}: slug must be lowercase letters, digits and hyphens`);
  if (e.slug === "img") throw new Error("slug img is reserved for the images folder");
  if (seen.has(e.slug)) throw new Error(`duplicate slug ${e.slug}`);
  if (typeof e.lat !== "number" || typeof e.lon !== "number" || Math.abs(e.lat) > 85 || Math.abs(e.lon) > 180) throw new Error(`${e.slug}: lat and lon must be numbers`);
  if (!Array.isArray(e.gallery)) throw new Error(`${e.slug}: gallery must be a list (can be empty)`);
  if (e.accent && !/^#[0-9a-f]{6}$/i.test(e.accent)) throw new Error(`${e.slug}: accent must be a #rrggbb colour`);
  if (e.organiser.email && !/^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(e.organiser.email)) throw new Error(`${e.slug}: bad organiser email`);
  seen.add(e.slug);
  if (!REGIONS.some(([v]) => v === e.region)) throw new Error(`${e.slug}: region must be one of ${REGIONS.map(([v]) => v).join(", ")}`);
  if (!CATEGORIES.includes(e.category)) throw new Error(`${e.slug}: category must be one of ${CATEGORIES.join(", ")}`);
  if (!e.organiser.name || !e.organiser.url || !e.organiser.about) throw new Error(`${e.slug}: organiser needs name, url and about`);
  if (!e.sessions.length || e.sessions.some((s) => !(s.weekday >= 0 && s.weekday <= 6) || !/^\d\d:\d\d$/.test(s.time) || !s.label || (s.end && (!/^\d\d:\d\d$/.test(s.end) || s.end <= s.time)))) throw new Error(`${e.slug}: bad sessions`);
  for (const u of [e.signupUrl, e.sourceUrl, e.organiser.url, e.organiser.instagram].filter(Boolean)) {
    if (!/^https:\/\//.test(u)) throw new Error(`${e.slug}: links must be https (${u})`);
  }
  for (const f of [e.image, e.organiser.logo, ...e.gallery.map((g) => g.src)].filter(Boolean)) {
    if (!/^img\/[a-z0-9-]+\.(jpg|png)$/.test(f) || !existsSync(new URL("events/" + f, ROOT))) throw new Error(`${e.slug}: missing image ${f}`);
  }
}

// Remove only previously generated event folders (ones holding an index.html), so a deleted
// event's page does not linger and any other folder here (such as img/) is left alone.
const dir = new URL("events/", ROOT);
for (const d of readdirSync(dir, { withFileTypes: true })) {
  const sub = new URL(d.name + "/", dir);
  if (d.isDirectory() && d.name !== "img" && /^[a-z0-9-]+$/.test(d.name) && existsSync(new URL("index.html", sub))) rmSync(sub, { recursive: true });
}
for (const e of events) {
  mkdirSync(new URL(e.slug + "/", dir), { recursive: true });
  writeFileSync(new URL(e.slug + "/index.html", dir), eventPage(e));
}
writeFileSync(new URL("index.html", dir), listPage());
console.log(`built ${events.length} event pages and the listing`);
