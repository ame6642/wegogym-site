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
 * After sending, the reply carries an application id and a random token. The page keeps them
 * in sessionStorage (this tab only) and uses them with the partnership-connect function:
 * every organiser does a photo ID check on Stripe Identity (back to ?a=<id>&stripe=identity),
 * then an organiser with paid events sets up payouts on Stripe Connect (back to
 * ?a=<id>&stripe=return, or =refresh when Stripe's link expired). Same tab throughout.
 *
 * The rules below mirror supabase/functions/partnerships/handler.ts. The function is the one
 * that enforces them; these checks only save the visitor a round trip.
 */
(function () {
  "use strict";

  // ===== EDIT: settings =====
  var ENDPOINT = "https://yxgwywppajvxfmmjudaq.supabase.co/functions/v1/partnerships";
  var CONNECT_ENDPOINT = "https://yxgwywppajvxfmmjudaq.supabase.co/functions/v1/partnership-connect";
  var CONNECT_KEY = "wgg-pt-connect";

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
  // ISO day numbers (1 Monday to 7 Sunday), as the server stores them.
  var DAYS = [[1, "Mon", "Monday"], [2, "Tue", "Tuesday"], [3, "Wed", "Wednesday"], [4, "Thu", "Thursday"],
    [5, "Fri", "Friday"], [6, "Sat", "Saturday"], [7, "Sun", "Sunday"]];
  var STEPS = ["you", "events", "review"];
  // [ISO 3166-1 alpha-2, name]: the same list as business registration.
  var COUNTRIES = [["AF","Afghanistan"], ["AL","Albania"], ["DZ","Algeria"], ["AS","American Samoa"], ["AD","Andorra"], ["AO","Angola"], ["AI","Anguilla"], ["AG","Antigua and Barbuda"], ["AR","Argentina"], ["AM","Armenia"], ["AW","Aruba"], ["AU","Australia"], ["AT","Austria"], ["AZ","Azerbaijan"], ["BS","Bahamas"], ["BH","Bahrain"], ["BD","Bangladesh"], ["BB","Barbados"], ["BY","Belarus"], ["BE","Belgium"], ["BZ","Belize"], ["BJ","Benin"], ["BM","Bermuda"], ["BT","Bhutan"], ["BO","Bolivia"], ["BA","Bosnia and Herzegovina"], ["BW","Botswana"], ["BR","Brazil"], ["VG","British Virgin Islands"], ["BN","Brunei"], ["BG","Bulgaria"], ["BF","Burkina Faso"], ["BI","Burundi"], ["KH","Cambodia"], ["CM","Cameroon"], ["CA","Canada"], ["CV","Cape Verde"], ["BQ","Caribbean Netherlands"], ["KY","Cayman Islands"], ["CF","Central African Republic"], ["TD","Chad"], ["CL","Chile"], ["CN","China"], ["CX","Christmas Island"], ["CC","Cocos (Keeling) Islands"], ["CO","Colombia"], ["KM","Comoros"], ["CK","Cook Islands"], ["CR","Costa Rica"], ["HR","Croatia"], ["CU","Cuba"], ["CW","Curaçao"], ["CY","Cyprus"], ["CZ","Czechia"], ["CI","Côte d’Ivoire"], ["CD","Democratic Republic of the Congo"], ["DK","Denmark"], ["DJ","Djibouti"], ["DM","Dominica"], ["DO","Dominican Republic"], ["EC","Ecuador"], ["EG","Egypt"], ["SV","El Salvador"], ["GQ","Equatorial Guinea"], ["ER","Eritrea"], ["EE","Estonia"], ["SZ","Eswatini"], ["ET","Ethiopia"], ["FK","Falkland Islands"], ["FO","Faroe Islands"], ["FJ","Fiji"], ["FI","Finland"], ["FR","France"], ["GF","French Guiana"], ["PF","French Polynesia"], ["GA","Gabon"], ["GM","Gambia"], ["GE","Georgia"], ["DE","Germany"], ["GH","Ghana"], ["GI","Gibraltar"], ["GR","Greece"], ["GL","Greenland"], ["GD","Grenada"], ["GP","Guadeloupe"], ["GU","Guam"], ["GT","Guatemala"], ["GG","Guernsey"], ["GN","Guinea"], ["GW","Guinea-Bissau"], ["GY","Guyana"], ["HT","Haiti"], ["HN","Honduras"], ["HK","Hong Kong"], ["HU","Hungary"], ["IS","Iceland"], ["IN","India"], ["ID","Indonesia"], ["IR","Iran"], ["IQ","Iraq"], ["IE","Ireland"], ["IM","Isle of Man"], ["IT","Italy"], ["JM","Jamaica"], ["JP","Japan"], ["JE","Jersey"], ["JO","Jordan"], ["KZ","Kazakhstan"], ["KE","Kenya"], ["KI","Kiribati"], ["XK","Kosovo"], ["KW","Kuwait"], ["KG","Kyrgyzstan"], ["LA","Laos"], ["LV","Latvia"], ["LB","Lebanon"], ["LS","Lesotho"], ["LR","Liberia"], ["LY","Libya"], ["LI","Liechtenstein"], ["LT","Lithuania"], ["LU","Luxembourg"], ["MO","Macao"], ["MG","Madagascar"], ["MW","Malawi"], ["MY","Malaysia"], ["MV","Maldives"], ["ML","Mali"], ["MT","Malta"], ["MH","Marshall Islands"], ["MQ","Martinique"], ["MR","Mauritania"], ["MU","Mauritius"], ["YT","Mayotte"], ["MX","Mexico"], ["FM","Micronesia"], ["MD","Moldova"], ["MC","Monaco"], ["MN","Mongolia"], ["ME","Montenegro"], ["MS","Montserrat"], ["MA","Morocco"], ["MZ","Mozambique"], ["MM","Myanmar"], ["NA","Namibia"], ["NR","Nauru"], ["NP","Nepal"], ["NL","Netherlands"], ["NC","New Caledonia"], ["NZ","New Zealand"], ["NI","Nicaragua"], ["NE","Niger"], ["NG","Nigeria"], ["NU","Niue"], ["NF","Norfolk Island"], ["KP","North Korea"], ["MK","North Macedonia"], ["MP","Northern Mariana Islands"], ["NO","Norway"], ["OM","Oman"], ["PK","Pakistan"], ["PW","Palau"], ["PS","Palestine"], ["PA","Panama"], ["PG","Papua New Guinea"], ["PY","Paraguay"], ["PE","Peru"], ["PH","Philippines"], ["PN","Pitcairn Islands"], ["PL","Poland"], ["PT","Portugal"], ["PR","Puerto Rico"], ["QA","Qatar"], ["CG","Republic of the Congo"], ["RO","Romania"], ["RU","Russia"], ["RW","Rwanda"], ["RE","Réunion"], ["WS","Samoa"], ["SM","San Marino"], ["SA","Saudi Arabia"], ["SN","Senegal"], ["RS","Serbia"], ["SC","Seychelles"], ["SL","Sierra Leone"], ["SG","Singapore"], ["SX","Sint Maarten"], ["SK","Slovakia"], ["SI","Slovenia"], ["SB","Solomon Islands"], ["SO","Somalia"], ["ZA","South Africa"], ["KR","South Korea"], ["SS","South Sudan"], ["ES","Spain"], ["LK","Sri Lanka"], ["BL","St Barthélemy"], ["SH","St Helena"], ["KN","St Kitts and Nevis"], ["LC","St Lucia"], ["MF","St Martin"], ["PM","St Pierre and Miquelon"], ["VC","St Vincent and the Grenadines"], ["SD","Sudan"], ["SR","Suriname"], ["SJ","Svalbard and Jan Mayen"], ["SE","Sweden"], ["CH","Switzerland"], ["SY","Syria"], ["ST","São Tomé and Príncipe"], ["TW","Taiwan"], ["TJ","Tajikistan"], ["TZ","Tanzania"], ["TH","Thailand"], ["TL","Timor-Leste"], ["TG","Togo"], ["TK","Tokelau"], ["TO","Tonga"], ["TT","Trinidad and Tobago"], ["TN","Tunisia"], ["TM","Turkmenistan"], ["TC","Turks and Caicos Islands"], ["TV","Tuvalu"], ["TR","Türkiye"], ["VI","US Virgin Islands"], ["UG","Uganda"], ["UA","Ukraine"], ["AE","United Arab Emirates"], ["GB","United Kingdom"], ["US","United States"], ["UY","Uruguay"], ["UZ","Uzbekistan"], ["VU","Vanuatu"], ["VA","Vatican City"], ["VE","Venezuela"], ["VN","Vietnam"], ["WF","Wallis and Futuna"], ["EH","Western Sahara"], ["YE","Yemen"], ["ZM","Zambia"], ["ZW","Zimbabwe"], ["AX","Åland Islands"]];

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
  function isoWeekday(iso) { return new Date(iso + "T12:00:00Z").getUTCDay() || 7; }
  function dayList(nums) {
    var names = nums.map(function (n) { return DAYS[n - 1][1]; });
    return names.length > 1 ? names.slice(0, -1).join(", ") + " and " + names[names.length - 1] : names[0];
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

    // Which days it runs, for every week or every two weeks (a monthly event repeats on its date).
    var autoDay = null; // the box the first date ticked, so a changed date can untick it again
    var dayChips = h("div", { class: "chips" });
    var dayBoxes = DAYS.map(function (d) {
      var did = p + "-day-" + d[0];
      var box = h("input", { type: "checkbox", id: did, value: String(d[0]), "aria-label": d[2] });
      box.addEventListener("change", function () {
        if (box === autoDay) autoDay = null; // the organiser has made this day their own choice
        setError(dayBoxes[0], ""); setError(date, "");
      });
      dayChips.appendChild(h("label", { class: "chip", for: did }, [box, h("span", { text: d[1] })]));
      return box;
    });
    var daysBox = h("fieldset", { class: "pt-choice", id: p + "-days" }, [
      h("legend", { text: "On which days?" }), dayChips,
      h("p", { class: "wl-hint", text: "Tick every day it runs. If one day starts at a different time, add that day as a separate event." })
    ]);
    recurrence.addEventListener("change", function () {
      daysBox.hidden = recurrence.value === "monthly";
      if (daysBox.hidden) setError(dayBoxes[0], "");
    });

    var schedule = radios(p + "-sched", p + "-schedule", "How often does it happen?",
      [["one_off", "Once"], ["recurring", "It repeats"]], function () {
        var rec = card.querySelector('input[name="' + p + '-sched"]:checked').value === "recurring";
        more.hidden = !rec;
        dateLabel.textContent = rec ? "First date" : "Date";
        if (!rec) { setError(endsOn, ""); }
      });
    var date = input(p + "-date", "date", { min: today, max: addDays(today, MAX_FIRST_DATE_DAYS), required: true });
    // Picking the first date ticks its day, so the usual case needs no extra step. Changing the
    // date unticks the day it ticked before, unless the organiser has touched that day.
    date.addEventListener("change", function () {
      if (autoDay) { autoDay.checked = false; autoDay = null; }
      if (!isRealDate(date.value)) return;
      var box = dayBoxes[isoWeekday(date.value) - 1];
      if (!box.checked) { box.checked = true; autoDay = box; }
      setError(dayBoxes[0], "");
    });
    var dateField = field(p + "-date", "Date", date);
    var dateLabel = dateField.querySelector("label");
    var start = input(p + "-start", "time", { required: true });
    var end = input(p + "-end", "time");

    more.appendChild(field(p + "-recurrence", "How often", recurrence));
    more.appendChild(daysBox);
    more.appendChild(field(p + "-endson", "Stop repeating on", endsOn, { optional: true, hint: "Leave this empty if it carries on with no end date." }));

    var priceBox = h("div", { class: "pt-more", id: p + "-price-more", hidden: true });
    var price = input(p + "-price", "text", { inputmode: "decimal", autocomplete: "off", maxlength: "9" });
    priceBox.appendChild(field(p + "-price", "Price per ticket", h("div", { class: "pt-money" }, [h("span", { "aria-hidden": "true", text: "£" }), price]),
      { hint: "Between £1.00 and £1,000.00." }));
    priceBox.appendChild(h("p", { class: "pt-tip", text: "Tip: charge less for your quieter dates and times. Similar events on WeGoGym are running discounts on their off-peak, less busy sessions to fill spaces. If one day is usually quieter, add it as a separate event with a lower price." }));
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
    card._f = { title: title, cat: cat, area: area, desc: desc, recurrence: recurrence, days: dayBoxes, endsOn: endsOn, date: date, start: start, end: end, price: price, cap: cap, url: url, p: p };
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
      phone: value($("y-phone")), city: value($("y-city")), country: value($("y-country")), website: value($("y-site"))
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
    if (!/^[A-Z]{2}$/.test(y.country)) fail($("y-country"), "Choose your country.");
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
    if (schedule === "recurring") {
      e.recurrence = f.recurrence.value;
      if (e.recurrence !== "monthly") {
        e.weekdays = f.days.filter(function (b) { return b.checked; }).map(function (b) { return Number(b.value); });
      }
      if (f.endsOn.value) e.endsOn = f.endsOn.value;
    }
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
      if (e.weekdays) {
        if (!e.weekdays.length) fail(f.days[0], "Tick at least one day.");
        else if (isRealDate(e.firstDate) && e.weekdays.indexOf(isoWeekday(e.firstDate)) < 0) {
          var dn = DAYS[isoWeekday(e.firstDate) - 1][2];
          fail(f.date, "This date is a " + dn + ". Tick " + dn + " too, or choose a first date on one of the days you ticked.");
        }
      }
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
    var i = STEPS.indexOf(step), done = i < 0;
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
    row(dl, "Based in", y.city + ", " + countryName(y.country));
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
        ? recs[e.recurrence] + (e.weekdays ? " on " + dayList(e.weekdays) : "") + " from " + niceDate(e.firstDate) + (e.endsOn ? " until " + niceDate(e.endsOn) : ", no end date")
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
      organiserName: y.organiserName, email: y.email, city: y.city, country: y.country,
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
      var reply = null;
      try { reply = await res.json(); } catch (x) { reply = null; }
      if (reply && reply.applicationId && reply.connectToken) {
        saveConnect({ a: reply.applicationId, t: reply.connectToken, email: y.email, pay: !!reply.needsPayouts });
        // Keep the application in the address so a reload or Back resumes here, not a blank form.
        history.replaceState(null, "", location.pathname + "?a=" + encodeURIComponent(reply.applicationId));
        show("identity");
        return;
      }
      show("done");
      return;
    }
    alertMsg(FAILURES[res ? res.status : "other"] || FAILURES.other);
    $("pt-alert").scrollIntoView({ block: "center" });
  }

  // ===== Get paid (Stripe Connect, paid events only) =====
  function countryName(code) {
    var c = COUNTRIES.filter(function (x) { return x[0] === code; })[0];
    return c ? c[1] : code;
  }
  function saveConnect(c) {
    state.connect = c;
    try { sessionStorage.setItem(CONNECT_KEY, JSON.stringify(c)); } catch (x) { /* private mode: this page view only */ }
  }
  function loadConnect(appId) {
    var c = null;
    try { c = JSON.parse(sessionStorage.getItem(CONNECT_KEY) || "null"); } catch (x) { c = null; }
    return c && c.a === appId ? c : null;
  }

  // ----- ID check -----
  var ID_COPY = {
    identity_unavailable: "ID checks are not open yet. Your application is sent, and we will email you when you can do this.",
    already_verified: "You have already confirmed your identity.",
    under_18: "You need to be 18 or over to run events on WeGoGym.",
    too_many_attempts: "You have used all your tries at the ID check. Email hello@wegogym.club and we will help.",
    rate_limited: "Too many tries in a short time. Wait an hour and try again, or email hello@wegogym.club.",
    forbidden: "This page can no longer continue for that application. Email hello@wegogym.club and we will help you finish.",
    other: "We could not reach Stripe. Check your connection and try again."
  };

  function afterIdentity() {
    if (state.connect && state.connect.pay) show("stripe"); else finishPay();
  }

  async function renderIdStatus() {
    var status = $("id-status"), go = $("id-go"), again = $("id-recheck"), next = $("id-next");
    go.hidden = true; again.hidden = true; next.hidden = true;
    status.textContent = "Checking with Stripe…";
    var r;
    try { r = await connectCall("identity_status"); }
    catch (err) { status.textContent = ""; go.hidden = false; alertMsg(ID_COPY[err.code] || ID_COPY.other); return; }
    state.idDone = r.identity === "verified";
    if (r.identity === "verified") {
      status.textContent = "Done. Your identity is confirmed.";
      next.hidden = false; $("id-later").hidden = true;
    } else if (r.identity === "processing") {
      status.textContent = "Stripe is checking your ID. This usually takes a minute or two.";
      again.hidden = false;
    } else if (r.identity === "under_18") {
      status.textContent = "You need to be 18 or over to run events on WeGoGym.";
      $("id-later").hidden = true;
    } else if (r.identity === "too_many") {
      status.textContent = "Stripe could not confirm your ID, and you have used all your tries. Email hello@wegogym.club and we will help.";
    } else if (r.identity === "retry") {
      status.textContent = "Stripe could not confirm your ID. Make sure the photo is clear and the document is in date, then try again.";
      go.hidden = false; go.textContent = "Try again";
    } else {
      status.textContent = r.identity === "pending" ? "You have not finished the ID check yet." : "";
      go.hidden = false;
    }
    if (status.textContent) announce(status.textContent);
  }

  async function goToIdentity() {
    var go = $("id-go");
    if (go.disabled) return;
    var label = go.textContent;
    go.disabled = true; go.textContent = "Opening Stripe…";
    alertMsg("");
    try {
      var r = await connectCall("identity");
      if (!r || !/^https:\/\/verify\.stripe\.com\//.test(r.url || "")) throw { code: "other" };
      $("id-status").textContent = "Taking you to Stripe…";
      window.location.assign(r.url);
    } catch (err) {
      go.disabled = false; go.textContent = label;
      if (err.code === "already_verified" || err.code === "identity_in_progress") { renderIdStatus(); return; }
      alertMsg(ID_COPY[err.code] || ID_COPY.other);
    }
  }

  // ----- Payouts -----
  var PAY_COPY = {
    country_not_supported: "Stripe cannot pay out to organisers in your country through WeGoGym yet. Your application is still sent, and we will email you when it can.",
    onboarding_in_progress: "Your Stripe account is still being set up. Wait a few seconds and try again.",
    rate_limited: "Too many tries in a short time. Wait an hour and try again, or email hello@wegogym.club.",
    forbidden: "This page can no longer connect Stripe for that application. Email hello@wegogym.club and we will send you a way to finish.",
    identity_required: "Confirm your identity first, then set up payments.",
    no_paid_events: "Your application has no paid events, so there is nothing to set up.",
    other: "We could not reach Stripe. Check your connection and try again."
  };

  async function connectCall(action) {
    var c = state.connect;
    var res;
    try {
      res = await fetch(CONNECT_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: action, application_id: c.a, token: c.t }) });
    } catch (x) { throw { code: "other" }; }
    var data = null;
    try { data = await res.json(); } catch (x) { data = null; }
    if (!res.ok) throw { code: (data && data.error) || "other" };
    return data;
  }

  async function renderPayStatus(back) {
    var status = $("pay-status"), go = $("pay-go"), next = $("pay-next");
    go.hidden = false; next.hidden = true; go.textContent = "Continue to Stripe";
    status.textContent = "Checking with Stripe…";
    var r;
    try { r = await connectCall("status"); }
    catch (err) { status.textContent = ""; alertMsg(PAY_COPY[err.code] || PAY_COPY.other); return; }
    if (r.details_submitted) {
      status.textContent = r.charges_enabled
        ? "Your Stripe account is connected and ready to receive ticket money."
        : "Your details are with Stripe. They are usually checked within minutes, sometimes a few days.";
      next.hidden = false;
      go.hidden = !r.needs_more_info;
      go.textContent = "Add the details Stripe asked for";
      $("pay-later").hidden = true;
      announce(status.textContent);
    } else if (r.started) {
      status.textContent = back === "refresh"
        ? "That Stripe page expired. Continue to pick up where you left off."
        : "You have not finished with Stripe yet. Continue to pick up where you left off.";
    } else {
      status.textContent = "";
    }
    state.payDone = !!r.details_submitted;
  }

  async function goToStripe() {
    var go = $("pay-go");
    if (go.disabled) return;
    go.disabled = true; go.textContent = "Opening Stripe…";
    alertMsg("");
    try {
      var r = await connectCall("link");
      if (!r || !/^https:\/\/connect\.stripe\.com\//.test(r.url || "")) throw { code: "other" };
      $("pay-status").textContent = "Taking you to Stripe…";
      window.location.assign(r.url);
    } catch (err) {
      go.disabled = false; go.textContent = "Continue to Stripe";
      alertMsg(PAY_COPY[err.code] || PAY_COPY.other);
    }
  }

  function finishPay() {
    var c = state.connect || {};
    $("done-email").textContent = c.email || "you";
    var lines = [];
    if (state.idDone) lines.push("Your identity is confirmed.");
    if (state.payDone) lines.push("Stripe is connected, so you can be paid for tickets once your events are live.");
    $("done-pay").textContent = lines.join(" ");
    $("done-pay").hidden = !lines.length;
    show("done");
  }

  // Back from Stripe: /partnerships/?a=<application id>&stripe=identity|return|refresh.
  // Just ?a=<id> (no stripe) is a reload after sending: resume at the ID check.
  function readStripeBack() {
    var p = new URLSearchParams(location.search);
    var back = p.get("stripe") || "identity", appId = p.get("a");
    if ((back !== "return" && back !== "refresh" && back !== "identity") || !appId) return false;
    history.replaceState(null, "", location.pathname + "?a=" + encodeURIComponent(appId));
    state.sent = true;
    var c = loadConnect(appId);
    if (!c) {
      var step = back === "identity" ? "identity" : "stripe";
      show(step, true);
      ["id-go", "id-later", "pay-go", "pay-later"].forEach(function (id) { $(id).hidden = true; });
      $(step === "identity" ? "id-status" : "pay-status").textContent = "Your application is sent. To finish, open the link from the same browser tab you applied in, or email hello@wegogym.club and we will help.";
      return true;
    }
    state.connect = c;
    if (back === "identity") { show("identity"); renderIdStatus(); return true; }
    show("stripe");
    renderPayStatus(back);
    // Payouts come after a passed ID check: remember that for the closing page.
    connectCall("identity_status").then(function (r) { state.idDone = r.identity === "verified"; }, function () {});
    return true;
  }

  // ===== Wiring =====
  function start() {
    $("pt-app").hidden = false;
    var sel = $("y-country");
    sel.appendChild(h("option", { value: "", text: "Choose a country…" }));
    COUNTRIES.slice().sort(function (a, b) { return a[1].localeCompare(b[1], "en-GB"); })
      .forEach(function (c) { sel.appendChild(h("option", { value: c[0], text: c[1] })); });
    sel.value = "GB";
    sel.addEventListener("change", function () { setError(sel, ""); });
    addEvent(false);
    $("id-go").addEventListener("click", goToIdentity);
    $("id-recheck").addEventListener("click", renderIdStatus);
    $("id-next").addEventListener("click", afterIdentity);
    $("pay-go").addEventListener("click", goToStripe);
    $("pay-next").addEventListener("click", finishPay);
    // Back from Stripe with the browser's Back button: load fresh so the button is not stuck.
    window.addEventListener("pageshow", function (e) { if (e.persisted) location.reload(); });
    if (readStripeBack()) return;
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
