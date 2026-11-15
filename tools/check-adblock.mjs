// Fails if an ad blocker would hide any part of this site.
//
// Why: on 2026-11-15 the admin code box, Verify button and header vanished in Opera GX,
// because every admin class started with "ad-" and EasyList (the list most ad blockers use)
// hides ".ad-header", ".ad-code", ".ad-btn", ".ad-main" and more. The fix renamed them to
// "wgg-". This check stops any page shipping a name an ad blocker hides again.
//
// How: downloads EasyList, keeps its site-wide hiding rules, then in headless Chrome
//   1. opens every page with every hidden section shown and asks which rules match, and
//   2. tests every class and id name found in the HTML, CSS and JS (including ones only
//      created by script, like the admin drawer) one at a time.
//
// Run: node tools/check-adblock.mjs   (needs: npm i playwright; set CHROME_PATH to use a
// local Chrome instead of Playwright's own).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createServer } from "node:http";
import { chromium } from "playwright";

const ROOT = new URL("..", import.meta.url).pathname;
const LISTS = [
  "https://easylist.to/easylist/easylist.txt",
  "https://easylist.to/easylist/easyprivacy.txt",
];

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    if (n.startsWith(".") || n === "node_modules" || n === "tools") return [];
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const files = walk(ROOT).filter((f) => /\.(html|css|js)$/.test(f));
const pages = files.filter((f) => f.endsWith(".html")).map((f) => "/" + relative(ROOT, f).replace(/index\.html$/, ""));

// Site-wide hiding rules only ("##selector"); per-domain and scripted rules are skipped.
const rules = new Set();
for (const url of LISTS) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download ${url} (${res.status})`);
  for (const line of (await res.text()).split("\n")) {
    const m = /^##([^\n]+)$/.exec(line.trim());
    if (m && !/:-abp-|:has-text|:contains|:xpath|:matches-|:upward|:remove|:style\(/.test(m[1])) rules.add(m[1]);
  }
}
if (rules.size < 1000) throw new Error(`Only ${rules.size} rules downloaded; list format may have changed`);

// Every name that could end up as a class or id on the page.
const classes = new Set(), ids = new Set();
const NAME = /^[A-Za-z_][\w-]*$/;
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/class\s*=\s*"([^"]*)"/g)) m[1].split(/\s+/).forEach((c) => NAME.test(c) && classes.add(c));
  for (const m of src.matchAll(/\bid\s*=\s*"([^"]*)"/g)) NAME.test(m[1]) && ids.add(m[1]);
  if (f.endsWith(".css")) {
    for (const m of src.matchAll(/\.([A-Za-z_][\w-]*)/g)) classes.add(m[1]);
    for (const m of src.matchAll(/#([A-Za-z_][\w-]*)/g)) ids.add(m[1]);
  }
  if (f.endsWith(".js")) {
    // Any word inside a string literal: covers class: "x y", classList.add("x"), $("id").
    for (const m of src.matchAll(/"([^"\n]*)"|'([^'\n]*)'/g)) {
      (m[1] ?? m[2]).split(/\s+/).forEach((w) => { if (NAME.test(w) && w.length > 2) { classes.add(w); ids.add(w); } });
    }
  }
}

// Serve the site locally so pages load with their real CSS and markup.
const TYPES = { html: "text/html", css: "text/css", js: "text/javascript", png: "image/png", jpg: "image/jpeg", webp: "image/webp", svg: "image/svg+xml", woff2: "font/woff2" };
const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  try {
    const body = readFileSync(join(ROOT, p));
    res.writeHead(200, { "content-type": TYPES[p.split(".").pop()] || "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, args: ["--no-sandbox"] } : {});
const page = await browser.newPage();
await page.route(/^(?!http:\/\/127\.0\.0\.1)/, (r) => r.abort()); // no network calls to Supabase etc.
const problems = [];
const ruleList = [...rules];

for (const path of pages) {
  await page.goto(base + path, { waitUntil: "domcontentloaded" });
  const hits = await page.evaluate((rs) => {
    document.querySelectorAll("[hidden]").forEach((e) => e.removeAttribute("hidden"));
    const out = [];
    for (const r of rs) {
      let els; try { els = document.querySelectorAll(r); } catch { continue; }
      els.forEach((e) => out.push(`${r}  hides <${e.tagName.toLowerCase()}${e.id ? " id=" + e.id : ""} class="${e.className}">`));
    }
    return out;
  }, ruleList);
  hits.forEach((h) => problems.push(`${path}: ${h}`));
}

await page.goto(base + "/admin/", { waitUntil: "domcontentloaded" });
const nameHits = await page.evaluate(({ rs, cs, is }) => {
  const valid = rs.filter((r) => { try { document.createElement("div").matches(r); return true; } catch { return false; } });
  const out = [];
  const host = document.createElement("div");
  document.body.appendChild(host);
  for (const [kind, names] of [["class", cs], ["id", is]]) {
    for (const n of names) {
      const el = document.createElement("div");
      el.setAttribute(kind, n);
      host.appendChild(el);
      for (const r of valid) if (el.matches(r)) out.push(`${kind} "${n}" is hidden by rule ${r}`);
      el.remove();
    }
  }
  return out;
}, { rs: ruleList, cs: [...classes], is: [...ids] });
nameHits.forEach((h) => problems.push(h));

await browser.close();
server.close();

if (problems.length) {
  console.error(`Ad blockers would hide parts of the site (${problems.length}). Rename these, avoiding names like ad-, ads, banner, sponsor, promo:`);
  [...new Set(problems)].forEach((p) => console.error("  " + p));
  process.exit(1);
}
console.log(`OK: ${pages.length} pages, ${classes.size} class names and ${ids.size} ids checked against ${rules.size} ad-block rules. Nothing is hidden.`);
