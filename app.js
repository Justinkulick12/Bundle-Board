// app.js — with drag/drop highlight (bucket hover) support

const db = window.firebaseDb;
const firebaseRef = window.firebaseRef;
const firebaseSet = window.firebaseSet;
const firebaseOnValue = window.firebaseOnValue;

let trips = [];
let statusChart, dailyChart, metricChart;

const csvUpload = document.getElementById('csvUpload');
const tripTableBody = document.querySelector('#trip-table tbody');
const startDateInp = document.getElementById('startDate');
const endDateInp = document.getElementById('endDate');
const applyDateFilterBtn = document.getElementById('applyDateFilter');
const dateRangeButtons = document.querySelectorAll('#date-filter button[data-range]');

function normalizeTrip(rawTrip = {}) {
  const originalStatus = rawTrip.originalStatus
    || rawTrip['Trip Verification Status']
    || rawTrip.currentStatus
    || 'Pending Verification';
  const boardStatus = rawTrip.boardStatus
    || rawTrip.currentStatus
    || originalStatus
    || 'Pending Verification';

  return {
    ...rawTrip,
    originalStatus,
    boardStatus,
    assignedTo: rawTrip.assignedTo || ''
  };
}

const SPECIAL_NAMES = new Set([
  "Gabriela","Endara","Jose Arroyo","Andres Alvarez","Gianni Bloise",
  "Genesis Ronquillo","Martha Aguirre","Paola Salcan","Karen Chapman",
  "Daniel Molineros","Veronica Endara","Delia Vera","Milton Jijon",
  "Kenia Jimenez","Carlos Matute","Andrea Martinez","Delicia Rodriguez",
  "Mendez","Vuelo de carga","Daniel Lliguicota","Romina Campodonico",
  "Jeampiero","Isabella Piedrahita","Juan C Chevrasco","Nicole Matamoros",
  "Fabricio Triviño","Freddy Arboleda","David Muzzio","Ruliova",
  "Darwin Parrales","Eva Novotona","Jorge Alejandro","Josue Alejandro",
  "Betty Lastre","Priscila Alejandro","Jeniffer Zambrano","Alison Fajardo",
  "Wesley Triviño","Leonardo Pauta","Ornella Bloise","Erick Pauta",
  "Bruno Pagnacco","Katy Valdivieso","Eddy Vera"
]);
const SPECIAL_DESTS = new Set(["CA","NV","NJ","NY","CO","MA"]);
const ASSIGNEES = ["Justin","Caz","Greg","CJ"];

function loadTripsFromFirebase() {
  const tripsRef = firebaseRef(db, 'currentTrips');
  firebaseOnValue(tripsRef, snapshot => {
    const val = snapshot.val();
    let incoming = [];
    if (Array.isArray(val)) {
      incoming = val.filter(Boolean);
    } else if (val && typeof val === 'object') {
      incoming = Object.values(val);
    }
    trips = incoming.map(normalizeTrip);
    applyDateFilter();
  });
}

function uploadTripsToFirebase(tripsList) {
  const tripsRef = firebaseRef(db, 'currentTrips');
  firebaseSet(tripsRef, tripsList)
    .catch(err => console.error("Firebase write error:", err));
}

if (csvUpload) {
  csvUpload.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete(results) {
          const data = results.data;
          const existingTripsMap = new Map(
            trips.map(t => [String(t['Trip ID']), normalizeTrip(t)])
          );

          trips = data.map(row => {
            const tripId = String(row['Trip ID'] || '').trim();
            const existing = existingTripsMap.get(tripId);
            const originalStatus = row['Trip Verification Status'] || 'Pending Verification';
            const normalized = normalizeTrip({
              ...row,
              originalStatus,
              boardStatus: existing ? existing.boardStatus : originalStatus,
              assignedTo: existing ? existing.assignedTo : ''
            });
            return normalized;
          });

          uploadTripsToFirebase(trips);
          applyDateFilter();
        }
      });
    }
  });
}

window.addEventListener('DOMContentLoaded', () => {
  loadTripsFromFirebase();
});

if (applyDateFilterBtn) {
  applyDateFilterBtn.addEventListener('click', () => {
    applyDateFilter();
  });
}
dateRangeButtons.forEach(btn => {
  btn.addEventListener('click', evt => {
    const rng = evt.target.getAttribute('data-range');
    const { start, end } = getRangeFromShortcut(rng);
    if (startDateInp) {
      startDateInp.value = start ? start.toISOString().slice(0,10) : '';
    }
    if (endDateInp) {
      endDateInp.value = end ? end.toISOString().slice(0,10) : '';
    }
    applyDateFilter();
  });
});

