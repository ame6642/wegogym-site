/* WeGoGym admin: wegogym.club/admin/
 *
 * Two screens over the live Supabase database:
 *   Businesses: every registered facility, with accept / decline / notes (0063's
 *     admin_record_venue_note), optional email to the business (admin-notify function),
 *     and the existing listing review (0028's admin_review_venue) once a listing is pending.
 *   Waitlist: numbers from 0063's admin_waitlist_stats, plus a CSV download.
 *
 * Only an account whose profile has role = admin AND whose session passed two-step login
 * (an authenticator-app code, JWT aal = aal2) gets any data: every RPC and policy checks
 * app.is_admin() in the database (0064), so this page holds no secret and decides nothing.
 * It refreshes itself every 30 seconds while the tab is open and on screen.
 *
 * Plain fetch, no libraries, for the same reason as business-register.js: the site's
 * Content-Security-Policy only allows scripts from this domain.
 */
(function () {
  "use strict";

  // ===== EDIT: settings =====
  var CONFIG = {
    url: "https://yxgwywppajvxfmmjudaq.supabase.co",
    key: "sb_publishable_HoGxqewsV4DLLKpUCmtS-g_Ad-3D5o-", // public by design
    refreshSeconds: 30
  };

  var SESSION_KEY = "wgg-admin-session";
  var SEEN_KEY = "wgg-admin-seen-venues";
  var TZ = "Europe/London";

  var state = {
    session: null, view: "biz", venues: null, filter: "all", search: "",
    stats: null, days: 30, openVenueId: null, seen: null,
    wlBaseline: null, wlOpenedAt: null, busy: false, lastOk: 0
  };

  function $(id) { return document.getElementById(id); }

  // ===== Small DOM helper: text is always set as text, never as HTML =====
  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    });
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      el.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    });
    return el;
  }

  // ===== Messages =====
  function AppError(status, code, message, details) {
    this.status = status; this.code = code; this.message = message || ""; this.details = details || "";
  }
  var COPY = {
    WGG21: "This account does not have admin access.",
    WGG23: "That business no longer exists. Refresh the list.",
    WGG44: "That listing has already been decided, or is not waiting for review. Refresh to see its current state.",
    WGG45: "This listing cannot go live yet: the business has not finished setting up payments (Stripe).",
    invalid_credentials: "That email and password do not match.",
    invalid_grant: "That email and password do not match.",
    email_not_confirmed: "This account's email is not confirmed yet.",
    over_request_rate_limit: "Too many attempts. Wait a few minutes and try again.",
    mfa_verification_failed: "That code is wrong or has expired. Type the current code from Authy.",
    mfa_challenge_expired: "That took too long. Type the current code from Authy.",
    mfa_totp_enroll_not_enabled: "Authenticator apps are switched off for this project. Turn on TOTP in Supabase > Authentication > Multi-Factor.",
    mfa_totp_verify_not_enabled: "Authenticator apps are switched off for this project. Turn on TOTP in Supabase > Authentication > Multi-Factor.",
    network: "Could not reach the database. Check your connection.",
    session: "You have been logged out. Log in again."
  };
  function messageFor(err) {
    if (!(err instanceof AppError)) { console.error(err); return "Something went wrong on this page. Reload and try again."; }
    if (err.code === "WGG43") return "This listing is not complete enough to go live. Missing: " + humanList(err.details) + ".";
    if (err.code === "WGG40") return "Not saved: " + (err.details || "check what you typed") + ".";
    if (COPY[err.code]) return COPY[err.code];
    return "That did not work (" + (err.code || err.status) + "). Try again.";
  }
  function humanList(csv) { return String(csv || "").split(",").filter(Boolean).map(humanise).join(", "); }

  function alertMsg(text, ok) {
    var a = $("ad-alert");
    a.textContent = text || "";
    a.classList.toggle("is-ok", !!ok);
    if (text && ok) setTimeout(function () { if (a.textContent === text) a.textContent = ""; }, 5000);
  }
  function announce(t) { $("ad-announce").textContent = t; }

  // ===== HTTP =====
  async function http(path, opts, retried) {
    opts = opts || {};
    var headers = { apikey: CONFIG.key };
    if (opts.auth !== false) headers.Authorization = "Bearer " + await accessToken(retried);
    if (opts.json !== undefined) headers["Content-Type"] = "application/json";
    Object.keys(opts.headers || {}).forEach(function (k) { headers[k] = opts.headers[k]; });
    var res;
    try {
      res = await fetch(opts.absolute ? path : CONFIG.url + path, {
        method: opts.method || "GET", headers: headers,
        body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined
      });
    } catch (e) { throw new AppError(0, "network"); }
    var text = await res.text();
    var data = null;
    if (text) { try { data = JSON.parse(text); } catch (e) { data = null; } }
    if ((res.status === 401 || /jwt expired/i.test(text)) && opts.auth !== false && !retried) {
      return http(path, opts, true);
    }
    if (!res.ok) {
      var b = data || {};
      var code = b.error_code || (typeof b.code === "string" ? b.code : null) || b.error || String(res.status);
      throw new AppError(res.status, code, b.msg || b.message || b.error_description, b.details);
    }
    return data;
  }
  function rpc(name, args) { return http("/rest/v1/rpc/" + name, { method: "POST", json: args || {} }); }

  // ===== Session =====
  function saveSession(s) {
    state.session = s;
    try { if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s)); else localStorage.removeItem(SESSION_KEY); }
    catch (e) { /* private mode: the session lasts as long as the tab */ }
  }
  function fromAuth(d) {
    if (!d || !d.access_token) return null;
    return {
      access_token: d.access_token, refresh_token: d.refresh_token,
      expires_at: d.expires_at || Math.floor(Date.now() / 1000) + Number(d.expires_in || 3600),
      email: d.user ? d.user.email : null
    };
  }
  var refreshing = null;
  async function accessToken(force) {
    var s = state.session;
    if (!s) throw new AppError(401, "session");
    if (!force && s.expires_at * 1000 - 60000 > Date.now()) return s.access_token;
    if (!refreshing) {
      refreshing = (async function () {
        try {
          var d = await http("/auth/v1/token?grant_type=refresh_token",
            { method: "POST", auth: false, json: { refresh_token: s.refresh_token } });
          var next = fromAuth(d);
          if (!next) throw new AppError(401, "session");
          next.email = next.email || s.email;
          saveSession(next);
          return next.access_token;
        } catch (e) {
          if (e.status === 400 || e.status === 401 || e.code === "session") { signedOut(); throw new AppError(401, "session"); }
          throw e;
        } finally { refreshing = null; }
      })();
    }
    return refreshing;
  }

  function show(view) {
    ["view-login", "view-mfa", "view-enrol", "view-denied", "view-biz", "view-wl", "view-offline"].forEach(function (id) { $(id).hidden = id !== view; });
    var inApp = view === "view-biz" || view === "view-wl";
    $("ad-tabs").hidden = !inApp;
    $("ad-live").hidden = !inApp;
    $("ad-signout").hidden = !(inApp || view === "view-denied" || view === "view-mfa" || view === "view-enrol");
    var h1 = $(view).querySelector("h1[tabindex]");
    if (h1) h1.focus();
  }

  // ===== Two-step login (TOTP authenticator app) =====
  // The database only treats a session as admin when its token says aal2, which Supabase
  // issues after a correct authenticator code (migration 0064). This page just walks the
  // person through getting that code accepted; it enforces nothing itself.
  function claims(token) {
    try {
      var p = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      return JSON.parse(decodeURIComponent(escape(atob(p + "===".slice((p.length + 3) % 4)))));
    } catch (e) { return {}; }
  }

  async function mfaGate() {
    if (claims(state.session.access_token).aal === "aal2") { await enter(); return; }
    var user = await http("/auth/v1/user");
    var totp = (user.factors || []).filter(function (f) { return f.factor_type === "totp"; });
    var ready = totp.find(function (f) { return f.status === "verified"; });
    if (ready) {
      state.factorId = ready.id;
      $("mfa-code").value = "";
      show("view-mfa");
      return;
    }
    // First time: clear any half-finished set-up, then start a fresh one.
    for (var i = 0; i < totp.length; i++) {
      await http("/auth/v1/factors/" + totp[i].id, { method: "DELETE" }).catch(function () {});
    }
    var f = await http("/auth/v1/factors", { method: "POST", json: {
      factor_type: "totp", issuer: "WeGoGym",
      friendly_name: "WeGoGym admin " + new Date().toISOString().slice(0, 16)
    } });
    state.factorId = f.id;
    $("enrol-qr").src = f.totp.qr_code;
    $("enrol-secret").textContent = f.totp.secret;
    $("enrol-code").value = "";
    show("view-enrol");
  }

  async function submitCode(e, inputId, idleLabel) {
    e.preventDefault();
    if (state.busy) return;
    var code = $(inputId).value.replace(/\s/g, "");
    if (!/^\d{6}$/.test(code)) { alertMsg("Type the 6 numbers from Authy."); $(inputId).focus(); return; }
    state.busy = true; alertMsg("");
    var btn = e.target.querySelector("button"); btn.disabled = true; btn.textContent = "Checking…";
    try {
      var ch = await http("/auth/v1/factors/" + state.factorId + "/challenge", { method: "POST", json: {} });
      var d = await http("/auth/v1/factors/" + state.factorId + "/verify", { method: "POST", json: { challenge_id: ch.id, code: code } });
      var next = fromAuth(d);
      if (!next) throw new AppError(400, "mfa_verification_failed");
      next.email = next.email || state.session.email;
      saveSession(next);
      $(inputId).value = "";
      state.busy = false;
      await enter();
    } catch (err) {
      alertMsg(messageFor(err));
      $(inputId).select();
    } finally { state.busy = false; btn.disabled = false; btn.textContent = idleLabel; }
  }

  function signedOut() {
    saveSession(null);
    state.venues = null; state.stats = null; state.wlBaseline = null; state.rows = null; state.places = null;
    closeDrawer();
    closePlace();
    if (state.demo) { state.demo = false; $("wl-demo").setAttribute("aria-pressed", "false"); $("wl-csv").disabled = false; $("wl-latest-card").hidden = false; }
    show("view-login");
  }

  async function logIn(e) {
    e.preventDefault();
    if (state.busy) return;
    var email = $("li-email").value.trim(), pw = $("li-password").value;
    if (!email || !pw) { alertMsg("Enter your email and password."); return; }
    state.busy = true; alertMsg("");
    var btn = e.target.querySelector("button"); btn.disabled = true; btn.textContent = "Logging in…";
    try {
      var d = await http("/auth/v1/token?grant_type=password", { method: "POST", auth: false, json: { email: email, password: pw } });
      $("li-password").value = "";
      saveSession(fromAuth(d));
      state.busy = false;
      await mfaGate();
    } catch (err) { alertMsg(messageFor(err)); }
    finally { state.busy = false; btn.disabled = false; btn.textContent = "Log in"; }
  }

  async function logOut() {
    var token = state.session && state.session.access_token;
    signedOut();
    if (token) {
      fetch(CONFIG.url + "/auth/v1/logout?scope=local", { method: "POST", headers: { apikey: CONFIG.key, Authorization: "Bearer " + token } }).catch(function () {});
    }
    announce("Logged out.");
  }

  // After login: the first RPC doubles as the admin check.
  async function enter() {
    try {
      state.venues = await rpc("admin_list_venues");
    } catch (err) {
      if (err.code === "WGG21" && claims(state.session.access_token).aal !== "aal2") { await mfaGate(); return; }
      if (err.code === "WGG21") { $("denied-email").textContent = (state.session && state.session.email) || "this account"; show("view-denied"); return; }
      if (err.code === "session") { show("view-login"); alertMsg(COPY.session); return; }
      if (err.code === "PGRST202" || err.status === 404) { show("view-login"); alertMsg("The database is missing the admin functions. Run migration 0063 first."); return; }
      throw err;
    }
    markOk();
    loadSeen();
    selectView(state.view);
    renderVenues();
  }

  // ===== Live refresh =====
  function markOk() { state.lastOk = Date.now(); paintLive(); }
  function paintLive() {
    if (!state.lastOk) return;
    var age = Date.now() - state.lastOk;
    var stale = age > CONFIG.refreshSeconds * 3000;
    $("ad-live").classList.toggle("is-stale", stale);
    $("ad-updated").textContent = (stale ? "Not updated since " : "Live · ") + fmtTime(new Date(state.lastOk));
  }
  async function tick() {
    if (!state.session || document.hidden || state.busy || $("view-biz").hidden && $("view-wl").hidden) return;
    try {
      var venues = await rpc("admin_list_venues");
      state.venues = venues;
      renderVenues();
      if (state.view === "wl" || state.stats) await loadStats(true);
      markOk();
    } catch (err) {
      if (err.code === "session") { alertMsg(COPY.session); return; }
      paintLive(); // keeps showing the last good data, marked stale
    }
  }

  // ===== Tabs =====
  function selectView(v) {
    state.view = v;
    var biz = v === "biz";
    $("tab-biz").setAttribute("aria-selected", String(biz)); $("tab-biz").tabIndex = biz ? 0 : -1;
    $("tab-wl").setAttribute("aria-selected", String(!biz)); $("tab-wl").tabIndex = biz ? -1 : 0;
    show(biz ? "view-biz" : "view-wl");
    if (!biz) {
      state.wlBaseline = null; $("wl-new").hidden = true;
      if (!state.wlOpenedAt) state.wlOpenedAt = new Date().toISOString();
      if (!state.stats) loadStats(false).catch(function (err) { alertMsg(messageFor(err)); });
    }
  }

  // ===== Businesses =====
  function loadSeen() {
    try { state.seen = JSON.parse(localStorage.getItem(SEEN_KEY) || "null"); } catch (e) { state.seen = null; }
    if (!Array.isArray(state.seen)) {
      // First visit on this browser: everything that already exists counts as seen.
      state.seen = (state.venues || []).map(function (v) { return v.id; });
      storeSeen();
    }
  }
  function storeSeen() { try { localStorage.setItem(SEEN_KEY, JSON.stringify(state.seen)); } catch (e) { /* fine */ } }
  function isNew(v) { return state.seen && state.seen.indexOf(v.id) < 0; }

  function bucket(v) {
    if (v.status === "pending") return "pending";
    if (v.status === "live" || v.status === "paused") return "live";
    if (v.intake === "accepted") return "accepted";
    if (v.intake === "declined") return "declined";
    return "undecided";
  }

  function statusTags(v) {
    var tags = [];
    var label = { draft: "Draft", pending: "Waiting for listing review", changes_requested: "Changes requested",
      rejected: "Listing rejected", live: "Live", paused: "Paused", suspended: "Suspended" }[v.status] || v.status;
    var cls = { live: "good", pending: "info", rejected: "bad", suspended: "bad", changes_requested: "warn" }[v.status] || "";
    tags.push(h("span", { class: "ad-tag " + cls, text: label }));
    if (v.intake === "accepted") tags.push(h("span", { class: "ad-tag good", text: "Accepted" }));
    else if (v.intake === "declined") tags.push(h("span", { class: "ad-tag bad", text: "Declined" }));
    else if (v.status === "draft" || v.status === "changes_requested") tags.push(h("span", { class: "ad-tag warn", text: "To decide" }));
    return tags;
  }

  function renderVenues() {
    var all = state.venues || [];
    var counts = { all: all.length, undecided: 0, accepted: 0, declined: 0, pending: 0, live: 0 };
    all.forEach(function (v) { counts[bucket(v)]++; });
    document.querySelectorAll("#biz-filters button").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.filter === state.filter));
      b.querySelector("span").textContent = counts[b.dataset.filter] ? String(counts[b.dataset.filter]) : "";
    });
    var fresh = all.filter(isNew).length;
    $("biz-new").hidden = !fresh; $("biz-new").textContent = String(fresh);
    $("biz-new").setAttribute("aria-label", fresh + " new");

    var q = state.search.toLowerCase();
    var rows = all.filter(function (v) {
      if (state.filter !== "all" && bucket(v) !== state.filter) return false;
      if (!q) return true;
      return [v.name, v.city, v.country, v.contact_email, v.owner_email, v.legal_name, v.category]
        .some(function (s) { return s && String(s).toLowerCase().indexOf(q) >= 0; });
    });
    var list = $("biz-list");
    list.textContent = "";
    rows.forEach(function (v) {
      var img = v.cover_path ? h("img", { class: "ad-thumb", src: photoUrl(v.cover_path), alt: "", loading: "lazy" }) : h("span", { class: "ad-thumb" });
      var meta = [v.category, [v.city, countryName(v.country)].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
      var btn = h("button", { type: "button", class: "ad-biz" + (isNew(v) ? " is-new" : ""), onclick: function () { openVenue(v.id); } }, [
        img,
        h("span", {}, [
          h("span", { class: "ad-biz-name", text: (v.name || "(no name yet)") + (isNew(v) ? "  · New" : "") }),
          h("span", { class: "ad-biz-meta", text: meta || "No details yet" }),
          h("span", { class: "ad-biz-meta", text: (v.contact_email || v.owner_email || "") + " · registered " + fmtDate(v.created_at) +
            (v.note_count ? " · " + v.note_count + " note" + (v.note_count === 1 ? "" : "s") : "") }),
          h("span", { class: "ad-tags" }, statusTags(v))
        ])
      ]);
      list.appendChild(h("li", {}, [btn]));
    });
    $("biz-empty").hidden = rows.length > 0;
  }

  // ----- One business -----
  async function openVenue(id) {
    state.openVenueId = id;
    if (state.seen.indexOf(id) < 0) { state.seen.push(id); storeSeen(); renderVenues(); }
    var drawer = $("drawer");
    drawer.hidden = false;
    document.body.style.overflow = "hidden";
    $("d-name").textContent = "Loading…";
    $("d-body").textContent = "";
    $("d-name").focus();
    try { renderVenue(await rpc("admin_get_venue", { p_venue_id: id })); }
    catch (err) { $("d-name").textContent = "Could not load"; $("d-body").appendChild(h("p", { text: messageFor(err) })); }
  }
  function closeDrawer() {
    state.openVenueId = null;
    $("drawer").hidden = true;
    document.body.style.overflow = "";
  }

  function section(title, children) { return h("div", { class: "ad-section" }, [h("h3", { text: title })].concat(children)); }
  function dl(pairs) {
    var d = h("dl", { class: "ad-dl" });
    pairs.forEach(function (p) {
      if (p[1] === null || p[1] === undefined || p[1] === "") return;
      d.appendChild(h("dt", { text: p[0] }));
      d.appendChild(h("dd", {}, [p[1]]));
    });
    return d;
  }

  // A map link the business gave us (optional, added in migration 0066). Only an https
  // address becomes a link, whatever the database holds.
  function mapLink(url, label) {
    return typeof url === "string" && /^https:\/\//i.test(url)
      ? h("a", { href: url, target: "_blank", rel: "noopener noreferrer", text: label }) : null;
  }

  function renderVenue(d) {
    var v = d.venue;
    $("d-name").textContent = v.name || "(no name yet)";
    var body = $("d-body");
    body.textContent = "";
    var email = v.contact_email || (d.owner && d.owner.email) || "";

    body.appendChild(h("div", { class: "ad-tags ad-section" }, statusTags({ status: v.status, intake: d.intake && d.intake.decision })));

    // Decision and message
    var msg = h("textarea", { id: "d-msg", rows: "4", maxlength: "4000", placeholder: "Message or note" });
    var send = h("input", { type: "checkbox", id: "d-send" });
    var decided = d.intake && d.intake.decision;
    var actions = h("div", { class: "ad-actions" }, [
      decided !== "accepted" ? h("button", { type: "button", class: "ad-btn ad-btn-good", onclick: function (e) { act(e, v.id, "accept"); } }, ["Accept"]) : null,
      decided !== "declined" ? h("button", { type: "button", class: "ad-btn ad-btn-bad", onclick: function (e) { act(e, v.id, "decline"); } }, ["Decline"]) : null,
      h("button", { type: "button", class: "ad-btn ad-btn-secondary", onclick: function (e) { act(e, v.id, "note"); } }, ["Save note"]),
      decided ? h("button", { type: "button", class: "ad-btn ad-btn-ghost ad-btn-sm", onclick: function (e) { act(e, v.id, "reopen"); } }, ["Undo decision"]) : null
    ]);
    body.appendChild(section("Decision", [
      h("p", { class: "ad-callout", text: decided
        ? (decided === "accepted" ? "Accepted" : "Declined") + " on " + fmtDateTime(d.intake.decided_at) + "."
        : "Not decided yet. Accepting or declining does not publish anything: the listing stays a draft until the business finishes pricing and payments." }),
      h("label", { for: "d-msg", class: "visually-hidden", text: "Message" }), msg,
      h("label", { class: "ad-check" }, [send, h("span", { text: email ? "Email this message to the business (" + email + ")" : "No email address on this listing" })]),
      h("p", { class: "ad-muted ad-small", text: "Declining, saving a note, or emailing needs a message." }),
      actions
    ]));
    if (!email) send.disabled = true;

    // The existing go-live review, only when the listing has been submitted
    if (v.status === "pending") {
      body.appendChild(section("Listing review (goes live)", [
        h("p", { class: "ad-callout", text: "The business submitted this listing to go live. Approving publishes it to members. Request changes and Reject need the message above, which the business sees in the app." }),
        h("div", { class: "ad-actions" }, [
          h("button", { type: "button", class: "ad-btn ad-btn-good", onclick: function (e) { review(e, v.id, "approve"); } }, ["Approve listing"]),
          h("button", { type: "button", class: "ad-btn ad-btn-secondary", onclick: function (e) { review(e, v.id, "changes"); } }, ["Request changes"]),
          h("button", { type: "button", class: "ad-btn ad-btn-bad", onclick: function (e) { review(e, v.id, "reject"); } }, ["Reject listing"])
        ])
      ]));
    }

    if (d.missing && d.missing.length) {
      body.appendChild(section("Still needed before it can go live", [h("p", { class: "ad-muted", text: d.missing.map(humanise).join(", ") })]));
    }

    var addr = [v.address_line1, v.address_line2, v.city, v.region, v.postcode, countryName(v.country)].filter(Boolean).join("\n");
    body.appendChild(section("Facility", [dl([
      ["Type", d.category],
      ["Description", v.description],
      ["Address", addr],
      ["Google Maps", mapLink(v.google_maps_url, "Open in Google Maps")],
      ["Apple Maps", mapLink(v.apple_maps_url, "Open in Apple Maps")],
      ["Time zone", v.timezone],
      ["Opening hours", hoursText(v.opening_hours)],
      ["Amenities", (v.amenities || []).map(amenityLabel).join(", ")]
    ])]));
    body.appendChild(section("Business", [dl([
      ["Registered name", v.legal_name],
      ["Company number", v.company_number],
      ["Contact", v.contact_name],
      ["Contact email", v.contact_email ? h("a", { href: "mailto:" + v.contact_email, text: v.contact_email }) : null],
      ["Contact phone", v.contact_phone ? h("a", { href: "tel:" + v.contact_phone, text: v.contact_phone }) : null],
      ["Account", d.owner ? [d.owner.name, d.owner.email].filter(Boolean).join(" · ") : null],
      ["Registered", fmtDateTime(v.created_at)],
      ["Last changed", v.updated_at ? fmtDateTime(v.updated_at) : null]
    ])]));

    var photos = h("ul", { class: "ad-photos" });
    (d.photos || []).forEach(function (p) {
      var a = h("a", { href: photoUrl(p.path), target: "_blank", rel: "noopener" }, [h("img", { src: photoUrl(p.path), alt: p.is_cover ? "Cover photo" : "Photo", loading: "lazy" })]);
      photos.appendChild(h("li", {}, [a]));
    });
    body.appendChild(section("Photos (" + (d.photos || []).length + ")", [d.photos && d.photos.length ? photos : h("p", { class: "ad-muted", text: "No photos yet." })]));

    var hist = (d.notes || []).map(function (n) {
      var label = { accept: "Accepted", decline: "Declined", reopen: "Decision undone", note: "Note" }[n.kind] || n.kind;
      var mail = !n.send_to_owner ? "internal" : n.emailed_at ? "emailed to " + n.emailed_to : n.email_error ? "email failed (" + n.email_error + ")" : "email not sent";
      return h("div", { class: "ad-note " + n.kind }, [
        h("div", { class: "ad-note-head", text: label + " · " + (n.admin || "admin") + " · " + fmtDateTime(n.created_at) + " · " + mail }),
        n.body ? h("div", { class: "ad-note-body", text: n.body }) : null,
        n.send_to_owner && !n.emailed_at ? h("button", { type: "button", class: "ad-btn ad-btn-ghost ad-btn-sm", onclick: function (e) { resend(e, n.id); } }, ["Try sending again"]) : null
      ]);
    });
    body.appendChild(section("History", hist.length ? hist : [h("p", { class: "ad-muted", text: "No notes yet." })]));
  }

  async function withButton(e, fn) {
    if (state.busy) return;
    state.busy = true;
    var b = e.currentTarget; var label = b.textContent;
    document.querySelectorAll("#d-body button").forEach(function (x) { x.disabled = true; });
    b.textContent = "Saving…";
    alertMsg("");
    try { await fn(); }
    catch (err) { alertMsg(messageFor(err)); b.textContent = label; document.querySelectorAll("#d-body button").forEach(function (x) { x.disabled = false; }); }
    finally { state.busy = false; }
  }

  async function sendEmail(noteId) {
    try {
      await http(CONFIG.url + "/functions/v1/admin-notify", { absolute: true, method: "POST", json: { note_id: noteId } });
      return true;
    } catch (err) { return false; }
  }

  function act(e, venueId, kind) {
    var text = $("d-msg").value.trim();
    var send = $("d-send").checked;
    if (!text && (kind === "decline" || kind === "note" || send)) { alertMsg("Write a message first."); $("d-msg").focus(); return; }
    return withButton(e, async function () {
      var noteId = await rpc("admin_record_venue_note", { p_venue_id: venueId, p_kind: kind, p_body: text || null, p_send_to_owner: send });
      var done = { accept: "Accepted.", decline: "Declined.", reopen: "Decision undone.", note: "Note saved." }[kind];
      if (send) done += (await sendEmail(noteId)) ? " Email sent." : " The email did not send: see History.";
      await afterChange(venueId, done);
    });
  }

  function review(e, venueId, decision) {
    var text = $("d-msg").value.trim();
    var send = $("d-send").checked;
    if (decision !== "approve" && !text) { alertMsg("Write a message saying what needs to change."); $("d-msg").focus(); return; }
    if (decision === "approve" && !window.confirm("Publish this listing to members now?")) return;
    return withButton(e, async function () {
      await rpc("admin_review_venue", { p_venue_id: venueId, p_decision: decision, p_notes: text || null });
      var done = { approve: "Listing approved and live.", changes: "Changes requested.", reject: "Listing rejected." }[decision];
      if (send && text) {
        var noteId = await rpc("admin_record_venue_note", { p_venue_id: venueId, p_kind: "note", p_body: text, p_send_to_owner: true });
        done += (await sendEmail(noteId)) ? " Email sent." : " The email did not send: see History.";
      }
      await afterChange(venueId, done);
    });
  }

  function resend(e, noteId) {
    return withButton(e, async function () {
      var ok = await sendEmail(noteId);
      await afterChange(state.openVenueId, ok ? "Email sent." : "The email still did not send.");
    });
  }

  async function afterChange(venueId, message) {
    var results = await Promise.all([rpc("admin_get_venue", { p_venue_id: venueId }), rpc("admin_list_venues")]);
    state.venues = results[1];
    renderVenues();
    if (state.openVenueId === venueId) renderVenue(results[0]);
    alertMsg(message, true);
    announce(message);
    markOk();
  }

  // ===== Waitlist =====
  async function loadStats(quiet) {
    if (state.demo) {
      var demo = demoData();
      state.rows = demo.rows; state.places = demo.places;
      state.stats = demoStats(demo.rows);
      renderStats();
      return;
    }
    var s = await rpc("admin_waitlist_stats", { p_days: state.days });
    if (state.view !== "wl" && state.stats && s.total > state.stats.total) {
      if (state.wlBaseline === null) state.wlBaseline = state.stats.total;
      var diff = s.total - state.wlBaseline;
      $("wl-new").hidden = diff <= 0; $("wl-new").textContent = String(diff);
      $("wl-new").setAttribute("aria-label", diff + " new");
    }
    if (quiet && state.stats && s.total > state.stats.total) announce((s.total - state.stats.total) + " new waitlist sign-up(s).");
    // The place numbers are worked out here from the sign-ups themselves (see PLACES below),
    // so they are only re-read when the number of sign-ups has changed.
    if (!state.rows || state.rows.length !== s.total) {
      try { state.rows = await loadPlaceRows(); state.places = placeStats(state.rows); }
      catch (err) { if (!state.rows) alertMsg(messageFor(err)); }
    }
    state.stats = s;
    renderStats();
  }

  // ===== DEMO DATA: a made-up waitlist of a few thousand people =====
  // Switched on and off by the "Demo data" button on the Waitlist tab. Nothing is read from or
  // written to the database while it is on, and the switch stays visible (pressed) so a
  // screenshot cannot be mistaken for the real list. The same numbers come back every time
  // (fixed seed), counted back from today.
  var DEMO_DAYS = 60;
  var demoCache = null;
  function seeded(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function demoData() {
    var today = londonDay(new Date());
    if (demoCache && demoCache.day === today) return demoCache;
    var rnd = seeded(20261024);
    function pick(weights) { // { name: weight }
      var keys = Object.keys(weights), sum = 0, i;
      for (i = 0; i < keys.length; i++) sum += weights[keys[i]];
      var r = rnd() * sum;
      for (i = 0; i < keys.length; i++) { r -= weights[keys[i]]; if (r <= 0) return keys[i]; }
      return keys[keys.length - 1];
    }
    function pickSome(weights, n, avoid) {
      var w = {}, out = [];
      Object.keys(weights).forEach(function (k) { if (!avoid || avoid.indexOf(k) < 0) w[k] = weights[k]; });
      while (out.length < n && Object.keys(w).length) { var k = pick(w); out.push(k); delete w[k]; }
      return out;
    }
    function boost(base, extra) { var w = {}; Object.keys(base).forEach(function (k) { w[k] = base[k] * (extra[k] || 1); }); return w; }

    // Where people live: 40% London, 35% California, 20% New York, 5% elsewhere.
    var REGION = { london: 40, cali: 35, ny: 20, other: 5 };
    var HOME = {
      london: { "London": 70, "london": 10, "London, UK": 8, "LDN": 5, "Ldn": 3, "London UK": 4 },
      cali: { "Los Angeles": 26, "LA": 14, "Los Angeles, CA": 6, "los angeles": 4, "San Francisco": 14, "SF": 6,
        "San Diego": 12, "Santa Monica": 6, "Oakland": 3, "San Jose": 3, "Sacramento": 2, "Long Beach": 2, "Irvine": 2 },
      ny: { "New York": 34, "NYC": 24, "Brooklyn": 16, "Manhattan": 8, "new york": 6, "New York, NY": 6, "Queens": 4, "NY": 2 },
      other: { "Manchester": 9, "Paris": 7, "Toronto": 6, "Dublin": 6, "Miami": 6, "Chicago": 6, "Sydney": 5, "Berlin": 5,
        "Amsterdam": 5, "Edinburgh": 5, "Bristol": 5, "Austin": 4, "Dubai": 4, "Barcelona": 4, "Singapore": 3, "Boston": 4,
        "Melbourne": 3, "Lisbon": 3, "Madrid": 3, "Seattle": 3 }
    };
    // Where they might train while away, by where they live (their own city is left out).
    var TRAVEL = {
      london: { "New York": 26, "NYC": 12, "Los Angeles": 16, "LA": 8, "San Francisco": 5, "Miami": 5, "Paris": 7, "Barcelona": 7,
        "Lisbon": 6, "Amsterdam": 5, "Berlin": 4, "Dubai": 6, "Bali": 7, "Bangkok": 5, "Ibiza": 4, "Mallorca": 3, "Tulum": 2,
        "Marrakech": 2, "Rome": 3, "Athens": 2, "Mykonos": 2, "Tokyo": 3, "Sydney": 2, "Cape Town": 2, "Phuket": 2,
        "Copenhagen": 2, "Madrid": 2, "Milan": 2, "Manchester": 3, "Edinburgh": 2, "Singapore": 2, "Mexico City": 1.5 },
      cali: { "London": 34, "london": 4, "New York": 22, "NYC": 12, "Los Angeles": 7, "LA": 3, "San Francisco": 5, "San Diego": 3,
        "Miami": 5, "Austin": 3, "Las Vegas": 4, "Mexico City": 5, "Tulum": 5, "Cabo": 3, "Honolulu": 4, "Bali": 6, "Tokyo": 6,
        "Paris": 5, "Barcelona": 4, "Lisbon": 3, "Bangkok": 3, "Sydney": 2, "Chicago": 2, "Seattle": 2, "Costa Rica": 2 },
      ny: { "London": 36, "london": 4, "Los Angeles": 20, "LA": 10, "Miami": 8, "San Francisco": 4, "Paris": 5, "Barcelona": 4,
        "Lisbon": 3, "Tulum": 4, "Mexico City": 3, "San Juan": 2, "Chicago": 3, "Austin": 2, "Bali": 4, "Tokyo": 4,
        "Bangkok": 3, "Rome": 3, "Amsterdam": 3, "Boston": 3, "Washington DC": 2 },
      other: { "London": 20, "New York": 14, "NYC": 4, "Los Angeles": 10, "Paris": 5, "Bali": 5, "Bangkok": 4, "Dubai": 4,
        "Barcelona": 4, "Lisbon": 3, "Tokyo": 3, "Miami": 3 }
    };
    var SAME = { london: ["London", "london"], cali: ["Los Angeles", "LA"], ny: ["New York", "NYC"], other: [] };
    // What people do, then what they want to try, nudged by where they live.
    var DOES = { "Weightlifting": 30, "Running": 28, "Yoga": 20, "Pilates": 18, "Swimming": 14, "Cycling & spin": 12,
      "Functional fitness & CrossFit": 12, "Boxing": 10, "Football": 9, "Climbing & bouldering": 7, "Tennis": 7, "Padel": 5,
      "Dance & barre": 6, "Calisthenics": 5, "Basketball": 4, "Recovery & wellness": 6, "Rowing": 3, "Muay Thai": 3,
      "Brazilian Jiu-Jitsu": 3, "Kickboxing": 3, "Squash & badminton": 3, "Rugby": 2, "Netball": 1.5, "Cricket": 1.5,
      "Volleyball": 2, "Gymnastics": 1, "Judo": 1, "Karate": 1, "Other": 2.5 };
    var TRIES = { "Padel": 16, "Pilates": 18, "Boxing": 15, "Climbing & bouldering": 16, "Muay Thai": 10, "Yoga": 12,
      "Recovery & wellness": 12, "Dance & barre": 8, "Brazilian Jiu-Jitsu": 7, "Tennis": 8, "Swimming": 6,
      "Functional fitness & CrossFit": 6, "Calisthenics": 7, "Rowing": 4, "Kickboxing": 5, "Volleyball": 4, "Running": 4,
      "Weightlifting": 5, "Cycling & spin": 5, "Gymnastics": 2, "Judo": 1.5, "Karate": 1, "Squash & badminton": 3,
      "Basketball": 2, "Football": 2, "Other": 2.5 };
    var LEAN = {
      london: { "Padel": 1.8, "Football": 1.6, "Netball": 2.5, "Cricket": 2.5, "Rugby": 2, "Functional fitness & CrossFit": 1.2 },
      cali: { "Yoga": 1.6, "Pilates": 1.5, "Volleyball": 2.2, "Climbing & bouldering": 1.5, "Brazilian Jiu-Jitsu": 1.6, "Football": 0.6, "Cricket": 0.2, "Netball": 0.2 },
      ny: { "Boxing": 1.7, "Pilates": 1.4, "Running": 1.3, "Cycling & spin": 1.6, "Basketball": 2, "Football": 0.6, "Cricket": 0.2, "Netball": 0.2 },
      other: {}
    };
    // People who do these lean towards certain trips (yoga to Bali, Muay Thai to Thailand).
    var TRIP_PULL = {
      "Yoga": { "Bali": 2.5, "Tulum": 2, "Ibiza": 1.5, "Costa Rica": 2 },
      "Recovery & wellness": { "Bali": 2, "Tulum": 1.6, "Marrakech": 1.5 },
      "Pilates": { "Los Angeles": 1.2, "LA": 1.2, "Ibiza": 1.3 },
      "Muay Thai": { "Bangkok": 9, "Phuket": 9 }, "Kickboxing": { "Bangkok": 3, "Phuket": 3 }, "Boxing": { "Bangkok": 1.6 },
      "Brazilian Jiu-Jitsu": { "San Diego": 1.5, "Los Angeles": 1.2 },
      "Volleyball": { "Los Angeles": 1.3, "San Diego": 1.5, "Honolulu": 1.6 },
      "Swimming": { "Mallorca": 1.4, "Mykonos": 1.4, "Honolulu": 1.4 }
    };
    var OTHER = { "Surfing": 14, "Hyrox": 12, "Golf": 8, "Skiing": 6, "Hiking": 7, "Hot yoga": 6, "Pole fitness": 4,
      "Ultimate frisbee": 3, "Lacrosse": 3, "Aerial yoga": 3, "surfing": 3, "hyrox": 3, "Sauna and cold plunge": 4,
      "Spartan races": 2, "Trail running": 3, "Paddleboarding": 3, "Kayaking": 2, "Skateboarding": 2, "Horse riding": 2 };

    // Sign-ups per day: a slow start that builds over two months, quieter at weekends,
    // with a couple of busier days when word spread.
    var now = new Date(), rows = [];
    var dayStart = new Date(today + "T00:00:00Z").getTime();
    for (var d = 0; d < DEMO_DAYS; d++) {
      var ago = DEMO_DAYS - 1 - d, x = d / (DEMO_DAYS - 1);
      var base = 6 + 165 * Math.pow(x, 1.9);
      var date = new Date(dayStart - ago * 86400000);
      var dow = date.getUTCDay();
      var n = base * (dow === 0 || dow === 6 ? 0.78 : 1) * (0.82 + rnd() * 0.36);
      if (ago === 23) n *= 1.9; if (ago === 9) n *= 1.45;
      var fraction = 1;
      if (ago === 0) {
        var hm = now.toLocaleTimeString("en-GB", { timeZone: TZ, hour12: false }).split(":");
        fraction = Math.max(0.05, (Number(hm[0]) * 60 + Number(hm[1])) / 1440);
      }
      n = Math.round(n * Math.min(1, fraction));
      for (var i = 0; i < n; i++) {
        var region = pick(REGION);
        var does = pickSome(boost(DOES, LEAN[region]), [1, 1, 2, 2, 2, 3, 3, 4][Math.floor(rnd() * 8)]);
        var tries = pickSome(boost(TRIES, LEAN[region]), [0, 1, 1, 1, 2, 2, 3][Math.floor(rnd() * 7)], does);
        var pull = {};
        does.concat(tries).forEach(function (a) {
          var p = TRIP_PULL[a] || {};
          Object.keys(p).forEach(function (k) { pull[k] = (pull[k] || 1) * p[k]; });
        });
        var howMany = [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 4][Math.floor(rnd() * 12)];
        var trips = pickSome(boost(TRAVEL[region], pull), howMany, SAME[region]);
        var minute = ago === 0 ? Math.floor(rnd() * fraction * 1440) : Math.floor(rnd() * 1440);
        rows.push({
          created_at: new Date(date.getTime() + minute * 60000).toISOString(),
          day: date.toISOString().slice(0, 10),
          home_city: rnd() < 0.88 ? pick(HOME[region]) : null,
          regular_activities: does, interested_activities: tries, travel_destinations: trips,
          other_regular_activity: does.indexOf("Other") >= 0 ? pick(OTHER) : null,
          other_interested_activity: tries.indexOf("Other") >= 0 ? pick(OTHER) : null
        });
      }
    }
    rows.sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; });
    demoCache = { day: today, rows: rows, places: placeStats(rows) };
    return demoCache;
  }

  function demoStats(rows) {
    var today = londonDay(new Date());
    function daysAgo(n) { return new Date(new Date(today + "T12:00:00Z").getTime() - n * 86400000).toISOString().slice(0, 10); }
    var perDay = {}, reg = {}, int = {}, other = {}, otherLabel = {};
    function add(map, k) { map[k] = (map[k] || 0) + 1; }
    rows.forEach(function (r) {
      add(perDay, r.day);
      r.regular_activities.forEach(function (a) { add(reg, a); });
      r.interested_activities.forEach(function (a) { add(int, a); });
      [r.other_regular_activity, r.other_interested_activity].forEach(function (o) {
        if (!o) return;
        var k = o.trim().toLowerCase(); add(other, k);
        otherLabel[k] = otherLabel[k] || {}; add(otherLabel[k], o.trim());
      });
    });
    function sorted(map, label) {
      return Object.keys(map).map(function (k) { return { label: label ? label(k) : k, count: map[k] }; })
        .sort(function (a, b) { return b.count - a.count || (a.label < b.label ? -1 : 1); });
    }
    function between(from, to) { var n = 0; for (var i = from; i < to; i++) n += perDay[daysAgo(i)] || 0; return n; }
    var by = [];
    for (var i = state.days - 1; i >= 0; i--) by.push({ day: daysAgo(i), count: perDay[daysAgo(i)] || 0 });
    return {
      total: rows.length, today: between(0, 1), last7: between(0, 7), prev7: between(7, 14), last30: between(0, 30),
      by_day: by, regular: sorted(reg), interested: sorted(int),
      other_text: sorted(other, function (k) {
        var m = otherLabel[k]; return Object.keys(m).sort(function (a, b) { return m[b] - m[a]; })[0];
      }).slice(0, 30),
      latest: []
    };
  }
  function londonDay(d) { return d.toLocaleDateString("en-CA", { timeZone: TZ }); }

  function setDemo(on) {
    state.demo = on;
    $("wl-demo").setAttribute("aria-pressed", String(on));
    $("wl-csv").disabled = on;
    $("wl-latest-card").hidden = on;
    state.rows = null; state.places = null; state.stats = null;
    closePlace();
    loadStats(false).catch(function (err) { alertMsg(messageFor(err)); });
  }

  async function loadPlaceRows() {
    var rows = [], page = 1000;
    for (var off = 0; ; off += page) {
      var chunk = await http("/rest/v1/waitlist_signups?select=home_city,travel_destinations,regular_activities,interested_activities" +
        "&order=created_at.desc&limit=" + page + "&offset=" + off) || [];
      rows = rows.concat(chunk);
      if (chunk.length < page) return rows;
    }
  }

  // ===== PLACES: one city, however it was typed =====
  // "NYC", "ny", "N.Y.C.", "Manhattan" and "New York, NY" all count as New York. Accents, dots,
  // capitals and a trailing country ("Leeds, UK", "london uk") are ignored. A person who typed
  // two names for one city counts once. To add a nickname, add it to the city's list below
  // (lower case, no dots). Anything not listed is grouped by its cleaned-up spelling.
  var CITY_NAMES = {
    "New York": ["new york", "new york city", "nyc", "ny", "ny ny", "nyc ny", "new york ny", "new york new york",
      "manhattan", "brooklyn", "queens", "bronx", "the bronx", "staten island", "big apple", "the big apple", "纽约"],
    "London": ["london", "ldn", "lon", "greater london", "central london", "city of london", "伦敦"],
    "Los Angeles": ["los angeles", "la", "los angeles ca", "la ca"],
    "San Francisco": ["san francisco", "sf", "san fran", "san fransisco", "frisco"],
    "Washington DC": ["washington dc", "dc", "washington d c", "wdc"],
    "Las Vegas": ["las vegas", "vegas", "lv"],
    "Philadelphia": ["philadelphia", "philly"],
    "Chicago": ["chicago", "chi town", "chitown", "chi"],
    "New Orleans": ["new orleans", "nola"],
    "Atlanta": ["atlanta", "atl"],
    "Manchester": ["manchester", "manc", "mcr"],
    "Birmingham": ["birmingham", "brum", "bham"],
    "Newcastle": ["newcastle", "newcastle upon tyne"],
    "Mexico City": ["mexico city", "cdmx", "ciudad de mexico", "mexico df", "df"],
    "Rio de Janeiro": ["rio de janeiro", "rio"],
    "São Paulo": ["sao paulo", "sampa"],
    "Hong Kong": ["hong kong", "hk", "hong kong sar", "香港"],
    "Kuala Lumpur": ["kuala lumpur", "kl"],
    "Ho Chi Minh City": ["ho chi minh city", "ho chi minh", "hcmc", "hcm", "saigon"],
    "Bangkok": ["bangkok", "bkk"],
    "Singapore": ["singapore", "sg", "新加坡"],
    "Dubai": ["dubai", "dxb"],
    "Barcelona": ["barcelona", "bcn", "barca"],
    "Johannesburg": ["johannesburg", "joburg", "jozi", "jhb"],
    "Melbourne": ["melbourne", "melb"],
    "Copenhagen": ["copenhagen", "cph"],
    "Milan": ["milan", "milano"], "Munich": ["munich", "munchen"], "Rome": ["rome", "roma"],
    "Lisbon": ["lisbon", "lisboa"], "Florence": ["florence", "firenze"], "Prague": ["prague", "praha"],
    "Vienna": ["vienna", "wien"], "Brussels": ["brussels", "bruxelles"], "Cologne": ["cologne", "koln"],
    "Venice": ["venice", "venezia"], "Naples": ["naples", "napoli"], "Seville": ["seville", "sevilla"],
    "Marrakech": ["marrakech", "marrakesh"], "Beijing": ["beijing", "北京"], "Shanghai": ["shanghai", "上海"]
  };
  var CITY_BY_NAME = {};
  Object.keys(CITY_NAMES).forEach(function (c) { CITY_NAMES[c].forEach(function (n) { CITY_BY_NAME[n] = c; }); });
  // A country or state after a comma ("Leeds, UK") is dropped. Without a comma only these few
  // are, so that "New Mexico" stays "New Mexico".
  var AFTER_COMMA = /^(uk|gb|england|scotland|wales|northern ireland|united kingdom|great britain|britain|usa|us|america|united states|united states of america|ny|ca|fl|tx|il|ma|california|florida|texas|france|spain|italy|germany|portugal|netherlands|japan|china|australia|canada|uae|thailand|greece|ireland|mexico|brazil)$/;
  var TRAILING = / (uk|usa|us|england|united kingdom|united states|gb|uae)$/;

  function tidy(s) { return s.replace(/\s+/g, " ").trim().replace(TRAILING, ""); }
  function placeOf(raw) {
    var original = String(raw || "").trim();
    var s = original.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/[.'’]/g, "").replace(/[^\p{L}\p{N},]+/gu, " ");
    var parts = s.split(",").map(tidy).filter(Boolean);
    if (!parts.length) return null;
    var tries = [parts.join(" ")].concat(parts);
    for (var i = 0; i < tries.length; i++) {
      var city = CITY_BY_NAME[tries[i]];
      if (city) return { key: "=" + city, label: city };
    }
    var keep = [parts[0]].concat(parts.slice(1).filter(function (p) { return !AFTER_COMMA.test(p); }));
    return { key: keep.join(" "), label: null, spelling: original.split(",")[0].trim() };
  }

  // Everything the place cards and the place window show, from the raw sign-ups.
  function placeStats(rows) {
    var groups = {};
    function group(p) {
      var g = groups[p.key];
      if (!g) g = groups[p.key] = { key: p.key, label: p.label, spellings: {}, wantTo: 0, live: 0, acts: {} };
      if (!p.label) g.spellings[p.spelling] = (g.spellings[p.spelling] || 0) + 1;
      return g;
    }
    var withDest = 0;
    rows.forEach(function (r) {
      var acts = {};
      (r.regular_activities || []).concat(r.interested_activities || []).forEach(function (a) { if (a && a !== "Other") acts[a] = true; });
      var seen = {};
      (r.travel_destinations || []).forEach(function (d) {
        var p = placeOf(d);
        if (!p || seen[p.key]) return;
        seen[p.key] = true;
        var g = group(p);
        g.wantTo++;
        Object.keys(acts).forEach(function (a) { g.acts[a] = (g.acts[a] || 0) + 1; });
      });
      if (Object.keys(seen).length) withDest++;
      var home = placeOf(r.home_city);
      if (home) group(home).live++;
    });
    var list = Object.keys(groups).map(function (k) {
      var g = groups[k];
      if (!g.label) {
        g.label = Object.keys(g.spellings).sort(function (a, b) { return g.spellings[b] - g.spellings[a] || (a < b ? -1 : 1); })[0];
      }
      g.activities = Object.keys(g.acts).map(function (a) { return { label: a, count: g.acts[a] }; })
        .sort(function (a, b) { return b.count - a.count || (a.label < b.label ? -1 : 1); });
      return g;
    });
    function by(field) {
      return list.filter(function (g) { return g[field] > 0; })
        .sort(function (a, b) { return b[field] - a[field] || (a.label < b.label ? -1 : 1); });
    }
    return { withDest: withDest, train: by("wantTo"), live: by("live") };
  }

  // ----- Place and activity: a short list of cities, each opening a window -----
  var PLACES_SHOWN = 8;
  function renderPlaces() {
    var ol = $("wl-combos");
    ol.textContent = "";
    var train = state.places ? state.places.train : [];
    if (!state.places) { ol.appendChild(h("li", { class: "ad-bars-empty", text: "Could not load. It will try again shortly." })); return; }
    if (!train.length) { ol.appendChild(h("li", { class: "ad-bars-empty", text: "Nothing yet." })); return; }
    train.slice(0, PLACES_SHOWN).forEach(function (g) {
      var top = g.activities.slice(0, 3).map(function (a) { return a.label; }).join(", ");
      ol.appendChild(h("li", {}, [h("button", { type: "button", class: "ad-place", onclick: function (e) { openPlace(g.key, e.currentTarget); } }, [
        h("span", { class: "ad-place-name", text: g.label }),
        h("span", { class: "ad-bar-num", text: fmtNum(g.wantTo) + (g.wantTo === 1 ? " person" : " people") }),
        h("span", { class: "ad-place-top", text: top || "No activities picked" })
      ])]));
    });
    if (train.length > PLACES_SHOWN) {
      ol.appendChild(h("li", {}, [h("button", { type: "button", class: "ad-btn ad-btn-ghost ad-btn-sm",
        onclick: function (e) { openPlace(train[PLACES_SHOWN].key, e.currentTarget); } }, ["See all " + fmtNum(train.length) + " places"])]));
    }
  }

  function openPlace(key, opener) {
    state.placeKey = key;
    if (opener) state.placeOpener = opener;
    $("place-modal").hidden = false;
    document.body.style.overflow = "hidden";
    renderPlace();
    $("pm-name").focus();
  }
  function closePlace() {
    if ($("place-modal").hidden) return;
    $("place-modal").hidden = true;
    document.body.style.overflow = "";
    state.placeKey = null;
    if (state.placeOpener && document.body.contains(state.placeOpener)) state.placeOpener.focus();
  }
  function stepPlace(by) {
    var train = state.places.train;
    var i = train.findIndex(function (g) { return g.key === state.placeKey; });
    var next = train[(i + by + train.length) % train.length];
    if (next) { state.placeKey = next.key; renderPlace(); }
  }
  function renderPlace() {
    if ($("place-modal").hidden || !state.places) return;
    var train = state.places.train;
    var i = train.findIndex(function (g) { return g.key === state.placeKey; });
    if (i < 0) { closePlace(); return; }
    var g = train[i];
    $("pm-name").textContent = g.label;
    $("pm-pos").textContent = (i + 1) + " of " + train.length;
    var sel = $("pm-select");
    sel.textContent = "";
    train.forEach(function (x) { sel.appendChild(h("option", { value: x.key, selected: x.key === g.key, text: x.label + " (" + fmtNum(x.wantTo) + ")" })); });
    $("pm-prev").disabled = $("pm-next").disabled = train.length < 2;
    $("pm-summary").textContent = fmtNum(g.wantTo) + (g.wantTo === 1 ? " person wants" : " people want") + " to train here" +
      (g.live ? ", and " + fmtNum(g.live) + " live here" : "") + ". What they do or want to try:";
    bars($("pm-acts"), g.activities, g.wantTo);
  }

  function renderStats() {
    var s = state.stats;
    if (!s) return;
    var k = $("wl-kpis");
    k.textContent = "";
    var change = s.prev7 ? Math.round((s.last7 - s.prev7) / s.prev7 * 100) : null;
    [
      ["Total sign-ups", s.total, ""],
      ["Today", s.today, "London time"],
      ["Last 7 days", s.last7, change === null ? (s.prev7 === 0 && s.last7 ? "none the week before" : "") : (change >= 0 ? "+" : "") + change + "% on the week before", change === null ? "" : change >= 0 ? "up" : "down"],
      ["Last 30 days", s.last30, ""]
    ].forEach(function (x) {
      k.appendChild(h("div", { class: "ad-kpi" }, [
        h("div", { class: "ad-kpi-label", text: x[0] }),
        h("div", { class: "ad-kpi-value", text: fmtNum(x[1]) }),
        h("div", { class: "ad-kpi-sub " + (x[3] || ""), text: x[2] })
      ]));
    });

    drawChart(s.by_day || []);
    bars($("wl-regular"), s.regular, s.total);
    bars($("wl-interested"), s.interested, s.total);
    var P = state.places;
    function asBars(list, field) { return list.map(function (g) { return { label: g.label, count: g[field] }; }); }
    var withDest = P ? P.withDest : s.with_destination;
    $("wl-dest-note").textContent = fmtNum(withDest) + " of " + fmtNum(s.total) + " named at least one place.";
    bars($("wl-dest"), P ? asBars(P.train, "wantTo") : s.destinations, withDest);
    bars($("wl-home"), P ? asBars(P.live, "live") : s.home_cities, null);
    renderPlaces();
    renderPlace();
    bars($("wl-other"), s.other_text, null);

    var tb = $("wl-latest");
    tb.textContent = "";
    (s.latest || []).forEach(function (r) {
      var fresh = state.wlOpenedAt && r.created_at > state.wlOpenedAt;
      tb.appendChild(h("tr", { class: fresh ? "is-new" : "" }, [
        h("td", { text: fmtDateTime(r.created_at) }),
        h("td", {}, [h("a", { href: "mailto:" + r.email, text: r.email })]),
        h("td", { text: (r.regular_activities || []).join(", ") }),
        h("td", { text: (r.interested_activities || []).join(", ") }),
        h("td", { text: (r.travel_destinations || []).concat(r.home_city ? ["home: " + r.home_city] : []).join(", ") })
      ]));
    });
    if (!(s.latest || []).length) tb.appendChild(h("tr", {}, [h("td", { colspan: "5", class: "ad-muted", text: "No sign-ups yet." })]));
  }

  function bars(ol, items, of) {
    ol.textContent = "";
    items = items || [];
    if (!items.length) { ol.appendChild(h("li", { class: "ad-bars-empty", text: "Nothing yet." })); return; }
    var max = Math.max.apply(null, items.map(function (i) { return i.count; }));
    items.slice(0, 15).forEach(function (i) {
      var pct = of ? " (" + Math.round(i.count / of * 100) + "%)" : "";
      var fill = h("span", { class: "ad-bar-fill" });
      fill.style.width = Math.max(2, i.count / max * 100) + "%"; // CSSOM, which the CSP allows (a style attribute it would block)
      ol.appendChild(h("li", { class: "ad-bar-row" }, [
        h("span", { class: "ad-bar-label", title: i.label, text: i.label }),
        h("span", { class: "ad-bar-num", text: fmtNum(i.count) + pct }),
        h("span", { class: "ad-bar-track", "aria-hidden": "true" }, [fill])
      ]));
    });
    if (items.length > 15) ol.appendChild(h("li", { class: "ad-bars-empty", text: "+ " + (items.length - 15) + " more in the CSV" }));
  }

  var SVGNS = "http://www.w3.org/2000/svg";
  function svg(tag, attrs) {
    var el = document.createElementNS(SVGNS, tag);
    Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    return el;
  }
  function drawChart(days) {
    var box = $("wl-chart");
    box.textContent = "";
    var W = Math.max(280, box.clientWidth || 600), H = 180, padL = 28, padB = 20, padT = 8;
    var max = Math.max(1, Math.max.apply(null, days.map(function (d) { return d.count; })));
    var step = niceStep(max), top = Math.ceil(max / step) * step;
    var total = days.reduce(function (a, d) { return a + d.count; }, 0);
    var root = svg("svg", { viewBox: "0 0 " + W + " " + H, role: "img",
      "aria-label": total + " sign-ups in the last " + days.length + " days" });
    for (var y = 0; y <= top; y += step) {
      var yy = H - padB - (y / top) * (H - padB - padT);
      root.appendChild(svg("line", { class: "grid", x1: padL, x2: W, y1: yy, y2: yy }));
      var t = svg("text", { class: "axis", x: padL - 4, y: yy + 3, "text-anchor": "end" }); t.textContent = String(y); root.appendChild(t);
    }
    var bw = (W - padL) / Math.max(1, days.length);
    var labelEvery = Math.ceil(days.length / 6);
    days.forEach(function (d, i) {
      var bh = (d.count / top) * (H - padB - padT);
      var x = padL + i * bw;
      root.appendChild(svg("rect", { class: "bar" + (i === days.length - 1 ? " today" : ""), x: x + bw * 0.15, width: Math.max(1, bw * 0.7),
        y: H - padB - bh, height: Math.max(d.count ? 1 : 0, bh), rx: Math.min(2, bw / 4) }));
      if (i % labelEvery === 0) {
        var t2 = svg("text", { class: "axis", x: x + bw / 2, y: H - 5, "text-anchor": "middle" });
        t2.textContent = fmtShortDay(d.day); root.appendChild(t2);
      }
    });
    var tip = h("div", { class: "ad-chart-tip", hidden: true });
    root.addEventListener("pointermove", function (e) {
      var r = root.getBoundingClientRect();
      var i = Math.floor(((e.clientX - r.left) / r.width * W - padL) / bw);
      if (i < 0 || i >= days.length) { tip.hidden = true; return; }
      tip.hidden = false;
      tip.textContent = fmtLongDay(days[i].day) + ": " + days[i].count;
      tip.style.left = Math.min(r.width - 60, Math.max(60, e.clientX - r.left)) + "px";
    });
    root.addEventListener("pointerleave", function () { tip.hidden = true; });
    box.appendChild(root);
    box.appendChild(tip);
  }
  function niceStep(max) {
    var raw = max / 4, mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    var n = raw / mag;
    return Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag);
  }

  // CSV of every sign-up, fetched 1000 rows at a time.
  async function downloadCsv(e) {
    if (state.busy) return;
    state.busy = true;
    var b = e.currentTarget; b.disabled = true; b.textContent = "Preparing…";
    try {
      var cols = ["created_at", "email", "home_city", "regular_activities", "interested_activities",
        "travel_destinations", "other_regular_activity", "other_interested_activity"];
      var rows = [], page = 1000;
      for (var off = 0; ; off += page) {
        var chunk = await http("/rest/v1/waitlist_signups?select=" + cols.join(",") + "&order=created_at.desc&limit=" + page + "&offset=" + off);
        chunk = chunk || [];
        rows = rows.concat(chunk);
        if (chunk.length < page) break;
      }
      var lines = [cols.join(",")].concat(rows.map(function (r) {
        return cols.map(function (c) { return csvCell(Array.isArray(r[c]) ? r[c].join("; ") : r[c]); }).join(",");
      }));
      var blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
      var a = h("a", { href: URL.createObjectURL(blob), download: "wegogym-waitlist-" + new Date().toISOString().slice(0, 10) + ".csv" });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000);
      announce(rows.length + " rows downloaded.");
    } catch (err) { alertMsg(messageFor(err)); }
    finally { state.busy = false; b.disabled = false; b.textContent = "Download CSV"; }
  }
  function csvCell(v) {
    if (v === null || v === undefined) return "";
    var s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // a spreadsheet must never run a typed formula
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // ===== Formatting =====
  function fmtNum(n) { return Number(n || 0).toLocaleString("en-GB"); }
  function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: TZ }) : ""; }
  function fmtDateTime(iso) { return iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TZ }) : ""; }
  function fmtTime(d) { return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: TZ }); }
  function fmtShortDay(day) { return new Date(day + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }); }
  function fmtLongDay(day) { return new Date(day + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }); }
  function humanise(s) { s = String(s || "").replace(/_/g, " "); return s.charAt(0).toUpperCase() + s.slice(1); }
  function amenityLabel(s) { return s.indexOf("other:") === 0 ? s.slice(6) : humanise(s); }
  var regionNames = null;
  function countryName(code) {
    if (!code) return "";
    try { regionNames = regionNames || new Intl.DisplayNames(["en-GB"], { type: "region" }); return regionNames.of(code) || code; }
    catch (e) { return code; }
  }
  function hoursText(o) {
    if (!o || !Object.keys(o).length) return "";
    var names = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
    return Object.keys(names).map(function (d) { return names[d] + "  " + (o[d] ? o[d].replace("-", " to ") : "closed"); }).join("\n");
  }
  function photoUrl(path) {
    return CONFIG.url + "/storage/v1/object/public/venue-photos/" + String(path).split("/").map(encodeURIComponent).join("/");
  }

  // ===== Start =====
  async function start() {
    if (window.top !== window.self) { show("view-offline"); return; } // never inside another site's frame

    $("login-form").addEventListener("submit", logIn);
    $("mfa-form").addEventListener("submit", function (e) { submitCode(e, "mfa-code", "Verify"); });
    $("enrol-form").addEventListener("submit", function (e) { submitCode(e, "enrol-code", "Turn on and continue"); });
    $("ad-signout").addEventListener("click", logOut);
    $("denied-out").addEventListener("click", logOut);
    $("tab-biz").addEventListener("click", function () { selectView("biz"); });
    $("tab-wl").addEventListener("click", function () { selectView("wl"); });
    $("ad-tabs").addEventListener("keydown", function (e) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      var next = state.view === "biz" ? "wl" : "biz";
      selectView(next); $(next === "biz" ? "tab-biz" : "tab-wl").focus();
    });
    document.querySelectorAll("#biz-filters button").forEach(function (b) {
      b.addEventListener("click", function () { state.filter = b.dataset.filter; renderVenues(); });
    });
    $("biz-search").addEventListener("input", function (e) { state.search = e.target.value.trim(); renderVenues(); });
    document.querySelectorAll("#drawer [data-close]").forEach(function (b) { b.addEventListener("click", closeDrawer); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !$("place-modal").hidden) { closePlace(); return; }
      if (e.key === "Escape" && !$("drawer").hidden) closeDrawer();
      if (!$("place-modal").hidden && e.target.tagName !== "SELECT" && (e.key === "ArrowLeft" || e.key === "ArrowRight")) stepPlace(e.key === "ArrowLeft" ? -1 : 1);
    });
    document.querySelectorAll("#place-modal [data-close]").forEach(function (b) { b.addEventListener("click", closePlace); });
    $("pm-prev").addEventListener("click", function () { stepPlace(-1); });
    $("pm-next").addEventListener("click", function () { stepPlace(1); });
    $("pm-select").addEventListener("change", function (e) { state.placeKey = e.target.value; renderPlace(); });
    document.querySelectorAll("#wl-range button").forEach(function (b) {
      b.addEventListener("click", function () {
        state.days = Number(b.dataset.days);
        document.querySelectorAll("#wl-range button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
        loadStats(false).catch(function (err) { alertMsg(messageFor(err)); });
      });
    });
    $("wl-csv").addEventListener("click", downloadCsv);
    $("wl-demo").addEventListener("click", function () { setDemo(!state.demo); });
    var resizeTimer;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { if (state.stats && state.view === "wl") drawChart(state.stats.by_day || []); }, 150);
    });

    setInterval(tick, CONFIG.refreshSeconds * 1000);
    setInterval(paintLive, 5000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) tick(); });

    try { state.session = JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch (e) { state.session = null; }
    if (!state.session) { show("view-login"); return; }
    try { await mfaGate(); }
    catch (err) { show("view-login"); alertMsg(messageFor(err)); }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
