// app.js — with drag/drop highlight (bucket hover) support

const db = window.firebaseDb;
const firebaseRef = window.firebaseRef;
const firebaseSet = window.firebaseSet;
const firebaseOnValue = window.firebaseOnValue;

let trips = [];
let statusChart, dailyChart, metricChart;

const PIPELINE_STATUSES = [
  'Pending Verification',
  'TX Approved',
  'TA In Progress',
  'TA Completed',
  'Bundling In Progress',
  'Bundle Completed'
];

let currentFilteredList = [];
let activeBoardSearch = '';
let activeDrawerTripId = null;

const csvUpload = document.getElementById('csvUpload');
const tripTableBody = document.querySelector('#trip-table tbody');
const startDateInp = document.getElementById('startDate');
const endDateInp = document.getElementById('endDate');
const applyDateFilterBtn = document.getElementById('applyDateFilter');
const dateRangeButtons = document.querySelectorAll('#date-filter button[data-range]');
const boardSearchInput = document.getElementById('boardSearch');
const clearBoardSearchBtn = document.getElementById('clearBoardSearch');
const boardSummaryContainer = document.getElementById('board-summary');
const detailsDrawer = document.getElementById('detailsDrawer');
const detailsBackdrop = document.getElementById('detailsBackdrop');
const drawerStage = detailsDrawer ? detailsDrawer.querySelector('[data-drawer-stage]') : null;
const drawerTripTitle = detailsDrawer ? detailsDrawer.querySelector('[data-drawer-trip]') : null;
const drawerSubtitle = detailsDrawer ? detailsDrawer.querySelector('[data-drawer-subtitle]') : null;
const drawerBody = detailsDrawer ? detailsDrawer.querySelector('.details-body') : null;
const drawerCloseBtn = detailsDrawer ? detailsDrawer.querySelector('.drawer-close') : null;
const drawerStageButtons = detailsDrawer ? detailsDrawer.querySelectorAll('.stage-btn') : [];

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
@@ -105,100 +129,238 @@ if (csvUpload) {
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

if (boardSearchInput) {
  boardSearchInput.addEventListener('input', evt => {
    activeBoardSearch = evt.target.value.trim().toLowerCase();
    renderBuckets();
  });
}

if (clearBoardSearchBtn) {
  clearBoardSearchBtn.addEventListener('click', () => {
    if (!activeBoardSearch) return;
    activeBoardSearch = '';
    if (boardSearchInput) {
      boardSearchInput.value = '';
    }
    renderBuckets();
  });
}

if (drawerCloseBtn) {
  drawerCloseBtn.addEventListener('click', () => {
    closeTripDetails();
  });
}

if (detailsBackdrop) {
  detailsBackdrop.addEventListener('click', () => {
    closeTripDetails();
  });
}

if (detailsDrawer) {
  document.addEventListener('keydown', evt => {
    if (evt.key === 'Escape') {
      closeTripDetails();
    }
  });
}

drawerStageButtons.forEach(btn => {
  btn.addEventListener('click', handleStageButtonClick);
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

function closeTripDetails() {
  if (!detailsDrawer) return;
  detailsDrawer.classList.remove('open');
  detailsDrawer.setAttribute('aria-hidden', 'true');
  if (detailsBackdrop) {
    detailsBackdrop.classList.remove('visible');
  }
  document.body.classList.remove('drawer-open');
  activeDrawerTripId = null;
}

function updateDrawerStageButtons(trip) {
  if (!detailsDrawer) return;
  const currentStage = trip.boardStatus || 'Pending Verification';
  const idx = PIPELINE_STATUSES.indexOf(currentStage);
  drawerStageButtons.forEach(btn => {
    const action = btn.dataset.action;
    if (action === 'prev-stage') {
      btn.disabled = idx <= 0;
    } else if (action === 'next-stage') {
      btn.disabled = idx === PIPELINE_STATUSES.length - 1;
    }
  });
}

function openTripDetails(trip) {
  if (!detailsDrawer) return;
  activeDrawerTripId = String(trip['Trip ID'] ?? '');
  const stage = trip.boardStatus || 'Pending Verification';
  if (drawerStage) {
    drawerStage.textContent = stage;
  }
  if (drawerTripTitle) {
    drawerTripTitle.textContent = `Trip ${trip['Trip ID'] || '—'}`;
  }
  if (drawerSubtitle) {
    const traveler = trip['Traveler'] || 'No traveler assigned';
    const dest = trip['USA Dest'] || 'Destination TBD';
    const ship = trip['Ship Bundle'] || 'Ship date TBD';
    drawerSubtitle.textContent = `${traveler} • ${dest} • ${ship}`;
  }
  if (drawerBody) {
    const infoRows = [
      ['Trip ID', trip['Trip ID']],
      ['Traveler', trip['Traveler']],
      ['USA Destination', trip['USA Dest']],
      ['Ship Bundle', trip['Ship Bundle']],
      ['Max USA Date', trip['Max USA Date']],
      ['Original Status', trip.originalStatus],
      ['Current Stage', stage],
      ['Items Accepted', trip['Items Accepted']],
      ['Weight', trip['Weight']],
      ['Assigned To', trip.assignedTo || 'Unassigned'],
      ['Notes', trip['Notes'] || trip['Internal Notes'] || '—']
    ];
    drawerBody.innerHTML = infoRows.map(([label, value]) => {
      const safeValue = value !== undefined && value !== '' ? value : '—';
      return `
        <div class="detail-row">
          <span class="label">${label}</span>
          <span class="value">${safeValue}</span>
        </div>
      `;
    }).join('');
  }
  updateDrawerStageButtons(trip);
  detailsDrawer.classList.add('open');
  detailsDrawer.setAttribute('aria-hidden', 'false');
  if (detailsBackdrop) {
    detailsBackdrop.classList.add('visible');
  }
  document.body.classList.add('drawer-open');
}

function handleStageButtonClick(evt) {
  const action = evt.currentTarget.dataset.action;
  if (!activeDrawerTripId) return;
  const trip = trips.find(t => String(t['Trip ID']) === String(activeDrawerTripId));
  if (!trip) return;
  const currentStage = trip.boardStatus || 'Pending Verification';
  let idx = PIPELINE_STATUSES.indexOf(currentStage);
  if (idx === -1) idx = 0;
  if (action === 'prev-stage' && idx > 0) {
    idx -= 1;
  } else if (action === 'next-stage' && idx < PIPELINE_STATUSES.length - 1) {
    idx += 1;
  }
  const nextStage = PIPELINE_STATUSES[idx];
  trip.boardStatus = nextStage;
  uploadTripsToFirebase(trips);
  renderBuckets();
  renderChartsAndKPIs(currentFilteredList.length ? currentFilteredList : trips);
  openTripDetails(trip);
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
  currentFilteredList = filtered;
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
@@ -230,136 +392,281 @@ function renderTripTable(list) {
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

function renderBoardSummary(list = currentFilteredList.length ? currentFilteredList : trips) {
  if (!boardSummaryContainer) return;
  const activeList = Array.isArray(list) ? list : [];
  let totalItems = 0;
  let totalWeight = 0;
  let ambassadors = 0;
  let readyToProcess = 0;

  activeList.forEach(trip => {
    const items = parseInt(trip['Items Accepted'], 10);
    const weight = parseFloat(trip['Weight']);
    if (Number.isFinite(items)) totalItems += items;
    if (Number.isFinite(weight)) totalWeight += weight;
    for (const nm of SPECIAL_NAMES) {
      if ((trip['Traveler'] || '').includes(nm)) {
        ambassadors += 1;
        break;
      }
    }
    if ((trip.originalStatus || '').toLowerCase().includes('pending')) {
      readyToProcess += Number.isFinite(items) ? items : 0;
    }
  });

  if (!activeList.length) {
    const message = activeBoardSearch
      ? 'No trips match your search'
      : 'No trips in pipeline';
    boardSummaryContainer.innerHTML = `
      <div class="summary-pill empty-pill">
        <span class="label">Pipeline</span>
        <span class="value">${message}</span>
      </div>
    `;
    return;
  }

  const weightDisplay = totalWeight ? totalWeight.toFixed(1) : '0';

  const summaryItems = [
    ['Trips in Pipeline', activeList.length],
    ['Total Items Accepted', totalItems],
    ['Total Weight', `${weightDisplay} lbs`],
    ['Ambassador Trips', ambassadors],
    ['Ready to Process Items', readyToProcess]
  ];

  boardSummaryContainer.innerHTML = summaryItems.map(([label, value]) => `
    <div class="summary-pill">
      <span class="label">${label}</span>
      <span class="value">${value}</span>
    </div>
  `).join('');
}

function renderBuckets(list = currentFilteredList.length ? currentFilteredList : trips) {
  const bucketEls = document.querySelectorAll('.bucket');
  if (!bucketEls.length) return;

  const baseList = Array.isArray(list) ? list : trips;
  const boardList = activeBoardSearch
    ? baseList.filter(trip => {
        const term = activeBoardSearch;
        const fields = [
          trip['Trip ID'],
          trip['Traveler'],
          trip['USA Dest'],
          trip.boardStatus,
          trip.originalStatus
        ].map(val => String(val || '').toLowerCase());
        return fields.some(val => val.includes(term));
      })
    : baseList;

  const stageMetrics = new Map();

  bucketEls.forEach(bucket => {
    const listEl = bucket.querySelector('.bucket-list');
    if (listEl) {
      listEl.innerHTML = '';
      listEl.classList.remove('is-empty', 'drag-over');
    }
  });

  boardList.forEach(trip => {
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

    const itemsVal = parseInt(trip['Items Accepted'], 10);
    const weightVal = parseFloat(trip['Weight']);
    const itemsText = Number.isFinite(itemsVal)
      ? `${itemsVal} ${itemsVal === 1 ? 'item' : 'items'}`
      : 'No items';
    const travelerName = trip['Traveler'] || 'Unknown traveler';
    const destination = trip['USA Dest'] || 'Destination TBD';
    const shipDate = trip['Ship Bundle'] ? `Ship ${trip['Ship Bundle']}` : 'Ship date TBD';

    card.innerHTML = `
      <div class="card-header">
        <span class="card-id">#${trip['Trip ID'] || '—'}</span>
        <span class="card-items">${itemsText}</span>
      </div>
      <div class="card-body">
        <strong>${travelerName}</strong>
        <span>${destination}</span>
        <span class="card-meta">${shipDate}</span>
      </div>
      <div class="card-footer">
        <span class="assign-label">Owner</span>
        <select class="assign-select">${opts}</select>
      </div>
    `;
    const sel = card.querySelector('.assign-select');
    sel.value = trip.assignedTo || '';
    sel.addEventListener('mousedown', e => e.stopPropagation());
    sel.addEventListener('touchstart', e => e.stopPropagation());
    sel.addEventListener('click', e => e.stopPropagation());
    sel.addEventListener('change', e => {
      trip.assignedTo = e.target.value;
      uploadTripsToFirebase(trips);
      if (activeDrawerTripId && String(activeDrawerTripId) === String(trip['Trip ID'])) {
        openTripDetails(trip);
      }
    });

    card.addEventListener('click', () => {
      openTripDetails(trip);
    });

    const boardStatus = trip.boardStatus || 'Pending Verification';
    const bucketList = document.querySelector(`.bucket[data-status="${boardStatus}"] .bucket-list`);
    if (bucketList) {
      bucketList.appendChild(card);
    } else {
      const fallback = document.querySelector(`.bucket[data-status="Pending Verification"] .bucket-list`);
      if (fallback) fallback.appendChild(card);
    }

    const metrics = stageMetrics.get(boardStatus) || { count: 0, items: 0, weight: 0 };
    metrics.count += 1;
    if (Number.isFinite(itemsVal)) metrics.items += itemsVal;
    if (Number.isFinite(weightVal)) metrics.weight += weightVal;
    stageMetrics.set(boardStatus, metrics);
  });

  bucketEls.forEach(bucket => {
    const status = bucket.dataset.status;
    const metrics = stageMetrics.get(status) || { count: 0, items: 0, weight: 0 };
    const countEl = bucket.querySelector('[data-stage-count]');
    if (countEl) {
      countEl.textContent = `${metrics.count} ${metrics.count === 1 ? 'Trip' : 'Trips'}`;
    }
    const itemsEl = bucket.querySelector('[data-stage-items]');
    if (itemsEl) {
      const itemsLabel = `${metrics.items} ${metrics.items === 1 ? 'Item' : 'Items'}`;
      itemsEl.textContent = itemsLabel;
    }
    const weightEl = bucket.querySelector('[data-stage-weight]');
    if (weightEl) {
      const weightText = metrics.weight ? metrics.weight.toFixed(1) : '0';
      weightEl.textContent = `${weightText} lbs`;
    }
    const listEl = bucket.querySelector('.bucket-list');
    if (listEl && !listEl.children.length) {
      listEl.classList.add('is-empty');
    }
  });

  renderBoardSummary(boardList);
  initDragAndDrop();
}

function initDragAndDrop() {
  const lists = document.querySelectorAll('.bucket-list');
  if (!lists.length) return;
  lists.forEach(list => {
    if (list.dataset.sortableInitialized === 'true') return;
    list.dataset.sortableInitialized = 'true';
    new Sortable(list, {
      group: {
        name: 'shared',
        pull: true,
        put: true
      },
      animation: 150,
      onMove(evt) {
        document.querySelectorAll('.bucket-list').forEach(l => {
          if (l !== evt.to) {
            l.classList.remove('drag-over');
          }
        });
        evt.to.classList.add('drag-over');
      },
      onEnd(evt) {
        document.querySelectorAll('.bucket-list').forEach(l => l.classList.remove('drag-over'));
        const card = evt.item;
        const newBucket = evt.to.closest('.bucket');
        const newStatus = newBucket.dataset.status;
        const tripId = card.dataset.tripId;
        const trip = trips.find(t => String(t['Trip ID']) === String(tripId));
        if (trip) {
          trip.boardStatus = newStatus;
          uploadTripsToFirebase(trips);
          setTimeout(() => {
            renderChartsAndKPIs(currentFilteredList.length ? currentFilteredList : trips);
            renderBuckets();
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