function parseDateOnly(str) {
  if (!str) return null;
  const d = new Date(str);
  if (isNaN(d)) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function getWeekRange(date) {
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(date.setDate(diff));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: monday, end: sunday };
}
function getRangeFromShortcut(shortcut) {
  const today = new Date();
  const d0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  switch (shortcut) {
    case 'thisWeek': {
      const { start, end } = getWeekRange(d0);
      return { start, end };
    }
    case 'nextWeek': {
      const { start, end } = getWeekRange(d0);
      const ns = new Date(start); ns.setDate(ns.getDate() + 7);
      const ne = new Date(end); ne.setDate(ne.getDate() + 7);
      return { start: ns, end: ne };
    }
    case 'allUpcoming':
      return { start: d0, end: null };
    default:
      return { start: null, end: null };
  }
}

function applyDateFilter() {
  const start = parseDateOnly(startDateInp ? startDateInp.value : '');
  const end = parseDateOnly(endDateInp ? endDateInp.value : '');
  let filtered = trips;
  if (start && end) {
    filtered = trips.filter(trip => {
      const bd = parseDateOnly(trip['Ship Bundle']);
      return bd && bd >= start && bd <= end;
    });
  } else if (start && !end) {
    filtered = trips.filter(trip => {
      const bd = parseDateOnly(trip['Ship Bundle']);
      return bd && bd >= start;
    });
  }
  renderTopMetrics(filtered);
  renderTripTable(filtered);
  renderBuckets(filtered);
  renderChartsAndKPIs(filtered);
}

function renderTopMetrics(list) {
  const container = document.getElementById('top-kpi-container');
  if (!container) return;
  container.innerHTML = '';
  let total = 0, approved = 0, pending = 0, ambassadors = 0;
  list.forEach(trip => {
    total++;
    if ((trip.originalStatus || '').toLowerCase() === 'tx approved') approved++;
    else pending++;
    for (const nm of SPECIAL_NAMES) {
      if ((trip['Traveler'] || '').includes(nm)) {
        ambassadors++;
        break;
      }
    }
  });
  const metrics = [
    ['Total Trips', total],
    ['Total Approved', approved],
    ['Total Pending', pending],
    ['Ambassador Trips', ambassadors]
  ];
  metrics.forEach(([label, val]) => {
    const div = document.createElement('div');
    div.className = 'kpi-card';
    div.innerHTML = `<h3>${label}</h3><p>${val}</p>`;
    container.appendChild(div);
  });
}

function renderTripTable(list) {
  if (!tripTableBody) return;
  tripTableBody.innerHTML = '';
  list.forEach(trip => {
    const tr = document.createElement('tr');
    if ((trip.originalStatus || '').toLowerCase() !== 'tx approved') {
      tr.classList.add('red-status');
    }
    if (SPECIAL_DESTS.has((trip['USA Dest'] || '').toUpperCase())) {
      tr.classList.add('special-dest');
    }
    for (const nm of SPECIAL_NAMES) {
      if ((trip['Traveler'] || '').includes(nm)) {
        tr.classList.add('highlight-name');
        break;
      }
    }
    const cells = [
      trip['Trip ID'],
      trip['Items Accepted'],
      trip['Traveler'],
      trip['USA Dest'],
      trip.originalStatus,
      trip['Ship Bundle'],
      trip['Max USA Date']
    ];
    cells.forEach(val => {
      const td = document.createElement('td');
      td.textContent = val !== undefined ? val : '';
      tr.appendChild(td);
    });
    tr.addEventListener('click', () => {
      const details = Object.entries(trip).map(([k, v]) => `${k}: ${v}`).join('\n');
      alert(details);
    });
    tripTableBody.appendChild(tr);
  });
}

function renderBuckets(list) {
  const bucketLists = document.querySelectorAll('.bucket-list');
  if (!bucketLists.length) return;
  bucketLists.forEach(b => b.innerHTML = '');

  list.forEach(trip => {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.tripId = trip['Trip ID'];

    if ((trip.originalStatus || '').toLowerCase() !== 'tx approved') {
      card.classList.add('red-status');
    }
    if (SPECIAL_DESTS.has((trip['USA Dest'] || '').toUpperCase())) {
      card.classList.add('special-dest');
    }
    for (const nm of SPECIAL_NAMES) {
      if ((trip['Traveler'] || '').includes(nm)) {
        card.classList.add('highlight-name');
        break;
      }
    }
    if (trip.boardStatus === 'TA Completed') {
      card.classList.add('ta-completed');
    }
    if (trip.boardStatus === 'Bundle Completed') {
      card.classList.add('bundle-completed');
    }

    let opts = `<option value="">Assign To</option>`;
    ASSIGNEES.forEach(nm => {
      opts += `<option value="${nm}">${nm}</option>`;
    });

    card.innerHTML = `
      <strong>${trip['Trip ID']}</strong><br>
      ${trip['Traveler']}<br>
      ${trip['Ship Bundle']}<br>
      <select class="assign-select">${opts}</select>
    `;
    const sel = card.querySelector('.assign-select');
    sel.value = trip.assignedTo || '';
    sel.addEventListener('change', e => {
      trip.assignedTo = e.target.value;
      uploadTripsToFirebase(trips);
    });

    const boardStatus = trip.boardStatus || 'Pending Verification';
    const bucket = document.querySelector(`.bucket[data-status="${boardStatus}"] .bucket-list`);
    if (bucket) bucket.appendChild(card);
    else {
      const fallback = document.querySelector(`.bucket[data-status="Pending Verification"] .bucket-list`);
      if (fallback) fallback.appendChild(card);
    }
  });

  initDragAndDrop();
}

