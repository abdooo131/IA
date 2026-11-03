// Store engine screen: sortable tables, auto submitting pickers, live progress of a running job. No external code.
(function () {
  "use strict";

  // pickers: submit on change
  document.querySelectorAll("select[data-autosubmit]").forEach(function (sel) {
    sel.addEventListener("change", function () { sel.form.submit(); });
  });
  document.querySelectorAll("a[data-back]").forEach(function (a) {
    if (history.length > 1) a.addEventListener("click", function (e) { e.preventDefault(); history.back(); });
  });

  // sortable tables: click a th[data-sort] (num or text); cells carry data-v
  document.querySelectorAll("table.sortable").forEach(function (table) {
    var heads = table.querySelectorAll("thead th");
    heads.forEach(function (th, col) {
      if (!th.dataset.sort) return;
      th.setAttribute("tabindex", "0");
      var sort = function () {
        var asc = !th.classList.contains("sorted-asc");
        heads.forEach(function (h) { h.classList.remove("sorted-asc", "sorted-desc"); });
        th.classList.add(asc ? "sorted-asc" : "sorted-desc");
        var body = table.tBodies[0];
        var rows = Array.prototype.slice.call(body.rows);
        var key = function (r) {
          var c = r.cells[col]; var v = c ? (c.dataset.v !== undefined ? c.dataset.v : c.textContent) : "";
          return v;
        };
        rows.sort(function (a, b) {
          var x = key(a), y = key(b);
          if (th.dataset.sort === "num") {
            var nx = x === "" ? null : parseFloat(x), ny = y === "" ? null : parseFloat(y);
            if (nx === null && ny === null) return 0;
            if (nx === null) return 1;               // empty values last either way
            if (ny === null) return -1;
            return asc ? nx - ny : ny - nx;
          }
          return asc ? x.localeCompare(y) : y.localeCompare(x);
        });
        rows.forEach(function (r) { body.appendChild(r); });
      };
      th.addEventListener("click", sort);
      th.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); sort(); } });
    });
  });

  // progress: poll the JSON endpoint while a job runs, redraw the stage tables, reload once it ends
  var box = document.getElementById("progress");
  if (!box || box.dataset.running !== "1") return;
  var esc = function (s) { var d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; };
  var row = function (label, name, status, seconds, error, cls) {
    return "<tr" + (cls ? ' class="' + cls + '"' : "") + "><td>" + esc(label) + " <small>" + esc(name) + "</small></td><td><span class=\"chip " +
      esc(status) + "\">" + esc(status) + "</span>" + (error ? " <small>" + esc(error) + "</small>" : "") + "</td><td>" +
      (seconds == null ? "" : esc(seconds)) + "</td></tr>";
  };
  var tick = function () {
    fetch(box.dataset.url, { headers: { "Accept": "application/json" }, credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (p) {
        var status = document.getElementById("progress-status");
        if (p.job && status) {
          status.innerHTML = (p.job.kind === "cycle" ? "Monthly cycle" : "History load of the new store") + ": <strong>" +
            esc(p.job.state) + "</strong>" + (p.job.message ? " · " + esc(p.job.message) : "");
        }
        var runBody = document.getElementById("run-stages");
        if (p.run && runBody) {
          runBody.innerHTML = p.run.stages.map(function (s) { return row(s.label, s.name, s.status, s.seconds, s.error); }).join("") +
            p.run.pending.map(function (s, i) { return row(s.label, s.name, i === 0 ? "running" : "waiting", null, null, "pending"); }).join("");
        }
        var jobBody = document.getElementById("job-stages");
        if (p.job && jobBody) {
          jobBody.innerHTML = p.job.stages.map(function (s) { return row(s.name, s.name, s.status, s.seconds, s.error); }).join("");
        }
        if (p.job && p.job.state !== "running") { window.location.reload(); return; }
        setTimeout(tick, 1500);
      })
      .catch(function () { setTimeout(tick, 4000); });
  };
  if (!document.getElementById("run-stages") && !document.getElementById("job-stages")) {
    box.insertAdjacentHTML("beforeend", '<table class="stages"><thead><tr><th>Stage</th><th>Status</th><th>Seconds</th></tr></thead><tbody id="run-stages"></tbody></table>');
  }
  setTimeout(tick, 800);
})();
