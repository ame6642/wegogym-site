/* WeGoGym waitlist: three-step signup, then two games. No dependencies, nothing stored in the browser. */
document.documentElement.classList.add("js");

/* ===== EDIT HERE ===== */
// Sign-up receiver (Supabase edge function). Also set in the form's action and the page's security policy.
var ENDPOINT = "https://yxgwywppajvxfmmjudaq.supabase.co/functions/v1/waitlist";

// Slide puzzle: one or more pictures (square, 600 x 600 or larger) with a fun fact each.
// Leave image empty to play with numbered tiles. Put image files in /waitlist/images/.
var PUZZLES = [
  { image: "", alt: "", fact: "" }
];

// Matching game: each round picks ROUND_SIZE different activities and one piece of kit from each.
// Kit must belong to only one activity in this list, or a round could have two right answers.
// Icons are emoji placeholders until illustrated icons exist.
var ROUND_SIZE = 8;
var KIT = [
  { activity: "Climbing", icon: "\u{1F9D7}", kit: ["Chalk bag", "Carabiner"] },
  { activity: "Swimming", icon: "\u{1F3CA}", kit: ["Goggles", "Kickboard", "Lane ropes"] },
  { activity: "Boxing", icon: "\u{1F94A}", kit: ["Punch bag", "Hand wraps"] },
  { activity: "Pilates", icon: "\u{1F9D8}", kit: ["Reformer"] },
  { activity: "Weightlifting", icon: "\u{1F3CB}\u{FE0F}", kit: ["Barbell", "Dumbbells", "Kettlebell"] },
  { activity: "Rowing", icon: "\u{1F6A3}", kit: ["Oars"] },
  { activity: "Cycling", icon: "\u{1F6B4}", kit: ["Handlebars", "Pedals"] },
  { activity: "Fencing", icon: "\u{1F93A}", kit: ["Sword"] },
  { activity: "Ballet", icon: "\u{1FA70}", kit: ["Tutu", "Pointe shoes"] },
  { activity: "Running", icon: "\u{1F3C3}", kit: ["Treadmill"] },
  { activity: "Gymnastics", icon: "\u{1F938}", kit: ["Balance beam", "Pommel horse"] },
  { activity: "HIIT", icon: "\u23F1\uFE0F", kit: ["Battle ropes"] },
  { activity: "Archery", icon: "\u{1F3F9}", kit: ["Bow", "Arrows"] },
  { activity: "Badminton", icon: "\u{1F3F8}", kit: ["Shuttlecock"] },
  { activity: "Golf", icon: "\u26F3", kit: ["Tee", "Putter"] },
  { activity: "Basketball", icon: "\u{1F3C0}", kit: ["Backboard"] },
  { activity: "Skiing", icon: "\u26F7\uFE0F", kit: ["Poles", "Chairlift"] },
  { activity: "Horse riding", icon: "\u{1F3C7}", kit: ["Saddle", "Stirrups"] },
  { activity: "Scuba diving", icon: "\u{1F93F}", kit: ["Oxygen tank"] },
  { activity: "Recovery", icon: "\u{1F6C0}", kit: ["Foam roller", "Massage gun", "Ice bath"] },
  { activity: "Karate", icon: "\u{1F94B}", kit: ["Black belt"] },
  { activity: "Cricket", icon: "\u{1F3CF}", kit: ["Stumps", "Bails"] },
  { activity: "Ice hockey", icon: "\u{1F3D2}", kit: ["Puck"] },
  { activity: "Bowling", icon: "\u{1F3B3}", kit: ["Pins"] },
  { activity: "Kayaking", icon: "\u{1F6F6}", kit: ["Paddle"] }
];
/* ===================== */

