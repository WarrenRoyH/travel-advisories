/**
 * TRAVEL ADVISORIES // TACTICAL GLOBAL MONITOR
 * Core Frontend Application
 * Vector Mapping, Tactical Telemetry, 24H Delta Tracking, and Target Dossiers
 */

(function () {
  'use strict';

  // Application State
  const state = {
    advisories: {},
    summary: {},
    changes: {},
    atlas: null,
    features: [],
    countryMap: new Map(), // keyed by alpha3 and numeric ISO
    selectedIso: null,
    activeFilter: 'all',
    svg: null,
    g: null,
    projection: null,
    pathGenerator: null,
    zoomBehavior: null,
    width: 0,
    height: 0
  };

  // Level Visual Encoding
  const LEVEL_STYLES = {
    4: { fill: '#5c1414', stroke: '#ef4444', text: 'LEVEL 4 // DO NOT TRAVEL', color: '#ef4444' },
    3: { fill: '#5a270f', stroke: '#f97316', text: 'LEVEL 3 // RECONSIDER TRAVEL', color: '#f97316' },
    2: { fill: '#4d3a08', stroke: '#eab308', text: 'LEVEL 2 // EXERCISE CAUTION', color: '#eab308' },
    1: { fill: '#0d3829', stroke: '#10b981', text: 'LEVEL 1 // NORMAL PRECAUTIONS', color: '#10b981' },
    0: { fill: '#0c2b42', stroke: '#38bdf8', text: 'DOMESTIC BASE // SECURE', color: '#38bdf8' },
    unassigned: { fill: '#141a22', stroke: '#25303d', text: 'UNCLASSIFIED / NO ADVISORY', color: '#8b949e' }
  };

  // DOM Elements
  const el = {
    mapContainer: document.getElementById('map-container'),
    mapLoading: document.getElementById('map-loading'),
    utcClock: document.getElementById('utc-clock'),
    coordsDisplay: document.getElementById('coords-display'),
    lastSyncTime: document.getElementById('last-sync-time'),
    deltaBadge: document.getElementById('delta-badge'),
    btnToggleSitrep: document.getElementById('btn-toggle-sitrep'),
    btnResetMap: document.getElementById('btn-reset-map'),
    countrySearch: document.getElementById('country-search'),
    searchResults: document.getElementById('search-results'),
    tooltip: document.getElementById('tactical-tooltip'),
    dossierDrawer: document.getElementById('dossier-drawer'),
    closeDossier: document.getElementById('close-dossier'),
    sitrepDrawer: document.getElementById('sitrep-drawer'),
    closeSitrep: document.getElementById('close-sitrep'),
    filterButtons: document.querySelectorAll('.filter-btn'),
    zoomInBtn: document.getElementById('zoom-in'),
    zoomOutBtn: document.getElementById('zoom-out'),
    zoomResetBtn: document.getElementById('zoom-reset'),
    
    // Dossier fields
    dossierName: document.getElementById('dossier-name'),
    dossierIso: document.getElementById('dossier-iso'),
    dossierLevelBadge: document.getElementById('dossier-level-badge'),
    dossierDate: document.getElementById('dossier-date'),
    dossierDeltaStatus: document.getElementById('dossier-delta-status'),
    dossierTags: document.getElementById('dossier-tags'),
    dossierSummary: document.getElementById('dossier-summary'),
    dossierSubregionsContainer: document.getElementById('dossier-subregions-container'),
    dossierSubregionsList: document.getElementById('dossier-subregions-list'),
    dossierHistoryContainer: document.getElementById('dossier-history-container'),
    dossierHistoryList: document.getElementById('dossier-history-list'),
    dossierOfficialLink: document.getElementById('dossier-official-link'),
    dossierCenterBtn: document.getElementById('dossier-center-btn'),

    // SITREP fields
    sitrep24hCount: document.getElementById('sitrep-24h-count'),
    sitrepTotalTracked: document.getElementById('sitrep-total-tracked'),
    sitrep24hBanner: document.getElementById('sitrep-24h-banner'),
    sitrepBannerText: document.getElementById('sitrep-banner-text'),
    sitrep24hList: document.getElementById('sitrep-24h-list'),
    sitrepRecentList: document.getElementById('sitrep-recent-list'),

    // Counters
    cntAll: document.getElementById('cnt-all'),
    cntL4: document.getElementById('cnt-l4'),
    cntL3: document.getElementById('cnt-l3'),
    cntL2: document.getElementById('cnt-l2'),
    cntL1: document.getElementById('cnt-l1'),
    cntShifts: document.getElementById('cnt-shifts')
  };

  /**
   * Initialize Clock
   */
  function startUtcClock() {
    function update() {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
      const dateStr = `${pad(now.getUTCDate())}-${months[now.getUTCMonth()]}-${now.getUTCFullYear()}`;
      const timeStr = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())} UTC`;
      el.utcClock.textContent = `${dateStr} ${timeStr}`;
    }
    update();
    setInterval(update, 1000);
  }

  /**
   * Fetch All Data Assets in Parallel
   */
  async function loadData() {
    try {
      async function safeFetchJson(url) {
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} retrieving ${url}`);
        }
        return await res.json();
      }

      // Fetch primary assets
      const [advisoriesData, summaryData, changesData, atlasData] = await Promise.all([
        safeFetchJson('data/advisories.json'),
        safeFetchJson('data/summary.json'),
        safeFetchJson('data/changes.json'),
        safeFetchJson('data/countries-50m.json')
      ]);

      state.advisories = advisoriesData.countries || {};
      state.summary = summaryData;
      state.changes = changesData;
      state.atlas = atlasData;

      // Optional ISO mapping table with graceful fallback
      let isoMapping = {};
      try {
        const isoRes = await fetch('data/iso_mapping.json');
        if (isoRes.ok) {
          isoMapping = await isoRes.json();
        }
      } catch (e) {
        console.warn('Optional ISO mapping table fallback to embedded records:', e);
      }

      // Build cross-reference dictionary
      buildCrossReference(isoMapping);
      populateSummaryUI();
      populateSitrepDrawer();

      // Render Map
      renderMap();

      // Remove loading overlay
      el.mapLoading.style.opacity = '0';
      setTimeout(() => el.mapLoading.remove(), 400);

    } catch (err) {
      console.error('Data initialization failure:', err);
      el.mapLoading.innerHTML = `
        <div style="color: #ef4444; font-weight: 700; letter-spacing: 1px;">
          CRITICAL ERROR: FAILED TO INGEST ADVISORY TELEMETRY
        </div>
        <div style="color: #8b949e; font-size: 11px; margin-top: 6px;">${err.message}</div>
      `;
    }
  }

  /**
   * Cross-reference Atlas geometry IDs with Advisory ISO Codes
   */
  function buildCrossReference(isoMapping) {
    const numToAlpha3 = new Map();

    // 1. Ingest standalone ISO table if present
    if (isoMapping && typeof isoMapping === 'object') {
      Object.entries(isoMapping).forEach(([num, meta]) => {
        if (meta && meta.alpha3) {
          numToAlpha3.set(num, meta.alpha3);
          numToAlpha3.set(String(parseInt(num, 10)), meta.alpha3);
        }
      });
    }

    // 2. Ingest directly from advisory dataset as guaranteed fallback
    Object.values(state.advisories).forEach((adv) => {
      if (adv && adv.iso_num && adv.iso_3) {
        const rawNum = String(adv.iso_num);
        numToAlpha3.set(rawNum, adv.iso_3);
        numToAlpha3.set(String(parseInt(rawNum, 10)), adv.iso_3);
      }
    });

    // Special territorial mappings
    const overrides = {
      '840': 'USA', // USA
      '275': 'PSE', // Palestine -> Gaza/West Bank
      '732': 'ESH', // Western Sahara
      'Somalia': 'SOM'
    };

    // Extract TopoJSON features
    state.features = topojson.feature(state.atlas, state.atlas.objects.countries).features;

    state.features.forEach((feat) => {
      const rawId = String(feat.id || '');
      const padId = rawId.padStart(3, '0');
      const countryName = feat.properties ? feat.properties.name : '';

      let alpha3 = overrides[rawId] || overrides[countryName] || numToAlpha3.get(padId) || numToAlpha3.get(rawId);

      // If still not matched, test by name
      if (!alpha3 && countryName) {
        for (const [key, c] of Object.entries(state.advisories)) {
          if (c.name.toLowerCase() === countryName.toLowerCase()) {
            alpha3 = c.iso_3;
            break;
          }
        }
      }

      feat.properties.alpha3 = alpha3;
      const advisory = alpha3 ? state.advisories[alpha3] : null;
      feat.properties.advisory = advisory;

      if (alpha3) {
        state.countryMap.set(alpha3, feat);
      }
    });
  }

  /**
   * Populate Header & Summary Stats
   */
  function populateSummaryUI() {
    const counts = state.summary.counts || {};
    el.cntAll.textContent = state.summary.total_countries || '-';
    el.cntL4.textContent = counts['4'] || 0;
    el.cntL3.textContent = counts['3'] || 0;
    el.cntL2.textContent = counts['2'] || 0;
    el.cntL1.textContent = counts['1'] || 0;
    el.cntShifts.textContent = state.changes.recent_changes ? state.changes.recent_changes.length : 0;

    const delta24h = state.summary.recent_24h_deltas || 0;
    el.deltaBadge.textContent = delta24h;
    if (delta24h > 0) {
      el.deltaBadge.classList.add('active');
    }

    if (state.summary.generated_at) {
      const d = new Date(state.summary.generated_at);
      el.lastSyncTime.textContent = d.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
    }
  }

  /**
   * Populate 24-Hour SITREP Drawer
   */
  function populateSitrepDrawer() {
    const changes24h = state.changes.changes_24h || [];
    const recent = state.changes.recent_changes || [];

    el.sitrep24hCount.textContent = changes24h.length;
    el.sitrepTotalTracked.textContent = state.summary.total_countries || 248;

    if (changes24h.length > 0) {
      el.sitrep24hBanner.className = 'sitrep-banner alert';
      el.sitrepBannerText.textContent = `ALERT: ${changes24h.length} ADVISORY DELTA(S) DETECTED IN THE LAST 24 HOURS.`;
      
      el.sitrep24hList.innerHTML = '';
      changes24h.forEach((item) => {
        el.sitrep24hList.appendChild(createDeltaCard(item));
      });
    } else {
      el.sitrep24hBanner.className = 'sitrep-banner steady';
      el.sitrepBannerText.textContent = 'STATUS STEADY: No advisory deltas detected in the last 24 hours. Global sectors homogeneous.';
      el.sitrep24hList.innerHTML = '<div class="empty-feed">NO ADVISORY DELTAS DETECTED IN PREVIOUS 24 HOURS. STATUS HOMOGENEOUS.</div>';
    }

    // Populate Recent Historical Changes
    el.sitrepRecentList.innerHTML = '';
    recent.forEach((item) => {
      el.sitrepRecentList.appendChild(createDeltaCard(item));
    });
  }

  function createDeltaCard(item) {
    const card = document.createElement('div');
    const urgencyClass = (item.urgency || 'low').toLowerCase();
    card.className = `delta-card ${urgencyClass}`;

    const dateStr = item.date || (item.timestamp ? item.timestamp.substring(0, 10) : 'RECENT');
    const isoBadge = item.iso_3 ? `[${item.iso_3}]` : '';

    card.innerHTML = `
      <div class="delta-header">
        <span class="delta-country">${item.country} ${isoBadge}</span>
        <span class="delta-date">${dateStr}</span>
      </div>
      <div class="delta-headline">${item.headline || 'STATUS REVISION'}</div>
      <div class="delta-summary">${item.summary || ''}</div>
      <div class="delta-actions">
        <button class="delta-locate-btn" data-iso="${item.iso_3}">[LOCATE ON MAP →]</button>
      </div>
    `;

    card.querySelector('.delta-locate-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      if (item.iso_3) {
        focusCountry(item.iso_3);
      }
    });

    card.addEventListener('click', () => {
      if (item.iso_3) {
        focusCountry(item.iso_3);
      }
    });

    return card;
  }

  /**
   * Render D3 Vector World Map
   */
  function renderMap() {
    const rect = el.mapContainer.getBoundingClientRect();
    state.width = rect.width;
    state.height = rect.height;

    // Projection: Natural Earth 1
    state.projection = d3.geoNaturalEarth1()
      .scale(state.width / 5.5)
      .translate([state.width / 2, state.height / 1.85]);

    state.pathGenerator = d3.geoPath().projection(state.projection);

    // Create SVG
    state.svg = d3.select('#map-container')
      .append('svg')
      .attr('width', state.width)
      .attr('height', state.height)
      .attr('class', 'tactical-map-svg');

    // Layer Group
    state.g = state.svg.append('g');

    // Sphere (Ocean)
    state.g.append('path')
      .datum({ type: 'Sphere' })
      .attr('class', 'sphere')
      .attr('d', state.pathGenerator);

    // Graticules (Latitude & Longitude grid lines)
    const graticule = d3.geoGraticule10();
    state.g.append('path')
      .datum(graticule)
      .attr('class', 'graticule')
      .attr('d', state.pathGenerator);

    // Render Country Paths
    state.g.selectAll('.country-path')
      .data(state.features)
      .enter()
      .append('path')
      .attr('class', 'country-path')
      .attr('d', state.pathGenerator)
      .attr('data-iso', (d) => d.properties.alpha3 || '')
      .style('fill', (d) => getCountryColor(d).fill)
      .style('stroke', (d) => getCountryColor(d).stroke)
      .on('mouseenter', onCountryEnter)
      .on('mousemove', onCountryMove)
      .on('mouseleave', onCountryLeave)
      .on('click', onCountryClick);

    // Setup Zoom Behavior
    state.zoomBehavior = d3.zoom()
      .scaleExtent([1, 14])
      .on('zoom', (event) => {
        state.g.attr('transform', event.transform);
      });

    state.svg.call(state.zoomBehavior);

    // Setup Cursor Coordinate Telemetry
    state.svg.on('mousemove', onMapMouseMove);

    // Handle Window Resize
    window.addEventListener('resize', debounce(handleResize, 150));
  }

  function getCountryColor(feat) {
    const adv = feat.properties.advisory;
    if (!adv) {
      if (feat.properties.alpha3 === 'USA') return LEVEL_STYLES[0];
      return LEVEL_STYLES.unassigned;
    }
    const lvl = adv.level;
    return LEVEL_STYLES[lvl] || LEVEL_STYLES.unassigned;
  }

  /**
   * Coordinates Telemetry Display
   */
  function onMapMouseMove(event) {
    if (!state.projection) return;
    const [mx, my] = d3.pointer(event, state.svg.node());
    const transform = d3.zoomTransform(state.svg.node());
    const [invertedX, invertedY] = transform.invert([mx, my]);
    const coords = state.projection.invert([invertedX, invertedY]);

    if (coords && !isNaN(coords[0]) && !isNaN(coords[1])) {
      const lon = coords[0];
      const lat = coords[1];
      const latDir = lat >= 0 ? 'N' : 'S';
      const lonDir = lon >= 0 ? 'E' : 'W';
      el.coordsDisplay.textContent = `LAT: ${Math.abs(lat).toFixed(2)}° ${latDir} | LON: ${Math.abs(lon).toFixed(2)}° ${lonDir}`;
    }
  }

  /**
   * Hover Interactions
   */
  function onCountryEnter(event, d) {
    const adv = d.properties.advisory;
    const name = (adv ? adv.name : (d.properties ? d.properties.name : 'Unknown')).toUpperCase();
    const iso = d.properties.alpha3 || '---';

    document.getElementById('tt-country').textContent = name;
    document.getElementById('tt-iso').textContent = `[${iso}]`;

    const badge = document.getElementById('tt-level-badge');
    const statusVal = document.getElementById('tt-status');
    const dateVal = document.getElementById('tt-date');
    const deltaRow = document.getElementById('tt-delta-row');

    if (adv) {
      const style = LEVEL_STYLES[adv.level] || LEVEL_STYLES.unassigned;
      badge.textContent = style.text;
      badge.style.background = style.fill;
      badge.style.color = style.color;
      badge.style.border = `1px solid ${style.stroke}`;

      statusVal.textContent = adv.level_meta ? adv.level_meta.badge : 'ACTIVE';
      dateVal.textContent = adv.adv_date || 'N/A';

      if (adv.has_24h_delta || adv.has_recent_delta) {
        deltaRow.classList.remove('hidden');
        document.getElementById('tt-delta').textContent = adv.has_24h_delta ? '24H DELTA SHIFT' : 'RECENT SHIFT';
      } else {
        deltaRow.classList.add('hidden');
      }
    } else {
      badge.textContent = 'NO ADVISORY / UNCLASSIFIED';
      badge.style.background = '#1e252e';
      badge.style.color = '#8b949e';
      badge.style.border = '1px solid #2e3c4f';
      statusVal.textContent = 'UNTRACKED';
      dateVal.textContent = '---';
      deltaRow.classList.add('hidden');
    }

    el.tooltip.classList.remove('hidden');
  }

  function onCountryMove(event) {
    const x = event.clientX;
    const y = event.clientY;
    el.tooltip.style.left = `${x}px`;
    el.tooltip.style.top = `${y}px`;
  }

  function onCountryLeave() {
    el.tooltip.classList.add('hidden');
  }

  /**
   * Click Interaction -> Open Target Dossier
   */
  function onCountryClick(event, d) {
    event.stopPropagation();
    const iso = d.properties.alpha3;
    if (iso) {
      openDossier(iso);
    }
  }

  /**
   * Open Target Intel Dossier
   */
  function openDossier(iso) {
    const feat = state.countryMap.get(iso);
    const adv = state.advisories[iso];
    state.selectedIso = iso;

    // Highlight country path on map
    state.g.selectAll('.country-path').classed('selected', false);
    if (feat) {
      state.g.selectAll(`.country-path[data-iso="${iso}"]`).classed('selected', true);
    }

    const countryName = adv ? adv.name : (feat ? feat.properties.name : iso);
    el.dossierName.textContent = countryName.toUpperCase();
    el.dossierIso.textContent = `ISO3: ${iso}`;

    if (adv) {
      const style = LEVEL_STYLES[adv.level] || LEVEL_STYLES.unassigned;
      el.dossierLevelBadge.textContent = style.text;
      el.dossierLevelBadge.style.background = style.fill;
      el.dossierLevelBadge.style.color = style.color;
      el.dossierLevelBadge.style.borderLeft = `4px solid ${style.stroke}`;

      el.dossierDate.textContent = adv.adv_date || 'N/A';
      
      if (adv.has_24h_delta) {
        el.dossierDeltaStatus.textContent = 'ALERT: 24H DELTA';
        el.dossierDeltaStatus.style.color = '#ef4444';
      } else if (adv.has_recent_delta) {
        el.dossierDeltaStatus.textContent = 'RECENT SHIFT';
        el.dossierDeltaStatus.style.color = '#f97316';
      } else {
        el.dossierDeltaStatus.textContent = 'STEADY (NO DELTA)';
        el.dossierDeltaStatus.style.color = '#10b981';
      }

      // Threat Indicator Tags
      el.dossierTags.innerHTML = '';
      const tags = adv.indicators || [];
      tags.forEach((tag) => {
        const span = document.createElement('span');
        span.className = 'risk-tag';
        span.textContent = `[${tag}]`;
        el.dossierTags.appendChild(span);
      });

      // Briefing text
      el.dossierSummary.textContent = adv.summary || 'No detailed consular briefing on file.';

      // Sub-regions (e.g. Mexico)
      if (adv.sub_regions && adv.sub_regions.length > 0) {
        el.dossierSubregionsContainer.classList.remove('hidden');
        el.dossierSubregionsList.innerHTML = '';
        adv.sub_regions.forEach((sub) => {
          const div = document.createElement('div');
          const lvl = sub.level || 2;
          div.className = `subregion-card l${lvl}`;
          div.innerHTML = `
            <span>${sub.name}</span>
            <span style="font-weight:700;">L${lvl}</span>
          `;
          el.dossierSubregionsList.appendChild(div);
        });
      } else {
        el.dossierSubregionsContainer.classList.add('hidden');
      }

      // History audit trail
      if (adv.latest_delta) {
        el.dossierHistoryContainer.classList.remove('hidden');
        el.dossierHistoryList.innerHTML = `
          <div class="history-entry">
            <div class="history-entry-date">${adv.latest_delta.date || ''} // ${adv.latest_delta.urgency || 'AUDIT'}</div>
            <div>${adv.latest_delta.headline || ''}</div>
          </div>
        `;
      } else {
        el.dossierHistoryContainer.classList.add('hidden');
      }

      // Action link
      el.dossierOfficialLink.href = adv.url || 'https://travel.state.gov';
      el.dossierOfficialLink.style.display = 'flex';

    } else {
      // Unassigned country
      el.dossierLevelBadge.textContent = 'UNCLASSIFIED / NO SPECIAL ADVISORY';
      el.dossierLevelBadge.style.background = '#1e252e';
      el.dossierLevelBadge.style.color = '#8b949e';
      el.dossierLevelBadge.style.borderLeft = '4px solid #475a75';
      el.dossierDate.textContent = 'N/A';
      el.dossierDeltaStatus.textContent = 'STEADY';
      el.dossierDeltaStatus.style.color = '#8b949e';
      el.dossierTags.innerHTML = '<span class="risk-tag" style="color:#8b949e; border-color:#374151;">[STANDARD PREC.]</span>';
      el.dossierSummary.textContent = 'No specific threat advisory has been published for this jurisdiction. Follow standard global travel precautions.';
      el.dossierSubregionsContainer.classList.add('hidden');
      el.dossierHistoryContainer.classList.add('hidden');
      el.dossierOfficialLink.href = 'https://travel.state.gov';
    }

    // Open Drawer
    el.dossierDrawer.classList.remove('hidden');
    // Close Sitrep if open
    el.sitrepDrawer.classList.add('hidden');
  }

  /**
   * Focus / Zoom to Country
   */
  function focusCountry(iso) {
    openDossier(iso);
    const feat = state.countryMap.get(iso);
    if (!feat || !state.pathGenerator) return;

    const bounds = state.pathGenerator.bounds(feat);
    const dx = bounds[1][0] - bounds[0][0];
    const dy = bounds[1][1] - bounds[0][1];
    const x = (bounds[0][0] + bounds[1][0]) / 2;
    const y = (bounds[0][1] + bounds[1][1]) / 2;

    const scale = Math.max(1, Math.min(10, 0.85 / Math.max(dx / state.width, dy / state.height)));
    const translate = [state.width / 2 - scale * x, state.height / 2 - scale * y];

    state.svg.transition()
      .duration(850)
      .call(state.zoomBehavior.transform, d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale));
  }

  /**
   * Reset Map Zoom
   */
  function resetMapZoom() {
    state.svg.transition()
      .duration(750)
      .call(state.zoomBehavior.transform, d3.zoomIdentity);
    state.g.selectAll('.country-path').classed('selected', false);
    state.selectedIso = null;
  }

  /**
   * Threat Level Filtering
   */
  function applyFilter(level) {
    state.activeFilter = level;
    el.filterButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.level === level);
    });

    state.g.selectAll('.country-path').each(function (d) {
      const adv = d.properties.advisory;
      let visible = true;

      if (level === 'all') {
        visible = true;
      } else if (level === 'shifts') {
        const iso = d.properties.alpha3;
        visible = adv && (adv.has_24h_delta || adv.has_recent_delta);
      } else {
        const lvlNum = parseInt(level, 10);
        visible = adv && adv.level === lvlNum;
      }

      d3.select(this)
        .classed('dimmed', !visible)
        .style('pointer-events', visible ? 'all' : 'none');
    });
  }

  /**
   * Search / Auto-Complete
   */
  function setupSearch() {
    el.countrySearch.addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      if (!q) {
        el.searchResults.classList.add('hidden');
        return;
      }

      const matches = [];
      Object.entries(state.advisories).forEach(([iso, c]) => {
        if (c.name.toLowerCase().includes(q) || iso.toLowerCase().includes(q)) {
          matches.push(c);
        }
      });

      // Sort matches
      matches.sort((a, b) => (b.level || 0) - (a.level || 0));

      if (matches.length === 0) {
        el.searchResults.innerHTML = '<div class="search-item" style="color:#8b949e;">NO NATION FOUND</div>';
      } else {
        el.searchResults.innerHTML = '';
        matches.slice(0, 10).forEach((c) => {
          const div = document.createElement('div');
          div.className = 'search-item';
          const style = LEVEL_STYLES[c.level] || LEVEL_STYLES.unassigned;
          div.innerHTML = `
            <span>${c.name} [${c.iso_3}]</span>
            <span class="item-lvl" style="background:${style.fill}; color:${style.color}; border:1px solid ${style.stroke};">L${c.level}</span>
          `;
          div.addEventListener('click', () => {
            el.countrySearch.value = c.name;
            el.searchResults.classList.add('hidden');
            focusCountry(c.iso_3);
          });
          el.searchResults.appendChild(div);
        });
      }
      el.searchResults.classList.remove('hidden');
    });

    // Enter key selects first result
    el.countrySearch.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const first = el.searchResults.querySelector('.search-item');
        if (first) first.click();
      } else if (e.key === 'Escape') {
        el.searchResults.classList.add('hidden');
      }
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!el.countrySearch.contains(e.target) && !el.searchResults.contains(e.target)) {
        el.searchResults.classList.add('hidden');
      }
    });
  }

  /**
   * Resize Handler
   */
  function handleResize() {
    if (!state.svg || !state.projection) return;
    const rect = el.mapContainer.getBoundingClientRect();
    state.width = rect.width;
    state.height = rect.height;

    state.svg.attr('width', state.width).attr('height', state.height);
    state.projection
      .scale(state.width / 5.5)
      .translate([state.width / 2, state.height / 1.85]);

    state.g.select('.sphere').attr('d', state.pathGenerator);
    state.g.select('.graticule').attr('d', state.pathGenerator);
    state.g.selectAll('.country-path').attr('d', state.pathGenerator);
  }

  function debounce(fn, wait) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  /**
   * Wire UI Event Listeners
   */
  function setupEventListeners() {
    // 24H SITREP Drawer
    el.btnToggleSitrep.addEventListener('click', () => {
      el.sitrepDrawer.classList.toggle('hidden');
      el.dossierDrawer.classList.add('hidden');
    });
    el.closeSitrep.addEventListener('click', () => {
      el.sitrepDrawer.classList.add('hidden');
    });

    // Dossier Drawer
    el.closeDossier.addEventListener('click', () => {
      el.dossierDrawer.classList.add('hidden');
      state.g.selectAll('.country-path').classed('selected', false);
      state.selectedIso = null;
    });

    el.dossierCenterBtn.addEventListener('click', () => {
      if (state.selectedIso) {
        focusCountry(state.selectedIso);
      }
    });

    // Reset View
    el.btnResetMap.addEventListener('click', resetMapZoom);

    // Zoom Buttons
    el.zoomInBtn.addEventListener('click', () => {
      state.svg.transition().duration(300).call(state.zoomBehavior.scaleBy, 1.4);
    });
    el.zoomOutBtn.addEventListener('click', () => {
      state.svg.transition().duration(300).call(state.zoomBehavior.scaleBy, 0.7);
    });
    el.zoomResetBtn.addEventListener('click', resetMapZoom);

    // Filter Buttons
    el.filterButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        applyFilter(btn.dataset.level);
      });
    });

    // Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        el.dossierDrawer.classList.add('hidden');
        el.sitrepDrawer.classList.add('hidden');
        state.g.selectAll('.country-path').classed('selected', false);
      }
    });
  }

  /**
   * Application Bootstrapping
   */
  function init() {
    startUtcClock();
    setupEventListeners();
    setupSearch();
    loadData();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
