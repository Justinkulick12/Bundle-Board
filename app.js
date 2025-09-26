// Constants
const STATES_RED = new Set(["NY","NJ","CA","MA","NV","OR"]);
const TRAVELER_PURPLE = new Set([
  "Gabriela Endara","Jose Arroyo","Andres Alvarez","Gianni Bloise","Genesis Ronquillo",
  "Martha Aguirre","Paola Salcan","Karen Chapman","Daniel Molineros","Anto",
  "Veronica Endara","Delia Vera","Milton Jijon","Kenia Jimenez","Carlos Matute",
  "Andrea Martinez","Delicia Rodriguez Mendez","Genesis Ronquillo - Vuelo de carga",
  "Daniel Lliguicota","Romina Campodonico + Jeampiero","Isabella Piedrahita",
  "Juan C Chevrasco","Nicole Matamoros","Fabricio Triviño","Freddy Arboleda",
  "David Muzzio Ruliova","Santiago Ruliova","Betty Lastre","Priscila Alejandro",
  "Jeniffer Zambrano","Alison Fajardo","Wesley Triviño","Leonardo Pauta",
  "Erick Pauta","Dario Pauta","Diana Pauta","Jorge Ivan Alejandro","Ana Belen Alejandro",
  "Bruno Pagnacco","Katy Valdivieso","Eddy Vera","Ericka Pluas","Domenica Pluas"
]);

let allTrips = [];

// Save / load trip state (status, assignedName) in localStorage
function saveTripState(tripId, field, value) {
  const key = `tripState_${tripId}`;
  let obj = JSON.parse(localStorage.getItem(key) || "{}");
  obj[field] = value;
  localStorage.setItem(key, JSON.stringify(obj));
}
function loadTripState(tripId) {
  return JSON.parse(localStorage.getItem(`tripState_${tripId}`) || "{}");
}

// Helpers
function parseDateString(str) {
  return new Date(str);
}
function getWeekdayNumber(dt) {
  const d = new Date(dt);
  let wd = d.getDay(); // 0 = Sunday ... 6 = Saturday
  if (wd === 0) wd = 7;
  return wd;  // 1=Monday, …, 7=Sunday
}
function getDefaultDateRange() {
  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() + 7);
  return { start: now, end };
}

// SWITCH between views
document.getElementById("btnGrid").addEventListener("click", () => {
  document.getElementById("gridView").style.display = "";
  document.getElementById("listView").style.display = "none";
});
document.getElementById("btnList").addEventListener("click", () => {
  document.getElementById("gridView").style.display = "none";
  document.getElementById("listView").style.display = "";
});

// Render header dates above weekdays
function renderGridTemplate(startDate) {
  const grid = document.getElementById("gridView");
  // Clear grid contents
  grid.innerHTML = "";
  // We want first row: status-col empty, then weekdays with dates
  let headerHtml = `<div class="grid-header status-col"></div>`;
  for (let i = 0; i < 5; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    const label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    headerHtml += `<div class="grid-header">${["Mon","Tue","Wed","Thu","Fri"][i]}<br>${label}</div>`;
  }
  grid.insertAdjacentHTML("beforeend", headerHtml);

  // Status rows
  const statuses = ["Pending", "In Progress", "TX Approved", "Rejected", "Preparing", "TA Completed", "ReadyForLabel"];
  statuses.forEach(status => {
    // status label
    grid.insertAdjacentHTML("beforeend", `<div class="status-col">${status}</div>`);
    // five cells for Monday‑Friday
    for (let day = 1; day <= 5; day++) {
      grid.insertAdjacentHTML("beforeend",
        `<div class="cell" data-status="${status}" data-day="${day}"></div>`);
    }
  });
}

// Clear all cells
function clearGridCells() {
  document.querySelectorAll("#gridView .cell").forEach(c => c.innerHTML = "");
}