function initDragAndDrop() {
  const lists = document.querySelectorAll('.bucket-list');
  if (!lists.length) return;
  lists.forEach(list => {
    new Sortable(list, {
      group: {
        name: 'shared',
        pull: true,
        put: true
      },
      animation: 150,
      onMove(evt) {
        evt.to.classList.add('drag-over');
      },
      onEnd(evt) {
        lists.forEach(l => l.classList.remove('drag-over'));
        const card = evt.item;
        const newBucket = evt.to.closest('.bucket');
        const newStatus = newBucket.dataset.status;
        const tripId = card.dataset.tripId;
        const trip = trips.find(t => String(t['Trip ID']) === String(tripId));
        if (trip) {
          trip.boardStatus = newStatus;
          uploadTripsToFirebase(trips);
          setTimeout(() => {
            renderChartsAndKPIs(trips);
            renderBuckets(trips);
          }, 200);
        }
      }
    });
  });
}

function renderChartsAndKPIs(list) {
  const kpiContainer = document.getElementById('kpi-container');
  const statusCanvas = document.getElementById('statusChart');
  const dailyCanvas = document.getElementById('dailyChart');
  const metricCanvas = document.getElementById('metricChart');
  if (!kpiContainer && !statusCanvas && !dailyCanvas && !metricCanvas) {
    return;
  }

  const statusCounts = {};
  const dayCounts = {};
  let totalItems = 0, totalWeight = 0, specialDestTrips = 0, readyToProcess = 0;

  list.forEach(t => {
    const statusKey = t.originalStatus || 'Pending Verification';
    statusCounts[statusKey] = (statusCounts[statusKey] || 0) + 1;
    const bd = t['Ship Bundle'];
    if (bd) dayCounts[bd] = (dayCounts[bd] || 0) + 1;
    const items = parseInt(t['Items Accepted']);
    if (!isNaN(items)) totalItems += items;
    const w = parseFloat(t['Weight']);
    if (!isNaN(w)) totalWeight += w;
    if (SPECIAL_DESTS.has((t['USA Dest'] || '').toUpperCase())) specialDestTrips++;
    if ((t.originalStatus || '').toLowerCase().includes('pending')) {
      readyToProcess += items || 0;
    }
  });

  const totalTrips = list.length;

  if (kpiContainer) {
    kpiContainer.innerHTML = '';
    const bottomKpis = [
      ['Total Trips', totalTrips],
      ['Total Items', totalItems],
      ['Total Weight', totalWeight.toFixed(2)],
      ['Special Dest Trips', specialDestTrips],
      ['Ready to Process Items', readyToProcess]
    ];
    bottomKpis.forEach(([label, value]) => {
      const card = document.createElement('div');
      card.className = 'kpi-card';
      card.innerHTML = `<h3>${label}</h3><p>${value}</p>`;
      kpiContainer.appendChild(card);
    });
  }

  if (statusCanvas) {
    const statusCtx = statusCanvas.getContext('2d');
    if (statusChart) statusChart.destroy();
    statusChart = new Chart(statusCtx, {
      type: 'doughnut',
      data: {
        labels: Object.keys(statusCounts),
        datasets: [{
          data: Object.values(statusCounts),
          backgroundColor: ['#6A00FF','#f28e2c','#e15759','#76b7b2','#59a14f','#edc949','#af7aa1']
        }]
      }
    });
  }

  if (dailyCanvas) {
    const dailyCtx = dailyCanvas.getContext('2d');
    if (dailyChart) dailyChart.destroy();
    dailyChart = new Chart(dailyCtx, {
      type: 'bar',
      data: {
        labels: Object.keys(dayCounts),
        datasets: [{
          label: '# of Trips',
          data: Object.values(dayCounts),
          backgroundColor: '#6A00FF'
        }]
      }
    });
  }

  if (metricCanvas) {
    const metricCtx = metricCanvas.getContext('2d');
    if (metricChart) metricChart.destroy();
    metricChart = new Chart(metricCtx, {
      type: 'line',
      data: {
        labels: Object.keys(dayCounts),
        datasets: [{
          label: 'Trips per Day',
          data: Object.values(dayCounts),
          borderColor: '#e15759',
          fill: false
        },{
          label: 'Items per Day',
          data: Object.keys(dayCounts).map(day => {
            return list
              .filter(t => t['Ship Bundle'] === day)
              .reduce((sum, t) => sum + (parseInt(t['Items Accepted']) || 0), 0);
          }),
          borderColor: '#59a14f',
          fill: false
        }]
      }
    });
  }
}
  });
}


