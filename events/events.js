// Fills in each event's next date, sorts the listing soonest first, and runs the type filter.
(function () {
  // Every date here is London wall-clock time, whatever the visitor's own time zone.
  function londonNow() {
    var p = {};
    try {
      new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" })
        .formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
      return new Date(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    } catch (e) { return new Date(); }
  }
  function nextDate(rule, now) {
    var hm = rule.time.split(":").map(Number);
    var em = (rule.end || rule.time).split(":").map(Number);
    for (var i = 0; i < 400; i++) {
      var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, hm[0], hm[1]);
      var ends = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, em[0], em[1]);
      if (ends < now || d.getDay() !== rule.weekday) continue;
      if (rule.type === "weekly") return d;
      if (rule.type === "lastWeekdayOfMonth") {
        var inSkip = (rule.skipMonths || []).indexOf(d.getMonth() + 1) !== -1;
        var isLast = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7).getMonth() !== d.getMonth();
        if (isLast && !inSkip) return d;
      }
    }
    return null;
  }
  function label(d, now) {
    var day = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5);
    if (day === 0) return "Today";
    if (day === 1) return "Tomorrow";
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  }
  var now = londonNow();
  document.querySelectorAll("[data-rule]").forEach(function (el) {
    var d;
    try { d = nextDate(JSON.parse(el.getAttribute("data-rule")), now); } catch (e) { d = null; }
    if (!d) return;
    el.setAttribute("data-next", d.getTime());
    var full = el.querySelector(".ev-next") || (el.classList.contains("ev-next") ? el : null);
    if (full) full.textContent = "Next: " + label(d, now);
    var short = el.querySelector(".ev-next-short");
    if (short) short.textContent = label(d, now) + " · ";
  });

  var grid = document.querySelector(".ev-grid");
  if (!grid) return;
  Array.prototype.slice.call(grid.children)
    .sort(function (a, b) { return (+a.getAttribute("data-next") || 9e15) - (+b.getAttribute("data-next") || 9e15); })
    .forEach(function (li) { grid.appendChild(li); });

  var filters = document.querySelector(".ev-filters");
  if (filters) filters.hidden = false;
  var chips = document.querySelectorAll(".ev-chip");
  chips.forEach(function (chip) {
    chip.addEventListener("click", function () {
      var f = chip.getAttribute("data-filter");
      chips.forEach(function (c) {
        var on = c === chip;
        c.classList.toggle("is-on", on);
        c.setAttribute("aria-pressed", on ? "true" : "false");
      });
      grid.querySelectorAll(".ev-card").forEach(function (card) {
        card.hidden = f !== "all" && card.getAttribute("data-cat") !== f;
      });
    });
  });
})();
