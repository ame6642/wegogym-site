// WeGoGym events: next dates in London time, soonest-first sorting, the day / type / area / who-runs-it / host filters,
// the scrolling rows on the home page, the filtered all-events page, Add to calendar and Share. Without JavaScript every page still reads correctly.
(function () {
  "use strict";
  function londonNow() {
    var p = {};
    try {
      new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" })
        .formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
      return new Date(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    } catch (e) { return new Date(); }
  }
  var now = londonNow();
  var today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  function hm(s) { return s.split(":").map(Number); }
  // Every session in the next 8 days that has not finished yet, soonest first.
  function occurrences(rules) {
    var out = [];
    rules.forEach(function (r) {
      var a = hm(r.time), b = r.end ? hm(r.end) : [a[0] + 1, a[1]];
      for (var i = 0; i < 8; i++) {
        var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, a[0], a[1]);
        var end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, b[0], b[1]);
        if (d.getDay() === r.weekday && end >= now) out.push(d);
      }
    });
    return out.sort(function (x, y) { return x - y; });
  }
  function dayDiff(d) { return Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - today0) / 864e5); }
  function dayLabel(d) {
    var n = dayDiff(d);
    if (n === 0) return "Today";
    if (n === 1) return "Tomorrow";
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  }
  function timeLabel(d) {
    var h = d.getHours(), m = d.getMinutes();
    return (h % 12 || 12) + (m ? ":" + String(m).padStart(2, "0") : "") + (h < 12 ? "am" : "pm");
  }
  function rulesOf(el) { try { return JSON.parse(el.getAttribute("data-rules")); } catch (e) { return []; } }

  // Cards
  document.querySelectorAll(".ev-card[data-rules]").forEach(function (card) {
    var occ = occurrences(rulesOf(card));
    card._occ = occ;
    if (!occ.length) return;
    var d = occ[0];
    card.setAttribute("data-next", d.getTime());
    var short = card.querySelector(".ev-next-short");
    if (short) short.textContent = dayLabel(d) + ", " + timeLabel(d);
    var badge = card.querySelector(".ev-next-badge");
    if (badge && dayDiff(d) <= 1) { badge.textContent = dayLabel(d); badge.hidden = false; }
  });

  // Event page: date box, sticky bar
  var next = document.querySelector(".ev-next");
  if (next) {
    var occ = occurrences(rulesOf(next));
    if (occ.length) {
      var d = occ[0];
      var repeat = document.querySelector(".ev-repeat");
      var schedule = next.textContent;
      next.textContent = (dayDiff(d) <= 1 ? dayLabel(d) + ", " : "") + d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }) + " at " + timeLabel(d);
      if (repeat) repeat.textContent = schedule.replace(/^Every/, "Repeats every");
      var m = document.querySelector("[data-cal-m]"), dd = document.querySelector("[data-cal-d]");
      if (m) m.textContent = d.toLocaleDateString("en-GB", { month: "short" });
      if (dd) dd.textContent = d.getDate();
      var bar = document.querySelector(".ev-next-cta");
      if (bar) bar.textContent = "Next: " + dayLabel(d) + ", " + timeLabel(d);
    }
  }

  // Share
  var share = document.querySelector("[data-share]");
  if (share) share.addEventListener("click", function () {
    var label = share.querySelector("[data-share-label]");
    var data = { title: document.title, url: location.href };
    if (navigator.share) { navigator.share(data).catch(function () {}); return; }
    function copied() { label.textContent = "Link copied"; setTimeout(function () { label.textContent = "Share"; }, 2500); }
    function manual() { window.prompt("Copy this link", location.href); }
    if (navigator.clipboard) navigator.clipboard.writeText(location.href).then(copied, manual); else manual();
  });

  // Add to calendar: a weekly repeating .ics, one entry per session time, in London time
  var cal = document.querySelector("[data-ics]");
  if (cal) cal.addEventListener("click", function () {
    var info; try { info = JSON.parse(cal.getAttribute("data-ics")); } catch (e) { return; }
    function pad(n) { return String(n).padStart(2, "0"); }
    function stamp(d) { return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "T" + pad(d.getHours()) + pad(d.getMinutes()) + "00"; }
    function esc(s) { return String(s).replace(/[\\,;]/g, function (c) { return "\\" + c; }).replace(/\n/g, "\\n"); }
    var lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//WeGoGym//Events//EN", "CALSCALE:GREGORIAN",
      "BEGIN:VTIMEZONE", "TZID:Europe/London",
      "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0000", "TZOFFSETTO:+0100", "TZNAME:BST", "DTSTART:19700329T010000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "END:DAYLIGHT",
      "BEGIN:STANDARD", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0000", "TZNAME:GMT", "DTSTART:19701025T020000", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD",
      "END:VTIMEZONE"];
    var made = new Date();
    info.rules.forEach(function (r, i) {
      var first = occurrences([{ weekday: r.wd, time: r.t, end: r.end }])[0];
      if (!first) return;
      var b = r.end ? hm(r.end) : [first.getHours() + 1, first.getMinutes()];
      var end = new Date(first.getFullYear(), first.getMonth(), first.getDate(), b[0], b[1]);
      lines.push("BEGIN:VEVENT", "UID:" + info.url.replace(/\W+/g, "-") + "-" + i + "@wegogym.club",
        "DTSTAMP:" + made.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, ""),
        "DTSTART;TZID=Europe/London:" + stamp(first), "DTEND;TZID=Europe/London:" + stamp(end),
        "RRULE:FREQ=WEEKLY;BYDAY=" + r.d, "SUMMARY:" + esc(info.title), "LOCATION:" + esc(info.loc),
        "DESCRIPTION:" + esc("Free. Check with the organiser before you go: " + info.url), "URL:" + info.url, "END:VEVENT");
    });
    lines.push("END:VCALENDAR");
    // Fold lines longer than 75 bytes, as the calendar standard requires
    function fold(l) {
      var out = [], cur = "", n = 0, enc = new TextEncoder();
      Array.from(l).forEach(function (ch) {
        var b = enc.encode(ch).length;
        if (n + b > (out.length ? 74 : 75)) { out.push(cur); cur = ""; n = 0; }
        cur += ch; n += b;
      });
      out.push(cur);
      return out.join("\r\n ");
    }
    var blob = new Blob([lines.map(fold).join("\r\n") + "\r\n"], { type: "text/calendar" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = info.url.split("/").filter(Boolean).pop() + ".ics";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  });

  // Sort any grid or rail soonest first
  function sortList(list) {
    Array.prototype.slice.call(list.children)
      .sort(function (a, b) { return (+a.getAttribute("data-next") || 9e15) - (+b.getAttribute("data-next") || 9e15); })
      .forEach(function (li) { list.appendChild(li); });
  }
  var more = document.querySelector(".ev-grid-more");
  if (more) sortList(more);
  var grid = document.querySelector(".ev-list .ev-grid");
  // The home page has no grid: its "All events" row holds every card, so rebuild each row from that
  var source = grid || document.querySelector('[data-rail-list][data-line="all"]');
  if (source) {
    // Rebuild every row from the whole list, so each really is soonest first
    var cards = Array.prototype.slice.call(source.children);
    document.querySelectorAll("[data-rail-wrap]").forEach(function (wrap) {
      var rail = wrap.querySelector("[data-rail-list]");
      var line = rail.getAttribute("data-line");
      var limit = +rail.getAttribute("data-limit") || 0;
      var picked = cards.filter(function (c) {
        return c.getAttribute("data-next") && (line === "next" || (c.getAttribute("data-lines") || "").split(" ").indexOf(line) > -1);
      }).sort(function (x, y) { return x.getAttribute("data-next") - y.getAttribute("data-next"); });
      if (limit) picked = picked.slice(0, limit);
      if (picked.length) {
        rail.innerHTML = "";
        picked.forEach(function (c, i) {
          var n = c.cloneNode(true); n.classList.add("ev-card-rail");
          n.querySelectorAll("img").forEach(function (im) { if (line === "next" && i < 4) im.removeAttribute("loading"); });
          rail.appendChild(n);
        });
      }
      wrap.querySelectorAll("[data-rail]").forEach(function (btn) {
        btn.addEventListener("click", function () { rail.scrollBy({ left: +btn.getAttribute("data-rail") * rail.clientWidth * .8, behavior: "smooth" }); });
      });
    });
  }
  if (!grid) return;
  sortList(grid);

  var count = document.querySelector("[data-count]");
  var host = (new URLSearchParams(location.search).get("host") || "").toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (host) {
    var match = grid.querySelectorAll('.ev-card[data-host="' + host + '"]');
    if (match.length) {
      grid.querySelectorAll(".ev-card").forEach(function (c) { c.hidden = c.getAttribute("data-host") !== host; });
      var note = document.querySelector(".ev-hostfilter");
      note.querySelector("strong").textContent = match[0].querySelector(".ev-card-host").textContent.trim();
      note.hidden = false;
      if (count) count.textContent = match.length;
      return;
    }
  }

  var filters = document.querySelector(".ev-filters");
  if (filters) filters.hidden = false;
  var chosen = { when: "all", cat: "all", region: "all", by: "all" };
  var empty = document.querySelector(".ev-empty");
  function onDay(card) {
    if (chosen.when === "all") return true;
    return (card._occ || []).some(function (d) {
      var n = dayDiff(d), wd = d.getDay();
      if (chosen.when === "today") return n === 0;
      if (chosen.when === "tomorrow") return n === 1;
      // This weekend: the coming Saturday and Sunday (today included if it is one)
      var toSun = (7 - today0.getDay()) % 7;
      return (wd === 6 || wd === 0) && n <= toSun;
    });
  }
  function apply() {
    var shown = 0;
    grid.querySelectorAll(".ev-card").forEach(function (card) {
      var show = onDay(card) && (chosen.cat === "all" || card.getAttribute("data-cat") === chosen.cat) &&
        (chosen.region === "all" || card.getAttribute("data-region") === chosen.region) &&
        (chosen.by === "all" || card.getAttribute("data-by") === chosen.by);
      card.hidden = !show;
      if (show) shown++;
    });
    if (empty) empty.hidden = shown > 0;
    if (count) count.textContent = shown;
  }
  document.querySelectorAll(".ev-filter-row").forEach(function (row) {
    var group = row.getAttribute("data-group");
    var chips = row.querySelectorAll(".ev-chip");
    chips.forEach(function (chip) {
      chip.addEventListener("click", function () {
        chosen[group] = chip.getAttribute("data-filter");
        chips.forEach(function (c) { var on = c === chip; c.classList.toggle("is-on", on); c.setAttribute("aria-pressed", on ? "true" : "false"); });
        apply();
      });
    });
  });
})();
