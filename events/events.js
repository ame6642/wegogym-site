// Fills in each event's next date (London time), sorts the listing soonest first,
// runs the type, area and host filters, and the share button.
(function () {
  function londonNow() {
    var p = {};
    try {
      new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" })
        .formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
      return new Date(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    } catch (e) { return new Date(); }
  }
  function nextOf(rule, now) {
    var hm = rule.time.split(":").map(Number);
    var em = rule.end ? rule.end.split(":").map(Number) : [hm[0] + 1, hm[1]]; // no end given: assume an hour
    for (var i = 0; i < 8; i++) {
      var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, hm[0], hm[1]);
      var ends = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, em[0], em[1]);
      if (d.getDay() === rule.weekday && ends >= now) return d;
    }
    return null;
  }
  function soonest(rules, now) {
    return rules.map(function (r) { return nextOf(r, now); }).filter(Boolean).sort(function (a, b) { return a - b; })[0] || null;
  }
  function dayLabel(d, now) {
    var n = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5);
    if (n === 0) return "Today";
    if (n === 1) return "Tomorrow";
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  }
  function timeLabel(d) {
    var h = d.getHours(), m = d.getMinutes();
    return (h % 12 || 12) + (m ? ":" + String(m).padStart(2, "0") : "") + (h < 12 ? "am" : "pm");
  }

  var now = londonNow();
  document.querySelectorAll("[data-rules]").forEach(function (el) {
    var d;
    try { d = soonest(JSON.parse(el.getAttribute("data-rules")), now); } catch (e) { d = null; }
    if (!d) return;
    el.setAttribute("data-next", d.getTime());
    if (el.classList.contains("ev-next")) el.textContent = "Next: " + dayLabel(d, now) + " at " + timeLabel(d);
    var short = el.querySelector(".ev-next-short");
    if (short) short.textContent = dayLabel(d, now) + ", " + timeLabel(d);
  });

  var share = document.querySelector("[data-share]");
  if (share) share.addEventListener("click", function () {
    var data = { title: document.title, url: location.href };
    if (navigator.share) { navigator.share(data).catch(function () {}); return; }
    function copied() {
      share.setAttribute("aria-label", "Link copied");
      share.classList.add("is-done");
      setTimeout(function () { share.setAttribute("aria-label", "Share this event"); share.classList.remove("is-done"); }, 2500);
    }
    function manual() { window.prompt("Copy this link", location.href); }
    if (navigator.clipboard) navigator.clipboard.writeText(location.href).then(copied, manual);
    else manual();
  });

  var grid = document.querySelector(".ev-grid");
  if (!grid) return;
  Array.prototype.slice.call(grid.children)
    .sort(function (a, b) { return (+a.getAttribute("data-next") || 9e15) - (+b.getAttribute("data-next") || 9e15); })
    .forEach(function (li) { grid.appendChild(li); });

  var host = (new URLSearchParams(location.search).get("host") || "").toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (host) {
    var match = grid.querySelectorAll('.ev-card[data-host="' + host + '"]');
    if (match.length) {
      grid.querySelectorAll(".ev-card").forEach(function (c) { c.hidden = c.getAttribute("data-host") !== host; });
      var note = document.querySelector(".ev-hostfilter");
      note.querySelector("strong").textContent = match[0].querySelector(".ev-card-where").textContent.split(" · ")[0];
      note.hidden = false;
      return;
    }
  }

  var filters = document.querySelector(".ev-filters");
  if (filters) filters.hidden = false;
  var chosen = { cat: "all", region: "all" };
  var empty = document.querySelector(".ev-empty");
  function apply() {
    var shown = 0;
    grid.querySelectorAll(".ev-card").forEach(function (card) {
      var show = (chosen.cat === "all" || card.getAttribute("data-cat") === chosen.cat) &&
        (chosen.region === "all" || card.getAttribute("data-region") === chosen.region);
      card.hidden = !show;
      if (show) shown++;
    });
    if (empty) empty.hidden = shown > 0;
  }
  document.querySelectorAll(".ev-filter-row").forEach(function (row) {
    var group = row.getAttribute("data-group");
    var chips = row.querySelectorAll(".ev-chip");
    chips.forEach(function (chip) {
      chip.addEventListener("click", function () {
        chosen[group] = chip.getAttribute("data-filter");
        chips.forEach(function (c) {
          var on = c === chip;
          c.classList.toggle("is-on", on);
          c.setAttribute("aria-pressed", on ? "true" : "false");
        });
        apply();
      });
    });
  });
})();