// Metrics
function renderMetrics(filteredTrips) {
  document.getElementById("totalTrips").textContent = filteredTrips.length;
  let sum = 0;
  filteredTrips.forEach(tr => {
    sum += Number(tr["Items Accepted"]) || 0;
  });
  document.getElementById("totalItems").textContent = sum;
}

// Render charts (status distribution)
function renderStatusChart(trips) {
  const ctx = document.getElementById("statusChart").getContext("2d");
  const statusCounts = {};
  trips.forEach(tr => {
    const saved = loadTripState(tr["Trip ID"]);
    const st = saved.status || tr["Trip Verification Status"];
    statusCounts[st] = (statusCounts[st] || 0) + 1;
  });
  const labels = Object.keys(statusCounts);
  const data = labels.map(l => statusCounts[l]);
  new Chart(ctx, {
    type: 'pie',
    data: {
      labels,
      datasets: [{ data, backgroundColor: labels.map(l => {
        // color mapping logic or fallback
        if (l === "TX Approved") return "#8BC34A";
        if (l === "Pending" || l === "In Progress") return "#FFB74D";
        if (l === "Rejected") return "#E57373";
        return "#90A4AE";
      }) }]
    }
  });
}

// Render grid view
function renderGridView(filterStart, filterEnd) {
  // Rebuild template with correct dates
  renderGridTemplate(filterStart);
  clearGridCells();
  const filtered = allTrips.filter(trip => {
    const bd = parseDateString(trip["Ship Bundle"]);
    if (filterStart && filterEnd) {
      return bd >= filterStart && bd <= filterEnd;
    }
    return true;
  });
  filtered.sort((a,b) => parseDateString(a["Ship Bundle"]) - parseDateString(b["Ship Bundle"]);

  renderMetrics(filtered);
  renderStatusChart(filtered);

  filtered.forEach(trip => {
    const weekday = getWeekdayNumber(trip["Ship Bundle"]);
    if (weekday > 5) return;
    const saved = loadTripState(trip["Trip ID"]);
    const status = saved.status || trip["Trip Verification Status"];
    const cell = document.querySelector(`#gridView .cell[data-status="${status}"][data-day="${weekday}"]`);
    if (!cell) return;
    const tile = createTile(trip, status);
    cell.appendChild(tile);
  });
  setupDragAndDropGrid();
}

// Create a tile
function createTile(trip, status) {
  const div = document.createElement("div");
  div.classList.add("trip-tile");
  // highlight logic
  if (trip["Trip Verification Status"] !== "TX Approved") div.classList.add("highlight-not-approved");
  if (STATES_RED.has(trip["USA Dest"])) div.classList.add("highlight-dest-red");
  if (TRAVELER_PURPLE.has(trip["Traveler"])) div.classList.add("highlight-trav-purple");

  div.dataset.tripId = trip["Trip ID"];
  div.dataset.status = status;

  const sum = document.createElement("div");
  sum.classList.add("summary");
  sum.innerHTML = `
    <div><strong>ID:</strong> ${trip["Trip ID"]}</div>
    <div><strong>Traveler:</strong> ${trip["Traveler"]}</div>
    <div><strong>Ship Bundle:</strong> ${trip["Ship Bundle"]}</div>
    <div><strong>Dest:</strong> ${trip["USA Dest"]}</div>
    <div><strong>Accepted:</strong> ${trip["Items Accepted"]}</div>
    <div><strong>Status:</strong> ${status}</div>
  `;
  div.appendChild(sum);

  const dt = document.createElement("div");
  dt.classList.add("details");
  dt.innerHTML = `
    <div><strong>Max USA Date:</strong> ${trip["Max USA Date"]}</div>
    <div><strong>Items Ready:</strong> ${trip["Items Ready to process"]}</div>
    <div><strong>Total Weight:</strong> ${trip["Total Bundle Weight"]}</div>
    <div><strong>User ID:</strong> ${trip["User ID"]}</div>
  `;
  div.appendChild(dt);

  div.addEventListener("click", e => {
    if (e.target.tagName.toLowerCase() === "input") return;
    div.classList.toggle("expanded");
  });

  const inp = document.createElement("input");
  inp.type = "text";
  inp.placeholder = "Your name...";
  inp.classList.add("assign-input");
  const saved = loadTripState(trip["Trip ID"]);
  inp.value = saved.assignedName || "";
  inp.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveTripState(trip["Trip ID"], "assignedName", inp.value.trim());
      inp.blur();
    }
  });
  div.appendChild(inp);

  return div;
}

