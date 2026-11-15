/* WeGoGym Partnerships: wegogym.club/partnerships/
 *
 * A three-step form for organisers who already run events: about you, your events (each one-off
 * or recurring), then a check before sending. It sends one JSON request to the `partnerships`
 * edge function, which stores the application for an admin to review by hand. Nothing here
 * creates a live event, and nothing is kept in the browser: it holds personal details, so there
 * is no draft saving.
 *
 * Plain DOM, no libraries: the site's Content-Security-Policy only allows scripts from this
 * domain. Every piece of text is set as text, never as HTML.
 *
 * The rules below mirror supabase/functions/partnerships/handler.ts. The function is the one
 * that enforces them; these checks only save the visitor a round trip.
 */
(function () {
  "use strict";

  // ===== EDIT: settings =====
  var ENDPOINT = "https://yxgwywppajvxfmmjudaq.supabase.co/functions/v1/partnerships";

  var MAX_EVENTS = 10;
  var MAX_FIRST_DATE_DAYS = 548;   // how far ahead the first date may be
  var MAX_SERIES_END_DAYS = 730;   // how far ahead a repeating event may end
  var MIN_PENCE = 100;             // £1 minimum ticket
  var MAX_PENCE = 100000;          // £1,000 maximum ticket

  var CATEGORIES = [
    ["run", "Running"], ["ride", "Cycling"], ["walk", "Walking"], ["train", "Strength and gym"],
    ["yoga_pilates", "Yoga and Pilates"], ["dance", "Dance"], ["swim", "Swimming"], ["climb", "Climbing"],
    ["ball_sports", "Ball sports"], ["eat_drink", "Food and drink"], ["social", "Social and wellbeing"],
    ["other", "Something else"]
  ];
  var RECURRENCE = [["weekly", "Every week"], ["fortnightly", "Every two weeks"], ["monthly", "Every month"]];
  var STEPS = ["you", "events", "review"];

  var state = { step: "you", uid: 0, sending: false, sent: false };

  function $(id) { return document.getElementById(id); }

  // ===== Small DOM helper =====
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
      el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return el;
  }

  // ===== Dates (London) =====
  function londonToday() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
  }
  function addDays(iso, days) {
    var d = new Date(iso + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
  function isRealDate(iso) {
    return /^\d{4}-\d{2}-\d{2}$/.test(iso) && !isNaN(Date.parse(iso + "T12:00:00Z")) &&
      new Date(iso + "T12:00:00Z").toISOString().slice(0, 10) === iso;
  }
  function niceDate(iso) {
    return new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  }

  // ===== Money: pounds typed by a person to whole pence, without floating point =====
  function penceFrom(text) {
    var m = /^£?\s*(\d{1,4})(?:\.(\d{1,2}))?$/.exec(String(text || "").trim());
    if (!m) return null;
    var pence = parseInt(m[1], 10) * 100 + (m[2] ? parseInt((m[2] + "0").slice(0, 2), 10) : 0);
    return pence >= MIN_PENCE && pence <= MAX_PENCE ? pence : null;
  }
  function pounds(pence) { return "£" + (pence / 100).toFixed(2); }

  // ===== Errors under fields =====
  function setError(input, message) {
    var field = input.closest(".br-field") || input.closest(".pt-choice") || input.parentNode;
    var old = field.querySelector(".br-field-error");
    if (old) old.remove();
    input.removeAttribute("aria-invalid");
    if (!message) return;
    var p = h("p", { class: "br-field-error", id: input.id + "-err", text: message });
    field.appendChild(p);
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", p.id);
  }
  function clearErrorsOn(root) {
    Array.prototype.forEach.call(root.querySelectorAll(".br-field-error"), function (p) { p.remove(); });
    Array.prototype.forEach.call(root.querySelectorAll("[aria-invalid]"), function (el) { el.removeAttribute("aria-invalid"); });
  }
  function alertMsg(text) { $("pt-alert").textContent = text || ""; }
  function announce(text) { $("pt-live").textContent = text; }

  // ===== Building one field =====
  function field(id, labelText, control, opts) {
    opts = opts || {};
    var label = h("label", { for: id }, [labelText + (opts.optional ? " " : "")]);
    if (opts.optional) label.appendChild(h("span", { class: "wl-optional", text: "(optional)" }));
    var kids = [label, control];
    if (opts.hint) kids.push(h("p", { class: "wl-hint", text: opts.hint }));
    var wrap = h("div", { class: "br-field" + (opts.extra ? " " + opts.extra : "") }, kids);
    return wrap;
  }
  function input(id, type, attrs) {
    var a = { id: id, type: type };
    Object.keys(attrs || {}).forEach(function (k) { a[k] = attrs[k]; });
    var el = h("input", a);
    el.addEventListener("input", function () { setError(el, ""); });
    return el;
  }
  function select(id, options, blank) {
    var el = h("select", { id: id });
    if (blank) el.appendChild(h("option", { value: "", text: blank }));
    options.forEach(function (o) { el.appendChild(h("option", { value: o[0], text: o[1] })); });
    el.addEventListener("change", function () { setError(el, ""); });
    return el;
  }
  function radios(name, id, legendText, options, onChange) {
    var chips = h("div", { class: "chips" });
    options.forEach(function (o, i) {
      var rid = id + "-" + o[0];
      var r = h("input", { type: "radio", name: name, id: rid, value: o[0], checked: i === 0 });
      r.addEventListener("change", onChange);
      chips.appendChild(h("label", { class: "chip", for: rid }, [r, h("span", { text: o[1] })]));
    });
    return h("fieldset", { class: "pt-choice", id: id }, [h("legend", { text: legendText }), chips]);
  }

  // ===== One event card =====
  function addEvent(focus) {
    var list = $("pt-events");
    if (list.children.length >= MAX_EVENTS) return;
    var n = ++state.uid, p = "ev" + n, today = londonToday();

    var title = input(p + "-title", "text", { maxlength: "120", autocomplete: "off", required: true });
    var cat = select(p + "-cat", CATEGORIES, "Choose one");
    var area = input(p + "-area", "text", { maxlength: "120", autocomplete: "off", required: true });
    var desc = h("textarea", { id: p + "-desc", rows: "3", maxlength: "1000" });
    desc.addEventListener("input", function () { setError(desc, ""); });

    var more = h("div", { class: "pt-more", id: p + "-repeat-more", hidden: true });
    var recurrence = select(p + "-recurrence", RECURRENCE);
    var endsOn = input(p + "-endson", "date", { min: today, max: addDays(today, MAX_SERIES_END_DAYS) });

    var schedule = radios(p + "-sched", p + "-schedule", "How often does it happen?",
      [["one_off", "Once"], ["recurring", "It repeats"]], function () {
        var rec = card.querySelector('input[name="' + p + '-sched"]:checked').value === "recurring";
        more.hidden = !rec;
        dateLabel.textContent = rec ? "First date" : "Date";
        if (!rec) { setError(endsOn, ""); }
      });
    var date = input(p + "-date", "date", { min: today, max: addDays(today, MAX_FIRST_DATE_DAYS), required: true });
    var dateField = field(p + "-date", "Date", date);
    var dateLabel = dateField.querySelector("label");
    var start = input(p + "-start", "time", { required: true });
    var end = input(p + "-end", "time");

    more.appendChild(field(p + "-recurrence", "How often", recurrence));
    more.appendChild(field(p + "-endson", "Stop repeating on", endsOn, { optional: true, hint: "Leave this empty if it carries on with no end date." }));

    var priceBox = h("div", { class: "pt-more", id: p + "-price-more", hidden: true });
    var price = input(p + "-price", "text", { inputmode: "decimal", autocomplete: "off", maxlength: "9" });
    priceBox.appendChild(field(p + "-price", "Price per ticket", h("div", { class: "pt-money" }, [h("span", { "aria-hidden": "true", text: "£" }), price]),
      { hint: "Between £1.00 and £1,000.00." }));
    var pricing = radios(p + "-pricing", p + "-pricetype", "Is it free?",
      [["free", "Free, people just RSVP"], ["ticketed", "Paid tickets"]], function () {
        var paid = card.querySelector('input[name="' + p + '-pricing"]:checked').value === "ticketed";
        priceBox.hidden = !paid;
        if (!paid) setError(price, "");
      });

    var cap = input(p + "-cap", "number", { min: "1", max: "100000", step: "1", inputmode: "numeric" });
    var url = input(p + "-url", "text", { maxlength: "300", autocomplete: "off", spellcheck: "false", placeholder: "https://" });

    var remove = h("button", { type: "button", class: "btn btn-ghost br-small", onclick: function () {
      card.remove(); renumber(); $("pt-add").focus();
    } }, ["Remove this event"]);
    remove.setAttribute("data-remove", "");

    var card = h("fieldset", { class: "pt-event", "data-event": String(n) }, [
      h("legend", { text: "Event" }),
      h("div", { class: "pt-event-bar" }, [remove]),
      field(p + "-title", "What is it called?", title),
      field(p + "-cat", "What kind of event is it?", cat),
      field(p + "-area", "Where is it?", area, { hint: "The area or venue name, for example Victoria Park, Hackney." }),
      field(p + "-desc", "What happens?", desc, { optional: true, hint: "A sentence or two for someone deciding whether to come." }),
      schedule,
      dateField,
      h("div", { class: "pt-times" }, [
        field(p + "-start", "Starts at", start),
        field(p + "-end", "Ends at", end, { optional: true })
      ]),
      more,
      pricing,
      priceBox,
      field(p + "-cap", "Most people you can take", cap, { optional: true, hint: "Leave this empty if there is no limit." }),
      field(p + "-url", "Where do people book now?", url, { optional: true, hint: "A link to your current page or ticket link, if you have one. Start it with https://" })
    ]);
    card._f = { title: title, cat: cat, area: area, desc: desc, recurrence: recurrence, endsOn: endsOn, date: date, start: start, end: end, price: price, cap: cap, url: url, p: p };
    list.appendChild(card);
    renumber();
    if (focus) title.focus();
  }

  function renumber() {
    var cards = $("pt-events").children, n = cards.length;
    Array.prototype.forEach.call(cards, function (card, i) {
      card.querySelector("legend").textContent = n > 1 ? "Event " + (i + 1) : "Your event";
      card.querySelector("[data-remove]").hidden = n < 2;
    });
    var full = n >= MAX_EVENTS;
    $("pt-add").hidden = full;
    $("pt-add-note").textContent = full ? "That is the most we take in one application. Send another one for the rest." : "";
  }

  // ===== Reading and checking =====
  function value(el) { return String(el.value || "").trim(); }

  function readYou() {
    return {
      organiserName: value($("y-name")), organisationName: value($("y-org")), email: value($("y-email")),
      phone: value($("y-phone")), city: value($("y-city")), website: value($("y-site"))
    };
  }

  function checkYou() {
    var bad = null;
    function fail(el, msg) { setError(el, msg); if (!bad) bad = el; }
    clearErrorsOn($("pt-app").querySelector('[data-step="you"]'));
    var y = readYou();
    if (!y.organiserName) fail($("y-name"), "Enter your name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(y.email)) fail($("y-email"), "Enter an email address like name@example.com.");
    if (y.phone && !/^[0-9+()\-. ]{6,40}$/.test(y.phone)) fail($("y-phone"), "Use digits, spaces and + only, for example +44 7700 900123.");
    if (!y.city) fail($("y-city"), "Enter the town or city your events are in.");
    if (bad) { bad.focus(); return null; }
    return y;
  }

  function readEvent(card) {
    var f = card._f, p = f.p;
    var schedule = card.querySelector('input[name="' + p + '-sched"]:checked').value;
    var priceType = card.querySelector('input[name="' + p + '-pricing"]:checked').value;
    var e = {
      title: value(f.title), category: f.cat.value, area: value(f.area), description: value(f.desc),
      schedule: schedule, firstDate: f.date.value, startTime: f.start.value, endTime: f.end.value,
      priceType: priceType
    };
    if (schedule === "recurring") { e.recurrence = f.recurrence.value; if (f.endsOn.value) e.endsOn = f.endsOn.value; }
    if (priceType === "ticketed") e.pricePence = penceFrom(f.price.value);
    if (value(f.cap)) e.capacity = Number(value(f.cap));
    if (value(f.url)) e.existingListingUrl = value(f.url);
    return e;
  }

  function checkEvents() {
    var today = londonToday(), bad = null, events = [];
    function fail(el, msg) { setError(el, msg); if (!bad) bad = el; }
    Array.prototype.forEach.call($("pt-events").children, function (card) {
      var f = card._f, e = readEvent(card);
      clearErrorsOn(card);
      if (!e.title) fail(f.title, "Give the event a name.");
      if (!e.category) fail(f.cat, "Choose the kind of event.");
      if (!e.area) fail(f.area, "Say where it happens.");
      if (!isRealDate(e.firstDate)) fail(f.date, "Choose a date.");
      else if (e.firstDate < today) fail(f.date, "Choose today or a later date.");
      else if (e.firstDate > addDays(today, MAX_FIRST_DATE_DAYS)) fail(f.date, "Choose a date within the next 18 months.");
      if (!e.startTime) fail(f.start, "Choose a start time.");
      if (e.schedule === "recurring" && e.endsOn) {
        if (isRealDate(e.firstDate) && e.endsOn < e.firstDate) fail(f.endsOn, "Choose a date after the first one, or leave it empty.");
        else if (e.endsOn > addDays(today, MAX_SERIES_END_DAYS)) fail(f.endsOn, "Choose a date within the next two years, or leave it empty.");
      }
      if (e.priceType === "ticketed" && e.pricePence === null) fail(f.price, "Enter a price between £1.00 and £1,000.00, for example 8.50.");
      if (e.capacity !== undefined && !(Math.floor(e.capacity) === e.capacity && e.capacity >= 1 && e.capacity <= 100000)) fail(f.cap, "Enter a whole number, or leave it empty.");
      if (e.existingListingUrl && !/^https?:\/\/\S+$/i.test(e.existingListingUrl)) fail(f.url, "Start the link with https://");
      // Empty optional values are left out of the request.
      if (!e.description) delete e.description;
      if (!e.endTime) delete e.endTime;
      events.push(e);
    });
    if (bad) { bad.focus(); return null; }
    return events;
  }

  // ===== Steps =====
  function show(step, quiet) {
    state.step = step;
    Array.prototype.forEach.call($("pt-app").querySelectorAll(".pt-step"), function (s) { s.hidden = s.getAttribute("data-step") !== step; });
    var i = STEPS.indexOf(step), done = step === "done";
    $("pt-bar").parentNode.hidden = done;
    $("pt-progress").hidden = done;
    if (!done) {
      $("pt-bar").style.width = Math.round(((i + 1) / STEPS.length) * 100) + "%";
      $("pt-progress").textContent = "Step " + (i + 1) + " of " + STEPS.length;
    }
    alertMsg("");
    if (quiet) return;
    var heading = $("pt-app").querySelector('[data-step="' + step + '"] .wl-step-title');
    if (heading) { heading.focus(); announce(heading.textContent + (done ? "" : ". Step " + (i + 1) + " of " + STEPS.length)); }
    window.scrollTo(0, 0);
  }

  function row(dl, term, text) { dl.appendChild(h("dt", { text: term })); dl.appendChild(h("dd", { text: text })); }

  function renderSummary() {
    var box = $("pt-summary"), y = readYou();
    box.textContent = "";
    box.appendChild(h("h3", { text: "You" }));
    var dl = h("dl");
    row(dl, "Name", y.organiserName);
    if (y.organisationName) row(dl, "Group or business", y.organisationName);
    row(dl, "Email", y.email);
    if (y.phone) row(dl, "Phone", y.phone);
    row(dl, "Based in", y.city);
    if (y.website) row(dl, "Website or Instagram", y.website);
    box.appendChild(dl);
    box.appendChild(h("button", { type: "button", class: "btn btn-ghost br-small pt-edit", onclick: function () { show("you"); } }, ["Change your details"]));

    var cats = {}; CATEGORIES.forEach(function (c) { cats[c[0]] = c[1]; });
    var recs = {}; RECURRENCE.forEach(function (c) { recs[c[0]] = c[1]; });
    var events = state.events || [];
    events.forEach(function (e, i) {
      box.appendChild(h("h3", { text: (events.length > 1 ? "Event " + (i + 1) + ": " : "") + e.title }));
      var d = h("dl");
      row(d, "Kind", cats[e.category]);
      row(d, "Where", e.area);
      if (e.description) row(d, "What happens", e.description);
      var when = e.schedule === "recurring"
        ? recs[e.recurrence] + " from " + niceDate(e.firstDate) + (e.endsOn ? " until " + niceDate(e.endsOn) : ", no end date")
        : niceDate(e.firstDate);
      row(d, "When", when);
      row(d, "Time", e.startTime + (e.endTime ? " to " + e.endTime : ""));
      row(d, "Price", e.priceType === "ticketed" ? pounds(e.pricePence) + " per ticket" : "Free, people RSVP");
      if (e.capacity) row(d, "Most people", String(e.capacity));
      if (e.existingListingUrl) row(d, "Current page", e.existingListingUrl);
      box.appendChild(d);
    });
    box.appendChild(h("button", { type: "button", class: "btn btn-ghost br-small pt-edit", onclick: function () { show("events"); } }, ["Change your events"]));
  }

  // ===== Sending =====
  var FAILURES = {
    400: "Something in the form was not accepted. Go back and check the dates are today or later and that each price is at least £1.00.",
    429: "There have been a lot of applications from this connection. Wait an hour and try again, or email hello@wegogym.club.",
    other: "That did not go through and nothing was sent. Check your connection and press Send application again."
  };

  async function send(e) {
    e.preventDefault();
    if (state.sending) return;
    var over = $("r-over18"), terms = $("r-terms"), err = $("r-error");
    err.hidden = true;
    if (!over.checked || !terms.checked) {
      err.textContent = "Tick both boxes to send your application.";
      err.hidden = false;
      (over.checked ? terms : over).focus();
      return;
    }
    state.sending = true;
    var btn = $("pt-send");
    btn.disabled = true; btn.textContent = "Sending…";
    alertMsg("");
    var y = readYou();
    var body = {
      organiserName: y.organiserName, email: y.email, city: y.city,
      confirmOver18: true, agreeTerms: true, events: state.events, hp: value($("y-hp"))
    };
    if (y.organisationName) body.organisationName = y.organisationName;
    if (y.phone) body.phone = y.phone;
    if (y.website) body.website = y.website;
    var res = null;
    try {
      res = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch (x) { res = null; }
    state.sending = false;
    btn.disabled = false; btn.textContent = "Send application";
    if (res && res.ok) {
      state.sent = true;
      $("done-email").textContent = y.email;
      show("done");
      return;
    }
    alertMsg(FAILURES[res ? res.status : "other"] || FAILURES.other);
    $("pt-alert").scrollIntoView({ block: "center" });
  }

  // ===== Wiring =====
  function start() {
    $("pt-app").hidden = false;
    addEvent(false);
    show("you", true);

    $("pt-app").querySelector('[data-step="you"]').addEventListener("submit", function (e) {
      e.preventDefault();
      if (checkYou()) show("events");
    });
    $("pt-app").querySelector('[data-step="events"]').addEventListener("submit", function (e) {
      e.preventDefault();
      var events = checkEvents();
      if (!events) { alertMsg("Some answers need fixing. They are marked below."); return; }
      state.events = events;
      renderSummary();
      show("review");
    });
    $("pt-app").querySelector('[data-step="review"]').addEventListener("submit", send);
    Array.prototype.forEach.call($("pt-app").querySelectorAll("[data-back]"), function (b) {
      b.addEventListener("click", function () { show(STEPS[Math.max(0, STEPS.indexOf(state.step) - 1)]); });
    });
    $("pt-add").addEventListener("click", function () { addEvent(true); });
    // Nothing is saved in the browser, so warn before leaving a half-filled form.
    window.addEventListener("beforeunload", function (e) {
      if (!state.sent && (value($("y-name")) || value($("y-email")))) e.preventDefault();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
