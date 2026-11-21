/* WeGoGym business dashboard: wegogym.club/business/
 *
 * One page for everyone on a facility's team. The database decides what each person can
 * do (migration 0070); this page only hides buttons that would be refused anyway.
 *   owner     sees the listing, sets up payouts with Stripe, creates and removes operators
 *   staff     sees the listing and the payout status
 *   operator  view only: sees the listing and the payout status, changes nothing
 * Everyone can change their own password, which matters for operators because the owner
 * chose it.
 *
 * Plain fetch, same as /business-register/, and the same stored session, so logging in on
 * either page logs in on both.
 */
(function () {
  "use strict";

  var CONFIG = {
    url: "https://yxgwywppajvxfmmjudaq.supabase.co",
    key: "sb_publishable_HoGxqewsV4DLLKpUCmtS-g_Ad-3D5o-"
  };
  var SESSION_KEY = "wgg-business-session";
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var STATUS_WORDS = {
    draft: "Draft. Not shown to members yet.",
    pending: "Sent to WeGoGym for review.",
    changes_requested: "WeGoGym has asked for some changes.",
    rejected: "Not accepted. Email hello@wegogym.club if you have questions.",
    live: "Live. Members can see it.",
    paused: "Paused. Members cannot book for now.",
    suspended: "Suspended by WeGoGym. Email hello@wegogym.club."
  };
  var ROLE_WORDS = {
    owner: "You are the owner.",
    staff: "You are on the staff.",
    operator: "View only. You can see everything here but cannot change it."
  };
  var DAYS = [["mon", "Monday"], ["tue", "Tuesday"], ["wed", "Wednesday"], ["thu", "Thursday"],
    ["fri", "Friday"], ["sat", "Saturday"], ["sun", "Sunday"]];
  var COPY = {
    invalid_credentials: "That email and password do not match. Check both and try again.",
    invalid_grant: "That email and password do not match. Check both and try again.",
    email_not_confirmed: "Confirm your email first. Finish signing up at wegogym.club/business-register.",
    email_exists: "That email already has a WeGoGym account. Use a different email for this login.",
    under_18: "They need to be 18 or over.",
    invalid_dob: "Check their date of birth.",
    invalid_email: "Enter an email address like name@example.com.",
    invalid_name: "Enter their name.",
    weak_password: "Choose a longer password, at least 8 characters.",
    too_many_operators: "You already have 10 operator logins. Remove one to add another.",
    same_password: "That is your current password. Choose a new one.",
    reauthentication_needed: "For your security, log out and log in again, then change your password.",
    forbidden: "Only the owner can do that.",
    WGG21: "Only the owner can do that.",
    WGG56: "You cannot remove yourself.",
    WGG57: "A facility must keep at least one owner.",
    onboarding_in_progress: "Stripe is still getting ready. Wait a few seconds and try again.",
    stripe_error: "We could not reach Stripe just now. Try again in a minute.",
    over_request_rate_limit: "Too many attempts in a short time. Wait a few minutes and try again.",
    otp_expired: "That code is wrong or has expired. Send a new code and try again.",
    over_email_send_rate_limit: "We have sent several emails to that address already. Wait a few minutes, then try again.",
    network: "We could not reach WeGoGym. Check your internet connection and try again.",
    session: "You have been logged out. Log in again."
  };

  var state = { pendingEmail: null, session: null, members: [], venues: [], venue: null, role: null };
  var running = false;

  function $(id) { return document.getElementById(id); }
  function AppError(status, code, message) { this.status = status; this.code = code; this.message = message || ""; }
  function messageFor(err) {
    if (err && COPY[err.code]) return COPY[err.code];
    return "That did not work. Try again, and email hello@wegogym.club if it keeps happening.";
  }
  function showAlert(t) { $("bd-alert").textContent = t || ""; }
  function announce(t) { $("bd-live").textContent = t; }
  function show(view) {
    document.querySelectorAll("[data-view]").forEach(function (s) { s.hidden = s.dataset.view !== view; });
    var h = document.querySelector('[data-view="' + view + '"] h2');
    if (h) h.focus();
  }

  // ===== HTTP and session (same shape as /business-register/) =====
  async function http(path, opts, retried) {
    opts = opts || {};
    var headers = { apikey: CONFIG.key };
    if (opts.auth !== false) headers.Authorization = "Bearer " + await accessToken(retried);
    if (opts.json !== undefined) headers["Content-Type"] = "application/json";
    var res;
    try {
      res = await fetch(CONFIG.url + path, {
        method: opts.method || "GET", headers: headers,
        body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined
      });
    } catch (e) { throw new AppError(0, "network"); }
    var text = await res.text(), data = null;
    if (text) { try { data = JSON.parse(text); } catch (e) { data = null; } }
    if ((res.status === 401 || /jwt expired/i.test(text)) && opts.auth !== false && !retried) return http(path, opts, true);
    if (!res.ok) {
      var b = data || {};
      throw new AppError(res.status, b.error_code || (typeof b.code === "string" ? b.code : null) || b.error || String(res.status), b.msg || b.message);
    }
    return data;
  }
  function fn(name, body) { return http("/functions/v1/" + name, { method: "POST", json: body }); }

  function saveSession(s) {
    state.session = s;
    try { if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s)); else localStorage.removeItem(SESSION_KEY); } catch (e) {}
  }
  function fromAuth(d) {
    if (!d || !d.access_token) return null;
    return {
      access_token: d.access_token, refresh_token: d.refresh_token,
      expires_at: d.expires_at || Math.floor(Date.now() / 1000) + Number(d.expires_in || 3600),
      user: d.user ? { id: d.user.id, email: d.user.email, user_metadata: { full_name: (d.user.user_metadata || {}).full_name } } : null
    };
  }
  var refreshing = null;
  async function accessToken(force) {
    var s = state.session;
    if (!s) throw new AppError(401, "session");
    if (!force && s.expires_at * 1000 - 60000 > Date.now()) return s.access_token;
    try {
      var stored = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (stored && stored.refresh_token !== s.refresh_token && stored.expires_at * 1000 - 60000 > Date.now() &&
          stored.user && s.user && stored.user.id === s.user.id) { state.session = stored; return stored.access_token; }
    } catch (e) {}
    if (!refreshing) {
      refreshing = (async function () {
        try {
          var next = fromAuth(await http("/auth/v1/token?grant_type=refresh_token",
            { method: "POST", auth: false, json: { refresh_token: s.refresh_token } }));
          if (!next) throw new AppError(401, "session");
          saveSession(next);
          return next.access_token;
        } catch (e) {
          if (e.status === 400 || e.status === 401 || e.code === "session") { endSession(); throw new AppError(401, "session"); }
          throw e;
        } finally { refreshing = null; }
      })();
    }
    return refreshing;
  }
  function endSession() {
    saveSession(null);
    state.members = []; state.venues = []; state.venue = null; state.role = null;
    $("bd-signout").hidden = true;
    document.querySelectorAll("form").forEach(function (f) { f.reset(); });
  }
  function handleError(err) {
    if (err && err.code === "session") { show("login"); showAlert(COPY.session); return; }
    showAlert(messageFor(err));
  }

  // One handler shape for every form and button: latch, busy label, error banner.
  function guard(btn, label, work) {
    return async function (e) {
      if (e) e.preventDefault();
      if (running) return;
      running = true;
      var old = btn.textContent;
      btn.disabled = true; btn.textContent = label;
      showAlert("");
      try { await work(); } catch (err) { handleError(err); }
      finally { running = false; btn.disabled = false; btn.textContent = old; }
    };
  }

  // ===== Log in / out =====
  async function logIn() {
    var email = $("li-email").value.trim(), pw = $("li-password").value;
    if (!EMAIL.test(email) || !pw) { showAlert("Enter your email address and password."); return; }
    var d;
    try {
      d = await http("/auth/v1/token?grant_type=password", { method: "POST", auth: false, json: { email: email, password: pw } });
    } catch (err) {
      if (err.code !== "email_not_confirmed") throw err;
      // First login of an operator login: prove this is your address with a code.
      state.pendingEmail = email;
      $("cf-email").textContent = email;
      show("confirm");
      await sendCode(true);
      return;
    }
    $("li-password").value = "";
    saveSession(fromAuth(d));
    await load();
  }
  async function sendCode(quiet) {
    await http("/auth/v1/resend", { method: "POST", auth: false, json: { type: "signup", email: state.pendingEmail } });
    if (!quiet) showAlert("A new code is on its way.");
  }
  async function confirmCode() {
    var code = $("cf-code").value.replace(/\s/g, "");
    if (!/^\d{6}$/.test(code)) { showAlert("Enter the 6 numbers from the email."); $("cf-code").focus(); return; }
    var s = fromAuth(await http("/auth/v1/verify", { method: "POST", auth: false, json: { type: "email", email: state.pendingEmail, token: code } }));
    if (!s) { showAlert("That code is wrong or has expired. Send a new code and try again."); return; }
    $("cf-code").value = "";
    saveSession(s);
    await load();
  }
  async function leaveVenue() {
    if (!confirm("Stop seeing " + (state.venue.name || "this facility") + "? Only the owner can add you back.")) return;
    await http("/rest/v1/rpc/leave_venue", { method: "POST", json: { p_venue_id: state.venue.id } });
    announce("You have left.");
    await load();
  }

  function logOut() {
    var token = state.session && state.session.access_token;
    endSession();
    if (token) {
      fetch(CONFIG.url + "/auth/v1/logout?scope=local", { method: "POST", headers: { apikey: CONFIG.key, Authorization: "Bearer " + token } }).catch(function () {});
    }
    show("login");
    announce("Logged out.");
  }

  // ===== Loading =====
  async function load() {
    $("bd-signout").hidden = false;
    state.members = await http("/rest/v1/venue_members?select=venue_id,member_role&profile_id=eq." + state.session.user.id);
    if (!state.members.length) { show("none"); return; }
    // get_venue_overview, not the venues table: it leaves out door codes and Stripe ids,
    // and it is the only way an operator can read the listing at all (migration 0070).
    state.venues = (await Promise.all(state.members.map(function (m) {
      return http("/rest/v1/rpc/get_venue_overview", { method: "POST", json: { p_venue_id: m.venue_id } });
    }))).map(function (rows) { return rows && rows[0]; }).filter(Boolean);
    if (!state.venues.length) { show("none"); return; }
    var pick = $("bd-pick");
    pick.textContent = "";
    state.venues.forEach(function (v) {
      var o = document.createElement("option"); o.value = v.id; o.textContent = v.name || "Unnamed facility"; pick.appendChild(o);
    });
    $("bd-pick-wrap").hidden = state.venues.length < 2;
    await selectVenue(state.venues[0].id);
    show("dash");
    var q = new URLSearchParams(location.search).get("stripe");
    if (q) {
      history.replaceState(null, "", location.pathname);
      if (q === "refresh") showAlert("Your Stripe page timed out. Choose “Continue with Stripe” to carry on.");
      else announce("Welcome back from Stripe.");
    }
  }

  async function selectVenue(id) {
    state.venue = state.venues.find(function (v) { return v.id === id; });
    state.role = (state.members.find(function (m) { return m.venue_id === id; }) || {}).member_role;
    $("h-dash").textContent = state.venue.name || "Your facility";
    $("bd-role").textContent = ROLE_WORDS[state.role] || "";
    renderListing();
    await Promise.all([renderCover(), renderPayouts(), renderAccess(), renderBookings(), state.role === "owner" ? renderTeam() : Promise.resolve()]);
    $("bd-team").hidden = state.role !== "owner";
    $("bd-leave").hidden = state.role !== "operator";
  }

  function addRow(dl, label, value) {
    if (!value) return;
    var dt = document.createElement("dt"), dd = document.createElement("dd");
    dt.textContent = label; dd.textContent = value;
    dl.appendChild(dt); dl.appendChild(dd);
  }

  function renderListing() {
    var v = state.venue, dl = $("bd-details");
    $("bd-status").textContent = STATUS_WORDS[v.status] || "";
    dl.textContent = "";
    addRow(dl, "Address", [v.address_line1, v.address_line2, v.city, v.region, v.postcode, v.country].filter(Boolean).join(", "));
    addRow(dl, "Kind of place", v.category_slug === "other" ? v.category_other : (v.category_slug || "").replace(/[-_]/g, " "));
    addRow(dl, "Description", v.description);
    var h = v.opening_hours || {};
    addRow(dl, "Opening hours", DAYS.map(function (d) {
      var parts = String(h[d[0]] || "").split("-");
      var t = parts.length === 2 && parts[0] && parts[1] ? parts[0] + " to " + parts[1] : "Closed";
      return d[1] + ": " + t;
    }).join("\n"));
    addRow(dl, "What you offer", (v.amenities || []).join(", "));
    addRow(dl, "Contact", [v.contact_email, v.contact_phone].filter(Boolean).join(", "));
    $("bd-edit").hidden = !(state.role === "owner" && (v.status === "draft" || v.status === "changes_requested"));
  }

  async function renderCover() {
    var img = $("bd-cover");
    img.hidden = true;
    try {
      var rows = await http("/rest/v1/venue_photos?select=storage_path&venue_id=eq." + state.venue.id +
        "&status=neq.rejected&order=is_cover.desc,position.asc.nullslast&limit=1");
      if (rows && rows[0]) {
        img.src = CONFIG.url + "/storage/v1/object/public/venue-photos/" + rows[0].storage_path.split("/").map(encodeURIComponent).join("/");
        img.alt = "Cover photo of " + (state.venue.name || "your facility");
        img.hidden = false;
      }
    } catch (e) { /* no photo is not an error worth a banner */ }
  }

  // ===== Getting in and bookings (everyone on the team, operators included) =====
  var ACCESS_WORDS = { passcode: "Door code", qr: "Members show a QR code", staff: "Members check in with staff" };
  async function renderAccess() {
    var v = state.venue, dl = $("bd-access");
    dl.textContent = "";
    addRow(dl, "How members get in", ACCESS_WORDS[v.access_method] || "Not set yet");
    try {
      var rows = await http("/rest/v1/venue_access?select=door_code,code_valid_from,code_valid_to&venue_id=eq." + v.id);
      var a = rows && rows[0];
      if (a && a.door_code) {
        addRow(dl, "Door code", a.door_code);
        if (a.code_valid_from || a.code_valid_to) {
          addRow(dl, "Code valid", [a.code_valid_from, a.code_valid_to].map(function (d) { return d ? new Date(d).toLocaleString() : "open"; }).join(" to "));
        }
      }
    } catch (e) { /* show what we have */ }
    addRow(dl, "Entry instructions", v.access_instructions);
    addRow(dl, "Directions", v.directions_note);
    if (!dl.children.length) addRow(dl, "Status", "Not set up yet.");
  }

  var BOOKING_WORDS = { pending_payment: "Awaiting payment", pending_approval: "Waiting for approval", confirmed: "Confirmed",
    checked_in: "Checked in", completed: "Completed", cancelled_member: "Cancelled by member", cancelled_venue: "Cancelled by you", expired: "Expired", declined_venue: "Declined" };
  async function renderBookings() {
    var list = $("bd-bookings");
    list.textContent = "";
    var rows;
    try { rows = await http("/rest/v1/rpc/list_venue_bookings", { method: "POST", json: { p_venue_id: state.venue.id } }); }
    catch (e) { var li0 = document.createElement("li"); li0.textContent = "We could not load bookings just now."; list.appendChild(li0); return; }
    if (!rows.length) { var li1 = document.createElement("li"); li1.textContent = "No bookings yet."; list.appendChild(li1); return; }
    rows.forEach(function (b) {
      var li = document.createElement("li");
      var when = b.slot_start_at
        ? new Date(b.slot_start_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short", timeZone: state.venue.timezone || undefined })
        : b.start_date + (b.end_date && b.end_date !== b.start_date ? " to " + b.end_date : "");
      var who = document.createElement("div");
      var name = document.createElement("b"); name.textContent = b.member_name || "Member";
      var meta = document.createElement("span"); meta.textContent = " " + when + " \u00b7 " + b.reference;
      who.appendChild(name); who.appendChild(meta);
      var st = document.createElement("span"); st.textContent = BOOKING_WORDS[b.status] || b.status;
      li.appendChild(who); li.appendChild(st);
      list.appendChild(li);
    });
  }

  // ===== Getting paid =====
  async function renderPayouts() {
    var status = $("bd-pay-status"), owner = state.role === "owner";
    $("bd-pay-action").hidden = true;
    $("bd-pay-note").hidden = owner;
    status.textContent = "Checking with Stripe…";
    try {
      var st = await fn("connect-status", { venue_id: state.venue.id });
      if (!st.started) status.textContent = "Not set up yet. Members cannot pay this facility until it is.";
      else if (st.payouts_enabled && st.charges_enabled) status.textContent = "Done. Stripe has the bank details and payouts are switched on.";
      else if (st.details_submitted) status.textContent = "Stripe has the details and is checking them. This can take a day or two.";
      else status.textContent = "Started but not finished.";
      if (owner && !(st.started && st.details_submitted && !st.needs_more_info)) {
        $("bd-pay-btn").textContent = st.started ? "Continue with Stripe" : "Set up payouts with Stripe";
        $("bd-pay-action").hidden = false;
      }
      if (owner && st.started && st.needs_more_info && st.details_submitted) {
        status.textContent += " Stripe needs a little more information.";
      }
    } catch (err) {
      status.textContent = "We could not check with Stripe just now. Refresh the page to try again.";
      if (err.code === "session") handleError(err);
    }
  }

  async function startPayouts() {
    var d = await fn("connect-onboarding-link", { venue_id: state.venue.id });
    if (!d || !/^https:\/\/connect\.stripe\.com\//.test(d.url || "")) throw new AppError(502, "stripe_error");
    location.assign(d.url);
  }

  // ===== Team (owner only) =====
  async function renderTeam() {
    var list = $("bd-people");
    list.textContent = "";
    var rows = await http("/rest/v1/rpc/list_venue_staff", { method: "POST", json: { p_venue_id: state.venue.id } });
    var me = state.session.user.id;
    rows.forEach(function (r) {
      var li = document.createElement("li");
      var who = document.createElement("div");
      var name = document.createElement("b"); name.textContent = r.full_name || r.email || "Unnamed";
      var meta = document.createElement("span");
      meta.textContent = " " + (r.email || "") + " · " + (r.member_role === "operator" ? "Operator (view only)" : r.member_role === "owner" ? "Owner" : "Staff");
      who.appendChild(name); who.appendChild(meta); li.appendChild(who);
      if (r.member_role !== "owner" && r.profile_id !== me) {
        var b = document.createElement("button");
        b.type = "button"; b.className = "btn btn-ghost br-small";
        b.textContent = "Remove";
        b.setAttribute("aria-label", "Remove " + (r.full_name || r.email));
        b.addEventListener("click", guard(b, "Removing…", async function () {
          if (!confirm("Remove " + (r.full_name || r.email) + "? They will no longer be able to see this facility.")) return;
          await http("/rest/v1/rpc/remove_venue_staff", { method: "POST", json: { p_venue_id: state.venue.id, p_profile_id: r.profile_id } });
          announce("Removed.");
          await renderTeam();
        }));
        li.appendChild(b);
      }
      list.appendChild(li);
    });
  }

  function ageOn(iso) {
    var dob = new Date(iso + "T00:00:00"), now = new Date();
    var age = now.getFullYear() - dob.getFullYear(), m = now.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
    return age;
  }

  async function createOperator() {
    var name = $("op-name").value.trim(), email = $("op-email").value.trim(), dob = $("op-dob").value;
    var pw = $("op-password").value, pw2 = $("op-password2").value;
    if (!name) { showAlert(COPY.invalid_name); $("op-name").focus(); return; }
    if (!EMAIL.test(email)) { showAlert(COPY.invalid_email); $("op-email").focus(); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) { showAlert("Enter their date of birth."); $("op-dob").focus(); return; }
    if (ageOn(dob) < 18) { showAlert(COPY.under_18); $("op-dob").focus(); return; }
    if (pw.length < 8) { showAlert(COPY.weak_password); $("op-password").focus(); return; }
    if (pw !== pw2) { showAlert("The two passwords do not match."); $("op-password2").focus(); return; }
    await fn("create-venue-operator", { venue_id: state.venue.id, full_name: name, email: email, password: pw, date_of_birth: dob });
    $("op-form").reset();
    announce("Login created.");
    showAlert("Login created for " + email + ". When they first log in at wegogym.club/business with the password you chose, we email them a 6-digit code to confirm the address is theirs.");
    await renderTeam();
  }

  // ===== Own password =====
  async function changePassword() {
    var pw = $("pw-new").value, pw2 = $("pw-new2").value;
    if (pw.length < 8) { showAlert(COPY.weak_password); $("pw-new").focus(); return; }
    if (pw !== pw2) { showAlert("The two passwords do not match."); $("pw-new2").focus(); return; }
    await http("/auth/v1/user", { method: "PUT", json: { password: pw } });
    $("pw-form").reset();
    showAlert("Your password has been changed.");
  }

  // ===== Start =====
  async function start() {
    if (window.top !== window.self) { show("offline"); return; }
    $("li-form").addEventListener("submit", guard($("li-form").querySelector("button"), "Logging in…", logIn));
    $("bd-signout").addEventListener("click", logOut);
    $("bd-pay-btn").addEventListener("click", guard($("bd-pay-btn"), "Opening Stripe…", startPayouts));
    $("op-form").addEventListener("submit", guard($("op-form").querySelector("button"), "Creating…", createOperator));
    $("cf-form").addEventListener("submit", guard($("cf-form").querySelector('button[type="submit"]'), "Checking\u2026", confirmCode));
    $("cf-resend").addEventListener("click", guard($("cf-resend"), "Sending\u2026", function () { return sendCode(false); }));
    $("bd-leave-btn").addEventListener("click", guard($("bd-leave-btn"), "Leaving\u2026", leaveVenue));
    $("pw-form").addEventListener("submit", guard($("pw-form").querySelector("button"), "Saving…", changePassword));
    $("bd-pick").addEventListener("change", function () {
      showAlert("");
      selectVenue($("bd-pick").value).catch(handleError);
    });
    try { state.session = JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch (e) { state.session = null; }
    if (!state.session || !state.session.user) { show("login"); return; }
    try { await load(); }
    catch (err) { show("login"); handleError(err); }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