document.addEventListener("DOMContentLoaded", function () {
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function shuffle(list) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ===================== SIGNUP ===================== */
  var form = $("#wl-form");
  var done = $("#joined");
  var steps = $$(".wl-step", form);
  var alertBox = $("#wl-alert");
  var progressText = $("#wl-progress-text");
  var progressBar = $(".wl-progress-bar");
  var current = 0;

  function say(msg) { alertBox.textContent = ""; if (msg) { setTimeout(function () { alertBox.textContent = msg; }, 30); } }

  function goTo(index, direction) {
    steps[current].classList.remove("is-active", "enter-forward", "enter-back");
    current = index;
    var step = steps[current];
    step.classList.add("is-active");
    if (!reduceMotion && direction) step.classList.add(direction > 0 ? "enter-forward" : "enter-back");
    progressText.textContent = "Step " + (current + 1) + " of " + steps.length;
    progressBar.style.width = ((current + 1) / steps.length) * 100 + "%";
    $(".wl-step-title", step).focus();
  }
  steps[0].classList.add("is-active");
  progressText.textContent = "Step 1 of " + steps.length;
  progressBar.style.width = (1 / steps.length) * 100 + "%";

  function checked(name) {
    return $$('input[name="' + name + '"]:checked', form).map(function (i) { return i.value; });
  }

  function validateStep(index) {
    if (index === 0 && checked("regularActivities").length + checked("interestedActivities").length === 0) {
      say("Pick at least one activity in either list to continue.");
      $('input[name="regularActivities"]', form).focus();
      return false;
    }
    if (index === 2) {
      var email = $("#email");
      email.value = email.value.trim();
      if (!email.value || !email.checkValidity()) {
        email.setAttribute("aria-invalid", "true");
        say("Enter a valid email address, like name@example.com.");
        email.focus();
        return false;
      }
      email.removeAttribute("aria-invalid");
    }
    return true;
  }

  $$("[data-next]", form).forEach(function (b) {
    b.addEventListener("click", function () {
      if (current === 1) addCity();
      if (!validateStep(current)) return;
      say("");
      goTo(current + 1, 1);
    });
  });
  $$("[data-back]", form).forEach(function (b) {
    b.addEventListener("click", function () { say(""); goTo(current - 1, -1); });
  });
  $("[data-skip]", form).addEventListener("click", function () {
    cities = []; renderCities(); $("#city-input").value = "";
    say(""); goTo(2, 1);
  });

  // Enter key moves forward instead of submitting early.
  form.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" || e.target.tagName !== "INPUT" || e.target.type === "checkbox") return;
    if (e.target.id === "city-input") { e.preventDefault(); addCity(); return; }
    if (current < 2) { e.preventDefault(); $("[data-next]", steps[current]).click(); }
  });

  /* Travel cities */
  var cities = [];
  var cityInput = $("#city-input");
  cityInput.removeAttribute("name"); // sent from the list instead
  function addCity() {
    var parts = cityInput.value.split(",");
    var added = false;
    for (var i = 0; i < parts.length; i++) {
      var v = parts[i].trim();
      if (!v) continue;
      var dup = cities.some(function (c) { return c.toLocaleLowerCase() === v.toLocaleLowerCase(); });
      if (dup) { say(v + " is already on your list."); continue; }
      if (cities.length >= 8) { say("You can add up to eight cities."); break; }
      cities.push(v.slice(0, 80)); added = true;
    }
    cityInput.value = "";
    if (added) { say(""); renderCities(); }
  }
  function renderCities() {
    var list = $("#city-list");
    list.innerHTML = "";
    cities.forEach(function (c, i) {
      var li = document.createElement("li");
      li.textContent = c;
      var rm = document.createElement("button");
      rm.type = "button";
      rm.setAttribute("aria-label", "Remove " + c);
      rm.textContent = "×";
      rm.addEventListener("click", function () {
        cities.splice(i, 1); renderCities(); cityInput.focus();
      });
      li.appendChild(rm);
      list.appendChild(li);
    });
  }
  $("#city-add").addEventListener("click", function () { addCity(); cityInput.focus(); });

  /* Submit */
  var submitBtn = $("#wl-submit");
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (current !== 2) return;
    if (!validateStep(2)) return;
    var regular = checked("regularActivities");
    var interested = checked("interestedActivities");
    var body = {
      email: $("#email").value,
      regularActivities: regular,
      interestedActivities: interested,
      destinations: cities,
      website: $("#website").value
    };
    var otherR = $("#other-regular").value.trim();
    var otherI = $("#other-interested").value.trim();
    if (regular.indexOf("Other") > -1 && otherR) body.otherRegularActivity = otherR;
    if (interested.indexOf("Other") > -1 && otherI) body.otherInterestedActivity = otherI;

    submitBtn.disabled = true;
    submitBtn.textContent = "Joining…";
    say("");
    fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (res) {
        if (res.ok) { showDone(true); return; }
        if (res.status === 429) say("Too many sign-ups from this connection in the last hour. Try again later.");
        else if (res.status === 400) say("Something in the form is not valid. Check your email address and activities, then try again.");
        else say("That did not go through on our side. Your answers are still here, so try again in a minute.");
      })
      .catch(function () {
        say("Could not reach WeGoGym. Check your connection, then try again. Your answers are still here.");
      })
      .then(function () { submitBtn.disabled = false; submitBtn.textContent = "Join the waitlist"; });
  });

  var gamesStarted = false;
  function showDone(focus) {
    form.classList.add("is-hidden");
    done.classList.add("is-shown");
    if (focus) $("#done-title").focus();
    if (!gamesStarted) { gamesStarted = true; startPuzzle(); startMatch(); }
  }
  // Arrived back from a no-JavaScript post (or a shared link)? Show the outcome.
  if (new URLSearchParams(location.search).get("joined") === "1" || location.hash === "#joined") showDone(false);
  window.addEventListener("hashchange", function () { if (location.hash === "#joined") showDone(false); });

  /* ===================== SLIDE PUZZLE ===================== */
  function startPuzzle() {
    var board = $("#puzzle");
    var peek = $("#puzzle-peek");
    var movesEl = $("#puzzle-moves");
    var timeEl = $("#puzzle-time");
    var live = $("#puzzle-live");
    var face = $(".game-face", $("#puzzle-flip"));
    var reward = $("#puzzle-reward");
    var puzzleIndex = 0;
    var order, moves, startTime, timer, solved, rewardTimer;
    var tiles = [];

    for (var n = 0; n < 9; n++) {
      var t = document.createElement("button");
      t.type = "button";
      t.className = "tile";
      t.dataset.piece = n;
      t.tabIndex = -1;
      t.innerHTML = '<span class="tile-num">' + (n + 1) + "</span>";
      t.style.backgroundPosition = (n % 3) * 50 + "% " + Math.floor(n / 3) * 50 + "%";
      t.addEventListener("click", onTileClick);
      board.appendChild(t);
      tiles.push(t);
    }

    function applyImage() {
      var p = PUZZLES[puzzleIndex];
      var has = !!p.image;
      board.classList.toggle("has-image", has);
      tiles.forEach(function (t) { t.style.backgroundImage = has ? 'url("' + p.image + '")' : ""; });
      peek.style.backgroundImage = has ? 'url("' + p.image + '")' : "";
      peek.textContent = has ? "" : "1 2 3 / 4 5 6 / 7 8";
      board.setAttribute("aria-label", (has && p.alt ? p.alt + ". " : "") + "Puzzle board. Arrow keys slide a tile into the gap.");
    }

    // order[cell] = piece in that cell; piece 8 is the gap.
    function gapCell() { return order.indexOf(8); }
    function neighbours(cell) {
      var r = Math.floor(cell / 3), c = cell % 3, out = [];
      if (r > 0) out.push(cell - 3);
      if (r < 2) out.push(cell + 3);
      if (c > 0) out.push(cell - 1);
      if (c < 2) out.push(cell + 1);
      return out;
    }
    function swap(cell) { var g = gapCell(); order[g] = order[cell]; order[cell] = 8; }

    function scramble() {
      order = [0, 1, 2, 3, 4, 5, 6, 7, 8];
      var prev = -1;
      for (var i = 0; i < 120; i++) {
        var g = gapCell();
        var options = neighbours(g).filter(function (c) { return c !== prev; });
        var pick = options[Math.floor(Math.random() * options.length)];
        prev = g;
        swap(pick);
      }
      if (isSolved()) scramble();
    }
    function isSolved() { for (var i = 0; i < 9; i++) if (order[i] !== i) return false; return true; }

    function layout() {
      for (var cell = 0; cell < 9; cell++) {
        var t = tiles[order[cell]];
        var r = Math.floor(cell / 3), c = cell % 3;
        t.style.left = "calc(" + c + " * (100% - 2 * var(--gap)) / 3 + " + c + " * var(--gap))";
        t.style.top = "calc(" + r + " * (100% - 2 * var(--gap)) / 3 + " + r + " * var(--gap))";
        t.style.visibility = order[cell] === 8 && !solved ? "hidden" : "visible";
        var movable = !solved && neighbours(gapCell()).indexOf(cell) > -1;
        var where = ", row " + (r + 1) + ", column " + (c + 1);
        t.setAttribute("aria-label", order[cell] === 8 ? "Gap" + where : "Tile " + (order[cell] + 1) + where + (movable ? ", can move" : ""));
      }
    }

    function fmt(ms) { var s = Math.floor(ms / 1000); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }
    function tick() { timeEl.textContent = fmt(Date.now() - startTime); }

    function reset() {
      clearInterval(timer); timer = null; startTime = null;
      clearTimeout(rewardTimer);
      moves = 0; solved = false;
      movesEl.textContent = "0"; timeEl.textContent = "0:00";
      board.classList.remove("solved");
      reward.hidden = true; reward.classList.remove("is-flipping");
      face.hidden = false;
      scramble(); layout();
    }

    function move(cell) {
      if (solved || neighbours(gapCell()).indexOf(cell) === -1) return;
      if (!startTime) { startTime = Date.now(); timer = setInterval(tick, 250); }
      swap(cell);
      moves++;
      movesEl.textContent = String(moves);
      layout();
      if (isSolved()) finish();
    }
    function onTileClick(e) { move(order.indexOf(Number(e.currentTarget.dataset.piece))); }

    board.addEventListener("keydown", function (e) {
      var g = gapCell(), r = Math.floor(g / 3), c = g % 3, from = -1;
      // The arrow names the direction the tile travels into the gap.
      if (e.key === "ArrowUp" && r < 2) from = g + 3;
      else if (e.key === "ArrowDown" && r > 0) from = g - 3;
      else if (e.key === "ArrowLeft" && c < 2) from = g + 1;
      else if (e.key === "ArrowRight" && c > 0) from = g - 1;
      else if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].indexOf(e.key) === -1) return;
      e.preventDefault();
      if (from > -1) {
        var piece = order[from];
        move(from);
        if (!solved) {
          var g2 = gapCell();
          live.textContent = "Tile " + (piece + 1) + " moved " + e.key.replace("Arrow", "").toLowerCase() +
            ". The gap is now at row " + (Math.floor(g2 / 3) + 1) + ", column " + (g2 % 3 + 1) + ".";
        }
      }
    });

    function finish() {
      solved = true;
      clearInterval(timer);
      var elapsed = Date.now() - startTime;
      tick();
      board.classList.add("solved");
      layout();
      var p = PUZZLES[puzzleIndex];
      live.textContent = "Solved in " + moves + " moves and " + fmt(elapsed) + ".";
      rewardTimer = setTimeout(function () {
        $("#puzzle-fact").textContent = p.fact || "";
        $("#puzzle-fact").hidden = !p.fact;
        $("#puzzle-result").textContent = moves + " moves in " + fmt(elapsed) + ".";
        face.hidden = true;
        reward.hidden = false;
        if (!reduceMotion) reward.classList.add("is-flipping");
        $("#puzzle-reward-title").focus();
      }, 600);
    }

    // Hold to peek: pointer or held Space on the button.
    var peekBtn = $("#puzzle-peek-btn");
    function peekOn() { board.classList.add("peeking"); }
    function peekOff() { board.classList.remove("peeking"); }
    peekBtn.addEventListener("pointerdown", function (e) { peekBtn.setPointerCapture(e.pointerId); peekOn(); });
    ["pointerup", "pointercancel", "lostpointercapture"].forEach(function (ev) { peekBtn.addEventListener(ev, peekOff); });
    peekBtn.addEventListener("keydown", function (e) { if (e.key === " ") { e.preventDefault(); peekOn(); } });
    peekBtn.addEventListener("keyup", function (e) { if (e.key === " ") { e.preventDefault(); peekOff(); } });
    peekBtn.addEventListener("blur", peekOff);
    peekBtn.addEventListener("click", function (e) { e.preventDefault(); });
    peekBtn.addEventListener("contextmenu", function (e) { e.preventDefault(); });

    $("#puzzle-shuffle").addEventListener("click", function () { reset(); live.textContent = "Shuffled. Moves and time reset."; });
    $("#puzzle-skip").addEventListener("click", function () { reset(); live.textContent = "Skipped. The tiles are reshuffled and moves and time reset."; });
    $("#puzzle-again").addEventListener("click", function () {
      puzzleIndex = (puzzleIndex + 1) % PUZZLES.length;
      applyImage(); reset(); board.focus();
    });

    applyImage();
    reset();
  }

  /* ===================== MATCHING ===================== */
  function startMatch() {
    var actCol = $("#match-activities");
    var eqCol = $("#match-equipment");
    var wrongEl = $("#match-wrong");
    var live = $("#match-live");
    var doneBox = $("#match-done");
    var wrong, matched, selected, pairs;

    function button(label, icon, key, kind) {
      var li = document.createElement("li");
      var b = document.createElement("button");
      b.type = "button";
      b.className = "match-btn";
      b.dataset.key = key;
      b.dataset.kind = kind;
      if (kind === "activity") b.setAttribute("aria-pressed", "false");
      b.innerHTML = (icon ? '<span class="match-icon" aria-hidden="true"></span>' : "") + "<span></span>";
      if (icon) b.firstChild.textContent = icon;
      b.lastChild.textContent = label;
      b.addEventListener("click", onPick);
      li.appendChild(b);
      return li;
    }

    function build() {
      wrong = 0; matched = 0; selected = null;
      wrongEl.textContent = "0";
      actCol.innerHTML = ""; eqCol.innerHTML = "";
      doneBox.hidden = true;
      $("#match").hidden = false;
      pairs = shuffle(KIT).slice(0, ROUND_SIZE).map(function (k) {
        return { activity: k.activity, icon: k.icon, equipment: k.kit[Math.floor(Math.random() * k.kit.length)] };
      });
      shuffle(pairs).forEach(function (p) { actCol.appendChild(button(p.activity, p.icon, p.activity, "activity")); });
      shuffle(pairs).forEach(function (p) { eqCol.appendChild(button(p.equipment, "", p.activity, "equipment")); });
    }

    function onPick(e) {
      var b = e.currentTarget;
      if (b.classList.contains("is-matched")) return;
      if (b.dataset.kind === "activity") {
        if (selected) selected.setAttribute("aria-pressed", "false");
        selected = b;
        b.setAttribute("aria-pressed", "true");
        live.textContent = b.lastChild.textContent + " selected. Now pick its equipment.";
        return;
      }
      if (!selected) { live.textContent = "Pick an activity first."; return; }
      var a = selected;
      selected = null;
      a.setAttribute("aria-pressed", "false");
      if (a.dataset.key === b.dataset.key) {
        [a, b].forEach(function (x) { x.classList.add("is-matched"); x.setAttribute("aria-disabled", "true"); x.removeAttribute("aria-pressed"); });
        matched++;
        live.textContent = "Correct: " + a.lastChild.textContent + " and " + b.lastChild.textContent + ".";
        if (matched === pairs.length) finish();
        else a.closest("ul").querySelector(".match-btn:not(.is-matched)").focus();
      } else {
        wrong++;
        wrongEl.textContent = String(wrong);
        [a, b].forEach(function (x) {
          x.classList.remove("is-wrong"); void x.offsetWidth; x.classList.add("is-wrong");
          setTimeout(function () { x.classList.remove("is-wrong"); }, 350);
        });
        live.textContent = "Not that one. " + a.lastChild.textContent + " does not go with " + b.lastChild.textContent + ".";
      }
    }

    function finish() {
      $("#match-result").textContent = wrong === 0 ? "A perfect round: no wrong guesses." :
        wrong + " wrong guess" + (wrong === 1 ? "" : "es") + ".";
      setTimeout(function () {
        $("#match").hidden = true;
        doneBox.hidden = false;
        $("#match-done-title").focus();
      }, reduceMotion ? 0 : 400);
      live.textContent = "All matched with " + wrong + " wrong guess" + (wrong === 1 ? "" : "es") + ".";
    }

    $("#match-again").addEventListener("click", function () { build(); actCol.querySelector(".match-btn").focus(); });
    build();
  }
});