function setupDragAndDropGrid() {
  document.querySelectorAll("#gridView .cell").forEach(cell => {
    Sortable.create(cell, {
      group: "sharedGrid",
      animation: 150,
      onAdd: (evt) => {
        const tile = evt.item;
        const newStatus = evt.to.getAttribute("data-status");
        const tid = tile.dataset.tripId;
        saveTripState(tid, "status", newStatus);
      }
    });
  });
}

// LIST VIEW rendering
function renderListView(filterStart, filterEnd) {
  const tbody = document.getElementById("listBody");
  tbody.innerHTML = "";
  const filtered = allTrips.filter(trip => {
    const bd = parseDateString(trip["Ship Bundle"]);
    if (filterStart && filterEnd) {
      return bd >= filterStart && bd <= filterEnd;
    }
    return true;
  });
  filtered.sort((a,b) => parseDateString(a["Ship Bundle"]) - parseDateString(b["Ship Bundle"]);

  filtered.forEach(trip => {
    const saved = loadTripState(trip["Trip ID"]);
    const status = saved.status || trip["Trip Verification Status"];
    const tr = document.createElement("tr");

    if (trip["Trip Verification Status"] !== "TX Approved") tr.classList.add("highlight-not-approved");
    if (STATES_RED.has(trip["USA Dest"])) tr.classList.add("highlight-dest-red");
    if (TRAVELER_PURPLE.has(trip["Traveler"])) tr.classList.add("highlight-trav-purple");

    tr.innerHTML = `
      <td>${trip["Trip ID"]}</td>
      <td>${trip["Traveler"]}</td>
      <td>${trip["Ship Bundle"]}</td>
      <td>${trip["Max USA Date"] || ""}</td>
      <td>${trip["USA Dest"]}</td>
      <td>${trip["Items Accepted"]}</td>
      <td>${status}</td>
      <td>${trip["Items Ready to process"] || ""}</td>
      <td><input type="text" class="assign-input-list" data-tripid="${trip["Trip ID"]}" value="${saved.assignedName || ""}" /></td>
    `;
    tbody.appendChild(tr);
  });

  // Attach Enter key events to list view inputs
  document.querySelectorAll(".assign-input-list").forEach(inp => {
    inp.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        e.preventDefault();
        const id = inp.dataset.tripid;
        saveTripState(id, "assignedName", inp.value.trim());
        inp.blur();
      }
    });
  });

  renderMetrics(filtered);
  renderStatusChart(filtered);
}

// CSV load + filter wiring
document.getElementById("csvInput").addEventListener("change", e => {
  const file = e.target.files[0];
  if (!file) return;
  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: results => {
      allTrips = results.data;
      const { start, end } = getDefaultDateRange();
      document.getElementById("dateStart").valueAsDate = start;
      document.getElementById("dateEnd").valueAsDate = end;
      renderGridView(start, end);
      renderListView(start, end);
    }
  });
});
document.getElementById("applyDateFilter").addEventListener("click", () => {
  const start = document.getElementById("dateStart").valueAsDate;
  const end = document.getElementById("dateEnd").valueAsDate;
  renderGridView(start, end);
  renderListView(start, end);
});
document.getElementById("resetDateFilter").addEventListener("click", () => {
  const { start, end } = getDefaultDateRange();
  document.getElementById("dateStart").valueAsDate = start;
  document.getElementById("dateEnd").valueAsDate = end;
  renderGridView(start, end);
  renderListView(start, end);
});

