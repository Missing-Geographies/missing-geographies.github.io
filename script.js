/* ==========================================================
   MISSING GEOGRAPHIES — REPAIRED SCRIPT
   Cleaned on 2026-06-02: removed old/simple About overlay block;
   final About text is now placed in the actual dropdown About panel.
   ========================================================== */
/* ==========================================================
   PERFORMANCE GUARD — DISABLE HEAVY LATE PATCHES

   This must be near the TOP of script.js, before the old patch
   blocks execute.

   It disables the slow polling / whole-body observer layers.
   The replacement lightweight controller is pasted at the bottom.
   ========================================================== */

(function mgPerformanceGuardBeforeLatePatches() {
  window.__mgUnifiedMediaReadingControlsReady = true;
  window.__mgUnifiedMediaOrderLinkImageTextReady = true;
  window.__mgMediaPanelClickReliabilityReady = true;
  window.__mgFinalMediaClickHotspotsReady = true;
  window.__mgHardRightPanelTrueBilingualTextReady = true;
  window.__mgLargeSubmittedTextReaderReady = true;
  window.__mgFinalImageAboveTextAndReaderArrowReady = true;
})();
const PUBLIC_MAP_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQAcdTbKLCrgHendXrR3l8eXCP9lxl1isaaOitZRjVpERU6vW9-U3Umf_YPEybxz-01YBUuOxxQsUOT/pub?gid=0&single=true&output=csv";
/* Shared CSV cache: de-duplicates the two hydrate loops' identical sheet fetches. Time-windowed so it never serves data older than the existing hydrate freshness guards tolerate. */
window.__mgCsvCache = window.__mgCsvCache || { at: 0, rows: null, p: null };
window.__mgSharedCsv = function (url) {
   var now = Date.now(), c = window.__mgCsvCache;
   if (c.p && (now - c.at) < 4000) return c.p;
   c.at = now;
   c.p = d3.csv(url).then(function (r) { c.rows = r; return r; });
   return c.p;
};


/* ==========================================================
   SMART LOADING FOR SLOW INTERNET

   Goal:
   - Cache the world map and PublicMapData locally.
   - Avoid forcing a fresh spreadsheet download on every visit.
   - Show cached data quickly, then refresh gently in the background.
   - Detect low-bandwidth conditions and activate lightweight mode.
   - Keep ?clearStoryCache=1 working for testing.
   ========================================================== */

(function mgSmartLowBandwidthLoader() {
  if (window.__mgSmartLowBandwidthLoaderReady) {
    return;
  }

  window.__mgSmartLowBandwidthLoaderReady = true;

  const CACHE_VERSION = "v4";
  const WORLD_CACHE_KEY = `mg-world-atlas-${CACHE_VERSION}`;
  const STORIES_CACHE_KEY = `mg-public-map-rows-${CACHE_VERSION}`;

  const ONE_MINUTE = 60 * 1000;
  const ONE_HOUR = 60 * ONE_MINUTE;
  const ONE_DAY = 24 * ONE_HOUR;

  function getSearchParams() {
    try {
      return new URLSearchParams(window.location.search || "");
    } catch (error) {
      return new URLSearchParams("");
    }
  }

  function shouldForceFresh() {
    const params = getSearchParams();

    return (
      params.has("clearStoryCache") ||
      params.has("fresh") ||
      params.get("cache") === "clear"
    );
  }

  function wantsLiteMode() {
    const params = getSearchParams();

    if (
      params.has("lite") ||
      params.has("lowData") ||
      params.get("mode") === "lite"
    ) {
      return true;
    }

    const connection =
      navigator.connection ||
      navigator.mozConnection ||
      navigator.webkitConnection;

    if (!connection) {
      return false;
    }

    const effectiveType = String(connection.effectiveType || "").toLowerCase();

    return (
      connection.saveData === true ||
      effectiveType === "slow-2g" ||
      effectiveType === "2g" ||
      Number(connection.downlink || 99) <= 0.8
    );
  }

  function wantsLowPowerMode() {
    const memory = Number(navigator.deviceMemory || 8);
    const cores = Number(navigator.hardwareConcurrency || 8);

    return memory <= 2 || cores <= 2;
  }

  window.mgLowBandwidthMode = Boolean(
    wantsLiteMode() ||
    wantsLowPowerMode()
  );

  document.documentElement.classList.toggle(
    "mg-low-bandwidth-mode",
    window.mgLowBandwidthMode
  );

  if (shouldForceFresh()) {
    try {
      localStorage.removeItem(WORLD_CACHE_KEY);
      localStorage.removeItem(STORIES_CACHE_KEY);
    } catch (error) {}
  }

  function safeReadCache(key) {
    try {
      const raw = localStorage.getItem(key);

      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw);

      if (!parsed || !parsed.savedAt || !parsed.value) {
        return null;
      }

      return parsed;
    } catch (error) {
      return null;
    }
  }

  function safeWriteCache(key, value) {
    try {
      localStorage.setItem(
        key,
        JSON.stringify({
          savedAt: Date.now(),
          value
        })
      );
    } catch (error) {
      /* localStorage can fail in private mode or if full. */
    }
  }

  function cacheIsFresh(cacheEntry, maxAgeMs) {
    return Boolean(
      cacheEntry &&
      Number.isFinite(Number(cacheEntry.savedAt)) &&
      Date.now() - Number(cacheEntry.savedAt) <= maxAgeMs
    );
  }

  async function fetchJsonWithTimeout(url, timeoutMs) {
    const controller =
      typeof AbortController !== "undefined"
        ? new AbortController()
        : null;

    const timer = controller
      ? window.setTimeout(() => controller.abort(), timeoutMs)
      : null;

    try {
      const response = await fetch(url, {
        method: "GET",
        cache: "force-cache",
        signal: controller ? controller.signal : undefined
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.json();
    } finally {
      if (timer) {
        window.clearTimeout(timer);
      }
    }
  }

  async function fetchTextWithTimeout(url, timeoutMs) {
    const controller =
      typeof AbortController !== "undefined"
        ? new AbortController()
        : null;

    const timer = controller
      ? window.setTimeout(() => controller.abort(), timeoutMs)
      : null;

    try {
      const response = await fetch(url, {
        method: "GET",
        cache: "force-cache",
        signal: controller ? controller.signal : undefined
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.text();
    } finally {
      if (timer) {
        window.clearTimeout(timer);
      }
    }
  }

  function applyWorldAtlas(world) {
    if (!world || !world.objects || !world.objects.countries) {
      return false;
    }

    countries = topojson.feature(world, world.objects.countries).features;
    iranFeature = countries.find(isIranCountry);

    return true;
  }

  async function fetchWorldAtlasFresh() {
    const world = await fetchJsonWithTimeout(
      "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json",
      window.mgLowBandwidthMode ? 9000 : 6000
    );

    safeWriteCache(WORLD_CACHE_KEY, world);
    applyWorldAtlas(world);

    return world;
  }

  loadWorldShapes = async function loadWorldShapesSmartCached() {
    const cached = safeReadCache(WORLD_CACHE_KEY);

    if (cached && applyWorldAtlas(cached.value)) {
      if (!cacheIsFresh(cached, 30 * ONE_DAY)) {
        window.setTimeout(fetchWorldAtlasFresh, 1800);
      }

      return;
    }

    try {
      await fetchWorldAtlasFresh();
    } catch (error) {
      console.warn(
        "World map shapes did not load. The globe will still show points.",
        error
      );
    }
  };

  function storyCacheMaxAge() {
    if (shouldForceFresh()) {
      return 0;
    }

    return window.mgLowBandwidthMode
      ? 6 * ONE_HOUR
      : 20 * ONE_MINUTE;
  }

  function storyCsvUrl(forceFresh) {
    const maxAge = storyCacheMaxAge();

    if (forceFresh || shouldForceFresh() || !maxAge) {
      return `${PUBLIC_MAP_CSV_URL}&cacheBust=${Date.now()}`;
    }

    const revisionBucket = Math.floor(Date.now() / maxAge);

    return `${PUBLIC_MAP_CSV_URL}&mgRevision=${revisionBucket}`;
  }

  async function fetchStoryRowsFresh(forceFresh) {
    const text = await fetchTextWithTimeout(
      storyCsvUrl(forceFresh),
      window.mgLowBandwidthMode ? 11000 : 7500
    );

    const rows = d3.csvParse(text);

    safeWriteCache(STORIES_CACHE_KEY, rows);

    return rows;
  }

  function rowsToStories(rows) {
    const sheetStories = rows
      .map(rowToStory)
      .filter(story => story !== null);

    return sheetStories.length > 0 ? sheetStories : fallbackStories;
  }

  function refreshStoriesInBackground() {
    window.setTimeout(async () => {
      try {
        const rows = await fetchStoryRowsFresh(false);
        const nextStories = rowsToStories(rows);

        if (!nextStories.length) {
          return;
        }

        stories = nextStories;

        if (typeof createStoryButtons === "function") {
          createStoryButtons();
        }

        if (
          !activeStory &&
          !isJourneyAnimating &&
          typeof setupMemoryCloud === "function"
        ) {
          setupMemoryCloud();
        }

        if (typeof render === "function") {
          render();
        }
      } catch (error) {
        console.warn("Background story refresh failed.", error);
      }
    }, window.mgLowBandwidthMode ? 4500 : 1400);
  }

  loadStoriesFromSheet = async function loadStoriesFromSheetSmartCached() {
    const cached = safeReadCache(STORIES_CACHE_KEY);
    const maxAge = storyCacheMaxAge();

    if (
      cached &&
      cached.value &&
      (
        cacheIsFresh(cached, maxAge) ||
        window.mgLowBandwidthMode
      )
    ) {
      stories = rowsToStories(cached.value);

      if (!cacheIsFresh(cached, maxAge)) {
        refreshStoriesInBackground();
      }

      return;
    }

    try {
      const rows = await fetchStoryRowsFresh(shouldForceFresh());
      stories = rowsToStories(rows);
    } catch (error) {
      if (cached && cached.value) {
        stories = rowsToStories(cached.value);
        refreshStoriesInBackground();
        return;
      }

      console.warn("PublicMapData did not load. Using fallback stories.", error);
      stories = fallbackStories;
    }
  };

  window.mgClearLocalStoryCache = function mgClearLocalStoryCache() {
    try {
      localStorage.removeItem(WORLD_CACHE_KEY);
      localStorage.removeItem(STORIES_CACHE_KEY);
    } catch (error) {}

    window.location.href =
      window.location.pathname +
      "?clearStoryCache=1&v=" +
      Date.now();
  };
})();

const fallbackStories = [
  {
    id: "story-001",
    title: "Anonymous voice 01",
    person: "Anonymous",
    originCity: "Tehran",
    originCountry: "Iran",
    originCoords: [51.3890, 35.6892],
    destinationCity: "New York",
    destinationCountry: "United States",
    destinationCoords: [-74.0060, 40.7128],
    yearLeft: "2018",
    quote: "A short memory about a street, a room, or a future that still calls back.",
    audio: "assets/audio/story-001.wav",
    fileOrLink: "",
    locationPrivacy: "",
    contentLanguage: "",
    translationEn: "",
    transcriptFa: "",
    subtitleEn: "",
    translationStatus: "",
    subtitleCuesEn: ""
  }
];

/* =========================================================
   ART PASS 2 — MAP COLOR SYSTEM
   ========================================================= */

const ART_PASS_2 = {
  oceanFill: "#171819",
  oceanGlow: "rgba(255, 216, 130, 0.02)",
  landFill: "#30323a",
  landStroke: "rgba(201, 196, 182, 0.14)",
  countryStroke: "rgba(205, 199, 184, 0.11)",
  graticuleStroke: "rgba(206, 205, 198, 0.065)",
  globeRimStroke: "rgba(214, 210, 196, 0.09)",
  globeRimBlur: "rgba(255, 231, 171, 0.03)",
  iranStroke: "rgba(241, 214, 129, 0.92)",
  iranGlow: "rgba(255, 220, 140, 0.11)",
  pointFill: "#e7b56c",
  pointCore: "#f7d797",
  pointGlow: "rgba(243, 187, 96, 0.34)",
  routeStroke: "rgba(245, 205, 120, 0.88)",
  routeTail: "rgba(245, 205, 120, 0.14)",
  labelFill: "rgba(236, 225, 202, 0.42)",
  labelSubFill: "rgba(214, 198, 170, 0.22)"
};

let stories = [];

const svg = d3.select("#globe");
const width = 900;
const height = 620;
const audio = document.getElementById("story-audio");

const DEFAULT_ROTATION = [-42, -24, 0];
const DEFAULT_SCALE = 270;

const CALL_FOCUS_SCALE = 500;
const ROUTE_VIEW_SCALE = 355;
const IRAN_FIT_SCALE_FALLBACK = 1250;

const MIN_SCALE = 220;
const MAX_SCALE = 2200;

const CALL_COUNTRY_DURATION = 3800;
const TRAVEL_DURATION = 15500;
const LINE_ARRIVAL_HOLD_DURATION = 1350;
const LINE_FADE_DURATION = 1700;
const IRAN_ZOOM_DURATION = 7600;
const ARRIVAL_HOLD_DURATION = 500;

const BUZZ_VOLUME = 0.055;

const IRAN_CENTER_FALLBACK = [53.6880, 32.4279];
const IRAN_COUNTRY_ID = "364";

let currentScale = DEFAULT_SCALE;

const projection = d3.geoOrthographic()
  .scale(currentScale)
  .translate([width / 2, height / 2 + 16])
  .clipAngle(90)
  .precision(0.4)
  .rotate([...DEFAULT_ROTATION]);

const path = d3.geoPath(projection);
const graticule = d3.geoGraticule10();
const sphere = { type: "Sphere" };

let countries = null;
let iranFeature = null;
let activeStory = null;
let lineVisible = false;
let lineProgress = 0;
let lineOpacity = 1;
let journeyPhase = "idle";
let dragStart = null;

let journeyToken = 0;
let isJourneyAnimating = false;

let callCountryFeature = null;
let callCountryVisible = false;
let callCountryOpacity = 0;

let audioContext = null;
let buzzNodes = null;

let activeSubtitleCues = [];
let activeFallbackSubtitle = "";

let audioDockUpdate = null;

const memoryCloud = {
  front: null,
  back: null,
  items: [],
  raf: null,
  lastTime: null,
  resetController: null
};

const MEMORY_CLOUD_CONFIG = {
  speedMin: 8,
  speedMax: 16,
  launchDelayStep: 130,
  launchRandomDelay: 850,
  launchDistanceMin: 260,
  launchDistanceMax: 620,
  turnMinSeconds: 18,
  turnMaxSeconds: 44,
  depthMinSeconds: 24,
  depthMaxSeconds: 60,
  behindChance: 0.24,
  paddingX: 70,
  paddingY: 96,
  iranHaloRadius: 8
};

const baseGroup = svg.append("g").attr("class", "base-layer");
const iranGroup = svg.append("g").attr("class", "iran-layer");
const callCountryGroup = svg.append("g").attr("class", "call-country-layer");
const lineGroup = svg.append("g").attr("class", "line-layer");
const pointGroup = svg.append("g").attr("class", "point-layer");
const labelGroup = svg.append("g").attr("class", "label-layer");

baseGroup.append("path").attr("class", "sphere").datum(sphere);
baseGroup.append("path").attr("class", "graticule").datum(graticule);

initialize();

async function initialize() {
  ensureArchivalFieldOverlay();

  await Promise.all([
    loadWorldShapes(),
    loadStoriesFromSheet()
  ]);

  createStoryButtons();
  resetView();
  render();
  setupInterfaceControls();
  setupMemoryCloud();
}

async function loadWorldShapes() {
  try {
    const world = await d3.json("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json");
    countries = topojson.feature(world, world.objects.countries).features;
    iranFeature = countries.find(isIranCountry);
  } catch (error) {
    console.warn("World map shapes did not load. The globe will still show points.", error);
  }
}

async function loadStoriesFromSheet() {
  try {
    const cacheBustedUrl = `${PUBLIC_MAP_CSV_URL}&cacheBust=${Date.now()}`;
    const rows = await d3.csv(cacheBustedUrl);

    const sheetStories = rows
      .map(rowToStory)
      .filter(story => story !== null);

    stories = sheetStories.length > 0 ? sheetStories : fallbackStories;
  } catch (error) {
    console.warn("PublicMapData did not load. Using fallback stories.", error);
    stories = fallbackStories;
  }
}

function rowToStory(row) {
  const originLng = Number(row.origin_lng);
  const originLat = Number(row.origin_lat);
  const destinationLng = Number(row.destination_lng);
  const destinationLat = Number(row.destination_lat);

  if (
    !Number.isFinite(originLng) ||
    !Number.isFinite(originLat) ||
    !Number.isFinite(destinationLng) ||
    !Number.isFinite(destinationLat)
  ) {
    return null;
  }

  const originCity = cleanText(row.origin_city, "Unknown origin");
  const destinationCity = cleanText(row.destination_city, "Unknown destination");
  const displayName = cleanText(row.display_name, "Anonymous");

  return {
    id: cleanText(row.id, `story-${Math.random().toString(16).slice(2)}`),
    title: cleanText(row.title, `${originCity} → ${destinationCity}`),
    person: displayName,
    originCity,
    originCountry: cleanText(row.origin_country, ""),
    originCoords: [originLng, originLat],
    destinationCity,
    destinationCountry: cleanText(row.destination_country, ""),
    destinationCoords: [destinationLng, destinationLat],
    yearLeft: cleanText(row.year, "—"),
    quote: cleanText(row.quote, "No story text yet."),
    audio: cleanText(row.audio_url, "assets/audio/story-001.wav"),
    fileOrLink: cleanText(row.file_or_link, ""),
    locationPrivacy: cleanText(row.location_privacy, ""),
    contentLanguage: cleanText(row.content_language, ""),
    translationEn: cleanText(row.translation_en, ""),
    transcriptFa: cleanText(row.transcript_fa, ""),
    subtitleEn: cleanText(row.subtitle_en, ""),
    translationStatus: cleanText(row.translation_status, ""),
    subtitleCuesEn: cleanText(row.subtitle_cues_en, "")
  };
}

function cleanText(value, fallback) {
  const text = String(value || "").trim();
  return text || fallback;
}

function normalizeUrl(value) {
  const link = String(value || "").trim();

  if (!link) return "";
  if (/^https?:\/\//i.test(link)) return link;
  if (/^www\./i.test(link)) return `https://${link}`;

  return link;
}

function isImageUrl(value) {
  const link = normalizeUrl(value);
  return /\.(jpg|jpeg|png|gif|webp|avif|svg)(\?.*)?$/i.test(link);
}

function ensureArchivalFieldOverlay() {
  if (document.getElementById("archival-field-overlay")) {
    return;
  }

  const overlay = document.createElement("div");
  overlay.id = "archival-field-overlay";
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.pointerEvents = "none";
  overlay.style.zIndex = "-1";
  overlay.style.background = `
    radial-gradient(circle at 50% 50%, rgba(23,24,25,0.18) 0%, rgba(18,17,15,0.12) 38%, rgba(18,17,15,0.02) 58%, transparent 72%)
  `;
  overlay.style.filter = "blur(40px)";
  document.body.appendChild(overlay);
}

function applyArtPass2Styles() {
  d3.selectAll(".sphere")
    .attr("fill", ART_PASS_2.oceanFill)
    .attr("stroke", ART_PASS_2.globeRimStroke)
    .attr("stroke-width", 0.8);

  d3.selectAll(".land")
    .attr("fill", ART_PASS_2.landFill)
    .attr("stroke", ART_PASS_2.countryStroke)
    .attr("stroke-width", 0.45);

  d3.selectAll(".country")
    .attr("fill", ART_PASS_2.landFill)
    .attr("stroke", ART_PASS_2.countryStroke)
    .attr("stroke-width", 0.45);

  d3.selectAll(".graticule")
    .attr("fill", "none")
    .attr("stroke", ART_PASS_2.graticuleStroke)
    .attr("stroke-width", 0.45);

  d3.selectAll(".globe-outline, .sphere-outline, .globe-rim")
    .attr("fill", "none")
    .attr("stroke", ART_PASS_2.globeRimStroke)
    .attr("stroke-width", 0.8);

  d3.selectAll(".iran-outline, .iran-border")
    .attr("fill", "none")
    .attr("stroke", ART_PASS_2.iranStroke)
    .attr("stroke-width", 1.65)
    .attr("stroke-linejoin", "round")
    .attr("stroke-linecap", "round");

  d3.selectAll(".floating-label, .ghost-label, .map-label")
    .attr("fill", ART_PASS_2.labelFill);

  d3.selectAll(".map-point")
    .attr("fill", ART_PASS_2.pointFill)
    .attr("stroke", ART_PASS_2.pointCore)
    .attr("stroke-width", 1.3)
    .attr("opacity", 0.96)
    .style(
      "filter",
      "drop-shadow(0 0 5px rgba(243,187,96,0.34)) drop-shadow(0 0 14px rgba(243,187,96,0.18))"
    );

  d3.selectAll(".connection-line-segment")
    .attr("stroke", ART_PASS_2.routeStroke);
}

function render() {
  baseGroup.select(".sphere").attr("d", path);
  baseGroup.select(".graticule").attr("d", path);

  if (countries) {
    baseGroup.selectAll("path.country")
      .data(countries)
      .join("path")
      .attr("class", "country")
      .attr("d", path);
  }

  renderIranHighlight();
  renderCallCountryHighlight();
  renderLine();
  renderPoints();
  renderLabels();
  applyArtPass2Styles();
}

function isIranCountry(country) {
  return (
    String(country.id).padStart(3, "0") === IRAN_COUNTRY_ID ||
    country.properties?.name === "Iran" ||
    country.properties?.NAME === "Iran"
  );
}

function renderIranHighlight() {
  if (!iranFeature) {
    iranGroup.selectAll("path.iran-outline").remove();
    return;
  }

  iranGroup.selectAll("path.iran-outline")
    .data([iranFeature])
    .join("path")
    .attr("class", "iran-outline")
    .attr("d", path);
}

function showCallCountry(story) {
  if (!countries) {
    callCountryFeature = null;
    callCountryVisible = false;
    callCountryOpacity = 0;
    return;
  }

  callCountryFeature =
    countries.find(country => d3.geoContains(country, story.destinationCoords)) || null;

  callCountryVisible = Boolean(callCountryFeature);
  callCountryOpacity = callCountryVisible ? 1 : 0;
}

function hideCallCountry() {
  callCountryVisible = false;
  callCountryOpacity = 0;
}

function renderCallCountryHighlight() {
  callCountryGroup.attr("opacity", callCountryOpacity);

  if (!callCountryFeature || callCountryOpacity <= 0.001) {
    callCountryGroup.selectAll("path.call-country-outline").remove();
    return;
  }

  callCountryGroup.selectAll("path.call-country-outline")
    .data([callCountryFeature])
    .join("path")
    .attr("class", "call-country-outline")
    .attr("d", path);
}

function shouldShowHomePoint() {
  return (
    activeStory &&
    (
      journeyPhase === "line-arrived" ||
      journeyPhase === "line-fade" ||
      journeyPhase === "home-zoom" ||
      journeyPhase === "arrived"
    )
  );
}

function renderPoints() {
  const destinationPoints = stories.map(story => ({
    type: "destination",
    story,
    coords: story.destinationCoords
  }));

  const homePoint = shouldShowHomePoint()
    ? [{
        type: "origin",
        story: activeStory,
        coords: activeStory.originCoords
      }]
    : [];

  const points = [...destinationPoints, ...homePoint];

  const circles = pointGroup.selectAll("circle.map-point")
    .data(points, d => `${d.story.id}-${d.type}`)
    .join(
      enter => enter.append("circle")
        .attr("class", d => pointClass(d))
        .attr("r", d => pointRadius(d))
        .attr("cx", d => projectedX(d.coords))
        .attr("cy", d => projectedY(d.coords))
        .style("display", d => isVisible(d.coords) ? null : "none"),
      update => update
        .attr("class", d => pointClass(d))
        .attr("r", d => pointRadius(d))
        .attr("cx", d => projectedX(d.coords))
        .attr("cy", d => projectedY(d.coords))
        .style("display", d => isVisible(d.coords) ? null : "none"),
      exit => exit.remove()
    );

  circles
    .on("pointerdown", (event, d) => {
      if (isJourneyAnimating) return;
      event.stopPropagation();
      startWaitingBuzz();
    })
    .on("click", (event, d) => {
      event.stopPropagation();
      selectStory(d.story, { keepBuzz: true });
    });
}

function pointClass(d) {
  const isActive = activeStory && d.story.id === activeStory.id;
  const isHomeArrival =
    d.type === "origin" &&
    (
      journeyPhase === "line-arrived" ||
      journeyPhase === "line-fade" ||
      journeyPhase === "home-zoom" ||
      journeyPhase === "arrived"
    );

  return `map-point ${d.type} ${isActive ? "active" : ""} ${isHomeArrival ? "home-arrival" : ""}`;
}

function pointRadius(d) {
  if (d.type === "origin") {
    return 5.4;
  }

  return 4.4;
}

function renderLabels() {
  const labels = [];

  if (activeStory && journeyPhase === "calling") {
    labels.push({
      text: activeStory.destinationCity,
      coords: activeStory.destinationCoords,
      role: "call-label"
    });
  }

  if (
    activeStory &&
    (
      journeyPhase === "line-arrived" ||
      journeyPhase === "line-fade" ||
      journeyPhase === "home-zoom" ||
      journeyPhase === "arrived"
    )
  ) {
    labels.push({
      text: `${activeStory.originCity} - ${activeStory.yearLeft}`,
      coords: activeStory.originCoords,
      role: "home-label"
    });
  }

  labelGroup.selectAll("text.map-label")
    .data(labels, d => `${d.text}-${d.role}`)
    .join(
      enter => enter.append("text")
        .attr("class", d => `map-label ${d.role}`)
        .attr("x", d => projectedX(d.coords) + 14)
        .attr("y", d => projectedY(d.coords) + 5)
        .style("opacity", 0)
        .style("display", d => isVisible(d.coords) ? null : "none")
        .text(d => d.text)
        .transition()
        .duration(500)
        .style("opacity", 1),
      update => update
        .attr("class", d => `map-label ${d.role}`)
        .attr("x", d => projectedX(d.coords) + 14)
        .attr("y", d => projectedY(d.coords) + 5)
        .style("display", d => isVisible(d.coords) ? null : "none")
        .text(d => d.text),
      exit => exit
        .transition()
        .duration(220)
        .style("opacity", 0)
        .remove()
    );
}

function renderLine() {
  if (!activeStory || !lineVisible || lineProgress <= 0.001) {
    lineGroup.selectAll("path.connection-line").remove();
    return;
  }

  const lineData = makeAirlineCurve(
    activeStory.destinationCoords,
    activeStory.originCoords,
    lineProgress
  );

  if (!lineData) {
    lineGroup.selectAll("path.connection-line").remove();
    return;
  }

  lineGroup.selectAll("path.connection-line")
    .data([lineData.pathD])
    .join("path")
    .attr("class", "connection-line")
    .attr("d", d => d)
    .style("opacity", lineOpacity);
}

function makeAirlineCurve(startCoords, endCoords, progress) {
  const safeProgress = clamp(progress, 0.001, 1);

  const start = projection(startCoords);
  const end = projection(endCoords);

  if (!start || !end) {
    return null;
  }

  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (!Number.isFinite(distance) || distance < 1) {
    return null;
  }

  const midpoint = [
    (start[0] + end[0]) / 2,
    (start[1] + end[1]) / 2
  ];

  const perpendicular = [
    -dy / distance,
    dx / distance
  ];

  const lift = Math.min(180, Math.max(80, distance * 0.28));

  const controlA = [
    midpoint[0] + perpendicular[0] * lift,
    midpoint[1] + perpendicular[1] * lift
  ];

  const controlB = [
    midpoint[0] - perpendicular[0] * lift,
    midpoint[1] - perpendicular[1] * lift
  ];

  const control = controlA[1] > controlB[1] ? controlA : controlB;

  const steps = Math.max(10, Math.ceil(110 * safeProgress));
  const points = [];

  for (let index = 0; index <= steps; index++) {
    const t = (safeProgress * index) / steps;
    points.push(quadraticPoint(start, control, end, t));
  }

  const pathD = points
    .map((point, index) => {
      const command = index === 0 ? "M" : "L";
      return `${command}${point[0]},${point[1]}`;
    })
    .join(" ");

  return { pathD };
}

function quadraticPoint(start, control, end, t) {
  const oneMinusT = 1 - t;

  return [
    oneMinusT * oneMinusT * start[0] +
      2 * oneMinusT * t * control[0] +
      t * t * end[0],

    oneMinusT * oneMinusT * start[1] +
      2 * oneMinusT * t * control[1] +
      t * t * end[1]
  ];
}

function projectedX(coords) {
  const point = projection(coords);
  return point ? point[0] : -999;
}

function projectedY(coords) {
  const point = projection(coords);
  return point ? point[1] : -999;
}

function isVisible(coords) {
  const rotate = projection.rotate();
  const center = [-rotate[0], -rotate[1]];
  return d3.geoDistance(coords, center) < Math.PI / 2;
}

async function selectStory(story, options = {}) {
  const token = ++journeyToken;
  const keepBuzz = Boolean(options.keepBuzz);

  quietMemoryCloud();

  if (!keepBuzz) {
    stopWaitingBuzz();
  }

  stopAudio();

  activeStory = story;
  lineVisible = false;
  lineProgress = 0;
  lineOpacity = 1;
  journeyPhase = "calling";
  isJourneyAnimating = true;

  showCallCountry(story);
  updateStoryButtons();
  updateStoryPanelCalling(story);
  prepareStoryAudio(story);

  if (!keepBuzz || !buzzNodes) {
    startWaitingBuzz();
  }

  render();

  const startRotation = projection.rotate();
  const callRotation = rotationForCoords(story.destinationCoords);
  const startScale = currentScale;

  await animateStep(
    CALL_COUNTRY_DURATION,
    eased => {
      projection.rotate(interpolateRotation(startRotation, callRotation)(eased));
      currentScale = interpolateNumber(startScale, CALL_FOCUS_SCALE, eased);
      projection.scale(currentScale);
    },
    token,
    d3.easeCubicInOut
  );

  if (!isCurrentJourney(token)) return;

  journeyPhase = "travel";
  lineVisible = true;
  lineProgress = 0;
  lineOpacity = 1;

  updateStoryPanelTraveling(story);
  render();

  const routeMidpoint = d3.geoInterpolate(
    story.destinationCoords,
    story.originCoords
  )(0.5);

  const routeViewRotation = rotationForCoords(routeMidpoint);
  const routeStartRotation = projection.rotate();
  const routeStartScale = currentScale;

  await animateStep(
    TRAVEL_DURATION,
    (eased, raw) => {
      const routeT = d3.easeCubicInOut(raw);

      const viewT = clamp(routeT / 0.45, 0, 1);
      const easedViewT = d3.easeCubicInOut(viewT);

      projection.rotate(
        interpolateRotation(routeStartRotation, routeViewRotation)(easedViewT)
      );

      currentScale = interpolateNumber(
        routeStartScale,
        ROUTE_VIEW_SCALE,
        easedViewT
      );

      projection.scale(currentScale);
      lineProgress = routeT;

      if (routeT <= 0.08) {
        callCountryOpacity = 1;
        callCountryVisible = true;
      } else if (routeT <= 0.32) {
        callCountryOpacity = 1 - ((routeT - 0.08) / 0.24);
        callCountryVisible = true;
      } else {
        callCountryOpacity = 0;
        callCountryVisible = false;
      }
    },
    token,
    t => t
  );

  if (!isCurrentJourney(token)) return;

  journeyPhase = "line-arrived";
  lineVisible = true;
  lineProgress = 1;
  lineOpacity = 1;
  callCountryOpacity = 0;
  callCountryVisible = false;

  stopWaitingBuzz();
  updateStoryPanelFinal(story);
  playStoryAudio(story);
  render();
  updateStoryButtons();

  await delayStep(LINE_ARRIVAL_HOLD_DURATION, token);

  if (!isCurrentJourney(token)) return;

  journeyPhase = "line-fade";

  await animateStep(
    LINE_FADE_DURATION,
    eased => {
      lineOpacity = 1 - eased;
    },
    token,
    d3.easeCubicInOut
  );

  if (!isCurrentJourney(token)) return;

  lineVisible = false;
  lineProgress = 0;
  lineOpacity = 1;

  journeyPhase = "home-zoom";

  const iranFocusCoords = getIranFocusCoords();
  const iranRotation = rotationForCoords(iranFocusCoords);
  const iranFitScale = getIranFitScale(iranRotation);

  const rotationBeforeIranZoom = projection.rotate();
  const scaleBeforeIranZoom = currentScale;

  await animateStep(
    IRAN_ZOOM_DURATION,
    eased => {
      projection.rotate(
        interpolateRotation(rotationBeforeIranZoom, iranRotation)(eased)
      );

      currentScale = interpolateNumber(
        scaleBeforeIranZoom,
        iranFitScale,
        eased
      );

      projection.scale(currentScale);
    },
    token,
    d3.easeCubicInOut
  );

  if (!isCurrentJourney(token)) return;

  await delayStep(ARRIVAL_HOLD_DURATION, token);

  if (!isCurrentJourney(token)) return;

  journeyPhase = "arrived";
  isJourneyAnimating = false;

  updateStoryPanelFinal(story);
  render();
  updateStoryButtons();
}

function resetView() {
  journeyToken++;
  stopWaitingBuzz();
  stopAudio();
  hideCallCountry();

  activeStory = null;
  lineVisible = false;
  lineProgress = 0;
  lineOpacity = 1;
  journeyPhase = "idle";
  isJourneyAnimating = false;
  callCountryOpacity = 0;
  currentScale = DEFAULT_SCALE;

  projection
    .scale(currentScale)
    .rotate([...DEFAULT_ROTATION]);

  setIdleStoryPanel();
  render();
  updateStoryButtons();
  showMemoryCloud();
}

function goToIranView() {
  const token = ++journeyToken;

  stopWaitingBuzz();
  stopAudio();
  hideCallCountry();

  activeStory = null;
  lineVisible = false;
  lineProgress = 0;
  lineOpacity = 1;
  journeyPhase = "idle";
  isJourneyAnimating = false;
  callCountryOpacity = 0;

  setIdleStoryPanel();
  updateStoryButtons();
  showMemoryCloud();

  const iranFocusCoords = getIranFocusCoords();
  const targetRotation = rotationForCoords(iranFocusCoords);
  const targetScale = getIranFitScale(targetRotation);

  const startRotation = projection.rotate();
  const startScale = currentScale;
  const duration = 1700;
  const start = performance.now();
  const rotationInterpolator = interpolateRotation(startRotation, targetRotation);

  function frame(now) {
    if (!isCurrentJourney(token)) {
      return;
    }

    const rawT = Math.min(1, (now - start) / duration);
    const easedT = d3.easeCubicInOut(rawT);

    projection.rotate(rotationInterpolator(easedT));
    currentScale = interpolateNumber(startScale, targetScale, easedT);
    projection.scale(currentScale);

    render();

    if (rawT < 1) {
      requestAnimationFrame(frame);
    }
  }

  requestAnimationFrame(frame);
}

function setIdleStoryPanel() {
  setText("story-title", "Choose a call");
  setText("story-route", "Diaspora → Iran");
  setText("story-year", "Year: —");
  setText(
    "story-quote",
    "Click a blinking point outside Iran. The map will carry the call back home."
  );

  updateAttachmentLink({ fileOrLink: "" });
  updateLanguagePanel(null);
  hideMapSubtitles();

  audio.removeAttribute("src");
  audio.load();
  refreshAudioDock();
}

function setText(id, text) {
  const element = document.getElementById(id);

  if (element) {
    element.textContent = text;
  }
}

function getIranFocusCoords() {
  if (iranFeature) {
    return d3.geoCentroid(iranFeature);
  }

  return IRAN_CENTER_FALLBACK;
}

function getIranFitScale(targetRotation) {
  if (!iranFeature) {
    return IRAN_FIT_SCALE_FALLBACK;
  }

  const previousRotation = projection.rotate();
  const previousScale = projection.scale();

  projection.rotate(targetRotation);
  projection.scale(1);

  const bounds = path.bounds(iranFeature);
  const dx = bounds[1][0] - bounds[0][0];
  const dy = bounds[1][1] - bounds[0][1];

  projection.rotate(previousRotation);
  projection.scale(previousScale);

  if (
    !Number.isFinite(dx) ||
    !Number.isFinite(dy) ||
    dx <= 0 ||
    dy <= 0
  ) {
    return IRAN_FIT_SCALE_FALLBACK;
  }

  const targetWidth = width * 0.70;
  const targetHeight = height * 0.70;

  const scale = Math.min(
    targetWidth / dx,
    targetHeight / dy
  );

  return clamp(scale, 850, 1350);
}

function isCurrentJourney(token) {
  return token === journeyToken;
}

function rotationForCoords(coords) {
  return [-coords[0], -coords[1], 0];
}

function interpolateRotation(startRotation, endRotation) {
  const startLon = startRotation[0];
  let endLon = endRotation[0];

  while (endLon - startLon > 180) endLon -= 360;
  while (endLon - startLon < -180) endLon += 360;

  const lon = d3.interpolateNumber(startLon, endLon);
  const lat = d3.interpolateNumber(startRotation[1], endRotation[1]);

  return t => [lon(t), lat(t), 0];
}

function interpolateNumber(start, end, t) {
  return start + (end - start) * t;
}

function animateStep(duration, onUpdate, token, ease = d3.easeCubicInOut) {
  return new Promise(resolve => {
    const start = performance.now();

    function frame(now) {
      if (!isCurrentJourney(token)) {
        resolve(false);
        return;
      }

      const rawT = Math.min(1, (now - start) / duration);
      const easedT = ease(rawT);

      onUpdate(easedT, rawT);
      render();

      if (rawT < 1) {
        requestAnimationFrame(frame);
      } else {
        resolve(true);
      }
    }

    requestAnimationFrame(frame);
  });
}

function delayStep(duration, token) {
  return new Promise(resolve => {
    window.setTimeout(() => {
      resolve(isCurrentJourney(token));
    }, duration);
  });
}

function updateStoryPanelCalling(story) {
  setText("story-title", `Calling Iran from ${story.destinationCity}…`);
  setText("story-route", `${story.destinationCity}, ${story.destinationCountry} → Iran`);
  setText("story-year", "Waiting for home to answer");
  setText("story-quote", "The starting place lights up. The call is beginning.");

  updateAttachmentLink({ fileOrLink: "" });
  updateLanguagePanel(null);
}

function updateStoryPanelTraveling(story) {
  setText("story-title", `Calling Iran from ${story.destinationCity}…`);
  setText(
    "story-route",
    `${story.destinationCity}, ${story.destinationCountry} → ${story.originCity}, ${story.originCountry}`
  );
  setText("story-year", "Signal in transit");
  setText(
    "story-quote",
    "The line is carrying the call back across distance, time, and memory."
  );

  updateAttachmentLink({ fileOrLink: "" });
  updateLanguagePanel(null);
}

function updateStoryPanelFinal(story) {
  setText("story-title", `${story.originCity} - ${story.yearLeft}`);
  setText(
    "story-route",
    `${story.destinationCity}, ${story.destinationCountry} → ${story.originCity}, ${story.originCountry}`
  );
  setText("story-year", `Year: ${story.yearLeft}`);
  setText("story-quote", story.quote);

  updateAttachmentLink(story);
  updateLanguagePanel(story);
}

function updateAttachmentLink(story) {
  let attachmentLink = document.getElementById("story-attachment-link");
  let attachmentImage = document.getElementById("story-attachment-image");

  if (!attachmentLink) {
    attachmentLink = document.createElement("a");
    attachmentLink.id = "story-attachment-link";
    attachmentLink.className = "attachment-link";
    attachmentLink.target = "_blank";
    attachmentLink.rel = "noopener noreferrer";
    attachmentLink.textContent = "Open submitted file / fragment";

    const storyListWrap = document.querySelector(".story-list-wrap");
    const storyCard = document.querySelector(".story-card");

    if (storyListWrap && storyListWrap.parentNode) {
      storyListWrap.parentNode.insertBefore(attachmentLink, storyListWrap);
    } else if (storyCard) {
      storyCard.appendChild(attachmentLink);
    }
  }

  if (!attachmentImage) {
    attachmentImage = document.createElement("img");
    attachmentImage.id = "story-attachment-image";
    attachmentImage.className = "attachment-image";
    attachmentImage.alt = "Submitted image fragment";

    if (attachmentLink.parentNode) {
      attachmentLink.parentNode.insertBefore(attachmentImage, attachmentLink.nextSibling);
    }
  }

  const link = normalizeUrl(story.fileOrLink);

  if (link) {
    attachmentLink.href = link;
    attachmentLink.style.display = "inline-flex";

    if (isImageUrl(link)) {
      attachmentImage.src = link;
      attachmentImage.style.display = "block";
    } else {
      attachmentImage.removeAttribute("src");
      attachmentImage.style.display = "none";
    }
  } else {
    attachmentLink.removeAttribute("href");
    attachmentLink.style.display = "none";
    attachmentImage.removeAttribute("src");
    attachmentImage.style.display = "none";
  }
}

function updateLanguagePanel(story) {
  let languagePanel = document.getElementById("story-language-panel");

  if (!languagePanel) {
    languagePanel = document.createElement("div");
    languagePanel.id = "story-language-panel";
    languagePanel.className = "language-panel";

    const storyListWrap = document.querySelector(".story-list-wrap");
    const storyCard = document.querySelector(".story-card");

    if (storyListWrap && storyListWrap.parentNode) {
      storyListWrap.parentNode.insertBefore(languagePanel, storyListWrap);
    } else if (storyCard) {
      storyCard.appendChild(languagePanel);
    }
  }

  if (!story) {
    languagePanel.innerHTML = "";
    languagePanel.style.display = "none";
    return;
  }

  const translationEn = String(story.translationEn || "").trim();
  const transcriptFa = String(story.transcriptFa || "").trim();
  const subtitleEn = String(story.subtitleEn || "").trim();
  const contentLanguage = String(story.contentLanguage || "").trim();
  const translationStatus = String(story.translationStatus || "").trim();

  const hasLanguageContent =
    translationEn ||
    transcriptFa ||
    subtitleEn ||
    contentLanguage ||
    translationStatus;

  if (!hasLanguageContent) {
    languagePanel.innerHTML = "";
    languagePanel.style.display = "none";
    return;
  }

  const sections = [];

  if (contentLanguage || translationStatus) {
    sections.push(`
      <div class="language-meta">
        ${contentLanguage ? `<span>Language: ${escapeHtml(contentLanguage)}</span>` : ""}
        ${translationStatus ? `<span>Status: ${escapeHtml(translationStatus)}</span>` : ""}
      </div>
    `);
  }

  if (transcriptFa) {
    sections.push(`
      <section class="language-section">
        <h3>Persian transcript</h3>
        <p class="language-text language-text-fa" dir="rtl" lang="fa">${escapeHtml(transcriptFa)}</p>
      </section>
    `);
  }

  if (subtitleEn) {
    sections.push(`
      <section class="language-section">
        <h3>English subtitle</h3>
        <p class="language-text">${escapeHtml(subtitleEn)}</p>
      </section>
    `);
  }

  if (translationEn) {
    sections.push(`
      <section class="language-section">
        <h3>English translation</h3>
        <p class="language-text">${escapeHtml(translationEn)}</p>
      </section>
    `);
  }

  languagePanel.innerHTML = sections.join("");
  languagePanel.style.display = "block";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function ensureMapSubtitleOverlay() {
  let subtitleOverlay = document.getElementById("map-subtitle-overlay");

  if (!subtitleOverlay) {
    subtitleOverlay = document.createElement("div");
    subtitleOverlay.id = "map-subtitle-overlay";
    subtitleOverlay.className = "map-subtitle-overlay";
    subtitleOverlay.setAttribute("aria-live", "polite");

    const mapCard = document.querySelector(".map-card");

    if (mapCard) {
      mapCard.appendChild(subtitleOverlay);
    }
  }

  return subtitleOverlay;
}

function startMapSubtitles(story) {
  const subtitleOverlay = ensureMapSubtitleOverlay();

  activeSubtitleCues = parseSubtitleCues(story.subtitleCuesEn);
  activeFallbackSubtitle =
    String(story.subtitleEn || story.translationEn || "").trim();

  if (!activeSubtitleCues.length && !activeFallbackSubtitle) {
    hideMapSubtitles();
    return;
  }

  subtitleOverlay.textContent = "";
  subtitleOverlay.classList.add("visible");

  audio.removeEventListener("timeupdate", updateMapSubtitleText);
  audio.addEventListener("timeupdate", updateMapSubtitleText);

  updateMapSubtitleText();
}

function updateMapSubtitleText() {
  const subtitleOverlay = ensureMapSubtitleOverlay();

  if (!activeSubtitleCues.length && !activeFallbackSubtitle) {
    hideMapSubtitles();
    return;
  }

  const currentTime = audio.currentTime || 0;

  if (activeSubtitleCues.length) {
    const activeCue = activeSubtitleCues.find(cue => {
      return currentTime >= cue.start && currentTime < cue.end;
    });

    if (activeCue) {
      subtitleOverlay.textContent = activeCue.text;
      subtitleOverlay.classList.add("visible");
    } else {
      subtitleOverlay.textContent = "";
      subtitleOverlay.classList.remove("visible");
    }

    return;
  }

  subtitleOverlay.textContent = activeFallbackSubtitle;
  subtitleOverlay.classList.add("visible");
}

function hideMapSubtitles() {
  const subtitleOverlay = document.getElementById("map-subtitle-overlay");

  audio.removeEventListener("timeupdate", updateMapSubtitleText);

  activeSubtitleCues = [];
  activeFallbackSubtitle = "";

  if (subtitleOverlay) {
    subtitleOverlay.textContent = "";
    subtitleOverlay.classList.remove("visible");
  }
}

function parseSubtitleCues(cueText) {
  return String(cueText || "")
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(parseSubtitleCueLine)
    .filter(Boolean);
}

function parseSubtitleCueLine(line) {
  const parts = line.split("|");

  if (parts.length < 2) {
    return null;
  }

  const timePart = parts[0].trim();
  const text = parts.slice(1).join("|").trim();

  if (!text) {
    return null;
  }

  const timeParts = timePart.split(/\s*[-–—]\s*/);

  if (timeParts.length < 2) {
    return null;
  }

  const start = parseSubtitleTime(timeParts[0]);
  const end = parseSubtitleTime(timeParts[1]);

  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return null;
  }

  return {
    start,
    end,
    text
  };
}

function parseSubtitleTime(value) {
  const text = String(value || "").trim();

  if (!text) {
    return NaN;
  }

  if (/^\d+(\.\d+)?$/.test(text)) {
    return Number(text);
  }

  const parts = text.split(":").map(part => Number(part));

  if (parts.some(part => !Number.isFinite(part))) {
    return NaN;
  }

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  return NaN;
}

function prepareStoryAudio(story) {
  audio.src = story.audio;
  audio.currentTime = 0;
  audio.load();
  refreshAudioDock();
}

function playStoryAudio(story) {
  audio.src = story.audio;
  audio.currentTime = 0;
  audio.volume = 1;

  startMapSubtitles(story);
  refreshAudioDock();

  audio.play().catch(() => {
    return;
  });

  audio.onended = () => {
    hideMapSubtitles();

    if (activeStory && activeStory.id === story.id) {
      render();
    }
  };
}

function stopAudio() {
  hideMapSubtitles();

  audio.pause();

  try {
    audio.currentTime = 0;
  } catch (error) {
    return;
  }

  refreshAudioDock();
}

function getAudioContext() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) {
      return null;
    }

    if (!audioContext) {
      audioContext = new AudioContextClass();
    }

    return audioContext;
  } catch (error) {
    console.warn("Audio context could not be created.", error);
    return null;
  }
}

function startWaitingBuzz() {
  const context = getAudioContext();

  if (!context) {
    return;
  }

  if (buzzNodes) {
    return;
  }

  const beginBuzz = () => {
    if (buzzNodes) {
      return;
    }

    const now = context.currentTime + 0.02;

    const masterGain = context.createGain();
    masterGain.gain.setValueAtTime(0, now);
    masterGain.gain.linearRampToValueAtTime(1, now + 0.08);

    const humGain = context.createGain();
    humGain.gain.setValueAtTime(0.018, now);

    const beepGain = context.createGain();
    beepGain.gain.setValueAtTime(0.0001, now);

    const lowpass = context.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.setValueAtTime(430, now);
    lowpass.Q.setValueAtTime(1.6, now);

    const bandpass = context.createBiquadFilter();
    bandpass.type = "bandpass";
    bandpass.frequency.setValueAtTime(620, now);
    bandpass.Q.setValueAtTime(3.2, now);

    const humA = context.createOscillator();
    humA.type = "sine";
    humA.frequency.setValueAtTime(92, now);

    const humB = context.createOscillator();
    humB.type = "sine";
    humB.frequency.setValueAtTime(96.5, now);

    const beep = context.createOscillator();
    beep.type = "sine";
    beep.frequency.setValueAtTime(620, now);

    humA.connect(lowpass);
    humB.connect(lowpass);
    lowpass.connect(humGain);

    beep.connect(bandpass);
    bandpass.connect(beepGain);

    humGain.connect(masterGain);
    beepGain.connect(masterGain);
    masterGain.connect(context.destination);

    humA.start(now);
    humB.start(now);
    beep.start(now);

    buzzNodes = {
      context,
      masterGain,
      humGain,
      beepGain,
      lowpass,
      bandpass,
      humA,
      humB,
      beep,
      timer: null
    };

    pulseCallBeep();

    buzzNodes.timer = window.setInterval(() => {
      pulseCallBeep();
    }, 720);
  };

  if (context.state === "suspended") {
    context.resume()
      .then(beginBuzz)
      .catch(error => {
        console.warn("Audio context could not resume.", error);
      });
  } else {
    beginBuzz();
  }
}

function pulseCallBeep() {
  if (!buzzNodes) {
    return;
  }

  const context = buzzNodes.context;
  const now = context.currentTime;
  const gain = buzzNodes.beepGain.gain;

  gain.cancelScheduledValues(now);
  gain.setValueAtTime(0.0001, now);
  gain.linearRampToValueAtTime(BUZZ_VOLUME, now + 0.035);
  gain.setValueAtTime(BUZZ_VOLUME, now + 0.20);
  gain.linearRampToValueAtTime(0.0001, now + 0.38);
}

function stopWaitingBuzz() {
  if (!buzzNodes) {
    return;
  }

  const nodes = buzzNodes;
  buzzNodes = null;

  if (nodes.timer) {
    clearInterval(nodes.timer);
  }

  const context = nodes.context;
  const now = context.currentTime;

  try {
    nodes.masterGain.gain.cancelScheduledValues(now);
    nodes.masterGain.gain.setValueAtTime(nodes.masterGain.gain.value || 0.0001, now);
    nodes.masterGain.gain.linearRampToValueAtTime(0.0001, now + 0.32);

    window.setTimeout(() => {
      cleanupBuzzNodes(nodes);
    }, 420);
  } catch (error) {
    console.warn("Call buzz could not stop cleanly.", error);
  }
}

function cleanupBuzzNodes(nodes) {
  try { nodes.humA.stop(); } catch (error) {}
  try { nodes.humB.stop(); } catch (error) {}
  try { nodes.beep.stop(); } catch (error) {}

  try { nodes.humA.disconnect(); } catch (error) {}
  try { nodes.humB.disconnect(); } catch (error) {}
  try { nodes.beep.disconnect(); } catch (error) {}

  try { nodes.lowpass.disconnect(); } catch (error) {}
  try { nodes.bandpass.disconnect(); } catch (error) {}
  try { nodes.humGain.disconnect(); } catch (error) {}
  try { nodes.beepGain.disconnect(); } catch (error) {}
  try { nodes.masterGain.disconnect(); } catch (error) {}
}

function createStoryButtons() {
  const list = document.getElementById("story-list");

  if (!list) {
    return;
  }

  list.innerHTML = "";

  stories.forEach(story => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "story-button";
    button.dataset.storyId = story.id;

    button.innerHTML = `
      <strong>${story.destinationCity} → Iran</strong>
      <span>Call back to ${story.originCity}</span>
    `;

    button.addEventListener("pointerdown", () => {
      if (isJourneyAnimating) return;
      startWaitingBuzz();
    });

    button.addEventListener("click", () => {
      selectStory(story, { keepBuzz: true });
    });

    list.appendChild(button);
  });
}

function updateStoryButtons() {
  document.querySelectorAll(".story-button").forEach(button => {
    button.classList.toggle(
      "active",
      activeStory && button.dataset.storyId === activeStory.id
    );
  });
}

function setupInterfaceControls() {
  const iranViewButton = document.getElementById("reset-view");

  if (iranViewButton) {
    iranViewButton.textContent = "Iran view";
    iranViewButton.addEventListener("click", goToIranView);
  }

  setupAudioDock();
}

function setupAudioDock() {
  const backButton = document.getElementById("audio-back-10");
  const playPauseButton = document.getElementById("audio-play-pause");
  const forwardButton = document.getElementById("audio-forward-10");
  const progressInput = document.getElementById("audio-progress");
  const timeLabel = document.getElementById("audio-time");

  if (
    !audio ||
    !backButton ||
    !playPauseButton ||
    !forwardButton ||
    !progressInput ||
    !timeLabel
  ) {
    return;
  }

  backButton.addEventListener("click", () => {
    if (!Number.isFinite(audio.duration)) return;

    audio.currentTime = Math.max(0, audio.currentTime - 10);
    refreshAudioDock();
  });

  forwardButton.addEventListener("click", () => {
    if (!Number.isFinite(audio.duration)) return;

    audio.currentTime = Math.min(audio.duration, audio.currentTime + 10);
    refreshAudioDock();
  });

  playPauseButton.addEventListener("click", () => {
    if (!audio.src) return;

    if (audio.paused) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }

    refreshAudioDock();
  });

  progressInput.addEventListener("input", () => {
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;

    const percentage = Number(progressInput.value) / 100;
    audio.currentTime = audio.duration * percentage;
    refreshAudioDock();
  });

  audio.addEventListener("loadedmetadata", refreshAudioDock);
  audio.addEventListener("timeupdate", refreshAudioDock);
  audio.addEventListener("play", refreshAudioDock);
  audio.addEventListener("pause", refreshAudioDock);
  audio.addEventListener("ended", refreshAudioDock);

  audioDockUpdate = function updateAudioDock() {
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;

    const percentage = duration > 0 ? (current / duration) * 100 : 0;

    progressInput.value = String(percentage);
    timeLabel.textContent = `${formatAudioTime(current)} / ${duration ? formatAudioTime(duration) : "0:00"}`;
    playPauseButton.textContent = audio.paused ? "Play" : "Pause";

    const hasAudio = Boolean(audio.src);

    backButton.disabled = !hasAudio;
    playPauseButton.disabled = !hasAudio;
    forwardButton.disabled = !hasAudio;
    progressInput.disabled = !hasAudio;
  };

  refreshAudioDock();
}

function refreshAudioDock() {
  if (typeof audioDockUpdate === "function") {
    audioDockUpdate();
  }
}

function formatAudioTime(seconds) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = Math.floor(safeSeconds % 60);

  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function zoomGlobe(direction) {
  const factor = direction === "in" ? 1.06 : 1 / 1.06;

  currentScale = clamp(currentScale * factor, MIN_SCALE, MAX_SCALE);
  projection.scale(currentScale);

  render();
}

svg.call(
  d3.drag()
    .on("start", event => {
      if (isJourneyAnimating) return;

      const rotate = projection.rotate();

      dragStart = {
        x: event.x,
        y: event.y,
        rotate
      };
    })
    .on("drag", event => {
      if (isJourneyAnimating || !dragStart) return;

      const sensitivity = 0.35 * (DEFAULT_SCALE / currentScale);

      const nextLongitude =
        dragStart.rotate[0] + (event.x - dragStart.x) * sensitivity;

      const nextLatitude =
        dragStart.rotate[1] - (event.y - dragStart.y) * sensitivity;

      projection.rotate([
        nextLongitude,
        clamp(nextLatitude, -85, 85),
        0
      ]);

      render();
    })
    .on("end", () => {
      dragStart = null;
    })
);

svg.on("wheel.zoom-globe", event => {
  event.preventDefault();

  if (isJourneyAnimating) return;

  if (event.deltaY < 0) {
    zoomGlobe("in");
  } else {
    zoomGlobe("out");
  }
}, { passive: false });

/* Iran scatter floating memory fragments */

function setupMemoryCloud() {
  destroyMemoryCloud();

  if (!stories.length) {
    return;
  }

  const back = document.createElement("div");
  back.id = "iran-scatter-cloud-back";
  back.className = "memory-cloud iran-scatter-cloud iran-scatter-cloud-back fixed-memory-cloud";
  back.setAttribute("aria-hidden", "true");

  const front = document.createElement("div");
  front.id = "iran-scatter-cloud-front";
  front.className = "memory-cloud iran-scatter-cloud iran-scatter-cloud-front fixed-memory-cloud";
  front.setAttribute("aria-label", "Floating memory fragments");

  document.body.appendChild(back);
  document.body.appendChild(front);

  memoryCloud.back = back;
  memoryCloud.front = front;
  memoryCloud.items = [];

  const origin = getMemoryCloudIranOrigin();
  const fragments = buildMemoryCloudFragments();
  const now = performance.now();

  memoryCloud.items = fragments.map((fragment, index) => {
    const item = createMemoryCloudItem(fragment, index, origin, now);

    if (chooseMemoryCloudDepth(index) === "back") {
      memoryCloud.back.appendChild(item.element);
      item.element.classList.add("iran-scatter-depth-back");
    } else {
      memoryCloud.front.appendChild(item.element);
      item.element.classList.add("iran-scatter-depth-front");
    }

    return item;
  });

  memoryCloud.lastTime = performance.now();
  memoryCloud.raf = requestAnimationFrame(tickMemoryCloud);

  window.addEventListener("resize", handleMemoryCloudResize);
}

function destroyMemoryCloud() {
  if (memoryCloud.raf) {
    cancelAnimationFrame(memoryCloud.raf);
  }

  window.removeEventListener("resize", handleMemoryCloudResize);

  document.getElementById("iran-scatter-cloud-front")?.remove();
  document.getElementById("iran-scatter-cloud-back")?.remove();

  memoryCloud.front = null;
  memoryCloud.back = null;
  memoryCloud.items = [];
  memoryCloud.raf = null;
  memoryCloud.lastTime = null;
}

function buildMemoryCloudFragments() {
  const fragments = [];

  stories.forEach(story => {
    const person = cleanMemoryCloudPerson(story.person || story.displayName || "Anonymous");

    addMemoryCloudFragment(fragments, {
      kind: "city",
      word: story.originCity,
      person,
      story
    });

    addMemoryCloudFragment(fragments, {
      kind: "country",
      word: story.destinationCountry,
      person,
      story
    });

    addMemoryCloudFragment(fragments, {
      kind: "year",
      word: story.yearLeft,
      person,
      story
    });
  });

  return fragments.filter(fragment => {
    return (
      fragment.word &&
      fragment.word !== "—" &&
      fragment.word !== "Unknown origin" &&
      fragment.word !== "Unknown destination"
    );
  });
}

function addMemoryCloudFragment(fragments, fragment) {
  const word = String(fragment.word || "").trim();

  if (!word) {
    return;
  }

  fragments.push({
    ...fragment,
    word
  });
}

function cleanMemoryCloudPerson(person) {
  const clean = String(person || "").trim();
  return clean || "Anonymous";
}

function createMemoryCloudItem(fragment, index, origin, now) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = `iran-scatter-cloud-item fixed-memory-cloud-item iran-scatter-${fragment.kind}`;
  element.setAttribute(
    "aria-label",
    `Begin call for ${fragment.word}, contributed by ${fragment.person}`
  );

  const canvas = renderMemoryCloudCanvas(fragment);
  canvas.className = "iran-scatter-cloud-canvas fixed-memory-cloud-canvas";
  canvas.setAttribute("aria-hidden", "true");
  element.appendChild(canvas);

  const launchAngle = getMemoryCloudLaunchAngle(index);
  const haloOffset = randomBetween(0, MEMORY_CLOUD_CONFIG.iranHaloRadius);

  const startX = origin.x + Math.cos(launchAngle) * haloOffset;
  const startY = origin.y + Math.sin(launchAngle) * haloOffset;

  const speed = randomBetween(MEMORY_CLOUD_CONFIG.speedMin, MEMORY_CLOUD_CONFIG.speedMax);
  const launchDistance = randomBetween(
    MEMORY_CLOUD_CONFIG.launchDistanceMin,
    MEMORY_CLOUD_CONFIG.launchDistanceMax
  );

  const item = {
    element,
    fragment,
    x: startX,
    y: startY,
    angle: launchAngle,
    targetAngle: launchAngle,
    speed,
    launchDistance,
    launchDistanceTravelled: 0,
    launching: true,
    launched: false,
    launchAt: now + index * MEMORY_CLOUD_CONFIG.launchDelayStep + randomBetween(0, MEMORY_CLOUD_CONFIG.launchRandomDelay),
    paused: false,
    nextTurnAt: now + randomBetween(MEMORY_CLOUD_CONFIG.turnMinSeconds, MEMORY_CLOUD_CONFIG.turnMaxSeconds) * 1000,
    nextDepthAt: now + randomBetween(MEMORY_CLOUD_CONFIG.depthMinSeconds, MEMORY_CLOUD_CONFIG.depthMaxSeconds) * 1000
  };

  element.classList.add("prelaunch");
  setMemoryCloudOpacity(element, "front");
  applyMemoryCloudPosition(item);

  element.addEventListener("pointerdown", event => {
    event.stopPropagation();

    if (!isJourneyAnimating) {
      startWaitingBuzz();
    }
  });

  element.addEventListener("click", event => {
    event.stopPropagation();

    if (isJourneyAnimating) {
      return;
    }

    quietMemoryCloud();
    selectStory(fragment.story, { keepBuzz: true });
  });

  element.addEventListener("mouseenter", () => {
    item.paused = true;
    element.classList.add("caught");
  });

  element.addEventListener("mouseleave", () => {
    item.paused = false;
    element.classList.remove("caught");
    item.nextTurnAt = performance.now() + randomBetween(3, 8) * 1000;
  });

  element.addEventListener("focus", () => {
    item.paused = true;
    element.classList.add("caught");
  });

  element.addEventListener("blur", () => {
    item.paused = false;
    element.classList.remove("caught");
    item.nextTurnAt = performance.now() + randomBetween(3, 8) * 1000;
  });

  return item;
}

function renderMemoryCloudCanvas(fragment) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);

  const wordFontSize =
    fragment.kind === "year"
      ? 16.5
      : fragment.kind === "country"
        ? 14.5
        : 15;

  const personFontSize = 8.4;
  const wordFont = `700 ${wordFontSize}px Georgia, "Times New Roman", serif`;
  const personFont = `700 ${personFontSize}px Arial, sans-serif`;

  const measuringCanvas = document.createElement("canvas");
  const measuringContext = measuringCanvas.getContext("2d");

  measuringContext.font = wordFont;
  const wordWidth = measuringContext.measureText(fragment.word).width;

  measuringContext.font = personFont;
  const personWidth = measuringContext.measureText(fragment.person.toUpperCase()).width;

  const paddingX = 18;
  const paddingY = 12;
  const gap = 5;

  const cssWidth = Math.ceil(Math.max(wordWidth, personWidth) + paddingX * 2);
  const cssHeight = Math.ceil(wordFontSize + personFontSize + gap + paddingY * 2);

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(cssWidth * dpr);
  canvas.height = Math.ceil(cssHeight * dpr);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;

  const context = canvas.getContext("2d");
  context.scale(dpr, dpr);
  context.textAlign = "center";
  context.textBaseline = "middle";

  const centerX = cssWidth / 2;

  context.shadowColor = "rgba(255, 207, 102, 0.14)";
  context.shadowBlur = 13;
  context.fillStyle = "rgba(232, 218, 190, 0.68)";
  context.font = wordFont;
  context.fillText(fragment.word, centerX, paddingY + wordFontSize / 2);

  context.shadowColor = "rgba(0, 0, 0, 0.42)";
  context.shadowBlur = 9;
  context.fillStyle = "rgba(202, 181, 137, 0.48)";
  context.font = personFont;
  context.fillText(
    fragment.person.toUpperCase(),
    centerX,
    paddingY + wordFontSize + gap + personFontSize / 2
  );

  return canvas;
}

function tickMemoryCloud(now) {
  const deltaSeconds = Math.min(0.05, (now - memoryCloud.lastTime) / 1000);
  memoryCloud.lastTime = now;

  memoryCloud.items.forEach(item => updateMemoryCloudItem(item, now, deltaSeconds));

  memoryCloud.raf = requestAnimationFrame(tickMemoryCloud);
}

function updateMemoryCloudItem(item, now, deltaSeconds) {
  if (!item || !item.element) {
    return;
  }

  if (item.paused) {
    applyMemoryCloudPosition(item);
    return;
  }

  if (now < item.launchAt) {
    applyMemoryCloudPosition(item);
    return;
  }

  if (!item.launched) {
    item.launched = true;
    item.element.classList.remove("prelaunch");
    item.element.classList.add("launched");
  }

  if (item.launching) {
    const distanceThisFrame = item.speed * deltaSeconds;

    item.x += Math.cos(item.angle) * distanceThisFrame;
    item.y += Math.sin(item.angle) * distanceThisFrame;
    item.launchDistanceTravelled += distanceThisFrame;

    if (item.launchDistanceTravelled >= item.launchDistance) {
      item.launching = false;
      item.targetAngle = item.angle + randomBetween(-0.9, 0.9);
      item.nextTurnAt = now + randomBetween(MEMORY_CLOUD_CONFIG.turnMinSeconds, MEMORY_CLOUD_CONFIG.turnMaxSeconds) * 1000;
    }

    keepMemoryCloudItemInBounds(item);
    applyMemoryCloudPosition(item);
    return;
  }

  if (now >= item.nextTurnAt) {
    item.targetAngle += randomBetween(-0.95, 0.95);
    item.speed = randomBetween(MEMORY_CLOUD_CONFIG.speedMin, MEMORY_CLOUD_CONFIG.speedMax);
    item.nextTurnAt = now + randomBetween(MEMORY_CLOUD_CONFIG.turnMinSeconds, MEMORY_CLOUD_CONFIG.turnMaxSeconds) * 1000;
  }

  const angleDiff = normalizeMemoryCloudAngle(item.targetAngle - item.angle);
  item.angle += angleDiff * Math.min(1, deltaSeconds * 0.48);

  item.x += Math.cos(item.angle) * item.speed * deltaSeconds;
  item.y += Math.sin(item.angle) * item.speed * deltaSeconds;

  keepMemoryCloudItemInBounds(item);

  if (now >= item.nextDepthAt) {
    shiftMemoryCloudDepth(item);
    item.nextDepthAt = now + randomBetween(MEMORY_CLOUD_CONFIG.depthMinSeconds, MEMORY_CLOUD_CONFIG.depthMaxSeconds) * 1000;
  }

  applyMemoryCloudPosition(item);
}

function keepMemoryCloudItemInBounds(item) {
  const nav = document.querySelector(".project-nav");
  const navRect = nav ? nav.getBoundingClientRect() : null;

  const minX = MEMORY_CLOUD_CONFIG.paddingX;
  const maxX = window.innerWidth - MEMORY_CLOUD_CONFIG.paddingX;
  const minY = Math.max(
    MEMORY_CLOUD_CONFIG.paddingY,
    navRect ? navRect.bottom + 26 : MEMORY_CLOUD_CONFIG.paddingY
  );
  const maxY = window.innerHeight - MEMORY_CLOUD_CONFIG.paddingY;

  if (item.x < minX) {
    item.x = minX;
    item.angle = Math.PI - item.angle + randomBetween(-0.10, 0.10);
    item.targetAngle = item.angle;
  }

  if (item.x > maxX) {
    item.x = maxX;
    item.angle = Math.PI - item.angle + randomBetween(-0.10, 0.10);
    item.targetAngle = item.angle;
  }

  if (item.y < minY) {
    item.y = minY;
    item.angle = -item.angle + randomBetween(-0.10, 0.10);
    item.targetAngle = item.angle;
  }

  if (item.y > maxY) {
    item.y = maxY;
    item.angle = -item.angle + randomBetween(-0.10, 0.10);
    item.targetAngle = item.angle;
  }
}

function applyMemoryCloudPosition(item) {
  const snapped = { x: Math.round(item.x * 100) / 100, y: Math.round(item.y * 100) / 100 };

  item.element.style.setProperty("--iran-scatter-x", `${snapped.x}px`);
  item.element.style.setProperty("--iran-scatter-y", `${snapped.y}px`);
}

function shiftMemoryCloudDepth(item) {
  if (!item || !item.element || !memoryCloud.front || !memoryCloud.back) {
    return;
  }

  const shouldGoBehind = Math.random() < MEMORY_CLOUD_CONFIG.behindChance;

  item.element.classList.remove("iran-scatter-depth-front", "iran-scatter-depth-back");

  if (shouldGoBehind) {
    memoryCloud.back.appendChild(item.element);
    item.element.classList.add("iran-scatter-depth-back");
    setMemoryCloudOpacity(item.element, "back");
  } else {
    memoryCloud.front.appendChild(item.element);
    item.element.classList.add("iran-scatter-depth-front");
    setMemoryCloudOpacity(item.element, "front");
  }
}

function setMemoryCloudOpacity(element, depth) {
  if (depth === "back") {
    element.style.setProperty("--iran-scatter-opacity-min", randomBetween(0.07, 0.13).toFixed(2));
    element.style.setProperty("--iran-scatter-opacity-max", randomBetween(0.20, 0.32).toFixed(2));
  } else {
    element.style.setProperty("--iran-scatter-opacity-min", randomBetween(0.15, 0.24).toFixed(2));
    element.style.setProperty("--iran-scatter-opacity-max", randomBetween(0.40, 0.58).toFixed(2));
  }
}

function chooseMemoryCloudDepth(index) {
  if (index % 4 === 0) {
    return "back";
  }

  return Math.random() < 0.20 ? "back" : "front";
}

function getMemoryCloudLaunchAngle(index) {
  const total = Math.max(1, stories.length * 3);
  const base = (index / total) * Math.PI * 2;
  return base + randomBetween(-0.30, 0.30);
}

function getMemoryCloudIranOrigin() {
  const svgNode = document.getElementById("globe");

  const fallback = {
    x: window.innerWidth * 0.50,
    y: window.innerHeight * 0.55
  };

  if (!svgNode || typeof projection !== "function") {
    return fallback;
  }

  const iranCoords = getIranFocusCoords();
  const projected = projection(iranCoords);

  if (!projected || !Number.isFinite(projected[0]) || !Number.isFinite(projected[1])) {
    return fallback;
  }

  const rect = svgNode.getBoundingClientRect();

  return {
    x: rect.left + (projected[0] / width) * rect.width,
    y: rect.top + (projected[1] / height) * rect.height
  };
}

function quietMemoryCloud() {
  memoryCloud.front?.classList.add("quiet");
  memoryCloud.back?.classList.add("quiet");
}

function showMemoryCloud() {
  memoryCloud.front?.classList.remove("quiet");
  memoryCloud.back?.classList.remove("quiet");
}

function handleMemoryCloudResize() {
  const origin = getMemoryCloudIranOrigin();

  memoryCloud.items.forEach(item => {
    if (!item.launched) {
      item.x = origin.x;
      item.y = origin.y;
    }

    item.x = Math.max(
      MEMORY_CLOUD_CONFIG.paddingX,
      Math.min(window.innerWidth - MEMORY_CLOUD_CONFIG.paddingX, item.x)
    );

    item.y = Math.max(
      MEMORY_CLOUD_CONFIG.paddingY,
      Math.min(window.innerHeight - MEMORY_CLOUD_CONFIG.paddingY, item.y)
    );

    applyMemoryCloudPosition(item);
  });
}

function normalizeMemoryCloudAngle(angle) {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function snapToDevicePixel(x, y) {
  const dpr = window.devicePixelRatio || 1;

  return {
    x: Math.round(x * dpr) / dpr,
    y: Math.round(y * dpr) / dpr
  };
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

/* On-map submitted image viewer
   Shows image fragments directly on the map after a story arrives.
   The image can open full-screen while audio and subtitles remain visible.
*/

(function setupSubmittedImageViewer() {
  let activeImageStory = null;
  let activeImageUrl = "";
  let imageLoadToken = 0;

  function ensureImageViewerElements() {
    let thumb = document.getElementById("story-image-thumb");
    let thumbImg = document.getElementById("story-image-thumb-img");
    let modal = document.getElementById("story-image-modal");
    let modalImg = document.getElementById("story-image-modal-img");
    let closeButton = document.getElementById("story-image-modal-close");

    const mapCard = document.querySelector(".map-card");

    if (!thumb && mapCard) {
      thumb = document.createElement("button");
      thumb.id = "story-image-thumb";
      thumb.className = "story-image-thumb";
      thumb.type = "button";
      thumb.setAttribute("aria-label", "Open submitted image");

      thumbImg = document.createElement("img");
      thumbImg.id = "story-image-thumb-img";
      thumbImg.alt = "Submitted image fragment";

      const thumbLabel = document.createElement("span");
      thumbLabel.className = "story-image-thumb-label";
      thumbLabel.textContent = "Image fragment";

      thumb.appendChild(thumbImg);
      thumb.appendChild(thumbLabel);

      thumb.addEventListener("click", event => {
        event.stopPropagation();
        openStoryImageModal();
      });

      mapCard.appendChild(thumb);
    }

    if (!modal) {
      modal = document.createElement("div");
      modal.id = "story-image-modal";
      modal.className = "story-image-modal";
      modal.setAttribute("aria-hidden", "true");

      const modalInner = document.createElement("div");
      modalInner.className = "story-image-modal-inner";

      const frame = document.createElement("div");
      frame.className = "story-image-modal-frame";

      closeButton = document.createElement("button");
      closeButton.id = "story-image-modal-close";
      closeButton.className = "story-image-modal-close";
      closeButton.type = "button";
      closeButton.setAttribute("aria-label", "Close image");
      closeButton.textContent = "×";

      modalImg = document.createElement("img");
      modalImg.id = "story-image-modal-img";
      modalImg.alt = "Submitted image fragment";

      frame.appendChild(closeButton);
      frame.appendChild(modalImg);
      modalInner.appendChild(frame);
      modal.appendChild(modalInner);

      closeButton.addEventListener("click", event => {
        event.stopPropagation();
        closeStoryImageModal();
      });

      modal.addEventListener("click", event => {
        if (event.target === modal || event.target === modalInner) {
          closeStoryImageModal();
        }
      });

      document.body.appendChild(modal);
    }

    return {
      thumb,
      thumbImg,
      modal,
      modalImg,
      closeButton
    };
  }

  function getStoryImageUrl(story) {
    if (!story) {
      return "";
    }

    const link = normalizeUrl(story.fileOrLink);

    if (!link) {
      return "";
    }

    const lower = link.toLowerCase();

    if (/\.(mp3|wav|m4a|ogg|aac|flac|webm|mp4|mov|avi|pdf|docx?|xlsx?|zip)(\?|#|$)/i.test(lower)) {
      return "";
    }

    if (/spotify|youtube|youtu\.be|vimeo|soundcloud/i.test(lower)) {
      return "";
    }

    if (isImageUrl(link)) {
      return link;
    }

    if (/tally|storage|googleusercontent|dropbox|cloudfront|amazonaws/i.test(lower)) {
      return link;
    }

    return "";
  }

  function showMapImageFragment(story) {
    const candidateUrl = getStoryImageUrl(story);

    if (!candidateUrl) {
      hideMapImageFragment();
      return;
    }

    const token = ++imageLoadToken;
    const testImage = new Image();

    testImage.onload = () => {
      if (token !== imageLoadToken) {
        return;
      }

      activeImageStory = story;
      activeImageUrl = candidateUrl;

      const elements = ensureImageViewerElements();

      if (!elements.thumb || !elements.thumbImg || !elements.modalImg) {
        return;
      }

      elements.thumbImg.src = candidateUrl;
      elements.modalImg.src = candidateUrl;

      elements.thumb.classList.add("visible");
      elements.thumb.classList.remove("offscreen");

      positionMapImageFragment();
    };

    testImage.onerror = () => {
      if (token !== imageLoadToken) {
        return;
      }

      hideMapImageFragment();
    };

    testImage.src = candidateUrl;
  }

  function hideMapImageFragment() {
    imageLoadToken++;
    activeImageStory = null;
    activeImageUrl = "";

    const thumb = document.getElementById("story-image-thumb");

    if (thumb) {
      thumb.classList.remove("visible");
      thumb.classList.remove("offscreen");
    }

    closeStoryImageModal();
  }

  function positionMapImageFragment() {
    if (!activeImageStory || !activeImageUrl) {
      return;
    }

    const thumb = document.getElementById("story-image-thumb");
    const mapCard = document.querySelector(".map-card");
    const svgNode = document.getElementById("globe");

    if (!thumb || !mapCard || !svgNode || typeof projection !== "function") {
      return;
    }

    const coords = activeImageStory.originCoords;
    const projected = projection(coords);

    if (!projected || !Number.isFinite(projected[0]) || !Number.isFinite(projected[1])) {
      thumb.classList.add("offscreen");
      return;
    }

    if (typeof isVisible === "function" && !isVisible(coords)) {
      thumb.classList.add("offscreen");
      return;
    }

    thumb.classList.remove("offscreen");

    const mapRect = mapCard.getBoundingClientRect();

    const scale = Math.min(mapRect.width / width, mapRect.height / height);
    const offsetX = (mapRect.width - width * scale) / 2;
    const offsetY = (mapRect.height - height * scale) / 2;

    const pointX = offsetX + projected[0] * scale;
    const pointY = offsetY + projected[1] * scale;

    const thumbWidth = thumb.offsetWidth || 126;
    const thumbHeight = thumb.offsetHeight || 98;

    const desiredLeft = pointX + 46;
    const desiredTop = pointY - thumbHeight - 46;

    const left = clampImageViewerValue(
      desiredLeft,
      18,
      Math.max(18, mapRect.width - thumbWidth - 18)
    );

    const top = clampImageViewerValue(
      desiredTop,
      72,
      Math.max(72, mapRect.height - thumbHeight - 108)
    );

    thumb.style.left = `${left}px`;
    thumb.style.top = `${top}px`;
  }

  function openStoryImageModal() {
    if (!activeImageUrl) {
      return;
    }

    const elements = ensureImageViewerElements();

    if (!elements.modal || !elements.modalImg) {
      return;
    }

    elements.modalImg.src = activeImageUrl;
    elements.modal.classList.add("visible");
    elements.modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("story-image-modal-open");
  }

  function closeStoryImageModal() {
    const modal = document.getElementById("story-image-modal");

    if (modal) {
      modal.classList.remove("visible");
      modal.setAttribute("aria-hidden", "true");
    }

    document.body.classList.remove("story-image-modal-open");
  }

  function clampImageViewerValue(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  if (typeof updateStoryPanelFinal === "function") {
    const originalUpdateStoryPanelFinal = updateStoryPanelFinal;

    updateStoryPanelFinal = function wrappedUpdateStoryPanelFinal(story) {
      originalUpdateStoryPanelFinal(story);
      showMapImageFragment(story);
    };
  }

  if (typeof updateStoryPanelCalling === "function") {
    const originalUpdateStoryPanelCalling = updateStoryPanelCalling;

    updateStoryPanelCalling = function wrappedUpdateStoryPanelCalling(story) {
      hideMapImageFragment();
      originalUpdateStoryPanelCalling(story);
    };
  }

  if (typeof updateStoryPanelTraveling === "function") {
    const originalUpdateStoryPanelTraveling = updateStoryPanelTraveling;

    updateStoryPanelTraveling = function wrappedUpdateStoryPanelTraveling(story) {
      hideMapImageFragment();
      originalUpdateStoryPanelTraveling(story);
    };
  }

  if (typeof resetView === "function") {
    const originalResetView = resetView;

    resetView = function wrappedResetView() {
      hideMapImageFragment();
      return originalResetView();
    };
  }

  if (typeof goToIranView === "function") {
    const originalGoToIranView = goToIranView;

    goToIranView = function wrappedGoToIranView() {
      hideMapImageFragment();
      return originalGoToIranView();
    };
  }

  if (typeof render === "function") {
    const originalRender = render;

    render = function wrappedRender() {
      const result = originalRender();
      positionMapImageFragment();
      return result;
    };
  }

  window.addEventListener("resize", positionMapImageFragment);

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      closeStoryImageModal();
    }
  });
})();
/* Auto-close Call Room / Archive dropdown */

(function setupAutoCloseCallRoom() {
  function closeCallRoomDropdown() {
    const dropdown = document.querySelector(".call-room-dropdown");

    if (dropdown && dropdown.open) {
      dropdown.open = false;
    }
  }

  if (typeof selectStory === "function" && !window.__callRoomAutoCloseWrapped) {
    const originalSelectStory = selectStory;

    selectStory = function autoCloseCallRoomSelectStory(story, options = {}) {
      closeCallRoomDropdown();
      return originalSelectStory(story, options);
    };

    window.__callRoomAutoCloseWrapped = true;
  }

  const storyList = document.getElementById("story-list");

  if (storyList && !window.__callRoomStoryListCloseBound) {
    storyList.addEventListener(
      "click",
      event => {
        const storyButton = event.target.closest(".story-button");

        if (storyButton) {
          closeCallRoomDropdown();
        }
      },
      true
    );

    window.__callRoomStoryListCloseBound = true;
  }

  if (!window.__callRoomEscapeCloseBound) {
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        closeCallRoomDropdown();
      }
    });

    window.__callRoomEscapeCloseBound = true;
  }
})();

/* Animated text performance panel */

(function setupStoryTextPerformancePanel() {
  const TEXT_PANEL_ID = "story-text-panel";

  const state = {
    storyId: "",
    fullText: "",
    sentences: [],
    currentIndex: 0,
    isPlaying: false,
    isFullMode: false,
    isFinished: false,
    timer: null
  };

  function ensureStoryTextPanel() {
    let panel = document.getElementById(TEXT_PANEL_ID);

    if (panel) {
      return panel;
    }

    panel = document.createElement("aside");
    panel.id = TEXT_PANEL_ID;
    panel.className = "story-text-panel";
    panel.setAttribute("aria-label", "Submitted text performance panel");

    panel.innerHTML = `
      <div class="story-text-panel-inner">
        <div class="story-text-panel-header">
          <div>
            <p class="story-text-eyebrow">Text fragment</p>
            <h3 id="story-text-title">Submitted text</h3>
          </div>

          <button
            id="story-text-close"
            class="story-text-close"
            type="button"
            aria-label="Hide text panel"
          >
            ×
          </button>
        </div>

        <div class="story-text-body">
          <p
            id="story-text-sentence"
            class="story-text-sentence"
            dir="auto"
            aria-live="polite"
          ></p>

          <p id="story-text-finished-note" class="story-text-finished-note">
            Text completed. Replay it, move sentence by sentence, or show the full text.
          </p>
        </div>

        <div class="story-text-controls" aria-label="Text playback controls">
          <button id="story-text-prev" type="button" aria-label="Previous sentence">
            −1
          </button>

          <button id="story-text-play" type="button" aria-label="Play or pause text">
            Play
          </button>

          <button id="story-text-next" type="button" aria-label="Next sentence">
            +1
          </button>

          <input
            id="story-text-progress"
            type="range"
            min="0"
            max="0"
            value="0"
            step="1"
            aria-label="Text progress"
          />

          <button id="story-text-full" type="button" aria-label="Show full text">
            Full text
          </button>

          <span id="story-text-count" class="story-text-count">
            0 / 0
          </span>
        </div>
      </div>
    `;

    document.body.appendChild(panel);

    const closeButton = panel.querySelector("#story-text-close");
    const previousButton = panel.querySelector("#story-text-prev");
    const playButton = panel.querySelector("#story-text-play");
    const nextButton = panel.querySelector("#story-text-next");
    const fullButton = panel.querySelector("#story-text-full");
    const progress = panel.querySelector("#story-text-progress");

    closeButton.addEventListener("click", hideStoryTextPanel);
    previousButton.addEventListener("click", previousStorySentence);
    playButton.addEventListener("click", toggleStoryTextPlayback);
    nextButton.addEventListener("click", nextStorySentence);
    fullButton.addEventListener("click", toggleFullStoryText);

    progress.addEventListener("input", () => {
      pauseStoryTextPlayback();

      state.isFullMode = false;
      state.isFinished = false;
      state.currentIndex = Number(progress.value) || 0;

      displayStorySentence(state.currentIndex);
      updateStoryTextControls();
    });

    return panel;
  }

  function getStoryText(story) {
    if (!story) {
      return "";
    }

    const text = String(story.quote || "").trim();

    if (!text) {
      return "";
    }

    if (text.toLowerCase() === "no story text yet.") {
      return "";
    }

    if (text.toLowerCase() === "click a blinking point outside iran. the map will carry the call back home.") {
      return "";
    }

    return text;
  }

  function startStoryTextPanel(story) {
    const text = getStoryText(story);

    if (!text) {
      hideStoryTextPanel();
      return;
    }

    const panel = ensureStoryTextPanel();

    if (
      state.storyId === story.id &&
      panel.classList.contains("visible") &&
      state.sentences.length > 0
    ) {
      return;
    }

    clearStoryTextTimer();

    state.storyId = story.id;
    state.fullText = text;
    state.sentences = splitStoryTextIntoSentences(text);
    state.currentIndex = 0;
    state.isPlaying = false;
    state.isFullMode = false;
    state.isFinished = false;

    const title = document.getElementById("story-text-title");
    const progress = document.getElementById("story-text-progress");

    if (title) {
      title.textContent = `${story.originCity} — ${story.yearLeft}`;
    }

    if (progress) {
      progress.min = "0";
      progress.max = String(Math.max(0, state.sentences.length - 1));
      progress.value = "0";
    }

    panel.classList.remove("full-mode", "finished", "dissolved");
    panel.classList.add("visible");

    displayStorySentence(0);
    updateStoryTextControls();

    window.setTimeout(() => {
      if (state.storyId === story.id && !state.isFullMode) {
        playStoryText();
      }
    }, 900);
  }

  function splitStoryTextIntoSentences(text) {
    const normalizedText = String(text || "")
      .replace(/\r/g, "")
      .replace(/\n{2,}/g, "\n")
      .trim();

    if (!normalizedText) {
      return [];
    }

    const paragraphParts = normalizedText
      .split(/\n+/)
      .map(part => part.trim())
      .filter(Boolean);

    const sentences = [];

    paragraphParts.forEach(part => {
      const matches = part.match(/[^.!?؟。]+[.!?؟。…]*|.+/g);

      if (matches && matches.length) {
        matches.forEach(match => {
          const cleaned = match.trim();

          if (cleaned) {
            sentences.push(cleaned);
          }
        });
      } else if (part) {
        sentences.push(part);
      }
    });

    return sentences.length ? sentences : [normalizedText];
  }

  function displayStorySentence(index) {
    const sentenceElement = document.getElementById("story-text-sentence");
    const panel = document.getElementById(TEXT_PANEL_ID);

    if (!sentenceElement || !panel || !state.sentences.length) {
      return;
    }

    state.currentIndex = Math.max(
      0,
      Math.min(index, state.sentences.length - 1)
    );

    panel.classList.remove("full-mode", "finished", "dissolved");

    sentenceElement.classList.remove("entering");
    sentenceElement.classList.add("leaving");

    window.setTimeout(() => {
      sentenceElement.textContent = state.sentences[state.currentIndex];
      sentenceElement.classList.remove("leaving");

      void sentenceElement.offsetWidth;

      sentenceElement.classList.add("entering");

      updateStoryTextControls();
    }, 180);
  }

  function playStoryText() {
    if (!state.sentences.length) {
      return;
    }

    const panel = ensureStoryTextPanel();

    panel.classList.remove("full-mode", "finished", "dissolved");
    panel.classList.add("visible");

    state.isFullMode = false;

    if (state.isFinished || state.currentIndex >= state.sentences.length) {
      state.currentIndex = 0;
      state.isFinished = false;
      displayStorySentence(0);
    }

    state.isPlaying = true;
    updateStoryTextControls();
    scheduleNextStorySentence();
  }

  function pauseStoryTextPlayback() {
    state.isPlaying = false;
    clearStoryTextTimer();
    updateStoryTextControls();
  }

  function toggleStoryTextPlayback() {
    if (state.isPlaying) {
      pauseStoryTextPlayback();
      return;
    }

    if (state.isFullMode) {
      state.isFullMode = false;
      state.currentIndex = 0;
      displayStorySentence(0);
    }

    playStoryText();
  }

  function scheduleNextStorySentence() {
    clearStoryTextTimer();

    if (!state.isPlaying || state.isFullMode || state.isFinished) {
      return;
    }

    const sentence = state.sentences[state.currentIndex] || "";
    const duration = getSentenceDuration(sentence);

    state.timer = window.setTimeout(() => {
      if (!state.isPlaying) {
        return;
      }

      if (state.currentIndex >= state.sentences.length - 1) {
        finishStoryTextPlayback();
      } else {
        state.currentIndex += 1;
        displayStorySentence(state.currentIndex);
        scheduleNextStorySentence();
      }
    }, duration);
  }

  function getSentenceDuration(sentence) {
    const length = String(sentence || "").length;
    return clampStoryTextValue(2600 + length * 48, 3600, 9000);
  }

  function finishStoryTextPlayback() {
    clearStoryTextTimer();

    state.isPlaying = false;
    state.isFinished = true;

    const panel = document.getElementById(TEXT_PANEL_ID);

    if (panel) {
      panel.classList.add("finished");

      window.setTimeout(() => {
        if (state.isFinished && !state.isPlaying && !state.isFullMode) {
          panel.classList.add("dissolved");
        }
      }, 1600);
    }

    updateStoryTextControls();
  }

  function previousStorySentence() {
    if (!state.sentences.length) {
      return;
    }

    pauseStoryTextPlayback();

    state.isFullMode = false;
    state.isFinished = false;
    state.currentIndex = Math.max(0, state.currentIndex - 1);

    displayStorySentence(state.currentIndex);
  }

  function nextStorySentence() {
    if (!state.sentences.length) {
      return;
    }

    pauseStoryTextPlayback();

    state.isFullMode = false;
    state.isFinished = false;
    state.currentIndex = Math.min(
      state.sentences.length - 1,
      state.currentIndex + 1
    );

    displayStorySentence(state.currentIndex);
  }

  function toggleFullStoryText() {
    if (!state.sentences.length) {
      return;
    }

    if (state.isFullMode) {
      state.isFullMode = false;
      state.isFinished = false;
      displayStorySentence(state.currentIndex);
      updateStoryTextControls();
      return;
    }

    showFullStoryText();
  }

  function showFullStoryText() {
    const panel = ensureStoryTextPanel();
    const sentenceElement = document.getElementById("story-text-sentence");

    if (!sentenceElement) {
      return;
    }

    clearStoryTextTimer();

    state.isPlaying = false;
    state.isFullMode = true;
    state.isFinished = false;

    panel.classList.add("visible", "full-mode");
    panel.classList.remove("finished", "dissolved");

    sentenceElement.textContent = state.fullText;
    sentenceElement.classList.remove("leaving");
    sentenceElement.classList.add("entering");

    updateStoryTextControls();
  }

  function updateStoryTextControls() {
    const playButton = document.getElementById("story-text-play");
    const fullButton = document.getElementById("story-text-full");
    const progress = document.getElementById("story-text-progress");
    const count = document.getElementById("story-text-count");

    if (playButton) {
      if (state.isPlaying) {
        playButton.textContent = "Pause";
      } else if (state.isFinished) {
        playButton.textContent = "Replay";
      } else {
        playButton.textContent = "Play";
      }
    }

    if (fullButton) {
      fullButton.textContent = state.isFullMode ? "Sequence" : "Full text";
    }

    if (progress) {
      progress.max = String(Math.max(0, state.sentences.length - 1));
      progress.value = String(state.currentIndex);
      progress.disabled = state.sentences.length <= 1;
    }

    if (count) {
      if (state.isFullMode) {
        count.textContent = "Full";
      } else if (state.sentences.length) {
        count.textContent = `${state.currentIndex + 1} / ${state.sentences.length}`;
      } else {
        count.textContent = "0 / 0";
      }
    }
  }

  function hideStoryTextPanel() {
    clearStoryTextTimer();

    state.storyId = "";
    state.fullText = "";
    state.sentences = [];
    state.currentIndex = 0;
    state.isPlaying = false;
    state.isFullMode = false;
    state.isFinished = false;

    const panel = document.getElementById(TEXT_PANEL_ID);

    if (panel) {
      panel.classList.remove("visible", "full-mode", "finished", "dissolved");
    }
  }

  function clearStoryTextTimer() {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
  }

  function clampStoryTextValue(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  if (typeof updateStoryPanelFinal === "function" && !window.__storyTextFinalWrapped) {
    const originalUpdateStoryPanelFinal = updateStoryPanelFinal;

    updateStoryPanelFinal = function storyTextWrappedFinal(story) {
      originalUpdateStoryPanelFinal(story);
      startStoryTextPanel(story);
    };

    window.__storyTextFinalWrapped = true;
  }

  if (typeof updateStoryPanelCalling === "function" && !window.__storyTextCallingWrapped) {
    const originalUpdateStoryPanelCalling = updateStoryPanelCalling;

    updateStoryPanelCalling = function storyTextWrappedCalling(story) {
      hideStoryTextPanel();
      originalUpdateStoryPanelCalling(story);
    };

    window.__storyTextCallingWrapped = true;
  }

  if (typeof updateStoryPanelTraveling === "function" && !window.__storyTextTravelWrapped) {
    const originalUpdateStoryPanelTraveling = updateStoryPanelTraveling;

    updateStoryPanelTraveling = function storyTextWrappedTraveling(story) {
      hideStoryTextPanel();
      originalUpdateStoryPanelTraveling(story);
    };

    window.__storyTextTravelWrapped = true;
  }

  if (typeof resetView === "function" && !window.__storyTextResetWrapped) {
    const originalResetView = resetView;

    resetView = function storyTextWrappedResetView() {
      hideStoryTextPanel();
      return originalResetView();
    };

    window.__storyTextResetWrapped = true;
  }

  if (typeof goToIranView === "function" && !window.__storyTextIranViewWrapped) {
    const originalGoToIranView = goToIranView;

    goToIranView = function storyTextWrappedIranView() {
      hideStoryTextPanel();
      return originalGoToIranView();
    };

    window.__storyTextIranViewWrapped = true;
  }

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      hideStoryTextPanel();
    }
  });
})();

/* Delay image + text fragments until final Iran close-up */

(function delayFragmentsUntilFinalIranArrival() {
  if (window.__fragmentsDelayedUntilIranArrival) {
    return;
  }

  window.__fragmentsDelayedUntilIranArrival = true;

  function hideEarlyImageAndTextFragments() {
    const imageThumb = document.getElementById("story-image-thumb");

    if (imageThumb) {
      imageThumb.classList.remove("visible");
      imageThumb.classList.add("offscreen");
    }

    const imageModal = document.getElementById("story-image-modal");

    if (imageModal) {
      imageModal.classList.remove("visible");
      imageModal.setAttribute("aria-hidden", "true");
    }

    document.body.classList.remove("story-image-modal-open");

    const textPanel = document.getElementById("story-text-panel");

    if (textPanel) {
      textPanel.classList.remove(
        "visible",
        "full-mode",
        "finished",
        "dissolved"
      );
    }
  }

  function updateFinalPanelTextOnly(story) {
    if (!story) {
      return;
    }

    const title = document.getElementById("story-title");
    const route = document.getElementById("story-route");
    const year = document.getElementById("story-year");
    const quote = document.getElementById("story-quote");

    if (title) {
      title.textContent = `${story.originCity} - ${story.yearLeft}`;
    }

    if (route) {
      route.textContent =
        `${story.destinationCity}, ${story.destinationCountry} → ${story.originCity}, ${story.originCountry}`;
    }

    if (year) {
      year.textContent = `Year: ${story.yearLeft}`;
    }

    if (quote) {
      quote.textContent = story.quote;
    }

    if (typeof updateAttachmentLink === "function") {
      updateAttachmentLink(story);
    }

    if (typeof updateLanguagePanel === "function") {
      updateLanguagePanel(story);
    }
  }

  if (typeof updateStoryPanelFinal === "function") {
    const originalUpdateStoryPanelFinal = updateStoryPanelFinal;

    updateStoryPanelFinal = function delayedFragmentUpdateStoryPanelFinal(story) {
      if (typeof journeyPhase !== "undefined" && journeyPhase !== "arrived") {
        updateFinalPanelTextOnly(story);
        hideEarlyImageAndTextFragments();
        return;
      }

      return originalUpdateStoryPanelFinal(story);
    };
  }

  if (typeof render === "function") {
    const originalRender = render;

    render = function delayedFragmentRender() {
      const result = originalRender();

      if (typeof journeyPhase !== "undefined" && journeyPhase !== "arrived") {
        hideEarlyImageAndTextFragments();
      }

      return result;
    };
  }
})();

/* Refined call sound + delicate route signal */

(function refineCallSoundAndRouteLine() {
  const PHONE_BEEP_VOLUME = 0.046;
  const PHONE_BEEP_INTERVAL = 1650;
  const PHONE_BEEP_DURATION = 0.38;
  const PHONE_BEEP_GAP = 520;

  function makePhoneTone(context, delaySeconds = 0) {
    const startTime = context.currentTime + delaySeconds;
    const endTime = startTime + PHONE_BEEP_DURATION;

    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(PHONE_BEEP_VOLUME, startTime + 0.035);
    gain.gain.setValueAtTime(PHONE_BEEP_VOLUME, endTime - 0.055);
    gain.gain.exponentialRampToValueAtTime(0.0001, endTime);

    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(520, startTime);
    filter.Q.setValueAtTime(5.5, startTime);

    const oscillatorA = context.createOscillator();
    oscillatorA.type = "sine";
    oscillatorA.frequency.setValueAtTime(440, startTime);

    const oscillatorB = context.createOscillator();
    oscillatorB.type = "sine";
    oscillatorB.frequency.setValueAtTime(480, startTime);

    oscillatorA.connect(filter);
    oscillatorB.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);

    oscillatorA.start(startTime);
    oscillatorB.start(startTime);

    oscillatorA.stop(endTime + 0.04);
    oscillatorB.stop(endTime + 0.04);

    const nodes = {
      oscillatorA,
      oscillatorB,
      filter,
      gain
    };

    window.setTimeout(() => {
      try { oscillatorA.disconnect(); } catch (error) {}
      try { oscillatorB.disconnect(); } catch (error) {}
      try { filter.disconnect(); } catch (error) {}
      try { gain.disconnect(); } catch (error) {}
    }, (delaySeconds + PHONE_BEEP_DURATION + 0.12) * 1000);

    return nodes;
  }

  function playPhoneBeepPair(context, holder) {
    if (!holder || !holder.isActive) {
      return;
    }

    const first = makePhoneTone(context, 0);
    const second = makePhoneTone(context, PHONE_BEEP_GAP / 1000);

    holder.activeNodes.push(first, second);

    holder.activeNodes = holder.activeNodes.filter(nodeSet => {
      return nodeSet && nodeSet.gain;
    });
  }

  startWaitingBuzz = function startOldPhoneCallingBeep() {
    const context = getAudioContext();

    if (!context) {
      return;
    }

    if (buzzNodes) {
      return;
    }

    const begin = () => {
      if (buzzNodes) {
        return;
      }

      const holder = {
        context,
        timer: null,
        activeNodes: [],
        isActive: true,
        kind: "old-phone-beep"
      };

      buzzNodes = holder;

      playPhoneBeepPair(context, holder);

      holder.timer = window.setInterval(() => {
        playPhoneBeepPair(context, holder);
      }, PHONE_BEEP_INTERVAL);
    };

    if (context.state === "suspended") {
      context.resume()
        .then(begin)
        .catch(error => {
          console.warn("Audio context could not resume.", error);
        });
    } else {
      begin();
    }
  };

  stopWaitingBuzz = function stopOldPhoneCallingBeep() {
    if (!buzzNodes) {
      return;
    }

    const nodes = buzzNodes;
    buzzNodes = null;

    nodes.isActive = false;

    if (nodes.timer) {
      clearInterval(nodes.timer);
    }

    if (Array.isArray(nodes.activeNodes)) {
      nodes.activeNodes.forEach(nodeSet => {
        try {
          const context = nodes.context;
          const now = context.currentTime;

          if (nodeSet.gain && nodeSet.gain.gain) {
            nodeSet.gain.gain.cancelScheduledValues(now);
            nodeSet.gain.gain.setValueAtTime(0.0001, now);
          }
        } catch (error) {}

        try { nodeSet.oscillatorA && nodeSet.oscillatorA.stop(); } catch (error) {}
        try { nodeSet.oscillatorB && nodeSet.oscillatorB.stop(); } catch (error) {}

        try { nodeSet.oscillatorA && nodeSet.oscillatorA.disconnect(); } catch (error) {}
        try { nodeSet.oscillatorB && nodeSet.oscillatorB.disconnect(); } catch (error) {}
        try { nodeSet.filter && nodeSet.filter.disconnect(); } catch (error) {}
        try { nodeSet.gain && nodeSet.gain.disconnect(); } catch (error) {}
      });
    }

    try { nodes.humA && nodes.humA.stop(); } catch (error) {}
    try { nodes.humB && nodes.humB.stop(); } catch (error) {}
    try { nodes.beep && nodes.beep.stop(); } catch (error) {}
    try { nodes.oscillatorA && nodes.oscillatorA.stop(); } catch (error) {}
    try { nodes.oscillatorB && nodes.oscillatorB.stop(); } catch (error) {}
    try { nodes.lfo && nodes.lfo.stop(); } catch (error) {}
  };

  renderLine = function renderDelicateSignalLine() {
    lineGroup.selectAll("path.connection-line").remove();

    if (!activeStory || !lineVisible || lineProgress <= 0.001) {
      lineGroup.selectAll("path.connection-line-segment").remove();
      lineGroup.selectAll("circle.connection-line-head").remove();
      return;
    }

    const trail = makeSignalTrailSegments(
      activeStory.destinationCoords,
      activeStory.originCoords,
      lineProgress
    );

    if (!trail || !trail.segments.length) {
      lineGroup.selectAll("path.connection-line-segment").remove();
      lineGroup.selectAll("circle.connection-line-head").remove();
      return;
    }

    lineGroup.selectAll("path.connection-line-segment")
      .data(trail.segments, d => d.key)
      .join(
        enter => enter.append("path")
          .attr("class", "connection-line-segment")
          .attr("d", d => d.pathD)
          .style("opacity", 0),
        update => update
          .attr("d", d => d.pathD),
        exit => exit.remove()
      )
      .style("opacity", d => d.opacity * lineOpacity)
      .style("stroke-width", d => d.width);

    const showHead =
      journeyPhase === "travel" ||
      journeyPhase === "calling";

    const headData =
      showHead && trail.head
        ? [trail.head]
        : [];

    lineGroup.selectAll("circle.connection-line-head")
      .data(headData)
      .join(
        enter => enter.append("circle")
          .attr("class", "connection-line-head")
          .attr("r", 3.2)
          .attr("cx", d => d.x)
          .attr("cy", d => d.y)
          .style("opacity", 0),
        update => update
          .attr("cx", d => d.x)
          .attr("cy", d => d.y),
        exit => exit.remove()
      )
      .style("opacity", 0.96 * lineOpacity);

    applyArtPass2Styles();
  };

  function makeSignalTrailSegments(startCoords, endCoords, progress) {
    const safeProgress = clamp(progress, 0.001, 1);

    const start = projection(startCoords);
    const end = projection(endCoords);

    if (!start || !end) {
      return null;
    }

    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (!Number.isFinite(distance) || distance < 1) {
      return null;
    }

    const midpoint = [
      (start[0] + end[0]) / 2,
      (start[1] + end[1]) / 2
    ];

    const perpendicular = [
      -dy / distance,
      dx / distance
    ];

    const lift = Math.min(180, Math.max(80, distance * 0.28));

    const controlA = [
      midpoint[0] + perpendicular[0] * lift,
      midpoint[1] + perpendicular[1] * lift
    ];

    const controlB = [
      midpoint[0] - perpendicular[0] * lift,
      midpoint[1] - perpendicular[1] * lift
    ];

    const control = controlA[1] > controlB[1] ? controlA : controlB;

    const segmentCount = Math.max(9, Math.ceil(46 * safeProgress));
    const segments = [];

    for (let i = 0; i < segmentCount; i++) {
      const t0 = (safeProgress * i) / segmentCount;
      const t1 = (safeProgress * (i + 1)) / segmentCount;

      const p0 = quadraticPoint(start, control, end, t0);
      const p1 = quadraticPoint(start, control, end, t1);

      const relativeToHead = (i + 1) / segmentCount;

      const opacity =
        0.035 +
        Math.pow(relativeToHead, 2.15) * 0.92;

      const width =
        0.62 +
        Math.pow(relativeToHead, 1.7) * 1.22;

      segments.push({
        key: i,
        pathD: `M${p0[0]},${p0[1]} L${p1[0]},${p1[1]}`,
        opacity,
        width
      });
    }

    const headPoint = quadraticPoint(start, control, end, safeProgress);

    return {
      segments,
      head: {
        x: headPoint[0],
        y: headPoint[1]
      }
    };
  }

  if (typeof render === "function") {
    render();
  }
})();
/* Lantern cursor
   A small dot follows the pointer, changes/blinks on click,
   and casts a soft light radius over the dark map.
*/

(function setupLanternCursor() {
  if (window.__lanternCursorReady) {
    return;
  }

  window.__lanternCursorReady = true;

  const supportsFinePointer = window.matchMedia(
    "(hover: hover) and (pointer: fine)"
  );

  if (!supportsFinePointer.matches) {
    return;
  }

  const root = document.documentElement;

  const glow = document.createElement("div");
  glow.className = "lantern-cursor-glow";
  glow.setAttribute("aria-hidden", "true");

  const dot = document.createElement("div");
  dot.className = "lantern-cursor-dot";
  dot.setAttribute("aria-hidden", "true");

  document.body.appendChild(glow);
  document.body.appendChild(dot);

  let latestX = window.innerWidth / 2;
  let latestY = window.innerHeight / 2;
  let frameRequested = false;
  let clickTimer = null;

  const interactiveSelector = [
    "a",
    "button",
    "summary",
    "input",
    "textarea",
    "select",
    "[role='button']",
    ".map-point",
    ".story-button",
    ".iran-scatter-cloud-item",
    ".fixed-memory-cloud-item",
    ".memory-cloud-item",
    ".story-image-thumb",
    ".story-image-modal-close",
    ".story-text-controls button",
    ".audio-dock",
    ".nav-action-button",
    ".call-room-dropdown"
  ].join(",");

  root.classList.add("lantern-cursor-ready");
  root.classList.add("lantern-cursor-hidden");

  function updateCursorPosition() {
    frameRequested = false;

    root.style.setProperty("--lantern-x", `${latestX}px`);
    root.style.setProperty("--lantern-y", `${latestY}px`);
  }

  function requestCursorUpdate() {
    if (frameRequested) {
      return;
    }

    frameRequested = true;
    requestAnimationFrame(updateCursorPosition);
  }

  function handlePointerMove(event) {
    if (event.pointerType && event.pointerType !== "mouse") {
      return;
    }

    latestX = event.clientX;
    latestY = event.clientY;

    root.classList.remove("lantern-cursor-hidden");

    const target = event.target;
    const isInteractive =
      target &&
      typeof target.closest === "function" &&
      target.closest(interactiveSelector);

    root.classList.toggle("lantern-cursor-hovering", Boolean(isInteractive));

    requestCursorUpdate();
  }

  function handlePointerDown(event) {
    if (event.pointerType && event.pointerType !== "mouse") {
      return;
    }

    root.classList.add("lantern-cursor-clicking");

    if (clickTimer) {
      clearTimeout(clickTimer);
    }

    clickTimer = window.setTimeout(() => {
      root.classList.remove("lantern-cursor-clicking");
    }, 420);
  }

  function handlePointerUp() {
    if (clickTimer) {
      clearTimeout(clickTimer);
    }

    clickTimer = window.setTimeout(() => {
      root.classList.remove("lantern-cursor-clicking");
    }, 160);
  }

  function hideCursorIfLeavingWindow(event) {
    if (!event.relatedTarget && !event.toElement) {
      root.classList.add("lantern-cursor-hidden");
      root.classList.remove("lantern-cursor-hovering");
      root.classList.remove("lantern-cursor-clicking");
    }
  }

  function showCursorAgain() {
    root.classList.remove("lantern-cursor-hidden");
  }

  document.addEventListener("pointermove", handlePointerMove, { passive: true });
  document.addEventListener("pointerdown", handlePointerDown, { passive: true });
  document.addEventListener("pointerup", handlePointerUp, { passive: true });
  document.addEventListener("pointercancel", handlePointerUp, { passive: true });

  window.addEventListener("mouseout", hideCursorIfLeavingWindow, { passive: true });
  window.addEventListener("mouseenter", showCursorAgain, { passive: true });

  updateCursorPosition();
})();
/* Live title dot + quote
   Turns the first "i" in Missing Geographies into a blinking point.
   When the lantern/cursor comes close, a minimal quote box appears.
*/

(function setupLiveTitleDotQuote() {
  if (window.__liveTitleDotQuoteReady) {
    return;
  }

  window.__liveTitleDotQuoteReady = true;

  const quoteText =
    "The dead beat against the sides of their tombs with their bodies full of stories and memories, bodies deprived of funerals. Poetry is no more than this, a passion for telling. Poetry is a gesture of memory intended to cover absence, an extension of the truth. Poetry requires that they be named and found.";

  const quoteAuthor = "Marjorie Agosin";

  const state = {
    marker: null,
    quoteBox: null,
    visible: false,
    hideTimer: null,
    lastX: 0,
    lastY: 0
  };

  function initializeLiveTitleDot() {
    const title = document.querySelector(".site-header h1");

    if (!title) {
      window.setTimeout(initializeLiveTitleDot, 400);
      return;
    }

    if (title.querySelector(".title-live-i")) {
      state.marker = title.querySelector(".title-live-i");
      ensureQuoteBox();
      return;
    }

    const originalText =
      title.dataset.originalTitleText ||
      title.textContent ||
      "Missing Geographies";

    title.dataset.originalTitleText = originalText;
    title.setAttribute("aria-label", originalText);

    const firstIIndex = originalText.toLowerCase().indexOf("i");

    if (firstIIndex === -1) {
      return;
    }

    const before = originalText.slice(0, firstIIndex);
    const liveI = originalText.slice(firstIIndex, firstIIndex + 1);
    const after = originalText.slice(firstIIndex + 1);

    title.innerHTML = "";

    if (before) {
      title.appendChild(document.createTextNode(before));
    }

    const marker = document.createElement("span");
    marker.className = "title-live-i";
    marker.textContent = liveI;
    marker.tabIndex = 0;
    marker.setAttribute("role", "button");
    marker.setAttribute("aria-label", "Read memory quote");

    title.appendChild(marker);

    if (after) {
      title.appendChild(document.createTextNode(after));
    }

    const header = document.querySelector(".site-header");

    if (header) {
      header.classList.add("title-live-enabled");
    }

    state.marker = marker;

    ensureQuoteBox();
    bindTitleDotEvents();
  }

  function ensureQuoteBox() {
    let quoteBox = document.getElementById("title-memory-quote");

    if (!quoteBox) {
      quoteBox = document.createElement("aside");
      quoteBox.id = "title-memory-quote";
      quoteBox.className = "title-memory-quote";
      quoteBox.setAttribute("aria-hidden", "true");

      quoteBox.innerHTML = `
        <p>${escapeTitleQuoteHtml(quoteText)}</p>
        <cite>— ${escapeTitleQuoteHtml(quoteAuthor)}</cite>
      `;

      document.body.appendChild(quoteBox);
    }

    state.quoteBox = quoteBox;
    positionQuoteBox();
  }

  function bindTitleDotEvents() {
    if (!state.marker || state.marker.dataset.liveTitleBound === "yes") {
      return;
    }

    state.marker.dataset.liveTitleBound = "yes";

    state.marker.addEventListener("focus", () => {
      showQuoteBox();
    });

    state.marker.addEventListener("blur", () => {
      scheduleHideQuoteBox();
    });

    state.marker.addEventListener("click", event => {
      event.stopPropagation();

      if (state.visible) {
        hideQuoteBox();
      } else {
        showQuoteBox();
      }
    });

    document.addEventListener("pointermove", handlePointerMove, { passive: true });

    document.addEventListener("pointerdown", event => {
      if (
        state.visible &&
        state.quoteBox &&
        !state.quoteBox.contains(event.target) &&
        state.marker &&
        !state.marker.contains(event.target)
      ) {
        hideQuoteBox();
      }
    });

    window.addEventListener("resize", positionQuoteBox);

    window.addEventListener("mouseout", event => {
      if (!event.relatedTarget && !event.toElement) {
        hideQuoteBox();
      }
    });
  }

  function handlePointerMove(event) {
    if (!state.marker || !state.quoteBox) {
      return;
    }

    state.lastX = event.clientX;
    state.lastY = event.clientY;

    const markerRect = state.marker.getBoundingClientRect();
    const quoteRect = state.quoteBox.getBoundingClientRect();

    const nearMarker = isPointNearRect(event.clientX, event.clientY, markerRect, 24);
    const insideQuote = isPointNearRect(event.clientX, event.clientY, quoteRect, 6);

    if (nearMarker || insideQuote) {
      showQuoteBox();
    } else if (state.visible) {
      scheduleHideQuoteBox();
    }
  }

  function isPointNearRect(x, y, rect, padding) {
    return (
      x >= rect.left - padding &&
      x <= rect.right + padding &&
      y >= rect.top - padding &&
      y <= rect.bottom + padding
    );
  }

  function showQuoteBox() {
    if (!state.quoteBox || !state.marker) {
      return;
    }

    clearHideTimer();
    positionQuoteBox();

    state.visible = true;
    state.marker.classList.add("is-awake");
    state.quoteBox.classList.add("visible");
    state.quoteBox.setAttribute("aria-hidden", "false");
    document.documentElement.classList.add("title-quote-visible");
  }

  function scheduleHideQuoteBox() {
    clearHideTimer();

    state.hideTimer = window.setTimeout(() => {
      if (!state.quoteBox || !state.marker) {
        return;
      }

      const markerRect = state.marker.getBoundingClientRect();
      const quoteRect = state.quoteBox.getBoundingClientRect();

      const stillNear =
        isPointNearRect(state.lastX, state.lastY, markerRect, 24) ||
        isPointNearRect(state.lastX, state.lastY, quoteRect, 6);

      if (!stillNear && document.activeElement !== state.marker) {
        hideQuoteBox();
      }
    }, 260);
  }

  function hideQuoteBox() {
    clearHideTimer();

    state.visible = false;

    if (state.marker) {
      state.marker.classList.remove("is-awake");
    }

    if (state.quoteBox) {
      state.quoteBox.classList.remove("visible");
      state.quoteBox.setAttribute("aria-hidden", "true");
    }

    document.documentElement.classList.remove("title-quote-visible");
  }

  function clearHideTimer() {
    if (state.hideTimer) {
      clearTimeout(state.hideTimer);
      state.hideTimer = null;
    }
  }

  function positionQuoteBox() {
    if (!state.marker || !state.quoteBox) {
      return;
    }

    const markerRect = state.marker.getBoundingClientRect();
    const quoteBox = state.quoteBox;

    const width = Math.min(390, window.innerWidth - 34);
    quoteBox.style.width = `${width}px`;

    const preferredLeft = markerRect.left + markerRect.width / 2 - width * 0.18;
    const preferredTop = markerRect.bottom + 18;

    const left = clampTitleQuoteValue(
      preferredLeft,
      17,
      Math.max(17, window.innerWidth - width - 17)
    );

    const boxHeight = quoteBox.offsetHeight || 190;

    let top = preferredTop;

    if (top + boxHeight > window.innerHeight - 22) {
      top = markerRect.top - boxHeight - 18;
    }

    top = clampTitleQuoteValue(
      top,
      74,
      Math.max(74, window.innerHeight - boxHeight - 22)
    );

    quoteBox.style.left = `${left}px`;
    quoteBox.style.top = `${top}px`;
  }

  function clampTitleQuoteValue(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function escapeTitleQuoteHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  initializeLiveTitleDot();
})();
/* ==========================================================
   CITY CLUSTER → CONSTELLATION BLOOM

   Solves overlapping diaspora points when multiple contributors
   share the same current/destination city.

   Behavior:
   - 1 story in a city: point starts the call directly.
   - 2+ stories in a city: one clustered ember appears.
   - Click clustered ember: it blooms into small story embers.
   - Click one story ember: that specific call begins.
   - Click outside / Escape: bloom closes.

   This does not change true coordinates. It only separates stories
   visually on the screen, so the geography stays honest.
   ========================================================== */

(function setupDestinationCityClusters() {
  if (window.__destinationCityClustersReady) {
    return;
  }

  window.__destinationCityClustersReady = true;

  let openDestinationClusterKey = null;
  let latestDestinationClusters = [];

  const clusterBloomGroup = svg.append("g")
    .attr("class", "cluster-bloom-layer");

  function canonicalText(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function destinationClusterKey(story) {
    const lng = Number(story.destinationCoords?.[0]);
    const lat = Number(story.destinationCoords?.[1]);

    /*
      Rounded coordinates keep New York / New York City together
      if the geocoder returns tiny coordinate differences.
    */
    const coordinateKey =
      Number.isFinite(lng) && Number.isFinite(lat)
        ? `${lng.toFixed(3)},${lat.toFixed(3)}`
        : `${canonicalText(story.destinationCity)}|${canonicalText(story.destinationCountry)}`;

    return coordinateKey;
  }

  function makeDestinationClusters() {
    const map = new Map();

    stories.forEach(story => {
      const key = destinationClusterKey(story);

      if (!map.has(key)) {
        map.set(key, {
          key,
          type: "destination-cluster",
          coords: story.destinationCoords,
          destinationCity: story.destinationCity,
          destinationCountry: story.destinationCountry,
          stories: []
        });
      }

      map.get(key).stories.push(story);
    });

    return Array.from(map.values()).map(cluster => {
      cluster.count = cluster.stories.length;
      cluster.story = cluster.stories[0];

      cluster.stories.sort((a, b) => {
        const yearA = String(a.yearLeft || "");
        const yearB = String(b.yearLeft || "");

        if (yearA !== yearB) {
          return yearA.localeCompare(yearB);
        }

        return String(a.originCity || "").localeCompare(String(b.originCity || ""));
      });

      return cluster;
    });
  }

  function clusterPointRadius(cluster) {
    if (cluster.type === "origin") {
      return pointRadius(cluster);
    }

    if (cluster.count <= 1) {
      return 4.4;
    }

    return Math.min(8.8, 5.15 + Math.sqrt(cluster.count) * 1.1);
  }

  function destinationClusterClass(cluster) {
    const isOpen = openDestinationClusterKey === cluster.key;
    const isActive =
      activeStory &&
      cluster.stories &&
      cluster.stories.some(story => story.id === activeStory.id);

    return [
      "map-point",
      "destination-cluster",
      cluster.count > 1 ? "multi" : "single",
      isOpen ? "cluster-open" : "",
      isActive ? "active" : ""
    ].join(" ");
  }

  function updateDestinationClusterTitle(selection) {
    selection.each(function updateTitle(d) {
      let title = d3.select(this).select("title");

      if (title.empty()) {
        title = d3.select(this).append("title");
      }

      if (d.type === "origin") {
        title.text(`${d.story.originCity} — ${d.story.yearLeft}`);
        return;
      }

      if (d.count > 1) {
        title.text(
          `${d.destinationCity}, ${d.destinationCountry}: ${d.count} calls. Click to open.`
        );
      } else {
        const story = d.stories[0];

        title.text(
          `${story.destinationCity}, ${story.destinationCountry} → ${story.originCity}, Iran`
        );
      }
    });
  }

  /*
    Replace the old point renderer.
    The old version rendered every story as its own diaspora point.
    This version renders one point per destination city/coordinate.
  */
  renderPoints = function renderClusteredDestinationPoints() {
    const destinationClusters = makeDestinationClusters();

    latestDestinationClusters = destinationClusters;

    const homePoint = shouldShowHomePoint()
      ? [{
          type: "origin",
          key: `origin-${activeStory.id}`,
          story: activeStory,
          coords: activeStory.originCoords
        }]
      : [];

    const points = [
      ...destinationClusters,
      ...homePoint
    ];

    const circles = pointGroup.selectAll("circle.map-point")
      .data(points, d => d.key || `${d.story?.id}-${d.type}`)
      .join(
        enter => enter.append("circle")
          .attr("class", d => {
            if (d.type === "origin") {
              return pointClass(d);
            }

            return destinationClusterClass(d);
          })
          .attr("r", d => clusterPointRadius(d))
          .attr("cx", d => projectedX(d.coords))
          .attr("cy", d => projectedY(d.coords))
          .style("display", d => isVisible(d.coords) ? null : "none"),
        update => update
          .attr("class", d => {
            if (d.type === "origin") {
              return pointClass(d);
            }

            return destinationClusterClass(d);
          })
          .attr("r", d => clusterPointRadius(d))
          .attr("cx", d => projectedX(d.coords))
          .attr("cy", d => projectedY(d.coords))
          .style("display", d => isVisible(d.coords) ? null : "none"),
        exit => exit.remove()
      );

    updateDestinationClusterTitle(circles);

    circles
      .on("pointerdown", (event, d) => {
        if (isJourneyAnimating) {
          return;
        }

        event.stopPropagation();

        /*
          Do not start the call beep merely by opening a cluster.
          The beep begins only when a specific story is selected.
        */
        if (d.type === "destination-cluster" && d.count > 1) {
          return;
        }

        startWaitingBuzz();
      })
      .on("click", (event, d) => {
        event.stopPropagation();

        if (isJourneyAnimating) {
          return;
        }

        if (d.type === "origin") {
          return;
        }

        if (d.count > 1) {
          toggleDestinationCluster(d.key);
          return;
        }

        openDestinationClusterKey = null;
        selectStory(d.stories[0], { keepBuzz: true });
      });

    renderClusterCounts(destinationClusters);
    renderDestinationClusterBloom();
  };

  function renderClusterCounts(destinationClusters) {
    const visibleClusters = destinationClusters.filter(cluster => {
      return cluster.count > 1 && isVisible(cluster.coords);
    });

    pointGroup.selectAll("text.cluster-count")
      .data(visibleClusters, d => d.key)
      .join(
        enter => enter.append("text")
          .attr("class", "cluster-count")
          .attr("x", d => projectedX(d.coords) + clusterPointRadius(d) + 4)
          .attr("y", d => projectedY(d.coords) - clusterPointRadius(d) - 2)
          .text(d => d.count),
        update => update
          .attr("x", d => projectedX(d.coords) + clusterPointRadius(d) + 4)
          .attr("y", d => projectedY(d.coords) - clusterPointRadius(d) - 2)
          .text(d => d.count),
        exit => exit.remove()
      );
  }

  function toggleDestinationCluster(key) {
    if (openDestinationClusterKey === key) {
      openDestinationClusterKey = null;
    } else {
      openDestinationClusterKey = key;
    }

    render();
  }

  function closeDestinationCluster(shouldRender = true) {
    if (!openDestinationClusterKey) {
      return;
    }

    openDestinationClusterKey = null;

    if (shouldRender && typeof render === "function") {
      render();
    }
  }

  function getOpenDestinationCluster() {
    if (!openDestinationClusterKey) {
      return null;
    }

    return latestDestinationClusters.find(cluster => {
      return cluster.key === openDestinationClusterKey;
    }) || null;
  }

  function getBloomRingSize(cluster) {
    const mobile = window.matchMedia("(max-width: 760px)").matches;

    if (mobile) {
      return 47;
    }

    if (cluster.count <= 3) {
      return 36;
    }

    if (cluster.count <= 6) {
      return 43;
    }

    return 50;
  }

  function makeBloomPlacements(cluster) {
    const center = projection(cluster.coords);

    if (!center) {
      return [];
    }

    const baseRadius = getBloomRingSize(cluster);
    const maxPerRing = 8;

    return cluster.stories.map((story, index) => {
      const ring = Math.floor(index / maxPerRing);
      const indexInRing = index % maxPerRing;
      const remainingInRing = cluster.stories.length - ring * maxPerRing;
      const countInRing = Math.min(maxPerRing, remainingInRing);
      const angleOffset = ring * 0.34;
      const angle =
        -Math.PI / 2 +
        angleOffset +
        (Math.PI * 2 * indexInRing) / countInRing;

      const radius = baseRadius + ring * 24;

      const x = center[0] + Math.cos(angle) * radius;
      const y = center[1] + Math.sin(angle) * radius;

      const labelIsRight = x >= center[0];

      return {
        key: story.id,
        story,
        cluster,
        centerX: center[0],
        centerY: center[1],
        x,
        y,
        labelX: x + (labelIsRight ? 9 : -9),
        labelY: y + 4,
        labelAnchor: labelIsRight ? "start" : "end",
        index,
        angle,
        radius
      };
    });
  }

  function renderDestinationClusterBloom() {
    const cluster = getOpenDestinationCluster();

    if (
      !cluster ||
      cluster.count <= 1 ||
      isJourneyAnimating ||
      !isVisible(cluster.coords)
    ) {
      clusterBloomGroup.selectAll("*").remove();
      return;
    }

    const placements = makeBloomPlacements(cluster);

    if (!placements.length) {
      clusterBloomGroup.selectAll("*").remove();
      return;
    }

    const center = projection(cluster.coords);
    const outerRadius =
      Math.max(...placements.map(placement => placement.radius)) + 14;

    clusterBloomGroup.selectAll("circle.cluster-bloom-halo")
      .data([cluster], d => d.key)
      .join(
        enter => enter.append("circle")
          .attr("class", "cluster-bloom-halo")
          .attr("cx", center[0])
          .attr("cy", center[1])
          .attr("r", 0),
        update => update
          .attr("cx", center[0])
          .attr("cy", center[1]),
        exit => exit.remove()
      )
      .transition()
      .duration(260)
      .attr("r", outerRadius);

    clusterBloomGroup.selectAll("line.cluster-bloom-thread")
      .data(placements, d => d.key)
      .join(
        enter => enter.append("line")
          .attr("class", "cluster-bloom-thread")
          .attr("x1", d => d.centerX)
          .attr("y1", d => d.centerY)
          .attr("x2", d => d.centerX)
          .attr("y2", d => d.centerY),
        update => update,
        exit => exit.remove()
      )
      .attr("x1", d => d.centerX)
      .attr("y1", d => d.centerY)
      .attr("x2", d => d.x)
      .attr("y2", d => d.y);

    const bloomPoints = clusterBloomGroup.selectAll("circle.cluster-bloom-point")
      .data(placements, d => d.key)
      .join(
        enter => enter.append("circle")
          .attr("class", "cluster-bloom-point")
          .attr("r", 0)
          .attr("cx", d => d.centerX)
          .attr("cy", d => d.centerY),
        update => update,
        exit => exit
          .transition()
          .duration(180)
          .attr("r", 0)
          .style("opacity", 0)
          .remove()
      )
      .attr("cx", d => d.x)
      .attr("cy", d => d.y)
      .attr("r", 4.1)
      .style("transition-delay", d => `${d.index * 24}ms`);

    bloomPoints.each(function updateBloomTitle(d) {
      let title = d3.select(this).select("title");

      if (title.empty()) {
        title = d3.select(this).append("title");
      }

      title.text(
        `${d.story.person || "Anonymous"} — ${d.story.destinationCity} to ${d.story.originCity}, ${d.story.yearLeft}`
      );
    });

    bloomPoints
      .on("pointerdown", (event, d) => {
        if (isJourneyAnimating) {
          return;
        }

        event.stopPropagation();
        startWaitingBuzz();
      })
      .on("click", (event, d) => {
        event.stopPropagation();

        if (isJourneyAnimating) {
          return;
        }

        closeDestinationCluster(false);
        selectStory(d.story, { keepBuzz: true });
      });

    /*
      Show labels only for small clusters.
      For large cities, titles/tooltips prevent visual crowding.
    */
    const labelPlacements =
      cluster.count <= 6
        ? placements
        : [];

    clusterBloomGroup.selectAll("text.cluster-bloom-label")
      .data(labelPlacements, d => d.key)
      .join(
        enter => enter.append("text")
          .attr("class", "cluster-bloom-label")
          .attr("x", d => d.centerX)
          .attr("y", d => d.centerY)
          .style("opacity", 0)
          .text(d => `${d.story.originCity} · ${d.story.yearLeft}`),
        update => update
          .text(d => `${d.story.originCity} · ${d.story.yearLeft}`),
        exit => exit.remove()
      )
      .attr("x", d => d.labelX)
      .attr("y", d => d.labelY)
      .attr("text-anchor", d => d.labelAnchor)
      .style("opacity", 1);
  }

  /*
    Close the bloom when a call actually begins.
  */
  if (typeof selectStory === "function" && !window.__destinationClusterSelectWrapped) {
    const originalSelectStory = selectStory;

    selectStory = function destinationClusterWrappedSelectStory(story, options = {}) {
      closeDestinationCluster(false);
      return originalSelectStory(story, options);
    };

    window.__destinationClusterSelectWrapped = true;
  }

  if (typeof resetView === "function" && !window.__destinationClusterResetWrapped) {
    const originalResetView = resetView;

    resetView = function destinationClusterWrappedResetView() {
      closeDestinationCluster(false);
      return originalResetView();
    };

    window.__destinationClusterResetWrapped = true;
  }

  if (typeof goToIranView === "function" && !window.__destinationClusterIranWrapped) {
    const originalGoToIranView = goToIranView;

    goToIranView = function destinationClusterWrappedIranView() {
      closeDestinationCluster(false);
      return originalGoToIranView();
    };

    window.__destinationClusterIranWrapped = true;
  }

  document.addEventListener("pointerdown", event => {
    if (!openDestinationClusterKey) {
      return;
    }

    const target = event.target;

    if (
      target &&
      typeof target.closest === "function" &&
      target.closest(
        ".destination-cluster, .cluster-bloom-point, .cluster-bloom-label, .cluster-count"
      )
    ) {
      return;
    }

    closeDestinationCluster(true);
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      closeDestinationCluster(true);
    }
  });

  window.addEventListener("resize", () => {
    if (openDestinationClusterKey && typeof render === "function") {
      render();
    }
  });

  /*
    Re-render once after patching, in case the first render already happened.
  */
  if (typeof render === "function") {
    render();
  }
})();
/* ==========================================================
   CALL ROOM AUTO-DISMISS

   Closes the Call Room / Archive dropdown when:
   1. the visitor clicks anywhere outside it
   2. the visitor moves the cursor away from it

   It does not interrupt clicks inside the panel.
   It does not change the call animation, audio, images, subtitles, or map.
   ========================================================== */

(function setupCallRoomOutsideDismiss() {
  if (window.__callRoomOutsideDismissReady) {
    return;
  }

  window.__callRoomOutsideDismissReady = true;

  const POINTER_LEAVE_CLOSE_DELAY = 420;
  const SOFT_CLOSE_DURATION = 230;

  let hoverCloseTimer = null;
  let softCloseTimer = null;

  function getCallRoomDropdown() {
    return document.querySelector(".call-room-dropdown");
  }

  function isCallRoomOpen() {
    const dropdown = getCallRoomDropdown();
    return Boolean(dropdown && dropdown.open);
  }

  function clearHoverCloseTimer() {
    if (hoverCloseTimer) {
      clearTimeout(hoverCloseTimer);
      hoverCloseTimer = null;
    }
  }

  function clearSoftCloseTimer() {
    if (softCloseTimer) {
      clearTimeout(softCloseTimer);
      softCloseTimer = null;
    }
  }

  function cancelCallRoomClose() {
    const dropdown = getCallRoomDropdown();

    clearHoverCloseTimer();
    clearSoftCloseTimer();

    if (dropdown) {
      dropdown.classList.remove("call-room-closing");
    }
  }

  function closeCallRoomDropdown() {
    const dropdown = getCallRoomDropdown();

    if (!dropdown || !dropdown.open) {
      return;
    }

    clearHoverCloseTimer();
    clearSoftCloseTimer();

    dropdown.classList.add("call-room-closing");

    softCloseTimer = window.setTimeout(() => {
      dropdown.open = false;
      dropdown.classList.remove("call-room-closing");
      softCloseTimer = null;
    }, SOFT_CLOSE_DURATION);
  }

  function isPointerInsideCallRoomTarget(target) {
    const dropdown = getCallRoomDropdown();

    return Boolean(
      dropdown &&
      target &&
      target instanceof Node &&
      dropdown.contains(target)
    );
  }

  function isCallRoomStillHoveredOrFocused() {
    const dropdown = getCallRoomDropdown();

    if (!dropdown || !dropdown.open) {
      return false;
    }

    return (
      dropdown.matches(":hover") ||
      dropdown.matches(":focus-within")
    );
  }

  function scheduleCloseAfterPointerLeaves() {
    if (!isCallRoomOpen()) {
      return;
    }

    clearHoverCloseTimer();

    hoverCloseTimer = window.setTimeout(() => {
      if (!isCallRoomStillHoveredOrFocused()) {
        closeCallRoomDropdown();
      }

      hoverCloseTimer = null;
    }, POINTER_LEAVE_CLOSE_DELAY);
  }

  /*
    Click anywhere outside the Call Room closes it.
    Capture phase lets this happen before map interactions,
    but we do not prevent the original click.
  */
  document.addEventListener(
    "pointerdown",
    event => {
      if (!isCallRoomOpen()) {
        return;
      }

      if (isPointerInsideCallRoomTarget(event.target)) {
        cancelCallRoomClose();
        return;
      }

      closeCallRoomDropdown();
    },
    true
  );

  /*
    Moving the cursor away from the panel closes it gently.
    Moving back inside before the delay cancels the close.
  */
  document.addEventListener(
    "pointermove",
    event => {
      if (!isCallRoomOpen()) {
        return;
      }

      if (isPointerInsideCallRoomTarget(event.target)) {
        cancelCallRoomClose();
      } else {
        scheduleCloseAfterPointerLeaves();
      }
    },
    { passive: true }
  );

  /*
    Extra safety for the moment the pointer exits the dropdown/panel.
  */
  document.addEventListener(
    "pointerout",
    event => {
      if (!isCallRoomOpen()) {
        return;
      }

      const dropdown = getCallRoomDropdown();

      if (!dropdown) {
        return;
      }

      const leftCallRoom =
        dropdown.contains(event.target) &&
        (
          !event.relatedTarget ||
          !dropdown.contains(event.relatedTarget)
        );

      if (leftCallRoom) {
        scheduleCloseAfterPointerLeaves();
      }
    },
    true
  );

  /*
    Keyboard / accessibility behavior:
    focusing outside closes the panel; Escape also closes it.
  */
  document.addEventListener("focusin", event => {
    if (!isCallRoomOpen()) {
      return;
    }

    if (isPointerInsideCallRoomTarget(event.target)) {
      cancelCallRoomClose();
    } else {
      closeCallRoomDropdown();
    }
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      closeCallRoomDropdown();
    }
  });

  window.addEventListener("blur", () => {
    clearHoverCloseTimer();
  });
})();
/* ==========================================================
   RELIABLE CALL ROOM CLOSE ON MOUSE LEAVE

   Fixes the case where the Call Room remains open after the
   cursor moves away because the <details> element still has focus.

   Behavior:
   - Keep open while cursor is over the menu title or panel.
   - Keep open while cursor crosses the small gap between them.
   - Close when cursor moves into the open map/empty space.
   - Does not affect clicking inside the panel.
   ========================================================== */

(function setupReliableCallRoomMouseLeaveClose() {
  if (window.__reliableCallRoomMouseLeaveCloseReady) {
    return;
  }

  window.__reliableCallRoomMouseLeaveCloseReady = true;

  const CLOSE_AFTER_LEAVE_MS = 360;
  const SOFT_CLOSE_MS = 230;
  const SAFE_PADDING = 12;

  let leaveTimer = null;
  let closeTimer = null;

  function getDropdown() {
    return document.querySelector(".call-room-dropdown");
  }

  function getSummary(dropdown) {
    return dropdown ? dropdown.querySelector("summary") : null;
  }

  function getPanel(dropdown) {
    return dropdown ? dropdown.querySelector(".story-card") : null;
  }

  function isOpen() {
    const dropdown = getDropdown();
    return Boolean(dropdown && dropdown.open);
  }

  function clearLeaveTimer() {
    if (leaveTimer) {
      clearTimeout(leaveTimer);
      leaveTimer = null;
    }
  }

  function clearCloseTimer() {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
  }

  function pointInsideRect(x, y, rect, padding = 0) {
    if (!rect) {
      return false;
    }

    return (
      x >= rect.left - padding &&
      x <= rect.right + padding &&
      y >= rect.top - padding &&
      y <= rect.bottom + padding
    );
  }

  function pointInsideCallRoomArea(x, y) {
    const dropdown = getDropdown();

    if (!dropdown || !dropdown.open) {
      return false;
    }

    const summary = getSummary(dropdown);
    const panel = getPanel(dropdown);

    const summaryRect = summary ? summary.getBoundingClientRect() : null;
    const panelRect = panel ? panel.getBoundingClientRect() : null;

    if (pointInsideRect(x, y, summaryRect, SAFE_PADDING)) {
      return true;
    }

    if (pointInsideRect(x, y, panelRect, SAFE_PADDING)) {
      return true;
    }

    /*
      Safe bridge between the nav title and the floating panel.
      This prevents the panel from closing while the cursor travels
      through the little gap between them.
    */
    if (summaryRect && panelRect) {
      const bridgeLeft = Math.min(summaryRect.left, panelRect.left) - SAFE_PADDING;
      const bridgeRight = Math.max(summaryRect.right, panelRect.right) + SAFE_PADDING;
      const bridgeTop = Math.min(summaryRect.bottom, panelRect.top) - 4;
      const bridgeBottom = Math.max(summaryRect.bottom, panelRect.top) + SAFE_PADDING + 10;

      if (
        x >= bridgeLeft &&
        x <= bridgeRight &&
        y >= bridgeTop &&
        y <= bridgeBottom
      ) {
        return true;
      }
    }

    return false;
  }

  function cancelScheduledClose() {
    const dropdown = getDropdown();

    clearLeaveTimer();
    clearCloseTimer();

    if (dropdown) {
      dropdown.classList.remove("call-room-closing");
    }
  }

  function closeCallRoom() {
    const dropdown = getDropdown();

    if (!dropdown || !dropdown.open) {
      return;
    }

    clearLeaveTimer();
    clearCloseTimer();

    dropdown.classList.add("call-room-closing");

    closeTimer = window.setTimeout(() => {
      const currentDropdown = getDropdown();

      if (currentDropdown) {
        currentDropdown.open = false;
        currentDropdown.classList.remove("call-room-closing");
      }

      closeTimer = null;
    }, SOFT_CLOSE_MS);
  }

  function scheduleCloseFromMouseLeave() {
    if (!isOpen()) {
      return;
    }

    if (leaveTimer) {
      return;
    }

    leaveTimer = window.setTimeout(() => {
      closeCallRoom();
      leaveTimer = null;
    }, CLOSE_AFTER_LEAVE_MS);
  }

  /*
    This is the important part:
    use the actual mouse coordinates instead of :hover / :focus-within.
  */
  document.addEventListener(
    "pointermove",
    event => {
      if (event.pointerType && event.pointerType !== "mouse") {
        return;
      }

      if (!isOpen()) {
        return;
      }

      if (pointInsideCallRoomArea(event.clientX, event.clientY)) {
        cancelScheduledClose();
      } else {
        scheduleCloseFromMouseLeave();
      }
    },
    { passive: true }
  );

  /*
    If the cursor exits the browser window, close gently too.
  */
  window.addEventListener(
    "mouseout",
    event => {
      if (!isOpen()) {
        return;
      }

      if (!event.relatedTarget && !event.toElement) {
        scheduleCloseFromMouseLeave();
      }
    },
    { passive: true }
  );

  /*
    Keep the already-good outside-click behavior as safety.
    This does not block the click from reaching the map.
  */
  document.addEventListener(
    "pointerdown",
    event => {
      if (!isOpen()) {
        return;
      }

      if (pointInsideCallRoomArea(event.clientX, event.clientY)) {
        cancelScheduledClose();
      } else {
        closeCallRoom();
      }
    },
    true
  );

  /*
    When the dropdown is manually opened again, remove any old closing state.
  */
  document.addEventListener(
    "toggle",
    event => {
      const dropdown = getDropdown();

      if (event.target === dropdown && dropdown.open) {
        cancelScheduledClose();
      }
    },
    true
  );
})();
/* ==========================================================
   IMAGE THUMBNAIL — RIGHT OF IRAN PLACEMENT

   Moves the submitted-image thumbnail outside Iran's border,
   on the right side of the Iran outline, instead of near/inside
   the destination point.

   This does not change the image viewer logic. It only corrects
   the final screen placement after arrival.
   ========================================================== */

(function setupImageThumbnailRightOfIran() {
  if (window.__imageThumbnailRightOfIranReady) {
    return;
  }

  window.__imageThumbnailRightOfIranReady = true;

  let frameRequested = false;
  let observer = null;
  let bodyObserver = null;

  const RIGHT_GAP = 34;
  const VERTICAL_BIAS = -0.06; 
  const PANEL_GAP = 26;
  const EDGE_PADDING = 18;

  function requestThumbnailPosition() {
    if (frameRequested) {
      return;
    }

    frameRequested = true;

    requestAnimationFrame(() => {
      frameRequested = false;
      positionThumbnailRightOfIran();
    });
  }

  function getVisibleTextPanelRect(mapRect) {
    const panel = document.getElementById("story-text-panel");

    if (!panel || !panel.classList.contains("visible")) {
      return null;
    }

    const rect = panel.getBoundingClientRect();

    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    return {
      left: rect.left - mapRect.left,
      right: rect.right - mapRect.left,
      top: rect.top - mapRect.top,
      bottom: rect.bottom - mapRect.top
    };
  }

  function positionThumbnailRightOfIran() {
    const thumb = document.getElementById("story-image-thumb");
    const mapCard = document.querySelector(".map-card");
    const svgNode = document.getElementById("globe");

    if (
      !thumb ||
      !mapCard ||
      !svgNode ||
      !thumb.classList.contains("visible") ||
      typeof projection !== "function" ||
      typeof path !== "function" ||
      typeof iranFeature === "undefined" ||
      !iranFeature
    ) {
      return;
    }

    let bounds;

    try {
      bounds = path.bounds(iranFeature);
    } catch (error) {
      return;
    }

    if (
      !bounds ||
      !Number.isFinite(bounds[0][0]) ||
      !Number.isFinite(bounds[0][1]) ||
      !Number.isFinite(bounds[1][0]) ||
      !Number.isFinite(bounds[1][1])
    ) {
      return;
    }

    const mapRect = mapCard.getBoundingClientRect();

    const scale = Math.min(
      mapRect.width / width,
      mapRect.height / height
    );

    const offsetX = (mapRect.width - width * scale) / 2;
    const offsetY = (mapRect.height - height * scale) / 2;

    const iranRight = offsetX + bounds[1][0] * scale;
    const iranTop = offsetY + bounds[0][1] * scale;
    const iranBottom = offsetY + bounds[1][1] * scale;
    const iranCenterY = (iranTop + iranBottom) / 2;

    const thumbWidth = thumb.offsetWidth || 112;
    const thumbHeight = thumb.offsetHeight || 92;

    const visibleTextPanelRect = getVisibleTextPanelRect(mapRect);

    let rightLimit = mapRect.width - thumbWidth - EDGE_PADDING;

    if (visibleTextPanelRect) {
      rightLimit = Math.min(
        rightLimit,
        visibleTextPanelRect.left - thumbWidth - PANEL_GAP
      );
    }

    /*
      Anchor the thumbnail to the right side of Iran's projected border.
      The vertical bias keeps it slightly above the center, which usually
      feels more intentional and avoids the Shiraz label.
    */
    const desiredLeft = iranRight + RIGHT_GAP;
    const desiredTop =
      iranCenterY +
      (iranBottom - iranTop) * VERTICAL_BIAS -
      thumbHeight / 2;

    const left = clampThumbnailValue(
      desiredLeft,
      EDGE_PADDING,
      Math.max(EDGE_PADDING, rightLimit)
    );

    const top = clampThumbnailValue(
      desiredTop,
      76,
      Math.max(76, mapRect.height - thumbHeight - 120)
    );

    thumb.style.left = `${left}px`;
    thumb.style.top = `${top}px`;
  }

  function clampThumbnailValue(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function observeThumbnail() {
    const thumb = document.getElementById("story-image-thumb");

    if (!thumb || thumb.dataset.rightOfIranObserved === "yes") {
      return;
    }

    thumb.dataset.rightOfIranObserved = "yes";

    observer = new MutationObserver(() => {
      requestThumbnailPosition();
    });

    observer.observe(thumb, {
      attributes: true,
      attributeFilter: ["class", "style", "src"]
    });

    requestThumbnailPosition();
  }

  /*
    The thumbnail is created dynamically, so observe the document
    until it exists.
  */
  bodyObserver = new MutationObserver(() => {
    observeThumbnail();
  });

  bodyObserver.observe(document.body, {
    childList: true,
    subtree: true
  });

  observeThumbnail();

  /*
    Reposition after every map render, because the globe projection changes.
  */
  if (typeof render === "function" && !window.__imageThumbnailRightOfIranRenderWrapped) {
    const originalRender = render;

    render = function imageThumbnailRightOfIranRenderWrapper() {
      const result = originalRender();
      requestThumbnailPosition();
      return result;
    };

    window.__imageThumbnailRightOfIranRenderWrapped = true;
  }

  /*
    Reposition when the text panel appears, because the thumbnail should
    avoid overlapping it.
  */
  const textPanelObserver = new MutationObserver(() => {
    requestThumbnailPosition();
  });

  function observeTextPanel() {
    const textPanel = document.getElementById("story-text-panel");

    if (!textPanel || textPanel.dataset.thumbnailAware === "yes") {
      return;
    }

    textPanel.dataset.thumbnailAware = "yes";

    textPanelObserver.observe(textPanel, {
      attributes: true,
      attributeFilter: ["class", "style"]
    });
  }

  const textPanelBodyObserver = new MutationObserver(() => {
    observeTextPanel();
  });

  textPanelBodyObserver.observe(document.body, {
    childList: true,
    subtree: true
  });

  observeTextPanel();

  window.addEventListener("resize", requestThumbnailPosition);
})();
/* ==========================================================
   IRAN ARRIVAL POINT + PERSIAN CITY LABELS

   - Makes the Iran arrival/home point smaller through pointRadius().
   - Replaces the single active city label with:
       English city — year
       Persian city in Nastaliq underneath
   - Loads Noto Nastaliq Urdu from Google Fonts with system fallbacks.
   ========================================================== */

(function setupPersianIranArrivalLabels() {
  if (window.__persianIranArrivalLabelsReady) {
    return;
  }

  window.__persianIranArrivalLabelsReady = true;

  const PERSIAN_CITY_NAMES = {
    "abadan": "آبادان",
    "adan": "آبادان",
    "ahvaz": "اهواز",
    "arak": "اراک",
    "ardabil": "اردبیل",
    "bandar abbas": "بندرعباس",
    "birjand": "بیرجند",
    "bushehr": "بوشهر",
    "dezful": "دزفول",
    "gorgan": "گرگان",
    "hamadan": "همدان",
    "hamedan": "همدان",
    "isfahan": "اصفهان",
    "esfahan": "اصفهان",
    "karaj": "کرج",
    "kashan": "کاشان",
    "kerman": "کرمان",
    "kermanshah": "کرمانشاه",
    "khorramabad": "خرم‌آباد",
    "mashhad": "مشهد",
    "neyshabur": "نیشابور",
    "nishapur": "نیشابور",
    "qazvin": "قزوین",
    "qom": "قم",
    "rasht": "رشت",
    "sabzevar": "سبزوار",
    "sanandaj": "سنندج",
    "sari": "ساری",
    "semnan": "سمنان",
    "shiraz": "شیراز",
    "tabriz": "تبریز",
    "tehran": "تهران",
    "urmia": "ارومیه",
    "orumiyeh": "ارومیه",
    "yazd": "یزد",
    "zabol": "زابل",
    "zahedan": "زاهدان",
    "zanjan": "زنجان"
  };

  function ensureNastaliqFontLoaded() {
    if (document.getElementById("noto-nastaliq-urdu-font")) {
      return;
    }

    const preconnectGoogle = document.createElement("link");
    preconnectGoogle.rel = "preconnect";
    preconnectGoogle.href = "https://fonts.googleapis.com";

    const preconnectStatic = document.createElement("link");
    preconnectStatic.rel = "preconnect";
    preconnectStatic.href = "https://fonts.gstatic.com";
    preconnectStatic.crossOrigin = "anonymous";

    const fontLink = document.createElement("link");
    fontLink.id = "noto-nastaliq-urdu-font";
    fontLink.rel = "stylesheet";
    fontLink.href =
      "https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;500;600;700&display=swap";

    document.head.appendChild(preconnectGoogle);
    document.head.appendChild(preconnectStatic);
    document.head.appendChild(fontLink);
  }

  function normalizeIranCityName(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/ā/g, "a")
      .replace(/ī/g, "i")
      .replace(/ū/g, "u")
      .replace(/[‌\-–—_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function cityIsAlreadyPersian(value) {
    return /[\u0600-\u06FF]/.test(String(value || ""));
  }

  function getPersianCityName(cityName) {
    const raw = String(cityName || "").trim();

    if (!raw) {
      return "";
    }

    if (cityIsAlreadyPersian(raw)) {
      return raw;
    }

    const normalized = normalizeIranCityName(raw);

    if (PERSIAN_CITY_NAMES[normalized]) {
      return PERSIAN_CITY_NAMES[normalized];
    }

    /*
      Try the first phrase before comma/parentheses if a city arrives as
      "Shiraz, Iran" or "Shiraz (Fars)".
    */
    const simplified = normalizeIranCityName(
      raw
        .split(",")[0]
        .replace(/\(.*?\)/g, "")
    );

    return PERSIAN_CITY_NAMES[simplified] || "";
  }

  function labelX(d) {
    return projectedX(d.coords) + 13;
  }

  function labelY(d) {
    return projectedY(d.coords) + 3;
  }

  function paintMapLabel(selection) {
    selection.each(function paintOneLabel(d) {
      const x = labelX(d);
      const y = labelY(d);
      const text = d3.select(this);

      text
        .attr("x", x)
        .attr("y", y);

      text.selectAll("*").remove();

      text.append("tspan")
        .attr("class", "map-label-primary")
        .attr("x", x)
        .attr("dy", 0)
        .text(d.text);

      if (d.faText) {
        text.append("tspan")
          .attr("class", "map-label-fa")
          .attr("x", x)
          .attr("dy", "1.38em")
          .attr("lang", "fa")
          .attr("direction", "rtl")
          .style("direction", "rtl")
          .style("unicode-bidi", "plaintext")
          .text(d.faText);
      }
    });
  }

  ensureNastaliqFontLoaded();

  /*
    Make only the Iranian arrival/home point smaller.
    Destination points and cluster points stay as they are.
  */
  if (typeof pointRadius === "function" && !window.__iranHomePointRadiusWrapped) {
    const originalPointRadius = pointRadius;

    pointRadius = function smallerGoldenIranHomePoint(d) {
      if (d && d.type === "origin") {
        return 3.6;
      }

      return originalPointRadius(d);
    };

    window.__iranHomePointRadiusWrapped = true;
  }

  /*
    Replace the active label renderer so the Iran arrival label has two lines:
    English city/year + Persian city name underneath.
  */
  if (typeof renderLabels === "function" && !window.__persianIranLabelsWrapped) {
    renderLabels = function renderBilingualIranArrivalLabels() {
      const labels = [];

      if (activeStory && journeyPhase === "calling") {
        labels.push({
          text: activeStory.destinationCity,
          faText: "",
          coords: activeStory.destinationCoords,
          role: "call-label"
        });
      }

      if (
        activeStory &&
        (
          journeyPhase === "line-arrived" ||
          journeyPhase === "line-fade" ||
          journeyPhase === "home-zoom" ||
          journeyPhase === "arrived"
        )
      ) {
        labels.push({
          text: `${activeStory.originCity} - ${activeStory.yearLeft}`,
          faText: getPersianCityName(activeStory.originCity),
          coords: activeStory.originCoords,
          role: "home-label"
        });
      }

      const labelSelection = labelGroup.selectAll("text.map-label")
        .data(labels, d => `${d.text}-${d.role}`)
        .join(
          enter => {
            const entered = enter.append("text")
              .attr("class", d => `map-label ${d.role}`)
              .attr("x", d => labelX(d))
              .attr("y", d => labelY(d))
              .style("opacity", 0)
              .style("display", d => isVisible(d.coords) ? null : "none");

            paintMapLabel(entered);

            entered
              .transition()
              .duration(500)
              .style("opacity", 1);

            return entered;
          },
          update => {
            update
              .attr("class", d => `map-label ${d.role}`)
              .attr("x", d => labelX(d))
              .attr("y", d => labelY(d))
              .style("display", d => isVisible(d.coords) ? null : "none");

            paintMapLabel(update);

            return update;
          },
          exit => exit
            .transition()
            .duration(220)
            .style("opacity", 0)
            .remove()
        );

      paintMapLabel(labelSelection);
    };

    window.__persianIranLabelsWrapped = true;
  }

  if (typeof render === "function") {
    render();
  }
})();
/* ==========================================================
   PALE DIASPORA MARKER TUNE

   Retunes outside-Iran / diaspora city points after every render:
   - smaller destination/city cluster points
   - smaller cluster-bloom points
   - quieter count numbers
   - keeps Iran arrival/home point untouched/golden
   ========================================================== */

(function tunePaleDiasporaMarkers() {
  if (window.__paleDiasporaMarkersTuned) {
    return;
  }

  window.__paleDiasporaMarkersTuned = true;

  function getDiasporaRadius(d) {
    if (!d) {
      return 3.0;
    }

    const count = Number(d.count || 1);

    if (count <= 1) {
      return 2.85;
    }

    /*
      Multiplicity should be shown through the count + glow,
      not through a huge point.
    */
    return Math.min(4.8, 3.15 + Math.sqrt(count) * 0.48);
  }

  function retuneDiasporaMarkers() {
    if (typeof d3 === "undefined") {
      return;
    }

    /*
      Main outside-Iran city / cluster points.
    */
    d3.selectAll("circle.destination-cluster")
      .attr("r", d => getDiasporaRadius(d))
      .attr("fill", d => {
        const count = Number(d && d.count ? d.count : 1);
        return count > 1
          ? "rgba(232, 236, 226, 0.86)"
          : "rgba(226, 231, 224, 0.78)";
      })
      .attr("stroke", "rgba(250, 250, 236, 0.54)")
      .attr("stroke-width", 0.64)
      .style(
        "filter",
        "drop-shadow(0 0 5px rgba(238,242,232,0.34)) drop-shadow(0 0 13px rgba(212,220,216,0.12))"
      );

    /*
      Number beside clustered city points.
    */
    d3.selectAll("text.cluster-count")
      .attr("x", d => {
        if (
          typeof projectedX !== "function" ||
          !d ||
          !d.coords
        ) {
          return null;
        }

        return projectedX(d.coords) + getDiasporaRadius(d) + 3.2;
      })
      .attr("y", d => {
        if (
          typeof projectedY !== "function" ||
          !d ||
          !d.coords
        ) {
          return null;
        }

        return projectedY(d.coords) - getDiasporaRadius(d) - 1.8;
      })
      .attr("fill", "rgba(235, 238, 228, 0.60)")
      .attr("stroke", "rgba(0, 0, 0, 0.70)")
      .attr("stroke-width", 2.2);

    /*
      Bloomed individual story embers.
    */
    d3.selectAll("circle.cluster-bloom-point")
      .attr("r", 3.2)
      .attr("fill", "rgba(232, 236, 226, 0.82)")
      .attr("stroke", "rgba(250, 250, 236, 0.64)")
      .attr("stroke-width", 0.7)
      .style(
        "filter",
        "drop-shadow(0 0 5px rgba(238,242,232,0.42)) drop-shadow(0 0 14px rgba(212,220,216,0.14))"
      );

    /*
      Bloom threads + halo.
    */
    d3.selectAll("line.cluster-bloom-thread")
      .attr("stroke", "rgba(224, 229, 220, 0.13)")
      .attr("stroke-width", 0.45);

    d3.selectAll("circle.cluster-bloom-halo")
      .attr("fill", "rgba(224, 229, 220, 0.018)")
      .attr("stroke", "rgba(235, 238, 228, 0.12)")
      .attr("stroke-width", 0.65);

    /*
      Country borders: pale/ash family.
      Iran remains controlled by .iran-outline styles.
    */
    d3.selectAll("path.country")
      .attr("stroke", "rgba(218, 221, 212, 0.105)")
      .attr("stroke-width", 0.38);

    /*
      Starting country highlight during the call should match the diaspora color,
      not the Iran-gold color.
    */
    d3.selectAll("path.call-country-outline")
      .attr("fill", "rgba(235, 238, 228, 0.030)")
      .attr("stroke", "rgba(235, 238, 228, 0.54)")
      .attr("stroke-width", 1.0)
      .style(
        "filter",
        "drop-shadow(0 0 7px rgba(238,242,232,0.28)) drop-shadow(0 0 16px rgba(212,220,216,0.10))"
      );

    /*
      Re-assert Iran and arrival/home point as golden.
    */
    d3.selectAll("path.iran-outline")
      .attr("stroke", "rgba(241, 210, 120, 0.88)");

    d3.selectAll("circle.map-point.origin, circle.map-point.home-arrival")
      .attr("fill", "rgba(255, 188, 91, 0.92)")
      .attr("stroke", "rgba(255, 239, 194, 0.58)")
      .attr("stroke-width", 0.82)
      .style(
        "filter",
        "drop-shadow(0 0 5px rgba(255,191,91,0.58)) drop-shadow(0 0 13px rgba(255,207,102,0.24))"
      );
  }

  if (typeof render === "function" && !window.__paleDiasporaRenderWrapped) {
    const originalRender = render;

    render = function paleDiasporaRenderWrapper() {
      const result = originalRender();
      retuneDiasporaMarkers();
      return result;
    };

    window.__paleDiasporaRenderWrapped = true;
  }

  retuneDiasporaMarkers();
})();
/* ==========================================================
   MERGED IRAN / CALL ROOM BUTTON

   Turns the Call Room dropdown trigger into a single Iran button:
   - English: Iran
   - Persian: ایران
   Clicking either line:
   - zooms to Iran view
   - opens the Call Room / Archive panel

   The old #reset-view button is hidden but kept in the DOM.
   ========================================================== */

(function setupMergedIranCallRoomButton() {
  if (window.__mergedIranCallRoomButtonReady) {
    return;
  }

  window.__mergedIranCallRoomButtonReady = true;

  function ensureNastaliqFontLoadedForIranButton() {
    if (document.getElementById("noto-nastaliq-urdu-font")) {
      return;
    }

    const preconnectGoogle = document.createElement("link");
    preconnectGoogle.rel = "preconnect";
    preconnectGoogle.href = "https://fonts.googleapis.com";

    const preconnectStatic = document.createElement("link");
    preconnectStatic.rel = "preconnect";
    preconnectStatic.href = "https://fonts.gstatic.com";
    preconnectStatic.crossOrigin = "anonymous";

    const fontLink = document.createElement("link");
    fontLink.id = "noto-nastaliq-urdu-font";
    fontLink.rel = "stylesheet";
    fontLink.href =
      "https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;500;600;700&display=swap";

    document.head.appendChild(preconnectGoogle);
    document.head.appendChild(preconnectStatic);
    document.head.appendChild(fontLink);
  }

  function getIranViewButton() {
    return document.getElementById("reset-view");
  }

  function getCallRoomDropdown() {
    return document.querySelector(".call-room-dropdown");
  }

  function getCallRoomSummary() {
    const dropdown = getCallRoomDropdown();
    return dropdown ? dropdown.querySelector("summary") : null;
  }

  function openCallRoomPanel() {
    const dropdown = getCallRoomDropdown();

    if (!dropdown) {
      return;
    }

    dropdown.classList.remove("call-room-closing");
    dropdown.open = true;
  }

  function runMergedIranAction() {
    /*
      Open before and after the zoom call.
      This protects us from any existing click/close listeners.
    */
    openCallRoomPanel();

    if (typeof goToIranView === "function") {
      goToIranView();
    }

    requestAnimationFrame(openCallRoomPanel);
    window.setTimeout(openCallRoomPanel, 80);
    window.setTimeout(openCallRoomPanel, 360);
  }

  function setupButton() {
    const iranViewButton = getIranViewButton();
    const dropdown = getCallRoomDropdown();
    const summary = getCallRoomSummary();

    if (!dropdown || !summary) {
      window.setTimeout(setupButton, 300);
      return;
    }

    ensureNastaliqFontLoadedForIranButton();

    dropdown.classList.add("iran-merged-dropdown");
    summary.classList.add("iran-merged-summary");

    summary.innerHTML = `
      <span class="iran-merged-en">Iran</span>
      <span class="iran-merged-fa" lang="fa" dir="rtl">ایران</span>
    `;

    summary.setAttribute("aria-label", "Open Iran view and Call Room");
    summary.setAttribute("title", "Iran / ایران");

    /*
      Move the dropdown to exactly where the old Iran view button lived.
      Then hide the old button.
    */
    if (iranViewButton && iranViewButton.parentNode) {
      iranViewButton.parentNode.insertBefore(dropdown, iranViewButton);

      iranViewButton.classList.add("iran-merged-hidden");
      iranViewButton.setAttribute("aria-hidden", "true");
      iranViewButton.setAttribute("tabindex", "-1");
    }

    if (summary.dataset.iranMergedBound === "yes") {
      return;
    }

    summary.dataset.iranMergedBound = "yes";

    summary.addEventListener(
      "click",
      event => {
        event.preventDefault();
        event.stopPropagation();
        runMergedIranAction();
      },
      true
    );

    summary.addEventListener(
      "keydown",
      event => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        runMergedIranAction();
      },
      true
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupButton);
  } else {
    setupButton();
  }
})();
/* ==========================================================
   IRAN VIEW — SLOWER CINEMATIC ZOOM

   Overrides the fast goToIranView() animation.
   The old version used about 1.7 seconds.
   This version uses an adaptive, slower pace:
   - short movement if already near Iran
   - fuller cinematic movement if the globe is far away
   ========================================================== */

(function setupSlowerIranViewAnimation() {
  if (window.__slowerIranViewAnimationReady) {
    return;
  }

  window.__slowerIranViewAnimationReady = true;

  function shortestAngleDistance(a, b) {
    let diff = b - a;

    while (diff > 180) diff -= 360;
    while (diff < -180) diff += 360;

    return Math.abs(diff);
  }

  function getIranViewAnimationDuration(startRotation, targetRotation, startScale, targetScale) {
    const lonDistance = shortestAngleDistance(startRotation[0], targetRotation[0]);
    const latDistance = Math.abs(startRotation[1] - targetRotation[1]);
    const rotationDistance = Math.sqrt(lonDistance * lonDistance + latDistance * latDistance);

    const scaleDistance =
      Math.abs(targetScale - startScale) /
      Math.max(targetScale, startScale, 1);

    /*
      If we are already basically in Iran view, do not force a long animation.
    */
    if (rotationDistance < 2 && scaleDistance < 0.04) {
      return 850;
    }

    /*
      Normal case:
      about 4–5 seconds from the default globe view,
      longer only if the viewer has dragged far away.
    */
    const duration =
      2800 +
      rotationDistance * 8 +
      scaleDistance * 1700;

    return clamp(duration, 3800, 6500);
  }

  function hideOpenMapFragmentsForIranView() {
    const imageThumb = document.getElementById("story-image-thumb");

    if (imageThumb) {
      imageThumb.classList.remove("visible");
      imageThumb.classList.add("offscreen");
    }

    const imageModal = document.getElementById("story-image-modal");

    if (imageModal) {
      imageModal.classList.remove("visible");
      imageModal.setAttribute("aria-hidden", "true");
    }

    document.body.classList.remove("story-image-modal-open");

    const textPanel = document.getElementById("story-text-panel");

    if (textPanel) {
      textPanel.classList.remove(
        "visible",
        "full-mode",
        "finished",
        "dissolved"
      );
    }

    if (typeof d3 !== "undefined") {
      d3.selectAll(".cluster-bloom-layer *").remove();
    }
  }

  goToIranView = function slowerGoToIranView() {
    const token = ++journeyToken;

    stopWaitingBuzz();
    stopAudio();
    hideCallCountry();
    hideOpenMapFragmentsForIranView();

    activeStory = null;
    lineVisible = false;
    lineProgress = 0;
    lineOpacity = 1;
    journeyPhase = "idle";
    isJourneyAnimating = true;
    callCountryOpacity = 0;

    setIdleStoryPanel();
    updateStoryButtons();
    showMemoryCloud();

    const iranFocusCoords = getIranFocusCoords();
    const targetRotation = rotationForCoords(iranFocusCoords);
    const targetScale = getIranFitScale(targetRotation);

    const startRotation = projection.rotate();
    const startScale = currentScale;

    const duration = getIranViewAnimationDuration(
      startRotation,
      targetRotation,
      startScale,
      targetScale
    );

    const start = performance.now();
    const rotationInterpolator = interpolateRotation(startRotation, targetRotation);

    function frame(now) {
      if (!isCurrentJourney(token)) {
        return;
      }

      const rawT = Math.min(1, (now - start) / duration);

      /*
        A softer ease than the previous quick jump.
        Still arrives clearly, but feels less mechanical.
      */
      const easedT = d3.easeCubicInOut(rawT);

      projection.rotate(rotationInterpolator(easedT));

      currentScale = interpolateNumber(
        startScale,
        targetScale,
        easedT
      );

      projection.scale(currentScale);
      render();

      if (rawT < 1) {
        requestAnimationFrame(frame);
      } else {
        isJourneyAnimating = false;
        render();
      }
    }

    requestAnimationFrame(frame);
  };
})();
/* ==========================================================
   CALL ROOM ARCHIVE LABEL CLEANUP

   Changes archive rows from:
     New York → Iran
     Call back to Shiraz

   to:
     New York → Shiraz

   Also keeps future re-rendered archive rows clean.
   ========================================================== */

(function setupCleanCallArchiveLabels() {
  if (window.__cleanCallArchiveLabelsReady) {
    return;
  }

  window.__cleanCallArchiveLabelsReady = true;

  function escapeArchiveHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function getStoryForArchiveButton(button) {
    if (!button || !button.dataset || !Array.isArray(stories)) {
      return null;
    }

    return stories.find(story => story.id === button.dataset.storyId) || null;
  }

  function makeArchiveLabel(story) {
    const fromCity = escapeArchiveHtml(story.destinationCity || "Unknown");
    const toCity = escapeArchiveHtml(story.originCity || "Iran");

    return `
      <strong>${fromCity} → ${toCity}</strong>
    `;
  }

  function refreshCallArchiveLabels() {
    document
      .querySelectorAll(".call-room-dropdown .story-button")
      .forEach(button => {
        const story = getStoryForArchiveButton(button);

        if (!story) {
          return;
        }

        button.innerHTML = makeArchiveLabel(story);
        button.setAttribute(
          "aria-label",
          `${story.destinationCity} to ${story.originCity}`
        );
        button.title = `${story.destinationCity} → ${story.originCity}`;
      });
  }

  /*
    Wrap createStoryButtons so if the archive is regenerated later,
    it still uses the cleaner labels.
  */
  if (typeof createStoryButtons === "function" && !window.__cleanArchiveCreateWrapped) {
    const originalCreateStoryButtons = createStoryButtons;

    createStoryButtons = function cleanArchiveCreateStoryButtons() {
      const result = originalCreateStoryButtons();
      refreshCallArchiveLabels();
      return result;
    };

    window.__cleanArchiveCreateWrapped = true;
  }

  /*
    Run now and shortly after load, because stories arrive asynchronously.
  */
  refreshCallArchiveLabels();
  window.setTimeout(refreshCallArchiveLabels, 300);
  window.setTimeout(refreshCallArchiveLabels, 900);
})();
/* ==========================================================
   MISSING GEOGRAPHIES NAVIGATION DROPDOWN

   Creates one dropdown named “Missing Geographies” containing:
   1. Home
   2. About
   3. Contribute

   It replaces the visible Home / About / Map / Contribute nav row.
   There is no Map item inside the dropdown.

   Opening this dropdown also returns the globe to the default map view,
   using the existing resetView() behavior.
   ========================================================== */

(function setupMissingGeographiesNavDropdown() {
  if (window.__missingGeographiesNavDropdownReady) {
    return;
  }

  window.__missingGeographiesNavDropdownReady = true;

  const CLOSE_AFTER_LEAVE_MS = 360;
  const SOFT_CLOSE_MS = 230;
  const SAFE_PADDING = 12;

  let leaveTimer = null;
  let closeTimer = null;

  const fallbackLinks = [
    {
      key: "home",
      label: "Home",
      href: "https://missinggeographies.commons.gc.cuny.edu/"
    },
    {
      key: "about",
      label: "About",
      href: "https://missinggeographies.commons.gc.cuny.edu/about/"
    },
    {
      key: "contribute",
      label: "Contribute",
      href: "https://missinggeographies.commons.gc.cuny.edu/contribute/"
    }
  ];

  function normalizeNavText(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function getProjectNav() {
    return document.querySelector(".project-nav");
  }

  function getProjectNavActions() {
    let actions = document.querySelector(".project-nav-actions");
    const nav = getProjectNav();

    if (!actions && nav) {
      actions = document.createElement("div");
      actions.className = "project-nav-actions";
      nav.appendChild(actions);
    }

    return actions;
  }

  function getSourceNavLinks() {
    return document.querySelector(".project-nav-links");
  }

  function getIranDropdown() {
    return (
      document.querySelector(".call-room-dropdown.iran-merged-dropdown") ||
      document.querySelector(".call-room-dropdown") ||
      document.getElementById("reset-view")
    );
  }

  function getSitePagesDropdown() {
    return document.querySelector(".site-pages-dropdown");
  }

  function getSitePagesSummary() {
    const dropdown = getSitePagesDropdown();
    return dropdown ? dropdown.querySelector("summary") : null;
  }

  function getSitePagesPanel() {
    const dropdown = getSitePagesDropdown();
    return dropdown ? dropdown.querySelector(".site-pages-card") : null;
  }

  function findExistingLink(key) {
    const sourceLinks = getSourceNavLinks();

    if (!sourceLinks) {
      return null;
    }

    return Array.from(sourceLinks.querySelectorAll("a")).find(link => {
      return normalizeNavText(link.textContent) === key;
    }) || null;
  }

  function buildMenuLinks() {
    return fallbackLinks.map(item => {
      const existingLink = findExistingLink(item.key);

      return {
        key: item.key,
        label: existingLink
          ? existingLink.textContent.trim()
          : item.label,
        href: existingLink
          ? existingLink.href
          : item.href
      };
    });
  }

  function escapeNavHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function closeIranCallRoomDropdown() {
    const callRoomDropdown = document.querySelector(".call-room-dropdown");

    if (callRoomDropdown && callRoomDropdown.open) {
      callRoomDropdown.classList.add("call-room-closing");

      window.setTimeout(() => {
        callRoomDropdown.open = false;
        callRoomDropdown.classList.remove("call-room-closing");
      }, SOFT_CLOSE_MS);
    }
  }

  function returnToMapView() {
    closeIranCallRoomDropdown();

    /*
      This is the “Map” action:
      return the globe to the default map view.
      resetView() already stops audio, clears active story state,
      and restores the default globe rotation/scale.
    */
    if (typeof resetView === "function") {
      resetView();
    }
  }

  function buildDropdown() {
    const nav = getProjectNav();
    const actions = getProjectNavActions();
    const sourceLinks = getSourceNavLinks();

    if (!nav || !actions) {
      window.setTimeout(buildDropdown, 300);
      return;
    }

    if (sourceLinks) {
      sourceLinks.classList.add("site-pages-source-links");
      nav.classList.add("site-pages-menu-ready");
    }

    let dropdown = getSitePagesDropdown();

    if (!dropdown) {
      dropdown = document.createElement("details");
      dropdown.className = "nav-dropdown site-pages-dropdown";

      const summary = document.createElement("summary");
      summary.className = "site-pages-summary";
      summary.setAttribute("aria-label", "Open Missing Geographies navigation");
      summary.innerHTML = `
        <span class="site-pages-summary-text">Missing Geographies</span>
      `;

      const panel = document.createElement("nav");
      panel.className = "site-pages-card";
      panel.setAttribute("aria-label", "Missing Geographies pages");

      const links = buildMenuLinks();

      panel.innerHTML = links.map(link => {
        return `
          <a
            class="site-pages-link site-pages-link-${escapeNavHtml(link.key)}"
            href="${escapeNavHtml(link.href)}"
          >
            <span>${escapeNavHtml(link.label)}</span>
          </a>
        `;
      }).join("");

      dropdown.appendChild(summary);
      dropdown.appendChild(panel);
    } else {
      const panel = dropdown.querySelector(".site-pages-card");

      if (panel) {
        const links = buildMenuLinks();

        panel.innerHTML = links.map(link => {
          return `
            <a
              class="site-pages-link site-pages-link-${escapeNavHtml(link.key)}"
              href="${escapeNavHtml(link.href)}"
            >
              <span>${escapeNavHtml(link.label)}</span>
            </a>
          `;
        }).join("");
      }
    }

    const iranDropdown = getIranDropdown();

    if (iranDropdown && iranDropdown.parentNode) {
      iranDropdown.parentNode.insertBefore(dropdown, iranDropdown);
    } else if (!dropdown.parentNode) {
      actions.appendChild(dropdown);
    }

    bindDropdownEvents(dropdown);
  }

  function clearLeaveTimer() {
    if (leaveTimer) {
      clearTimeout(leaveTimer);
      leaveTimer = null;
    }
  }

  function clearCloseTimer() {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
  }

  function cancelScheduledClose() {
    const dropdown = getSitePagesDropdown();

    clearLeaveTimer();
    clearCloseTimer();

    if (dropdown) {
      dropdown.classList.remove("site-pages-closing");
    }
  }

  function closeDropdown() {
    const dropdown = getSitePagesDropdown();

    if (!dropdown || !dropdown.open) {
      return;
    }

    clearLeaveTimer();
    clearCloseTimer();

    dropdown.classList.add("site-pages-closing");

    closeTimer = window.setTimeout(() => {
      const currentDropdown = getSitePagesDropdown();

      if (currentDropdown) {
        currentDropdown.open = false;
        currentDropdown.classList.remove("site-pages-closing");
      }

      closeTimer = null;
    }, SOFT_CLOSE_MS);
  }

  function openDropdown() {
    const dropdown = getSitePagesDropdown();

    if (!dropdown) {
      return;
    }

    cancelScheduledClose();

    dropdown.open = true;
    dropdown.classList.remove("site-pages-closing");
  }

  function pointInsideRect(x, y, rect, padding = 0) {
    if (!rect) {
      return false;
    }

    return (
      x >= rect.left - padding &&
      x <= rect.right + padding &&
      y >= rect.top - padding &&
      y <= rect.bottom + padding
    );
  }

  function pointInsideDropdownArea(x, y) {
    const dropdown = getSitePagesDropdown();

    if (!dropdown || !dropdown.open) {
      return false;
    }

    const summary = getSitePagesSummary();
    const panel = getSitePagesPanel();

    const summaryRect = summary ? summary.getBoundingClientRect() : null;
    const panelRect = panel ? panel.getBoundingClientRect() : null;

    if (pointInsideRect(x, y, summaryRect, SAFE_PADDING)) {
      return true;
    }

    if (pointInsideRect(x, y, panelRect, SAFE_PADDING)) {
      return true;
    }

    /*
      Safe bridge between the summary and the floating panel,
      so it does not close while the cursor crosses the tiny gap.
    */
    if (summaryRect && panelRect) {
      const bridgeLeft = Math.min(summaryRect.left, panelRect.left) - SAFE_PADDING;
      const bridgeRight = Math.max(summaryRect.right, panelRect.right) + SAFE_PADDING;
      const bridgeTop = Math.min(summaryRect.bottom, panelRect.top) - 4;
      const bridgeBottom = Math.max(summaryRect.bottom, panelRect.top) + SAFE_PADDING + 10;

      if (
        x >= bridgeLeft &&
        x <= bridgeRight &&
        y >= bridgeTop &&
        y <= bridgeBottom
      ) {
        return true;
      }
    }

    return false;
  }

  function scheduleCloseFromMouseLeave() {
    const dropdown = getSitePagesDropdown();

    if (!dropdown || !dropdown.open) {
      return;
    }

    if (leaveTimer) {
      return;
    }

    leaveTimer = window.setTimeout(() => {
      closeDropdown();
      leaveTimer = null;
    }, CLOSE_AFTER_LEAVE_MS);
  }

  function bindDropdownEvents(dropdown) {
    const summary = dropdown.querySelector("summary");

    if (!summary || summary.dataset.missingGeographiesDropdownBound === "yes") {
      return;
    }

    summary.dataset.missingGeographiesDropdownBound = "yes";

    summary.addEventListener(
      "click",
      event => {
        event.preventDefault();
        event.stopPropagation();

        if (dropdown.open) {
          closeDropdown();
          return;
        }

        returnToMapView();
        openDropdown();
      },
      true
    );

    summary.addEventListener(
      "keydown",
      event => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        if (dropdown.open) {
          closeDropdown();
          return;
        }

        returnToMapView();
        openDropdown();
      },
      true
    );
  }

  document.addEventListener(
    "pointerdown",
    event => {
      const dropdown = getSitePagesDropdown();

      if (!dropdown || !dropdown.open) {
        return;
      }

      if (pointInsideDropdownArea(event.clientX, event.clientY)) {
        cancelScheduledClose();
        return;
      }

      closeDropdown();
    },
    true
  );

  document.addEventListener(
    "pointermove",
    event => {
      if (event.pointerType && event.pointerType !== "mouse") {
        return;
      }

      const dropdown = getSitePagesDropdown();

      if (!dropdown || !dropdown.open) {
        return;
      }

      if (pointInsideDropdownArea(event.clientX, event.clientY)) {
        cancelScheduledClose();
      } else {
        scheduleCloseFromMouseLeave();
      }
    },
    { passive: true }
  );

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      closeDropdown();
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", buildDropdown);
  } else {
    buildDropdown();
  }

  window.setTimeout(buildDropdown, 300);
  window.setTimeout(buildDropdown, 900);
})();
/* ==========================================================
   MISSING GEOGRAPHIES DROPDOWN — ANIMATED MAP RETURN

   Fixes the jump when clicking “Missing Geographies.”

   Instead of calling resetView() directly, this:
   - opens the Missing Geographies dropdown
   - clears active call/story state
   - smoothly rotates and zooms back to the default globe view
   - keeps the same dropdown close behavior already created earlier
   ========================================================== */

(function setupAnimatedMissingGeographiesMapReturn() {
  if (window.__animatedMissingGeographiesMapReturnReady) {
    return;
  }

  window.__animatedMissingGeographiesMapReturnReady = true;

  const MAP_RETURN_MIN_DURATION = 2600;
  const MAP_RETURN_MAX_DURATION = 5600;
  const MAP_RETURN_BASE_DURATION = 2800;
  const SOFT_CLOSE_MS = 230;

  function getSitePagesDropdown() {
    return document.querySelector(".site-pages-dropdown");
  }

  function isSitePagesSummaryTarget(target) {
    return Boolean(
      target &&
      typeof target.closest === "function" &&
      target.closest(".site-pages-dropdown > summary.site-pages-summary")
    );
  }

  function openSitePagesDropdown() {
    const dropdown = getSitePagesDropdown();

    if (!dropdown) {
      return;
    }

    dropdown.classList.remove("site-pages-closing");
    dropdown.open = true;
  }

  function closeSitePagesDropdown() {
    const dropdown = getSitePagesDropdown();

    if (!dropdown || !dropdown.open) {
      return;
    }

    dropdown.classList.add("site-pages-closing");

    window.setTimeout(() => {
      dropdown.open = false;
      dropdown.classList.remove("site-pages-closing");
    }, SOFT_CLOSE_MS);
  }

  function closeIranCallRoomDropdown() {
    const dropdown = document.querySelector(".call-room-dropdown");

    if (!dropdown || !dropdown.open) {
      return;
    }

    dropdown.classList.add("call-room-closing");

    window.setTimeout(() => {
      dropdown.open = false;
      dropdown.classList.remove("call-room-closing");
    }, SOFT_CLOSE_MS);
  }

  function shortestAngleDelta(start, end) {
    let diff = end - start;

    while (diff > 180) {
      diff -= 360;
    }

    while (diff < -180) {
      diff += 360;
    }

    return Math.abs(diff);
  }

  function getMapReturnDuration(startRotation, endRotation, startScale, endScale) {
    const lonDistance = shortestAngleDelta(startRotation[0], endRotation[0]);
    const latDistance = Math.abs(startRotation[1] - endRotation[1]);
    const rotationDistance = Math.sqrt(
      lonDistance * lonDistance +
      latDistance * latDistance
    );

    const scaleDistance =
      Math.abs(startScale - endScale) /
      Math.max(startScale, endScale, 1);

    /*
      If already close to the default map view, keep it short.
    */
    if (rotationDistance < 2 && scaleDistance < 0.035) {
      return 700;
    }

    /*
      Slower than the old jump, but not as ceremonious as the Iran arrival.
      It should feel like a graceful return to the map.
    */
    const duration =
      MAP_RETURN_BASE_DURATION +
      rotationDistance * 8 +
      scaleDistance * 1700;

    return clamp(duration, MAP_RETURN_MIN_DURATION, MAP_RETURN_MAX_DURATION);
  }

  function hideMapReturnOverlays() {
    const imageThumb = document.getElementById("story-image-thumb");

    if (imageThumb) {
      imageThumb.classList.remove("visible");
      imageThumb.classList.add("offscreen");
    }

    const imageModal = document.getElementById("story-image-modal");

    if (imageModal) {
      imageModal.classList.remove("visible");
      imageModal.setAttribute("aria-hidden", "true");
    }

    document.body.classList.remove("story-image-modal-open");

    const textPanel = document.getElementById("story-text-panel");

    if (textPanel) {
      textPanel.classList.remove(
        "visible",
        "full-mode",
        "finished",
        "dissolved"
      );
    }

    if (typeof hideMapSubtitles === "function") {
      hideMapSubtitles();
    }

    if (typeof d3 !== "undefined") {
      d3.selectAll(".cluster-bloom-layer *").remove();
    }
  }

  function animateBackToDefaultMapView() {
    const token = ++journeyToken;

    stopWaitingBuzz();
    stopAudio();
    hideCallCountry();
    hideMapReturnOverlays();

    activeStory = null;
    lineVisible = false;
    lineProgress = 0;
    lineOpacity = 1;
    journeyPhase = "idle";
    isJourneyAnimating = true;
    callCountryOpacity = 0;
    callCountryVisible = false;

    setIdleStoryPanel();
    updateStoryButtons();
    showMemoryCloud();

    const startRotation = projection.rotate();
    const startScale = currentScale;

    const targetRotation = [...DEFAULT_ROTATION];
    const targetScale = DEFAULT_SCALE;

    const duration = getMapReturnDuration(
      startRotation,
      targetRotation,
      startScale,
      targetScale
    );

    const rotationInterpolator = interpolateRotation(
      startRotation,
      targetRotation
    );

    const start = performance.now();

    function frame(now) {
      if (!isCurrentJourney(token)) {
        return;
      }

      const rawT = Math.min(1, (now - start) / duration);

      /*
        Smooth return: slow at the beginning and end,
        no mechanical snap.
      */
      const easedT = d3.easeCubicInOut(rawT);

      projection.rotate(rotationInterpolator(easedT));

      currentScale = interpolateNumber(
        startScale,
        targetScale,
        easedT
      );

      projection.scale(currentScale);

      render();

      if (rawT < 1) {
        requestAnimationFrame(frame);
        return;
      }

      projection.rotate([...targetRotation]);
      currentScale = targetScale;
      projection.scale(currentScale);

      isJourneyAnimating = false;
      journeyPhase = "idle";

      render();
      updateStoryButtons();
      showMemoryCloud();
    }

    requestAnimationFrame(frame);
  }

  /*
    Intercept the Missing Geographies click BEFORE the older dropdown
    listener gets to call resetView().
  */
  document.addEventListener(
    "click",
    event => {
      if (!isSitePagesSummaryTarget(event.target)) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();

      const dropdown = getSitePagesDropdown();

      if (dropdown && dropdown.open) {
        closeSitePagesDropdown();
        return;
      }

      closeIranCallRoomDropdown();
      openSitePagesDropdown();
      animateBackToDefaultMapView();
    },
    true
  );

  /*
    Keyboard support: Enter / Space should do the same animated return.
  */
  document.addEventListener(
    "keydown",
    event => {
      if (
        event.key !== "Enter" &&
        event.key !== " "
      ) {
        return;
      }

      if (!isSitePagesSummaryTarget(event.target)) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();

      const dropdown = getSitePagesDropdown();

      if (dropdown && dropdown.open) {
        closeSitePagesDropdown();
        return;
      }

      closeIranCallRoomDropdown();
      openSitePagesDropdown();
      animateBackToDefaultMapView();
    },
    true
  );
})();
/* ==========================================================
   FORCE DIASPORA POINTS TO MATCH FLOATING FRAGMENTS

   CSS alone was not visually strong enough because the map render
   keeps repainting SVG points. This patch reapplies the fragment-like
   pale color after every render.

   Visual rule:
   - Outside-Iran / diaspora city points = pale floating-fragment color.
   - Iran outline and Iranian arrival point = golden.
   ========================================================== */

(function forceDiasporaPointsToMatchFragments() {
  if (window.__forceDiasporaPointsToMatchFragmentsReady) {
    return;
  }

  window.__forceDiasporaPointsToMatchFragmentsReady = true;

  const FRAGMENT_POINT = {
    fill: "rgba(255, 255, 255, 0.62)",
    fillSoft: "rgba(255, 255, 255, 0.50)",
    fillOpen: "rgba(255, 255, 255, 0.78)",
    stroke: "rgba(255, 255, 255, 0.46)",
    strokeOpen: "rgba(255, 255, 255, 0.68)",
    glow: "drop-shadow(0 0 5px rgba(255, 255, 255, 0.20)) drop-shadow(0 0 14px rgba(255, 207, 102, 0.055))",
    glowOpen: "drop-shadow(0 0 8px rgba(255, 255, 255, 0.36)) drop-shadow(0 0 22px rgba(255, 207, 102, 0.10))"
  };

  const IRAN_GOLD = {
    fill: "rgba(255, 188, 91, 0.92)",
    stroke: "rgba(255, 239, 194, 0.58)",
    glow: "drop-shadow(0 0 5px rgba(255, 191, 91, 0.58)) drop-shadow(0 0 13px rgba(255, 207, 102, 0.24))"
  };

  function setSvgStyle(element, property, value) {
    if (!element || !element.style) {
      return;
    }

    element.style.setProperty(property, value, "important");
  }

  function styleCircleAsFragmentPoint(element, options = {}) {
    if (!element) {
      return;
    }

    const isOpen = element.classList.contains("cluster-open");
    const isMulti = element.classList.contains("multi");

    const fill =
      isOpen
        ? FRAGMENT_POINT.fillOpen
        : isMulti
          ? FRAGMENT_POINT.fill
          : FRAGMENT_POINT.fillSoft;

    const stroke =
      isOpen
        ? FRAGMENT_POINT.strokeOpen
        : FRAGMENT_POINT.stroke;

    const filter =
      isOpen
        ? FRAGMENT_POINT.glowOpen
        : FRAGMENT_POINT.glow;

    element.setAttribute("fill", fill);
    element.setAttribute("stroke", stroke);
    element.setAttribute("stroke-width", isOpen ? "0.72" : "0.62");

    setSvgStyle(element, "fill", fill);
    setSvgStyle(element, "stroke", stroke);
    setSvgStyle(element, "stroke-width", isOpen ? "0.72px" : "0.62px");
    setSvgStyle(element, "filter", filter);
    setSvgStyle(
      element,
      "animation",
      isOpen
        ? "diasporaFragmentPointOpenLocked 1.55s ease-in-out infinite"
        : "diasporaFragmentPointLocked 3.4s ease-in-out infinite"
    );
  }

  function styleCircleAsIranPoint(element) {
    if (!element) {
      return;
    }

    element.setAttribute("fill", IRAN_GOLD.fill);
    element.setAttribute("stroke", IRAN_GOLD.stroke);
    element.setAttribute("stroke-width", "0.82");

    setSvgStyle(element, "fill", IRAN_GOLD.fill);
    setSvgStyle(element, "stroke", IRAN_GOLD.stroke);
    setSvgStyle(element, "stroke-width", "0.82px");
    setSvgStyle(element, "filter", IRAN_GOLD.glow);
  }

  function applyFragmentPointColors() {
    if (typeof d3 === "undefined") {
      return;
    }

    /*
      Main outside-Iran city points:
      - current clustered city points
      - older/simple destination points if any are still present
    */
    d3.selectAll(
      "circle.destination-cluster, circle.map-point.destination"
    ).each(function applyDestinationPointStyle() {
      styleCircleAsFragmentPoint(this);
    });

    /*
      Individual points after a city cluster opens.
    */
    d3.selectAll("circle.cluster-bloom-point")
      .each(function applyBloomPointStyle() {
        this.setAttribute("fill", "rgba(255, 255, 255, 0.58)");
        this.setAttribute("stroke", "rgba(255, 255, 255, 0.44)");
        this.setAttribute("stroke-width", "0.62");

        setSvgStyle(this, "fill", "rgba(255, 255, 255, 0.58)");
        setSvgStyle(this, "stroke", "rgba(255, 255, 255, 0.44)");
        setSvgStyle(this, "stroke-width", "0.62px");
        setSvgStyle(this, "filter", FRAGMENT_POINT.glow);
        setSvgStyle(
          this,
          "animation",
          "diasporaFragmentStoryPointLocked 3s ease-in-out infinite"
        );
      });

    /*
      Cluster count number should belong to the same pale family.
    */
    d3.selectAll("text.cluster-count")
      .each(function applyClusterCountStyle() {
        this.setAttribute("fill", "rgba(255, 255, 255, 0.52)");
        this.setAttribute("stroke", "rgba(0, 0, 0, 0.70)");
        this.setAttribute("stroke-width", "2.1");

        setSvgStyle(this, "fill", "rgba(255, 255, 255, 0.52)");
        setSvgStyle(this, "stroke", "rgba(0, 0, 0, 0.70)");
        setSvgStyle(this, "stroke-width", "2.1px");
      });

    /*
      Bloom halo and threads should also become pale, not gold.
    */
    d3.selectAll("circle.cluster-bloom-halo")
      .each(function applyBloomHaloStyle() {
        this.setAttribute("fill", "rgba(255, 255, 255, 0.012)");
        this.setAttribute("stroke", "rgba(255, 255, 255, 0.10)");

        setSvgStyle(this, "fill", "rgba(255, 255, 255, 0.012)");
        setSvgStyle(this, "stroke", "rgba(255, 255, 255, 0.10)");
      });

    d3.selectAll("line.cluster-bloom-thread")
      .each(function applyBloomThreadStyle() {
        this.setAttribute("stroke", "rgba(255, 255, 255, 0.12)");
        setSvgStyle(this, "stroke", "rgba(255, 255, 255, 0.12)");
      });

    /*
      Reassert Iran / arrival as golden.
      This prevents the general point rule from touching Iranian arrival.
    */
    d3.selectAll("circle.map-point.origin, circle.map-point.home-arrival")
      .each(function applyIranPointStyle() {
        styleCircleAsIranPoint(this);
      });

    d3.selectAll("path.iran-outline")
      .each(function applyIranOutlineStyle() {
        this.setAttribute("stroke", "rgba(241, 210, 120, 0.88)");
        setSvgStyle(this, "stroke", "rgba(241, 210, 120, 0.88)");
      });
  }

  /*
    Wrap render so every map redraw gets the correct colors.
  */
  if (typeof render === "function" && !window.__fragmentPointColorRenderWrapped) {
    const originalRender = render;

    render = function fragmentPointColorRenderWrapper() {
      const result = originalRender.apply(this, arguments);
      applyFragmentPointColors();
      return result;
    };

    window.__fragmentPointColorRenderWrapped = true;
  }

  /*
    If this function exists in your current script, it repaints map points.
    So we also wrap it and correct the points immediately afterward.
  */
  if (
    typeof applyArtPass2Styles === "function" &&
    !window.__fragmentPointColorArtPassWrapped
  ) {
    const originalApplyArtPass2Styles = applyArtPass2Styles;

    applyArtPass2Styles = function fragmentPointColorArtPassWrapper() {
      const result = originalApplyArtPass2Styles.apply(this, arguments);
      applyFragmentPointColors();
      return result;
    };

    window.__fragmentPointColorArtPassWrapped = true;
  }

  applyFragmentPointColors();
  window.setTimeout(applyFragmentPointColors, 250);
  window.setTimeout(applyFragmentPointColors, 900);
  window.setTimeout(applyFragmentPointColors, 1800);
})();
/* ==========================================================
   LOCK DIASPORA POINTS TO FLOATING FRAGMENT COLOR

   Why this is needed:
   applyArtPass2Styles() repaints every .map-point after render,
   so CSS alone cannot reliably keep outside-Iran points in the
   floating-fragment color family.

   This patch:
   - uses the actual warm pale color of the floating fragments
   - keeps Iran outline and Iran arrival/home point golden
   - re-applies after render, after applyArtPass2Styles, and after
     SVG attribute changes
   ========================================================== */

(function lockDiasporaPointsToFloatingFragments() {
  if (window.__diasporaFloatingFragmentColorLockReady) {
    return;
  }

  window.__diasporaFloatingFragmentColorLockReady = true;

  const FLOATING_FRAGMENT_POINT = {
    fill: "rgba(232, 218, 190, 0.68)",
    fillSoft: "rgba(232, 218, 190, 0.56)",
    fillOpen: "rgba(244, 232, 206, 0.82)",
    stroke: "rgba(255, 244, 220, 0.34)",
    strokeOpen: "rgba(255, 248, 230, 0.52)",
    filter:
      "drop-shadow(0 0 5px rgba(255, 207, 102, 0.14)) drop-shadow(0 0 13px rgba(0, 0, 0, 0.38))",
    filterOpen:
      "drop-shadow(0 0 8px rgba(255, 232, 190, 0.30)) drop-shadow(0 0 18px rgba(255, 207, 102, 0.12))"
  };

  const IRAN_GOLD = {
    fill: "rgba(255, 188, 91, 0.92)",
    stroke: "rgba(255, 239, 194, 0.58)",
    filter:
      "drop-shadow(0 0 5px rgba(255, 191, 91, 0.58)) drop-shadow(0 0 13px rgba(255, 207, 102, 0.24))"
  };

  let repaintQueued = false;
  let observerIsPainting = false;

  function setImportantStyle(element, property, value) {
    if (!element || !element.style) {
      return;
    }

    element.style.setProperty(property, value, "important");
  }

  function isIranArrivalPoint(element) {
    return (
      element.classList.contains("origin") ||
      element.classList.contains("home-arrival")
    );
  }

  function isDiasporaPoint(element) {
    return (
      element.matches("circle.destination-cluster") ||
      element.matches("circle.map-point.destination") ||
      (
        element.matches("circle.map-point") &&
        !isIranArrivalPoint(element)
      )
    );
  }

  function paintDiasporaPoint(element) {
    if (!element || !isDiasporaPoint(element)) {
      return;
    }

    const isOpen = element.classList.contains("cluster-open");
    const isMulti = element.classList.contains("multi");

    const fill = isOpen
      ? FLOATING_FRAGMENT_POINT.fillOpen
      : isMulti
        ? FLOATING_FRAGMENT_POINT.fill
        : FLOATING_FRAGMENT_POINT.fillSoft;

    const stroke = isOpen
      ? FLOATING_FRAGMENT_POINT.strokeOpen
      : FLOATING_FRAGMENT_POINT.stroke;

    const filter = isOpen
      ? FLOATING_FRAGMENT_POINT.filterOpen
      : FLOATING_FRAGMENT_POINT.filter;

    element.setAttribute("fill", fill);
    element.setAttribute("stroke", stroke);
    element.setAttribute("stroke-width", isOpen ? "0.72" : "0.62");
    element.setAttribute("opacity", "0.94");

    setImportantStyle(element, "fill", fill);
    setImportantStyle(element, "stroke", stroke);
    setImportantStyle(element, "stroke-width", isOpen ? "0.72px" : "0.62px");
    setImportantStyle(element, "opacity", "0.94");
    setImportantStyle(element, "filter", filter);
    setImportantStyle(
      element,
      "animation",
      isOpen
        ? "diasporaFloatingFragmentOpenPulse 1.55s ease-in-out infinite"
        : "diasporaFloatingFragmentPulse 3.4s ease-in-out infinite"
    );
  }

  function paintBloomPoint(element) {
    if (!element) {
      return;
    }

    element.setAttribute("fill", FLOATING_FRAGMENT_POINT.fillSoft);
    element.setAttribute("stroke", FLOATING_FRAGMENT_POINT.stroke);
    element.setAttribute("stroke-width", "0.62");

    setImportantStyle(element, "fill", FLOATING_FRAGMENT_POINT.fillSoft);
    setImportantStyle(element, "stroke", FLOATING_FRAGMENT_POINT.stroke);
    setImportantStyle(element, "stroke-width", "0.62px");
    setImportantStyle(element, "filter", FLOATING_FRAGMENT_POINT.filter);
    setImportantStyle(
      element,
      "animation",
      "diasporaFloatingFragmentStoryPulse 3s ease-in-out infinite"
    );
  }

  function paintIranPoint(element) {
    if (!element) {
      return;
    }

    element.setAttribute("fill", IRAN_GOLD.fill);
    element.setAttribute("stroke", IRAN_GOLD.stroke);
    element.setAttribute("stroke-width", "0.82");

    setImportantStyle(element, "fill", IRAN_GOLD.fill);
    setImportantStyle(element, "stroke", IRAN_GOLD.stroke);
    setImportantStyle(element, "stroke-width", "0.82px");
    setImportantStyle(element, "filter", IRAN_GOLD.filter);
  }

  function repaintDiasporaPointColorsNow() {
    observerIsPainting = true;

    document
      .querySelectorAll("#globe circle.map-point, svg circle.map-point")
      .forEach(circle => {
        if (isIranArrivalPoint(circle)) {
          paintIranPoint(circle);
        } else {
          paintDiasporaPoint(circle);
        }
      });

    document
      .querySelectorAll("#globe circle.destination-cluster, svg circle.destination-cluster")
      .forEach(paintDiasporaPoint);

    document
      .querySelectorAll("#globe circle.cluster-bloom-point, svg circle.cluster-bloom-point")
      .forEach(paintBloomPoint);

    document
      .querySelectorAll("#globe text.cluster-count, svg text.cluster-count")
      .forEach(count => {
        count.setAttribute("fill", "rgba(232, 218, 190, 0.56)");
        count.setAttribute("stroke", "rgba(0, 0, 0, 0.70)");
        count.setAttribute("stroke-width", "2.1");

        setImportantStyle(count, "fill", "rgba(232, 218, 190, 0.56)");
        setImportantStyle(count, "stroke", "rgba(0, 0, 0, 0.70)");
        setImportantStyle(count, "stroke-width", "2.1px");
      });

    document
      .querySelectorAll("#globe circle.cluster-bloom-halo, svg circle.cluster-bloom-halo")
      .forEach(halo => {
        halo.setAttribute("fill", "rgba(232, 218, 190, 0.012)");
        halo.setAttribute("stroke", "rgba(232, 218, 190, 0.10)");

        setImportantStyle(halo, "fill", "rgba(232, 218, 190, 0.012)");
        setImportantStyle(halo, "stroke", "rgba(232, 218, 190, 0.10)");
      });

    document
      .querySelectorAll("#globe line.cluster-bloom-thread, svg line.cluster-bloom-thread")
      .forEach(thread => {
        thread.setAttribute("stroke", "rgba(232, 218, 190, 0.12)");
        setImportantStyle(thread, "stroke", "rgba(232, 218, 190, 0.12)");
      });

    document
      .querySelectorAll("#globe path.iran-outline, svg path.iran-outline")
      .forEach(iran => {
        iran.setAttribute("stroke", "rgba(241, 210, 120, 0.88)");
        setImportantStyle(iran, "stroke", "rgba(241, 210, 120, 0.88)");
      });

    observerIsPainting = false;
  }

  function queueDiasporaPointRepaint() {
    if (repaintQueued) {
      return;
    }

    repaintQueued = true;

    requestAnimationFrame(() => {
      repaintQueued = false;
      repaintDiasporaPointColorsNow();
    });
  }

  /*
    Important: applyArtPass2Styles is the function that keeps repainting
    .map-point back to the old warm/gold color. So we wrap it directly.
  */
  if (
    typeof applyArtPass2Styles === "function" &&
    !window.__diasporaColorApplyArtWrapped
  ) {
    const originalApplyArtPass2Styles = applyArtPass2Styles;

    applyArtPass2Styles = function lockedApplyArtPass2Styles() {
      const result = originalApplyArtPass2Styles.apply(this, arguments);
      queueDiasporaPointRepaint();
      return result;
    };

    window.__diasporaColorApplyArtWrapped = true;
  }

  /*
    Also wrap render, because render creates/updates the circles.
  */
  if (typeof render === "function" && !window.__diasporaColorRenderWrappedFinal) {
    const originalRender = render;

    render = function lockedDiasporaColorRender() {
      const result = originalRender.apply(this, arguments);
      queueDiasporaPointRepaint();
      return result;
    };

    window.__diasporaColorRenderWrappedFinal = true;
  }

  /*
    MutationObserver is the extra lock:
    if any later script changes fill/stroke/filter again, we repaint.
  */
  const globe = document.getElementById("globe");

  if (globe && !window.__diasporaColorMutationObserverReady) {
    const observer = new MutationObserver(mutations => {
      if (observerIsPainting) {
        return;
      }

      const relevant = mutations.some(mutation => {
        const target = mutation.target;

        return (
          target instanceof SVGElement &&
          (
            target.matches("circle.map-point") ||
            target.matches("circle.destination-cluster") ||
            target.matches("circle.cluster-bloom-point") ||
            target.matches("text.cluster-count") ||
            target.matches("circle.cluster-bloom-halo") ||
            target.matches("line.cluster-bloom-thread")
          )
        );
      });

      if (relevant) {
        queueDiasporaPointRepaint();
      }
    });

    observer.observe(globe, {
      subtree: true,
      attributes: true,
      attributeFilter: [
        "class",
        "fill",
        "stroke",
        "stroke-width",
        "opacity",
        "style",
        "r"
      ],
      childList: true
    });

    window.__diasporaColorMutationObserverReady = true;
  }

  repaintDiasporaPointColorsNow();
  window.setTimeout(repaintDiasporaPointColorsNow, 200);
  window.setTimeout(repaintDiasporaPointColorsNow, 800);
  window.setTimeout(repaintDiasporaPointColorsNow, 1600);
})();
/* ==========================================================
   AUDIO DOCK — ACTIVE BRIGHTNESS + PLAYER ICONS

   - Brightens the bottom audio dock once story audio starts.
   - Keeps it bright until the audio ends or is reset.
   - Replaces text labels:
       -10 / Play / Pause / +10
     with conventional player icons.
   ========================================================== */

(function setupBrightIconAudioDock() {
  if (window.__brightIconAudioDockReady) {
    return;
  }

  window.__brightIconAudioDockReady = true;

  let storyAudioHasStarted = false;
  let lastAudioSource = "";
  let installTimer = null;

  function getAudioDockElements() {
    const dock = document.querySelector(".audio-dock");
    const audioElement =
      typeof audio !== "undefined"
        ? audio
        : document.getElementById("story-audio");

    return {
      dock,
      audioElement,
      backButton: document.getElementById("audio-back-10"),
      playPauseButton: document.getElementById("audio-play-pause"),
      forwardButton: document.getElementById("audio-forward-10"),
      progressInput: document.getElementById("audio-progress"),
      timeLabel: document.getElementById("audio-time")
    };
  }

  function getAudioSource(audioElement) {
    if (!audioElement) {
      return "";
    }

    return (
      audioElement.currentSrc ||
      audioElement.getAttribute("src") ||
      audioElement.src ||
      ""
    );
  }

  function syncAudioSourceState(audioElement) {
    const source = getAudioSource(audioElement);

    if (source !== lastAudioSource) {
      lastAudioSource = source;
      storyAudioHasStarted = false;
    }
  }

  function audioIsActivelyInStory(audioElement) {
    if (!audioElement) {
      return false;
    }

    const source = getAudioSource(audioElement);
    const duration =
      Number.isFinite(audioElement.duration) && audioElement.duration > 0
        ? audioElement.duration
        : 0;

    const current =
      Number.isFinite(audioElement.currentTime)
        ? audioElement.currentTime
        : 0;

    const basicallyAtBeginning = current < 0.05;
    const basicallyEnded =
      audioElement.ended ||
      (duration > 0 && current >= duration - 0.05);

    if (!source || basicallyEnded) {
      return false;
    }

    if (!audioElement.paused) {
      return true;
    }

    /*
      If the viewer pauses mid-audio, keep the dock bright.
      If the site reset the audio back to 0, return to pale.
    */
    return storyAudioHasStarted && !basicallyAtBeginning;
  }

  function iconBackTen() {
    return `
      <span class="audio-dock-rotate-icon" aria-hidden="true">↶</span>
      <span class="audio-dock-ten" aria-hidden="true">10</span>
    `;
  }

  function iconForwardTen() {
    return `
      <span class="audio-dock-ten" aria-hidden="true">10</span>
      <span class="audio-dock-rotate-icon" aria-hidden="true">↷</span>
    `;
  }

  function iconPlay() {
    return `
      <svg class="audio-dock-svg-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 5.8v12.4L18.2 12z"></path>
      </svg>
    `;
  }

  function iconPause() {
    return `
      <svg class="audio-dock-svg-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7.2 5.4h3.2v13.2H7.2z"></path>
        <path d="M13.6 5.4h3.2v13.2h-3.2z"></path>
      </svg>
    `;
  }

  function decorateAudioDock() {
    const {
      dock,
      audioElement,
      backButton,
      playPauseButton,
      forwardButton
    } = getAudioDockElements();

    if (
      !dock ||
      !audioElement ||
      !backButton ||
      !playPauseButton ||
      !forwardButton
    ) {
      return false;
    }

    syncAudioSourceState(audioElement);

    const active = audioIsActivelyInStory(audioElement);
    const playing = active && !audioElement.paused;

    dock.classList.toggle("audio-dock-active", active);
    dock.classList.toggle("audio-dock-playing", playing);
    dock.classList.toggle("audio-dock-paused-active", active && audioElement.paused);

    backButton.innerHTML = iconBackTen();
    forwardButton.innerHTML = iconForwardTen();
    playPauseButton.innerHTML = audioElement.paused ? iconPlay() : iconPause();

    backButton.setAttribute("aria-label", "Go back 10 seconds");
    forwardButton.setAttribute("aria-label", "Go forward 10 seconds");
    playPauseButton.setAttribute(
      "aria-label",
      audioElement.paused ? "Play audio" : "Pause audio"
    );

    backButton.setAttribute("title", "Back 10 seconds");
    forwardButton.setAttribute("title", "Forward 10 seconds");
    playPauseButton.setAttribute(
      "title",
      audioElement.paused ? "Play" : "Pause"
    );

    return true;
  }

  function installAudioEventListeners() {
    const { audioElement } = getAudioDockElements();

    if (!audioElement || audioElement.dataset.brightIconAudioDockBound === "yes") {
      return false;
    }

    audioElement.dataset.brightIconAudioDockBound = "yes";

    audioElement.addEventListener("play", () => {
      storyAudioHasStarted = true;
      decorateAudioDock();
    });

    audioElement.addEventListener("pause", () => {
      decorateAudioDock();
    });

    audioElement.addEventListener("timeupdate", () => {
      decorateAudioDock();
    });

    audioElement.addEventListener("loadedmetadata", () => {
      decorateAudioDock();
    });

    audioElement.addEventListener("ended", () => {
      storyAudioHasStarted = false;
      decorateAudioDock();
    });

    audioElement.addEventListener("emptied", () => {
      storyAudioHasStarted = false;
      decorateAudioDock();
    });

    return true;
  }

  function wrapAudioDockUpdate() {
    if (
      typeof audioDockUpdate !== "function" ||
      window.__brightIconAudioDockUpdateWrapped
    ) {
      return false;
    }

    const originalAudioDockUpdate = audioDockUpdate;

    audioDockUpdate = function brightIconAudioDockUpdateWrapper() {
      const result = originalAudioDockUpdate.apply(this, arguments);
      decorateAudioDock();
      return result;
    };

    window.__brightIconAudioDockUpdateWrapped = true;
    return true;
  }

  /*
    If setupAudioDock has not run yet, wrap it too.
    If it already ran, the retry loop below still handles it.
  */
  if (
    typeof setupAudioDock === "function" &&
    !window.__brightIconSetupAudioDockWrapped
  ) {
    const originalSetupAudioDock = setupAudioDock;

    setupAudioDock = function brightIconSetupAudioDockWrapper() {
      const result = originalSetupAudioDock.apply(this, arguments);

      installAudioEventListeners();
      wrapAudioDockUpdate();
      decorateAudioDock();

      return result;
    };

    window.__brightIconSetupAudioDockWrapped = true;
  }

  function tryInstallAudioDockPatch(attempt = 0) {
    installAudioEventListeners();
    wrapAudioDockUpdate();
    const decorated = decorateAudioDock();

    if (decorated && typeof audioDockUpdate === "function") {
      return;
    }

    if (attempt >= 40) {
      return;
    }

    installTimer = window.setTimeout(() => {
      tryInstallAudioDockPatch(attempt + 1);
    }, 180);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      tryInstallAudioDockPatch();
    });
  } else {
    tryInstallAudioDockPatch();
  }

  window.addEventListener("beforeunload", () => {
    if (installTimer) {
      clearTimeout(installTimer);
    }
  });
})();
/* ==========================================================
   AUDIO DOCK — CONVENTIONAL PLAYER ICONS

   Replaces the current text / circular-10 icons with:
   - rewind double-triangle
   - play / pause
   - forward double-triangle

   Keeps the existing 10-second back/forward functionality.
   Keeps the existing warm project color through currentColor.
   ========================================================== */

(function setupConventionalAudioDockIcons() {
  if (window.__conventionalAudioDockIconsReady) {
    return;
  }

  window.__conventionalAudioDockIconsReady = true;

  function getAudioDockParts() {
    return {
      dock: document.querySelector(".audio-dock"),
      audioElement:
        typeof audio !== "undefined"
          ? audio
          : document.getElementById("story-audio"),
      backButton: document.getElementById("audio-back-10"),
      playPauseButton: document.getElementById("audio-play-pause"),
      forwardButton: document.getElementById("audio-forward-10"),
      progressInput: document.getElementById("audio-progress")
    };
  }

  function rewindIcon() {
    return `
      <svg class="audio-player-icon audio-player-icon-rewind" viewBox="0 0 64 40" aria-hidden="true">
        <path d="M30 8 L30 32 L13 20 Z"></path>
        <path d="M48 8 L48 32 L31 20 Z"></path>
      </svg>
    `;
  }

  function forwardIcon() {
    return `
      <svg class="audio-player-icon audio-player-icon-forward" viewBox="0 0 64 40" aria-hidden="true">
        <path d="M16 8 L16 32 L33 20 Z"></path>
        <path d="M34 8 L34 32 L51 20 Z"></path>
      </svg>
    `;
  }

  function playIcon() {
    return `
      <svg class="audio-player-icon audio-player-icon-play" viewBox="0 0 64 40" aria-hidden="true">
        <path d="M24 7 L24 33 L45 20 Z"></path>
      </svg>
    `;
  }

  function pauseIcon() {
    return `
      <svg class="audio-player-icon audio-player-icon-pause" viewBox="0 0 64 40" aria-hidden="true">
        <path d="M23 8 H29 V32 H23 Z"></path>
        <path d="M35 8 H41 V32 H35 Z"></path>
      </svg>
    `;
  }

  function decorateAudioDockIcons() {
    const {
      audioElement,
      backButton,
      playPauseButton,
      forwardButton
    } = getAudioDockParts();

    if (!audioElement || !backButton || !playPauseButton || !forwardButton) {
      return false;
    }

    backButton.innerHTML = rewindIcon();
    forwardButton.innerHTML = forwardIcon();
    playPauseButton.innerHTML = audioElement.paused ? playIcon() : pauseIcon();

    backButton.setAttribute("aria-label", "Go back 10 seconds");
    forwardButton.setAttribute("aria-label", "Go forward 10 seconds");
    playPauseButton.setAttribute(
      "aria-label",
      audioElement.paused ? "Play audio" : "Pause audio"
    );

    backButton.setAttribute("title", "Back 10 seconds");
    forwardButton.setAttribute("title", "Forward 10 seconds");
    playPauseButton.setAttribute(
      "title",
      audioElement.paused ? "Play" : "Pause"
    );

    return true;
  }

  function installAudioListeners() {
    const { audioElement } = getAudioDockParts();

    if (!audioElement || audioElement.dataset.conventionalIconsBound === "yes") {
      return false;
    }

    audioElement.dataset.conventionalIconsBound = "yes";

    [
      "play",
      "pause",
      "timeupdate",
      "loadedmetadata",
      "ended",
      "emptied"
    ].forEach(eventName => {
      audioElement.addEventListener(eventName, decorateAudioDockIcons);
    });

    return true;
  }

  function wrapAudioDockUpdate() {
    if (
      typeof audioDockUpdate !== "function" ||
      window.__conventionalAudioDockUpdateWrapped
    ) {
      return false;
    }

    const originalAudioDockUpdate = audioDockUpdate;

    audioDockUpdate = function conventionalAudioDockUpdateWrapper() {
      const result = originalAudioDockUpdate.apply(this, arguments);
      decorateAudioDockIcons();
      return result;
    };

    window.__conventionalAudioDockUpdateWrapped = true;
    return true;
  }

  function wrapSetupAudioDock() {
    if (
      typeof setupAudioDock !== "function" ||
      window.__conventionalSetupAudioDockWrapped
    ) {
      return false;
    }

    const originalSetupAudioDock = setupAudioDock;

    setupAudioDock = function conventionalSetupAudioDockWrapper() {
      const result = originalSetupAudioDock.apply(this, arguments);

      installAudioListeners();
      wrapAudioDockUpdate();
      decorateAudioDockIcons();

      return result;
    };

    window.__conventionalSetupAudioDockWrapped = true;
    return true;
  }

  function tryInstall(attempt = 0) {
    wrapSetupAudioDock();
    installAudioListeners();
    wrapAudioDockUpdate();

    const decorated = decorateAudioDockIcons();

    if (decorated && typeof audioDockUpdate === "function") {
      return;
    }

    if (attempt >= 40) {
      return;
    }

    window.setTimeout(() => {
      tryInstall(attempt + 1);
    }, 180);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => tryInstall());
  } else {
    tryInstall();
  }
})();
/* ==========================================================
   LIVE TITLE DOT — PERSIAN INVITATION TEXT

   Replaces the existing Marjorie Agosin quote inside the blinking
   "i" box with the Persian project invitation.

   Keeps the same behavior:
   - hover / lantern near the i-dot opens the box
   - moving away fades it back into darkness
   ========================================================== */

(function replaceLiveTitleDotQuoteWithPersianInvitation() {
  if (window.__liveTitlePersianInvitationReady) {
    return;
  }

  window.__liveTitlePersianInvitationReady = true;

  const invitationParagraphs = [
    `هموطن عزیزم،`,

    `«جغرافیاهای گمشده» نام یک پروژه‌ی هنری-اجتماعی است درباره‌ی زندگی‌هایی که در سایه‌ی جمهوری اسلامی ناتمام ماندند؛ درباره‌ی آزادی‌هایی که سلب شدند، فرصت‌هایی که سوختند، و نسخه‌هایی از ما که مجال ظهور و بروز پیدا نکردند. این پروژه تلاشی است برای پیدا کردن زبانی برای بازگو کردن حرف‌هایی که سال‌ها در گلو مانده‌اند؛ حرف‌هایی که اغلب نه جایی برای گفتنشان بوده، نه زمانی برای شنیده‌شدنشان، و نه مخاطبی که بتواند رنج و حسرتِ پنهان در آن‌ها را بفهمد.`,

    `در این پروژه، دلتنگی فقط یادآوری یک کوچه، یک خانه، یک منظره یا یک خاطره‌ی شیرین نیست. گاهی دلتنگی نام چیزی است که هرگز فرصت تجربه‌اش را پیدا نکردیم؛ نام آزادی‌هایی که از کودکی، نوجوانی و جوانی ما حذف شدند؛ نام فرصت‌هایی که سوختند؛ نام نسخه‌هایی از زندگی که می‌توانستند شکل بگیرند و نگرفتند.`,

    `ما ایرانیانِ دورمانده از وطن، هر کدام به شکلی با وزن سنگین این اندوه زندگی کرده‌ایم. چرا که تجربه‌ی زیستن در دوران جمهوری اسلامی فقط تجربه‌ی سرکوب در سیاست رسمی نیست؛ بلکه تجربه‌ی روزمره‌ی سرکوب خودِ زندگیست: محدودیت بر بدن، زبان، عشق، شادی، سوگواری، موسیقی، پوشش، شادنوشی، آموزش، مذهب، عقیده، کار، سفر، ارتباط با دنیا و آینده. بسیاری از چیزهایی که برای یک زندگی عادی بدیهی به نظر می‌رسند، برای ما یا ممنوع بودند، یا مشروط، یا خطرناک، یا همراه با ترس و شرم و خودسانسوری دائمی.`,

    `«جغرافیاهای گمشده» دعوتی است برای بازگشتن و واکاوی این لایه‌ها؛ برای ترسیم دوباره‌ی نقشه‌ی چیزهایی که از دست رفتند، اما ردشان یا شوق و میلشان هنوز در تن، حافظه، صدا، بو، عکس، لباس، اشیای همراه ما، آهنگ، زبان و خواب‌های ما مانده است.`,

    `اگر مایل باشی مشارکت کنی، می‌توانی از این سه مسیر شروع کنی:`,

    `نخست، به گذشته: چه چیزهایی از دست رفتند و هرگز به تجربه‌ی زندگی تبدیل نشدند؟ چه آزادی‌هایی، چه امکان‌هایی، چه لحظه‌هایی زمانشان گذشت؟ برای من، یکی از این فقدان‌ها حتی به کودکی برمی‌گردد: حسرت تجربه‌ای ساده، مثل اینکه بتوانم با خواهرم به یک مدرسه بروم.`,

    `دوم، به اکنون: چه مکانی، چه آدمی، چه تجربه‌ی اجتماعی، چه حس آشنا و دوست‌داشتنی، چه لحظه‌ی صمیمی و دلگرم‌کننده‌ای امروز از دسترس تو دور مانده است؟ گاهی دلتنگی و حس از دست دادن یعنی ناتوانی از حضور؛ مثلاً اینکه حتی نتوانی بر مزار عزیزی حاضر شوی و خداحافظی کنی.`,

    `سوم، به آینده: اگر ایران آزاد بود، اگر زندگی ما می‌توانست امتدادی طبیعی از تاریخ، زبان و سرزمین خودمان باشد، چه چیزهایی ممکن بود؟ زندگی شخصی ما چه شکلی می‌گرفت؟ وطن ما چه چیزی می‌توانست بشود اگر نیروی جوانی، دانش، عشق، خلاقیت و میل به آبادانی از آن دریغ نمی‌شد؟`,

    `این سه محور فقط پیشنهادی‌اند. مشارکت تو می‌تواند به یکی از آن‌ها، به دو تا، یا به هر سه بپردازد؛ و البته می‌تواند سراغ چیزهایی برود که من حتی تصورشان را هم نمی‌کنم، اما بخشی از تجربه‌ی زندگی تو هستند.`,

    `مشارکت تو می‌تواند یک فایل صوتی، یک عکس، یک نقاشی، یک متن، یک شعر، یک جمله، یک تصویر، یک خاطره، یا حتی لینکی به یک موسیقی یا ویدیو باشد؛ چیزی که حس می‌کنی بهتر از هر توضیحی احساس تو را بیان می‌کند. مشارکت تو می‌تواند ترکیبی از این‌ها هم باشد. لازم نیست کامل، مرتب، ادبی یا آماده باشد. مکث، تردید، سکوت، بغض، ناتمام‌ماندن و تغییر زبان هم می‌توانند بخشی از مشارکت تو باشند.`,

    `مشارکت تو می‌تواند بدون کوچک‌ترین نشانه یا اشاره‌ای به هویت واقعی‌ات ثبت شود؛ مثلاً با یک اسم مستعار، یا حتی بدون اینکه نشانی ایمیلت را با من در میان بگذاری. تو می‌توانی هر چند بار که خواستی فرم را پر کنی و به موضوعات متفاوتی بپردازی.`,

    `در پایان، اگر خواستی، می‌توانی نشانی ایمیلت را ثبت کنی و انتخاب کنی که آیا مایلی در صورت نیاز با تو در تماس باشم یا نه؛ چه برای همین پروژه، چه برای یک پروژه‌ی تحقیقی احتمالی در آینده. اگر این دعوت را به کسی برسانی که فکر می‌کنی چیزی از این جغرافیای گمشده را با خود حمل می‌کند، بسیار سپاسگزار خواهم بود.`
  ];

  function escapeInvitationHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function getQuoteBox() {
    return document.getElementById("title-memory-quote");
  }

  function getLiveMarker() {
    return document.querySelector(".title-live-i");
  }

  function buildInvitationHtml() {
    return `
      <div class="title-memory-invitation-inner" lang="fa" dir="rtl">
        ${invitationParagraphs.map((paragraph, index) => {
          const className =
            index === 0
              ? "title-memory-invitation-greeting"
              : "title-memory-invitation-paragraph";

          return `<p class="${className}">${escapeInvitationHtml(paragraph)}</p>`;
        }).join("")}
      </div>
    `;
  }

  function applyInvitationText() {
    const quoteBox = getQuoteBox();

    if (!quoteBox) {
      return false;
    }

    quoteBox.classList.add("title-memory-quote-persian");
    quoteBox.setAttribute("lang", "fa");
    quoteBox.setAttribute("dir", "rtl");
    quoteBox.setAttribute("aria-label", "دعوت‌نامه‌ی جغرافیاهای گمشده");

    quoteBox.innerHTML = buildInvitationHtml();

    positionPersianInvitationBox();

    return true;
  }

  function positionPersianInvitationBox() {
    const quoteBox = getQuoteBox();
    const marker = getLiveMarker();

    if (!quoteBox || !marker) {
      return;
    }

    const markerRect = marker.getBoundingClientRect();

    const width = Math.min(560, window.innerWidth - 34);

    quoteBox.style.setProperty("width", `${width}px`, "important");
    quoteBox.style.setProperty("max-width", "calc(100vw - 34px)", "important");

    const preferredLeft =
      markerRect.left + markerRect.width / 2 - width * 0.16;

    const left = Math.max(
      17,
      Math.min(preferredLeft, window.innerWidth - width - 17)
    );

    quoteBox.style.left = `${left}px`;

    /*
      Because the text is long, the box is scrollable.
      This positioning keeps it close to the title dot,
      but prevents it from falling outside the viewport.
    */
    const quoteHeight = quoteBox.offsetHeight || Math.min(620, window.innerHeight * 0.72);

    let top = markerRect.bottom + 18;

    if (top + quoteHeight > window.innerHeight - 22) {
      top = Math.max(74, window.innerHeight - quoteHeight - 22);
    }

    quoteBox.style.top = `${top}px`;
  }

  function tryApplyInvitation(attempt = 0) {
    const applied = applyInvitationText();

    if (applied) {
      return;
    }

    if (attempt > 40) {
      return;
    }

    window.setTimeout(() => {
      tryApplyInvitation(attempt + 1);
    }, 180);
  }

  /*
    The original live-dot code creates the quote box dynamically.
    This catches it whenever it appears.
  */
  const bodyObserver = new MutationObserver(() => {
    const quoteBox = getQuoteBox();

    if (
      quoteBox &&
      !quoteBox.classList.contains("title-memory-quote-persian")
    ) {
      applyInvitationText();
    }
  });

  bodyObserver.observe(document.body, {
    childList: true,
    subtree: true
  });

  /*
    Reposition while the box is visible.
  */
  document.addEventListener(
    "pointermove",
    () => {
      const quoteBox = getQuoteBox();

      if (quoteBox && quoteBox.classList.contains("visible")) {
        positionPersianInvitationBox();
      }
    },
    { passive: true }
  );

  window.addEventListener("resize", positionPersianInvitationBox);

  tryApplyInvitation();
})();
/* ==========================================================
   LIVE TITLE DOT — BILINGUAL SCROLLABLE INVITATION BOX

   Fixes:
   - Persian text is forced right-to-left.
   - Text is slightly larger.
   - Box has an internal scroll area.
   - Adds an "English" button on the top-left of the box.
   - The English button toggles to the English translation.
   ========================================================== */

(function setupBilingualScrollableTitleInvitationBox() {
  if (window.__bilingualTitleInvitationBoxReady) {
    return;
  }

  window.__bilingualTitleInvitationBoxReady = true;

  let currentLanguage = "fa";
  let positionFrameRequested = false;

  const persianParagraphs = [
    `هموطن عزیزم،`,

    `«جغرافیاهای گمشده» نام یک پروژه‌ی هنری-اجتماعی است درباره‌ی زندگی‌هایی که در سایه‌ی جمهوری اسلامی ناتمام ماندند؛ درباره‌ی آزادی‌هایی که سلب شدند، فرصت‌هایی که سوختند، و نسخه‌هایی از ما که مجال ظهور و بروز پیدا نکردند. این پروژه تلاشی است برای پیدا کردن زبانی برای بازگو کردن حرف‌هایی که سال‌ها در گلو مانده‌اند؛ حرف‌هایی که اغلب نه جایی برای گفتنشان بوده، نه زمانی برای شنیده‌شدنشان، و نه مخاطبی که بتواند رنج و حسرتِ پنهان در آن‌ها را بفهمد.`,

    `در این پروژه، دلتنگی فقط یادآوری یک کوچه، یک خانه، یک منظره یا یک خاطره‌ی شیرین نیست. گاهی دلتنگی نام چیزی است که هرگز فرصت تجربه‌اش را پیدا نکردیم؛ نام آزادی‌هایی که از کودکی، نوجوانی و جوانی ما حذف شدند؛ نام فرصت‌هایی که سوختند؛ نام نسخه‌هایی از زندگی که می‌توانستند شکل بگیرند و نگرفتند.`,

    `ما ایرانیانِ دورمانده از وطن، هر کدام به شکلی با وزن سنگین این اندوه زندگی کرده‌ایم. چرا که تجربه‌ی زیستن در دوران جمهوری اسلامی فقط تجربه‌ی سرکوب در سیاست رسمی نیست؛ بلکه تجربه‌ی روزمره‌ی سرکوب خودِ زندگیست: محدودیت بر بدن، زبان، عشق، شادی، سوگواری، موسیقی، پوشش، شادنوشی، آموزش، مذهب، عقیده، کار، سفر، ارتباط با دنیا و آینده. بسیاری از چیزهایی که برای یک زندگی عادی بدیهی به نظر می‌رسند، برای ما یا ممنوع بودند، یا مشروط، یا خطرناک، یا همراه با ترس و شرم و خودسانسوری دائمی.`,

    `«جغرافیاهای گمشده» دعوتی است برای بازگشتن و واکاوی این لایه‌ها؛ برای ترسیم دوباره‌ی نقشه‌ی چیزهایی که از دست رفتند، اما ردشان یا شوق و میلشان هنوز در تن، حافظه، صدا، بو، عکس، لباس، اشیای همراه ما، آهنگ، زبان و خواب‌های ما مانده است.`,

    `اگر مایل باشی مشارکت کنی، می‌توانی از این سه مسیر شروع کنی:`,

    `نخست، به گذشته: چه چیزهایی از دست رفتند و هرگز به تجربه‌ی زندگی تبدیل نشدند؟ چه آزادی‌هایی، چه امکان‌هایی، چه لحظه‌هایی زمانشان گذشت؟ برای من، یکی از این فقدان‌ها حتی به کودکی برمی‌گردد: حسرت تجربه‌ای ساده، مثل اینکه بتوانم با خواهرم به یک مدرسه بروم.`,

    `دوم، به اکنون: چه مکانی، چه آدمی، چه تجربه‌ی اجتماعی، چه حس آشنا و دوست‌داشتنی، چه لحظه‌ی صمیمی و دلگرم‌کننده‌ای امروز از دسترس تو دور مانده است؟ گاهی دلتنگی و حس از دست دادن یعنی ناتوانی از حضور؛ مثلاً اینکه حتی نتوانی بر مزار عزیزی حاضر شوی و خداحافظی کنی.`,

    `سوم، به آینده: اگر ایران آزاد بود، اگر زندگی ما می‌توانست امتدادی طبیعی از تاریخ، زبان و سرزمین خودمان باشد، چه چیزهایی ممکن بود؟ زندگی شخصی ما چه شکلی می‌گرفت؟ وطن ما چه چیزی می‌توانست بشود اگر نیروی جوانی، دانش، عشق، خلاقیت و میل به آبادانی از آن دریغ نمی‌شد؟`,

    `این سه محور فقط پیشنهادی‌اند. مشارکت تو می‌تواند به یکی از آن‌ها، به دو تا، یا به هر سه بپردازد؛ و البته می‌تواند سراغ چیزهایی برود که من حتی تصورشان را هم نمی‌کنم، اما بخشی از تجربه‌ی زندگی تو هستند.`,

    `مشارکت تو می‌تواند یک فایل صوتی، یک عکس، یک نقاشی، یک متن، یک شعر، یک جمله، یک تصویر، یک خاطره، یا حتی لینکی به یک موسیقی یا ویدیو باشد؛ چیزی که حس می‌کنی بهتر از هر توضیحی احساس تو را بیان می‌کند. مشارکت تو می‌تواند ترکیبی از این‌ها هم باشد. لازم نیست کامل، مرتب، ادبی یا آماده باشد. مکث، تردید، سکوت، بغض، ناتمام‌ماندن و تغییر زبان هم می‌توانند بخشی از مشارکت تو باشند.`,

    `مشارکت تو می‌تواند بدون کوچک‌ترین نشانه یا اشاره‌ای به هویت واقعی‌ات ثبت شود؛ مثلاً با یک اسم مستعار، یا حتی بدون اینکه نشانی ایمیلت را با من در میان بگذاری. تو می‌توانی هر چند بار که خواستی فرم را پر کنی و به موضوعات متفاوتی بپردازی.`,

    `در پایان، اگر خواستی، می‌توانی نشانی ایمیلت را ثبت کنی و انتخاب کنی که آیا مایلی در صورت نیاز با تو در تماس باشم یا نه؛ چه برای همین پروژه، چه برای یک پروژه‌ی تحقیقی احتمالی در آینده. اگر این دعوت را به کسی برسانی که فکر می‌کنی چیزی از این جغرافیای گمشده را با خود حمل می‌کند، بسیار سپاسگزار خواهم بود.`
  ];

  const englishParagraphs = [
    `My dear compatriot,`,

    `“Missing Geographies” is the name of a socially engaged art project about lives that remained unfinished in the shadow of the Islamic Republic; about freedoms that were taken away, opportunities that burned, and versions of ourselves that never had the chance to emerge. This project is an attempt to find a language for speaking the words that have been lodged in our throats for years; words for which there has often been no place to speak, no time to be heard, and no audience capable of understanding the grief and longing hidden inside them.`,

    `In this project, longing is not simply the memory of an alley, a house, a landscape, or a sweet recollection. Sometimes longing is the name of something we never had the chance to experience; the name of freedoms erased from our childhood, adolescence, and youth; the name of opportunities that burned away; the name of versions of life that could have taken shape, but never did.`,

    `We Iranians who have been kept far from our homeland have each lived, in our own way, with the heavy weight of this sorrow. Because living under the Islamic Republic has not only meant experiencing repression in the realm of official politics; it has meant the daily repression of life itself: restrictions placed on the body, language, love, joy, mourning, music, clothing, convivial pleasure, education, religion, belief, work, travel, connection with the world, and the future. So many things that seem self-evident in an ordinary life were, for us, either forbidden, conditional, dangerous, or bound to fear, shame, and constant self-censorship.`,

    `“Missing Geographies” is an invitation to return to these layers and examine them; to redraw the map of things that were lost, yet whose traces, desires, or longings still remain in our bodies, memory, voices, smells, photographs, clothes, the objects we carry with us, songs, language, and dreams.`,

    `If you would like to participate, you might begin from one of these three paths:`,

    `First, the past: What was lost and never became part of lived experience? Which freedoms, which possibilities, which moments passed before they could be lived? For me, one of these losses goes all the way back to childhood: the longing for something simple, like being able to go to the same school as my sister.`,

    `Second, the present: What place, what person, what social experience, what familiar and beloved feeling, what intimate and heartening moment is now beyond your reach? Sometimes longing, and the feeling of loss, means the inability to be present; for example, not even being able to stand at the grave of someone dear and say goodbye.`,

    `Third, the future: If Iran were free, if our lives could have been a natural continuation of the history, language, and land that are ours, what might have been possible? What shape might our personal lives have taken? What might our homeland have become if the force of our youth, knowledge, love, creativity, and desire to build had not been withheld from it?`,

    `These three paths are only suggestions. Your contribution may address one of them, two of them, or all three; and, of course, it may move toward things I cannot even imagine, but that are part of your lived experience.`,

    `Your contribution may be an audio file, a photograph, a drawing, a text, a poem, a sentence, an image, a memory, or even a link to a piece of music or a video—something you feel expresses your feeling better than any explanation could. Your contribution may also be a combination of these forms. It does not need to be complete, orderly, literary, or ready. Pauses, hesitation, silence, tears held in the throat, unfinishedness, and shifts in language may all be part of your contribution.`,

    `Your contribution can be recorded without the smallest sign or reference to your real identity; for example, under a pseudonym, or even without sharing your email address with me. You may fill out the form as many times as you wish and speak to different subjects.`,

    `At the end, if you choose, you may leave your email address and indicate whether you would like me to contact you if needed—whether for this project or for a possible future research project. If you pass this invitation on to someone you think carries a piece of this missing geography within them, I would be deeply grateful.`
  ];

  function ensureInvitationFontsLoaded() {
    if (document.getElementById("title-invitation-readable-fonts")) {
      return;
    }

    const preconnectGoogle = document.createElement("link");
    preconnectGoogle.rel = "preconnect";
    preconnectGoogle.href = "https://fonts.googleapis.com";

    const preconnectStatic = document.createElement("link");
    preconnectStatic.rel = "preconnect";
    preconnectStatic.href = "https://fonts.gstatic.com";
    preconnectStatic.crossOrigin = "anonymous";

    const fontLink = document.createElement("link");
    fontLink.id = "title-invitation-readable-fonts";
    fontLink.rel = "stylesheet";
    fontLink.href =
      "https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;500;600;700&family=Noto+Sans+Arabic:wght@400;500;600;700&display=swap";

    document.head.appendChild(preconnectGoogle);
    document.head.appendChild(preconnectStatic);
    document.head.appendChild(fontLink);
  }

  function escapeInvitationHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function getQuoteBox() {
    return document.getElementById("title-memory-quote");
  }

  function getLiveMarker() {
    return document.querySelector(".title-live-i");
  }

  function getParagraphsForLanguage(language) {
    return language === "en" ? englishParagraphs : persianParagraphs;
  }

  function buildInvitationBody(language) {
    const isEnglish = language === "en";
    const paragraphs = getParagraphsForLanguage(language);
    const lang = isEnglish ? "en" : "fa";
    const dir = isEnglish ? "ltr" : "rtl";

    return `
      <div class="title-memory-invitation-toolbar" dir="ltr">
        <button
          id="title-memory-language-toggle"
          class="title-memory-language-toggle"
          type="button"
          aria-label="${isEnglish ? "Show Persian text" : "Show English translation"}"
        >
          ${isEnglish ? "فارسی" : "English"}
        </button>
      </div>

      <div
        id="title-memory-invitation-scroll"
        class="title-memory-invitation-scroll"
        lang="${lang}"
        dir="${dir}"
      >
        <div class="title-memory-invitation-inner title-memory-invitation-inner-${lang}">
          ${paragraphs.map((paragraph, index) => {
            const className =
              index === 0
                ? "title-memory-invitation-greeting"
                : "title-memory-invitation-paragraph";

            return `
              <p
                class="${className}"
                lang="${lang}"
                dir="${dir}"
              >
                ${escapeInvitationHtml(paragraph)}
              </p>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }

  function applyLanguage(language) {
    currentLanguage = language === "en" ? "en" : "fa";

    const quoteBox = getQuoteBox();

    if (!quoteBox) {
      return false;
    }

    const isEnglish = currentLanguage === "en";

    quoteBox.classList.add(
      "title-memory-quote-persian",
      "title-memory-quote-bilingual"
    );

    quoteBox.classList.toggle("title-memory-quote-english", isEnglish);
    quoteBox.classList.toggle("title-memory-quote-farsi", !isEnglish);

    quoteBox.dataset.language = currentLanguage;
    quoteBox.setAttribute("lang", isEnglish ? "en" : "fa");
    quoteBox.setAttribute("dir", isEnglish ? "ltr" : "rtl");
    quoteBox.setAttribute(
      "aria-label",
      isEnglish
        ? "Missing Geographies invitation letter"
        : "دعوت‌نامه‌ی جغرافیاهای گمشده"
    );

    quoteBox.innerHTML = buildInvitationBody(currentLanguage);

    const toggleButton = document.getElementById("title-memory-language-toggle");

    if (toggleButton) {
      toggleButton.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();

        const nextLanguage = currentLanguage === "fa" ? "en" : "fa";

        applyLanguage(nextLanguage);

        const scroll = document.getElementById("title-memory-invitation-scroll");

        if (scroll) {
          scroll.scrollTop = 0;
        }
      });
    }

    positionBilingualInvitationBox();

    return true;
  }

  function positionBilingualInvitationBox() {
    const quoteBox = getQuoteBox();
    const marker = getLiveMarker();

    if (!quoteBox || !marker) {
      return;
    }

    const width = Math.min(640, window.innerWidth - 34);
    const maxHeight = Math.min(700, window.innerHeight * 0.74);

    quoteBox.style.setProperty("width", `${width}px`, "important");
    quoteBox.style.setProperty("height", `${maxHeight}px`, "important");
    quoteBox.style.setProperty("max-height", `${maxHeight}px`, "important");
    quoteBox.style.setProperty("overflow", "hidden", "important");

    const markerRect = marker.getBoundingClientRect();

    const preferredLeft =
      markerRect.left + markerRect.width / 2 - width * 0.16;

    const left = Math.max(
      17,
      Math.min(preferredLeft, window.innerWidth - width - 17)
    );

    let top = markerRect.bottom + 18;

    if (top + maxHeight > window.innerHeight - 18) {
      top = Math.max(74, window.innerHeight - maxHeight - 18);
    }

    quoteBox.style.left = `${left}px`;
    quoteBox.style.top = `${top}px`;
  }

  function requestBoxPosition() {
    if (positionFrameRequested) {
      return;
    }

    positionFrameRequested = true;

    requestAnimationFrame(() => {
      positionFrameRequested = false;
      positionBilingualInvitationBox();
    });
  }

  function tryApply(attempt = 0) {
    ensureInvitationFontsLoaded();

    const applied = applyLanguage(currentLanguage);

    if (applied) {
      return;
    }

    if (attempt > 50) {
      return;
    }

    window.setTimeout(() => {
      tryApply(attempt + 1);
    }, 160);
  }

  /*
    The original live-title-dot code creates the box dynamically.
    This keeps replacing the old quote / older Persian version if needed.
  */
  const bodyObserver = new MutationObserver(() => {
    const quoteBox = getQuoteBox();

    if (!quoteBox) {
      return;
    }

    if (!quoteBox.classList.contains("title-memory-quote-bilingual")) {
      applyLanguage(currentLanguage);
    }
  });

  bodyObserver.observe(document.body, {
    childList: true,
    subtree: true
  });

  const quoteBoxAttributeObserver = new MutationObserver(() => {
    requestBoxPosition();
  });

  function observeQuoteBoxAttributes() {
    const quoteBox = getQuoteBox();

    if (!quoteBox || quoteBox.dataset.bilingualObserved === "yes") {
      return;
    }

    quoteBox.dataset.bilingualObserved = "yes";

    quoteBoxAttributeObserver.observe(quoteBox, {
      attributes: true,
      attributeFilter: ["class", "style", "data-language"]
    });
  }

  document.addEventListener(
    "pointermove",
    () => {
      observeQuoteBoxAttributes();

      const quoteBox = getQuoteBox();

      if (quoteBox && quoteBox.classList.contains("visible")) {
        requestBoxPosition();
      }
    },
    { passive: true }
  );

  window.addEventListener("resize", requestBoxPosition);

  tryApply();
  window.setTimeout(observeQuoteBoxAttributes, 500);
})();
/* ==========================================================
   DROPDOWN ABOUT → ON-MAP ABOUT PANEL

   Fixes the previous wrong behavior:
   - Removes/hides the old top-left About overlay.
   - Does NOT create a new About button.
   - Uses the existing About item inside the Missing Geographies dropdown.
   - Hides Home inside that dropdown.
   - Prevents About from opening the old About page.
   - Opens a clean on-map text box ready for final About text.
   ========================================================== */

(function connectExistingDropdownAboutToPanel() {
  if (window.__dropdownAboutPanelReady) {
    return;
  }

  window.__dropdownAboutPanelReady = true;

  /*
    Replace this placeholder later when your final About text is ready.

    You can use:
      <p>Paragraph...</p>
      <h3>Section title</h3>
      <p>Another paragraph...</p>
  */
  const ABOUT_PANEL_HTML = `
    <p>
      <em>Missing Geographies</em> is a socially engaged art project by
      <a
        class="mg-about-credit-link"
        href="https://socialpracticecuny.org/fellows/25-26/"
        target="_blank"
        rel="noopener noreferrer"
      >Shokran Rahiminezhad</a>,
      developed during his 2025–26 Faculty Fellowship with Social Practice CUNY.
    </p>

    <p>
      The project gathers voices, images, texts, sounds, and traces from Iranians in diaspora, asking what it means to miss a place that was not simply left behind, but made difficult, dangerous, or impossible to fully live.
    </p>

    <p>
      Here, missing is not treated as nostalgia alone. It becomes a geography of removal: a record of freedoms withheld, ordinary experiences interrupted, futures stolen, and versions of ourselves that never had the chance to appear.
    </p>

    <p>
      Each contribution begins somewhere outside Iran and calls back toward a place in Iran, creating a living archive of longing and refusal — one fragment, one memory, one voice, one image, one echo at a time.
    </p>
  `;

  function normalizeNavText(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function isHomeItem(element) {
    return normalizeNavText(element.textContent) === "home";
  }

  function isAboutItem(element) {
    return normalizeNavText(element.textContent) === "about";
  }

  function removeOldWrongAboutArtifacts() {
    /*
      Remove the old panel that appeared as loose text at the top-left.
      Our new panel has a different id, so this is safe.
    */
    const oldSimplePanel = document.getElementById("mg-about-panel");

    if (oldSimplePanel) {
      oldSimplePanel.remove();
    }

    const oldCompactPanel = document.getElementById("compact-about-panel");

    if (oldCompactPanel) {
      oldCompactPanel.remove();
    }

    document.querySelectorAll(".mg-about-created-button").forEach(button => {
      button.remove();
    });

    /*
      The older patch marked About links with .mg-about-trigger.
      Remove it so the old click handler does not catch About anymore.
    */
    document.querySelectorAll(".mg-about-trigger").forEach(element => {
      element.classList.remove("mg-about-trigger", "active");
      element.removeAttribute("aria-expanded");
    });
  }

  function getSitePagesDropdown() {
    return document.querySelector(".site-pages-dropdown");
  }

  function getDropdownPageItems() {
    const dropdown = getSitePagesDropdown();

    if (!dropdown) {
      return [];
    }

    return Array.from(
      dropdown.querySelectorAll(
        ".site-pages-card a, .site-pages-card button, .site-pages-link"
      )
    );
  }

  function prepareDropdownItems() {
    removeOldWrongAboutArtifacts();

    const dropdown = getSitePagesDropdown();

    if (!dropdown) {
      return;
    }

    dropdown.classList.add("dropdown-about-panel-ready");

    getDropdownPageItems().forEach(item => {
      /*
        Hide Home from the existing dropdown.
      */
      if (isHomeItem(item)) {
        item.classList.add("mg-dropdown-home-hidden");
        item.setAttribute("aria-hidden", "true");
        item.setAttribute("tabindex", "-1");
        return;
      }

      /*
        Convert the existing About row into the overlay trigger.
      */
      if (isAboutItem(item)) {
        item.classList.remove("mg-about-trigger", "active");
        item.classList.add("mg-dropdown-about-trigger");

        item.setAttribute("role", "button");
        item.setAttribute("aria-haspopup", "dialog");
        item.setAttribute("aria-controls", "mg-dropdown-about-panel");
        item.setAttribute("aria-expanded", "false");

        if (item.tagName.toLowerCase() === "a") {
          item.setAttribute("href", "#about");
          item.removeAttribute("target");
          item.removeAttribute("rel");
        }
      }
    });

    /*
      If the old source nav is still somewhere in the DOM, hide Home there too.
      This does not affect the visible dropdown if that source nav is already hidden.
    */
    document.querySelectorAll(".project-nav-links a").forEach(item => {
      if (isHomeItem(item)) {
        item.classList.add("mg-dropdown-home-hidden");
        item.setAttribute("aria-hidden", "true");
        item.setAttribute("tabindex", "-1");
      }

      if (isAboutItem(item)) {
        item.classList.remove("mg-about-trigger", "active");
      }
    });
  }

  function ensureAboutPanel() {
    let panel = document.getElementById("mg-dropdown-about-panel");

    if (panel) {
      return panel;
    }

    panel = document.createElement("aside");
    panel.id = "mg-dropdown-about-panel";
    panel.className = "mg-dropdown-about-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "false");
    panel.setAttribute("aria-hidden", "true");
    panel.setAttribute("aria-labelledby", "mg-dropdown-about-title");

    panel.innerHTML = `
      <div class="mg-dropdown-about-panel-inner">
        <div class="mg-dropdown-about-toolbar">
          <p class="mg-dropdown-about-eyebrow">About</p>

          <button
            id="mg-dropdown-about-close"
            class="mg-dropdown-about-close"
            type="button"
            aria-label="Close About"
          >
            ×
          </button>
        </div>

        <div class="mg-dropdown-about-scroll">
          <h2 id="mg-dropdown-about-title">Missing Geographies</h2>

          <div id="mg-dropdown-about-body" class="mg-dropdown-about-body">
            ${ABOUT_PANEL_HTML}
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(panel);

    const closeButton = document.getElementById("mg-dropdown-about-close");

    if (closeButton) {
      closeButton.addEventListener("click", closeAboutPanel);
    }

    /*
      Clicks inside the panel should not close it.
    */
    panel.addEventListener("pointerdown", event => {
      event.stopPropagation();
    });

    return panel;
  }

  function closeMissingGeographiesDropdown() {
    const dropdown = getSitePagesDropdown();

    if (dropdown) {
      dropdown.open = false;
      dropdown.classList.remove("site-pages-closing");
    }
  }

  function closeCallRoomDropdown() {
    const callRoom = document.querySelector(".call-room-dropdown");

    if (callRoom) {
      callRoom.open = false;
      callRoom.classList.remove("call-room-closing");
    }
  }

  function openAboutPanel() {
    removeOldWrongAboutArtifacts();

    const panel = ensureAboutPanel();

    closeMissingGeographiesDropdown();
    closeCallRoomDropdown();

    panel.classList.add("visible");
    panel.setAttribute("aria-hidden", "false");

    document.documentElement.classList.add("mg-dropdown-about-open");

    document.querySelectorAll(".mg-dropdown-about-trigger").forEach(trigger => {
      trigger.classList.add("active");
      trigger.setAttribute("aria-expanded", "true");
    });

    window.setTimeout(() => {
      const closeButton = document.getElementById("mg-dropdown-about-close");

      if (closeButton) {
        closeButton.focus({ preventScroll: true });
      }
    }, 80);
  }

  function closeAboutPanel() {
    const panel = document.getElementById("mg-dropdown-about-panel");

    if (panel) {
      panel.classList.remove("visible");
      panel.setAttribute("aria-hidden", "true");
    }

    document.documentElement.classList.remove("mg-dropdown-about-open");

    document.querySelectorAll(".mg-dropdown-about-trigger").forEach(trigger => {
      trigger.classList.remove("active");
      trigger.setAttribute("aria-expanded", "false");
    });
  }

  function toggleAboutPanel() {
    const panel = ensureAboutPanel();

    if (panel.classList.contains("visible")) {
      closeAboutPanel();
    } else {
      openAboutPanel();
    }
  }

  function isDropdownAboutTarget(target) {
    if (
      !target ||
      typeof target.closest !== "function"
    ) {
      return false;
    }

    const explicitTrigger = target.closest(".mg-dropdown-about-trigger");

    if (explicitTrigger) {
      return true;
    }

    /*
      Safety: if the dropdown got rebuilt and the class is not applied yet,
      catch the visible About row by text.
    */
    const dropdownItem = target.closest(".site-pages-card a, .site-pages-card button, .site-pages-link");

    return Boolean(dropdownItem && isAboutItem(dropdownItem));
  }

  function bindEvents() {
    if (window.__dropdownAboutPanelEventsBound) {
      return;
    }

    window.__dropdownAboutPanelEventsBound = true;

    document.addEventListener(
      "click",
      event => {
        if (!isDropdownAboutTarget(event.target)) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        prepareDropdownItems();
        toggleAboutPanel();
      },
      true
    );

    document.addEventListener(
      "keydown",
      event => {
        if (event.key === "Escape") {
          closeAboutPanel();
          return;
        }

        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }

        if (!isDropdownAboutTarget(event.target)) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        prepareDropdownItems();
        toggleAboutPanel();
      },
      true
    );

    /*
      Click outside closes the About panel.
    */
    document.addEventListener(
      "pointerdown",
      event => {
        const panel = document.getElementById("mg-dropdown-about-panel");

        if (
          !panel ||
          !panel.classList.contains("visible")
        ) {
          return;
        }

        const clickedPanel = panel.contains(event.target);
        const clickedAbout = event.target.closest &&
          event.target.closest(".mg-dropdown-about-trigger");

        if (!clickedPanel && !clickedAbout) {
          closeAboutPanel();
        }
      },
      true
    );
  }

  function initializeDropdownAboutPanel() {
    removeOldWrongAboutArtifacts();
    prepareDropdownItems();
    ensureAboutPanel();
    bindEvents();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeDropdownAboutPanel);
  } else {
    initializeDropdownAboutPanel();
  }

  /*
    The Missing Geographies dropdown is created by another patch,
    so keep checking after it appears/rebuilds.
  */
  window.setTimeout(initializeDropdownAboutPanel, 250);
  window.setTimeout(initializeDropdownAboutPanel, 700);
  window.setTimeout(initializeDropdownAboutPanel, 1400);
  window.setTimeout(initializeDropdownAboutPanel, 2400);

  const observer = new MutationObserver(() => {
    prepareDropdownItems();
    removeOldWrongAboutArtifacts();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
})();
/* ==========================================================
   CONTRIBUTE DROPDOWN → TALLY FORM

   Redirects the existing Contribute item inside the
   Missing Geographies dropdown directly to the Tally form.

   This prevents Contribute from opening:
   - contribute.html
   - CUNY Commons contribute page
   - any old intermediate page

   It keeps the existing button/design. Only the destination changes.
   ========================================================== */

(function redirectContributeDropdownToTally() {
  if (window.__contributeDropdownRedirectToTallyReady) {
    return;
  }

  window.__contributeDropdownRedirectToTallyReady = true;

  const TALLY_FORM_URL = "https://tally.so/r/rjGD6o";

  function normalizeNavText(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function isContributeElement(element) {
    if (!element) {
      return false;
    }

    if (element.id === "compact-contribute-link") {
      return true;
    }

    return normalizeNavText(element.textContent) === "contribute";
  }

  function getContributeTrigger(target) {
    if (
      !target ||
      typeof target.closest !== "function"
    ) {
      return null;
    }

    const candidate = target.closest(
      [
        ".site-pages-card a",
        ".site-pages-card button",
        ".site-pages-link",
        ".project-nav-links a",
        ".project-nav a",
        ".project-nav button",
        "#compact-contribute-link",
        ".compact-nav-button"
      ].join(",")
    );

    if (!candidate) {
      return null;
    }

    const isNavRelated =
      candidate.closest(".project-nav") ||
      candidate.closest(".site-pages-card") ||
      candidate.id === "compact-contribute-link";

    if (!isNavRelated) {
      return null;
    }

    return isContributeElement(candidate) ? candidate : null;
  }

  function updateContributeLinkElement(element) {
    if (!element || !isContributeElement(element)) {
      return;
    }

    element.classList.add("mg-contribute-tally-link");

    /*
      If it is an anchor, make the real href the Tally form.
      Same-tab navigation keeps the experience simple:
      Contribute means go to the form.
    */
    if (element.tagName.toLowerCase() === "a") {
      if (element.getAttribute("href") !== TALLY_FORM_URL) {
        element.setAttribute("href", TALLY_FORM_URL);
      }

      element.removeAttribute("target");
      element.removeAttribute("rel");
    }

    /*
      If some version made it a button, preserve accessibility.
    */
    if (element.tagName.toLowerCase() === "button") {
      element.setAttribute("type", "button");
    }

    element.setAttribute("aria-label", "Open Missing Geographies contribution form");
    element.setAttribute("title", "Contribute");
  }

  function updateAllContributeLinks() {
    document
      .querySelectorAll(
        [
          ".site-pages-card a",
          ".site-pages-card button",
          ".site-pages-link",
          ".project-nav-links a",
          ".project-nav a",
          ".project-nav button",
          "#compact-contribute-link",
          ".compact-nav-button"
        ].join(",")
      )
      .forEach(updateContributeLinkElement);
  }

  function closeDropdownsBeforeRedirect() {
    const sitePagesDropdown = document.querySelector(".site-pages-dropdown");

    if (sitePagesDropdown) {
      sitePagesDropdown.open = false;
      sitePagesDropdown.classList.remove("site-pages-closing");
    }

    const callRoomDropdown = document.querySelector(".call-room-dropdown");

    if (callRoomDropdown) {
      callRoomDropdown.open = false;
      callRoomDropdown.classList.remove("call-room-closing");
    }
  }

  function goToTallyForm() {
    closeDropdownsBeforeRedirect();
    window.location.assign(TALLY_FORM_URL);
  }

  /*
    Capture click before older navigation handlers or old links can send
    the user to contribute.html / Commons.
  */
  document.addEventListener(
    "click",
    event => {
      const contributeTrigger = getContributeTrigger(event.target);

      if (!contributeTrigger) {
        return;
      }

      updateContributeLinkElement(contributeTrigger);

      /*
        Let browser handle modified clicks after href has been corrected:
        Ctrl/Cmd-click, Shift-click, middle-click, etc.
      */
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        event.button !== 0
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      goToTallyForm();
    },
    true
  );

  /*
    Keyboard safety for button-like versions of the Contribute item.
    Anchors usually fire click on Enter automatically, but this protects
    every version of the nav we have created so far.
  */
  document.addEventListener(
    "keydown",
    event => {
      if (
        event.key !== "Enter" &&
        event.key !== " "
      ) {
        return;
      }

      const contributeTrigger = getContributeTrigger(event.target);

      if (!contributeTrigger) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      updateContributeLinkElement(contributeTrigger);
      goToTallyForm();
    },
    true
  );

  /*
    The Missing Geographies dropdown may be rebuilt by earlier patches.
    Keep correcting Contribute whenever the nav changes.
  */
  const observer = new MutationObserver(() => {
    updateAllContributeLinks();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  updateAllContributeLinks();

  window.setTimeout(updateAllContributeLinks, 250);
  window.setTimeout(updateAllContributeLinks, 800);
  window.setTimeout(updateAllContributeLinks, 1600);
})();
/* ==========================================================
   FIX 1 — CONTRIBUTE OPENS TALLY IN A NEW TAB

   The previous Contribute redirect took the viewer away from the map.
   This patch intercepts the existing Contribute item before older
   document-level handlers and opens the Tally form in a new tab.

   It keeps:
   - the existing Missing Geographies dropdown
   - the existing Contribute row/button
   - the current visual design
   ========================================================== */

(function openContributeTallyInNewTabOnly() {
  if (window.__contributeTallyNewTabOnlyReady) {
    return;
  }

  window.__contributeTallyNewTabOnlyReady = true;

  const TALLY_FORM_URL = "https://tally.so/r/rjGD6o";

  function normalizeNavText(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function isContributeElement(element) {
    if (!element) {
      return false;
    }

    if (element.id === "compact-contribute-link") {
      return true;
    }

    return normalizeNavText(element.textContent) === "contribute";
  }

  function getContributeTrigger(target) {
    if (
      !target ||
      typeof target.closest !== "function"
    ) {
      return null;
    }

    const candidate = target.closest(
      [
        ".site-pages-card a",
        ".site-pages-card button",
        ".site-pages-link",
        ".project-nav-links a",
        ".project-nav a",
        ".project-nav button",
        "#compact-contribute-link",
        ".compact-nav-button"
      ].join(",")
    );

    if (!candidate || !isContributeElement(candidate)) {
      return null;
    }

    return candidate;
  }

  function updateContributeElement(element) {
    if (!element || !isContributeElement(element)) {
      return;
    }

    element.classList.add("mg-contribute-opens-new-tab");

    if (element.tagName.toLowerCase() === "a") {
      element.setAttribute("href", TALLY_FORM_URL);
      element.setAttribute("target", "_blank");
      element.setAttribute("rel", "noopener noreferrer");
    }

    if (element.tagName.toLowerCase() === "button") {
      element.setAttribute("type", "button");
    }

    element.setAttribute("aria-label", "Open Missing Geographies contribution form in a new tab");
    element.setAttribute("title", "Open contribution form");
  }

  function updateAllContributeElements() {
    document
      .querySelectorAll(
        [
          ".site-pages-card a",
          ".site-pages-card button",
          ".site-pages-link",
          ".project-nav-links a",
          ".project-nav a",
          ".project-nav button",
          "#compact-contribute-link",
          ".compact-nav-button"
        ].join(",")
      )
      .forEach(updateContributeElement);
  }

  function closeOpenDropdowns() {
    const sitePagesDropdown = document.querySelector(".site-pages-dropdown");

    if (sitePagesDropdown) {
      sitePagesDropdown.open = false;
      sitePagesDropdown.classList.remove("site-pages-closing");
    }

    const callRoomDropdown = document.querySelector(".call-room-dropdown");

    if (callRoomDropdown) {
      callRoomDropdown.open = false;
      callRoomDropdown.classList.remove("call-room-closing");
    }
  }

  function openTallyFormInNewTab() {
    closeOpenDropdowns();

    const openedWindow = window.open(
      TALLY_FORM_URL,
      "_blank",
      "noopener,noreferrer"
    );

    if (openedWindow) {
      try {
        openedWindow.opener = null;
      } catch (error) {
        // Browser security may prevent setting opener; noop is fine.
      }

      return;
    }

    /*
      Fallback if a browser blocks window.open.
      Because this still runs from a user click/key press, it should work.
    */
    const fallbackLink = document.createElement("a");
    fallbackLink.href = TALLY_FORM_URL;
    fallbackLink.target = "_blank";
    fallbackLink.rel = "noopener noreferrer";
    fallbackLink.style.display = "none";

    document.body.appendChild(fallbackLink);
    fallbackLink.click();
    fallbackLink.remove();
  }

  function handleContributeActivation(event) {
    const trigger = getContributeTrigger(event.target);

    if (!trigger) {
      return;
    }

    updateContributeElement(trigger);

    /*
      Capture before older handlers that used window.location.assign().
      We always open a new tab, including normal click and keyboard activation.
    */
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    openTallyFormInNewTab();
  }

  /*
    Window capture runs before the older document capture redirect.
  */
  window.addEventListener(
    "click",
    handleContributeActivation,
    true
  );

  window.addEventListener(
    "auxclick",
    event => {
      const trigger = getContributeTrigger(event.target);

      if (!trigger) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      updateContributeElement(trigger);
      openTallyFormInNewTab();
    },
    true
  );

  window.addEventListener(
    "keydown",
    event => {
      if (
        event.key !== "Enter" &&
        event.key !== " "
      ) {
        return;
      }

      const trigger = getContributeTrigger(event.target);

      if (!trigger) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      updateContributeElement(trigger);
      openTallyFormInNewTab();
    },
    true
  );

  const observer = new MutationObserver(updateAllContributeElements);

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  updateAllContributeElements();

  window.setTimeout(updateAllContributeElements, 250);
  window.setTimeout(updateAllContributeElements, 900);
  window.setTimeout(updateAllContributeElements, 1800);
})();


/* ==========================================================
   FIX 2 — STRICT BLINKING-I INVITATION TRIGGER

   The invitation box should appear only when:
   - the cursor is directly over the blinking i-dot, or
   - the cursor is within about 0.7 inch of that dot.

   0.7 inch in CSS pixels is approximately:
   0.7 × 96 = 67px

   Once the box is open, it stays open while the cursor is inside
   the box so viewers can scroll/read it.
   ========================================================== */

(function constrainTitleInvitationToBlinkingDot() {
  if (window.__strictTitleInvitationTriggerReady) {
    return;
  }

  window.__strictTitleInvitationTriggerReady = true;

  const TITLE_DOT_TRIGGER_RADIUS_PX = Math.round(0.7 * 96);
  const OPEN_BOX_SAFE_PADDING = 10;
  const HIDE_DELAY_MS = 240;

  let latestPointer = {
    x: -9999,
    y: -9999
  };

  let hideTimer = null;
  let keepAliveTimer = null;

  function getMarker() {
    return document.querySelector(".title-live-i");
  }

  function getQuoteBox() {
    return document.getElementById("title-memory-quote");
  }

  function parseCssLengthOnMarker(marker, variableName, fallbackEm) {
    if (!marker) {
      return 0;
    }

    const computed = window.getComputedStyle(marker);
    const fontSize = parseFloat(computed.fontSize) || 72;
    const rawValue = computed.getPropertyValue(variableName).trim();

    if (!rawValue) {
      return fontSize * fallbackEm;
    }

    if (rawValue.endsWith("px")) {
      return parseFloat(rawValue) || 0;
    }

    if (rawValue.endsWith("em")) {
      return (parseFloat(rawValue) || 0) * fontSize;
    }

    const numericValue = parseFloat(rawValue);

    if (Number.isFinite(numericValue)) {
      return numericValue;
    }

    return fontSize * fallbackEm;
  }

  function getBlinkingDotCenter() {
    const marker = getMarker();

    if (!marker) {
      return null;
    }

    const rect = marker.getBoundingClientRect();

    /*
      These fallback values match the CSS variables we used to pin
      the live i-dot center earlier.
    */
    const dotOffsetX = parseCssLengthOnMarker(
      marker,
      "--title-live-dot-center-x",
      0.070
    );

    const dotOffsetY = parseCssLengthOnMarker(
      marker,
      "--title-live-dot-center-y",
      0.118
    );

    return {
      x: rect.left + rect.width / 2 + dotOffsetX,
      y: rect.top + dotOffsetY
    };
  }

  function distanceBetween(x1, y1, x2, y2) {
    const dx = x1 - x2;
    const dy = y1 - y2;

    return Math.sqrt(dx * dx + dy * dy);
  }

  function pointerIsNearBlinkingDot(x, y) {
    const center = getBlinkingDotCenter();

    if (!center) {
      return false;
    }

    return distanceBetween(x, y, center.x, center.y) <= TITLE_DOT_TRIGGER_RADIUS_PX;
  }

  function pointInsideRect(x, y, rect, padding = 0) {
    if (!rect) {
      return false;
    }

    return (
      x >= rect.left - padding &&
      x <= rect.right + padding &&
      y >= rect.top - padding &&
      y <= rect.bottom + padding
    );
  }

  function quoteBoxIsVisible() {
    const quoteBox = getQuoteBox();

    return Boolean(
      quoteBox &&
      quoteBox.classList.contains("visible")
    );
  }

  function pointerIsInsideVisibleQuoteBox(x, y) {
    const quoteBox = getQuoteBox();

    if (!quoteBox || !quoteBox.classList.contains("visible")) {
      return false;
    }

    return pointInsideRect(
      x,
      y,
      quoteBox.getBoundingClientRect(),
      OPEN_BOX_SAFE_PADDING
    );
  }

  function pointerIsInsideHiddenQuoteBox(x, y) {
    const quoteBox = getQuoteBox();

    if (!quoteBox || quoteBox.classList.contains("visible")) {
      return false;
    }

    const rect = quoteBox.getBoundingClientRect();

    if (!rect.width || !rect.height) {
      return false;
    }

    return pointInsideRect(x, y, rect, 4);
  }

  function shouldInvitationStayOpen() {
    const marker = getMarker();
    const quoteBox = getQuoteBox();

    if (!marker || !quoteBox) {
      return false;
    }

    if (document.activeElement === marker) {
      return true;
    }

    if (quoteBox.contains(document.activeElement)) {
      return true;
    }

    return (
      pointerIsNearBlinkingDot(latestPointer.x, latestPointer.y) ||
      pointerIsInsideVisibleQuoteBox(latestPointer.x, latestPointer.y)
    );
  }

  function positionInvitationBox() {
    const marker = getMarker();
    const quoteBox = getQuoteBox();

    if (!marker || !quoteBox) {
      return;
    }

    const markerRect = marker.getBoundingClientRect();
    const center = getBlinkingDotCenter();

    const currentRect = quoteBox.getBoundingClientRect();

    const width =
      currentRect.width && currentRect.width > 40
        ? currentRect.width
        : Math.min(640, window.innerWidth - 34);

    const height =
      currentRect.height && currentRect.height > 40
        ? currentRect.height
        : Math.min(700, window.innerHeight * 0.74);

    const anchorX = center ? center.x : markerRect.left + markerRect.width / 2;

    const preferredLeft = anchorX - width * 0.16;

    const left = Math.max(
      17,
      Math.min(preferredLeft, window.innerWidth - width - 17)
    );

    let top = markerRect.bottom + 18;

    if (top + height > window.innerHeight - 18) {
      top = Math.max(74, window.innerHeight - height - 18);
    }

    quoteBox.style.left = `${left}px`;
    quoteBox.style.top = `${top}px`;
  }

  function clearInvitationHideTimer() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function showInvitationBox() {
    const marker = getMarker();
    const quoteBox = getQuoteBox();

    if (!marker || !quoteBox) {
      return;
    }

    clearInvitationHideTimer();
    positionInvitationBox();

    marker.classList.add("is-awake");
    quoteBox.classList.add("visible");
    quoteBox.setAttribute("aria-hidden", "false");
    document.documentElement.classList.add("title-quote-visible");
  }

  function hideInvitationBoxNow() {
    clearInvitationHideTimer();

    const marker = getMarker();
    const quoteBox = getQuoteBox();

    if (marker) {
      marker.classList.remove("is-awake");
    }

    if (quoteBox) {
      quoteBox.classList.remove("visible");
      quoteBox.setAttribute("aria-hidden", "true");
    }

    document.documentElement.classList.remove("title-quote-visible");
  }

  function scheduleInvitationHide() {
    clearInvitationHideTimer();

    hideTimer = window.setTimeout(() => {
      if (shouldInvitationStayOpen()) {
        showInvitationBox();
        return;
      }

      hideInvitationBoxNow();
    }, HIDE_DELAY_MS);
  }

  function enforceInvitationState() {
    const marker = getMarker();
    const quoteBox = getQuoteBox();

    if (!marker || !quoteBox) {
      return;
    }

    if (shouldInvitationStayOpen()) {
      showInvitationBox();
      return;
    }

    if (quoteBox.classList.contains("visible")) {
      scheduleInvitationHide();
    }
  }

  function updateLanternPositionIfWeStopEvent(event) {
    const root = document.documentElement;

    root.style.setProperty("--lantern-x", `${event.clientX}px`);
    root.style.setProperty("--lantern-y", `${event.clientY}px`);
    root.classList.remove("lantern-cursor-hidden");
  }

  /*
    This runs BEFORE the older title-dot pointermove listener.
    We stop the old listener only in the two cases that caused trouble:
    1. We are within the new 0.7-inch dot radius.
    2. The cursor is over the hidden box area, which used to falsely open it.
  */
  window.addEventListener(
    "pointermove",
    event => {
      if (event.pointerType && event.pointerType !== "mouse") {
        return;
      }

      latestPointer.x = event.clientX;
      latestPointer.y = event.clientY;

      const nearDot = pointerIsNearBlinkingDot(event.clientX, event.clientY);
      const insideHiddenBox = pointerIsInsideHiddenQuoteBox(event.clientX, event.clientY);

      if (nearDot) {
        updateLanternPositionIfWeStopEvent(event);
        showInvitationBox();

        event.stopPropagation();
        event.stopImmediatePropagation();
        return;
      }

      if (insideHiddenBox) {
        updateLanternPositionIfWeStopEvent(event);
        hideInvitationBoxNow();

        event.stopPropagation();
        event.stopImmediatePropagation();
      }
    },
    true
  );

  /*
    This runs AFTER the older listener and corrects anything it opened too broadly.
  */
  document.addEventListener(
    "pointermove",
    event => {
      if (event.pointerType && event.pointerType !== "mouse") {
        return;
      }

      latestPointer.x = event.clientX;
      latestPointer.y = event.clientY;

      enforceInvitationState();
    },
    { passive: true }
  );

  /*
    Clicking outside the open box closes it.
    Clicking inside the box keeps it open, so the English/Persian toggle
    and scrolling still work.
  */
  document.addEventListener(
    "pointerdown",
    event => {
      const marker = getMarker();
      const quoteBox = getQuoteBox();

      if (!quoteBox || !quoteBox.classList.contains("visible")) {
        return;
      }

      const clickedMarker = marker && marker.contains(event.target);
      const clickedQuote = quoteBox.contains(event.target);

      if (!clickedMarker && !clickedQuote) {
        hideInvitationBoxNow();
      }
    },
    true
  );

  /*
    Keyboard accessibility:
    focus on the i-dot opens the invitation;
    Escape closes it.
  */
  function bindMarkerFocusBehavior() {
    const marker = getMarker();

    if (!marker || marker.dataset.strictInvitationBound === "yes") {
      return;
    }

    marker.dataset.strictInvitationBound = "yes";

    marker.addEventListener("focus", showInvitationBox);
    marker.addEventListener("blur", scheduleInvitationHide);
  }

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      hideInvitationBoxNow();
    }
  });

  window.addEventListener("resize", () => {
    if (quoteBoxIsVisible()) {
      positionInvitationBox();
    }
  });

  /*
    Keep correcting older hide/show timers from previous patches.
  */
  keepAliveTimer = window.setInterval(() => {
    bindMarkerFocusBehavior();
    enforceInvitationState();
  }, 180);

  window.addEventListener("beforeunload", () => {
    if (keepAliveTimer) {
      clearInterval(keepAliveTimer);
    }
  });

  bindMarkerFocusBehavior();
})();
/* ==========================================================
   EXACT CITY NAMES + PERSIAN IRAN LABELS

   Fixes:
   - "Bushehr Province - 2010" becomes "Bushehr - 2010"
   - prevents future administrative suffixes such as Province,
     County, Ostan, Region, etc. from appearing in city labels
   - restores Persian city name underneath the English city/year
   - adds Bushehr / Boushehr → بوشهر

   This is a display/data-cleaning safety layer.
   It does not change coordinates.
   ========================================================== */

(function exactCityNamesAndPersianIranLabels() {
  if (window.__exactCityNamesAndPersianIranLabelsReady) {
    return;
  }

  window.__exactCityNamesAndPersianIranLabelsReady = true;

  const PERSIAN_CITY_NAMES = {
    "abadan": "آبادان",
    "adan": "آبادان",

    "ahvaz": "اهواز",
    "ahwaz": "اهواز",

    "arak": "اراک",
    "ardabil": "اردبیل",

    "bandar abbas": "بندرعباس",

    "birjand": "بیرجند",

    "bushehr": "بوشهر",
    "boushehr": "بوشهر",
    "busher": "بوشهر",
    "bu shahr": "بوشهر",
    "booshehr": "بوشهر",

    "dezful": "دزفول",

    "gorgan": "گرگان",

    "hamadan": "همدان",
    "hamedan": "همدان",

    "isfahan": "اصفهان",
    "esfahan": "اصفهان",

    "karaj": "کرج",
    "kashan": "کاشان",

    "kerman": "کرمان",
    "kermanshah": "کرمانشاه",

    "khorramabad": "خرم‌آباد",
    "khorram abad": "خرم‌آباد",

    "mashhad": "مشهد",
    "mashad": "مشهد",

    "neyshabur": "نیشابور",
    "nishapur": "نیشابور",

    "qazvin": "قزوین",
    "qom": "قم",

    "rasht": "رشت",

    "sabzevar": "سبزوار",

    "sanandaj": "سنندج",
    "sari": "ساری",
    "semnan": "سمنان",

    "shiraz": "شیراز",

    "tabriz": "تبریز",
    "tehran": "تهران",

    "urmia": "ارومیه",
    "orumiyeh": "ارومیه",

    "yazd": "یزد",

    "zabol": "زابل",
    "zahedan": "زاهدان",
    "zanjan": "زنجان"
  };

  const DISPLAY_CITY_FIXES = {
    "bushehr province": "Bushehr",
    "boushehr province": "Boushehr",
    "booshehr province": "Bushehr",
    "busher province": "Bushehr",

    "bushehr county": "Bushehr",
    "boushehr county": "Boushehr",

    "bushehr ostan": "Bushehr",
    "boushehr ostan": "Boushehr"
  };

  function ensureNastaliqFontLoaded() {
    if (document.getElementById("noto-nastaliq-urdu-font")) {
      return;
    }

    const preconnectGoogle = document.createElement("link");
    preconnectGoogle.rel = "preconnect";
    preconnectGoogle.href = "https://fonts.googleapis.com";

    const preconnectStatic = document.createElement("link");
    preconnectStatic.rel = "preconnect";
    preconnectStatic.href = "https://fonts.gstatic.com";
    preconnectStatic.crossOrigin = "anonymous";

    const fontLink = document.createElement("link");
    fontLink.id = "noto-nastaliq-urdu-font";
    fontLink.rel = "stylesheet";
    fontLink.href =
      "https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;500;600;700&display=swap";

    document.head.appendChild(preconnectGoogle);
    document.head.appendChild(preconnectStatic);
    document.head.appendChild(fontLink);
  }

  function normalizeCityKey(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/ā/g, "a")
      .replace(/ī/g, "i")
      .replace(/ū/g, "u")
      .replace(/ي/g, "ی")
      .replace(/ك/g, "ک")
      .replace(/[‌\-–—_]+/g, " ")
      .replace(/[.,،؛:]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function cityIsAlreadyPersian(value) {
    return /[\u0600-\u06FF]/.test(String(value || ""));
  }

  function titleCaseIfNeeded(value) {
    const text = String(value || "").trim();

    if (!text) {
      return "";
    }

    /*
      If the contributor typed lowercase English, make it presentable.
      Persian, mixed-case names, and comma names are left mostly intact.
    */
    if (/^[a-z\s.'-]+$/.test(text) && text === text.toLowerCase()) {
      return text.replace(/\b[a-z]/g, letter => letter.toUpperCase());
    }

    return text;
  }

  function stripAdministrativeWords(value) {
    let text = String(value || "")
      .replace(/\u00A0/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!text) {
      return "";
    }

    /*
      Remove bracketed administrative hints:
      Bushehr (Province) → Bushehr
    */
    text = text
      .replace(/\s*\([^)]*\)\s*$/g, "")
      .replace(/\s*\[[^\]]*\]\s*$/g, "")
      .trim();

    /*
      If it arrives as "Bushehr, Iran", keep only city.
      But do not destroy outside-Iran cities like "San Antonio, Texas".
    */
    const commaParts = text.split(",").map(part => part.trim()).filter(Boolean);

    if (commaParts.length > 1) {
      const rest = commaParts.slice(1).join(" ").toLowerCase();

      if (
        /\biran\b/.test(rest) ||
        /islamic republic/.test(rest) ||
        /ایران/.test(rest) ||
        /ايران/.test(rest)
      ) {
        text = commaParts[0];
      }
    }

    const preCleanKey = normalizeCityKey(text);

    if (DISPLAY_CITY_FIXES[preCleanKey]) {
      return DISPLAY_CITY_FIXES[preCleanKey];
    }

    /*
      Remove administrative labels that geocoders often append.
      This is deliberately display-only.
    */
    text = text
      .replace(/\b(?:province|county|governorate|prefecture|municipality|region|ostan|shahrestan)\b\.?$/i, "")
      .replace(/^(?:province|county|governorate|prefecture|municipality|region|ostan|shahrestan)\s+/i, "")
      .replace(/^(?:استان|شهرستان|شهر)\s+/g, "")
      .replace(/\s+(?:استان|شهرستان)$/g, "")
      .replace(/\s+/g, " ")
      .trim();

    const postCleanKey = normalizeCityKey(text);

    if (DISPLAY_CITY_FIXES[postCleanKey]) {
      return DISPLAY_CITY_FIXES[postCleanKey];
    }

    return titleCaseIfNeeded(text);
  }

  function cleanCityDisplayName(value) {
    const cleaned = stripAdministrativeWords(value);

    if (!cleaned) {
      return "";
    }

    const key = normalizeCityKey(cleaned);

    /*
      Keep Bushehr consistent if a geocoder gave us a province-level result.
    */
    if (
      key === "bushehr" ||
      key === "busher" ||
      key === "booshehr"
    ) {
      return "Bushehr";
    }

    return cleaned;
  }

  function getPersianCityName(cityName) {
    const raw = String(cityName || "").trim();

    if (!raw) {
      return "";
    }

    if (cityIsAlreadyPersian(raw)) {
      return stripAdministrativeWords(raw);
    }

    const cleaned = cleanCityDisplayName(raw);
    const normalized = normalizeCityKey(cleaned);

    if (PERSIAN_CITY_NAMES[normalized]) {
      return PERSIAN_CITY_NAMES[normalized];
    }

    /*
      One more fallback for cases like:
      "Bushehr Province"
      "Bushehr, Iran"
      "Bushehr (Iran)"
    */
    const simplified = normalizeCityKey(
      stripAdministrativeWords(
        raw
          .split(",")[0]
          .replace(/\(.*?\)/g, "")
      )
    );

    return PERSIAN_CITY_NAMES[simplified] || "";
  }

  function sanitizeStoryCityNames(story) {
    if (!story) {
      return story;
    }

    story.originCity = cleanCityDisplayName(story.originCity || "");
    story.destinationCity = cleanCityDisplayName(story.destinationCity || "");

    /*
      Keep title clean too, but do not overwrite custom titles
      unless the old title clearly contained the dirty city label.
    */
    if (
      story.title &&
      /province|county|ostan|استان|شهرستان/i.test(String(story.title))
    ) {
      story.title = `${story.originCity} → ${story.destinationCity}`;
    }

    return story;
  }

  function sanitizeAllStories() {
    if (!Array.isArray(stories)) {
      return;
    }

    stories.forEach(sanitizeStoryCityNames);

    if (activeStory) {
      sanitizeStoryCityNames(activeStory);
    }
  }

  /*
    Make sure future CSV-loaded rows are clean as soon as they become stories.
  */
  if (
    typeof rowToStory === "function" &&
    !window.__exactCityRowToStoryWrapped
  ) {
    const originalRowToStory = rowToStory;

    rowToStory = function exactCityRowToStory(row) {
      const story = originalRowToStory(row);
      return sanitizeStoryCityNames(story);
    };

    window.__exactCityRowToStoryWrapped = true;
  }

  /*
    Make sure any story selected from existing loaded data is clean.
  */
  if (
    typeof selectStory === "function" &&
    !window.__exactCitySelectStoryWrapped
  ) {
    const originalSelectStory = selectStory;

    selectStory = function exactCitySelectStory(story, options = {}) {
      sanitizeStoryCityNames(story);
      return originalSelectStory(story, options);
    };

    window.__exactCitySelectStoryWrapped = true;
  }

  /*
    Make sure story panels never print administrative labels.
  */
  if (
    typeof updateStoryPanelFinal === "function" &&
    !window.__exactCityFinalPanelWrapped
  ) {
    const originalUpdateStoryPanelFinal = updateStoryPanelFinal;

    updateStoryPanelFinal = function exactCityFinalPanel(story) {
      sanitizeStoryCityNames(story);
      return originalUpdateStoryPanelFinal(story);
    };

    window.__exactCityFinalPanelWrapped = true;
  }

  if (
    typeof updateStoryPanelCalling === "function" &&
    !window.__exactCityCallingPanelWrapped
  ) {
    const originalUpdateStoryPanelCalling = updateStoryPanelCalling;

    updateStoryPanelCalling = function exactCityCallingPanel(story) {
      sanitizeStoryCityNames(story);
      return originalUpdateStoryPanelCalling(story);
    };

    window.__exactCityCallingPanelWrapped = true;
  }

  if (
    typeof updateStoryPanelTraveling === "function" &&
    !window.__exactCityTravelPanelWrapped
  ) {
    const originalUpdateStoryPanelTraveling = updateStoryPanelTraveling;

    updateStoryPanelTraveling = function exactCityTravelPanel(story) {
      sanitizeStoryCityNames(story);
      return originalUpdateStoryPanelTraveling(story);
    };

    window.__exactCityTravelPanelWrapped = true;
  }

  function labelX(d) {
    return projectedX(d.coords) + 13;
  }

  function labelY(d) {
    return projectedY(d.coords) + 3;
  }

  function paintMapLabel(selection) {
    selection.each(function paintOneLabel(d) {
      const x = labelX(d);
      const y = labelY(d);
      const text = d3.select(this);

      text
        .attr("x", x)
        .attr("y", y);

      /*
        Important: remove old one-line text before adding tspans.
      */
      text.text("");
      text.selectAll("*").remove();

      text.append("tspan")
        .attr("class", "map-label-primary")
        .attr("x", x)
        .attr("dy", 0)
        .text(d.text);

      if (d.faText) {
        text.append("tspan")
          .attr("class", "map-label-fa")
          .attr("x", x)
          .attr("dy", "1.38em")
          .attr("lang", "fa")
          .attr("direction", "rtl")
          .style("direction", "rtl")
          .style("unicode-bidi", "plaintext")
          .text(d.faText);
      }
    });
  }

  /*
    Force-restore the bilingual label renderer.
    We do NOT rely on the older flag because the recent script repair may
    have left the older one-line renderer active.
  */
  if (typeof renderLabels === "function") {
    renderLabels = function renderExactBilingualIranArrivalLabels() {
      sanitizeAllStories();

      const labels = [];

      if (activeStory && journeyPhase === "calling") {
        const cleanDestinationCity = cleanCityDisplayName(activeStory.destinationCity);

        labels.push({
          text: cleanDestinationCity,
          faText: "",
          coords: activeStory.destinationCoords,
          role: "call-label"
        });
      }

      if (
        activeStory &&
        (
          journeyPhase === "line-arrived" ||
          journeyPhase === "line-fade" ||
          journeyPhase === "home-zoom" ||
          journeyPhase === "arrived"
        )
      ) {
        const cleanOriginCity = cleanCityDisplayName(activeStory.originCity);
        const persianCity = getPersianCityName(cleanOriginCity);

        labels.push({
          text: `${cleanOriginCity} - ${activeStory.yearLeft}`,
          faText: persianCity,
          coords: activeStory.originCoords,
          role: "home-label"
        });
      }

      const labelSelection = labelGroup.selectAll("text.map-label")
        .data(labels, d => `${d.text}-${d.role}`)
        .join(
          enter => {
            const entered = enter.append("text")
              .attr("class", d => `map-label ${d.role}`)
              .attr("x", d => labelX(d))
              .attr("y", d => labelY(d))
              .style("opacity", 0)
              .style("display", d => isVisible(d.coords) ? null : "none");

            paintMapLabel(entered);

            entered
              .transition()
              .duration(500)
              .style("opacity", 1);

            return entered;
          },
          update => {
            update
              .attr("class", d => `map-label ${d.role}`)
              .attr("x", d => labelX(d))
              .attr("y", d => labelY(d))
              .style("display", d => isVisible(d.coords) ? null : "none");

            paintMapLabel(update);

            return update;
          },
          exit => exit
            .transition()
            .duration(220)
            .style("opacity", 0)
            .remove()
        );

      paintMapLabel(labelSelection);
    };
  }

  function refreshStoryArchiveRows() {
    if (!Array.isArray(stories)) {
      return;
    }

    document.querySelectorAll(".story-button").forEach(button => {
      const storyId = button.dataset.storyId;
      const story = stories.find(item => item.id === storyId);

      if (!story) {
        return;
      }

      sanitizeStoryCityNames(story);

      const fromCity = cleanCityDisplayName(story.destinationCity);
      const toCity = cleanCityDisplayName(story.originCity);

      button.innerHTML = `<strong>${fromCity} → ${toCity}</strong>`;
      button.setAttribute("aria-label", `${fromCity} to ${toCity}`);
      button.title = `${fromCity} → ${toCity}`;
    });
  }

  /*
    Run now for already-loaded stories.
  */
  ensureNastaliqFontLoaded();
  sanitizeAllStories();
  refreshStoryArchiveRows();

  if (typeof render === "function") {
    render();
  }

  if (activeStory && typeof updateStoryPanelFinal === "function") {
    updateStoryPanelFinal(activeStory);
  }

  /*
    Run again after async CSV/story rendering settles.
  */
  window.setTimeout(() => {
    sanitizeAllStories();
    refreshStoryArchiveRows();

    if (typeof render === "function") {
      render();
    }
  }, 600);

  window.setTimeout(() => {
    sanitizeAllStories();
    refreshStoryArchiveRows();

    if (typeof render === "function") {
      render();
    }
  }, 1600);
})();
/* ==========================================================
   CALL LABEL + IRAN LABEL + BUSHEHR + SUBTITLE REPAIR

   Fixes:
   1. Outside-city label appears only briefly at route takeoff.
      It does not travel across the globe with the call.

   2. Persian city name appears directly under the English city/year
      label, not drifting left.

   3. Bushehr / Boushehr is forced to city-level coordinates,
      not province-level coordinates.

   4. Subtitles support both:
        - map cue format:
          00:00:00.000 - 00:00:05.000|Text
        - raw SRT/WebVTT format:
          1
          00:00:00,000 --> 00:00:05,000
          Text
   ========================================================== */

(function repairLabelsBushehrAndSubtitles() {
  if (window.__labelsBushehrSubtitleRepairReady) {
    return;
  }

  window.__labelsBushehrSubtitleRepairReady = true;

  const OUTSIDE_LABEL_TAKEOFF_MAX_PROGRESS = 0.065;

  const PRECISE_IRAN_CITY_COORDS = {
    "bushehr": [50.8203, 28.9234],
    "boushehr": [50.8203, 28.9234],
    "booshehr": [50.8203, 28.9234],
    "busher": [50.8203, 28.9234],
    "bu shahr": [50.8203, 28.9234]
  };

  const PERSIAN_CITY_NAMES = {
    "abadan": "آبادان",
    "ahvaz": "اهواز",
    "ahwaz": "اهواز",
    "arak": "اراک",
    "ardabil": "اردبیل",
    "bandar abbas": "بندرعباس",
    "birjand": "بیرجند",
    "bushehr": "بوشهر",
    "boushehr": "بوشهر",
    "booshehr": "بوشهر",
    "busher": "بوشهر",
    "bu shahr": "بوشهر",
    "dezful": "دزفول",
    "gorgan": "گرگان",
    "hamadan": "همدان",
    "hamedan": "همدان",
    "isfahan": "اصفهان",
    "esfahan": "اصفهان",
    "karaj": "کرج",
    "kashan": "کاشان",
    "kerman": "کرمان",
    "kermanshah": "کرمانشاه",
    "khorramabad": "خرم‌آباد",
    "khorram abad": "خرم‌آباد",
    "mashhad": "مشهد",
    "mashad": "مشهد",
    "neyshabur": "نیشابور",
    "nishapur": "نیشابور",
    "qazvin": "قزوین",
    "qom": "قم",
    "rasht": "رشت",
    "sabzevar": "سبزوار",
    "sanandaj": "سنندج",
    "sari": "ساری",
    "semnan": "سمنان",
    "shiraz": "شیراز",
    "tabriz": "تبریز",
    "tehran": "تهران",
    "urmia": "ارومیه",
    "orumiyeh": "ارومیه",
    "yazd": "یزد",
    "zabol": "زابل",
    "zahedan": "زاهدان",
    "zanjan": "زنجان"
  };

  function normalizePlaceKey(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/ā/g, "a")
      .replace(/ī/g, "i")
      .replace(/ū/g, "u")
      .replace(/ي/g, "ی")
      .replace(/ك/g, "ک")
      .replace(/[‌\-–—_]+/g, " ")
      .replace(/[.,،؛:]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function containsPersian(value) {
    return /[\u0600-\u06FF]/.test(String(value || ""));
  }

  function titleCaseIfPlainLowercase(value) {
    const text = String(value || "").trim();

    if (!text) {
      return "";
    }

    if (/^[a-z\s.'-]+$/.test(text) && text === text.toLowerCase()) {
      return text.replace(/\b[a-z]/g, letter => letter.toUpperCase());
    }

    return text;
  }

  function cleanCityDisplayName(value) {
    let text = String(value || "")
      .replace(/\u00A0/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!text) {
      return "";
    }

    /*
      Remove bracketed/admin hints:
      Bushehr (Province) → Bushehr
      Bushehr [Iran]     → Bushehr
    */
    text = text
      .replace(/\s*\([^)]*\)\s*$/g, "")
      .replace(/\s*\[[^\]]*\]\s*$/g, "")
      .trim();

    /*
      Keep exact city if the value is "Bushehr, Iran".
      Do not destroy useful outside-city values like "San Antonio, Texas".
    */
    const commaParts = text.split(",").map(part => part.trim()).filter(Boolean);

    if (commaParts.length > 1) {
      const rest = commaParts.slice(1).join(" ").toLowerCase();

      if (
        /\biran\b/.test(rest) ||
        /islamic republic/.test(rest) ||
        /ایران/.test(rest) ||
        /ايران/.test(rest)
      ) {
        text = commaParts[0];
      }
    }

    /*
      Remove common administrative suffixes/prefixes.
      This is display-only and does not change coordinates.
    */
    text = text
      .replace(/\b(?:province|county|governorate|prefecture|municipality|region|state|ostan|shahrestan)\b\.?$/i, "")
      .replace(/^(?:province|county|governorate|prefecture|municipality|region|state|ostan|shahrestan)\s+/i, "")
      .replace(/^(?:استان|شهرستان|شهر)\s+/g, "")
      .replace(/\s+(?:استان|شهرستان)$/g, "")
      .replace(/\s+/g, " ")
      .trim();

    return titleCaseIfPlainLowercase(text);
  }

  function getPersianCityName(cityName) {
    const cleanName = cleanCityDisplayName(cityName);

    if (!cleanName) {
      return "";
    }

    if (containsPersian(cleanName)) {
      return cleanName;
    }

    const key = normalizePlaceKey(cleanName);

    return PERSIAN_CITY_NAMES[key] || "";
  }

  function storyIsIranOrigin(story) {
    const countryKey = normalizePlaceKey(story && story.originCountry);

    return (
      !countryKey ||
      countryKey === "iran" ||
      countryKey === "islamic republic of iran" ||
      countryKey === "ایران"
    );
  }

  function sanitizeStoryCityData(story) {
    if (!story) {
      return story;
    }

    story.originCity = cleanCityDisplayName(story.originCity);
    story.destinationCity = cleanCityDisplayName(story.destinationCity);

    /*
      Force exact city-level coordinates for Bushehr/Boushehr.
      This prevents province-level geocoding from placing the point
      slightly wrong.
    */
    const originKey = normalizePlaceKey(story.originCity);

    if (
      storyIsIranOrigin(story) &&
      PRECISE_IRAN_CITY_COORDS[originKey]
    ) {
      story.originCoords = PRECISE_IRAN_CITY_COORDS[originKey].slice();
    }

    return story;
  }

  function sanitizeAllStories() {
    if (Array.isArray(stories)) {
      stories.forEach(sanitizeStoryCityData);
    }

    if (activeStory) {
      sanitizeStoryCityData(activeStory);
    }
  }

  if (
    typeof rowToStory === "function" &&
    !window.__citySubtitleRepairRowToStoryWrapped
  ) {
    const originalRowToStory = rowToStory;

    rowToStory = function repairedRowToStory(row) {
      const story = originalRowToStory(row);
      return sanitizeStoryCityData(story);
    };

    window.__citySubtitleRepairRowToStoryWrapped = true;
  }

  if (
    typeof selectStory === "function" &&
    !window.__citySubtitleRepairSelectStoryWrapped
  ) {
    const originalSelectStory = selectStory;

    selectStory = function repairedSelectStory(story, options = {}) {
      sanitizeStoryCityData(story);
      return originalSelectStory(story, options);
    };

    window.__citySubtitleRepairSelectStoryWrapped = true;
  }

  function ensureNastaliqFontLoaded() {
    if (document.getElementById("noto-nastaliq-urdu-font")) {
      return;
    }

    const preconnectGoogle = document.createElement("link");
    preconnectGoogle.rel = "preconnect";
    preconnectGoogle.href = "https://fonts.googleapis.com";

    const preconnectStatic = document.createElement("link");
    preconnectStatic.rel = "preconnect";
    preconnectStatic.href = "https://fonts.gstatic.com";
    preconnectStatic.crossOrigin = "anonymous";

    const fontLink = document.createElement("link");
    fontLink.id = "noto-nastaliq-urdu-font";
    fontLink.rel = "stylesheet";
    fontLink.href =
      "https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;500;600;700&display=swap";

    document.head.appendChild(preconnectGoogle);
    document.head.appendChild(preconnectStatic);
    document.head.appendChild(fontLink);
  }

  function labelX(d) {
    if (d.role === "home-label") {
      return projectedX(d.coords) + 14;
    }

    return projectedX(d.coords) + 12;
  }

  function labelY(d) {
    if (d.role === "home-label") {
      return projectedY(d.coords) + 4;
    }

    return projectedY(d.coords) + 4;
  }

  function paintMapLabel(selection) {
    selection.each(function paintOneLabel(d) {
      const x = labelX(d);
      const y = labelY(d);
      const text = d3.select(this);

      text
        .attr("x", x)
        .attr("y", y)
        .attr("text-anchor", "start")
        .style("direction", "ltr")
        .style("unicode-bidi", "normal");

      text.text("");
      text.selectAll("*").remove();

      text.append("tspan")
        .attr("class", "map-label-primary")
        .attr("x", x)
        .attr("dy", 0)
        .attr("text-anchor", "start")
        .style("direction", "ltr")
        .style("unicode-bidi", "normal")
        .text(d.text);

      if (d.faText) {
        text.append("tspan")
          .attr("class", "map-label-fa")
          .attr("x", x)
          .attr("dy", "1.35em")
          .attr("lang", "fa")
          .attr("text-anchor", "start")
          .style("direction", "ltr")
          .style("unicode-bidi", "normal")
          .text(d.faText);
      }
    });
  }

  /*
    Replace label behavior:
    - outside/destination city appears only at route takeoff
    - home/Iran city gets English + Persian underneath
  */
  if (typeof renderLabels === "function") {
    renderLabels = function renderRepairedCallAndIranLabels() {
      sanitizeAllStories();

      const labels = [];

      /*
        Show outside city only for the first small fraction of route travel.
        This prevents labels like "Los Angeles" from traveling with the globe.
      */
      const showOutsideCityAtTakeoff =
        activeStory &&
        journeyPhase === "travel" &&
        lineVisible &&
        lineProgress > 0.001 &&
        lineProgress <= OUTSIDE_LABEL_TAKEOFF_MAX_PROGRESS;

      if (showOutsideCityAtTakeoff) {
        labels.push({
          text: cleanCityDisplayName(activeStory.destinationCity),
          faText: "",
          coords: activeStory.destinationCoords,
          role: "call-label"
        });
      }

      /*
        Iranian arrival label.
      */
      const showIranArrivalLabel =
        activeStory &&
        (
          journeyPhase === "line-arrived" ||
          journeyPhase === "line-fade" ||
          journeyPhase === "home-zoom" ||
          journeyPhase === "arrived"
        );

      if (showIranArrivalLabel) {
        const city = cleanCityDisplayName(activeStory.originCity);

        labels.push({
          text: `${city} - ${activeStory.yearLeft}`,
          faText: getPersianCityName(city),
          coords: activeStory.originCoords,
          role: "home-label"
        });
      }

      const labelSelection = labelGroup.selectAll("text.map-label")
        .data(labels, d => `${d.text}-${d.role}`)
        .join(
          enter => {
            const entered = enter.append("text")
              .attr("class", d => `map-label ${d.role}`)
              .attr("x", d => labelX(d))
              .attr("y", d => labelY(d))
              .attr("text-anchor", "start")
              .style("opacity", 0)
              .style("display", d => isVisible(d.coords) ? null : "none");

            paintMapLabel(entered);

            entered
              .transition()
              .duration(360)
              .style("opacity", 1);

            return entered;
          },
          update => {
            update
              .attr("class", d => `map-label ${d.role}`)
              .attr("x", d => labelX(d))
              .attr("y", d => labelY(d))
              .attr("text-anchor", "start")
              .style("display", d => isVisible(d.coords) ? null : "none");

            paintMapLabel(update);

            return update;
          },
          exit => exit
            .transition()
            .duration(180)
            .style("opacity", 0)
            .remove()
        );

      paintMapLabel(labelSelection);
    };
  }

  /*
    Robust subtitle parser.
    Supports existing pipe format and raw SRT/WebVTT.
  */

  function normalizeSubtitleText(value) {
    return String(value || "")
      .replace(/\r/g, "")
      .replace(/\\n/g, "\n")
      .replace(/\uFEFF/g, "")
      .trim();
  }

  parseSubtitleTime = function repairedParseSubtitleTime(value) {
    const text = String(value || "")
      .trim()
      .replace(",", ".");

    if (!text) {
      return NaN;
    }

    if (/^\d+(\.\d+)?$/.test(text)) {
      return Number(text);
    }

    const parts = text.split(":");

    if (parts.length < 2 || parts.length > 3) {
      return NaN;
    }

    const secondsText = parts.pop();
    const seconds = Number(secondsText);
    const minutes = Number(parts.pop());
    const hours = parts.length ? Number(parts.pop()) : 0;

    if (
      !Number.isFinite(seconds) ||
      !Number.isFinite(minutes) ||
      !Number.isFinite(hours)
    ) {
      return NaN;
    }

    return hours * 3600 + minutes * 60 + seconds;
  };

  parseSubtitleCueLine = function repairedParseSubtitleCueLine(line) {
    const cleanedLine = String(line || "").trim();

    if (!cleanedLine) {
      return null;
    }

    /*
      Existing map format:
      00:00:00.000 - 00:00:05.000|Text
    */
    if (cleanedLine.includes("|")) {
      const parts = cleanedLine.split("|");

      if (parts.length < 2) {
        return null;
      }

      const timePart = parts[0].trim();
      const text = parts.slice(1).join("|").trim();

      if (!text) {
        return null;
      }

      const timeParts = timePart.split(/\s*[-–—]\s*/);

      if (timeParts.length < 2) {
        return null;
      }

      const start = parseSubtitleTime(timeParts[0]);
      const end = parseSubtitleTime(timeParts[1]);

      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return null;
      }

      return { start, end, text };
    }

    return null;
  };

  function parseSrtOrVttCues(value) {
    const text = normalizeSubtitleText(value)
      .replace(/^WEBVTT[^\n]*\n+/i, "");

    if (!text.includes("-->")) {
      return [];
    }

    const blocks = text
      .split(/\n{2,}/)
      .map(block => block.trim())
      .filter(Boolean);

    const cues = [];

    blocks.forEach(block => {
      let lines = block
        .split("\n")
        .map(line => line.trim())
        .filter(Boolean);

      if (!lines.length) {
        return;
      }

      /*
        Remove SRT cue number.
      */
      if (/^\d+$/.test(lines[0])) {
        lines = lines.slice(1);
      }

      const timeLineIndex = lines.findIndex(line => line.includes("-->"));

      if (timeLineIndex === -1) {
        return;
      }

      const timeLine = lines[timeLineIndex];
      const textLines = lines.slice(timeLineIndex + 1);

      if (!textLines.length) {
        return;
      }

      const timeParts = timeLine.split(/\s*-->\s*/);

      if (timeParts.length < 2) {
        return;
      }

      const start = parseSubtitleTime(timeParts[0]);
      const end = parseSubtitleTime(
        /*
          Remove WebVTT cue settings after the end timestamp.
        */
        String(timeParts[1] || "").split(/\s+/)[0]
      );

      const cueText = textLines
        .join(" ")
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();

      if (
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        end > start &&
        cueText
      ) {
        cues.push({
          start,
          end,
          text: cueText
        });
      }
    });

    return cues;
  }

  parseSubtitleCues = function repairedParseSubtitleCues(cueText) {
    const text = normalizeSubtitleText(cueText);

    if (!text) {
      return [];
    }

    if (text.includes("-->")) {
      return parseSrtOrVttCues(text);
    }

    return text
      .split(/\n+/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(parseSubtitleCueLine)
      .filter(Boolean);
  };

  startMapSubtitles = function repairedStartMapSubtitles(story) {
    const subtitleOverlay = ensureMapSubtitleOverlay();

    if (!story) {
      hideMapSubtitles();
      return;
    }

    /*
      Primary: subtitle_cues_en.
      Fallback: if someone pasted raw SRT into subtitle_en or translation_en,
      parse those too.
    */
    activeSubtitleCues =
      parseSubtitleCues(story.subtitleCuesEn) ||
      [];

    if (!activeSubtitleCues.length) {
      activeSubtitleCues = parseSubtitleCues(story.subtitleEn);
    }

    if (!activeSubtitleCues.length) {
      activeSubtitleCues = parseSubtitleCues(story.translationEn);
    }

    activeFallbackSubtitle =
      activeSubtitleCues.length
        ? ""
        : String(story.subtitleEn || story.translationEn || "").trim();

    if (!activeSubtitleCues.length && !activeFallbackSubtitle) {
      hideMapSubtitles();
      return;
    }

    subtitleOverlay.textContent = "";
    subtitleOverlay.classList.add("visible");

    audio.removeEventListener("timeupdate", updateMapSubtitleText);
    audio.removeEventListener("play", updateMapSubtitleText);
    audio.removeEventListener("playing", updateMapSubtitleText);
    audio.removeEventListener("seeked", updateMapSubtitleText);

    audio.addEventListener("timeupdate", updateMapSubtitleText);
    audio.addEventListener("play", updateMapSubtitleText);
    audio.addEventListener("playing", updateMapSubtitleText);
    audio.addEventListener("seeked", updateMapSubtitleText);

    updateMapSubtitleText();
  };

  if (
    typeof playStoryAudio === "function" &&
    !window.__subtitlePlayStoryAudioWrapped
  ) {
    const originalPlayStoryAudio = playStoryAudio;

    playStoryAudio = function repairedPlayStoryAudio(story) {
      sanitizeStoryCityData(story);

      const result = originalPlayStoryAudio(story);

      /*
        Run again after play begins; this catches browsers that delay
        currentTime/audio readiness.
      */
      window.setTimeout(() => {
        if (activeStory && story && activeStory.id === story.id) {
          startMapSubtitles(story);
          updateMapSubtitleText();
        }
      }, 120);

      window.setTimeout(() => {
        if (activeStory && story && activeStory.id === story.id) {
          updateMapSubtitleText();
        }
      }, 520);

      return result;
    };

    window.__subtitlePlayStoryAudioWrapped = true;
  }

  ensureNastaliqFontLoaded();
  sanitizeAllStories();

  if (typeof render === "function") {
    render();
  }

  window.setTimeout(() => {
    sanitizeAllStories();

    if (typeof render === "function") {
      render();
    }
  }, 600);

  window.setTimeout(() => {
    sanitizeAllStories();

    if (typeof render === "function") {
      render();
    }
  }, 1600);
})();
/* ==========================================================
   FINAL CALL EXPERIENCE REPAIR

   Fixes:
   1. Outside city label appears only at the beginning of the call.
   2. Persian Iranian city name sits directly under English city/year.
   3. Bushehr/Boushehr uses precise city-level coordinates.
   4. Subtitles start reliably when audio starts and accept:
      - pipe format
      - SRT
      - WebVTT
      - fallback subtitle_en / translation_en text

   Paste at the VERY BOTTOM of script.js.
   ========================================================== */

(function finalCallExperienceRepair() {
  if (window.__finalCallExperienceRepairReady) {
    return;
  }

  window.__finalCallExperienceRepairReady = true;

  const TAKEOFF_LABEL_MAX_PROGRESS = 0.055;

  /*
    City-level Bushehr coordinate.
    If the simplified map coastline still makes it look too close to the edge,
    change this to [50.86, 28.94] as a tiny visual inland nudge.
  */
  const BUSHEHR_CITY_COORDS = [50.8385, 28.9234];

  const PERSIAN_CITY_NAMES = {
    "abadan": "آبادان",
    "ahvaz": "اهواز",
    "ahwaz": "اهواز",
    "arak": "اراک",
    "ardabil": "اردبیل",
    "bandar abbas": "بندرعباس",
    "birjand": "بیرجند",

    "bushehr": "بوشهر",
    "boushehr": "بوشهر",
    "booshehr": "بوشهر",
    "busher": "بوشهر",
    "bu shahr": "بوشهر",

    "dezful": "دزفول",
    "gorgan": "گرگان",
    "hamadan": "همدان",
    "hamedan": "همدان",
    "isfahan": "اصفهان",
    "esfahan": "اصفهان",
    "karaj": "کرج",
    "kashan": "کاشان",
    "kerman": "کرمان",
    "kermanshah": "کرمانشاه",
    "khorramabad": "خرم‌آباد",
    "khorram abad": "خرم‌آباد",
    "mashhad": "مشهد",
    "mashad": "مشهد",
    "neyshabur": "نیشابور",
    "nishapur": "نیشابور",
    "qazvin": "قزوین",
    "qom": "قم",
    "rasht": "رشت",
    "sabzevar": "سبزوار",
    "sanandaj": "سنندج",
    "sari": "ساری",
    "semnan": "سمنان",
    "shiraz": "شیراز",
    "tabriz": "تبریز",
    "tehran": "تهران",
    "urmia": "ارومیه",
    "orumiyeh": "ارومیه",
    "yazd": "یزد",
    "zabol": "زابل",
    "zahedan": "زاهدان",
    "zanjan": "زنجان"
  };

  function normalizeCityKey(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/ā/g, "a")
      .replace(/ī/g, "i")
      .replace(/ū/g, "u")
      .replace(/[‌\-–—_]+/g, " ")
      .replace(/[.,،؛:]+/g, " ")
      .replace(/\s+/g, " ");
  }

  function titleCaseCity(value) {
    const text = String(value || "").trim();

    if (!text) {
      return "";
    }

    if (/^[a-z\s.'-]+$/.test(text) && text === text.toLowerCase()) {
      return text.replace(/\b[a-z]/g, letter => letter.toUpperCase());
    }

    return text;
  }

  function cleanCityName(value) {
    let text = String(value || "")
      .replace(/\u00A0/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!text) {
      return "";
    }

    text = text
      .replace(/\s*\([^)]*\)\s*$/g, "")
      .replace(/\s*\[[^\]]*\]\s*$/g, "")
      .trim();

    const commaParts = text.split(",").map(part => part.trim()).filter(Boolean);

    if (commaParts.length > 1) {
      const rest = commaParts.slice(1).join(" ").toLowerCase();

      if (
        /\biran\b/.test(rest) ||
        /islamic republic/.test(rest) ||
        /ایران/.test(rest) ||
        /ايران/.test(rest)
      ) {
        text = commaParts[0];
      }
    }

    text = text
      .replace(/\b(?:province|county|governorate|prefecture|municipality|region|state|ostan|shahrestan)\b\.?$/i, "")
      .replace(/^(?:province|county|governorate|prefecture|municipality|region|state|ostan|shahrestan)\s+/i, "")
      .replace(/^(?:استان|شهرستان|شهر)\s+/g, "")
      .replace(/\s+(?:استان|شهرستان)$/g, "")
      .replace(/\s+/g, " ")
      .trim();

    const key = normalizeCityKey(text);

    if (key === "los angles" || key === "los angelos") {
      return "Los Angeles";
    }

    if (key === "bushehr" || key === "booshehr" || key === "busher") {
      return "Bushehr";
    }

    if (key === "boushehr") {
      return "Boushehr";
    }

    return titleCaseCity(text);
  }

  function getPersianCityName(cityName) {
    const cleaned = cleanCityName(cityName);
    const key = normalizeCityKey(cleaned);

    return PERSIAN_CITY_NAMES[key] || "";
  }

  function isBushehrCity(value) {
    const key = normalizeCityKey(value);

    return (
      key === "bushehr" ||
      key === "boushehr" ||
      key === "booshehr" ||
      key === "busher" ||
      key === "bu shahr"
    );
  }

  function storyLooksIranOrigin(story) {
    const country = normalizeCityKey(story && story.originCountry);

    return (
      !country ||
      country === "iran" ||
      country === "islamic republic of iran" ||
      country === "ایران"
    );
  }

  function sanitizeStoryForFinalRepair(story) {
    if (!story) {
      return story;
    }

    story.originCity = cleanCityName(story.originCity);
    story.destinationCity = cleanCityName(story.destinationCity);

    if (isBushehrCity(story.originCity) && storyLooksIranOrigin(story)) {
      story.originCoords = BUSHEHR_CITY_COORDS.slice();
    }

    /*
      Safety for the typo that already happened in ReviewData/PublicMapData.
    */
    if (normalizeCityKey(story.destinationCity) === "los angles") {
      story.destinationCity = "Los Angeles";
      story.destinationCountry = story.destinationCountry || "United States";
      story.destinationCoords = [-118.2437, 34.0522];
    }

    return story;
  }

  function sanitizeAllStoriesForFinalRepair() {
    if (Array.isArray(stories)) {
      stories.forEach(sanitizeStoryForFinalRepair);
    }

    if (activeStory) {
      sanitizeStoryForFinalRepair(activeStory);
    }
  }

  /*
    Catch future rows as they load from PublicMapData.
  */
  if (
    typeof rowToStory === "function" &&
    !window.__finalRepairRowToStoryWrapped
  ) {
    const originalRowToStory = rowToStory;

    rowToStory = function finalRepairRowToStory(row) {
      const story = originalRowToStory(row);
      return sanitizeStoryForFinalRepair(story);
    };

    window.__finalRepairRowToStoryWrapped = true;
  }

  /*
    Catch selected stories.
  */
  if (
    typeof selectStory === "function" &&
    !window.__finalRepairSelectStoryWrapped
  ) {
    const originalSelectStory = selectStory;

    selectStory = function finalRepairSelectStory(story, options = {}) {
      sanitizeStoryForFinalRepair(story);
      return originalSelectStory(story, options);
    };

    window.__finalRepairSelectStoryWrapped = true;
  }

  function labelVisible(coords) {
    if (typeof isVisible !== "function") {
      return true;
    }

    return isVisible(coords);
  }

  function labelPoint(coords) {
    if (typeof projection !== "function") {
      return null;
    }

    const point = projection(coords);

    if (
      !point ||
      !Number.isFinite(point[0]) ||
      !Number.isFinite(point[1])
    ) {
      return null;
    }

    return point;
  }

  function shouldShowTakeoffLabel() {
    if (!activeStory) {
      return false;
    }

    /*
      Visible while the call gathers at the outside city,
      and for only the first moments of the route line.
    */
    if (journeyPhase === "calling") {
      return true;
    }

    return (
      journeyPhase === "travel" &&
      lineVisible &&
      lineProgress > 0.001 &&
      lineProgress <= TAKEOFF_LABEL_MAX_PROGRESS
    );
  }

  function shouldShowIranArrivalLabel() {
    return Boolean(
      activeStory &&
      (
        journeyPhase === "line-arrived" ||
        journeyPhase === "line-fade" ||
        journeyPhase === "home-zoom" ||
        journeyPhase === "arrived"
      )
    );
  }

  function drawTakeoffLabel(story) {
    const point = labelPoint(story.destinationCoords);

    if (!point || !labelVisible(story.destinationCoords)) {
      return;
    }

    const x = point[0] + 14;
    const y = point[1] + 5;

    const label = labelGroup.append("text")
      .attr("class", "map-label call-label final-call-label")
      .attr("x", x)
      .attr("y", y)
      .attr("text-anchor", "start")
      .style("opacity", 1)
      .text(cleanCityName(story.destinationCity));

    label.append("title")
      .text(cleanCityName(story.destinationCity));
  }

  function drawIranArrivalLabel(story) {
    const point = labelPoint(story.originCoords);

    if (!point || !labelVisible(story.originCoords)) {
      return;
    }

    const city = cleanCityName(story.originCity);
    const faCity = getPersianCityName(city);

    /*
      Center both lines on the same x so Persian sits under English.
      This avoids the RTL drift that pushed بوشهر to the left.
    */
    const x = point[0] + 58;
    const y = point[1] + 5;

    const label = labelGroup.append("text")
      .attr("class", "map-label home-label final-home-label")
      .attr("x", x)
      .attr("y", y)
      .attr("text-anchor", "middle")
      .style("opacity", 1);

    label.append("tspan")
      .attr("class", "map-label-primary")
      .attr("x", x)
      .attr("dy", 0)
      .attr("text-anchor", "middle")
      .text(`${city} - ${story.yearLeft}`);

    if (faCity) {
      label.append("tspan")
        .attr("class", "map-label-fa")
        .attr("x", x)
        .attr("dy", "1.42em")
        .attr("text-anchor", "middle")
        .attr("lang", "fa")
        .attr("dir", "rtl")
        .style("direction", "rtl")
        .style("unicode-bidi", "plaintext")
        .text(faCity);
    }
  }

  function renderFinalLabelsOnly() {
    if (
      typeof labelGroup === "undefined" ||
      !labelGroup ||
      typeof labelGroup.selectAll !== "function"
    ) {
      return;
    }

    sanitizeAllStoriesForFinalRepair();

    /*
      Remove labels created by older renderLabels patches.
      Then redraw only the current final labels.
    */
    labelGroup.selectAll("text.map-label")
      .interrupt()
      .remove();

    if (!activeStory) {
      return;
    }

    if (shouldShowTakeoffLabel()) {
      drawTakeoffLabel(activeStory);
    }

    if (shouldShowIranArrivalLabel()) {
      drawIranArrivalLabel(activeStory);
    }
  }

  /*
    Replace renderLabels directly.
  */
  if (typeof renderLabels === "function") {
    renderLabels = function finalRepairRenderLabels() {
      renderFinalLabelsOnly();
    };
  }

  /*
    Also wrap render, so even if another older patch draws labels,
    this final repair cleans them afterward.
  */
  if (
    typeof render === "function" &&
    !window.__finalRepairRenderWrapped
  ) {
    const originalRender = render;

    render = function finalRepairRender() {
      const result = originalRender();
      renderFinalLabelsOnly();
      return result;
    };

    window.__finalRepairRenderWrapped = true;
  }

  /* ---------------- SUBTITLE REPAIR ---------------- */

  function normalizeSubtitleInput(value) {
    return String(value || "")
      .replace(/\r/g, "")
      .replace(/\\n/g, "\n")
      .replace(/\uFEFF/g, "")
      .trim();
  }

  parseSubtitleTime = function finalRepairParseSubtitleTime(value) {
    const text = String(value || "")
      .trim()
      .replace(",", ".");

    if (!text) {
      return NaN;
    }

    if (/^\d+(\.\d+)?$/.test(text)) {
      return Number(text);
    }

    const parts = text.split(":");

    if (parts.length < 2 || parts.length > 3) {
      return NaN;
    }

    const seconds = Number(parts.pop());
    const minutes = Number(parts.pop());
    const hours = parts.length ? Number(parts.pop()) : 0;

    if (
      !Number.isFinite(hours) ||
      !Number.isFinite(minutes) ||
      !Number.isFinite(seconds)
    ) {
      return NaN;
    }

    return hours * 3600 + minutes * 60 + seconds;
  };

  parseSubtitleCueLine = function finalRepairParseSubtitleCueLine(line) {
    const cleaned = String(line || "").trim();

    if (!cleaned || !cleaned.includes("|")) {
      return null;
    }

    const parts = cleaned.split("|");
    const timePart = parts[0].trim();
    const cueText = parts.slice(1).join("|").trim();

    if (!cueText) {
      return null;
    }

    const timeParts = timePart.split(/\s*[-–—]\s*/);

    if (timeParts.length < 2) {
      return null;
    }

    const start = parseSubtitleTime(timeParts[0]);
    const end = parseSubtitleTime(timeParts[1]);

    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return null;
    }

    return {
      start,
      end,
      text: cueText
    };
  };

  function parseSrtOrVttSubtitleCues(value) {
    const text = normalizeSubtitleInput(value)
      .replace(/^WEBVTT[^\n]*\n+/i, "");

    if (!text.includes("-->")) {
      return [];
    }

    const blocks = text
      .split(/\n{2,}/)
      .map(block => block.trim())
      .filter(Boolean);

    const cues = [];

    blocks.forEach(block => {
      let lines = block
        .split("\n")
        .map(line => line.trim())
        .filter(Boolean);

      if (!lines.length) {
        return;
      }

      if (/^\d+$/.test(lines[0])) {
        lines = lines.slice(1);
      }

      const timeLineIndex = lines.findIndex(line => line.includes("-->"));

      if (timeLineIndex === -1) {
        return;
      }

      const timeLine = lines[timeLineIndex];
      const textLines = lines.slice(timeLineIndex + 1);

      if (!textLines.length) {
        return;
      }

      const timeParts = timeLine.split(/\s*-->\s*/);

      if (timeParts.length < 2) {
        return;
      }

      const start = parseSubtitleTime(timeParts[0]);
      const end = parseSubtitleTime(String(timeParts[1] || "").split(/\s+/)[0]);

      const cueText = textLines
        .join(" ")
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();

      if (
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        end > start &&
        cueText
      ) {
        cues.push({
          start,
          end,
          text: cueText
        });
      }
    });

    return cues;
  }

  parseSubtitleCues = function finalRepairParseSubtitleCues(value) {
    const text = normalizeSubtitleInput(value);

    if (!text) {
      return [];
    }

    if (text.includes("-->")) {
      return parseSrtOrVttSubtitleCues(text);
    }

    return text
      .split(/\n+/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(parseSubtitleCueLine)
      .filter(Boolean);
  };

  function clearSubtitleTicker() {
    if (window.__mgSubtitleTicker) {
      clearInterval(window.__mgSubtitleTicker);
      window.__mgSubtitleTicker = null;
    }
  }

  function getSubtitleSources(story) {
    if (!story) {
      return [];
    }

    return [
      story.subtitleCuesEn,
      story.subtitleEn,
      story.translationEn
    ];
  }

  startMapSubtitles = function finalRepairStartMapSubtitles(story) {
    const subtitleOverlay = ensureMapSubtitleOverlay();

    clearSubtitleTicker();

    activeSubtitleCues = [];
    activeFallbackSubtitle = "";

    if (!story) {
      hideMapSubtitles();
      return;
    }

    const sources = getSubtitleSources(story);

    for (let i = 0; i < sources.length; i++) {
      const cues = parseSubtitleCues(sources[i]);

      if (cues && cues.length) {
        activeSubtitleCues = cues;
        break;
      }
    }

    if (!activeSubtitleCues.length) {
      activeFallbackSubtitle = String(story.subtitleEn || story.translationEn || "").trim();
    }

    if (!activeSubtitleCues.length && !activeFallbackSubtitle) {
      hideMapSubtitles();
      return;
    }

    subtitleOverlay.textContent = "";
    subtitleOverlay.classList.add("visible");

    audio.removeEventListener("timeupdate", updateMapSubtitleText);
    audio.removeEventListener("play", updateMapSubtitleText);
    audio.removeEventListener("playing", updateMapSubtitleText);
    audio.removeEventListener("seeked", updateMapSubtitleText);
    audio.removeEventListener("loadedmetadata", updateMapSubtitleText);
    audio.removeEventListener("canplay", updateMapSubtitleText);

    audio.addEventListener("timeupdate", updateMapSubtitleText);
    audio.addEventListener("play", updateMapSubtitleText);
    audio.addEventListener("playing", updateMapSubtitleText);
    audio.addEventListener("seeked", updateMapSubtitleText);
    audio.addEventListener("loadedmetadata", updateMapSubtitleText);
    audio.addEventListener("canplay", updateMapSubtitleText);

    updateMapSubtitleText();

    /*
      Some browsers are lazy with timeupdate at the beginning.
      This ticker guarantees the first subtitle appears as audio starts.
    */
    window.__mgSubtitleTicker = window.setInterval(() => {
      if (!audio || audio.paused || audio.ended) {
        return;
      }

      updateMapSubtitleText();
    }, 120);
  };

  updateMapSubtitleText = function finalRepairUpdateMapSubtitleText() {
    const subtitleOverlay = ensureMapSubtitleOverlay();

    if (!activeSubtitleCues.length && !activeFallbackSubtitle) {
      hideMapSubtitles();
      return;
    }

    const currentTime = Number(audio.currentTime || 0);

    if (activeSubtitleCues.length) {
      const activeCue = activeSubtitleCues.find(cue => {
        return currentTime >= cue.start && currentTime < cue.end;
      });

      if (activeCue) {
        subtitleOverlay.textContent = activeCue.text;
        subtitleOverlay.classList.add("visible");
      } else {
        subtitleOverlay.textContent = "";
        subtitleOverlay.classList.remove("visible");
      }

      return;
    }

    subtitleOverlay.textContent = activeFallbackSubtitle;
    subtitleOverlay.classList.add("visible");
  };

  hideMapSubtitles = function finalRepairHideMapSubtitles() {
    const subtitleOverlay = document.getElementById("map-subtitle-overlay");

    clearSubtitleTicker();

    audio.removeEventListener("timeupdate", updateMapSubtitleText);
    audio.removeEventListener("play", updateMapSubtitleText);
    audio.removeEventListener("playing", updateMapSubtitleText);
    audio.removeEventListener("seeked", updateMapSubtitleText);
    audio.removeEventListener("loadedmetadata", updateMapSubtitleText);
    audio.removeEventListener("canplay", updateMapSubtitleText);

    activeSubtitleCues = [];
    activeFallbackSubtitle = "";

    if (subtitleOverlay) {
      subtitleOverlay.textContent = "";
      subtitleOverlay.classList.remove("visible");
    }
  };

  if (
    typeof playStoryAudio === "function" &&
    !window.__finalRepairPlayAudioWrapped
  ) {
    const originalPlayStoryAudio = playStoryAudio;

    playStoryAudio = function finalRepairPlayStoryAudio(story) {
      sanitizeStoryForFinalRepair(story);

      const result = originalPlayStoryAudio(story);

      /*
        Re-start subtitles after audio play has actually begun.
      */
      window.setTimeout(() => {
        if (activeStory && story && activeStory.id === story.id) {
          startMapSubtitles(story);
          updateMapSubtitleText();
        }
      }, 120);

      window.setTimeout(() => {
        if (activeStory && story && activeStory.id === story.id) {
          updateMapSubtitleText();
        }
      }, 480);

      return result;
    };

    window.__finalRepairPlayAudioWrapped = true;
  }

  sanitizeAllStoriesForFinalRepair();
  renderFinalLabelsOnly();

  if (typeof render === "function") {
    render();
  }

  window.setTimeout(() => {
    sanitizeAllStoriesForFinalRepair();
    renderFinalLabelsOnly();

    if (typeof render === "function") {
      render();
    }
  }, 700);

  window.setTimeout(() => {
    sanitizeAllStoriesForFinalRepair();
    renderFinalLabelsOnly();

    if (typeof render === "function") {
      render();
    }
  }, 1800);
})();
/* ==========================================================
   AUDIO-FIRST ADDITIONAL CONTENT SEQUENCE

   Keeps subtitles/audio as the first experience. Image, text, and
   external-link fragments stay hidden until the active audio ends.
   After audio ends, one small City — Year button reveals the existing
   image/text/link systems without changing their visual language.
   ========================================================== */

(function audioFirstAdditionalContentSequence() {
  if (window.__audioFirstAdditionalContentSequenceReady) {
    return;
  }

  window.__audioFirstAdditionalContentSequenceReady = true;

  const REVEAL_BUTTON_ID = "story-extra-reveal-button";
  const LINK_PANEL_ID = "story-extra-link-panel";

  const state = {
    story: null,
    storyId: "",
    audioEnded: false,
    contentRevealed: false,
    hiding: false
  };

  function normalizeExtraUrl(value) {
    if (typeof normalizeUrl === "function") {
      return normalizeUrl(value);
    }

    const link = String(value || "").trim();

    if (!link) return "";
    if (/^https?:\/\//i.test(link)) return link;
    if (/^www\./i.test(link)) return `https://${link}`;

    return link;
  }

  function hasStoryText(story) {
    const text = String(story && story.quote || "").trim();

    if (!text) {
      return false;
    }

    const lower = text.toLowerCase();

    return (
      lower !== "no story text yet." &&
      lower !== "click a blinking point outside iran. the map will carry the call back home."
    );
  }

  function getStoryLink(story) {
    return normalizeExtraUrl(story && story.fileOrLink);
  }

  function hasImageFragment(story) {
    const link = getStoryLink(story);

    return Boolean(link && typeof isImageUrl === "function" && isImageUrl(link));
  }

  function hasExternalLink(story) {
    const link = getStoryLink(story);

    return Boolean(link && !hasImageFragment(story));
  }

  function hasAdditionalContent(story) {
    return Boolean(
      story &&
      (
        hasStoryText(story) ||
        hasImageFragment(story) ||
        hasExternalLink(story)
      )
    );
  }

  function revealLabel(story) {
    const city = String(story && story.originCity || "Unknown city").trim();
    const year = String(story && story.yearLeft || "—").trim();

    return `${city} — ${year}`;
  }

  function ensureRevealButton() {
    let button = document.getElementById(REVEAL_BUTTON_ID);

    if (button) {
      return button;
    }

    button = document.createElement("button");
    button.id = REVEAL_BUTTON_ID;
    button.className = "story-extra-reveal-button";
    button.type = "button";
    button.setAttribute("aria-label", "Reveal submitted fragment");

    button.addEventListener("click", () => {
      revealAdditionalContent();
    });

    document.body.appendChild(button);

    return button;
  }

  function hideRevealButton() {
    const button = document.getElementById(REVEAL_BUTTON_ID);

    if (button) {
      button.classList.remove("visible");
      button.setAttribute("aria-hidden", "true");
    }
  }

  function maybeShowRevealButton() {
    if (
      !state.story ||
      !state.audioEnded ||
      state.contentRevealed ||
      !hasAdditionalContent(state.story) ||
      (typeof journeyPhase !== "undefined" && journeyPhase !== "arrived")
    ) {
      hideRevealButton();
      return;
    }

    const button = ensureRevealButton();
    button.textContent = revealLabel(state.story);
    button.classList.add("visible");
    button.setAttribute("aria-hidden", "false");
  }

  function ensureLinkPanel() {
    let panel = document.getElementById(LINK_PANEL_ID);

    if (panel) {
      return panel;
    }

    panel = document.createElement("aside");
    panel.id = LINK_PANEL_ID;
    panel.className = "story-extra-link-panel";
    panel.setAttribute("aria-hidden", "true");

    panel.innerHTML = `
      <p class="story-extra-link-eyebrow">Fragment link</p>
      <a
        id="story-extra-link-anchor"
        class="story-extra-link-anchor"
        target="_blank"
        rel="noopener noreferrer"
      >Open submitted fragment</a>
    `;

    document.body.appendChild(panel);

    return panel;
  }

  function showExternalLinkPanel(story) {
    const link = getStoryLink(story);

    if (!link || hasImageFragment(story)) {
      hideExternalLinkPanel();
      return;
    }

    const panel = ensureLinkPanel();
    const anchor = document.getElementById("story-extra-link-anchor");

    if (anchor) {
      anchor.href = link;
    }

    panel.classList.add("visible");
    panel.setAttribute("aria-hidden", "false");
  }

  function hideExternalLinkPanel() {
    const panel = document.getElementById(LINK_PANEL_ID);
    const anchor = document.getElementById("story-extra-link-anchor");

    if (panel) {
      panel.classList.remove("visible");
      panel.setAttribute("aria-hidden", "true");
    }

    if (anchor) {
      anchor.removeAttribute("href");
    }
  }

  function hideAdditionalContent() {
    if (state.hiding) {
      return;
    }

    state.hiding = true;

    const textClose = document.getElementById("story-text-close");

    if (textClose) {
      textClose.click();
    }

    const textPanel = document.getElementById("story-text-panel");

    if (textPanel) {
      textPanel.classList.remove("visible", "full-mode", "finished", "dissolved");
    }

    const imageThumb = document.getElementById("story-image-thumb");

    if (imageThumb) {
      imageThumb.classList.remove("visible");
      imageThumb.classList.add("offscreen");
    }

    const imageModal = document.getElementById("story-image-modal");

    if (imageModal) {
      imageModal.classList.remove("visible");
      imageModal.setAttribute("aria-hidden", "true");
    }

    document.body.classList.remove("story-image-modal-open");

    const attachmentLink = document.getElementById("story-attachment-link");

    if (attachmentLink) {
      attachmentLink.style.display = "none";
    }

    const attachmentImage = document.getElementById("story-attachment-image");

    if (attachmentImage) {
      attachmentImage.style.display = "none";
    }

    const languagePanel = document.getElementById("story-language-panel");

    if (languagePanel) {
      languagePanel.style.display = "none";
    }

    hideExternalLinkPanel();

    state.hiding = false;
  }

  function resetSequence(story) {
    state.story = story || null;
    state.storyId = story && story.id ? String(story.id) : "";
    state.audioEnded = false;
    state.contentRevealed = false;

    hideRevealButton();
    hideAdditionalContent();
  }

  function markAudioEndedForCurrentStory() {
    if (!state.story || !state.storyId) {
      return;
    }

    if (activeStory && String(activeStory.id || "") !== state.storyId) {
      return;
    }

    state.audioEnded = true;
    maybeShowRevealButton();
  }

  function revealAdditionalContent() {
    if (!state.story || !state.audioEnded || !hasAdditionalContent(state.story)) {
      return;
    }

    state.contentRevealed = true;
    hideRevealButton();

    if (typeof updateStoryPanelFinal === "function") {
      updateStoryPanelFinal(state.story);
    }

    if (hasExternalLink(state.story)) {
      showExternalLinkPanel(state.story);
    }
  }

  if (audio && typeof audio.addEventListener === "function") {
    audio.addEventListener("ended", markAudioEndedForCurrentStory);
  }

  if (typeof selectStory === "function" && !window.__audioFirstSelectStoryWrapped) {
    const originalSelectStory = selectStory;

    selectStory = function audioFirstSelectStory(story, options = {}) {
      resetSequence(story);
      return originalSelectStory(story, options);
    };

    window.__audioFirstSelectStoryWrapped = true;
  }

  if (typeof updateStoryPanelCalling === "function" && !window.__audioFirstCallingWrapped) {
    const originalUpdateStoryPanelCalling = updateStoryPanelCalling;

    updateStoryPanelCalling = function audioFirstCallingPanel(story) {
      hideRevealButton();
      hideAdditionalContent();
      return originalUpdateStoryPanelCalling(story);
    };

    window.__audioFirstCallingWrapped = true;
  }

  if (typeof updateStoryPanelTraveling === "function" && !window.__audioFirstTravelingWrapped) {
    const originalUpdateStoryPanelTraveling = updateStoryPanelTraveling;

    updateStoryPanelTraveling = function audioFirstTravelingPanel(story) {
      hideRevealButton();
      hideAdditionalContent();
      return originalUpdateStoryPanelTraveling(story);
    };

    window.__audioFirstTravelingWrapped = true;
  }

  if (typeof updateStoryPanelFinal === "function" && !window.__audioFirstFinalWrapped) {
    const originalUpdateStoryPanelFinal = updateStoryPanelFinal;

    updateStoryPanelFinal = function audioFirstFinalPanel(story) {
      const result = originalUpdateStoryPanelFinal(story);

      if (!state.contentRevealed) {
        if (state.storyId && story && String(story.id || "") === state.storyId) {
          hideAdditionalContent();
          maybeShowRevealButton();
        }
      }

      return result;
    };

    window.__audioFirstFinalWrapped = true;
  }

  if (typeof resetView === "function" && !window.__audioFirstResetWrapped) {
    const originalResetView = resetView;

    resetView = function audioFirstResetView() {
      resetSequence(null);
      return originalResetView();
    };

    window.__audioFirstResetWrapped = true;
  }

  if (typeof goToIranView === "function" && !window.__audioFirstIranViewWrapped) {
    const originalGoToIranView = goToIranView;

    goToIranView = function audioFirstIranView() {
      hideRevealButton();
      hideAdditionalContent();
      return originalGoToIranView();
    };

    window.__audioFirstIranViewWrapped = true;
  }

  if (typeof render === "function" && !window.__audioFirstRenderWrapped) {
    const originalRender = render;

    render = function audioFirstRender() {
      const result = originalRender();

      if (!state.contentRevealed) {
        hideAdditionalContent();
        maybeShowRevealButton();
      }

      return result;
    };

    window.__audioFirstRenderWrapped = true;
  }

  /*
    Do not watch the whole document for class/style changes here.
    The existing journey wrappers already hide extra content before reveal,
    and a body-wide MutationObserver can self-trigger while subtitles/audio
    UI update, locking the page even though the audio keeps playing.
  */
})();
/* ==========================================================
   AUDIO DOCK — SEEK + DRAG REPAIR

   Fixes:
   1. Audio progress bar can be dragged/clicked to seek.
   2. Back / forward buttons seek by 10 seconds reliably.
   3. Progress thumb does not fight with timeupdate while dragging.

   Paste at the VERY BOTTOM of script.js.
   ========================================================== */

(function repairAudioDockSeeking() {
  if (window.__mgAudioDockSeekingRepairReady) {
    return;
  }

  window.__mgAudioDockSeekingRepairReady = true;

  const SEEK_STEP_SECONDS = 10;

  const state = {
    draggingProgress: false,
    lastKnownDuration: 0
  };

  function getParts() {
    return {
      audioElement:
        typeof audio !== "undefined"
          ? audio
          : document.getElementById("story-audio"),
      dock: document.getElementById("audio-dock"),
      backButton: document.getElementById("audio-back-10"),
      playPauseButton: document.getElementById("audio-play-pause"),
      forwardButton: document.getElementById("audio-forward-10"),
      progressInput: document.getElementById("audio-progress"),
      timeLabel: document.getElementById("audio-time")
    };
  }

  function isFinitePositive(value) {
    return Number.isFinite(value) && value > 0;
  }

  function getUsableDuration(audioElement) {
    if (!audioElement) {
      return 0;
    }

    if (isFinitePositive(audioElement.duration)) {
      state.lastKnownDuration = audioElement.duration;
      return audioElement.duration;
    }

    /*
      Some remote / redirected audio files do not expose duration immediately.
      If the browser has a seekable range, use that.
    */
    try {
      if (audioElement.seekable && audioElement.seekable.length) {
        const end = audioElement.seekable.end(audioElement.seekable.length - 1);

        if (isFinitePositive(end)) {
          state.lastKnownDuration = end;
          return end;
        }
      }
    } catch (error) {}

    return state.lastKnownDuration || 0;
  }

  function hasAudioSource(audioElement) {
    return Boolean(
      audioElement &&
      (
        audioElement.currentSrc ||
        audioElement.src ||
        audioElement.getAttribute("src")
      )
    );
  }

  function clampTime(value, audioElement) {
    const duration = getUsableDuration(audioElement);

    if (duration > 0) {
      return Math.max(0, Math.min(duration, value));
    }

    return Math.max(0, value);
  }

  function seekTo(seconds) {
    const { audioElement } = getParts();

    if (!hasAudioSource(audioElement)) {
      return;
    }

    const target = clampTime(seconds, audioElement);

    try {
      audioElement.currentTime = target;
    } catch (error) {
      /*
        If the browser rejects a precise seek before metadata is ready,
        try again just after metadata is available.
      */
      audioElement.addEventListener(
        "loadedmetadata",
        () => {
          try {
            audioElement.currentTime = clampTime(seconds, audioElement);
            syncAudioDockVisuals();
          } catch (retryError) {}
        },
        { once: true }
      );
    }

    syncSubtitlesAfterSeek();
    syncAudioDockVisuals();
  }

  function seekBy(deltaSeconds) {
    const { audioElement } = getParts();

    if (!hasAudioSource(audioElement)) {
      return;
    }

    const current = Number.isFinite(audioElement.currentTime)
      ? audioElement.currentTime
      : 0;

    seekTo(current + deltaSeconds);
  }

  function progressValueToTime() {
    const { audioElement, progressInput } = getParts();

    if (!audioElement || !progressInput) {
      return 0;
    }

    const duration = getUsableDuration(audioElement);
    const value = Number(progressInput.value || 0);
    const percentage = Math.max(0, Math.min(100, value)) / 100;

    if (duration > 0) {
      return duration * percentage;
    }

    return 0;
  }

  function seekFromProgress() {
    const { audioElement } = getParts();

    if (!hasAudioSource(audioElement)) {
      return;
    }

    const target = progressValueToTime();

    if (target > 0 || Number(getParts().progressInput?.value || 0) === 0) {
      seekTo(target);
    }
  }

  function syncSubtitlesAfterSeek() {
    if (typeof updateMapSubtitleText === "function") {
      try {
        updateMapSubtitleText();
      } catch (error) {}
    }
  }

  function formatTime(seconds) {
    const safe = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(safe / 60);
    const remainder = Math.floor(safe % 60);

    return `${minutes}:${String(remainder).padStart(2, "0")}`;
  }

  function syncAudioDockVisuals() {
    const {
      audioElement,
      dock,
      backButton,
      playPauseButton,
      forwardButton,
      progressInput,
      timeLabel
    } = getParts();

    if (!audioElement || !progressInput) {
      return;
    }

    const sourceReady = hasAudioSource(audioElement);
    const duration = getUsableDuration(audioElement);
    const current = Number.isFinite(audioElement.currentTime)
      ? audioElement.currentTime
      : 0;

    if (!state.draggingProgress) {
      const percentage = duration > 0
        ? Math.max(0, Math.min(100, (current / duration) * 100))
        : 0;

      progressInput.value = String(percentage);
    }

    if (timeLabel) {
      timeLabel.textContent = `${formatTime(current)} / ${duration ? formatTime(duration) : "0:00"}`;
    }

    /*
      Keep controls enabled whenever there is an audio source.
      Do not require duration to be known before allowing back/forward.
    */
    [backButton, playPauseButton, forwardButton, progressInput].forEach(control => {
      if (control) {
        control.disabled = !sourceReady;
        control.setAttribute("aria-disabled", sourceReady ? "false" : "true");
      }
    });

    if (dock) {
      dock.classList.toggle("audio-dock-has-source", sourceReady);
      dock.classList.toggle("audio-dock-seeking", state.draggingProgress);
      dock.classList.toggle(
        "audio-dock-active",
        sourceReady && (!audioElement.paused || current > 0.05)
      );
      dock.classList.toggle(
        "audio-dock-playing",
        sourceReady && !audioElement.paused
      );
    }

    /*
      Preserve icon-decorating patches if they exist.
    */
    if (typeof refreshAudioDock === "function" && !window.__mgAudioDockSeekingRepairRefreshing) {
      try {
        window.__mgAudioDockSeekingRepairRefreshing = true;
      } finally {
        window.__mgAudioDockSeekingRepairRefreshing = false;
      }
    }
  }

  function bindOnce() {
    const {
      audioElement,
      backButton,
      forwardButton,
      progressInput
    } = getParts();

    if (!audioElement || !backButton || !forwardButton || !progressInput) {
      return false;
    }

    if (window.__mgAudioDockSeekingRepairBound) {
      return true;
    }

    window.__mgAudioDockSeekingRepairBound = true;

    /*
      Capture phase + stopImmediatePropagation prevents older no-op listeners
      from fighting this repair.
    */
    backButton.addEventListener(
      "click",
      event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        seekBy(-SEEK_STEP_SECONDS);
      },
      true
    );

    forwardButton.addEventListener(
      "click",
      event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        seekBy(SEEK_STEP_SECONDS);
      },
      true
    );

    progressInput.addEventListener(
      "pointerdown",
      () => {
        state.draggingProgress = true;
        syncAudioDockVisuals();
      },
      true
    );

    progressInput.addEventListener(
      "mousedown",
      () => {
        state.draggingProgress = true;
        syncAudioDockVisuals();
      },
      true
    );

    progressInput.addEventListener(
      "touchstart",
      () => {
        state.draggingProgress = true;
        syncAudioDockVisuals();
      },
      { capture: true, passive: true }
    );

    progressInput.addEventListener(
      "input",
      event => {
        event.stopImmediatePropagation();
        seekFromProgress();
      },
      true
    );

    progressInput.addEventListener(
      "change",
      event => {
        event.stopImmediatePropagation();
        seekFromProgress();
        state.draggingProgress = false;
        syncAudioDockVisuals();
      },
      true
    );

    window.addEventListener(
      "pointerup",
      () => {
        if (state.draggingProgress) {
          seekFromProgress();
          state.draggingProgress = false;
          syncAudioDockVisuals();
        }
      },
      true
    );

    window.addEventListener(
      "mouseup",
      () => {
        if (state.draggingProgress) {
          seekFromProgress();
          state.draggingProgress = false;
          syncAudioDockVisuals();
        }
      },
      true
    );

    window.addEventListener(
      "touchend",
      () => {
        if (state.draggingProgress) {
          seekFromProgress();
          state.draggingProgress = false;
          syncAudioDockVisuals();
        }
      },
      true
    );

    [
      "loadedmetadata",
      "durationchange",
      "canplay",
      "timeupdate",
      "play",
      "pause",
      "seeked",
      "ended",
      "emptied"
    ].forEach(eventName => {
      audioElement.addEventListener(eventName, syncAudioDockVisuals);
    });

    /*
      Wrap the existing dock updater so it does not reset the thumb
      while the viewer is dragging it.
    */
    if (
      typeof audioDockUpdate === "function" &&
      !window.__mgAudioDockSeekingRepairWrappedUpdate
    ) {
      const originalAudioDockUpdate = audioDockUpdate;

      audioDockUpdate = function repairedAudioDockUpdate() {
        const { progressInput: liveProgress } = getParts();
        const preservedValue = liveProgress ? liveProgress.value : "";

        const result = originalAudioDockUpdate.apply(this, arguments);

        if (state.draggingProgress && liveProgress) {
          liveProgress.value = preservedValue;
        } else {
          syncAudioDockVisuals();
        }

        return result;
      };

      window.__mgAudioDockSeekingRepairWrappedUpdate = true;
    }

    syncAudioDockVisuals();
    return true;
  }

  function tryBind(attempt = 0) {
    if (bindOnce()) {
      return;
    }

    if (attempt > 40) {
      return;
    }

    window.setTimeout(() => {
      tryBind(attempt + 1);
    }, 150);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => tryBind());
  } else {
    tryBind();
  }
})();
/* ==========================================================
   AUDIO DOCK — HARD SEEK / DRAG RESET

   Fixes:
   1. Back 10 seconds works.
   2. Forward 10 seconds works.
   3. Progress bar can be dragged / clicked.
   4. Old audio-dock listeners are bypassed.
   5. Subtitles update immediately after seeking.

   Paste at the VERY BOTTOM of script.js.
   ========================================================== */

(function hardResetAudioDockSeeking() {
  if (window.__mgAudioDockHardSeekResetReady) {
    return;
  }

  window.__mgAudioDockHardSeekResetReady = true;

  const SEEK_STEP_SECONDS = 10;
  const PROGRESS_MAX = 1000;

  const state = {
    isScrubbing: false,
    lastDuration: 0,
    lastManualSeek: 0,
    visualTimer: null
  };

  function getAudioElement() {
    if (typeof audio !== "undefined" && audio) {
      return audio;
    }

    return document.getElementById("story-audio");
  }

  function getDockParts() {
    return {
      audioElement: getAudioElement(),
      dock: document.getElementById("audio-dock"),
      backButton: document.getElementById("audio-back-10"),
      playPauseButton: document.getElementById("audio-play-pause"),
      forwardButton: document.getElementById("audio-forward-10"),
      progressInput: document.getElementById("audio-progress"),
      timeLabel: document.getElementById("audio-time")
    };
  }

  function hasAudioSource(audioElement) {
    if (!audioElement) {
      return false;
    }

    return Boolean(
      audioElement.currentSrc ||
      audioElement.src ||
      audioElement.getAttribute("src")
    );
  }

  function getDuration(audioElement) {
    if (!audioElement) {
      return 0;
    }

    if (Number.isFinite(audioElement.duration) && audioElement.duration > 0) {
      state.lastDuration = audioElement.duration;
      return audioElement.duration;
    }

    try {
      if (audioElement.seekable && audioElement.seekable.length) {
        const seekableEnd = audioElement.seekable.end(audioElement.seekable.length - 1);

        if (Number.isFinite(seekableEnd) && seekableEnd > 0) {
          state.lastDuration = seekableEnd;
          return seekableEnd;
        }
      }
    } catch (error) {}

    return state.lastDuration || 0;
  }

  function getCurrentTime(audioElement) {
    if (!audioElement || !Number.isFinite(audioElement.currentTime)) {
      return 0;
    }

    return Math.max(0, audioElement.currentTime);
  }

  function clampTime(seconds, audioElement) {
    const duration = getDuration(audioElement);
    const safeSeconds = Math.max(0, Number(seconds) || 0);

    if (duration > 0) {
      return Math.min(duration, safeSeconds);
    }

    return safeSeconds;
  }

  function formatDockTime(seconds) {
    const safeSeconds = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(safeSeconds / 60);
    const remainder = Math.floor(safeSeconds % 60);

    return `${minutes}:${String(remainder).padStart(2, "0")}`;
  }

  function syncSubtitlesAfterSeek() {
    if (typeof updateMapSubtitleText === "function") {
      try {
        updateMapSubtitleText();
      } catch (error) {}
    }
  }

  function seekTo(seconds) {
    const { audioElement } = getDockParts();

    if (!hasAudioSource(audioElement)) {
      return;
    }

    const target = clampTime(seconds, audioElement);
    state.lastManualSeek = target;

    try {
      if (typeof audioElement.fastSeek === "function") {
        audioElement.fastSeek(target);
      } else {
        audioElement.currentTime = target;
      }
    } catch (error) {
      try {
        audioElement.currentTime = target;
      } catch (secondError) {}
    }

    /*
      Some remote audio URLs resist seeking until metadata/canplay.
      Retry quietly after the browser catches up.
    */
    window.setTimeout(() => {
      try {
        if (
          hasAudioSource(audioElement) &&
          Math.abs(getCurrentTime(audioElement) - target) > 1.1
        ) {
          audioElement.currentTime = target;
        }
      } catch (error) {}

      syncSubtitlesAfterSeek();
      updateAudioDockVisuals();
    }, 90);

    window.setTimeout(() => {
      syncSubtitlesAfterSeek();
      updateAudioDockVisuals();
    }, 260);

    syncSubtitlesAfterSeek();
    updateAudioDockVisuals();
  }

  function seekBy(deltaSeconds) {
    const { audioElement } = getDockParts();

    if (!hasAudioSource(audioElement)) {
      return;
    }

    const current = getCurrentTime(audioElement);
    seekTo(current + deltaSeconds);
  }

  function progressValueToSeconds() {
    const { audioElement, progressInput } = getDockParts();

    if (!audioElement || !progressInput) {
      return 0;
    }

    const duration = getDuration(audioElement);
    const rawValue = Number(progressInput.value || 0);
    const percentage = Math.max(0, Math.min(PROGRESS_MAX, rawValue)) / PROGRESS_MAX;

    if (duration > 0) {
      return duration * percentage;
    }

    return 0;
  }

  function seekFromProgressInput() {
    const { audioElement } = getDockParts();

    if (!hasAudioSource(audioElement)) {
      return;
    }

    seekTo(progressValueToSeconds());
  }

  function iconBackTen() {
    return `
      <span class="audio-dock-rotate-icon" aria-hidden="true">↶</span>
      <span class="audio-dock-ten" aria-hidden="true">10</span>
    `;
  }

  function iconForwardTen() {
    return `
      <span class="audio-dock-ten" aria-hidden="true">10</span>
      <span class="audio-dock-rotate-icon" aria-hidden="true">↷</span>
    `;
  }

  function iconPlay() {
    return `
      <svg class="audio-dock-svg-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 5.8v12.4L18.2 12z"></path>
      </svg>
    `;
  }

  function iconPause() {
    return `
      <svg class="audio-dock-svg-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7.2 5.4h3.2v13.2H7.2z"></path>
        <path d="M13.6 5.4h3.2v13.2h-3.2z"></path>
      </svg>
    `;
  }

  function decorateButtons() {
    const {
      audioElement,
      backButton,
      playPauseButton,
      forwardButton
    } = getDockParts();

    if (!backButton || !playPauseButton || !forwardButton) {
      return;
    }

    backButton.innerHTML = iconBackTen();
    forwardButton.innerHTML = iconForwardTen();
    playPauseButton.innerHTML =
      audioElement && !audioElement.paused
        ? iconPause()
        : iconPlay();

    backButton.setAttribute("aria-label", "Go back 10 seconds");
    forwardButton.setAttribute("aria-label", "Go forward 10 seconds");
    playPauseButton.setAttribute(
      "aria-label",
      audioElement && !audioElement.paused ? "Pause audio" : "Play audio"
    );

    backButton.setAttribute("title", "Back 10 seconds");
    forwardButton.setAttribute("title", "Forward 10 seconds");
    playPauseButton.setAttribute(
      "title",
      audioElement && !audioElement.paused ? "Pause" : "Play"
    );
  }

  function updateAudioDockVisuals() {
    const {
      audioElement,
      dock,
      backButton,
      playPauseButton,
      forwardButton,
      progressInput,
      timeLabel
    } = getDockParts();

    if (!audioElement || !progressInput) {
      return;
    }

    const hasSource = hasAudioSource(audioElement);
    const duration = getDuration(audioElement);
    const current = getCurrentTime(audioElement);

    progressInput.min = "0";
    progressInput.max = String(PROGRESS_MAX);
    progressInput.step = "1";

    if (!state.isScrubbing) {
      const progressValue =
        duration > 0
          ? Math.max(0, Math.min(PROGRESS_MAX, (current / duration) * PROGRESS_MAX))
          : 0;

      progressInput.value = String(progressValue);
    }

    if (timeLabel) {
      timeLabel.textContent =
        `${formatDockTime(current)} / ${duration ? formatDockTime(duration) : "0:00"}`;
    }

    [backButton, playPauseButton, forwardButton, progressInput].forEach(control => {
      if (!control) {
        return;
      }

      control.disabled = !hasSource;
      control.setAttribute("aria-disabled", hasSource ? "false" : "true");
    });

    if (dock) {
      const active =
        hasSource &&
        (
          !audioElement.paused ||
          current > 0.05 ||
          state.isScrubbing
        );

      dock.classList.toggle("audio-dock-active", active);
      dock.classList.toggle("audio-dock-playing", hasSource && !audioElement.paused);
      dock.classList.toggle("audio-dock-paused-active", active && audioElement.paused);
      dock.classList.toggle("audio-dock-seeking", state.isScrubbing);
      dock.classList.toggle("audio-dock-has-source", hasSource);
    }

    decorateButtons();
  }

  function playOrPauseAudio() {
    const { audioElement } = getDockParts();

    if (!hasAudioSource(audioElement)) {
      return;
    }

    if (audioElement.paused) {
      audioElement.play().catch(() => {});
    } else {
      audioElement.pause();
    }

    updateAudioDockVisuals();
  }

  function handleCapturedClick(event) {
    const backButton = event.target.closest("#audio-back-10");
    const playPauseButton = event.target.closest("#audio-play-pause");
    const forwardButton = event.target.closest("#audio-forward-10");

    if (!backButton && !playPauseButton && !forwardButton) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    if (backButton) {
      seekBy(-SEEK_STEP_SECONDS);
      return;
    }

    if (forwardButton) {
      seekBy(SEEK_STEP_SECONDS);
      return;
    }

    if (playPauseButton) {
      playOrPauseAudio();
    }
  }

  function handleCapturedPointerDown(event) {
    const progressInput = event.target.closest("#audio-progress");
    const audioDockControl = event.target.closest(
      "#audio-dock button, #audio-dock input"
    );

    if (!progressInput && !audioDockControl) {
      return;
    }

    event.stopPropagation();

    if (progressInput) {
      state.isScrubbing = true;
      updateAudioDockVisuals();
    }
  }

  function handleCapturedInput(event) {
    const progressInput = event.target.closest("#audio-progress");

    if (!progressInput) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    state.isScrubbing = true;
    seekFromProgressInput();
  }

  function finishScrubbing() {
    if (!state.isScrubbing) {
      return;
    }

    seekFromProgressInput();
    state.isScrubbing = false;
    updateAudioDockVisuals();
  }

  function installGlobalCaptureHandlers() {
    if (window.__mgAudioDockHardSeekGlobalHandlersBound) {
      return;
    }

    window.__mgAudioDockHardSeekGlobalHandlersBound = true;

    document.addEventListener("click", handleCapturedClick, true);
    document.addEventListener("pointerdown", handleCapturedPointerDown, true);
    document.addEventListener("mousedown", handleCapturedPointerDown, true);
    document.addEventListener("touchstart", handleCapturedPointerDown, {
      capture: true,
      passive: true
    });

    document.addEventListener("input", handleCapturedInput, true);
    document.addEventListener("change", handleCapturedInput, true);

    window.addEventListener("pointerup", finishScrubbing, true);
    window.addEventListener("mouseup", finishScrubbing, true);
    window.addEventListener("touchend", finishScrubbing, true);
  }

  function installAudioEventHandlers() {
    const { audioElement } = getDockParts();

    if (!audioElement || audioElement.dataset.hardSeekRepairBound === "yes") {
      return;
    }

    audioElement.dataset.hardSeekRepairBound = "yes";
    audioElement.preload = "auto";

    [
      "loadedmetadata",
      "durationchange",
      "canplay",
      "canplaythrough",
      "timeupdate",
      "play",
      "playing",
      "pause",
      "seeking",
      "seeked",
      "ended",
      "emptied"
    ].forEach(eventName => {
      audioElement.addEventListener(eventName, () => {
        if (eventName === "seeked") {
          syncSubtitlesAfterSeek();
        }

        updateAudioDockVisuals();
      });
    });
  }

  function replaceAudioDockUpdater() {
    /*
      Important:
      Existing audio listeners call the old refreshAudioDock function.
      That old function calls the current audioDockUpdate variable.
      So replacing audioDockUpdate here lets old listeners help us instead of fighting us.
    */
    try {
      audioDockUpdate = updateAudioDockVisuals;
    } catch (error) {}

    try {
      refreshAudioDock = updateAudioDockVisuals;
    } catch (error) {}
  }

  function startVisualLoop() {
    if (state.visualTimer) {
      return;
    }

    const tick = () => {
      const { audioElement } = getDockParts();

      if (audioElement && !audioElement.paused) {
        updateAudioDockVisuals();
      }

      state.visualTimer = window.setTimeout(tick, 250);
    };

    tick();
  }

  function install(attempt = 0) {
    const {
      audioElement,
      dock,
      backButton,
      playPauseButton,
      forwardButton,
      progressInput,
      timeLabel
    } = getDockParts();

    if (
      !audioElement ||
      !dock ||
      !backButton ||
      !playPauseButton ||
      !forwardButton ||
      !progressInput ||
      !timeLabel
    ) {
      if (attempt < 60) {
        window.setTimeout(() => install(attempt + 1), 150);
      }

      return;
    }

    installGlobalCaptureHandlers();
    installAudioEventHandlers();
    replaceAudioDockUpdater();
    updateAudioDockVisuals();
    startVisualLoop();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => install());
  } else {
    install();
  }

  /*
    Also reinstall after story audio functions run,
    because later patches may reset src or dock state.
  */
  if (typeof prepareStoryAudio === "function" && !window.__mgHardSeekPrepareWrapped) {
    const originalPrepareStoryAudio = prepareStoryAudio;

    prepareStoryAudio = function hardSeekPrepareStoryAudio(story) {
      const result = originalPrepareStoryAudio.apply(this, arguments);

      window.setTimeout(() => {
        install();
        updateAudioDockVisuals();
      }, 80);

      return result;
    };

    window.__mgHardSeekPrepareWrapped = true;
  }

  if (typeof playStoryAudio === "function" && !window.__mgHardSeekPlayWrapped) {
    const originalPlayStoryAudio = playStoryAudio;

    playStoryAudio = function hardSeekPlayStoryAudio(story) {
      const result = originalPlayStoryAudio.apply(this, arguments);

      window.setTimeout(() => {
        install();
        updateAudioDockVisuals();
      }, 80);

      window.setTimeout(() => {
        updateAudioDockVisuals();
      }, 500);

      return result;
    };

    window.__mgHardSeekPlayWrapped = true;
  }
})();
/* ==========================================================
   AUDIO DOCK V2 — ISOLATED PLAYER CONTROLS

   Why this exists:
   The original #audio-dock has too many layered patches and
   old listeners fighting each other. This creates a clean,
   separate player that uses the same hidden audio element but
   does not depend on the old dock buttons.

   Fixes:
   - visible back / pause-play / forward icons
   - reliable 10-second back and forward seeking
   - reliable progress-bar dragging / clicking
   - subtitle update after seeking
   - no conflict with old icon patches

   Paste at the VERY BOTTOM of script.js.
   ========================================================== */

(function installMissingGeographiesAudioDockV2() {
  if (window.__mgAudioDockV2Ready) {
    return;
  }

  window.__mgAudioDockV2Ready = true;

  const SEEK_STEP_SECONDS = 10;
  const RANGE_MAX = 1000;

  const state = {
    scrubbing: false,
    lastDuration: 0,
    visualTimer: null
  };

  function getAudioElement() {
    if (typeof audio !== "undefined" && audio) {
      return audio;
    }

    return document.getElementById("story-audio");
  }

  function hasAudioSource(audioElement) {
    if (!audioElement) {
      return false;
    }

    return Boolean(
      audioElement.currentSrc ||
      audioElement.src ||
      audioElement.getAttribute("src")
    );
  }

  function getDuration(audioElement) {
    if (!audioElement) {
      return 0;
    }

    if (Number.isFinite(audioElement.duration) && audioElement.duration > 0) {
      state.lastDuration = audioElement.duration;
      return audioElement.duration;
    }

    try {
      if (audioElement.seekable && audioElement.seekable.length) {
        const end = audioElement.seekable.end(audioElement.seekable.length - 1);

        if (Number.isFinite(end) && end > 0) {
          state.lastDuration = end;
          return end;
        }
      }
    } catch (error) {}

    return state.lastDuration || 0;
  }

  function getCurrentTime(audioElement) {
    if (!audioElement || !Number.isFinite(audioElement.currentTime)) {
      return 0;
    }

    return Math.max(0, audioElement.currentTime);
  }

  function clampTime(value, audioElement) {
    const duration = getDuration(audioElement);
    const safeValue = Math.max(0, Number(value) || 0);

    if (duration > 0) {
      return Math.min(duration, safeValue);
    }

    return safeValue;
  }

  function formatTime(seconds) {
    const safeSeconds = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(safeSeconds / 60);
    const remainder = Math.floor(safeSeconds % 60);

    return `${minutes}:${String(remainder).padStart(2, "0")}`;
  }

  function updateSubtitlesAfterSeek() {
    if (typeof updateMapSubtitleText === "function") {
      try {
        updateMapSubtitleText();
      } catch (error) {}
    }
  }

  function iconBack() {
    return `
      <svg class="mg-audio-dock-v2-icon mg-audio-dock-v2-icon-back" viewBox="0 0 64 40" aria-hidden="true" focusable="false">
        <path d="M30 8 L30 32 L13 20 Z"></path>
        <path d="M48 8 L48 32 L31 20 Z"></path>
      </svg>
    `;
  }

  function iconForward() {
    return `
      <svg class="mg-audio-dock-v2-icon mg-audio-dock-v2-icon-forward" viewBox="0 0 64 40" aria-hidden="true" focusable="false">
        <path d="M16 8 L16 32 L33 20 Z"></path>
        <path d="M34 8 L34 32 L51 20 Z"></path>
      </svg>
    `;
  }

  function iconPlay() {
    return `
      <svg class="mg-audio-dock-v2-icon mg-audio-dock-v2-icon-play" viewBox="0 0 64 40" aria-hidden="true" focusable="false">
        <path d="M24 7 L24 33 L45 20 Z"></path>
      </svg>
    `;
  }

  function iconPause() {
    return `
      <svg class="mg-audio-dock-v2-icon mg-audio-dock-v2-icon-pause" viewBox="0 0 64 40" aria-hidden="true" focusable="false">
        <path d="M23 8 H29 V32 H23 Z"></path>
        <path d="M35 8 H41 V32 H35 Z"></path>
      </svg>
    `;
  }

  function ensureDock() {
    let dock = document.getElementById("mg-audio-dock-v2");

    if (dock) {
      return dock;
    }

    dock = document.createElement("div");
    dock.id = "mg-audio-dock-v2";
    dock.className = "mg-audio-dock-v2";
    dock.setAttribute("aria-label", "Audio controls");

    dock.innerHTML = `
      <button
        class="mg-audio-dock-v2-button mg-audio-dock-v2-back"
        type="button"
        aria-label="Go back 10 seconds"
        title="Back 10 seconds"
      >
        ${iconBack()}
      </button>

      <button
        class="mg-audio-dock-v2-button mg-audio-dock-v2-play"
        type="button"
        aria-label="Play audio"
        title="Play"
      >
        ${iconPlay()}
      </button>

      <button
        class="mg-audio-dock-v2-button mg-audio-dock-v2-forward"
        type="button"
        aria-label="Go forward 10 seconds"
        title="Forward 10 seconds"
      >
        ${iconForward()}
      </button>

      <input
        class="mg-audio-dock-v2-progress"
        type="range"
        min="0"
        max="${RANGE_MAX}"
        step="1"
        value="0"
        aria-label="Audio progress"
      />

      <span class="mg-audio-dock-v2-time">0:00 / 0:00</span>
    `;

    document.body.appendChild(dock);
    return dock;
  }

  function getParts() {
    const dock = ensureDock();

    return {
      audioElement: getAudioElement(),
      dock,
      backButton: dock.querySelector(".mg-audio-dock-v2-back"),
      playButton: dock.querySelector(".mg-audio-dock-v2-play"),
      forwardButton: dock.querySelector(".mg-audio-dock-v2-forward"),
      progressInput: dock.querySelector(".mg-audio-dock-v2-progress"),
      timeLabel: dock.querySelector(".mg-audio-dock-v2-time")
    };
  }

  function setProgressVisual(progressInput, percent) {
    if (!progressInput) {
      return;
    }

    const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
    progressInput.style.setProperty("--mg-audio-progress-percent", `${safePercent}%`);
  }

  function updateDock() {
    const {
      audioElement,
      dock,
      backButton,
      playButton,
      forwardButton,
      progressInput,
      timeLabel
    } = getParts();

    if (!dock || !audioElement || !progressInput) {
      return;
    }

    const sourceReady = hasAudioSource(audioElement);
    const duration = getDuration(audioElement);
    const current = getCurrentTime(audioElement);
    const isPlaying = sourceReady && !audioElement.paused;

    const percent =
      duration > 0
        ? Math.max(0, Math.min(100, (current / duration) * 100))
        : 0;

    if (!state.scrubbing) {
      progressInput.value = String(
        duration > 0
          ? Math.max(0, Math.min(RANGE_MAX, (current / duration) * RANGE_MAX))
          : 0
      );
    }

    setProgressVisual(progressInput, percent);

    if (timeLabel) {
      timeLabel.textContent = `${formatTime(current)} / ${duration ? formatTime(duration) : "0:00"}`;
    }

    if (playButton) {
      playButton.innerHTML = isPlaying ? iconPause() : iconPlay();
      playButton.setAttribute("aria-label", isPlaying ? "Pause audio" : "Play audio");
      playButton.setAttribute("title", isPlaying ? "Pause" : "Play");
    }

    if (backButton) {
      backButton.innerHTML = iconBack();
    }

    if (forwardButton) {
      forwardButton.innerHTML = iconForward();
    }

    [backButton, playButton, forwardButton, progressInput].forEach(control => {
      if (!control) {
        return;
      }

      control.disabled = !sourceReady;
      control.setAttribute("aria-disabled", sourceReady ? "false" : "true");
    });

    dock.classList.toggle("is-ready", sourceReady);
    dock.classList.toggle("is-playing", isPlaying);
    dock.classList.toggle(
      "is-active",
      sourceReady && (isPlaying || current > 0.05 || state.scrubbing)
    );
    dock.classList.toggle("is-scrubbing", state.scrubbing);
  }

  function seekTo(seconds) {
    const { audioElement } = getParts();

    if (!hasAudioSource(audioElement)) {
      return;
    }

    const target = clampTime(seconds, audioElement);

    try {
      audioElement.currentTime = target;
    } catch (error) {
      window.setTimeout(() => {
        try {
          audioElement.currentTime = clampTime(target, audioElement);
        } catch (secondError) {}
      }, 120);
    }

    updateSubtitlesAfterSeek();
    updateDock();

    window.setTimeout(() => {
      updateSubtitlesAfterSeek();
      updateDock();
    }, 140);
  }

  function seekBy(deltaSeconds) {
    const { audioElement } = getParts();

    if (!hasAudioSource(audioElement)) {
      return;
    }

    seekTo(getCurrentTime(audioElement) + deltaSeconds);
  }

  function seekFromProgress() {
    const { audioElement, progressInput } = getParts();

    if (!hasAudioSource(audioElement) || !progressInput) {
      return;
    }

    const duration = getDuration(audioElement);

    if (!duration) {
      return;
    }

    const rawValue = Number(progressInput.value || 0);
    const ratio = Math.max(0, Math.min(RANGE_MAX, rawValue)) / RANGE_MAX;

    seekTo(duration * ratio);
  }

  function togglePlayback() {
    const { audioElement } = getParts();

    if (!hasAudioSource(audioElement)) {
      return;
    }

    if (audioElement.paused) {
      audioElement.play().catch(() => {});
    } else {
      audioElement.pause();
    }

    updateDock();
  }

  function bindDock() {
    const {
      audioElement,
      dock,
      backButton,
      playButton,
      forwardButton,
      progressInput
    } = getParts();

    if (!dock || !backButton || !playButton || !forwardButton || !progressInput) {
      return false;
    }

    if (dock.dataset.bound === "yes") {
      return true;
    }

    dock.dataset.bound = "yes";

    /*
      Prevent the globe drag handlers from stealing audio-dock gestures.
    */
    ["pointerdown", "mousedown", "touchstart", "click", "wheel"].forEach(eventName => {
      dock.addEventListener(
        eventName,
        event => {
          event.stopPropagation();
        },
        { capture: true, passive: eventName === "touchstart" }
      );
    });

    backButton.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      seekBy(-SEEK_STEP_SECONDS);
    });

    forwardButton.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      seekBy(SEEK_STEP_SECONDS);
    });

    playButton.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      togglePlayback();
    });

    progressInput.addEventListener("pointerdown", event => {
      state.scrubbing = true;
      event.stopPropagation();
      updateDock();
    });

    progressInput.addEventListener("mousedown", event => {
      state.scrubbing = true;
      event.stopPropagation();
      updateDock();
    });

    progressInput.addEventListener(
      "touchstart",
      event => {
        state.scrubbing = true;
        event.stopPropagation();
        updateDock();
      },
      { passive: true }
    );

    progressInput.addEventListener("input", event => {
      event.stopPropagation();
      state.scrubbing = true;
      seekFromProgress();
    });

    progressInput.addEventListener("change", event => {
      event.stopPropagation();
      seekFromProgress();
      state.scrubbing = false;
      updateDock();
    });

    ["pointerup", "mouseup", "touchend", "blur"].forEach(eventName => {
      window.addEventListener(
        eventName,
        () => {
          if (!state.scrubbing) {
            return;
          }

          seekFromProgress();
          state.scrubbing = false;
          updateDock();
        },
        true
      );
    });

    if (audioElement && audioElement.dataset.mgAudioDockV2Bound !== "yes") {
      audioElement.dataset.mgAudioDockV2Bound = "yes";
      audioElement.preload = "auto";

      [
        "loadedmetadata",
        "durationchange",
        "canplay",
        "canplaythrough",
        "timeupdate",
        "play",
        "playing",
        "pause",
        "seeking",
        "seeked",
        "ended",
        "emptied"
      ].forEach(eventName => {
        audioElement.addEventListener(eventName, () => {
          if (eventName === "seeked") {
            updateSubtitlesAfterSeek();
          }

          updateDock();
        });
      });
    }

    updateDock();
    return true;
  }

  function startVisualTimer() {
    if (state.visualTimer) {
      return;
    }

    state.visualTimer = window.setInterval(() => {
      const { audioElement } = getParts();

      if (audioElement && (!audioElement.paused || state.scrubbing)) {
        updateDock();
      }
    }, 180);
  }

  function install(attempt = 0) {
    ensureDock();

    if (bindDock()) {
      updateDock();
      startVisualTimer();
      return;
    }

    if (attempt < 60) {
      window.setTimeout(() => install(attempt + 1), 150);
    }
  }

  /*
    Keep this dock synced when existing story-audio functions run.
  */
  if (typeof prepareStoryAudio === "function" && !window.__mgAudioDockV2PrepareWrapped) {
    const originalPrepareStoryAudio = prepareStoryAudio;

    prepareStoryAudio = function audioDockV2PrepareStoryAudio() {
      const result = originalPrepareStoryAudio.apply(this, arguments);

      window.setTimeout(() => {
        install();
        updateDock();
      }, 80);

      return result;
    };

    window.__mgAudioDockV2PrepareWrapped = true;
  }

  if (typeof playStoryAudio === "function" && !window.__mgAudioDockV2PlayWrapped) {
    const originalPlayStoryAudio = playStoryAudio;

    playStoryAudio = function audioDockV2PlayStoryAudio() {
      const result = originalPlayStoryAudio.apply(this, arguments);

      window.setTimeout(() => {
        install();
        updateDock();
      }, 80);

      window.setTimeout(() => {
        updateDock();
      }, 500);

      return result;
    };

    window.__mgAudioDockV2PlayWrapped = true;
  }

  if (typeof stopAudio === "function" && !window.__mgAudioDockV2StopWrapped) {
    const originalStopAudio = stopAudio;

    stopAudio = function audioDockV2StopAudio() {
      const result = originalStopAudio.apply(this, arguments);

      window.setTimeout(() => {
        updateDock();
      }, 80);

      return result;
    };

    window.__mgAudioDockV2StopWrapped = true;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => install());
  } else {
    install();
  }
})();
/* ==========================================================
   LANTERN CURSOR — AUDIO DOCK V2 HOVER/LAYER REPAIR

   Fixes:
   - Lantern cursor now recognizes the new #mg-audio-dock-v2 player.
   - The cursor stays visible while moving over the audio dock.
   - Does not block clicking, dragging, or seeking.

   Paste at the VERY BOTTOM of script.js.
   ========================================================== */

(function repairLanternCursorOverAudioDockV2() {
  if (window.__mgLanternAudioDockV2RepairReady) {
    return;
  }

  window.__mgLanternAudioDockV2RepairReady = true;

  function isAudioDockV2Target(target) {
    return Boolean(
      target &&
      typeof target.closest === "function" &&
      target.closest("#mg-audio-dock-v2, .mg-audio-dock-v2")
    );
  }

  function updateLanternPosition(event) {
    if (event.pointerType && event.pointerType !== "mouse") {
      return;
    }

    const root = document.documentElement;

    root.style.setProperty("--lantern-x", `${event.clientX}px`);
    root.style.setProperty("--lantern-y", `${event.clientY}px`);
    root.classList.remove("lantern-cursor-hidden");

    if (isAudioDockV2Target(event.target)) {
      root.classList.add("lantern-cursor-hovering");
      root.classList.add("lantern-cursor-over-audio-dock");
    }
  }

  function clearAudioDockHover(event) {
    const relatedTarget = event.relatedTarget;

    if (isAudioDockV2Target(relatedTarget)) {
      return;
    }

    const root = document.documentElement;

    root.classList.remove("lantern-cursor-over-audio-dock");

    /*
      Do not aggressively remove lantern-cursor-hovering globally,
      because the older lantern system may be using it for another
      interactive element under the pointer.
    */
    window.setTimeout(() => {
      const hoveredDock = document.querySelector("#mg-audio-dock-v2:hover");

      if (!hoveredDock) {
        root.classList.remove("lantern-cursor-over-audio-dock");
      }
    }, 40);
  }

  window.addEventListener(
    "pointermove",
    event => {
      if (!isAudioDockV2Target(event.target)) {
        return;
      }

      updateLanternPosition(event);
    },
    true
  );

  window.addEventListener(
    "pointerdown",
    event => {
      if (!isAudioDockV2Target(event.target)) {
        return;
      }

      updateLanternPosition(event);
      document.documentElement.classList.add("lantern-cursor-clicking");
    },
    true
  );

  window.addEventListener(
    "pointerup",
    () => {
      document.documentElement.classList.remove("lantern-cursor-clicking");
    },
    true
  );

  function bindDockLeave(attempt = 0) {
    const dock = document.getElementById("mg-audio-dock-v2");

    if (!dock) {
      if (attempt < 60) {
        window.setTimeout(() => bindDockLeave(attempt + 1), 150);
      }

      return;
    }

    if (dock.dataset.lanternRepairBound === "yes") {
      return;
    }

    dock.dataset.lanternRepairBound = "yes";
    dock.addEventListener("pointerleave", clearAudioDockHover);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => bindDockLeave());
  } else {
    bindDockLeave();
  }
})();
/* ==========================================================
   AUDIO DOCK V2 — DIRECT CONTROL OVERRIDE

   Fixes:
   - New audio dock is visible but buttons do not click.
   - Progress thumb cannot be dragged.
   - Works even if older capture listeners stop events before
     the controls receive them.

   Paste at the VERY BOTTOM of script.js.
   ========================================================== */

(function installAudioDockV2DirectControlOverride() {
  if (window.__mgAudioDockV2DirectControlOverrideReady) {
    return;
  }

  window.__mgAudioDockV2DirectControlOverrideReady = true;

  const SEEK_STEP_SECONDS = 10;
  const RANGE_MAX = 1000;

  const state = {
    dragging: false,
    lastDuration: 0,
    lastPointerActionAt: 0,
    timer: null
  };

  function getAudioElement() {
    if (typeof audio !== "undefined" && audio) {
      return audio;
    }

    return document.getElementById("story-audio");
  }

  function getDock() {
    return document.getElementById("mg-audio-dock-v2");
  }

  function getParts() {
    const dock = getDock();

    return {
      audioElement: getAudioElement(),
      dock,
      backButton: dock ? dock.querySelector(".mg-audio-dock-v2-back") : null,
      playButton: dock ? dock.querySelector(".mg-audio-dock-v2-play") : null,
      forwardButton: dock ? dock.querySelector(".mg-audio-dock-v2-forward") : null,
      progressInput: dock ? dock.querySelector(".mg-audio-dock-v2-progress") : null,
      timeLabel: dock ? dock.querySelector(".mg-audio-dock-v2-time") : null
    };
  }

  function hasAudioSource(audioElement) {
    return Boolean(
      audioElement &&
      (
        audioElement.currentSrc ||
        audioElement.src ||
        audioElement.getAttribute("src")
      )
    );
  }

  function getDuration(audioElement) {
    if (!audioElement) {
      return 0;
    }

    if (Number.isFinite(audioElement.duration) && audioElement.duration > 0) {
      state.lastDuration = audioElement.duration;
      return audioElement.duration;
    }

    try {
      if (audioElement.seekable && audioElement.seekable.length) {
        const seekableEnd = audioElement.seekable.end(audioElement.seekable.length - 1);

        if (Number.isFinite(seekableEnd) && seekableEnd > 0) {
          state.lastDuration = seekableEnd;
          return seekableEnd;
        }
      }
    } catch (error) {}

    return state.lastDuration || 0;
  }

  function getCurrentTime(audioElement) {
    if (!audioElement || !Number.isFinite(audioElement.currentTime)) {
      return 0;
    }

    return Math.max(0, audioElement.currentTime);
  }

  function clampTime(seconds, audioElement) {
    const duration = getDuration(audioElement);
    const safeSeconds = Math.max(0, Number(seconds) || 0);

    if (duration > 0) {
      return Math.min(duration, safeSeconds);
    }

    return safeSeconds;
  }

  function formatTime(seconds) {
    const safeSeconds = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(safeSeconds / 60);
    const remainder = Math.floor(safeSeconds % 60);

    return `${minutes}:${String(remainder).padStart(2, "0")}`;
  }

  function updateSubtitlesAfterSeek() {
    if (typeof updateMapSubtitleText === "function") {
      try {
        updateMapSubtitleText();
      } catch (error) {}
    }
  }

  function setProgressVisual(progressInput, percent) {
    if (!progressInput) {
      return;
    }

    const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
    progressInput.style.setProperty("--mg-audio-progress-percent", `${safePercent}%`);
  }

  function updateDockVisuals() {
    const {
      audioElement,
      dock,
      backButton,
      playButton,
      forwardButton,
      progressInput,
      timeLabel
    } = getParts();

    if (!dock || !audioElement || !progressInput) {
      return;
    }

    const ready = hasAudioSource(audioElement);
    const duration = getDuration(audioElement);
    const current = getCurrentTime(audioElement);
    const playing = ready && !audioElement.paused;

    const ratio = duration > 0
      ? Math.max(0, Math.min(1, current / duration))
      : 0;

    if (!state.dragging) {
      progressInput.value = String(Math.round(ratio * RANGE_MAX));
    }

    setProgressVisual(progressInput, ratio * 100);

    if (timeLabel) {
      timeLabel.textContent = `${formatTime(current)} / ${duration ? formatTime(duration) : "0:00"}`;
    }

    [backButton, playButton, forwardButton, progressInput].forEach(control => {
      if (!control) {
        return;
      }

      control.disabled = !ready;
      control.setAttribute("aria-disabled", ready ? "false" : "true");
    });

    dock.classList.toggle("is-ready", ready);
    dock.classList.toggle("is-playing", playing);
    dock.classList.toggle("is-active", ready && (playing || current > 0.05 || state.dragging));
    dock.classList.toggle("is-scrubbing", state.dragging);
  }

  function seekTo(seconds) {
    const { audioElement } = getParts();

    if (!hasAudioSource(audioElement)) {
      return;
    }

    const target = clampTime(seconds, audioElement);

    try {
      audioElement.currentTime = target;
    } catch (error) {
      window.setTimeout(() => {
        try {
          audioElement.currentTime = clampTime(target, audioElement);
        } catch (secondError) {}
      }, 120);
    }

    updateSubtitlesAfterSeek();
    updateDockVisuals();

    window.setTimeout(() => {
      updateSubtitlesAfterSeek();
      updateDockVisuals();
    }, 140);
  }

  function seekBy(deltaSeconds) {
    const { audioElement } = getParts();

    if (!hasAudioSource(audioElement)) {
      return;
    }

    seekTo(getCurrentTime(audioElement) + deltaSeconds);
  }

  function togglePlayback() {
    const { audioElement } = getParts();

    if (!hasAudioSource(audioElement)) {
      return;
    }

    if (audioElement.paused) {
      audioElement.play().catch(() => {});
    } else {
      audioElement.pause();
    }

    updateDockVisuals();
  }

  function rectContains(rect, x, y) {
    return (
      rect &&
      x >= rect.left &&
      x <= rect.right &&
      y >= rect.top &&
      y <= rect.bottom
    );
  }

  function getPartFromPoint(x, y) {
    const {
      dock,
      backButton,
      playButton,
      forwardButton,
      progressInput
    } = getParts();

    if (!dock) {
      return null;
    }

    const dockRect = dock.getBoundingClientRect();

    if (!rectContains(dockRect, x, y)) {
      return null;
    }

    const controls = [
      ["back", backButton],
      ["play", playButton],
      ["forward", forwardButton],
      ["progress", progressInput]
    ];

    for (const [name, element] of controls) {
      if (!element) {
        continue;
      }

      if (rectContains(element.getBoundingClientRect(), x, y)) {
        return name;
      }
    }

    return "dock";
  }

  function seekFromClientX(clientX) {
    const { audioElement, progressInput } = getParts();

    if (!hasAudioSource(audioElement) || !progressInput) {
      return;
    }

    const duration = getDuration(audioElement);

    if (!duration) {
      return;
    }

    const rect = progressInput.getBoundingClientRect();

    if (!rect || rect.width <= 0) {
      return;
    }

    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const target = duration * ratio;

    progressInput.value = String(Math.round(ratio * RANGE_MAX));
    setProgressVisual(progressInput, ratio * 100);

    seekTo(target);
  }

  function blockEvent(event) {
    event.preventDefault();
    event.stopPropagation();

    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
  }

  function handlePointerDown(event) {
    if (event.pointerType && event.pointerType !== "mouse" && event.pointerType !== "pen") {
      return;
    }

    const part = getPartFromPoint(event.clientX, event.clientY);

    if (!part) {
      return;
    }

    blockEvent(event);
    state.lastPointerActionAt = performance.now();

    if (part === "back") {
      seekBy(-SEEK_STEP_SECONDS);
      return;
    }

    if (part === "forward") {
      seekBy(SEEK_STEP_SECONDS);
      return;
    }

    if (part === "play") {
      togglePlayback();
      return;
    }

    if (part === "progress") {
      state.dragging = true;
      seekFromClientX(event.clientX);
      updateDockVisuals();
      return;
    }

    /*
      If pointer is inside the dock but not on a control,
      block the globe drag from stealing the gesture.
    */
    updateDockVisuals();
  }

  function handleMouseDown(event) {
    /*
      Fallback for any browser path where pointer events are odd.
    */
    if (window.PointerEvent) {
      return;
    }

    const part = getPartFromPoint(event.clientX, event.clientY);

    if (!part) {
      return;
    }

    blockEvent(event);
    state.lastPointerActionAt = performance.now();

    if (part === "back") {
      seekBy(-SEEK_STEP_SECONDS);
    } else if (part === "forward") {
      seekBy(SEEK_STEP_SECONDS);
    } else if (part === "play") {
      togglePlayback();
    } else if (part === "progress") {
      state.dragging = true;
      seekFromClientX(event.clientX);
      updateDockVisuals();
    }
  }

  function handlePointerMove(event) {
    if (!state.dragging) {
      return;
    }

    blockEvent(event);
    seekFromClientX(event.clientX);
  }

  function handleMouseMove(event) {
    if (!state.dragging || window.PointerEvent) {
      return;
    }

    blockEvent(event);
    seekFromClientX(event.clientX);
  }

  function finishDragging(event) {
    if (!state.dragging) {
      return;
    }

    if (event && Number.isFinite(event.clientX)) {
      seekFromClientX(event.clientX);
    }

    state.dragging = false;
    updateDockVisuals();

    if (event) {
      blockEvent(event);
    }
  }

  function handleClick(event) {
    const part = getPartFromPoint(event.clientX, event.clientY);

    if (!part) {
      return;
    }

    /*
      If pointerdown already handled the action, this click should only be blocked.
      If it is a keyboard-triggered click, perform the action here.
    */
    const justHandledPointer = performance.now() - state.lastPointerActionAt < 450;

    blockEvent(event);

    if (justHandledPointer) {
      return;
    }

    if (part === "back") {
      seekBy(-SEEK_STEP_SECONDS);
    } else if (part === "forward") {
      seekBy(SEEK_STEP_SECONDS);
    } else if (part === "play") {
      togglePlayback();
    } else if (part === "progress") {
      seekFromClientX(event.clientX);
    }
  }

  function handleInput(event) {
    const { audioElement, progressInput } = getParts();

    if (!progressInput || event.target !== progressInput) {
      return;
    }

    blockEvent(event);

    if (!hasAudioSource(audioElement)) {
      return;
    }

    const duration = getDuration(audioElement);

    if (!duration) {
      return;
    }

    const ratio = Math.max(0, Math.min(1, Number(progressInput.value || 0) / RANGE_MAX));

    state.dragging = true;
    setProgressVisual(progressInput, ratio * 100);
    seekTo(duration * ratio);
  }

  function handleKeyboard(event) {
    const { dock } = getParts();

    if (!dock || !dock.contains(event.target)) {
      return;
    }

    const part =
      event.target.closest(".mg-audio-dock-v2-back") ? "back" :
      event.target.closest(".mg-audio-dock-v2-forward") ? "forward" :
      event.target.closest(".mg-audio-dock-v2-play") ? "play" :
      event.target.closest(".mg-audio-dock-v2-progress") ? "progress" :
      null;

    if (!part) {
      return;
    }

    if (event.key !== "Enter" && event.key !== " " && event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }

    blockEvent(event);

    if (part === "back" || event.key === "ArrowLeft") {
      seekBy(-SEEK_STEP_SECONDS);
    } else if (part === "forward" || event.key === "ArrowRight") {
      seekBy(SEEK_STEP_SECONDS);
    } else if (part === "play") {
      togglePlayback();
    }
  }

  function bindAudioEvents() {
    const { audioElement } = getParts();

    if (!audioElement || audioElement.dataset.mgAudioDockV2DirectBound === "yes") {
      return;
    }

    audioElement.dataset.mgAudioDockV2DirectBound = "yes";

    [
      "loadedmetadata",
      "durationchange",
      "canplay",
      "canplaythrough",
      "timeupdate",
      "play",
      "playing",
      "pause",
      "seeking",
      "seeked",
      "ended",
      "emptied"
    ].forEach(eventName => {
      audioElement.addEventListener(eventName, () => {
        if (eventName === "seeked") {
          updateSubtitlesAfterSeek();
        }

        updateDockVisuals();
      });
    });
  }

  function install() {
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("pointermove", handlePointerMove, true);
    document.addEventListener("pointerup", finishDragging, true);
    document.addEventListener("pointercancel", finishDragging, true);

    document.addEventListener("mousedown", handleMouseDown, true);
    document.addEventListener("mousemove", handleMouseMove, true);
    document.addEventListener("mouseup", finishDragging, true);

    document.addEventListener("click", handleClick, true);
    document.addEventListener("input", handleInput, true);
    document.addEventListener("change", handleInput, true);
    document.addEventListener("keydown", handleKeyboard, true);

    bindAudioEvents();

    state.timer = window.setInterval(() => {
      bindAudioEvents();
      updateDockVisuals();
    }, 250);

    updateDockVisuals();
  }

  install();
})();
/* ==========================================================
   AUDIO DOCK V2 — FINAL SEEKABLE SOURCE + WINDOW CONTROL

   Fixes:
   - Play/pause works but back/forward do not.
   - Progress bar moves visually but cannot seek.
   - Remote audio source may play but ignore currentTime changes.
   - Older document-level audio patches may intercept events.

   Strategy:
   1. Capture audio-dock actions at window level before older patches.
   2. Try normal currentTime seeking.
   3. If the audio source refuses seeking, fetch it as a Blob and
      replace the audio src with a local object URL, which is seekable.

   Paste at the VERY BOTTOM of script.js.
   ========================================================== */

(function finalSeekableAudioDockV2Repair() {
  if (window.__mgFinalSeekableAudioDockV2Ready) {
    return;
  }

  window.__mgFinalSeekableAudioDockV2Ready = true;

  const SEEK_STEP_SECONDS = 10;
  const RANGE_MAX = 1000;

  const state = {
    dragging: false,
    lastDuration: 0,
    pendingSeek: null,
    blobCache: new Map(),
    blobInflight: new Map(),
    blobFailed: new Set(),
    lastPointerActionAt: 0,
    visualTimer: null
  };

  function getAudioElement() {
    if (typeof audio !== "undefined" && audio) {
      return audio;
    }

    return document.getElementById("story-audio");
  }

  function getDock() {
    return document.getElementById("mg-audio-dock-v2");
  }

  function getParts() {
    const dock = getDock();

    return {
      audioElement: getAudioElement(),
      dock,
      backButton: dock ? dock.querySelector(".mg-audio-dock-v2-back") : null,
      playButton: dock ? dock.querySelector(".mg-audio-dock-v2-play") : null,
      forwardButton: dock ? dock.querySelector(".mg-audio-dock-v2-forward") : null,
      progressInput: dock ? dock.querySelector(".mg-audio-dock-v2-progress") : null,
      timeLabel: dock ? dock.querySelector(".mg-audio-dock-v2-time") : null
    };
  }

  function hasAudioSource(audioElement) {
    return Boolean(
      audioElement &&
      (
        audioElement.currentSrc ||
        audioElement.src ||
        audioElement.getAttribute("src")
      )
    );
  }

  function isBlobUrl(value) {
    return String(value || "").startsWith("blob:");
  }

  function getCurrentSrc(audioElement) {
    if (!audioElement) {
      return "";
    }

    return (
      audioElement.currentSrc ||
      audioElement.getAttribute("src") ||
      audioElement.src ||
      ""
    );
  }

  function getOriginalAudioUrl(audioElement) {
    if (!audioElement) {
      return "";
    }

    const stored = audioElement.dataset.mgOriginalAudioSrc || "";

    if (stored) {
      return stored;
    }

    if (
      typeof activeStory !== "undefined" &&
      activeStory &&
      activeStory.audio
    ) {
      return activeStory.audio;
    }

    const current = getCurrentSrc(audioElement);

    if (!isBlobUrl(current)) {
      return current;
    }

    return "";
  }

  function rememberOriginalAudioUrl(url) {
    const audioElement = getAudioElement();

    if (!audioElement || !url || isBlobUrl(url)) {
      return;
    }

    audioElement.dataset.mgOriginalAudioSrc = url;
  }

  function parseTimeText(value) {
    const text = String(value || "").trim();

    if (!text) {
      return 0;
    }

    const parts = text.split(":").map(part => Number(part));

    if (parts.some(part => !Number.isFinite(part))) {
      return 0;
    }

    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }

    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }

    return 0;
  }

  function durationFromVisibleTimeLabel() {
    const { timeLabel } = getParts();

    if (!timeLabel) {
      return 0;
    }

    const text = String(timeLabel.textContent || "");
    const pieces = text.split("/");

    if (pieces.length < 2) {
      return 0;
    }

    return parseTimeText(pieces[1]);
  }

  function getDuration(audioElement) {
    if (!audioElement) {
      return 0;
    }

    if (Number.isFinite(audioElement.duration) && audioElement.duration > 0) {
      state.lastDuration = audioElement.duration;
      return audioElement.duration;
    }

    try {
      if (audioElement.seekable && audioElement.seekable.length) {
        const seekableEnd = audioElement.seekable.end(audioElement.seekable.length - 1);

        if (Number.isFinite(seekableEnd) && seekableEnd > 0) {
          state.lastDuration = seekableEnd;
          return seekableEnd;
        }
      }
    } catch (error) {}

    const visibleDuration = durationFromVisibleTimeLabel();

    if (visibleDuration > 0) {
      state.lastDuration = visibleDuration;
      return visibleDuration;
    }

    return state.lastDuration || 0;
  }

  function getCurrentTime(audioElement) {
    if (!audioElement || !Number.isFinite(audioElement.currentTime)) {
      return 0;
    }

    return Math.max(0, audioElement.currentTime);
  }

  function clampTime(seconds, audioElement) {
    const duration = getDuration(audioElement);
    const safeSeconds = Math.max(0, Number(seconds) || 0);

    if (duration > 0) {
      return Math.min(duration, safeSeconds);
    }

    return safeSeconds;
  }

  function formatTime(seconds) {
    const safeSeconds = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(safeSeconds / 60);
    const remainder = Math.floor(safeSeconds % 60);

    return `${minutes}:${String(remainder).padStart(2, "0")}`;
  }

  function updateSubtitlesAfterSeek() {
    if (typeof updateMapSubtitleText === "function") {
      try {
        updateMapSubtitleText();
      } catch (error) {}
    }
  }

  function setProgressVisual(progressInput, percent) {
    if (!progressInput) {
      return;
    }

    const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
    progressInput.style.setProperty("--mg-audio-progress-percent", `${safePercent}%`);
  }

  function updateDockVisuals(optimisticTime) {
    const {
      audioElement,
      dock,
      backButton,
      playButton,
      forwardButton,
      progressInput,
      timeLabel
    } = getParts();

    if (!dock || !audioElement || !progressInput) {
      return;
    }

    const ready = hasAudioSource(audioElement);
    const duration = getDuration(audioElement);

    const current = Number.isFinite(optimisticTime)
      ? optimisticTime
      : getCurrentTime(audioElement);

    const ratio = duration > 0
      ? Math.max(0, Math.min(1, current / duration))
      : 0;

    if (!state.dragging) {
      progressInput.max = String(RANGE_MAX);
      progressInput.step = "1";
      progressInput.value = String(Math.round(ratio * RANGE_MAX));
    }

    setProgressVisual(progressInput, ratio * 100);

    if (timeLabel) {
      timeLabel.textContent =
        `${formatTime(current)} / ${duration ? formatTime(duration) : "0:00"}`;
    }

    [backButton, playButton, forwardButton, progressInput].forEach(control => {
      if (!control) {
        return;
      }

      control.disabled = !ready;
      control.setAttribute("aria-disabled", ready ? "false" : "true");
    });

    dock.classList.toggle("is-ready", ready);
    dock.classList.toggle("is-playing", ready && !audioElement.paused);
    dock.classList.toggle(
      "is-active",
      ready && (!audioElement.paused || current > 0.05 || state.dragging)
    );
    dock.classList.toggle("is-scrubbing", state.dragging);
  }

  function replaceAudioWithBlob(originalUrl, blobUrl, targetTime, shouldPlay) {
    const audioElement = getAudioElement();

    if (!audioElement || !blobUrl) {
      return;
    }

    const current = getCurrentSrc(audioElement);

    if (current === blobUrl) {
      try {
        audioElement.currentTime = clampTime(targetTime, audioElement);
      } catch (error) {}

      if (shouldPlay) {
        audioElement.play().catch(() => {});
      }

      updateSubtitlesAfterSeek();
      updateDockVisuals();
      return;
    }

    rememberOriginalAudioUrl(originalUrl);

    const wasPaused = audioElement.paused;
    const shouldResume = shouldPlay || !wasPaused;
    const desiredTime = clampTime(targetTime, audioElement);

    audioElement.src = blobUrl;
    audioElement.dataset.mgOriginalAudioSrc = originalUrl;
    audioElement.preload = "auto";

    const applyAfterMetadata = () => {
      try {
        audioElement.currentTime = clampTime(desiredTime, audioElement);
      } catch (error) {}

      updateSubtitlesAfterSeek();
      updateDockVisuals(desiredTime);

      if (shouldResume) {
        audioElement.play().catch(() => {});
      }
    };

    audioElement.addEventListener("loadedmetadata", applyAfterMetadata, { once: true });

    try {
      audioElement.load();
    } catch (error) {}

    window.setTimeout(applyAfterMetadata, 180);
    window.setTimeout(applyAfterMetadata, 700);
  }

  function ensureSeekableBlob(originalUrl, options = {}) {
    const cleanUrl = String(originalUrl || "").trim();

    if (
      !cleanUrl ||
      isBlobUrl(cleanUrl) ||
      !/^https?:\/\//i.test(cleanUrl)
    ) {
      return Promise.resolve("");
    }

    if (state.blobCache.has(cleanUrl)) {
      const cached = state.blobCache.get(cleanUrl);

      if (options.replaceCurrent) {
        replaceAudioWithBlob(
          cleanUrl,
          cached,
          options.targetTime || getCurrentTime(getAudioElement()),
          options.shouldPlay
        );
      }

      return Promise.resolve(cached);
    }

    if (state.blobFailed.has(cleanUrl)) {
      return Promise.resolve("");
    }

    if (state.blobInflight.has(cleanUrl)) {
      return state.blobInflight.get(cleanUrl).then(blobUrl => {
        if (blobUrl && options.replaceCurrent) {
          replaceAudioWithBlob(
            cleanUrl,
            blobUrl,
            options.targetTime || getCurrentTime(getAudioElement()),
            options.shouldPlay
          );
        }

        return blobUrl;
      });
    }

    const request = fetch(cleanUrl, {
      method: "GET",
      mode: "cors",
      cache: "force-cache",
      credentials: "omit"
    })
      .then(response => {
        if (!response.ok) {
          throw new Error(`Audio fetch failed: ${response.status}`);
        }

        return response.blob();
      })
      .then(blob => {
        const blobUrl = URL.createObjectURL(blob);
        state.blobCache.set(cleanUrl, blobUrl);
        state.blobInflight.delete(cleanUrl);

        if (options.replaceCurrent) {
          replaceAudioWithBlob(
            cleanUrl,
            blobUrl,
            options.targetTime || getCurrentTime(getAudioElement()),
            options.shouldPlay
          );
        }

        return blobUrl;
      })
      .catch(error => {
        console.warn(
          "Audio file could not be converted to a seekable Blob. If seeking still fails, host this MP3 in the repo/assets folder.",
          error
        );

        state.blobFailed.add(cleanUrl);
        state.blobInflight.delete(cleanUrl);
        return "";
      });

    state.blobInflight.set(cleanUrl, request);
    return request;
  }

  function tryNativeSeek(targetTime) {
    const audioElement = getAudioElement();

    if (!hasAudioSource(audioElement)) {
      return;
    }

    const target = clampTime(targetTime, audioElement);
    const before = getCurrentTime(audioElement);

    try {
      audioElement.currentTime = target;
    } catch (error) {}

    updateSubtitlesAfterSeek();
    updateDockVisuals(target);

    /*
      If currentTime is ignored, the remote source is probably not seekable.
      Then we prepare/use the Blob version and apply the pending seek.
    */
    window.setTimeout(() => {
      const after = getCurrentTime(audioElement);
      const seekWorked = Math.abs(after - target) < 1.25;

      if (seekWorked) {
        state.pendingSeek = null;
        updateSubtitlesAfterSeek();
        updateDockVisuals();
        return;
      }

      /*
        Avoid treating tiny natural playback movement as success.
      */
      const barelyMoved = Math.abs(after - before) < 1.5;

      if (barelyMoved || Math.abs(after - target) >= 1.25) {
        state.pendingSeek = target;

        const originalUrl = getOriginalAudioUrl(audioElement);

        ensureSeekableBlob(originalUrl, {
          replaceCurrent: true,
          targetTime: target,
          shouldPlay: !audioElement.paused
        });
      }
    }, 260);
  }

  function seekTo(seconds) {
    const audioElement = getAudioElement();

    if (!hasAudioSource(audioElement)) {
      return;
    }

    const target = clampTime(seconds, audioElement);
    state.pendingSeek = target;

    tryNativeSeek(target);
  }

  function seekBy(deltaSeconds) {
    const audioElement = getAudioElement();

    if (!hasAudioSource(audioElement)) {
      return;
    }

    seekTo(getCurrentTime(audioElement) + deltaSeconds);
  }

  function togglePlayback() {
    const audioElement = getAudioElement();

    if (!hasAudioSource(audioElement)) {
      return;
    }

    if (audioElement.paused) {
      audioElement.play().catch(() => {});
    } else {
      audioElement.pause();
    }

    updateDockVisuals();
  }

  function getDockPartFromPoint(clientX, clientY) {
    const {
      dock,
      backButton,
      playButton,
      forwardButton,
      progressInput
    } = getParts();

    if (!dock) {
      return null;
    }

    const dockRect = dock.getBoundingClientRect();

    if (
      clientX < dockRect.left ||
      clientX > dockRect.right ||
      clientY < dockRect.top ||
      clientY > dockRect.bottom
    ) {
      return null;
    }

    const controls = [
      ["back", backButton],
      ["play", playButton],
      ["forward", forwardButton],
      ["progress", progressInput]
    ];

    for (const [name, element] of controls) {
      if (!element) {
        continue;
      }

      const rect = element.getBoundingClientRect();

      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        return name;
      }
    }

    return "dock";
  }

  function seekFromClientX(clientX) {
    const { audioElement, progressInput } = getParts();

    if (!hasAudioSource(audioElement) || !progressInput) {
      return;
    }

    const duration = getDuration(audioElement);

    if (!duration) {
      return;
    }

    const rect = progressInput.getBoundingClientRect();

    if (!rect || rect.width <= 0) {
      return;
    }

    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const target = duration * ratio;

    progressInput.value = String(Math.round(ratio * RANGE_MAX));
    setProgressVisual(progressInput, ratio * 100);
    updateDockVisuals(target);

    seekTo(target);
  }

  function blockEvent(event) {
    event.preventDefault();
    event.stopPropagation();

    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
  }

  function handlePointerDown(event) {
    const part = getDockPartFromPoint(event.clientX, event.clientY);

    if (!part) {
      return;
    }

    blockEvent(event);
    state.lastPointerActionAt = performance.now();

    if (part === "back") {
      seekBy(-SEEK_STEP_SECONDS);
      return;
    }

    if (part === "forward") {
      seekBy(SEEK_STEP_SECONDS);
      return;
    }

    if (part === "play") {
      togglePlayback();
      return;
    }

    if (part === "progress") {
      state.dragging = true;
      seekFromClientX(event.clientX);
      return;
    }
  }

  function handlePointerMove(event) {
    if (!state.dragging) {
      return;
    }

    blockEvent(event);
    seekFromClientX(event.clientX);
  }

  function finishDragging(event) {
    if (!state.dragging) {
      return;
    }

    if (event && Number.isFinite(event.clientX)) {
      seekFromClientX(event.clientX);
    }

    state.dragging = false;
    blockEvent(event);
    updateDockVisuals();
  }

  function handleClick(event) {
    const part = getDockPartFromPoint(event.clientX, event.clientY);

    if (!part) {
      return;
    }

    blockEvent(event);

    /*
      Pointerdown already handled mouse actions. This catches keyboard/synthetic
      clicks without double-seeking normal pointer clicks.
    */
    if (performance.now() - state.lastPointerActionAt < 500) {
      return;
    }

    if (part === "back") {
      seekBy(-SEEK_STEP_SECONDS);
    } else if (part === "forward") {
      seekBy(SEEK_STEP_SECONDS);
    } else if (part === "play") {
      togglePlayback();
    } else if (part === "progress") {
      seekFromClientX(event.clientX);
    }
  }

  function handleRangeInput(event) {
    const { audioElement, progressInput } = getParts();

    if (!progressInput || event.target !== progressInput) {
      return;
    }

    blockEvent(event);

    const duration = getDuration(audioElement);

    if (!duration) {
      return;
    }

    const ratio = Math.max(
      0,
      Math.min(1, Number(progressInput.value || 0) / RANGE_MAX)
    );

    state.dragging = true;
    setProgressVisual(progressInput, ratio * 100);
    seekTo(duration * ratio);
  }

  function bindAudioEvents() {
    const audioElement = getAudioElement();

    if (!audioElement || audioElement.dataset.mgFinalSeekableBound === "yes") {
      return;
    }

    audioElement.dataset.mgFinalSeekableBound = "yes";
    audioElement.preload = "auto";

    [
      "loadedmetadata",
      "durationchange",
      "canplay",
      "canplaythrough",
      "timeupdate",
      "play",
      "playing",
      "pause",
      "seeking",
      "seeked",
      "ended",
      "emptied"
    ].forEach(eventName => {
      audioElement.addEventListener(eventName, () => {
        if (eventName === "seeked") {
          updateSubtitlesAfterSeek();
        }

        updateDockVisuals();
      });
    });
  }

  function startVisualLoop() {
    if (state.visualTimer) {
      return;
    }

    state.visualTimer = window.setInterval(() => {
      bindAudioEvents();
      updateDockVisuals();
    }, 250);
  }

  /*
    Capture at window level. Earlier broken patches listen on document,
    so this runs before them.
  */
  window.addEventListener("pointerdown", handlePointerDown, true);
  window.addEventListener("pointermove", handlePointerMove, true);
  window.addEventListener("pointerup", finishDragging, true);
  window.addEventListener("pointercancel", finishDragging, true);
  window.addEventListener("click", handleClick, true);
  window.addEventListener("input", handleRangeInput, true);
  window.addEventListener("change", handleRangeInput, true);

  bindAudioEvents();
  startVisualLoop();
  updateDockVisuals();

  /*
    Start preparing a seekable Blob early, during the call animation.
    prepareStoryAudio runs long before audio starts, so this gives the
    browser time to cache the file.
  */
  if (typeof prepareStoryAudio === "function" && !window.__mgFinalSeekablePrepareWrapped) {
    const originalPrepareStoryAudio = prepareStoryAudio;

    prepareStoryAudio = function finalSeekablePrepareStoryAudio(story) {
      const result = originalPrepareStoryAudio.apply(this, arguments);

      if (story && story.audio) {
        rememberOriginalAudioUrl(story.audio);
        ensureSeekableBlob(story.audio, {
          replaceCurrent: false
        });
      }

      window.setTimeout(() => {
        bindAudioEvents();
        updateDockVisuals();
      }, 80);

      return result;
    };

    window.__mgFinalSeekablePrepareWrapped = true;
  }

  if (typeof playStoryAudio === "function" && !window.__mgFinalSeekablePlayWrapped) {
    const originalPlayStoryAudio = playStoryAudio;

    playStoryAudio = function finalSeekablePlayStoryAudio(story) {
      if (story && story.audio) {
        rememberOriginalAudioUrl(story.audio);
      }

      const result = originalPlayStoryAudio.apply(this, arguments);

      if (story && story.audio) {
        ensureSeekableBlob(story.audio, {
          replaceCurrent: false
        });
      }

      window.setTimeout(() => {
        bindAudioEvents();
        updateDockVisuals();
      }, 80);

      window.setTimeout(updateDockVisuals, 500);

      return result;
    };

    window.__mgFinalSeekablePlayWrapped = true;
  }
})();
/* ==========================================================
   TITLE INVITATION — SAFE COMPACT PREVIEW

   Safer replacement for the previous compact invitation patch.

   Fixes:
   - No MutationObserver loop.
   - The invitation opens compact.
   - Only the greeting + first paragraph show at first.
   - A small downward arrow expands the box.
   - The bilingual Persian/English toggle is preserved.
   - Older inline sizing from the bilingual invitation system is clamped.

   Paste at the VERY BOTTOM of script.js,
   after removing the previous compactTitleInvitationPreview patch.
   ========================================================== */

(function safeCompactTitleInvitationPreview() {
  if (window.__mgSafeCompactTitleInvitationReady) {
    return;
  }

  window.__mgSafeCompactTitleInvitationReady = true;

  const COMPACT_WIDTH = 500;
  const EXPANDED_WIDTH = 640;
  const COMPACT_HEIGHT = 250;
  const EXPANDED_HEIGHT = 680;

  let wasVisible = false;

  const originalSetProperty = CSSStyleDeclaration.prototype.setProperty;

  function getQuoteBox() {
    return document.getElementById("title-memory-quote");
  }

  function getLiveMarker() {
    return document.querySelector(".title-live-i");
  }

  function isQuoteBoxStyle(styleObject) {
    const box = getQuoteBox();
    return Boolean(box && styleObject === box.style);
  }

  function viewportWidth() {
    return window.innerWidth || document.documentElement.clientWidth || 1200;
  }

  function viewportHeight() {
    return window.innerHeight || document.documentElement.clientHeight || 800;
  }

  function compactWidth() {
    return Math.min(COMPACT_WIDTH, viewportWidth() - 34);
  }

  function expandedWidth() {
    return Math.min(EXPANDED_WIDTH, viewportWidth() - 34);
  }

  function compactHeight() {
    return Math.min(COMPACT_HEIGHT, Math.max(185, viewportHeight() - 110));
  }

  function expandedHeight() {
    return Math.min(EXPANDED_HEIGHT, Math.max(340, viewportHeight() * 0.74));
  }

  function isExpanded(box) {
    return Boolean(box && box.classList.contains("mg-title-invitation-expanded"));
  }

  function isVisible(box) {
    return Boolean(
      box &&
      (
        box.classList.contains("visible") ||
        box.getAttribute("aria-hidden") === "false"
      )
    );
  }

  /*
    Clamp old inline sizing from the previous bilingual invitation system.
    This prevents the older positionBilingualInvitationBox() from forcing
    the box back to 640 x 700 every time the pointer moves.
  */
  CSSStyleDeclaration.prototype.setProperty = function patchedSetProperty(propertyName, value, priority) {
    if (isQuoteBoxStyle(this)) {
      const box = getQuoteBox();
      const expanded = isExpanded(box);

      const prop = String(propertyName || "").toLowerCase();

      if (prop === "width") {
        value = `${expanded ? expandedWidth() : compactWidth()}px`;
        priority = "important";
      }

      if (prop === "height" || prop === "max-height") {
        value = `${expanded ? expandedHeight() : compactHeight()}px`;
        priority = "important";
      }

      if (prop === "overflow") {
        value = "hidden";
        priority = "important";
      }
    }

    return originalSetProperty.call(this, propertyName, value, priority);
  };

  function setImportant(element, property, value) {
    if (!element) {
      return;
    }

    originalSetProperty.call(element.style, property, value, "important");
  }

  function ensureExpandButton() {
    const box = getQuoteBox();

    if (!box) {
      return null;
    }

    let button = box.querySelector(".mg-title-invitation-expand");

    if (button) {
      return button;
    }

    button = document.createElement("button");
    button.type = "button";
    button.className = "mg-title-invitation-expand";
    button.setAttribute("aria-label", "Continue reading invitation");
    button.setAttribute("title", "Continue reading");

    button.innerHTML = `
      <span class="mg-title-invitation-expand-glow" aria-hidden="true"></span>
      <span class="mg-title-invitation-expand-arrow" aria-hidden="true">⌄</span>
      <span class="mg-title-invitation-expand-text">Continue reading</span>
    `;

    button.addEventListener(
      "pointerdown",
      event => {
        event.stopPropagation();
      },
      true
    );

    button.addEventListener(
      "click",
      event => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        toggleExpanded();
      },
      true
    );

    box.appendChild(button);
    return button;
  }

  function updateExpandButton() {
    const box = getQuoteBox();
    const button = ensureExpandButton();

    if (!box || !button) {
      return;
    }

    const expanded = isExpanded(box);
    const arrow = button.querySelector(".mg-title-invitation-expand-arrow");
    const label = button.querySelector(".mg-title-invitation-expand-text");

    button.setAttribute("aria-expanded", expanded ? "true" : "false");
    button.setAttribute(
      "aria-label",
      expanded ? "Collapse invitation" : "Continue reading invitation"
    );
    button.setAttribute(
      "title",
      expanded ? "Collapse" : "Continue reading"
    );

    if (arrow) {
      arrow.textContent = expanded ? "⌃" : "⌄";
    }

    if (label) {
      label.textContent = expanded ? "Collapse" : "Continue reading";
    }
  }

  function collapseBox() {
    const box = getQuoteBox();
    const scroll = document.getElementById("title-memory-invitation-scroll");

    if (!box) {
      return;
    }

    box.classList.add("mg-title-invitation-compact");
    box.classList.remove("mg-title-invitation-expanded");

    if (scroll) {
      scroll.scrollTop = 0;
    }

    applyBoxLayout();
  }

  function expandBox() {
    const box = getQuoteBox();
    const scroll = document.getElementById("title-memory-invitation-scroll");

    if (!box) {
      return;
    }

    box.classList.add("mg-title-invitation-compact");
    box.classList.add("mg-title-invitation-expanded");

    if (scroll) {
      scroll.scrollTop = 0;
    }

    applyBoxLayout();
  }

  function toggleExpanded() {
    const box = getQuoteBox();

    if (!box) {
      return;
    }

    if (isExpanded(box)) {
      collapseBox();
    } else {
      expandBox();
    }
  }

  function positionNearTitleDot(box) {
    const marker = getLiveMarker();

    if (!box || !marker) {
      return;
    }

    const expanded = isExpanded(box);
    const width = expanded ? expandedWidth() : compactWidth();
    const height = expanded ? expandedHeight() : compactHeight();

    const markerRect = marker.getBoundingClientRect();

    const preferredLeft =
      markerRect.left + markerRect.width / 2 - width * 0.16;

    const left = Math.max(
      17,
      Math.min(preferredLeft, viewportWidth() - width - 17)
    );

    let top = markerRect.bottom + 16;

    if (top + height > viewportHeight() - 20) {
      top = Math.max(72, viewportHeight() - height - 20);
    }

    setImportant(box, "left", `${left}px`);
    setImportant(box, "top", `${top}px`);
  }

  function applyBoxLayout() {
    const box = getQuoteBox();

    if (!box) {
      return;
    }

    const expanded = isExpanded(box);

    box.classList.add("mg-title-invitation-compact");

    const width = expanded ? expandedWidth() : compactWidth();
    const height = expanded ? expandedHeight() : compactHeight();

    setImportant(box, "width", `${width}px`);
    setImportant(box, "height", `${height}px`);
    setImportant(box, "max-height", `${height}px`);
    setImportant(box, "max-width", "calc(100vw - 34px)");
    setImportant(box, "overflow", "hidden");

    positionNearTitleDot(box);
    ensureExpandButton();
    updateExpandButton();
  }

  function refresh() {
    const box = getQuoteBox();

    if (!box) {
      return;
    }

    const visibleNow = isVisible(box);

    box.classList.add("mg-title-invitation-compact");

    /*
      Each new opening starts collapsed.
    */
    if (visibleNow && !wasVisible) {
      collapseBox();
    }

    wasVisible = visibleNow;

    if (visibleNow) {
      applyBoxLayout();
    } else {
      ensureExpandButton();
      updateExpandButton();
    }
  }

  /*
    Low-frequency polling is intentional here.
    It avoids watching style/class changes, which caused the page freeze.
  */
  window.setInterval(refresh, 350);

  window.addEventListener("resize", () => {
    refresh();
  });

  document.addEventListener(
    "pointermove",
    () => {
      const box = getQuoteBox();

      if (box && isVisible(box)) {
        refresh();
      }
    },
    { passive: true }
  );

  document.addEventListener(
    "click",
    event => {
      const button = event.target.closest &&
        event.target.closest(".mg-title-invitation-expand");

      if (!button) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      toggleExpanded();
    },
    true
  );

  window.setTimeout(refresh, 300);
  window.setTimeout(refresh, 900);
  window.setTimeout(refresh, 1600);
})();
/* ==========================================================
   TRUST PUBLICMAPDATA COORDINATES

   Goal:
   - The spreadsheet/backend is the source of truth for coordinates.
   - Frontend may clean names and labels, but it must not override
     origin_lng/origin_lat or destination_lng/destination_lat.
   - This neutralizes older Bushehr/Boushehr coordinate overrides
     by locking coordinates loaded from PublicMapData.

   Paste at the VERY BOTTOM of script.js.
   ========================================================== */

(function trustPublicMapDataCoordinates() {
  if (window.__mgTrustPublicMapDataCoordinatesReady) {
    return;
  }

  window.__mgTrustPublicMapDataCoordinatesReady = true;

  function numberFromRow(row, key) {
    const value = Number(row && row[key]);
    return Number.isFinite(value) ? value : NaN;
  }

  function validCoords(coords) {
    return Boolean(
      Array.isArray(coords) &&
      coords.length >= 2 &&
      Number.isFinite(Number(coords[0])) &&
      Number.isFinite(Number(coords[1]))
    );
  }

  function lockCoordinateProperty(story, propertyName, coords) {
    if (!story || !validCoords(coords)) {
      return;
    }

    /*
      configurable: true means our own future loader can update it
      if PublicMapData changes. writable: false means older frontend
      patches cannot silently replace it with hard-coded Bushehr values.
    */
    Object.defineProperty(story, propertyName, {
      value: [Number(coords[0]), Number(coords[1])],
      writable: false,
      configurable: true,
      enumerable: true
    });
  }

  function attachSheetCoordinates(story, row) {
    if (!story || !row) {
      return story;
    }

    const originCoords = [
      numberFromRow(row, "origin_lng"),
      numberFromRow(row, "origin_lat")
    ];

    const destinationCoords = [
      numberFromRow(row, "destination_lng"),
      numberFromRow(row, "destination_lat")
    ];

    if (validCoords(originCoords)) {
      Object.defineProperty(story, "__sheetOriginCoords", {
        value: originCoords.slice(),
        writable: false,
        configurable: true,
        enumerable: false
      });

      lockCoordinateProperty(story, "originCoords", originCoords);
    }

    if (validCoords(destinationCoords)) {
      Object.defineProperty(story, "__sheetDestinationCoords", {
        value: destinationCoords.slice(),
        writable: false,
        configurable: true,
        enumerable: false
      });

      lockCoordinateProperty(story, "destinationCoords", destinationCoords);
    }

    return story;
  }

  function restoreSheetCoordinates(story) {
    if (!story) {
      return story;
    }

    if (validCoords(story.__sheetOriginCoords)) {
      lockCoordinateProperty(story, "originCoords", story.__sheetOriginCoords);
    }

    if (validCoords(story.__sheetDestinationCoords)) {
      lockCoordinateProperty(story, "destinationCoords", story.__sheetDestinationCoords);
    }

    return story;
  }

  function restoreAllSheetCoordinates() {
    if (Array.isArray(stories)) {
      stories.forEach(restoreSheetCoordinates);
    }

    if (activeStory) {
      restoreSheetCoordinates(activeStory);
    }
  }

  /*
    Wrap rowToStory after all older rowToStory wrappers.
    Even if an older wrapper changes Bushehr coordinates, this puts
    the sheet coordinates back and locks them.
  */
  if (typeof rowToStory === "function" && !window.__mgTrustSheetRowToStoryWrapped) {
    const previousRowToStory = rowToStory;

    rowToStory = function trustSheetRowToStory(row) {
      const story = previousRowToStory(row);

      if (!story) {
        return story;
      }

      return attachSheetCoordinates(story, row);
    };

    window.__mgTrustSheetRowToStoryWrapped = true;
  }

  /*
    The older Bushehr repair also wraps selectStory.
    By restoring locked sheet coordinates immediately before selection,
    those older assignments fail silently instead of replacing the data.
  */
  if (typeof selectStory === "function" && !window.__mgTrustSheetSelectStoryWrapped) {
    const previousSelectStory = selectStory;

    selectStory = function trustSheetSelectStory(story, options = {}) {
      restoreSheetCoordinates(story);
      return previousSelectStory.call(this, story, options);
    };

    window.__mgTrustSheetSelectStoryWrapped = true;
  }

  /*
    Keep render safe too, because many later patches call render directly.
  */
  if (typeof render === "function" && !window.__mgTrustSheetRenderWrapped) {
    const previousRender = render;

    render = function trustSheetRender() {
      restoreAllSheetCoordinates();
      return previousRender.apply(this, arguments);
    };

    window.__mgTrustSheetRenderWrapped = true;
  }

  window.setTimeout(restoreAllSheetCoordinates, 300);
  window.setTimeout(restoreAllSheetCoordinates, 900);
  window.setTimeout(restoreAllSheetCoordinates, 1800);
})();
/* ==========================================================
   CALL SOUND — OLD PHONE RINGBACK RESTORE

   Replaces the current pulse-beep call sound with a warmer
   old-phone ring / ringback tone.

   Behavior:
   - Soft analog hum underneath.
   - Two-tone telephone ring using 440Hz + 480Hz.
   - Ring-ring cadence, then pause.
   - Stops cleanly when the call arrives or resets.

   Paste at the VERY BOTTOM of script.js.
   ========================================================== */

(function restoreOldPhoneRingbackSound() {
  if (window.__mgOldPhoneRingbackReady) {
    return;
  }

  window.__mgOldPhoneRingbackReady = true;

  const OLD_PHONE_RING = {
    ringVolume: 0.052,
    humVolume: 0.010,
    ringA: 440,
    ringB: 480,
    humA: 86,
    humB: 91.5,
    cycleMs: 3650
  };

  function getRingAudioContext() {
    if (typeof getAudioContext === "function") {
      return getAudioContext();
    }

    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;

      if (!AudioContextClass) {
        return null;
      }

      if (!audioContext) {
        audioContext = new AudioContextClass();
      }

      return audioContext;
    } catch (error) {
      console.warn("Audio context could not be created.", error);
      return null;
    }
  }

  function scheduleRingBurst(nodes, startTime, duration) {
    if (!nodes || !nodes.ringGain) {
      return;
    }

    const gain = nodes.ringGain.gain;
    const peak = OLD_PHONE_RING.ringVolume;

    gain.cancelScheduledValues(startTime);
    gain.setValueAtTime(0.0001, startTime);
    gain.linearRampToValueAtTime(peak, startTime + 0.075);
    gain.setValueAtTime(peak, startTime + Math.max(0.08, duration - 0.12));
    gain.linearRampToValueAtTime(0.0001, startTime + duration);
  }

  function scheduleOldPhoneRing(nodes) {
    if (!nodes || !nodes.context) {
      return;
    }

    const now = nodes.context.currentTime + 0.025;

    /*
      Classic old-phone feeling:
      ring... small breath... ring... longer silence.
    */
    scheduleRingBurst(nodes, now, 0.78);
    scheduleRingBurst(nodes, now + 1.02, 0.78);
  }

  function cleanupOldPhoneNodes(nodes) {
    if (!nodes) {
      return;
    }

    [
      "humA",
      "humB",
      "ringA",
      "ringB"
    ].forEach(key => {
      try {
        if (nodes[key]) {
          nodes[key].stop();
        }
      } catch (error) {}
    });

    [
      "humA",
      "humB",
      "ringA",
      "ringB",
      "humFilter",
      "ringHighpass",
      "ringLowpass",
      "humGain",
      "ringGain",
      "masterGain"
    ].forEach(key => {
      try {
        if (nodes[key]) {
          nodes[key].disconnect();
        }
      } catch (error) {}
    });
  }

  startWaitingBuzz = function oldPhoneStartWaitingBuzz() {
    const context = getRingAudioContext();

    if (!context) {
      return;
    }

    if (buzzNodes) {
      return;
    }

    const beginRing = () => {
      if (buzzNodes) {
        return;
      }

      const now = context.currentTime + 0.02;

      const masterGain = context.createGain();
      masterGain.gain.setValueAtTime(0.0001, now);
      masterGain.gain.linearRampToValueAtTime(1, now + 0.12);

      const humGain = context.createGain();
      humGain.gain.setValueAtTime(OLD_PHONE_RING.humVolume, now);

      const ringGain = context.createGain();
      ringGain.gain.setValueAtTime(0.0001, now);

      const humFilter = context.createBiquadFilter();
      humFilter.type = "lowpass";
      humFilter.frequency.setValueAtTime(260, now);
      humFilter.Q.setValueAtTime(0.72, now);

      /*
        Telephone-ish band: narrow enough to feel archival,
        not so harsh that it becomes an alarm.
      */
      const ringHighpass = context.createBiquadFilter();
      ringHighpass.type = "highpass";
      ringHighpass.frequency.setValueAtTime(260, now);
      ringHighpass.Q.setValueAtTime(0.70, now);

      const ringLowpass = context.createBiquadFilter();
      ringLowpass.type = "lowpass";
      ringLowpass.frequency.setValueAtTime(1350, now);
      ringLowpass.Q.setValueAtTime(0.82, now);

      const humA = context.createOscillator();
      humA.type = "sine";
      humA.frequency.setValueAtTime(OLD_PHONE_RING.humA, now);

      const humB = context.createOscillator();
      humB.type = "sine";
      humB.frequency.setValueAtTime(OLD_PHONE_RING.humB, now);

      const ringA = context.createOscillator();
      ringA.type = "sine";
      ringA.frequency.setValueAtTime(OLD_PHONE_RING.ringA, now);

      const ringB = context.createOscillator();
      ringB.type = "sine";
      ringB.frequency.setValueAtTime(OLD_PHONE_RING.ringB, now);

      humA.connect(humFilter);
      humB.connect(humFilter);
      humFilter.connect(humGain);
      humGain.connect(masterGain);

      ringA.connect(ringHighpass);
      ringB.connect(ringHighpass);
      ringHighpass.connect(ringLowpass);
      ringLowpass.connect(ringGain);
      ringGain.connect(masterGain);

      masterGain.connect(context.destination);

      humA.start(now);
      humB.start(now);
      ringA.start(now);
      ringB.start(now);

      buzzNodes = {
        kind: "old-phone-ringback",
        context,
        masterGain,
        humGain,
        ringGain,
        humFilter,
        ringHighpass,
        ringLowpass,
        humA,
        humB,
        ringA,
        ringB,
        timer: null
      };

      scheduleOldPhoneRing(buzzNodes);

      buzzNodes.timer = window.setInterval(() => {
        if (buzzNodes && buzzNodes.kind === "old-phone-ringback") {
          scheduleOldPhoneRing(buzzNodes);
        }
      }, OLD_PHONE_RING.cycleMs);
    };

    if (context.state === "suspended") {
      context.resume()
        .then(beginRing)
        .catch(error => {
          console.warn("Audio context could not resume.", error);
        });
    } else {
      beginRing();
    }
  };

  /*
    Keep this name alive in case any older code tries to call it.
    Now it schedules an old-phone ring cycle instead of a pulse beep.
  */
  pulseCallBeep = function oldPhonePulseCallBeepCompatibility() {
    if (!buzzNodes || buzzNodes.kind !== "old-phone-ringback") {
      return;
    }

    scheduleOldPhoneRing(buzzNodes);
  };

  stopWaitingBuzz = function oldPhoneStopWaitingBuzz() {
    if (!buzzNodes) {
      return;
    }

    const nodes = buzzNodes;
    buzzNodes = null;

    if (nodes.timer) {
      clearInterval(nodes.timer);
    }

    const context = nodes.context;
    const now = context.currentTime;

    try {
      if (nodes.ringGain) {
        nodes.ringGain.gain.cancelScheduledValues(now);
        nodes.ringGain.gain.setValueAtTime(nodes.ringGain.gain.value || 0.0001, now);
        nodes.ringGain.gain.linearRampToValueAtTime(0.0001, now + 0.16);
      }

      if (nodes.humGain) {
        nodes.humGain.gain.cancelScheduledValues(now);
        nodes.humGain.gain.setValueAtTime(nodes.humGain.gain.value || OLD_PHONE_RING.humVolume, now);
        nodes.humGain.gain.linearRampToValueAtTime(0.0001, now + 0.28);
      }

      if (nodes.masterGain) {
        nodes.masterGain.gain.cancelScheduledValues(now);
        nodes.masterGain.gain.setValueAtTime(nodes.masterGain.gain.value || 0.0001, now);
        nodes.masterGain.gain.linearRampToValueAtTime(0.0001, now + 0.34);
      }

      window.setTimeout(() => {
        cleanupOldPhoneNodes(nodes);
      }, 460);
    } catch (error) {
      console.warn("Old phone ring could not stop cleanly.", error);
      cleanupOldPhoneNodes(nodes);
    }
  };
})();
/* ==========================================================
   POST-AUDIO FRAGMENT PANEL — DIRECT OPEN

   Goal:
   - Remove the extra small City — Year reveal step.
   - After audio ends, open one main fragment panel directly.
   - The panel shows either:
     1. submitted image
     2. submitted external link
     3. submitted text
   - Keep audio/subtitles first.
   - Do not delete older audio-first code; safely override it.

   Paste at the VERY BOTTOM of script.js.
   ========================================================== */

(function directPostAudioFragmentPanel() {
  if (window.__mgDirectPostAudioFragmentPanelReady) {
    return;
  }

  window.__mgDirectPostAudioFragmentPanelReady = true;

  const PANEL_ID = "story-post-audio-fragment-panel";
  const LEGACY_REVEAL_BUTTON_ID = "story-extra-reveal-button";
  const LEGACY_LINK_PANEL_ID = "story-extra-link-panel";

  const state = {
    pendingStoryId: "",
    pendingAttempts: 0,
    pendingTimer: null,
    openedStoryId: ""
  };

  function safeText(value, fallback = "") {
    const text = String(value || "").trim();
    return text || fallback;
  }

  function escapeFragmentHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function normalizeFragmentUrl(value) {
    if (typeof normalizeUrl === "function") {
      return normalizeUrl(value);
    }

    const link = String(value || "").trim();

    if (!link) {
      return "";
    }

    if (/^https?:\/\//i.test(link)) {
      return link;
    }

    if (/^www\./i.test(link)) {
      return `https://${link}`;
    }

    return link;
  }

  function isFragmentImageUrl(value) {
    const link = normalizeFragmentUrl(value);

    if (!link) {
      return false;
    }

    if (typeof isImageUrl === "function") {
      return isImageUrl(link);
    }

    return /\.(jpg|jpeg|png|gif|webp|avif|svg)(\?.*)?$/i.test(link);
  }

  function getFragmentLink(story) {
    return normalizeFragmentUrl(story && story.fileOrLink);
  }

  function getFragmentText(story) {
    const text = safeText(story && story.quote);

    if (!text) {
      return "";
    }

    const lower = text.toLowerCase();

    if (
      lower === "no story text yet." ||
      lower === "click a blinking point outside iran. the map will carry the call back home."
    ) {
      return "";
    }

    return text;
  }

  function hasPersianText(text) {
    return /[\u0600-\u06FF]/.test(String(text || ""));
  }

  function getFragmentType(story) {
    const link = getFragmentLink(story);
    const text = getFragmentText(story);

    /*
      Priority:
      - If a file/link exists and it is an image, show image.
      - If a file/link exists and it is not image, show link.
      - Otherwise show submitted text.
    */
    if (link && isFragmentImageUrl(link)) {
      return "image";
    }

    if (link) {
      return "link";
    }

    if (text) {
      return "text";
    }

    return "";
  }

  function hasFragmentContent(story) {
    return Boolean(story && getFragmentType(story));
  }

  function fragmentTitle(story) {
    const city = safeText(story && story.originCity, "Unknown city");
    const year = safeText(story && story.yearLeft, "—");

    return `${city} — ${year}`;
  }

  function ensurePanel() {
    let panel = document.getElementById(PANEL_ID);

    if (panel) {
      return panel;
    }

    panel = document.createElement("aside");
    panel.id = PANEL_ID;
    panel.className = "story-post-audio-fragment-panel";
    panel.setAttribute("aria-hidden", "true");
    panel.setAttribute("aria-label", "Submitted fragment");

    panel.innerHTML = `
      <div class="story-post-audio-fragment-inner">
        <header class="story-post-audio-fragment-header">
          <div>
            <p class="story-post-audio-fragment-eyebrow">Fragment</p>
            <h3 class="story-post-audio-fragment-title">Submitted fragment</h3>
          </div>

          <button
            class="story-post-audio-fragment-close"
            type="button"
            aria-label="Close fragment"
            title="Close"
          >
            ×
          </button>
        </header>

        <div class="story-post-audio-fragment-body"></div>
      </div>
    `;

    panel.addEventListener(
      "pointerdown",
      event => {
        event.stopPropagation();
      },
      true
    );

    panel.addEventListener(
      "mousedown",
      event => {
        event.stopPropagation();
      },
      true
    );

    panel.addEventListener(
      "touchstart",
      event => {
        event.stopPropagation();
      },
      { capture: true, passive: true }
    );

    panel.addEventListener(
      "click",
      event => {
        const closeButton = event.target.closest(".story-post-audio-fragment-close");

        if (closeButton) {
          event.preventDefault();
          event.stopPropagation();
          hidePostAudioFragmentPanel();
          return;
        }

        event.stopPropagation();
      },
      true
    );

    document.body.appendChild(panel);

    return panel;
  }

  function hideLegacyRevealButton() {
    const button = document.getElementById(LEGACY_REVEAL_BUTTON_ID);

    if (button) {
      button.classList.remove("visible");
      button.setAttribute("aria-hidden", "true");
      button.tabIndex = -1;
    }
  }

  function hideLegacyExtraLayers() {
    hideLegacyRevealButton();

    const legacyLinkPanel = document.getElementById(LEGACY_LINK_PANEL_ID);
    const legacyLinkAnchor = document.getElementById("story-extra-link-anchor");

    if (legacyLinkPanel) {
      legacyLinkPanel.classList.remove("visible");
      legacyLinkPanel.setAttribute("aria-hidden", "true");
    }

    if (legacyLinkAnchor) {
      legacyLinkAnchor.removeAttribute("href");
    }

    const textPanel = document.getElementById("story-text-panel");

    if (textPanel) {
      textPanel.classList.remove("visible", "full-mode", "finished", "dissolved");
    }

    const textClose = document.getElementById("story-text-close");

    if (textClose) {
      try {
        textClose.click();
      } catch (error) {}
    }

    const imageThumb = document.getElementById("story-image-thumb");

    if (imageThumb) {
      imageThumb.classList.remove("visible");
      imageThumb.classList.add("offscreen");
    }

    const imageModal = document.getElementById("story-image-modal");

    if (imageModal) {
      imageModal.classList.remove("visible");
      imageModal.setAttribute("aria-hidden", "true");
    }

    document.body.classList.remove("story-image-modal-open");

    const attachmentLink = document.getElementById("story-attachment-link");

    if (attachmentLink) {
      attachmentLink.style.display = "none";
    }

    const attachmentImage = document.getElementById("story-attachment-image");

    if (attachmentImage) {
      attachmentImage.style.display = "none";
      attachmentImage.removeAttribute("src");
    }

    const languagePanel = document.getElementById("story-language-panel");

    if (languagePanel) {
      languagePanel.style.display = "none";
    }
  }

  function buildImageContent(story) {
    const link = getFragmentLink(story);
    const safeLink = escapeFragmentHtml(link);
    const title = escapeFragmentHtml(fragmentTitle(story));

    return `
      <a
        class="story-post-audio-image-link"
        href="${safeLink}"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Open image fragment in a new tab"
      >
        <img
          class="story-post-audio-image"
          src="${safeLink}"
          alt="${title} image fragment"
        />
      </a>

      <p class="story-post-audio-fragment-hint">
        Click image to open it larger.
      </p>
    `;
  }

  function buildExternalLinkContent(story) {
    const link = getFragmentLink(story);
    const safeLink = escapeFragmentHtml(link);

    return `
      <p class="story-post-audio-link-intro">
        A submitted fragment continues outside the map.
      </p>

      <a
        class="story-post-audio-link-anchor"
        href="${safeLink}"
        target="_blank"
        rel="noopener noreferrer"
      >
        Open submitted fragment
      </a>
    `;
  }

  function buildTextContent(story) {
    const text = getFragmentText(story);
    const isPersian = hasPersianText(text);

    return `
      <div
        class="story-post-audio-text ${isPersian ? "story-post-audio-text-fa" : ""}"
        ${isPersian ? 'dir="rtl" lang="fa"' : 'dir="auto"'}
      >${escapeFragmentHtml(text)}</div>
    `;
  }

  function buildPanelBody(story, type) {
    if (type === "image") {
      return buildImageContent(story);
    }

    if (type === "link") {
      return buildExternalLinkContent(story);
    }

    if (type === "text") {
      return buildTextContent(story);
    }

    return "";
  }

  function openPostAudioFragmentPanel(story) {
    if (!story || !hasFragmentContent(story)) {
      hidePostAudioFragmentPanel();
      return;
    }

    const type = getFragmentType(story);
    const panel = ensurePanel();
    const eyebrow = panel.querySelector(".story-post-audio-fragment-eyebrow");
    const title = panel.querySelector(".story-post-audio-fragment-title");
    const body = panel.querySelector(".story-post-audio-fragment-body");

    if (eyebrow) {
      eyebrow.textContent =
        type === "image"
          ? "Image fragment"
          : type === "link"
            ? "Linked fragment"
            : "Text fragment";
    }

    if (title) {
      title.textContent = fragmentTitle(story);
    }

    if (body) {
      body.innerHTML = buildPanelBody(story, type);
    }

    panel.dataset.fragmentType = type;
    panel.dataset.storyId = String(story.id || "");
    panel.classList.remove("is-text", "is-image", "is-link");
    panel.classList.add(`is-${type}`);
    panel.classList.add("visible");
    panel.setAttribute("aria-hidden", "false");

    state.openedStoryId = String(story.id || "");

    /*
      Let existing wrapped systems do their final updates first,
      then hide their duplicate legacy layers.
    */
    window.setTimeout(hideLegacyExtraLayers, 60);
    window.setTimeout(hideLegacyExtraLayers, 260);
  }

  function hidePostAudioFragmentPanel() {
    const panel = document.getElementById(PANEL_ID);

    if (panel) {
      panel.classList.remove("visible");
      panel.setAttribute("aria-hidden", "true");
      panel.dataset.storyId = "";
    }

    state.openedStoryId = "";
  }

  function cancelPendingOpen() {
    state.pendingStoryId = "";
    state.pendingAttempts = 0;

    if (state.pendingTimer) {
      window.clearTimeout(state.pendingTimer);
      state.pendingTimer = null;
    }
  }

  function activeStoryStillMatches(storyId) {
    return Boolean(
      activeStory &&
      String(activeStory.id || "") === String(storyId || "")
    );
  }

  function canOpenNow() {
    return (
      typeof journeyPhase === "undefined" ||
      journeyPhase === "arrived"
    );
  }

  function tryOpenPendingPanel() {
    const storyId = state.pendingStoryId;

    if (!storyId) {
      return;
    }

    if (!activeStoryStillMatches(storyId)) {
      cancelPendingOpen();
      hidePostAudioFragmentPanel();
      return;
    }

    hideLegacyRevealButton();

    if (!canOpenNow()) {
      retryPendingOpen();
      return;
    }

    openPostAudioFragmentPanel(activeStory);
    cancelPendingOpen();
  }

  function retryPendingOpen() {
    if (!state.pendingStoryId) {
      return;
    }

    state.pendingAttempts++;

    if (state.pendingAttempts > 120) {
      cancelPendingOpen();
      return;
    }

    if (state.pendingTimer) {
      window.clearTimeout(state.pendingTimer);
    }

    state.pendingTimer = window.setTimeout(tryOpenPendingPanel, 250);
  }

  function schedulePanelAfterAudioEnds(story) {
    if (!story || !hasFragmentContent(story)) {
      hidePostAudioFragmentPanel();
      hideLegacyRevealButton();
      return;
    }

    state.pendingStoryId = String(story.id || "");
    state.pendingAttempts = 0;

    hideLegacyRevealButton();

    window.setTimeout(tryOpenPendingPanel, 40);
  }

  if (audio && typeof audio.addEventListener === "function") {
    audio.addEventListener("ended", () => {
      const story = activeStory;

      /*
        Existing audio/subtitle cleanup runs first.
        Then this opens the post-audio fragment directly.
      */
      window.setTimeout(() => {
        schedulePanelAfterAudioEnds(story);
      }, 80);
    });
  }

  if (typeof selectStory === "function" && !window.__mgPostAudioPanelSelectWrapped) {
    const originalSelectStory = selectStory;

    selectStory = function postAudioPanelSelectStory(story, options = {}) {
      cancelPendingOpen();
      hidePostAudioFragmentPanel();
      hideLegacyRevealButton();

      return originalSelectStory.call(this, story, options);
    };

    window.__mgPostAudioPanelSelectWrapped = true;
  }

  if (typeof playStoryAudio === "function" && !window.__mgPostAudioPanelPlayWrapped) {
    const originalPlayStoryAudio = playStoryAudio;

    playStoryAudio = function postAudioPanelPlayStoryAudio(story) {
      cancelPendingOpen();
      hidePostAudioFragmentPanel();
      hideLegacyRevealButton();

      return originalPlayStoryAudio.apply(this, arguments);
    };

    window.__mgPostAudioPanelPlayWrapped = true;
  }

  if (typeof updateStoryPanelCalling === "function" && !window.__mgPostAudioPanelCallingWrapped) {
    const originalUpdateStoryPanelCalling = updateStoryPanelCalling;

    updateStoryPanelCalling = function postAudioPanelCalling(story) {
      cancelPendingOpen();
      hidePostAudioFragmentPanel();
      hideLegacyRevealButton();

      return originalUpdateStoryPanelCalling.apply(this, arguments);
    };

    window.__mgPostAudioPanelCallingWrapped = true;
  }

  if (typeof updateStoryPanelTraveling === "function" && !window.__mgPostAudioPanelTravelingWrapped) {
    const originalUpdateStoryPanelTraveling = updateStoryPanelTraveling;

    updateStoryPanelTraveling = function postAudioPanelTraveling(story) {
      cancelPendingOpen();
      hidePostAudioFragmentPanel();
      hideLegacyRevealButton();

      return originalUpdateStoryPanelTraveling.apply(this, arguments);
    };

    window.__mgPostAudioPanelTravelingWrapped = true;
  }

  if (typeof resetView === "function" && !window.__mgPostAudioPanelResetWrapped) {
    const originalResetView = resetView;

    resetView = function postAudioPanelResetView() {
      cancelPendingOpen();
      hidePostAudioFragmentPanel();
      hideLegacyRevealButton();

      return originalResetView.apply(this, arguments);
    };

    window.__mgPostAudioPanelResetWrapped = true;
  }

  if (typeof goToIranView === "function" && !window.__mgPostAudioPanelIranWrapped) {
    const originalGoToIranView = goToIranView;

    goToIranView = function postAudioPanelIranView() {
      cancelPendingOpen();
      hidePostAudioFragmentPanel();
      hideLegacyRevealButton();

      return originalGoToIranView.apply(this, arguments);
    };

    window.__mgPostAudioPanelIranWrapped = true;
  }

  if (typeof render === "function" && !window.__mgPostAudioPanelRenderWrapped) {
    const originalRender = render;

    render = function postAudioPanelRender() {
      const result = originalRender.apply(this, arguments);

      hideLegacyRevealButton();

      /*
        If the viewer is waiting for audio-ended content and the map
        finally reaches arrival, open the panel.
      */
      if (
        state.pendingStoryId &&
        canOpenNow() &&
        activeStoryStillMatches(state.pendingStoryId)
      ) {
        window.setTimeout(tryOpenPendingPanel, 20);
      }

      return result;
    };

    window.__mgPostAudioPanelRenderWrapped = true;
  }

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      hidePostAudioFragmentPanel();
    }
  });

  window.setTimeout(hideLegacyRevealButton, 300);
  window.setTimeout(hideLegacyRevealButton, 1200);
})();
/* ==========================================================
   PUBLICMAPDATA COORDINATE SAFETY GUARD

   Goal:
   - Never treat 0,0 as a valid story location.
   - Prevent future broken PublicMapData rows from appearing
     on the map as if they were valid.
   - Backend should geocode first; this is frontend safety.

   Paste at the VERY BOTTOM of script.js.
   ========================================================== */

(function rejectZeroPublicMapCoordinates() {
  if (window.__mgRejectZeroPublicMapCoordinatesReady) {
    return;
  }

  window.__mgRejectZeroPublicMapCoordinatesReady = true;

  function numberFrom(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : NaN;
  }

  function validCoordinatePair(lng, lat) {
    const lon = numberFrom(lng);
    const latitude = numberFrom(lat);

    if (!Number.isFinite(lon) || !Number.isFinite(latitude)) {
      return false;
    }

    if (Math.abs(lon) > 180 || Math.abs(latitude) > 90) {
      return false;
    }

    /*
      0,0 is Null Island. It means missing geocoding here,
      not a real contribution location.
    */
    if (Math.abs(lon) < 0.000001 && Math.abs(latitude) < 0.000001) {
      return false;
    }

    return true;
  }

  if (typeof rowToStory === "function" && !window.__mgRejectZeroRowToStoryWrapped) {
    const previousRowToStory = rowToStory;

    rowToStory = function zeroSafeRowToStory(row) {
      const originOk = validCoordinatePair(row.origin_lng, row.origin_lat);
      const destinationOk = validCoordinatePair(row.destination_lng, row.destination_lat);

      if (!originOk || !destinationOk) {
        console.warn(
          "Skipping PublicMapData row with missing/zero coordinates:",
          {
            id: row && row.id,
            title: row && row.title,
            origin_city: row && row.origin_city,
            origin_lng: row && row.origin_lng,
            origin_lat: row && row.origin_lat,
            destination_city: row && row.destination_city,
            destination_lng: row && row.destination_lng,
            destination_lat: row && row.destination_lat
          }
        );

        return null;
      }

      return previousRowToStory(row);
    };

    window.__mgRejectZeroRowToStoryWrapped = true;
  }
})();
/* ==========================================================
   UNIFIED POST-AUDIO MEDIA PANEL

   Fixes:
   - Text submissions show after audio ends.
   - Image submissions show after audio ends.
   - If a submission has both text and image, both show.
   - Image click opens in-page modal, not a new browser tab.
   - External non-image links still open in a new tab.
   - Applies to all future submissions using quote/text_fragment/image_url/file_or_link.

   Paste at the VERY BOTTOM of script.js.
   ========================================================== */

(function unifiedPostAudioMediaPanel() {
  if (window.__mgUnifiedPostAudioMediaPanelReady) {
    return;
  }

  window.__mgUnifiedPostAudioMediaPanelReady = true;

  const PANEL_ID = "mg-unified-media-panel";
  const MODAL_ID = "mg-unified-image-modal";

  function clean(value) {
    return String(value || "").trim();
  }

  // escapeHtml: use the global definition (see top of file); duplicate removed during cleanup

  function normalizeMediaUrl(value) {
    if (typeof normalizeUrl === "function") {
      return normalizeUrl(value);
    }

    const text = clean(value);

    if (!text) {
      return "";
    }

    if (/^https?:\/\//i.test(text)) {
      return text;
    }

    if (/^www\./i.test(text)) {
      return `https://${text}`;
    }

    return "";
  }

  function looksLikeImageUrl(value) {
    const url = normalizeMediaUrl(value);

    if (!url) {
      return false;
    }

    if (/\.(jpg|jpeg|png|gif|webp|avif|svg)(\?.*)?$/i.test(url)) {
      return true;
    }

    /*
      Tally-hosted file links often do not preserve a clean extension.
      If it is a Tally storage file and not obviously audio/video/document,
      try it as an image. If it fails, the image onerror handler will hide it.
    */
    if (
      /storage\.tally\.so/i.test(url) &&
      !/\.(mp3|wav|m4a|aac|ogg|oga|flac|mp4|mov|avi|webm|pdf|doc|docx|zip)(\?.*)?$/i.test(url)
    ) {
      return true;
    }

    return false;
  }

  function looksLikeAudioUrl(value) {
    return /\.(mp3|wav|m4a|aac|ogg|oga|flac)(\?.*)?$/i.test(String(value || ""));
  }

  function isPlaceholderText(value) {
    const lower = clean(value).toLowerCase();

    return (
      !lower ||
      lower === "no story text yet." ||
      lower === "click a blinking point outside iran. the map will carry the call back home."
    );
  }

  function bestTextForStory(story) {
    if (!story) {
      return "";
    }

    const candidates = [
      story.submittedText,
      story.textFragment,
      story.fullText,
      story.quote,
      story.translationEn,
      story.transcriptFa
    ]
      .map(clean)
      .filter(text => !isPlaceholderText(text))
      .filter(text => !/^https?:\/\//i.test(text));

    if (!candidates.length) {
      return "";
    }

    /*
      Prefer fuller text, but keep short text if it is the only text.
    */
    candidates.sort((a, b) => b.length - a.length);

    return candidates[0];
  }

  function imageUrlForStory(story) {
    if (!story) {
      return "";
    }

    const candidates = [
      story.imageUrl,
      story.image_url,
      story.photoUrl,
      story.fileOrLink
    ];

    for (let i = 0; i < candidates.length; i++) {
      const url = normalizeMediaUrl(candidates[i]);

      if (url && looksLikeImageUrl(url)) {
        return url;
      }
    }

    return "";
  }

  function externalLinkForStory(story) {
    if (!story) {
      return "";
    }

    const candidates = [
      story.externalLink,
      story.external_link,
      story.linkUrl,
      story.fileOrLink
    ];

    const imageUrl = imageUrlForStory(story);

    for (let i = 0; i < candidates.length; i++) {
      const url = normalizeMediaUrl(candidates[i]);

      if (!url || url === imageUrl) {
        continue;
      }

      if (!looksLikeImageUrl(url) && !looksLikeAudioUrl(url)) {
        return url;
      }
    }

    return "";
  }

  function hasPersianText(value) {
    return /[\u0600-\u06FF]/.test(String(value || ""));
  }

  function storyLabel(story) {
    const city = clean(story && story.originCity) || "Unknown city";
    const year = clean(story && story.yearLeft) || "—";

    return `${city} — ${year}`;
  }

  function hasAnyMedia(story) {
    return Boolean(
      bestTextForStory(story) ||
      imageUrlForStory(story) ||
      externalLinkForStory(story)
    );
  }

  function ensurePanel() {
    let panel = document.getElementById(PANEL_ID);

    if (panel) {
      return panel;
    }

    panel = document.createElement("aside");
    panel.id = PANEL_ID;
    panel.className = "mg-unified-media-panel";
    panel.setAttribute("aria-hidden", "true");
    panel.setAttribute("aria-label", "Submitted fragment");

    panel.innerHTML = `
      <div class="mg-unified-media-inner">
        <header class="mg-unified-media-header">
          <div>
            <p class="mg-unified-media-eyebrow">Submitted fragment</p>
            <h3 class="mg-unified-media-title">Fragment</h3>
          </div>

          <button
            class="mg-unified-media-close"
            type="button"
            aria-label="Close submitted fragment"
            title="Close"
          >×</button>
        </header>

        <div class="mg-unified-media-body"></div>
      </div>
    `;

    panel.addEventListener(
      "pointerdown",
      event => {
        event.stopPropagation();
      },
      true
    );

    panel.addEventListener(
      "click",
      event => {
        const closeButton = event.target.closest(".mg-unified-media-close");

        if (closeButton) {
          event.preventDefault();
          hidePanel();
          return;
        }

        const imageButton = event.target.closest(".mg-unified-media-image-button");

        if (imageButton) {
          event.preventDefault();
          event.stopPropagation();

          const url = imageButton.dataset.imageUrl || "";
          const title = imageButton.dataset.imageTitle || "Submitted image";

          openImageModal(url, title);
          return;
        }

        event.stopPropagation();
      },
      true
    );

    document.body.appendChild(panel);

    return panel;
  }

  function ensureImageModal() {
    let modal = document.getElementById(MODAL_ID);

    if (modal) {
      return modal;
    }

    modal = document.createElement("div");
    modal.id = MODAL_ID;
    modal.className = "mg-unified-image-modal";
    modal.setAttribute("aria-hidden", "true");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-label", "Submitted image viewer");

    modal.innerHTML = `
      <div class="mg-unified-image-modal-backdrop"></div>

      <div class="mg-unified-image-modal-inner">
        <button
          class="mg-unified-image-modal-close"
          type="button"
          aria-label="Close image"
          title="Close"
        >×</button>

        <img class="mg-unified-image-modal-img" alt="Submitted image fragment" />
      </div>
    `;

    modal.addEventListener(
      "click",
      event => {
        if (
          event.target.closest(".mg-unified-image-modal-close") ||
          event.target.classList.contains("mg-unified-image-modal-backdrop")
        ) {
          event.preventDefault();
          closeImageModal();
        }
      },
      true
    );

    document.body.appendChild(modal);

    return modal;
  }

  function openImageModal(url, title) {
    const safeUrl = normalizeMediaUrl(url);

    if (!safeUrl) {
      return;
    }

    const modal = ensureImageModal();
    const image = modal.querySelector(".mg-unified-image-modal-img");

    if (image) {
      image.src = safeUrl;
      image.alt = title || "Submitted image fragment";
    }

    modal.classList.add("visible");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("mg-unified-image-modal-open");
  }

  function closeImageModal() {
    const modal = document.getElementById(MODAL_ID);

    if (!modal) {
      return;
    }

    modal.classList.remove("visible");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("mg-unified-image-modal-open");
  }

  function hideOldMediaPanels() {
    /*
      Hide old/duplicate post-audio and reveal systems.
      We are replacing them with one unified panel.
    */
    [
      "story-extra-reveal-button",
      "story-extra-link-panel",
      "story-post-audio-fragment-panel"
    ].forEach(id => {
      const element = document.getElementById(id);

      if (element) {
        element.classList.remove("visible");
        element.setAttribute("aria-hidden", "true");
      }
    });

    const oldTextPanel = document.getElementById("story-text-panel");

    if (oldTextPanel) {
      oldTextPanel.classList.remove("visible", "full-mode", "finished", "dissolved");
    }
  }

  function buildPanelHtml(story) {
    const text = bestTextForStory(story);
    const imageUrl = imageUrlForStory(story);
    const externalLink = externalLinkForStory(story);
    const title = storyLabel(story);

    const parts = [];

    if (imageUrl) {
      parts.push(`
        <section class="mg-unified-media-section mg-unified-media-image-section">
          <button
            class="mg-unified-media-image-button"
            type="button"
            data-image-url="${escapeHtml(imageUrl)}"
            data-image-title="${escapeHtml(title)}"
            aria-label="Open image larger"
          >
            <img
              class="mg-unified-media-image"
              src="${escapeHtml(imageUrl)}"
              alt="${escapeHtml(title)} image fragment"
              onerror="this.closest('.mg-unified-media-image-section').classList.add('image-failed')"
            />
          </button>

          <p class="mg-unified-media-image-hint">Click image to enlarge</p>
        </section>
      `);
    }

    if (text) {
      const isFa = hasPersianText(text);

      parts.push(`
        <section class="mg-unified-media-section mg-unified-media-text-section">
          <div
            class="mg-unified-media-text ${isFa ? "mg-unified-media-text-fa" : ""}"
            ${isFa ? 'dir="rtl" lang="fa"' : 'dir="auto"'}
          >${escapeHtml(text)}</div>
        </section>
      `);
    }

    if (externalLink) {
      parts.push(`
        <section class="mg-unified-media-section mg-unified-media-link-section">
          <p class="mg-unified-media-link-intro">
            This contribution also includes an outside fragment.
          </p>

          <a
            class="mg-unified-media-link"
            href="${escapeHtml(externalLink)}"
            target="_blank"
            rel="noopener noreferrer"
          >
            Open submitted link
          </a>
        </section>
      `);
    }

    return parts.join("");
  }

  function showPanel(story) {
    if (!story || !hasAnyMedia(story)) {
      hidePanel();
      return;
    }

    const panel = ensurePanel();
    const title = panel.querySelector(".mg-unified-media-title");
    const body = panel.querySelector(".mg-unified-media-body");

    if (title) {
      title.textContent = storyLabel(story);
    }

    if (body) {
      body.innerHTML = buildPanelHtml(story);
    }

    panel.dataset.storyId = String(story.id || "");
    panel.classList.add("visible");
    panel.setAttribute("aria-hidden", "false");

    hideOldMediaPanels();

    /*
      Hide old systems again shortly after, because older patches may reopen them
      after audio-ended or render events.
    */
    window.setTimeout(hideOldMediaPanels, 80);
    window.setTimeout(hideOldMediaPanels, 350);
    window.setTimeout(hideOldMediaPanels, 900);
  }

  function hidePanel() {
    const panel = document.getElementById(PANEL_ID);

    if (panel) {
      panel.classList.remove("visible");
      panel.setAttribute("aria-hidden", "true");
      panel.dataset.storyId = "";
    }

    closeImageModal();
  }

  function schedulePanelAfterAudio(story) {
    if (!story || !hasAnyMedia(story)) {
      return;
    }

    window.setTimeout(() => {
      if (!activeStory || String(activeStory.id || "") !== String(story.id || "")) {
        return;
      }

      if (typeof journeyPhase !== "undefined" && journeyPhase !== "arrived") {
        /*
          If audio ends slightly before the final visual phase declares itself,
          wait a moment.
        */
        window.setTimeout(() => schedulePanelAfterAudio(story), 350);
        return;
      }

      showPanel(story);
    }, 180);
  }

  /*
    Capture extra CSV columns from PublicMapData if Package 1 added them.
  */
  if (typeof rowToStory === "function" && !window.__mgUnifiedMediaRowWrapped) {
    const originalRowToStory = rowToStory;

    rowToStory = function unifiedMediaRowToStory(row) {
      const story = originalRowToStory(row);

      if (!story) {
        return story;
      }

      story.textFragment = clean(row.text_fragment || row.submitted_text || row.full_text || "");
      story.submittedText = story.textFragment || story.quote || "";
      story.imageUrl = normalizeMediaUrl(row.image_url || row.photo_url || "");
      story.externalLink = normalizeMediaUrl(row.external_link || row.link_url || "");

      return story;
    };

    window.__mgUnifiedMediaRowWrapped = true;
  }

  /*
    Reset/hide on new journeys.
  */
  if (typeof selectStory === "function" && !window.__mgUnifiedMediaSelectWrapped) {
    const originalSelectStory = selectStory;

    selectStory = function unifiedMediaSelectStory(story, options = {}) {
      hidePanel();
      hideOldMediaPanels();

      return originalSelectStory.call(this, story, options);
    };

    window.__mgUnifiedMediaSelectWrapped = true;
  }

  if (typeof playStoryAudio === "function" && !window.__mgUnifiedMediaPlayWrapped) {
    const originalPlayStoryAudio = playStoryAudio;

    playStoryAudio = function unifiedMediaPlayStoryAudio(story) {
      hidePanel();
      hideOldMediaPanels();

      return originalPlayStoryAudio.apply(this, arguments);
    };

    window.__mgUnifiedMediaPlayWrapped = true;
  }

  if (typeof resetView === "function" && !window.__mgUnifiedMediaResetWrapped) {
    const originalResetView = resetView;

    resetView = function unifiedMediaResetView() {
      hidePanel();
      hideOldMediaPanels();

      return originalResetView.apply(this, arguments);
    };

    window.__mgUnifiedMediaResetWrapped = true;
  }

  if (typeof goToIranView === "function" && !window.__mgUnifiedMediaIranWrapped) {
    const originalGoToIranView = goToIranView;

    goToIranView = function unifiedMediaIranView() {
      hidePanel();
      hideOldMediaPanels();

      return originalGoToIranView.apply(this, arguments);
    };

    window.__mgUnifiedMediaIranWrapped = true;
  }

  /*
    Open unified panel after audio ends.
  */
  if (audio && typeof audio.addEventListener === "function") {
    audio.addEventListener("ended", () => {
      const story = activeStory;

      window.setTimeout(() => {
        schedulePanelAfterAudio(story);
      }, 120);
    });
  }

  /*
    Safety: if an older image link appears anywhere, prevent image links
    from opening a new tab and open them in the in-page modal instead.
  */
  document.addEventListener(
    "click",
    event => {
      const oldImageAnchor = event.target.closest &&
        event.target.closest(".story-post-audio-image-link, a.attachment-link");

      if (!oldImageAnchor) {
        return;
      }

      const href = normalizeMediaUrl(oldImageAnchor.getAttribute("href"));

      if (!href || !looksLikeImageUrl(href)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      openImageModal(href, storyLabel(activeStory || {}));
    },
    true
  );

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      hidePanel();
      closeImageModal();
    }
  });
})();
/* ==========================================================
   ARRIVAL LABEL TIMING — SHOW ONLY AFTER FULL ARRIVAL

   Goal:
   - Hide origin/Iran labels during line-arrived, line-fade, and home-zoom.
   - Show Shiraz/Bushehr/etc. label only after journeyPhase is fully "arrived".
   - Applies to every future submission.
   - Keeps takeoff/outside-city label behavior untouched.

   Paste at the VERY BOTTOM of script.js.
   ========================================================== */

(function showIranArrivalLabelOnlyAfterFullArrival() {
  if (window.__mgArrivalLabelOnlyAfterFullArrivalReady) {
    return;
  }

  window.__mgArrivalLabelOnlyAfterFullArrivalReady = true;

  const EARLY_ARRIVAL_PHASES = [
    "line-arrived",
    "line-fade",
    "home-zoom"
  ];

  function isEarlyArrivalPhase() {
    return Boolean(
      activeStory &&
      EARLY_ARRIVAL_PHASES.indexOf(String(journeyPhase || "")) !== -1
    );
  }

  function textIncludesActiveOriginLabel(element) {
    if (!element || !activeStory) {
      return false;
    }

    const text = String(element.textContent || "");
    const originCity = String(activeStory.originCity || "").trim();
    const year = String(activeStory.yearLeft || "").trim();

    if (!originCity) {
      return false;
    }

    /*
      Backup detector:
      catches any home label even if an older/newer patch forgets to add
      the expected home-label class.
    */
    if (year) {
      return text.indexOf(originCity) !== -1 && text.indexOf(year) !== -1;
    }

    return text.indexOf(originCity) !== -1;
  }

  function removeEarlyIranArrivalLabels() {
    if (
      !isEarlyArrivalPhase() ||
      typeof labelGroup === "undefined" ||
      !labelGroup ||
      typeof labelGroup.selectAll !== "function"
    ) {
      return;
    }

    labelGroup
      .selectAll("text")
      .filter(function removeOnlyHomeArrivalLabels() {
        const className = String(this.getAttribute("class") || "");

        /*
          These are the classes used by the arrival/origin labels,
          including the later final repair label class.
        */
        if (
          /\bhome-label\b/.test(className) ||
          /\bfinal-home-label\b/.test(className) ||
          /\barrival-label\b/.test(className)
        ) {
          return true;
        }

        return textIncludesActiveOriginLabel(this);
      })
      .interrupt()
      .remove();
  }

  function cleanupEarlyArrivalLabelsNowAndNextFrame() {
    removeEarlyIranArrivalLabels();

    requestAnimationFrame(() => {
      removeEarlyIranArrivalLabels();
    });
  }

  /*
    Wrap renderLabels so whenever older label logic tries to draw the
    Iran/origin label too early, we remove it immediately in the same frame.
  */
  if (
    typeof renderLabels === "function" &&
    !window.__mgArrivalLabelRenderLabelsWrapped
  ) {
    const previousRenderLabels = renderLabels;

    renderLabels = function arrivalLabelOnlyAfterFullArrivalRenderLabels() {
      const result = previousRenderLabels.apply(this, arguments);

      cleanupEarlyArrivalLabelsNowAndNextFrame();

      return result;
    };

    window.__mgArrivalLabelRenderLabelsWrapped = true;
  }

  /*
    Wrap render too, because several late patches draw labels inside render
    or immediately after render. This makes the cleanup the final word.
  */
  if (
    typeof render === "function" &&
    !window.__mgArrivalLabelRenderWrapped
  ) {
    const previousRender = render;

    render = function arrivalLabelOnlyAfterFullArrivalRender() {
      const result = previousRender.apply(this, arguments);

      cleanupEarlyArrivalLabelsNowAndNextFrame();

      return result;
    };

    window.__mgArrivalLabelRenderWrapped = true;
  }

  /*
    Extra safety while the map is animating:
    if any transition leaves an early home label behind, remove it.
  */
  window.setInterval(() => {
    removeEarlyIranArrivalLabels();
  }, 120);
})();
/* ==========================================================
   UNIFIED MEDIA PANEL — LANGUAGE TOGGLE + STABLE EXPAND ARROW

   Fixes:
   - Adds English/Persian switch controls to the right-side
     text/image/link fragment panel.
   - Adds a clickable downward arrow to the right-side panel.
   - The arrow expands/collapses the panel.
   - Applies to future submissions too.
   - Does not touch the left invitation box logic.

   Paste at the VERY BOTTOM of script.js.
   ========================================================== */

// enhanceUnifiedMediaPanelReadingControls: guard-disabled dead block removed during cleanup (guard pre-sets __mgUnifiedMediaReadingControlsReady=true, so this IIFE always early-returned)
/* ==========================================================
   UNIFIED MEDIA PANEL — ORDER LINK / IMAGE / TEXT

   Goal:
   - In the right-side submitted fragment panel, always show:
       1. submitted link
       2. image
       3. text
   - Move the English / فارسی switch to the top of the text section,
     not the top of the whole panel.
   - Applies to all future submissions.
   - Does not change sheet logic.

   Paste at the VERY BOTTOM of script.js.
   ========================================================== */

// orderUnifiedMediaPanelLinkImageText: superseded/guard-disabled block removed during cleanup (guard pre-sets __mgUnifiedMediaOrderLinkImageTextReady=true, so this IIFE always early-returned)
/* ==========================================================
   BLINKING-I INVITATION — FINAL PERSIAN LETTER REPLACEMENT

   Goal:
   - Replace the Persian invitation text with the final DOCX version.
   - Preserve bold words and section layout.
   - Keep the existing English / فارسی toggle behavior.
   - Do not disturb the existing compact/expand arrow logic.

   Paste at the VERY BOTTOM of script.js.
   ========================================================== */

(function replaceBlinkingIInvitationWithFinalPersianLetter() {
  if (window.__mgFinalPersianInvitationLetterReady) {
    return;
  }

  window.__mgFinalPersianInvitationLetterReady = true;

  const FINAL_INVITATION_VERSION = "final-persian-letter-2026-06";

  const FINAL_FA_INVITATION_HTML = `
    <p
      class="title-memory-invitation-greeting"
      lang="fa"
      dir="rtl"
    >هموطن عزیزم،</p>

    <p
      class="title-memory-invitation-paragraph"
      lang="fa"
      dir="rtl"
    ><strong>«جغرافیاهای گمشده»</strong> نام یک پروژه‌ی هنری-اجتماعی است درباره‌ی زندگی‌هایی که در سایه‌ی جمهوری اسلامی ناتمام ماندند؛ درباره‌ی آزادی‌هایی که سلب شدند، فرصت‌هایی که سوختند، و نسخه‌هایی از ما که مجال ظهور و بروز پیدا نکردند و در نتیجه، ایرانی که میتوانست وجود داشته باشد و ندارد. این پروژه تلاشی است برای پیدا کردن زبانی برای بازگو کردن حرف‌هایی که سال‌ها در گلو مانده‌اند؛ حرف‌هایی که اغلب نه جایی برای گفتنشان بوده، نه زمانی برای شنیده‌شدنشان، و نه مخاطبی که بتواند رنج و حسرتِ پنهان در آن‌ها را بفهمد.</p>

    <p
      class="title-memory-invitation-section-title"
      lang="fa"
      dir="rtl"
    ><strong>از هجران</strong></p>

    <p
      class="title-memory-invitation-paragraph"
      lang="fa"
      dir="rtl"
    >ما ایرانیانِ دورمانده از وطن، هر کدام به شکلی با وزن سنگین این اندوه زندگی کرده‌ایم. چرا که <strong>تجربه‌ی زیستن در دوران جمهوری اسلامی فقط تجربه‌ی سرکوب در سیاست رسمی نیست؛ بلکه تجربه‌ی روزمره‌ی سرکوب خودِ زندگیست</strong>: محدودیت بر بدن، زبان، عشق، شادی، سوگواری، موسیقی، پوشش، شادنوشی، آموزش، مذهب، عقیده، کار، سفر، ارتباط با دنیا و آینده. بسیاری از چیزهایی که برای یک زندگی عادی بدیهی به نظر می‌رسند، برای ما یا ممنوع بودند، یا مشروط، یا خطرناک، یا همراه با ترس و شرم و خودسانسوری دائمی.</p>

    <p
      class="title-memory-invitation-paragraph"
      lang="fa"
      dir="rtl"
    ><strong>دلتنگی</strong> فقط یاد یک کوچه، خانه، شهر یا خاطره‌ی شیرین نیست. گاهی دلتنگی نام چیزی است که هرگز فرصت تجربه‌اش را پیدا نکردیم؛ نام آزادی‌هایی که از کودکی، نوجوانی و جوانی ما حذف شدند؛ نام فرصت‌هایی که سوختند؛ نام زندگیهایی که می‌توانستند شکل بگیرند و نگرفتند. <strong>ما دلتنگ آزادیهایی هستیم که از ما دریغ شد</strong>.</p>

    <p
      class="title-memory-invitation-paragraph"
      lang="fa"
      dir="rtl"
    >«جغرافیاهای گمشده» دعوتی است برای بازگشتن و واکاوی این لایه‌ها؛ برای ترسیم دوباره‌ی نقشه‌ی چیزهایی که از دست رفتند، اما ردشان یا شوق و میلشان هنوز در تن، حافظه، زبان، خواب‌های ما، صدا، بو، عکس، موسیقی، لباس، و اشیای همراه ما مانده است.</p>

    <p
      class="title-memory-invitation-section-title"
      lang="fa"
      dir="rtl"
    ><strong>از فقدان</strong></p>

    <p
      class="title-memory-invitation-paragraph"
      lang="fa"
      dir="rtl"
    >پیشنهاد من فکر کردن به این سه محور است:</p>

    <p
      class="title-memory-invitation-paragraph"
      lang="fa"
      dir="rtl"
    >نخست، به گذشته: چه چیزهایی از دست رفتند و چه فرصتهای یگانه ای هرگز به تجربه‌ی زندگی تبدیل نشدند؟ چه آزادی‌هایی، چه امکان‌هایی، چه لحظه‌هایی زمانشان گذشت؟ برای من، یکی از این فقدان‌ها حتی به کودکی برمی‌گردد: حسرت تجربه‌ای ساده، مثل اینکه بتوانم با خواهرم به یک مدرسه بروم.</p>

    <p
      class="title-memory-invitation-paragraph"
      lang="fa"
      dir="rtl"
    >دوم، به اکنون: چه مکانی، چه آدمی، چه تجربه‌ی اجتماعی، چه حس آشنا و دوست‌داشتنی، چه لحظه‌ی صمیمی و دلگرم‌کننده‌ای امروز از دسترس تو دور مانده است؟ گاهی دلتنگی و حس از دست دادن یعنی ناتوانی از حضور؛ مثلاً برای من اینکه حتی نتوانم بر مزار رفیق عزیزی حاضر شوم و خداحافظی کنم.</p>

    <p
      class="title-memory-invitation-paragraph"
      lang="fa"
      dir="rtl"
    >سوم، به آینده: اگر ایران آزاد بود، اگر زندگی ما می‌توانست امتدادی طبیعی از تاریخ، زبان و سرزمین خودمان باشد، چه چیزهایی ممکن بود؟ زندگی شخصی ما چه شکلی می‌گرفت؟ وطن ما چه چیزی می‌توانست بشود اگر نیروی جوانی، دانش، عشق، خلاقیت و میل به آبادانی که در جان تک تک ما شعله میکشد از آن دریغ نمی‌شد؟</p>

    <p
      class="title-memory-invitation-paragraph"
      lang="fa"
      dir="rtl"
    >این سه محور فقط پیشنهادی‌اند. مشارکت تو می‌تواند به یکی از آن‌ها، به دو تا، یا به هر سه بپردازد؛ و البته می‌تواند سراغ چیزهایی برود که من حتی تصورشان را هم نمی‌کنم، اما بخشی از تجربه‌ی زندگی تو هستند.</p>

    <p
      class="title-memory-invitation-section-title"
      lang="fa"
      dir="rtl"
    ><strong>ردی که به جا میگذاریم</strong></p>

    <p
      class="title-memory-invitation-paragraph"
      lang="fa"
      dir="rtl"
    >نقطه ای که به نقشه جمعی ما اضافه میکنی، می‌تواند یک فایل صوتی، عکس، نقاشی، متن، شعر، جمله، تصویر، خاطره، یا حتی لینکی به یک موسیقی یا ویدیو باشد؛ چیزی که حس می‌کنی به بهترین شکل احساس تو را بیان می‌کند. نقطه تماس تو به ایران می‌تواند ترکیبی از این‌ها هم باشد، یا می‌توانی هر چند بار که خواستی فرم را پر کنی و به موضوعات متفاوتی بپردازی. لازم نیست کامل، مرتب، ادبی یا آماده باشد. مکث، تردید، سکوت، بغض، ناتمام‌ماندن و تغییر زبان هم می‌توانند بخشی از مشارکت تو باشند. مشارکت تو می‌تواند بدون کوچک‌ترین نشانه یا اشاره‌ای به هویت واقعی‌ات ثبت شود؛ مثلاً با یک اسم مستعار، یا حتی بدون اینکه نشانی ایمیلت را حتی با من در میان بگذاری. <strong>در پایان،</strong> اگر خواستی، می‌توانی نشانی ایمیلت را ثبت کنی و انتخاب کنی که آیا مایلی در صورت نیاز با تو در تماس باشم یا نه؛ چه برای همین پروژه، چه برای یک پروژه‌ی تحقیق دانشگاهی احتمالی در آینده. اگر این دعوت را به کسی برسانی که فکر می‌کنی چیزی از این جغرافیای گمشده را با خود حمل می‌کند، بسیار سپاسگزار خواهم بود.</p>
  `;

  function getQuoteBox() {
    return document.getElementById("title-memory-quote");
  }

  function getPersianInner() {
    return document.querySelector(
      "#title-memory-quote .title-memory-invitation-inner-fa"
    );
  }

  function isPersianMode(box) {
    if (!box) {
      return false;
    }

    return (
      box.dataset.language === "fa" ||
      box.getAttribute("lang") === "fa" ||
      box.getAttribute("dir") === "rtl"
    );
  }

  function replacePersianInvitationIfNeeded() {
    const box = getQuoteBox();

    if (!box || !isPersianMode(box)) {
      return;
    }

    const inner = getPersianInner();

    if (!inner) {
      return;
    }

    if (inner.dataset.finalInvitationVersion === FINAL_INVITATION_VERSION) {
      return;
    }

    inner.innerHTML = FINAL_FA_INVITATION_HTML;
    inner.dataset.finalInvitationVersion = FINAL_INVITATION_VERSION;

    inner.classList.add("title-memory-invitation-final-letter");
    box.classList.add("title-memory-quote-final-letter");

    const scroll = document.getElementById("title-memory-invitation-scroll");

    if (scroll) {
      scroll.scrollTop = 0;
    }
  }

  /*
    The original bilingual system rebuilds the box whenever the language
    button is clicked. This light interval quietly restores the final
    Persian version whenever the box returns to Persian mode.
    It does not observe style/class changes, so it avoids the earlier
    infinite observer-loop problem.
  */
  window.setInterval(replacePersianInvitationIfNeeded, 350);

  document.addEventListener(
    "click",
    event => {
      if (
        event.target &&
        event.target.closest &&
        event.target.closest("#title-memory-language-toggle")
      ) {
        window.setTimeout(replacePersianInvitationIfNeeded, 40);
        window.setTimeout(replacePersianInvitationIfNeeded, 220);
      }
    },
    true
  );

  window.setTimeout(replacePersianInvitationIfNeeded, 300);
  window.setTimeout(replacePersianInvitationIfNeeded, 1000);
  window.setTimeout(replacePersianInvitationIfNeeded, 1800);
})();
/* ==========================================================
   MEDIA PANEL CLICK RELIABILITY FIX

   Fixes:
   - Clicking submitted image opens an in-page enlarged image modal.
   - Clicking “Open submitted link” opens the submitted external link.
   - Works for future submissions, not just the current Karaj test.
   - Supports image_url, external_link, file_or_link, and older panel systems.
   - Repairs missing href/data-url values after older patches rebuild the panel.

   Paste at the VERY BOTTOM of script.js.
   ========================================================== */

// mediaPanelClickReliabilityFix: guard-disabled dead block removed during cleanup (guard pre-sets __mgMediaPanelClickReliabilityReady=true, so this IIFE always early-returned)
/* ==========================================================
   FINAL MEDIA CLICK HOTSPOTS — IMAGE + SUBMITTED LINK

   Why this exists:
   Some older map/panel layers can visually show the image/link while
   swallowing clicks. This patch does not trust the existing click
   handlers. It creates invisible fixed-position hotspots above the
   visible image and visible "Open submitted link" button.

   Fixes:
   - Image click opens an in-page enlarged image modal.
   - Submitted link opens in a new tab.
   - Works for future submissions using image_url, external_link,
     file_or_link, or Tally storage URLs.
   - Repairs loaded story objects from PublicMapData when needed.

   Paste at the VERY BOTTOM of script.js.
   ========================================================== */

// finalMediaClickHotspots: guard-disabled dead block removed during cleanup (guard pre-sets __mgFinalMediaClickHotspotsReady=true, so this IIFE always early-returned)
/* ==========================================================
   ABOUT PANEL — FINAL TEXT AFTER SOCIAL PRACTICE CUNY

   Goal:
   - Keep everything before/through:
     “developed during his 2025–26 Faculty Fellowship with Social Practice CUNY.”
   - Keep Shokran Rahiminezhad hyperlink exactly as styled now.
   - Replace only the text that comes after that first credit paragraph.
   - Do not touch styles.css.

   Paste at the VERY BOTTOM of script.js.
   ========================================================== */

(function replaceAboutTextAfterSocialPracticeCuny() {
  if (window.__mgFinalAboutTextAfterCunyReady) {
    return;
  }

  window.__mgFinalAboutTextAfterCunyReady = true;

  const VERSION = "final-about-after-cuny-2026-06";

  const FALLBACK_CREDIT_PARAGRAPH_HTML = `
    <p>
      <em>Missing Geographies</em> is a socially engaged art project by
      <a
        class="mg-about-credit-link"
        href="https://socialpracticecuny.org/fellows/25-26/"
        target="_blank"
        rel="noopener noreferrer"
      >Shokran Rahiminezhad</a>,
      developed during his 2025–26 Faculty Fellowship with Social Practice CUNY.
    </p>
  `;

  const FINAL_ABOUT_TAIL_HTML = `
    <p data-mg-final-about-tail="${VERSION}">
      The project gathers voices, texts, images, videos, and other traces from Iranians in diaspora. Each contribution begins somewhere outside Iran and calls back toward a city in Iran, awakening a memory, a story, a feeling, a lived experience, or a desire for a life that never had the chance to unfold but still echoes. Together, these fragments make a living map of what remains after leaving and what distance could not erase.
    </p>
  `;

  function getAboutBody() {
    return document.querySelector(
      "#mg-dropdown-about-panel .mg-dropdown-about-body, .mg-dropdown-about-body"
    );
  }

  function isCreditParagraph(paragraph) {
    if (!paragraph) {
      return false;
    }

    const text = String(paragraph.textContent || "")
      .replace(/\s+/g, " ")
      .trim();

    return (
      text.includes("Shokran Rahiminezhad") &&
      text.includes("Social Practice CUNY")
    );
  }

  function replaceAboutText() {
    const body = getAboutBody();

    if (!body) {
      return false;
    }

    const alreadyApplied = body.querySelector(
      `[data-mg-final-about-tail="${VERSION}"]`
    );

    if (alreadyApplied) {
      return true;
    }

    const creditParagraph =
      Array.from(body.querySelectorAll("p")).find(isCreditParagraph);

    const creditParagraphHtml = creditParagraph
      ? creditParagraph.outerHTML
      : FALLBACK_CREDIT_PARAGRAPH_HTML;

    body.innerHTML = `
      ${creditParagraphHtml}
      ${FINAL_ABOUT_TAIL_HTML}
    `;

    body.dataset.mgFinalAboutTextVersion = VERSION;

    return true;
  }

  function tryReplaceSeveralTimes() {
    let attempts = 0;

    const timer = window.setInterval(() => {
      attempts += 1;

      const applied = replaceAboutText();

      if (applied || attempts > 40) {
        window.clearInterval(timer);
      }
    }, 250);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", tryReplaceSeveralTimes);
  } else {
    tryReplaceSeveralTimes();
  }

  /*
    If the About panel is created or rebuilt after the page loads,
    this catches it without disturbing the rest of the map.
  */
  window.setTimeout(replaceAboutText, 500);
  window.setTimeout(replaceAboutText, 1200);
  window.setTimeout(replaceAboutText, 2400);

  document.addEventListener(
    "click",
    event => {
      const aboutTrigger =
        event.target &&
        event.target.closest &&
        event.target.closest(".mg-dropdown-about-trigger, .mg-about-trigger");

      if (!aboutTrigger) {
        return;
      }

      window.setTimeout(replaceAboutText, 60);
      window.setTimeout(replaceAboutText, 240);
    },
    true
  );
})();
/* ==========================================================
   MOBILE AUDIO + SUBTITLE GATE

   Goal:
   - Fix mobile iOS/Android cases where the map travels but
     audio/subtitles do not start.
   - Preserve desktop behavior when autoplay already works.
   - Prime audio during the user's original tap when possible.
   - If mobile browser still blocks playback, show a small
     "Tap to hear this call" button after arrival.
   - Start subtitles together with audio.

   Paste at the VERY BOTTOM of script.js.
   ========================================================== */

(function installMobileAudioSubtitleGate() {
  if (window.__mgMobileAudioSubtitleGateReady) {
    return;
  }

  window.__mgMobileAudioSubtitleGateReady = true;

  const GATE_ID = "mg-mobile-audio-gate";

  const state = {
    primeToken: 0,
    realPlaybackToken: 0,
    priming: false,
    currentStoryId: "",
    mobileSubtitleTimer: null,
    lastBlockedStoryId: ""
  };

  function getAudioElement() {
    if (typeof audio !== "undefined" && audio) {
      return audio;
    }

    return document.getElementById("story-audio");
  }

  function clean(value) {
    return String(value || "").trim();
  }

  function isMobileAudioRisk() {
    const coarsePointer =
      window.matchMedia &&
      (
        window.matchMedia("(hover: none)").matches ||
        window.matchMedia("(pointer: coarse)").matches
      );

    const ua = navigator.userAgent || "";

    return Boolean(
      coarsePointer ||
      /iPhone|iPad|iPod|Android|Mobile|Silk|Kindle/i.test(ua)
    );
  }

  function storyStillActive(story) {
    return Boolean(
      story &&
      typeof activeStory !== "undefined" &&
      activeStory &&
      clean(activeStory.id) === clean(story.id)
    );
  }

  function storyHasAudio(story) {
    return Boolean(
      story &&
      clean(story.audio) &&
      !/^about:blank$/i.test(clean(story.audio))
    );
  }

  function ensureAudioAttributes() {
    const audioElement = getAudioElement();

    if (!audioElement) {
      return null;
    }

    audioElement.preload = "auto";
    audioElement.setAttribute("preload", "auto");

    /*
      Mostly meaningful for video, but harmless on audio and helpful
      for some WebKit media policy paths.
    */
    audioElement.setAttribute("playsinline", "");
    audioElement.setAttribute("webkit-playsinline", "");

    return audioElement;
  }

  function resumeWebAudioContextIfNeeded() {
    try {
      if (
        typeof getAudioContext === "function"
      ) {
        const context = getAudioContext();

        if (context && context.state === "suspended") {
          context.resume().catch(() => {});
        }
      }
    } catch (error) {}
  }

  function setAudioSourceForStory(story) {
    const audioElement = ensureAudioAttributes();

    if (!audioElement || !storyHasAudio(story)) {
      return null;
    }

    const nextSrc = clean(story.audio);
    const currentSrc =
      clean(audioElement.currentSrc) ||
      clean(audioElement.getAttribute("src")) ||
      clean(audioElement.src);

    if (!currentSrc || currentSrc !== nextSrc) {
      audioElement.src = nextSrc;

      try {
        audioElement.load();
      } catch (error) {}
    }

    return audioElement;
  }

  function primeAudioDuringUserGesture(story) {
    if (!isMobileAudioRisk() || !storyHasAudio(story)) {
      return;
    }

    const audioElement = setAudioSourceForStory(story);

    if (!audioElement || state.priming) {
      return;
    }

    resumeWebAudioContextIfNeeded();

    const token = ++state.primeToken;
    const realTokenAtStart = state.realPlaybackToken;

    const previousMuted = audioElement.muted;
    const previousVolume = audioElement.volume;

    state.priming = true;
    state.currentStoryId = clean(story.id);

    /*
      The muted micro-play attempts to bless/unlock the media element
      inside the original tap. It should not be audible.
    */
    audioElement.muted = true;
    audioElement.volume = 0;

    let playPromise = null;

    try {
      playPromise = audioElement.play();
    } catch (error) {
      audioElement.muted = previousMuted;
      audioElement.volume = previousVolume;
      state.priming = false;
      return;
    }

    const finishPrime = () => {
      const realPlaybackStarted =
        state.realPlaybackToken !== realTokenAtStart;

      if (
        token === state.primeToken &&
        !realPlaybackStarted
      ) {
        try {
          audioElement.pause();
        } catch (error) {}

        try {
          audioElement.currentTime = 0;
        } catch (error) {}

        audioElement.muted = previousMuted;
        audioElement.volume =
          Number.isFinite(previousVolume) && previousVolume > 0
            ? previousVolume
            : 1;
      }

      state.priming = false;
    };

    if (playPromise && typeof playPromise.then === "function") {
      playPromise
        .then(() => {
          finishPrime();
        })
        .catch(() => {
          audioElement.muted = previousMuted;
          audioElement.volume =
            Number.isFinite(previousVolume) && previousVolume > 0
              ? previousVolume
              : 1;

          state.priming = false;
        });

      /*
        Safety fallback in case Safari keeps the promise pending.
      */
      window.setTimeout(() => {
        if (state.priming && token === state.primeToken) {
          finishPrime();
        }
      }, 1400);
    } else {
      finishPrime();
    }
  }

  function ensureGate() {
    let gate = document.getElementById(GATE_ID);

    if (gate) {
      return gate;
    }

    gate = document.createElement("div");
    gate.id = GATE_ID;
    gate.className = "mg-mobile-audio-gate";
    gate.setAttribute("aria-hidden", "true");

    gate.innerHTML = `
      <button
        class="mg-mobile-audio-gate-button"
        type="button"
        aria-label="Start audio and subtitles"
      >
        <span class="mg-mobile-audio-gate-pulse" aria-hidden="true"></span>
        <span class="mg-mobile-audio-gate-main">Tap to hear this call</span>
        <span class="mg-mobile-audio-gate-sub">audio and subtitles</span>
      </button>
    `;

    gate.addEventListener(
      "pointerdown",
      event => {
        event.stopPropagation();
      },
      true
    );

    gate.addEventListener(
      "touchstart",
      event => {
        event.stopPropagation();
      },
      { capture: true, passive: true }
    );

    gate.addEventListener(
      "click",
      event => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        const story =
          typeof activeStory !== "undefined" && activeStory
            ? activeStory
            : null;

        playMobileStoryAudioFromUserTap(story);
      },
      true
    );

    document.body.appendChild(gate);

    return gate;
  }

  function showGate(story, reason) {
    if (!isMobileAudioRisk() || !storyHasAudio(story) || !storyStillActive(story)) {
      return;
    }

    const gate = ensureGate();

    gate.dataset.storyId = clean(story.id);
    gate.dataset.reason = clean(reason && reason.name) || "blocked";
    gate.classList.add("visible");
    gate.setAttribute("aria-hidden", "false");

    state.lastBlockedStoryId = clean(story.id);
  }

  function hideGate() {
    const gate = document.getElementById(GATE_ID);

    if (!gate) {
      return;
    }

    gate.classList.remove("visible");
    gate.setAttribute("aria-hidden", "true");
    gate.dataset.storyId = "";
  }

  function startMobileSubtitleTicker(story) {
    clearMobileSubtitleTicker();

    if (!story || !storyStillActive(story)) {
      return;
    }

    state.mobileSubtitleTimer = window.setInterval(() => {
      if (!storyStillActive(story)) {
        clearMobileSubtitleTicker();
        return;
      }

      if (
        typeof updateMapSubtitleText === "function" &&
        getAudioElement() &&
        !getAudioElement().paused
      ) {
        try {
          updateMapSubtitleText();
        } catch (error) {}
      }
    }, 120);
  }

  function clearMobileSubtitleTicker() {
    if (state.mobileSubtitleTimer) {
      window.clearInterval(state.mobileSubtitleTimer);
      state.mobileSubtitleTimer = null;
    }
  }

  async function playMobileStoryAudio(story, options = {}) {
    if (!storyHasAudio(story) || !storyStillActive(story)) {
      return false;
    }

    const audioElement = setAudioSourceForStory(story);

    if (!audioElement) {
      return false;
    }

    state.realPlaybackToken += 1;
    state.currentStoryId = clean(story.id);

    audioElement.muted = false;
    audioElement.volume = 1;

    /*
      If this is a real user tap, restart from the beginning unless
      the audio is already underway.
    */
    if (options.restartFromBeginning) {
      try {
        audioElement.currentTime = 0;
      } catch (error) {}
    }

    if (typeof startMapSubtitles === "function") {
      try {
        startMapSubtitles(story);
      } catch (error) {}
    }

    if (typeof updateMapSubtitleText === "function") {
      try {
        updateMapSubtitleText();
      } catch (error) {}
    }

    if (typeof refreshAudioDock === "function") {
      try {
        refreshAudioDock();
      } catch (error) {}
    }

    resumeWebAudioContextIfNeeded();

    try {
      const promise = audioElement.play();

      if (promise && typeof promise.then === "function") {
        await promise;
      }

      hideGate();
      startMobileSubtitleTicker(story);

      if (typeof refreshAudioDock === "function") {
        refreshAudioDock();
      }

      window.setTimeout(() => {
        if (storyStillActive(story) && typeof updateMapSubtitleText === "function") {
          updateMapSubtitleText();
        }
      }, 100);

      window.setTimeout(() => {
        if (storyStillActive(story) && typeof updateMapSubtitleText === "function") {
          updateMapSubtitleText();
        }
      }, 450);

      return true;
    } catch (error) {
      /*
        This is the key mobile fallback.
        If iOS/Android blocks script-started playback, ask for one direct tap.
      */
      showGate(story, error);
      return false;
    }
  }

  function playMobileStoryAudioFromUserTap(story) {
    playMobileStoryAudio(story, {
      restartFromBeginning: true,
      fromUserTap: true
    });
  }

  /*
    Wrap selectStory so mobile audio is primed inside the original tap/click.
    The original selectStory synchronously prepares the audio before its first
    await, so this still runs close enough to the initiating gesture.
  */
  if (
    typeof selectStory === "function" &&
    !window.__mgMobileAudioSelectStoryWrapped
  ) {
    const originalSelectStory = selectStory;

    selectStory = function mobileAudioSelectStory(story, options = {}) {
      hideGate();
      clearMobileSubtitleTicker();

      const result = originalSelectStory.call(this, story, options);

      if (isMobileAudioRisk() && storyHasAudio(story)) {
        primeAudioDuringUserGesture(story);
      }

      return result;
    };

    window.__mgMobileAudioSelectStoryWrapped = true;
  }

  /*
    Wrap playStoryAudio:
    - Desktop keeps the existing behavior.
    - Mobile checks whether playback actually began.
    - If blocked, it shows the tap gate.
  */
  if (
    typeof playStoryAudio === "function" &&
    !window.__mgMobileAudioPlayStoryWrapped
  ) {
    const originalPlayStoryAudio = playStoryAudio;

    playStoryAudio = function mobileAudioPlayStoryAudio(story) {
      const result = originalPlayStoryAudio.apply(this, arguments);

      if (!isMobileAudioRisk() || !storyHasAudio(story)) {
        return result;
      }

      /*
        Let the existing play attempt happen first. If it fails silently,
        this detects the paused state and repairs/shows gate.
      */
      window.setTimeout(() => {
        const audioElement = getAudioElement();

        if (
          storyStillActive(story) &&
          audioElement &&
          audioElement.paused
        ) {
          playMobileStoryAudio(story, {
            restartFromBeginning: true,
            fromUserTap: false
          });
        }
      }, 180);

      window.setTimeout(() => {
        const audioElement = getAudioElement();

        if (
          storyStillActive(story) &&
          audioElement &&
          audioElement.paused
        ) {
          showGate(story, { name: "MobilePlaybackBlocked" });
        }
      }, 850);

      return result;
    };

    window.__mgMobileAudioPlayStoryWrapped = true;
  }

  /*
    Keep the gate hidden whenever playback succeeds.
  */
  const audioElement = ensureAudioAttributes();

  if (audioElement && audioElement.dataset.mgMobileAudioGateBound !== "yes") {
    audioElement.dataset.mgMobileAudioGateBound = "yes";

    ["play", "playing"].forEach(eventName => {
      audioElement.addEventListener(eventName, () => {
        hideGate();

        if (
          typeof activeStory !== "undefined" &&
          activeStory
        ) {
          startMobileSubtitleTicker(activeStory);
        }
      });
    });

    ["pause", "ended", "emptied"].forEach(eventName => {
      audioElement.addEventListener(eventName, () => {
        if (eventName === "ended" || eventName === "emptied") {
          clearMobileSubtitleTicker();
        }
      });
    });
  }

  /*
    Any early touch on the map or story list can resume WebAudio and help
    mobile media permissions. This does not start the story audio by itself.
  */
  document.addEventListener(
    "pointerdown",
    event => {
      if (!isMobileAudioRisk()) {
        return;
      }

      const target = event.target;

      if (
        target &&
        target.closest &&
        target.closest(
          ".map-point, .story-button, .fixed-memory-cloud-item, .iran-scatter-cloud-item, .canvas-cloud-item"
        )
      ) {
        resumeWebAudioContextIfNeeded();

        if (
          typeof activeStory !== "undefined" &&
          activeStory &&
          storyHasAudio(activeStory)
        ) {
          primeAudioDuringUserGesture(activeStory);
        }
      }
    },
    true
  );

  /*
    If a user taps the new audio dock play button on mobile, make sure
    subtitles are attached too.
  */
  document.addEventListener(
    "click",
    event => {
      if (!isMobileAudioRisk()) {
        return;
      }

      const target = event.target;

      if (
        target &&
        target.closest &&
        target.closest("#mg-audio-dock-v2, .mg-audio-dock-v2")
      ) {
        const story =
          typeof activeStory !== "undefined" && activeStory
            ? activeStory
            : null;

        if (story && storyHasAudio(story)) {
          window.setTimeout(() => {
            if (!getAudioElement().paused) {
              startMapSubtitles(story);
              startMobileSubtitleTicker(story);
            }
          }, 160);
        }
      }
    },
    true
  );
})();
/* ==========================================================
   IOS-SAFE AUDIO + SUBTITLE START

   Permanent iOS solution:
   - iOS does not get script-started audio after the long map travel.
   - Instead, when the journey reaches full arrival, iOS shows a small
     "Tap to hear this call" button.
   - That direct tap starts the audio and subtitles together.
   - Desktop/Mac behavior remains untouched.
   - Future submissions work as long as they have audio_url and subtitles.

   Paste at the VERY BOTTOM of script.js.
   ========================================================== */

(function installIosSafeAudioSubtitleStart() {
  if (window.__mgIosSafeAudioSubtitleStartReady) {
    return;
  }

  window.__mgIosSafeAudioSubtitleStartReady = true;

  const IOS_GATE_ID = "mg-ios-audio-start-gate";

  const state = {
    pendingStory: null,
    pendingStoryId: "",
    monitorTimer: null,
    subtitleTimer: null,
    isStarting: false
  };

  function clean(value) {
    return String(value || "").trim();
  }

  function getAudioElement() {
    if (typeof audio !== "undefined" && audio) {
      return audio;
    }

    return document.getElementById("story-audio");
  }

  function isIosDevice() {
    const ua = navigator.userAgent || "";
    const platform = navigator.platform || "";

    return (
      /iPad|iPhone|iPod/i.test(ua) ||
      /*
        Modern iPadOS can report itself as MacIntel.
      */
      (platform === "MacIntel" && navigator.maxTouchPoints > 1)
    );
  }

  function storyHasRealAudio(story) {
    return Boolean(
      story &&
      clean(story.audio) &&
      !/^about:blank$/i.test(clean(story.audio)) &&
      !/^assets\/audio\/story-001\.wav$/i.test(clean(story.audio))
    );
  }

  function storyStillActive(story) {
    return Boolean(
      story &&
      typeof activeStory !== "undefined" &&
      activeStory &&
      clean(activeStory.id) === clean(story.id)
    );
  }

  function safeCall(fnName, ...args) {
    try {
      if (typeof window[fnName] === "function") {
        return window[fnName](...args);
      }
    } catch (error) {}

    return undefined;
  }

  function ensureAudioReadyForIos(story) {
    const audioElement = getAudioElement();

    if (!audioElement || !storyHasRealAudio(story)) {
      return null;
    }

    const src = clean(story.audio);

    audioElement.preload = "auto";
    audioElement.setAttribute("preload", "auto");
    audioElement.setAttribute("playsinline", "");
    audioElement.setAttribute("webkit-playsinline", "");

    /*
      Important:
      Do not use blob/fetch conversion here.
      iOS is happiest when the user's tap calls play() directly
      on the real media URL.
    */
    const current =
      clean(audioElement.currentSrc) ||
      clean(audioElement.getAttribute("src")) ||
      clean(audioElement.src);

    if (current !== src) {
      audioElement.src = src;

      try {
        audioElement.load();
      } catch (error) {}
    }

    return audioElement;
  }

  function resumeWebAudioIfNeeded() {
    try {
      if (typeof getAudioContext === "function") {
        const context = getAudioContext();

        if (context && context.state === "suspended") {
          context.resume().catch(() => {});
        }
      }
    } catch (error) {}
  }

  function ensureIosGate() {
    let gate = document.getElementById(IOS_GATE_ID);

    if (gate) {
      return gate;
    }

    gate = document.createElement("div");
    gate.id = IOS_GATE_ID;
    gate.className = "mg-ios-audio-start-gate";
    gate.setAttribute("aria-hidden", "true");

    gate.innerHTML = `
      <button
        class="mg-ios-audio-start-button"
        type="button"
        aria-label="Start audio and subtitles"
      >
        <span class="mg-ios-audio-start-glow" aria-hidden="true"></span>
        <span class="mg-ios-audio-start-main">Tap to hear this call</span>
        <span class="mg-ios-audio-start-sub">audio and subtitles</span>
      </button>
    `;

    gate.addEventListener(
      "pointerdown",
      event => {
        event.stopPropagation();
      },
      true
    );

    gate.addEventListener(
      "touchstart",
      event => {
        event.stopPropagation();
      },
      { capture: true, passive: true }
    );

    gate.addEventListener(
      "click",
      event => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        startPendingIosAudioFromTap();
      },
      true
    );

    document.body.appendChild(gate);

    return gate;
  }

  function showIosGate(story) {
    if (!isIosDevice() || !storyHasRealAudio(story) || !storyStillActive(story)) {
      return;
    }

    hideAnyOlderMobileGates();

    const gate = ensureIosGate();

    gate.dataset.storyId = clean(story.id);
    gate.classList.add("visible");
    gate.setAttribute("aria-hidden", "false");
  }

  function hideIosGate() {
    const gate = document.getElementById(IOS_GATE_ID);

    if (!gate) {
      return;
    }

    gate.classList.remove("visible");
    gate.setAttribute("aria-hidden", "true");
    gate.dataset.storyId = "";
  }

  function hideAnyOlderMobileGates() {
    /*
      If an older mobile-gate patch exists, hide it so there is only
      one iOS start control.
    */
    const oldGate = document.getElementById("mg-mobile-audio-gate");

    if (oldGate) {
      oldGate.classList.remove("visible");
      oldGate.setAttribute("aria-hidden", "true");
    }
  }

  function clearMonitor() {
    if (state.monitorTimer) {
      window.clearInterval(state.monitorTimer);
      state.monitorTimer = null;
    }
  }

  function clearSubtitleTimer() {
    if (state.subtitleTimer) {
      window.clearInterval(state.subtitleTimer);
      state.subtitleTimer = null;
    }
  }

  function beginSubtitleTimer(story) {
    clearSubtitleTimer();

    state.subtitleTimer = window.setInterval(() => {
      if (!storyStillActive(story)) {
        clearSubtitleTimer();
        return;
      }

      const audioElement = getAudioElement();

      if (!audioElement || audioElement.paused) {
        return;
      }

      try {
        if (typeof updateMapSubtitleText === "function") {
          updateMapSubtitleText();
        }
      } catch (error) {}
    }, 120);
  }

  function queueIosStory(story) {
    if (!isIosDevice() || !storyHasRealAudio(story)) {
      return;
    }

    state.pendingStory = story;
    state.pendingStoryId = clean(story.id);

    hideIosGate();
    hideAnyOlderMobileGates();
    clearMonitor();

    ensureAudioReadyForIos(story);

    /*
      Wait until the visual journey fully arrives.
      We do not show the button during travel.
    */
    state.monitorTimer = window.setInterval(() => {
      if (!storyStillActive(story)) {
        clearMonitor();
        hideIosGate();
        return;
      }

      if (typeof journeyPhase !== "undefined" && journeyPhase === "arrived") {
        clearMonitor();

        const audioElement = getAudioElement();

        if (!audioElement || audioElement.paused) {
          showIosGate(story);
        }
      }
    }, 160);
  }

  async function startIosAudio(story) {
    if (!isIosDevice() || !storyHasRealAudio(story) || !storyStillActive(story)) {
      return false;
    }

    if (state.isStarting) {
      return false;
    }

    state.isStarting = true;

    const audioElement = ensureAudioReadyForIos(story);

    if (!audioElement) {
      state.isStarting = false;
      return false;
    }

    resumeWebAudioIfNeeded();

    audioElement.muted = false;

    /*
      iOS Safari usually ignores programmatic volume changes, but keeping
      this here is harmless for other iOS browsers.
    */
    try {
      audioElement.volume = 1;
    } catch (error) {}

    try {
      audioElement.pause();
    } catch (error) {}

    try {
      audioElement.currentTime = 0;
    } catch (error) {}

    /*
      Start subtitles immediately before play().
      If play succeeds, the timer below keeps them synchronized.
    */
    try {
      if (typeof startMapSubtitles === "function") {
        startMapSubtitles(story);
      }
    } catch (error) {}

    try {
      if (typeof updateMapSubtitleText === "function") {
        updateMapSubtitleText();
      }
    } catch (error) {}

    try {
      if (typeof refreshAudioDock === "function") {
        refreshAudioDock();
      }
    } catch (error) {}

    try {
      const playPromise = audioElement.play();

      if (playPromise && typeof playPromise.then === "function") {
        await playPromise;
      }

      hideIosGate();
      hideAnyOlderMobileGates();
      beginSubtitleTimer(story);

      try {
        if (typeof refreshAudioDock === "function") {
          refreshAudioDock();
        }
      } catch (error) {}

      window.setTimeout(() => {
        if (storyStillActive(story) && typeof updateMapSubtitleText === "function") {
          updateMapSubtitleText();
        }
      }, 180);

      window.setTimeout(() => {
        if (storyStillActive(story) && typeof updateMapSubtitleText === "function") {
          updateMapSubtitleText();
        }
      }, 650);

      state.isStarting = false;
      return true;
    } catch (error) {
      /*
        If this still fails, keep the gate visible. The user can tap again.
      */
      showIosGate(story);
      state.isStarting = false;
      return false;
    }
  }

  function startPendingIosAudioFromTap() {
    const story =
      state.pendingStory ||
      (
        typeof activeStory !== "undefined" && activeStory
          ? activeStory
          : null
      );

    startIosAudio(story);
  }

  /*
    Main override:
    Desktop/Mac/Android keep the existing playStoryAudio chain.
    iOS queues the audio and waits for a direct tap after arrival.
  */
  if (typeof playStoryAudio === "function" && !window.__mgIosSafePlayWrapped) {
    const previousPlayStoryAudio = playStoryAudio;

    playStoryAudio = function iosSafePlayStoryAudio(story) {
      if (isIosDevice() && storyHasRealAudio(story)) {
        queueIosStory(story);
        return;
      }

      return previousPlayStoryAudio.apply(this, arguments);
    };

    window.__mgIosSafePlayWrapped = true;
  }

  /*
    On new story/reset, clear the old iOS gate.
  */
  if (typeof selectStory === "function" && !window.__mgIosSafeSelectWrapped) {
    const previousSelectStory = selectStory;

    selectStory = function iosSafeSelectStory(story, options = {}) {
      hideIosGate();
      hideAnyOlderMobileGates();
      clearMonitor();
      clearSubtitleTimer();
      state.pendingStory = null;
      state.pendingStoryId = "";

      return previousSelectStory.call(this, story, options);
    };

    window.__mgIosSafeSelectWrapped = true;
  }

  if (typeof resetView === "function" && !window.__mgIosSafeResetWrapped) {
    const previousResetView = resetView;

    resetView = function iosSafeResetView() {
      hideIosGate();
      hideAnyOlderMobileGates();
      clearMonitor();
      clearSubtitleTimer();
      state.pendingStory = null;
      state.pendingStoryId = "";

      return previousResetView.apply(this, arguments);
    };

    window.__mgIosSafeResetWrapped = true;
  }

  if (typeof goToIranView === "function" && !window.__mgIosSafeIranWrapped) {
    const previousGoToIranView = goToIranView;

    goToIranView = function iosSafeGoToIranView() {
      hideIosGate();
      hideAnyOlderMobileGates();
      clearMonitor();
      clearSubtitleTimer();
      state.pendingStory = null;
      state.pendingStoryId = "";

      return previousGoToIranView.apply(this, arguments);
    };

    window.__mgIosSafeIranWrapped = true;
  }

  /*
    Bind audio lifecycle.
  */
  const audioElement = getAudioElement();

  if (audioElement && audioElement.dataset.mgIosSafeBound !== "yes") {
    audioElement.dataset.mgIosSafeBound = "yes";

    audioElement.addEventListener("playing", () => {
      hideIosGate();
      hideAnyOlderMobileGates();

      if (
        typeof activeStory !== "undefined" &&
        activeStory &&
        isIosDevice()
      ) {
        beginSubtitleTimer(activeStory);
      }
    });

    audioElement.addEventListener("ended", () => {
      clearSubtitleTimer();

      try {
        if (typeof hideMapSubtitles === "function") {
          hideMapSubtitles();
        }
      } catch (error) {}

      try {
        if (
          typeof render === "function" &&
          typeof activeStory !== "undefined" &&
          activeStory
        ) {
          render();
        }
      } catch (error) {}
    });

    audioElement.addEventListener("pause", () => {
      /*
        Do not clear subtitles on ordinary pause, because the dock may pause.
        The existing subtitle system handles hiding when needed.
      */
    });
  }

  /*
    If the user taps the audio dock play button on iOS while the gate is
    pending, treat that as the required direct tap too.
  */
  document.addEventListener(
    "click",
    event => {
      if (!isIosDevice()) {
        return;
      }

      const target = event.target;

      if (
        target &&
        target.closest &&
        target.closest("#mg-audio-dock-v2, .mg-audio-dock-v2, .audio-dock")
      ) {
        const story =
          state.pendingStory ||
          (
            typeof activeStory !== "undefined" && activeStory
              ? activeStory
              : null
          );

        if (story && storyHasRealAudio(story)) {
          startIosAudio(story);
        }
      }
    },
    true
  );
})();
/* ==========================================================
   MOBILE NATIVE AUDIO ROOM — FINAL FALLBACK

   Why:
   iOS/Android may block hidden/script-started audio after a long
   map animation. Instead of fighting autoplay, this creates a
   native mobile audio player after arrival.

   Behavior:
   - Desktop/Mac/PC behavior is untouched.
   - On iOS/Android/touch devices:
     1. Map journey runs normally.
     2. After full arrival, a mobile audio panel appears.
     3. User taps native Play.
     4. Audio and subtitles start together.
     5. When audio ends, existing post-audio media logic is triggered.

   Paste at the VERY BOTTOM of script.js.
   ========================================================== */

(function installMobileNativeAudioRoom() {
  if (window.__mgMobileNativeAudioRoomReady) {
    return;
  }

  window.__mgMobileNativeAudioRoomReady = true;

  const PANEL_ID = "mg-mobile-native-audio-room";
  const PLAYER_ID = "mg-mobile-native-audio-player";
  const SUBTITLE_ID = "mg-mobile-native-subtitle";

  const state = {
    pendingStory: null,
    pendingStoryId: "",
    monitorTimer: null,
    subtitleTimer: null,
    cues: [],
    fallbackSubtitle: "",
    lastSubtitleText: "",
    usingMobileRoom: false
  };

  function clean(value) {
    return String(value || "").trim();
  }

  function isIosDevice() {
    const ua = navigator.userAgent || "";
    const platform = navigator.platform || "";

    return (
      /iPhone|iPad|iPod/i.test(ua) ||
      (platform === "MacIntel" && navigator.maxTouchPoints > 1)
    );
  }

  function isAndroidDevice() {
    return /Android/i.test(navigator.userAgent || "");
  }

  function isTouchMobileRisk() {
    const coarse =
      window.matchMedia &&
      (
        window.matchMedia("(hover: none)").matches ||
        window.matchMedia("(pointer: coarse)").matches
      );

    return Boolean(isIosDevice() || isAndroidDevice() || coarse);
  }

  function getHiddenAudio() {
    if (typeof audio !== "undefined" && audio) {
      return audio;
    }

    return document.getElementById("story-audio");
  }

  function storyHasRealAudio(story) {
    const src = clean(story && story.audio);

    return Boolean(
      src &&
      !/^about:blank$/i.test(src) &&
      !/^assets\/audio\/story-001\.wav$/i.test(src)
    );
  }

  function storyStillActive(story) {
    return Boolean(
      story &&
      typeof activeStory !== "undefined" &&
      activeStory &&
      clean(activeStory.id) === clean(story.id)
    );
  }

  function ensureMapSubtitleOverlayForMobile() {
    if (typeof ensureMapSubtitleOverlay === "function") {
      try {
        return ensureMapSubtitleOverlay();
      } catch (error) {}
    }

    let overlay = document.getElementById("map-subtitle-overlay");

    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "map-subtitle-overlay";
      overlay.className = "map-subtitle-overlay";
      overlay.setAttribute("aria-live", "polite");
      document.body.appendChild(overlay);
    }

    return overlay;
  }

  function normalizeSubtitleText(value) {
    return String(value || "")
      .replace(/\r/g, "")
      .replace(/\\n/g, "\n")
      .replace(/\uFEFF/g, "")
      .trim();
  }

  function parseMobileSubtitleTime(value) {
    const text = String(value || "")
      .trim()
      .replace(",", ".");

    if (!text) {
      return NaN;
    }

    if (/^\d+(\.\d+)?$/.test(text)) {
      return Number(text);
    }

    const parts = text.split(":");

    if (parts.length < 2 || parts.length > 3) {
      return NaN;
    }

    const seconds = Number(parts.pop());
    const minutes = Number(parts.pop());
    const hours = parts.length ? Number(parts.pop()) : 0;

    if (
      !Number.isFinite(seconds) ||
      !Number.isFinite(minutes) ||
      !Number.isFinite(hours)
    ) {
      return NaN;
    }

    return hours * 3600 + minutes * 60 + seconds;
  }

  function parseMobilePipeCue(line) {
    const cleaned = String(line || "").trim();

    if (!cleaned || !cleaned.includes("|")) {
      return null;
    }

    const parts = cleaned.split("|");
    const timePart = parts[0].trim();
    const text = parts.slice(1).join("|").trim();

    if (!timePart || !text) {
      return null;
    }

    const timeParts = timePart.split(/\s*(?:-->|[-–—])\s*/);

    if (timeParts.length < 2) {
      return null;
    }

    const start = parseMobileSubtitleTime(timeParts[0]);
    const end = parseMobileSubtitleTime(timeParts[1]);

    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return null;
    }

    return {
      start,
      end,
      text
    };
  }

  function parseMobileSrtOrVtt(value) {
    const text = normalizeSubtitleText(value)
      .replace(/^WEBVTT[^\n]*\n+/i, "");

    if (!text.includes("-->")) {
      return [];
    }

    const blocks = text
      .split(/\n{2,}/)
      .map(block => block.trim())
      .filter(Boolean);

    const cues = [];

    blocks.forEach(block => {
      const lines = block
        .split("\n")
        .map(line => line.trim())
        .filter(Boolean);

      const timeIndex = lines.findIndex(line => line.includes("-->"));

      if (timeIndex === -1) {
        return;
      }

      const timeLine = lines[timeIndex];
      const textLines = lines.slice(timeIndex + 1);

      if (!textLines.length) {
        return;
      }

      const timeParts = timeLine.split(/\s*-->\s*/);

      if (timeParts.length < 2) {
        return;
      }

      const start = parseMobileSubtitleTime(timeParts[0]);
      const end = parseMobileSubtitleTime(timeParts[1].split(/\s+/)[0]);

      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return;
      }

      cues.push({
        start,
        end,
        text: textLines.join(" ")
      });
    });

    return cues;
  }

  function parseMobileCues(story) {
    const rawCueText = normalizeSubtitleText(
      story && story.subtitleCuesEn
    );

    if (rawCueText) {
      const srtCues = parseMobileSrtOrVtt(rawCueText);

      if (srtCues.length) {
        return srtCues;
      }

      const pipeCues = rawCueText
        .split(/\n+/)
        .map(parseMobilePipeCue)
        .filter(Boolean);

      if (pipeCues.length) {
        return pipeCues;
      }
    }

    /*
      Sometimes users paste SRT/VTT into subtitle_en by mistake.
      Accept that too.
    */
    const subtitleText = normalizeSubtitleText(
      story && story.subtitleEn
    );

    if (subtitleText && subtitleText.includes("-->")) {
      return parseMobileSrtOrVtt(subtitleText);
    }

    return [];
  }

  function getFallbackSubtitle(story) {
    const subtitle = normalizeSubtitleText(story && story.subtitleEn);
    const translation = normalizeSubtitleText(story && story.translationEn);

    /*
      Do not show raw SRT/WebVTT as fallback text.
    */
    if (subtitle && !subtitle.includes("-->")) {
      return subtitle;
    }

    return translation || "";
  }

  function prepareMobileSubtitleState(story) {
    state.cues = parseMobileCues(story);
    state.fallbackSubtitle = getFallbackSubtitle(story);
    state.lastSubtitleText = "";
  }

  function getActiveSubtitleForTime(currentTime) {
    if (state.cues.length) {
      const cue = state.cues.find(item => {
        return currentTime >= item.start && currentTime < item.end;
      });

      return cue ? cue.text : "";
    }

    return state.fallbackSubtitle || "";
  }

  function paintMobileSubtitle(text) {
    const subtitleBox = document.getElementById(SUBTITLE_ID);
    const mapOverlay = ensureMapSubtitleOverlayForMobile();

    const cleanText = clean(text);

    state.lastSubtitleText = cleanText;

    if (subtitleBox) {
      subtitleBox.textContent = cleanText;
      subtitleBox.classList.toggle("visible", Boolean(cleanText));
    }

    if (mapOverlay) {
      mapOverlay.textContent = cleanText;
      mapOverlay.classList.toggle("visible", Boolean(cleanText));
    }
  }

  function updateMobileSubtitles() {
    const player = document.getElementById(PLAYER_ID);

    if (!player) {
      return;
    }

    const text = getActiveSubtitleForTime(player.currentTime || 0);

    paintMobileSubtitle(text);
  }

  function startSubtitleTicker() {
    stopSubtitleTicker();

    state.subtitleTimer = window.setInterval(() => {
      updateMobileSubtitles();
    }, 120);
  }

  function stopSubtitleTicker() {
    if (state.subtitleTimer) {
      window.clearInterval(state.subtitleTimer);
      state.subtitleTimer = null;
    }
  }

  function ensurePanel() {
    let panel = document.getElementById(PANEL_ID);

    if (panel) {
      return panel;
    }

    panel = document.createElement("aside");
    panel.id = PANEL_ID;
    panel.className = "mg-mobile-native-audio-room";
    panel.setAttribute("aria-hidden", "true");
    panel.setAttribute("aria-label", "Mobile audio and subtitles");

    panel.innerHTML = `
      <div class="mg-mobile-native-audio-inner">
        <header class="mg-mobile-native-audio-header">
          <div>
            <p class="mg-mobile-native-audio-eyebrow">Call arrived</p>
            <h3 class="mg-mobile-native-audio-title">Tap play to hear this call</h3>
          </div>

          <button
            class="mg-mobile-native-audio-close"
            type="button"
            aria-label="Close audio panel"
            title="Close"
          >×</button>
        </header>

        <audio
          id="${PLAYER_ID}"
          class="mg-mobile-native-audio-player"
          controls
          preload="metadata"
          playsinline
          webkit-playsinline
        ></audio>

        <div
          id="${SUBTITLE_ID}"
          class="mg-mobile-native-subtitle"
          aria-live="polite"
        ></div>

        <p class="mg-mobile-native-audio-help">
          On mobile, audio needs a direct tap.
        </p>

        <a
          class="mg-mobile-native-audio-open-link"
          target="_blank"
          rel="noopener noreferrer"
        >Open audio file</a>
      </div>
    `;

    panel.addEventListener(
      "pointerdown",
      event => {
        event.stopPropagation();
      },
      true
    );

    panel.addEventListener(
      "touchstart",
      event => {
        event.stopPropagation();
      },
      { capture: true, passive: true }
    );

    panel.addEventListener(
      "click",
      event => {
        const closeButton = event.target.closest(".mg-mobile-native-audio-close");

        if (closeButton) {
          event.preventDefault();
          hidePanel();
          return;
        }

        event.stopPropagation();
      },
      true
    );

    document.body.appendChild(panel);

    const player = panel.querySelector(`#${PLAYER_ID}`);

    if (player && player.dataset.mobileNativeBound !== "yes") {
      player.dataset.mobileNativeBound = "yes";

      player.addEventListener("play", () => {
        startSubtitleTicker();
        updateMobileSubtitles();

        /*
          Keep old mobile gates out of the way.
        */
        hideOldMobileGates();
      });

      player.addEventListener("playing", () => {
        startSubtitleTicker();
        updateMobileSubtitles();
      });

      player.addEventListener("timeupdate", updateMobileSubtitles);
      player.addEventListener("seeked", updateMobileSubtitles);

      player.addEventListener("pause", () => {
        updateMobileSubtitles();
      });

      player.addEventListener("ended", () => {
        stopSubtitleTicker();
        paintMobileSubtitle("");

        /*
          Trigger existing post-audio systems that listen to the hidden
          #story-audio ended event.
        */
        const hiddenAudio = getHiddenAudio();

        if (hiddenAudio) {
          try {
            hiddenAudio.dispatchEvent(new Event("ended"));
          } catch (error) {}
        }

        window.setTimeout(() => {
          hidePanel();
        }, 450);
      });

      player.addEventListener("error", () => {
        const help = panel.querySelector(".mg-mobile-native-audio-help");

        if (help) {
          help.textContent =
            "This audio file could not be played by the mobile browser. Try opening the audio file directly.";
        }
      });
    }

    return panel;
  }

  function hideOldMobileGates() {
    [
      "mg-mobile-audio-gate",
      "mg-ios-audio-start-gate"
    ].forEach(id => {
      const gate = document.getElementById(id);

      if (gate) {
        gate.classList.remove("visible");
        gate.setAttribute("aria-hidden", "true");
      }
    });
  }

  function configurePanelForStory(story) {
    const panel = ensurePanel();
    const player = panel.querySelector(`#${PLAYER_ID}`);
    const title = panel.querySelector(".mg-mobile-native-audio-title");
    const openLink = panel.querySelector(".mg-mobile-native-audio-open-link");
    const help = panel.querySelector(".mg-mobile-native-audio-help");

    const src = clean(story && story.audio);

    if (title) {
      const city = clean(story && story.originCity) || "this call";
      const year = clean(story && story.yearLeft);

      title.textContent = year
        ? `Tap play to hear ${city} ${year}`
        : `Tap play to hear ${city}`;
    }

    if (player && src) {
      if (clean(player.currentSrc || player.getAttribute("src") || player.src) !== src) {
        player.src = src;

        try {
          player.load();
        } catch (error) {}
      }
    }

    if (openLink && src) {
      openLink.href = src;
      openLink.style.display = "inline-flex";
    }

    if (help) {
      help.textContent = "On mobile, audio needs a direct tap.";
    }

    prepareMobileSubtitleState(story);
    paintMobileSubtitle("");

    return panel;
  }

  function showPanel(story) {
    if (!storyStillActive(story) || !storyHasRealAudio(story)) {
      return;
    }

    hideOldMobileGates();

    const panel = configurePanelForStory(story);

    panel.classList.add("visible");
    panel.setAttribute("aria-hidden", "false");

    document.body.classList.add("mg-mobile-native-audio-visible");

    state.usingMobileRoom = true;

    const player = panel.querySelector(`#${PLAYER_ID}`);

    /*
      Do not auto-play here. Let the viewer tap native Play.
      This is the whole point of the iOS/Android-safe fallback.
    */
    if (player) {
      try {
        player.pause();
        player.currentTime = 0;
      } catch (error) {}
    }
  }

  function hidePanel() {
    const panel = document.getElementById(PANEL_ID);
    const player = document.getElementById(PLAYER_ID);

    if (player) {
      try {
        player.pause();
      } catch (error) {}
    }

    stopSubtitleTicker();
    paintMobileSubtitle("");

    if (panel) {
      panel.classList.remove("visible");
      panel.setAttribute("aria-hidden", "true");
    }

    document.body.classList.remove("mg-mobile-native-audio-visible");

    state.usingMobileRoom = false;
  }

  function clearMonitor() {
    if (state.monitorTimer) {
      window.clearInterval(state.monitorTimer);
      state.monitorTimer = null;
    }
  }

  function queueMobileNativeStory(story) {
    if (!isTouchMobileRisk() || !storyHasRealAudio(story)) {
      return;
    }

    state.pendingStory = story;
    state.pendingStoryId = clean(story.id);

    hidePanel();
    hideOldMobileGates();
    clearMonitor();

    /*
      Wait for the actual final arrival. The base playStoryAudio call happens
      earlier at line-arrived, so we cannot show the panel immediately.
    */
    state.monitorTimer = window.setInterval(() => {
      if (!storyStillActive(story)) {
        clearMonitor();
        hidePanel();
        return;
      }

      if (typeof journeyPhase !== "undefined" && journeyPhase === "arrived") {
        clearMonitor();
        showPanel(story);
      }
    }, 150);
  }

  /*
    Critical override:
    On mobile/touch devices, do not call the old hidden-audio playback.
    Use the native visible player instead.
    Desktop keeps the existing chain.
  */
  if (typeof playStoryAudio === "function" && !window.__mgMobileNativeRoomPlayWrapped) {
    const previousPlayStoryAudio = playStoryAudio;

    playStoryAudio = function mobileNativeRoomPlayStoryAudio(story) {
      if (isTouchMobileRisk() && storyHasRealAudio(story)) {
        queueMobileNativeStory(story);
        return;
      }

      return previousPlayStoryAudio.apply(this, arguments);
    };

    window.__mgMobileNativeRoomPlayWrapped = true;
  }

  if (typeof selectStory === "function" && !window.__mgMobileNativeRoomSelectWrapped) {
    const previousSelectStory = selectStory;

    selectStory = function mobileNativeRoomSelectStory(story, options = {}) {
      clearMonitor();
      hidePanel();
      hideOldMobileGates();
      state.pendingStory = null;
      state.pendingStoryId = "";

      return previousSelectStory.call(this, story, options);
    };

    window.__mgMobileNativeRoomSelectWrapped = true;
  }

  if (typeof resetView === "function" && !window.__mgMobileNativeRoomResetWrapped) {
    const previousResetView = resetView;

    resetView = function mobileNativeRoomResetView() {
      clearMonitor();
      hidePanel();
      hideOldMobileGates();
      state.pendingStory = null;
      state.pendingStoryId = "";

      return previousResetView.apply(this, arguments);
    };

    window.__mgMobileNativeRoomResetWrapped = true;
  }

  if (typeof goToIranView === "function" && !window.__mgMobileNativeRoomIranWrapped) {
    const previousGoToIranView = goToIranView;

    goToIranView = function mobileNativeRoomIranView() {
      clearMonitor();
      hidePanel();
      hideOldMobileGates();
      state.pendingStory = null;
      state.pendingStoryId = "";

      return previousGoToIranView.apply(this, arguments);
    };

    window.__mgMobileNativeRoomIranWrapped = true;
  }

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      hidePanel();
    }
  });

  window.setTimeout(hideOldMobileGates, 500);
  window.setTimeout(hideOldMobileGates, 1500);
})();
/* ==========================================================
   BLINKING-I INVITATION — CLOSER FINAL ENGLISH TRANSLATION

   Goal:
   - Replace the previous English invitation with a closer translation
     of the finalized Persian letter.
   - Keep the same layout, titles, and bold emphasis.
   - Avoid fighting with the earlier English patch by satisfying its
     dataset marker while storing our own newer version marker.
   - Do not change the Persian version.

   Paste at the VERY BOTTOM of script.js.
   ========================================================== */

(function replaceBlinkingIInvitationWithCloserFinalEnglishTranslation() {
  if (window.__mgCloserFinalEnglishInvitationTranslationReady) {
    return;
  }

  window.__mgCloserFinalEnglishInvitationTranslationReady = true;

  const CLOSE_VERSION = "closer-final-english-translation-2026-06";
  const OLD_VERSION_MARKER_TO_PREVENT_OLDER_PATCH_FIGHT = "final-english-letter-2026-06";

  const FINAL_EN_INVITATION_HTML = `
    <p
      class="title-memory-invitation-greeting"
      lang="en"
      dir="ltr"
    >Dear compatriot,</p>

    <p
      class="title-memory-invitation-paragraph"
      lang="en"
      dir="ltr"
    ><strong>“Missing Geographies”</strong> is an artistic and social project about lives that remained unfinished in the shadow of the Islamic Republic; about freedoms that were taken away, opportunities that burned, and versions of us that never found the chance to emerge and appear, and as a result, an Iran that could have existed and does not. This project is an attempt to find a language for speaking the words that have remained in our throats for years; words that often had no place to be spoken, no time to be heard, and no listener who could understand the hidden pain and longing inside them.</p>

    <p
      class="title-memory-invitation-section-title"
      lang="en"
      dir="ltr"
    ><strong>From Exile</strong></p>

    <p
      class="title-memory-invitation-paragraph"
      lang="en"
      dir="ltr"
    >We Iranians who have been kept far from home have each, in our own way, lived with the heavy weight of this sorrow. Because <strong>the experience of living under the Islamic Republic was not only the experience of repression in official politics; it was the everyday experience of the repression of life itself</strong>: restrictions on the body, language, love, joy, mourning, music, clothing, conviviality, education, religion, belief, work, travel, connection with the world, and the future. Many things that seem obvious for an ordinary life were, for us, either forbidden, conditional, dangerous, or accompanied by constant fear, shame, and self-censorship.</p>

    <p
      class="title-memory-invitation-paragraph"
      lang="en"
      dir="ltr"
    ><strong>Longing</strong> is not only the memory of a street, a house, a city, or a sweet recollection. Sometimes longing is the name of something we never had the chance to experience; the name of freedoms removed from our childhood, adolescence, and youth; the name of opportunities that burned; the name of lives that could have taken shape and did not. <strong>We miss the freedoms that were withheld from us.</strong></p>

    <p
      class="title-memory-invitation-paragraph"
      lang="en"
      dir="ltr"
    >“Missing Geographies” is an invitation to return to these layers and examine them again; to redraw the map of things that were lost, but whose traces, desire, or pull still remain in our bodies, memories, language, dreams, voices, smells, photographs, music, clothing, and the objects we carry with us.</p>

    <p
      class="title-memory-invitation-section-title"
      lang="en"
      dir="ltr"
    ><strong>From Loss</strong></p>

    <p
      class="title-memory-invitation-paragraph"
      lang="en"
      dir="ltr"
    >My suggestion is to think through these three paths:</p>

    <p
      class="title-memory-invitation-paragraph"
      lang="en"
      dir="ltr"
    >First, toward the past: What was lost, and what singular opportunities never became part of lived experience? What freedoms, what possibilities, what moments passed their time? For me, one of these losses goes back even to childhood: the longing for a simple experience, like being able to go to the same school as my sister.</p>

    <p
      class="title-memory-invitation-paragraph"
      lang="en"
      dir="ltr"
    >Second, toward the present: What place, what person, what social experience, what familiar and beloved feeling, what intimate and heartwarming moment remains out of your reach today? Sometimes longing and the feeling of loss mean the inability to be present; for me, for example, not even being able to stand at the grave of a dear friend and say goodbye.</p>

    <p
      class="title-memory-invitation-paragraph"
      lang="en"
      dir="ltr"
    >Third, toward the future: If Iran were free, if our lives could have been a natural continuation of our own history, language, and homeland, what might have been possible? What shape might our personal lives have taken? What could our homeland have become if the youth, knowledge, love, creativity, and desire to build that burns in every one of us had not been denied to it?</p>

    <p
      class="title-memory-invitation-paragraph"
      lang="en"
      dir="ltr"
    >These three paths are only suggestions. Your contribution can respond to one of them, two of them, or all three; and of course it can move toward things I cannot even imagine, but that are part of your lived experience.</p>

    <p
      class="title-memory-invitation-section-title"
      lang="en"
      dir="ltr"
    ><strong>The Trace We Leave Behind</strong></p>

    <p
      class="title-memory-invitation-paragraph"
      lang="en"
      dir="ltr"
    >The point you add to our collective map can be an audio file, a photograph, a drawing, a text, a poem, a sentence, an image, a memory, or even a link to a piece of music or video; something that you feel expresses what you carry in the best way. Your point of contact with Iran can also be a combination of these, or you can fill out the form as many times as you like and speak to different subjects. It does not have to be complete, orderly, literary, or ready. Pauses, hesitation, silence, a lump in the throat, unfinishedness, and changes of language can all be part of your contribution. Your contribution can be recorded without the smallest sign or reference to your real identity; for example, with a pseudonym, or even without sharing your email address with me. <strong>At the end,</strong> if you wish, you can leave your email address and choose whether I may contact you if needed, whether for this project or for a possible future academic research project. If you pass this invitation on to someone you think carries something of this missing geography with them, I would be deeply grateful.</p>
  `;

  function getQuoteBox() {
    return document.getElementById("title-memory-quote");
  }

  function getEnglishInner() {
    return document.querySelector(
      "#title-memory-quote .title-memory-invitation-inner-en"
    );
  }

  function isEnglishMode(box) {
    if (!box) {
      return false;
    }

    return (
      box.dataset.language === "en" ||
      box.getAttribute("lang") === "en" ||
      box.getAttribute("dir") === "ltr" ||
      box.classList.contains("title-memory-quote-english")
    );
  }

  function replaceEnglishInvitationIfNeeded() {
    const box = getQuoteBox();

    if (!box || !isEnglishMode(box)) {
      return false;
    }

    const inner = getEnglishInner();

    if (!inner) {
      return false;
    }

    if (inner.dataset.finalEnglishCloseTranslationVersion === CLOSE_VERSION) {
      return true;
    }

    inner.innerHTML = FINAL_EN_INVITATION_HTML;

    /*
      This marker prevents the earlier English patch from repeatedly
      overwriting this closer translation.
    */
    inner.dataset.finalEnglishInvitationVersion =
      OLD_VERSION_MARKER_TO_PREVENT_OLDER_PATCH_FIGHT;

    inner.dataset.finalEnglishCloseTranslationVersion = CLOSE_VERSION;

    inner.classList.add(
      "title-memory-invitation-final-letter",
      "title-memory-invitation-final-letter-en"
    );

    box.classList.add(
      "title-memory-quote-final-letter",
      "title-memory-quote-final-letter-en"
    );

    const scroll = document.getElementById("title-memory-invitation-scroll");

    if (scroll) {
      scroll.scrollTop = 0;
    }

    return true;
  }

  window.setInterval(replaceEnglishInvitationIfNeeded, 220);

  document.addEventListener(
    "click",
    event => {
      if (
        event.target &&
        event.target.closest &&
        event.target.closest("#title-memory-language-toggle")
      ) {
        window.setTimeout(replaceEnglishInvitationIfNeeded, 30);
        window.setTimeout(replaceEnglishInvitationIfNeeded, 120);
        window.setTimeout(replaceEnglishInvitationIfNeeded, 280);
        window.setTimeout(replaceEnglishInvitationIfNeeded, 520);
      }
    },
    true
  );

  window.setTimeout(replaceEnglishInvitationIfNeeded, 250);
  window.setTimeout(replaceEnglishInvitationIfNeeded, 900);
  window.setTimeout(replaceEnglishInvitationIfNeeded, 1600);
})();
/* ==========================================================
   BLINKING-I INVITATION — FINAL ENGLISH LETTER REPLACEMENT

   Goal:
   - Replace the English invitation text with an English version
     that matches the finalized Persian letter.
   - Preserve the same structure:
       greeting
       opening paragraph
       From Exile
       From Loss
       The Trace We Leave Behind
   - Preserve bold emphasis equivalent to the Persian version.
   - Keep the existing English / فارسی toggle behavior.
   - Do not change the Persian version.

   Paste at the VERY BOTTOM of script.js.
   ========================================================== */

(function replaceBlinkingIInvitationWithFinalEnglishLetter() {
  if (window.__mgFinalEnglishInvitationLetterReady) {
    return;
  }

  window.__mgFinalEnglishInvitationLetterReady = true;

  const FINAL_EN_INVITATION_VERSION = "final-english-letter-2026-06";

  const FINAL_EN_INVITATION_HTML = `
    <p
      class="title-memory-invitation-greeting"
      lang="en"
      dir="ltr"
    >Dear compatriot,</p>

    <p
      class="title-memory-invitation-paragraph"
      lang="en"
      dir="ltr"
    ><strong>“Missing Geographies”</strong> is an artistic and social project about lives that remained unfinished in the shadow of the Islamic Republic; about freedoms that were taken away, opportunities that burned, and versions of ourselves that never found the chance to appear or come into being, and as a result, an Iran that could have existed and does not. This project is an effort to find a language for speaking the words that have stayed in our throats for years; words that often had no place to be spoken, no time to be heard, and no listener who could understand the hidden pain and longing inside them.</p>

    <p
      class="title-memory-invitation-section-title"
      lang="en"
      dir="ltr"
    ><strong>From Exile</strong></p>

    <p
      class="title-memory-invitation-paragraph"
      lang="en"
      dir="ltr"
    >We Iranians who live far from home have each, in our own way, lived with the weight of this grief. Because <strong>living under the Islamic Republic was not only an experience of repression in official politics; it was the daily experience of the repression of life itself</strong>: restrictions on the body, language, love, joy, mourning, music, clothing, conviviality, education, religion, belief, work, travel, connection with the world, and the future. Many things that seem ordinary and obvious for a normal life were, for us, either forbidden, conditional, dangerous, or accompanied by constant fear, shame, and self-censorship.</p>

    <p
      class="title-memory-invitation-paragraph"
      lang="en"
      dir="ltr"
    ><strong>Longing</strong> is not only the memory of a street, a house, a city, or a sweet recollection. Sometimes longing names something we never had the chance to experience; the freedoms removed from our childhood, adolescence, and youth; the opportunities that burned; the lives that could have taken shape and did not. <strong>We miss the freedoms that were withheld from us.</strong></p>

    <p
      class="title-memory-invitation-paragraph"
      lang="en"
      dir="ltr"
    >“Missing Geographies” is an invitation to return to these layers and examine them again; to redraw the map of things that were lost, but whose traces, desire, or pull still remain in the body, memory, language, dreams, voices, smells, photographs, music, clothing, and objects we carry with us.</p>

    <p
      class="title-memory-invitation-section-title"
      lang="en"
      dir="ltr"
    ><strong>From Loss</strong></p>

    <p
      class="title-memory-invitation-paragraph"
      lang="en"
      dir="ltr"
    >I suggest thinking through these three paths:</p>

    <p
      class="title-memory-invitation-paragraph"
      lang="en"
      dir="ltr"
    >First, toward the past: What was lost, and what singular opportunities never became lived experience? What freedoms, what possibilities, what moments passed their time? For me, one of these losses goes back even to childhood: the longing for a simple experience, like being able to go to the same school as my sister.</p>

    <p
      class="title-memory-invitation-paragraph"
      lang="en"
      dir="ltr"
    >Second, toward the present: What place, what person, what social experience, what familiar and beloved feeling, what intimate and heart-warming moment remains out of your reach today? Sometimes longing and the feeling of loss mean the inability to be present; for me, for example, not even being able to stand at the grave of a dear friend and say goodbye.</p>

    <p
      class="title-memory-invitation-paragraph"
      lang="en"
      dir="ltr"
    >Third, toward the future: If Iran were free, if our lives could have been a natural continuation of our history, language, and homeland, what might have been possible? What shape might our personal lives have taken? What could our homeland have become if the youth, knowledge, love, creativity, and desire to build that burns in each of us had not been denied to it?</p>

    <p
      class="title-memory-invitation-paragraph"
      lang="en"
      dir="ltr"
    >These three paths are only suggestions. Your contribution can respond to one of them, two of them, or all three; and of course it can move toward things I cannot even imagine, but that are part of your lived experience.</p>

    <p
      class="title-memory-invitation-section-title"
      lang="en"
      dir="ltr"
    ><strong>The Trace We Leave Behind</strong></p>

    <p
      class="title-memory-invitation-paragraph"
      lang="en"
      dir="ltr"
    >The point you add to our collective map can be an audio file, a photograph, a drawing, a text, a poem, a sentence, an image, a memory, or even a link to a piece of music or video; something that you feel expresses your feeling in the best way. Your point of contact with Iran can also be a combination of these, or you can fill out the form as many times as you like and speak to different subjects. It does not have to be complete, orderly, literary, or ready. Pauses, hesitation, silence, a lump in the throat, unfinishedness, and changes of language can all be part of your contribution. Your contribution can be recorded without the smallest sign or reference to your real identity; for example, with a pseudonym, or even without sharing your email address with me. <strong>At the end,</strong> if you wish, you can leave your email address and choose whether I may contact you if needed, whether for this project or for a possible future academic research project. If you pass this invitation on to someone you think carries something of this missing geography with them, I would be deeply grateful.</p>
  `;

  function getQuoteBox() {
    return document.getElementById("title-memory-quote");
  }

  function getEnglishInner() {
    return document.querySelector(
      "#title-memory-quote .title-memory-invitation-inner-en"
    );
  }

  function isEnglishMode(box) {
    if (!box) {
      return false;
    }

    return (
      box.dataset.language === "en" ||
      box.getAttribute("lang") === "en" ||
      box.getAttribute("dir") === "ltr" ||
      box.classList.contains("title-memory-quote-english")
    );
  }

  function replaceEnglishInvitationIfNeeded() {
    const box = getQuoteBox();

    if (!box || !isEnglishMode(box)) {
      return false;
    }

    const inner = getEnglishInner();

    if (!inner) {
      return false;
    }

    if (inner.dataset.finalEnglishInvitationVersion === FINAL_EN_INVITATION_VERSION) {
      return true;
    }

    inner.innerHTML = FINAL_EN_INVITATION_HTML;
    inner.dataset.finalEnglishInvitationVersion = FINAL_EN_INVITATION_VERSION;

    inner.classList.add(
      "title-memory-invitation-final-letter",
      "title-memory-invitation-final-letter-en"
    );

    box.classList.add(
      "title-memory-quote-final-letter",
      "title-memory-quote-final-letter-en"
    );

    const scroll = document.getElementById("title-memory-invitation-scroll");

    if (scroll) {
      scroll.scrollTop = 0;
    }

    return true;
  }

  /*
    The existing bilingual invitation system rebuilds the box whenever
    the language is toggled. This quietly restores the final English
    version whenever the English view appears.
  */
  window.setInterval(replaceEnglishInvitationIfNeeded, 350);

  document.addEventListener(
    "click",
    event => {
      if (
        event.target &&
        event.target.closest &&
        event.target.closest("#title-memory-language-toggle")
      ) {
        window.setTimeout(replaceEnglishInvitationIfNeeded, 40);
        window.setTimeout(replaceEnglishInvitationIfNeeded, 180);
        window.setTimeout(replaceEnglishInvitationIfNeeded, 420);
      }
    },
    true
  );

  window.setTimeout(replaceEnglishInvitationIfNeeded, 300);
  window.setTimeout(replaceEnglishInvitationIfNeeded, 1000);
  window.setTimeout(replaceEnglishInvitationIfNeeded, 1800);
})();
/* ==========================================================
   BLINKING-I INVITATION — FORCE ENGLISH LEFT-TO-RIGHT

   Goal:
   - English invitation text is always left-to-right.
   - English paragraphs align left.
   - Persian invitation remains right-to-left.
   - Does not change the actual English or Persian text.

   Paste at the VERY BOTTOM of script.js.
   ========================================================== */

(function forceEnglishInvitationLeftToRight() {
  if (window.__mgEnglishInvitationLtrLockReady) {
    return;
  }

  window.__mgEnglishInvitationLtrLockReady = true;

  function getQuoteBox() {
    return document.getElementById("title-memory-quote");
  }

  function getScrollBox() {
    return document.getElementById("title-memory-invitation-scroll");
  }

  function getEnglishInner() {
    return document.querySelector(
      "#title-memory-quote .title-memory-invitation-inner-en"
    );
  }

  function getPersianInner() {
    return document.querySelector(
      "#title-memory-quote .title-memory-invitation-inner-fa"
    );
  }

  function elementLooksVisible(element) {
    if (!element) {
      return false;
    }

    const style = window.getComputedStyle(element);

    return (
      !element.hidden &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity || 1) !== 0
    );
  }

  function isEnglishMode(box, enInner, faInner) {
    if (!box) {
      return false;
    }

    return (
      box.dataset.language === "en" ||
      box.getAttribute("lang") === "en" ||
      box.getAttribute("dir") === "ltr" ||
      box.classList.contains("title-memory-quote-english") ||
      (
        elementLooksVisible(enInner) &&
        !elementLooksVisible(faInner)
      )
    );
  }

  function isPersianMode(box, enInner, faInner) {
    if (!box) {
      return false;
    }

    return (
      box.dataset.language === "fa" ||
      box.getAttribute("lang") === "fa" ||
      box.getAttribute("dir") === "rtl" ||
      (
        elementLooksVisible(faInner) &&
        !elementLooksVisible(enInner)
      )
    );
  }

  function lockElementDirection(element, direction, language, align) {
    if (!element) {
      return;
    }

    element.setAttribute("dir", direction);
    element.setAttribute("lang", language);

    element.style.direction = direction;
    element.style.textAlign = align;
    element.style.unicodeBidi = "isolate";
    element.style.writingMode = "horizontal-tb";

    element.querySelectorAll("p, strong, em, span, h1, h2, h3, div").forEach(child => {
      child.setAttribute("dir", direction);
      child.style.direction = direction;
      child.style.textAlign = align;
      child.style.unicodeBidi = "isolate";
      child.style.writingMode = "horizontal-tb";
    });
  }

  function applyDirectionLock() {
    const box = getQuoteBox();
    const scroll = getScrollBox();
    const enInner = getEnglishInner();
    const faInner = getPersianInner();

    if (!box) {
      return;
    }

    /*
      Always keep each language's own inner content correctly directed.
    */
    lockElementDirection(enInner, "ltr", "en", "left");
    lockElementDirection(faInner, "rtl", "fa", "right");

    if (isEnglishMode(box, enInner, faInner)) {
      box.classList.add("title-memory-quote-english");
      box.classList.add("title-memory-quote-ltr-locked");
      box.classList.remove("title-memory-quote-rtl-active");

      box.setAttribute("dir", "ltr");
      box.setAttribute("lang", "en");

      if (scroll) {
        scroll.setAttribute("dir", "ltr");
        scroll.setAttribute("lang", "en");
        scroll.style.direction = "ltr";
        scroll.style.textAlign = "left";
        scroll.style.unicodeBidi = "isolate";
      }
    } else if (isPersianMode(box, enInner, faInner)) {
      box.classList.remove("title-memory-quote-english");
      box.classList.remove("title-memory-quote-ltr-locked");
      box.classList.add("title-memory-quote-rtl-active");

      box.setAttribute("dir", "rtl");
      box.setAttribute("lang", "fa");

      if (scroll) {
        scroll.setAttribute("dir", "rtl");
        scroll.setAttribute("lang", "fa");
        scroll.style.direction = "rtl";
        scroll.style.textAlign = "right";
        scroll.style.unicodeBidi = "isolate";
      }
    }
  }

  /*
    The invitation box is rebuilt by older patches when toggling language,
    so repeat gently instead of using a heavy observer.
  */
  window.setInterval(applyDirectionLock, 250);

  document.addEventListener(
    "click",
    event => {
      if (
        event.target &&
        event.target.closest &&
        event.target.closest("#title-memory-language-toggle")
      ) {
        window.setTimeout(applyDirectionLock, 20);
        window.setTimeout(applyDirectionLock, 100);
        window.setTimeout(applyDirectionLock, 260);
        window.setTimeout(applyDirectionLock, 520);
      }
    },
    true
  );

  window.setTimeout(applyDirectionLock, 250);
  window.setTimeout(applyDirectionLock, 900);
  window.setTimeout(applyDirectionLock, 1600);
})();
/* ==========================================================
   SEPARATE SUBTITLES FROM TEXT TRANSLATION

   Fixes:
   - translation_en no longer appears in the bottom subtitle box.
   - subtitle box uses only subtitle_cues_en or subtitle_en.
   - right-side submitted-fragment panel uses:
       فارسی  -> Persian submitted text / transcript_fa / quote
       English -> translation_en
   - Works for this Qazvin entry and future Persian text submissions.

   Paste at the VERY BOTTOM of script.js.
   ========================================================== */

(function separateSubtitlesFromPanelTranslation() {
  if (window.__mgSeparateSubtitlesFromTranslationReady) {
    return;
  }

  window.__mgSeparateSubtitlesFromTranslationReady = true;

  const PANEL_ID = "mg-unified-media-panel";

  const state = {
    rowsById: new Map(),
    hydratedAt: 0,
    hydrating: false
  };

  function clean(value) {
    return String(value || "").trim();
  }

  function hasPersian(value) {
    return /[\u0600-\u06FF]/.test(String(value || ""));
  }

  function isPlaceholder(value) {
    const text = clean(value).toLowerCase();

    return (
      !text ||
      text === "no story text yet." ||
      text === "click a blinking point outside iran. the map will carry the call back home."
    );
  }

  function normalizeSubtitleInput(value) {
    return String(value || "")
      .replace(/\r/g, "")
      .replace(/\\n/g, "\n")
      .replace(/\uFEFF/g, "")
      .trim();
  }

  function parseSubtitleTimeSafe(value) {
    if (typeof parseSubtitleTime === "function") {
      return parseSubtitleTime(value);
    }

    const text = String(value || "")
      .trim()
      .replace(",", ".");

    if (/^\d+(\.\d+)?$/.test(text)) {
      return Number(text);
    }

    const parts = text.split(":").map(Number);

    if (parts.some(part => !Number.isFinite(part))) {
      return NaN;
    }

    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }

    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }

    return NaN;
  }

  function parseSrtOrVttCuesSafe(value) {
    const text = normalizeSubtitleInput(value)
      .replace(/^WEBVTT[^\n]*\n+/i, "");

    if (!text.includes("-->")) {
      return [];
    }

    const blocks = text
      .split(/\n{2,}/)
      .map(block => block.trim())
      .filter(Boolean);

    const cues = [];

    blocks.forEach(block => {
      let lines = block
        .split("\n")
        .map(line => line.trim())
        .filter(Boolean);

      if (!lines.length) {
        return;
      }

      if (/^\d+$/.test(lines[0])) {
        lines = lines.slice(1);
      }

      const timeLineIndex = lines.findIndex(line => line.includes("-->"));

      if (timeLineIndex === -1) {
        return;
      }

      const timeLine = lines[timeLineIndex];
      const textLines = lines.slice(timeLineIndex + 1);

      if (!textLines.length) {
        return;
      }

      const timeParts = timeLine.split(/\s*-->\s*/);

      if (timeParts.length < 2) {
        return;
      }

      const start = parseSubtitleTimeSafe(timeParts[0]);
      const end = parseSubtitleTimeSafe(String(timeParts[1] || "").split(/\s+/)[0]);

      const cueText = textLines
        .join(" ")
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();

      if (
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        end > start &&
        cueText
      ) {
        cues.push({
          start,
          end,
          text: cueText
        });
      }
    });

    return cues;
  }

  function parsePipeCuesSafe(value) {
    const text = normalizeSubtitleInput(value);

    if (!text) {
      return [];
    }

    return text
      .split(/\n+/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const parts = line.split("|");

        if (parts.length < 2) {
          return null;
        }

        const timePart = parts[0].trim();
        const cueText = parts.slice(1).join("|").trim();

        if (!timePart || !cueText) {
          return null;
        }

        const timeParts = timePart.split(/\s*(?:-->|[-–—])\s*/);

        if (timeParts.length < 2) {
          return null;
        }

        const start = parseSubtitleTimeSafe(timeParts[0]);
        const end = parseSubtitleTimeSafe(timeParts[1]);

        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
          return null;
        }

        return {
          start,
          end,
          text: cueText
        };
      })
      .filter(Boolean);
  }

  function parseSubtitleOnly(value) {
    const text = normalizeSubtitleInput(value);

    if (!text) {
      return [];
    }

    if (text.includes("-->")) {
      return parseSrtOrVttCuesSafe(text);
    }

    return parsePipeCuesSafe(text);
  }

  /*
    IMPORTANT:
    This replaces the old subtitle logic.
    It deliberately DOES NOT use story.translationEn.
  */
  startMapSubtitles = function separatedStartMapSubtitles(story) {
    const subtitleOverlay = ensureMapSubtitleOverlay();

    if (window.__mgSubtitleTicker) {
      window.clearInterval(window.__mgSubtitleTicker);
      window.__mgSubtitleTicker = null;
    }

    activeSubtitleCues = [];
    activeFallbackSubtitle = "";

    if (!story) {
      hideMapSubtitles();
      return;
    }

    activeSubtitleCues = parseSubtitleOnly(story.subtitleCuesEn);

    if (!activeSubtitleCues.length) {
      activeSubtitleCues = parseSubtitleOnly(story.subtitleEn);
    }

    /*
      Plain subtitle_en can still be used as non-timed subtitle text.
      translation_en must NOT appear here.
    */
    if (!activeSubtitleCues.length) {
      activeFallbackSubtitle = clean(story.subtitleEn);
    }

    if (!activeSubtitleCues.length && !activeFallbackSubtitle) {
      hideMapSubtitles();
      return;
    }

    subtitleOverlay.textContent = "";
    subtitleOverlay.classList.add("visible");

    audio.removeEventListener("timeupdate", updateMapSubtitleText);
    audio.removeEventListener("play", updateMapSubtitleText);
    audio.removeEventListener("playing", updateMapSubtitleText);
    audio.removeEventListener("seeked", updateMapSubtitleText);
    audio.removeEventListener("loadedmetadata", updateMapSubtitleText);
    audio.removeEventListener("canplay", updateMapSubtitleText);

    audio.addEventListener("timeupdate", updateMapSubtitleText);
    audio.addEventListener("play", updateMapSubtitleText);
    audio.addEventListener("playing", updateMapSubtitleText);
    audio.addEventListener("seeked", updateMapSubtitleText);
    audio.addEventListener("loadedmetadata", updateMapSubtitleText);
    audio.addEventListener("canplay", updateMapSubtitleText);

    updateMapSubtitleText();

    window.__mgSubtitleTicker = window.setInterval(() => {
      if (!audio || audio.paused || audio.ended) {
        return;
      }

      updateMapSubtitleText();
    }, 140);
  };

  updateMapSubtitleText = function separatedUpdateMapSubtitleText() {
    const subtitleOverlay = ensureMapSubtitleOverlay();

    if (!activeSubtitleCues.length && !activeFallbackSubtitle) {
      hideMapSubtitles();
      return;
    }

    const currentTime = Number(audio.currentTime || 0);

    if (activeSubtitleCues.length) {
      const activeCue = activeSubtitleCues.find(cue => {
        return currentTime >= cue.start && currentTime < cue.end;
      });

      if (activeCue) {
        subtitleOverlay.textContent = activeCue.text;
        subtitleOverlay.classList.add("visible");
      } else {
        subtitleOverlay.textContent = "";
        subtitleOverlay.classList.remove("visible");
      }

      return;
    }

    subtitleOverlay.textContent = activeFallbackSubtitle;
    subtitleOverlay.classList.add("visible");
  };

  function storyId(story) {
    return clean(story && story.id);
  }

  function applyRowLanguageFieldsToStory(story, row) {
    if (!story || !row) {
      return story;
    }

    const translationEn = clean(
      row.translation_en ||
      row.translationEn ||
      row.english_translation ||
      ""
    );

    const transcriptFa = clean(
      row.transcript_fa ||
      row.transcriptFa ||
      row.persian_text ||
      row.persian_transcript ||
      ""
    );

    const textFragment = clean(
      row.text_fragment ||
      row.submitted_text ||
      row.full_text ||
      row.quote ||
      ""
    );

    const contentLanguage = clean(
      row.content_language ||
      row.contentLanguage ||
      ""
    );

    const translationStatus = clean(
      row.translation_status ||
      row.translationStatus ||
      ""
    );

    if (translationEn) {
      story.translationEn = translationEn;
      story.translation_en = translationEn;
    }

    if (transcriptFa) {
      story.transcriptFa = transcriptFa;
      story.transcript_fa = transcriptFa;
    }

    if (textFragment) {
      story.textFragment = story.textFragment || textFragment;
      story.submittedText = story.submittedText || textFragment;

      if (hasPersian(textFragment) && !clean(story.transcriptFa)) {
        story.transcriptFa = textFragment;
        story.transcript_fa = textFragment;
      }
    }

    if (contentLanguage) {
      story.contentLanguage = contentLanguage;
      story.content_language = contentLanguage;
    }

    if (translationStatus) {
      story.translationStatus = translationStatus;
      story.translation_status = translationStatus;
    }

    return story;
  }

  if (typeof rowToStory === "function" && !window.__mgSeparatedTranslationRowWrapped) {
    const previousRowToStory = rowToStory;

    rowToStory = function separatedTranslationRowToStory(row) {
      const story = previousRowToStory(row);

      if (story) {
        applyRowLanguageFieldsToStory(story, row);
      }

      return story;
    };

    window.__mgSeparatedTranslationRowWrapped = true;
  }

  async function hydrateRows() {
    if (
      state.hydrating ||
      typeof d3 === "undefined" ||
      !d3.csv ||
      typeof PUBLIC_MAP_CSV_URL === "undefined" ||
      !PUBLIC_MAP_CSV_URL
    ) {
      return;
    }

    const now = Date.now();

    if (now - state.hydratedAt < 300000) {
      return;
    }

    state.hydrating = true;
    state.hydratedAt = now;

    try {
      const rows = await window.__mgSharedCsv(`${PUBLIC_MAP_CSV_URL}&languageBoxHydrate=${now}`);

      rows.forEach(row => {
        const id = clean(row.id);

        if (id) {
          state.rowsById.set(id, row);
        }
      });

      if (Array.isArray(stories)) {
        stories.forEach(story => {
          const row = state.rowsById.get(storyId(story));

          if (row) {
            applyRowLanguageFieldsToStory(story, row);
          }
        });
      }

      if (typeof activeStory !== "undefined" && activeStory) {
        const row = state.rowsById.get(storyId(activeStory));

        if (row) {
          applyRowLanguageFieldsToStory(activeStory, row);
        }
      }

      repairRightSideLanguageBox();
    } catch (error) {
      console.warn("Missing Geographies: could not hydrate translation fields.", error);
    } finally {
      state.hydrating = false;
    }
  }

  function getPanel() {
    return document.getElementById(PANEL_ID);
  }

  function panelIsVisible(panel) {
    return Boolean(
      panel &&
      panel.classList.contains("visible") &&
      panel.getAttribute("aria-hidden") !== "true"
    );
  }

  function getPanelStory(panel) {
    if (!panel) {
      return null;
    }

    const panelStoryId = clean(panel.dataset.storyId);

    if (typeof activeStory !== "undefined" && activeStory) {
      if (!panelStoryId || panelStoryId === clean(activeStory.id)) {
        const row = state.rowsById.get(clean(activeStory.id));

        if (row) {
          applyRowLanguageFieldsToStory(activeStory, row);
        }

        return activeStory;
      }
    }

    if (Array.isArray(stories) && panelStoryId) {
      const found = stories.find(story => clean(story.id) === panelStoryId);

      if (found) {
        const row = state.rowsById.get(panelStoryId);

        if (row) {
          applyRowLanguageFieldsToStory(found, row);
        }

        return found;
      }
    }

    return null;
  }

  function getMainSubmittedText(story) {
    const candidates = [
      story && story.submittedText,
      story && story.textFragment,
      story && story.fullText,
      story && story.quote
    ]
      .map(clean)
      .filter(text => !isPlaceholder(text))
      .filter(text => !/^https?:\/\//i.test(text));

    candidates.sort((a, b) => b.length - a.length);

    return candidates[0] || "";
  }

  function getTextVariants(story) {
    if (!story) {
      return {
        en: "",
        fa: "",
        defaultLanguage: "en"
      };
    }

    const mainText = getMainSubmittedText(story);

    let en = clean(story.translationEn || story.translation_en);
    let fa = clean(story.transcriptFa || story.transcript_fa);

    if (mainText) {
      if (hasPersian(mainText)) {
        if (!fa) {
          fa = mainText;
        }
      } else if (!en) {
        en = mainText;
      }
    }

    const contentLanguage = clean(
      story.contentLanguage ||
      story.content_language
    ).toLowerCase();

    let defaultLanguage = "en";

    if (
      contentLanguage.includes("fa") ||
      contentLanguage.includes("farsi") ||
      contentLanguage.includes("persian") ||
      hasPersian(mainText) ||
      (!en && fa)
    ) {
      defaultLanguage = "fa";
    }

    return {
      en,
      fa,
      defaultLanguage
    };
  }

  function ensureTextSection(panel) {
    const body = panel && panel.querySelector(".mg-unified-media-body");

    if (!body) {
      return null;
    }

    let section = panel.querySelector(".mg-unified-media-text-section");

    if (!section) {
      section = document.createElement("section");
      section.className = "mg-unified-media-section mg-unified-media-text-section";
      body.appendChild(section);
    }

    let text = section.querySelector(".mg-unified-media-text");

    if (!text) {
      text = document.createElement("div");
      text.className = "mg-unified-media-text";
      section.appendChild(text);
    }

    return text;
  }

  function ensureToolbar(panel, variants) {
    const textElement = ensureTextSection(panel);

    if (!textElement) {
      return null;
    }

    const section = textElement.closest(".mg-unified-media-text-section");

    if (!section) {
      return null;
    }

    let toolbar = section.querySelector(".mg-unified-media-language-toolbar");

    if (!toolbar) {
      toolbar = document.createElement("div");
      toolbar.className =
        "mg-unified-media-language-toolbar mg-unified-media-language-toolbar-text-top";
      toolbar.setAttribute("aria-label", "Fragment language");

      toolbar.innerHTML = `
        <button
          class="mg-unified-media-lang-button"
          type="button"
          data-media-language="en"
          aria-label="Show English text"
        >English</button>

        <button
          class="mg-unified-media-lang-button"
          type="button"
          data-media-language="fa"
          aria-label="Show Persian text"
        >فارسی</button>
      `;

      section.insertBefore(toolbar, textElement);
    } else if (toolbar.parentElement !== section) {
      section.insertBefore(toolbar, textElement);
    }

    toolbar.style.display = "";
    panel.classList.add("mg-unified-media-has-language");
    panel.classList.add("mg-unified-media-language-in-text");

    const enButton = toolbar.querySelector('[data-media-language="en"]');
    const faButton = toolbar.querySelector('[data-media-language="fa"]');

    if (enButton) {
      enButton.disabled = !variants.en;
      enButton.setAttribute("aria-disabled", variants.en ? "false" : "true");
      enButton.style.pointerEvents = variants.en ? "auto" : "";
    }

    if (faButton) {
      faButton.disabled = !variants.fa;
      faButton.setAttribute("aria-disabled", variants.fa ? "false" : "true");
      faButton.style.pointerEvents = variants.fa ? "auto" : "";
    }

    return toolbar;
  }

  function setPanelLanguage(panel, requestedLanguage) {
    const story = getPanelStory(panel);

    if (!panel || !story) {
      return;
    }

    const variants = getTextVariants(story);

    if (!variants.en && !variants.fa) {
      return;
    }

    ensureToolbar(panel, variants);

    let language =
      requestedLanguage ||
      panel.dataset.mediaLanguage ||
      variants.defaultLanguage;

    if (language === "en" && !variants.en) {
      language = "fa";
    }

    if (language === "fa" && !variants.fa) {
      language = "en";
    }

    const text = language === "fa" ? variants.fa : variants.en;

    if (!text) {
      return;
    }

    const textElement = ensureTextSection(panel);

    if (!textElement) {
      return;
    }

    textElement.textContent = text;

    if (language === "fa") {
      textElement.classList.add("mg-unified-media-text-fa");
      textElement.setAttribute("dir", "rtl");
      textElement.setAttribute("lang", "fa");
    } else {
      textElement.classList.remove("mg-unified-media-text-fa");
      textElement.setAttribute("dir", "ltr");
      textElement.setAttribute("lang", "en");
    }

    panel.dataset.mediaLanguage = language;

    panel.classList.toggle("mg-unified-media-language-fa", language === "fa");
    panel.classList.toggle("mg-unified-media-language-en", language === "en");

    panel
      .querySelectorAll(".mg-unified-media-lang-button")
      .forEach(button => {
        const isActive = clean(button.dataset.mediaLanguage) === language;

        button.classList.toggle("active", isActive);
        button.setAttribute("aria-pressed", isActive ? "true" : "false");
      });
  }

  function repairRightSideLanguageBox() {
    const panel = getPanel();

    if (!panelIsVisible(panel)) {
      return;
    }

    const story = getPanelStory(panel);

    if (!story) {
      return;
    }

    const variants = getTextVariants(story);

    if (!variants.en && !variants.fa) {
      return;
    }

    ensureToolbar(panel, variants);

    const current =
      clean(panel.dataset.mediaLanguage) ||
      variants.defaultLanguage;

    setPanelLanguage(panel, current);
  }

  document.addEventListener(
    "click",
    event => {
      const button =
        event.target &&
        event.target.closest &&
        event.target.closest(".mg-unified-media-lang-button");

      if (!button) {
        return;
      }

      const panel = button.closest("#mg-unified-media-panel");

      if (!panel) {
        return;
      }

      const language = clean(button.dataset.mediaLanguage);
      const story = getPanelStory(panel);
      const variants = getTextVariants(story);

      if (
        (language === "en" && variants.en) ||
        (language === "fa" && variants.fa)
      ) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        button.disabled = false;
        button.setAttribute("aria-disabled", "false");

        setPanelLanguage(panel, language);
      }
    },
    true
  );

  if (typeof playStoryAudio === "function" && !window.__mgSeparatedTranslationPlayWrapped) {
    const previousPlayStoryAudio = playStoryAudio;

    playStoryAudio = function separatedTranslationPlayStoryAudio(story) {
      const result = previousPlayStoryAudio.apply(this, arguments);

      /*
        If there is no real subtitle, make sure translation_en does not
        remain visible in the subtitle overlay from an older patch.
      */
      window.setTimeout(() => {
        if (
          activeStory &&
          story &&
          activeStory.id === story.id &&
          !clean(story.subtitleCuesEn) &&
          !clean(story.subtitleEn)
        ) {
          hideMapSubtitles();
        }
      }, 80);

      window.setTimeout(repairRightSideLanguageBox, 350);
      window.setTimeout(repairRightSideLanguageBox, 1200);

      return result;
    };

    window.__mgSeparatedTranslationPlayWrapped = true;
  }

  window.setInterval(() => {
    hydrateRows();
    repairRightSideLanguageBox();
  }, 650);

  window.setTimeout(hydrateRows, 250);
  window.setTimeout(hydrateRows, 1100);
  window.setTimeout(repairRightSideLanguageBox, 500);
  window.setTimeout(repairRightSideLanguageBox, 1600);
})();
/* ==========================================================
   FINAL FIX — RIGHT PANEL TRANSLATION SWITCH, NO SUBTITLE LEAK

   Fixes:
   - translation_en never appears in the bottom subtitle box.
   - English / فارسی switch in the right-side submitted-fragment
     panel works reliably.
   - Ignores older disabled language buttons.
   - Rebuilds the language switch directly above the text.
   - Uses PublicMapData fields:
       quote / text_fragment / transcript_fa / translation_en
   - Applies to all future submissions.

   Paste at the VERY BOTTOM of script.js.
   ========================================================== */

(function finalRightPanelTranslationSwitchFix() {
  if (window.__mgFinalRightPanelTranslationSwitchFixReady) {
    return;
  }

  window.__mgFinalRightPanelTranslationSwitchFixReady = true;

  const PANEL_ID = "mg-unified-media-panel";

  const state = {
    rowsById: new Map(),
    hydrating: false,
    hydratedAt: 0,
    lastPanelSignature: ""
  };

  function clean(value) {
    return String(value || "").trim();
  }

  function hasPersian(value) {
    return /[\u0600-\u06FF]/.test(String(value || ""));
  }

  function isPlaceholder(value) {
    const text = clean(value).toLowerCase();

    return (
      !text ||
      text === "no story text yet." ||
      text === "click a blinking point outside iran. the map will carry the call back home."
    );
  }

  function getAudioElement() {
    if (typeof audio !== "undefined" && audio) {
      return audio;
    }

    return document.getElementById("story-audio");
  }

  function ensureSubtitleOverlay() {
    if (typeof ensureMapSubtitleOverlay === "function") {
      return ensureMapSubtitleOverlay();
    }

    let overlay = document.getElementById("map-subtitle-overlay");

    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "map-subtitle-overlay";
      overlay.className = "map-subtitle-overlay";
      overlay.setAttribute("aria-live", "polite");

      const mapCard = document.querySelector(".map-card");

      if (mapCard) {
        mapCard.appendChild(overlay);
      } else {
        document.body.appendChild(overlay);
      }
    }

    return overlay;
  }

  function hideSubtitleOverlayHard() {
    const overlay = document.getElementById("map-subtitle-overlay");

    if (window.__mgSubtitleTicker) {
      window.clearInterval(window.__mgSubtitleTicker);
      window.__mgSubtitleTicker = null;
    }

    activeSubtitleCues = [];
    activeFallbackSubtitle = "";

    const audioElement = getAudioElement();

    if (audioElement && typeof updateMapSubtitleText === "function") {
      audioElement.removeEventListener("timeupdate", updateMapSubtitleText);
      audioElement.removeEventListener("play", updateMapSubtitleText);
      audioElement.removeEventListener("playing", updateMapSubtitleText);
      audioElement.removeEventListener("seeked", updateMapSubtitleText);
      audioElement.removeEventListener("loadedmetadata", updateMapSubtitleText);
      audioElement.removeEventListener("canplay", updateMapSubtitleText);
    }

    if (overlay) {
      overlay.textContent = "";
      overlay.classList.remove("visible");
    }
  }

  function normalizeSubtitleInput(value) {
    return String(value || "")
      .replace(/\r/g, "")
      .replace(/\\n/g, "\n")
      .replace(/\uFEFF/g, "")
      .trim();
  }

  function parseSubtitleTimeSafe(value) {
    const text = String(value || "")
      .trim()
      .replace(",", ".");

    if (/^\d+(\.\d+)?$/.test(text)) {
      return Number(text);
    }

    const parts = text.split(":").map(Number);

    if (parts.some(part => !Number.isFinite(part))) {
      return NaN;
    }

    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }

    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }

    return NaN;
  }

  function parseSrtOrVttCues(value) {
    const text = normalizeSubtitleInput(value)
      .replace(/^WEBVTT[^\n]*\n+/i, "");

    if (!text.includes("-->")) {
      return [];
    }

    const blocks = text
      .split(/\n{2,}/)
      .map(block => block.trim())
      .filter(Boolean);

    const cues = [];

    blocks.forEach(block => {
      let lines = block
        .split("\n")
        .map(line => line.trim())
        .filter(Boolean);

      if (!lines.length) {
        return;
      }

      if (/^\d+$/.test(lines[0])) {
        lines = lines.slice(1);
      }

      const timeIndex = lines.findIndex(line => line.includes("-->"));

      if (timeIndex === -1) {
        return;
      }

      const timeLine = lines[timeIndex];
      const textLines = lines.slice(timeIndex + 1);

      if (!textLines.length) {
        return;
      }

      const timeParts = timeLine.split(/\s*-->\s*/);

      if (timeParts.length < 2) {
        return;
      }

      const start = parseSubtitleTimeSafe(timeParts[0]);
      const end = parseSubtitleTimeSafe(String(timeParts[1] || "").split(/\s+/)[0]);
      const cueText = textLines
        .join(" ")
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();

      if (
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        end > start &&
        cueText
      ) {
        cues.push({
          start,
          end,
          text: cueText
        });
      }
    });

    return cues;
  }

  function parsePipeCues(value) {
    const text = normalizeSubtitleInput(value);

    if (!text) {
      return [];
    }

    return text
      .split(/\n+/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const parts = line.split("|");

        if (parts.length < 2) {
          return null;
        }

        const timePart = parts[0].trim();
        const cueText = parts.slice(1).join("|").trim();

        if (!timePart || !cueText) {
          return null;
        }

        const timeParts = timePart.split(/\s*(?:-->|[-–—])\s*/);

        if (timeParts.length < 2) {
          return null;
        }

        const start = parseSubtitleTimeSafe(timeParts[0]);
        const end = parseSubtitleTimeSafe(timeParts[1]);

        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
          return null;
        }

        return {
          start,
          end,
          text: cueText
        };
      })
      .filter(Boolean);
  }

  function parseSubtitleOnly(value) {
    const text = normalizeSubtitleInput(value);

    if (!text) {
      return [];
    }

    if (text.includes("-->")) {
      return parseSrtOrVttCues(text);
    }

    return parsePipeCues(text);
  }

  /*
    Final subtitle override:
    translation_en is NOT a subtitle.
    Bottom subtitle box may use only:
      - subtitle_cues_en
      - subtitle_en
  */
  startMapSubtitles = function finalNoTranslationSubtitleStart(story) {
    const overlay = ensureSubtitleOverlay();
    const audioElement = getAudioElement();

    hideSubtitleOverlayHard();

    if (!story || !audioElement) {
      return;
    }

    activeSubtitleCues = parseSubtitleOnly(story.subtitleCuesEn);

    if (!activeSubtitleCues.length) {
      activeSubtitleCues = parseSubtitleOnly(story.subtitleEn);
    }

    activeFallbackSubtitle = activeSubtitleCues.length
      ? ""
      : clean(story.subtitleEn);

    if (!activeSubtitleCues.length && !activeFallbackSubtitle) {
      hideSubtitleOverlayHard();
      return;
    }

    overlay.textContent = "";
    overlay.classList.add("visible");

    audioElement.addEventListener("timeupdate", updateMapSubtitleText);
    audioElement.addEventListener("play", updateMapSubtitleText);
    audioElement.addEventListener("playing", updateMapSubtitleText);
    audioElement.addEventListener("seeked", updateMapSubtitleText);
    audioElement.addEventListener("loadedmetadata", updateMapSubtitleText);
    audioElement.addEventListener("canplay", updateMapSubtitleText);

    updateMapSubtitleText();

    window.__mgSubtitleTicker = window.setInterval(() => {
      if (!audioElement || audioElement.paused || audioElement.ended) {
        return;
      }

      updateMapSubtitleText();
    }, 140);
  };

  updateMapSubtitleText = function finalNoTranslationSubtitleUpdate() {
    const overlay = ensureSubtitleOverlay();
    const audioElement = getAudioElement();

    if (!activeSubtitleCues.length && !activeFallbackSubtitle) {
      hideSubtitleOverlayHard();
      return;
    }

    const currentTime = Number(audioElement && audioElement.currentTime || 0);

    if (activeSubtitleCues.length) {
      const cue = activeSubtitleCues.find(item => {
        return currentTime >= item.start && currentTime < item.end;
      });

      if (cue) {
        overlay.textContent = cue.text;
        overlay.classList.add("visible");
      } else {
        overlay.textContent = "";
        overlay.classList.remove("visible");
      }

      return;
    }

    overlay.textContent = activeFallbackSubtitle;
    overlay.classList.add("visible");
  };

  hideMapSubtitles = hideSubtitleOverlayHard;

  function storyId(story) {
    return clean(story && story.id);
  }

  function getPanel() {
    return document.getElementById(PANEL_ID);
  }

  function panelVisible(panel) {
    return Boolean(
      panel &&
      panel.classList.contains("visible") &&
      panel.getAttribute("aria-hidden") !== "true"
    );
  }

  function applyRowToStory(story, row) {
    if (!story || !row) {
      return story;
    }

    const translationEn = clean(
      row.translation_en ||
      row.translationEn ||
      row.english_translation ||
      ""
    );

    const transcriptFa = clean(
      row.transcript_fa ||
      row.transcriptFa ||
      row.persian_text ||
      row.persian_transcript ||
      ""
    );

    const quote = clean(
      row.text_fragment ||
      row.submitted_text ||
      row.full_text ||
      row.quote ||
      ""
    );

    const contentLanguage = clean(
      row.content_language ||
      row.contentLanguage ||
      ""
    );

    const translationStatus = clean(
      row.translation_status ||
      row.translationStatus ||
      ""
    );

    if (translationEn) {
      story.translationEn = translationEn;
      story.translation_en = translationEn;
    }

    if (transcriptFa) {
      story.transcriptFa = transcriptFa;
      story.transcript_fa = transcriptFa;
    }

    if (quote) {
      story.quote = story.quote || quote;
      story.textFragment = story.textFragment || quote;
      story.submittedText = story.submittedText || quote;

      if (hasPersian(quote) && !clean(story.transcriptFa)) {
        story.transcriptFa = quote;
        story.transcript_fa = quote;
      }
    }

    if (contentLanguage) {
      story.contentLanguage = contentLanguage;
      story.content_language = contentLanguage;
    }

    if (translationStatus) {
      story.translationStatus = translationStatus;
      story.translation_status = translationStatus;
    }

    return story;
  }

  if (typeof rowToStory === "function" && !window.__mgFinalTranslationRowWrapped) {
    const previousRowToStory = rowToStory;

    rowToStory = function finalTranslationRowToStory(row) {
      const story = previousRowToStory(row);

      if (story) {
        applyRowToStory(story, row);
      }

      return story;
    };

    window.__mgFinalTranslationRowWrapped = true;
  }

  async function hydrateRows() {
    if (
      state.hydrating ||
      typeof d3 === "undefined" ||
      !d3.csv ||
      typeof PUBLIC_MAP_CSV_URL === "undefined" ||
      !PUBLIC_MAP_CSV_URL
    ) {
      return;
    }

    const now = Date.now();

    if (now - state.hydratedAt < 300000) {
      return;
    }

    state.hydrating = true;
    state.hydratedAt = now;

    try {
      const rows = await window.__mgSharedCsv(`${PUBLIC_MAP_CSV_URL}&translationPanelHydrate=${now}`);

      rows.forEach(row => {
        const id = clean(row.id);

        if (id) {
          state.rowsById.set(id, row);
        }
      });

      if (Array.isArray(stories)) {
        stories.forEach(story => {
          const row = state.rowsById.get(storyId(story));

          if (row) {
            applyRowToStory(story, row);
          }
        });
      }

      if (typeof activeStory !== "undefined" && activeStory) {
        const row = state.rowsById.get(storyId(activeStory));

        if (row) {
          applyRowToStory(activeStory, row);
        }
      }

      repairPanel();
    } catch (error) {
      console.warn("Missing Geographies: translation panel hydration failed.", error);
    } finally {
      state.hydrating = false;
    }
  }

  function getCurrentStoryForPanel() {
    /*
      Be intentionally forgiving here.
      Older patches sometimes leave panel.dataset.storyId stale.
      The visible panel is about the active story, so use activeStory first.
    */
    if (typeof activeStory !== "undefined" && activeStory) {
      const row = state.rowsById.get(storyId(activeStory));

      if (row) {
        applyRowToStory(activeStory, row);
      }

      return activeStory;
    }

    const panel = getPanel();
    const panelStoryId = clean(panel && panel.dataset.storyId);

    if (panelStoryId && Array.isArray(stories)) {
      const found = stories.find(story => storyId(story) === panelStoryId);

      if (found) {
        const row = state.rowsById.get(panelStoryId);

        if (row) {
          applyRowToStory(found, row);
        }

        return found;
      }
    }

    return null;
  }

  function getMainText(story) {
    const candidates = [
      story && story.transcriptFa,
      story && story.transcript_fa,
      story && story.submittedText,
      story && story.textFragment,
      story && story.fullText,
      story && story.quote
    ]
      .map(clean)
      .filter(text => !isPlaceholder(text))
      .filter(text => !/^https?:\/\//i.test(text));

    candidates.sort((a, b) => b.length - a.length);

    return candidates[0] || "";
  }

  function getVariants(story) {
    const mainText = getMainText(story);

    let en = clean(
      story &&
      (
        story.translationEn ||
        story.translation_en ||
        story.englishTranslation
      )
    );

    let fa = clean(
      story &&
      (
        story.transcriptFa ||
        story.transcript_fa
      )
    );

    if (mainText) {
      if (hasPersian(mainText)) {
        if (!fa) {
          fa = mainText;
        }
      } else if (!en) {
        en = mainText;
      }
    }

    const contentLanguage = clean(
      story &&
      (
        story.contentLanguage ||
        story.content_language
      )
    ).toLowerCase();

    const defaultLanguage =
      contentLanguage.includes("fa") ||
      contentLanguage.includes("persian") ||
      contentLanguage.includes("farsi") ||
      hasPersian(mainText)
        ? "fa"
        : "en";

    return {
      en,
      fa,
      defaultLanguage
    };
  }

  function ensureTextSection(panel) {
    const body = panel && panel.querySelector(".mg-unified-media-body");

    if (!body) {
      return null;
    }

    let section = panel.querySelector(".mg-unified-media-text-section");

    if (!section) {
      section = document.createElement("section");
      section.className = "mg-unified-media-section mg-unified-media-text-section";
      body.appendChild(section);
    }

    let text = section.querySelector(".mg-unified-media-text");

    if (!text) {
      text = document.createElement("div");
      text.className = "mg-unified-media-text";
      section.appendChild(text);
    }

    return section;
  }

  function removeOldToolbars(panel) {
    panel
      .querySelectorAll(".mg-unified-media-language-toolbar")
      .forEach(toolbar => {
        toolbar.remove();
      });
  }

  function buildToolbar(panel, section, variants) {
    removeOldToolbars(panel);

    const toolbar = document.createElement("div");
    toolbar.className =
      "mg-unified-media-language-toolbar mg-unified-media-language-toolbar-text-top mg-final-translation-toolbar";
    toolbar.setAttribute("aria-label", "Fragment language");

    toolbar.innerHTML = `
      <button
        class="mg-final-translation-lang-button"
        type="button"
        data-media-language="en"
        aria-label="Show English translation"
      >English</button>

      <button
        class="mg-final-translation-lang-button"
        type="button"
        data-media-language="fa"
        aria-label="Show Persian text"
      >فارسی</button>
    `;

    const text = section.querySelector(".mg-unified-media-text");

    if (text) {
      section.insertBefore(toolbar, text);
    } else {
      section.insertBefore(toolbar, section.firstChild);
    }

    const enButton = toolbar.querySelector('[data-media-language="en"]');
    const faButton = toolbar.querySelector('[data-media-language="fa"]');

    if (enButton) {
      enButton.dataset.available = variants.en ? "yes" : "no";
      enButton.setAttribute("aria-disabled", variants.en ? "false" : "true");
    }

    if (faButton) {
      faButton.dataset.available = variants.fa ? "yes" : "no";
      faButton.setAttribute("aria-disabled", variants.fa ? "false" : "true");
    }

    return toolbar;
  }

  function setPanelLanguage(panel, language) {
    const story = getCurrentStoryForPanel();

    if (!panel || !story) {
      return;
    }

    const variants = getVariants(story);

    if (!variants.en && !variants.fa) {
      return;
    }

    const section = ensureTextSection(panel);

    if (!section) {
      return;
    }

    let text = section.querySelector(".mg-unified-media-text");

    if (!text) {
      text = document.createElement("div");
      text.className = "mg-unified-media-text";
      section.appendChild(text);
    }

    buildToolbar(panel, section, variants);

    let nextLanguage = language || panel.dataset.mediaLanguage || variants.defaultLanguage;

    if (nextLanguage === "en" && !variants.en) {
      nextLanguage = "fa";
    }

    if (nextLanguage === "fa" && !variants.fa) {
      nextLanguage = "en";
    }

    const nextText = nextLanguage === "fa" ? variants.fa : variants.en;

    if (!nextText) {
      return;
    }

    text.textContent = nextText;

    if (nextLanguage === "fa") {
      text.classList.add("mg-unified-media-text-fa");
      text.setAttribute("dir", "rtl");
      text.setAttribute("lang", "fa");
    } else {
      text.classList.remove("mg-unified-media-text-fa");
      text.setAttribute("dir", "ltr");
      text.setAttribute("lang", "en");
    }

    panel.dataset.mediaLanguage = nextLanguage;

    panel.classList.add("mg-unified-media-has-language", "mg-unified-media-language-in-text");
    panel.classList.toggle("mg-unified-media-language-fa", nextLanguage === "fa");
    panel.classList.toggle("mg-unified-media-language-en", nextLanguage === "en");

    panel
      .querySelectorAll(".mg-final-translation-lang-button")
      .forEach(button => {
        const buttonLanguage = clean(button.dataset.mediaLanguage);
        const isActive = buttonLanguage === nextLanguage;
        const isAvailable = button.dataset.available === "yes";

        button.classList.toggle("active", isActive);
        button.classList.toggle("unavailable", !isAvailable);
        button.setAttribute("aria-pressed", isActive ? "true" : "false");
      });
  }

  function repairPanel() {
    const panel = getPanel();

    if (!panelVisible(panel)) {
      return;
    }

    const story = getCurrentStoryForPanel();

    if (!story) {
      return;
    }

    const variants = getVariants(story);

    if (!variants.en && !variants.fa) {
      return;
    }

    const signature = [
      storyId(story),
      variants.en,
      variants.fa,
      panel.dataset.mediaLanguage || ""
    ].join("||");

    /*
      Still apply often enough to beat older patches, but avoid needless
      text resetting if nothing has changed.
    */
    if (signature === state.lastPanelSignature) {
      const toolbar = panel.querySelector(".mg-final-translation-toolbar");

      if (toolbar) {
        return;
      }
    }

    state.lastPanelSignature = signature;

    const preferred =
      panel.dataset.mediaLanguage ||
      variants.defaultLanguage;

    setPanelLanguage(panel, preferred);
  }

  document.addEventListener(
    "click",
    event => {
      const button =
        event.target &&
        event.target.closest &&
        event.target.closest(".mg-final-translation-lang-button");

      if (!button) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (button.dataset.available !== "yes") {
        return;
      }

      const panel = button.closest("#mg-unified-media-panel");

      if (!panel) {
        return;
      }

      setPanelLanguage(panel, clean(button.dataset.mediaLanguage));
    },
    true
  );

  document.addEventListener(
    "pointerdown",
    event => {
      if (
        event.target &&
        event.target.closest &&
        event.target.closest(".mg-final-translation-lang-button")
      ) {
        event.stopPropagation();
      }
    },
    true
  );

  if (typeof playStoryAudio === "function" && !window.__mgFinalTranslationNoSubtitlePlayWrapped) {
    const previousPlayStoryAudio = playStoryAudio;

    playStoryAudio = function finalTranslationNoSubtitlePlayStoryAudio(story) {
      const result = previousPlayStoryAudio.apply(this, arguments);

      /*
        If there are no real subtitles, remove any translation text that
        an older patch may have pushed into the subtitle overlay.
      */
      window.setTimeout(() => {
        if (
          story &&
          typeof activeStory !== "undefined" &&
          activeStory &&
          activeStory.id === story.id &&
          !clean(story.subtitleCuesEn) &&
          !clean(story.subtitleEn)
        ) {
          hideSubtitleOverlayHard();
        }

        repairPanel();
      }, 80);

      window.setTimeout(repairPanel, 350);
      window.setTimeout(repairPanel, 900);
      window.setTimeout(repairPanel, 1600);

      return result;
    };

    window.__mgFinalTranslationNoSubtitlePlayWrapped = true;
  }

  if (typeof selectStory === "function" && !window.__mgFinalTranslationSelectWrapped) {
    const previousSelectStory = selectStory;

    selectStory = function finalTranslationSelectStory(story, options = {}) {
      const panel = getPanel();

      if (panel) {
        panel.dataset.mediaLanguage = "";
      }

      state.lastPanelSignature = "";

      return previousSelectStory.call(this, story, options);
    };

    window.__mgFinalTranslationSelectWrapped = true;
  }

  window.setInterval(() => {
    hydrateRows();
    repairPanel();
  }, 300);

  window.setTimeout(hydrateRows, 200);
  window.setTimeout(hydrateRows, 1000);
  window.setTimeout(repairPanel, 500);
  window.setTimeout(repairPanel, 1200);
})();
/* ==========================================================
   HARD FIX — RIGHT PANEL TRUE BILINGUAL TEXT

   Why:
   Older right-panel language patches are fighting each other.
   Some disable the English button before translation_en is available.
   Some rebuild the text section from only one "best" text.
   This patch stops relying on those old controls.

   Fixes:
   - Hides old right-panel language toolbar.
   - Hides old right-panel text section.
   - Creates a new hard bilingual text section.
   - فارسی shows transcript_fa or Persian quote/text_fragment.
   - English shows translation_en.
   - translation_en is never used as bottom subtitle text.
   - Applies to all future submissions.

   Paste at the VERY BOTTOM of script.js.
   ========================================================== */

// hardFixRightPanelTrueBilingualText: guard-disabled dead block removed during cleanup (guard pre-sets __mgHardRightPanelTrueBilingualTextReady=true, so this IIFE always early-returned)
/* ==========================================================
   NO-AUDIO STORIES — NO FAKE PLAYER + CONNECTED BUZZ ON IRAN ZOOM

   Fixes:
   1. Stories with no real audio_url no longer load/play
      assets/audio/story-001.wav.
   2. The audio dock no longer becomes active for no-audio stories.
   3. The short connected-call buzz is played with Web Audio, not the
      hidden <audio> element, so the play bar stays quiet.
   4. The connected buzz starts when the Iran zoom begins.
   5. Existing post-audio text/image/link reveal still works because
      we dispatch a synthetic "ended" event without playing fake audio.

   Paste at the VERY BOTTOM of script.js.
   ========================================================== */

(function fixNoAudioStoriesAndConnectedBuzzTiming() {
  if (window.__mgNoAudioStoryFixReady) {
    return;
  }

  window.__mgNoAudioStoryFixReady = true;

  const FALLBACK_AUDIO_RE = /(?:^|\/)assets\/audio\/story-001\.wav(?:[?#].*)?$/i;

  const state = {
    connectedBuzzNodes: null,
    lastBuzzKey: "",
    syntheticEndedSentForStory: new Set(),
    dockFightTimer: null
  };

  function clean(value) {
    return String(value || "").trim();
  }

  function isFallbackAudioUrl(value) {
    const src = clean(value);

    return (
      !src ||
      /^about:blank$/i.test(src) ||
      FALLBACK_AUDIO_RE.test(src) ||
      src === "story-001.wav"
    );
  }

  function hasRealStoryAudio(story) {
    if (!story) {
      return false;
    }

    const src = clean(story.audio || story.audioUrl || story.audio_url);

    return Boolean(src && !isFallbackAudioUrl(src));
  }

  function markStoryAudioReality(story, rawAudioUrl) {
    if (!story) {
      return story;
    }

    const raw = clean(rawAudioUrl);
    const existing = clean(story.audio);

    if (!raw || isFallbackAudioUrl(raw) || isFallbackAudioUrl(existing)) {
      story.audio = "";
      story.audioUrl = "";
      story.audio_url = "";
      story.hasRealAudio = false;
      story.noRealAudio = true;
      return story;
    }

    story.audio = raw;
    story.audioUrl = raw;
    story.audio_url = raw;
    story.hasRealAudio = true;
    story.noRealAudio = false;

    return story;
  }

  /*
    Fix future CSV-loaded stories at the source.
    The original rowToStory uses assets/audio/story-001.wav as fallback.
    This wrapper removes that fallback for rows with no real audio_url.
  */
  if (typeof rowToStory === "function" && !window.__mgNoAudioRowToStoryWrapped) {
    const previousRowToStory = rowToStory;

    rowToStory = function noFakeAudioRowToStory(row) {
      const story = previousRowToStory(row);

      if (!story) {
        return story;
      }

      const rawAudioUrl = clean(
        row.audio_url ||
        row.audio ||
        row.audioUrl ||
        ""
      );

      return markStoryAudioReality(story, rawAudioUrl);
    };

    window.__mgNoAudioRowToStoryWrapped = true;
  }

  function normalizeExistingStories() {
    if (!Array.isArray(stories)) {
      return;
    }

    stories.forEach(story => {
      if (!story) {
        return;
      }

      if (isFallbackAudioUrl(story.audio)) {
        markStoryAudioReality(story, "");
      }
    });
  }

  function getAudioElement() {
    if (typeof audio !== "undefined" && audio) {
      return audio;
    }

    return document.getElementById("story-audio");
  }

  function clearHiddenAudioElement() {
    const audioElement = getAudioElement();

    if (!audioElement) {
      return;
    }

    try {
      audioElement.pause();
    } catch (error) {}

    try {
      audioElement.currentTime = 0;
    } catch (error) {}

    audioElement.removeAttribute("src");
    audioElement.src = "";
    audioElement.dataset.mgRealStoryAudio = "no";

    try {
      audioElement.load();
    } catch (error) {}

    if (typeof hideMapSubtitles === "function") {
      try {
        hideMapSubtitles();
      } catch (error) {}
    }
  }

  function setDockNoAudioState(active) {
    const body = document.body;
    const dock = document.getElementById("audio-dock");
    const dockV2 = document.getElementById("mg-audio-dock-v2");

    body.classList.toggle("mg-active-story-no-real-audio", Boolean(active));

    [dock, dockV2].forEach(element => {
      if (!element) {
        return;
      }

      element.classList.toggle("mg-no-real-audio", Boolean(active));

      if (active) {
        element.classList.remove(
          "audio-dock-active",
          "audio-dock-playing",
          "mg-audio-dock-v2-active",
          "mg-audio-dock-v2-playing"
        );
      }
    });

    const controls = [
      document.getElementById("audio-back-10"),
      document.getElementById("audio-play-pause"),
      document.getElementById("audio-forward-10"),
      document.getElementById("audio-progress"),
      dockV2 && dockV2.querySelector(".mg-audio-dock-v2-back"),
      dockV2 && dockV2.querySelector(".mg-audio-dock-v2-play"),
      dockV2 && dockV2.querySelector(".mg-audio-dock-v2-forward"),
      dockV2 && dockV2.querySelector(".mg-audio-dock-v2-progress")
    ].filter(Boolean);

    controls.forEach(control => {
      control.disabled = Boolean(active);
      control.setAttribute("aria-disabled", active ? "true" : "false");
    });

    const baseProgress = document.getElementById("audio-progress");
    const baseTime = document.getElementById("audio-time");

    if (active && baseProgress) {
      baseProgress.value = "0";
      baseProgress.style.setProperty("--mg-audio-progress-percent", "0%");
    }

    if (active && baseTime) {
      baseTime.textContent = "0:00 / 0:00";
    }

    const v2Progress = dockV2 && dockV2.querySelector(".mg-audio-dock-v2-progress");
    const v2Time = dockV2 && dockV2.querySelector(".mg-audio-dock-v2-time");

    if (active && v2Progress) {
      v2Progress.value = "0";
      v2Progress.style.setProperty("--mg-audio-progress-percent", "0%");
    }

    if (active && v2Time) {
      v2Time.textContent = "0:00 / 0:00";
    }
  }

  function fightOldDockUpdatesIfNeeded() {
    const noAudioActive = Boolean(
      typeof activeStory !== "undefined" &&
      activeStory &&
      !hasRealStoryAudio(activeStory)
    );

    if (!noAudioActive) {
      return;
    }

    clearHiddenAudioElement();
    setDockNoAudioState(true);
  }

  function dispatchSyntheticAudioEndedForNoAudioStory(story) {
    if (!story || !story.id) {
      return;
    }

    const storyId = clean(story.id);

    if (state.syntheticEndedSentForStory.has(storyId)) {
      return;
    }

    state.syntheticEndedSentForStory.add(storyId);

    const audioElement = getAudioElement();

    if (!audioElement) {
      return;
    }

    /*
      Existing post-audio fragment logic listens for "ended".
      We send it without loading fake audio, so text/image/link panels can
      still open after arrival.
    */
    window.setTimeout(() => {
      if (
        typeof activeStory !== "undefined" &&
        activeStory &&
        clean(activeStory.id) === storyId
      ) {
        try {
          audioElement.dispatchEvent(new Event("ended"));
        } catch (error) {}
      }
    }, 80);
  }

  /*
    Override prepareStoryAudio:
    If there is no real submitted audio, do not load any src.
  */
  if (typeof prepareStoryAudio === "function" && !window.__mgNoAudioPrepareWrapped) {
    const previousPrepareStoryAudio = prepareStoryAudio;

    prepareStoryAudio = function noFakeAudioPrepareStoryAudio(story) {
      normalizeExistingStories();

      if (!hasRealStoryAudio(story)) {
        clearHiddenAudioElement();
        setDockNoAudioState(true);
        return;
      }

      setDockNoAudioState(false);

      const result = previousPrepareStoryAudio.apply(this, arguments);

      const audioElement = getAudioElement();

      if (audioElement) {
        audioElement.dataset.mgRealStoryAudio = "yes";
      }

      return result;
    };

    window.__mgNoAudioPrepareWrapped = true;
  }

  /*
    Override playStoryAudio:
    No-audio stories should not play the fallback audio or engage the dock.
  */
  if (typeof playStoryAudio === "function" && !window.__mgNoAudioPlayWrapped) {
    const previousPlayStoryAudio = playStoryAudio;

    playStoryAudio = function noFakeAudioPlayStoryAudio(story) {
      normalizeExistingStories();

      if (!hasRealStoryAudio(story)) {
        clearHiddenAudioElement();
        setDockNoAudioState(true);
        dispatchSyntheticAudioEndedForNoAudioStory(story);
        return;
      }

      setDockNoAudioState(false);
      return previousPlayStoryAudio.apply(this, arguments);
    };

    window.__mgNoAudioPlayWrapped = true;
  }

  /*
    Override stopAudio:
    Keep reset/idle clean.
  */
  if (typeof stopAudio === "function" && !window.__mgNoAudioStopWrapped) {
    const previousStopAudio = stopAudio;

    stopAudio = function noFakeAudioStopAudio() {
      const result = previousStopAudio.apply(this, arguments);

      const noAudioActive = Boolean(
        typeof activeStory !== "undefined" &&
        activeStory &&
        !hasRealStoryAudio(activeStory)
      );

      if (noAudioActive) {
        clearHiddenAudioElement();
        setDockNoAudioState(true);
      } else {
        setDockNoAudioState(false);
      }

      return result;
    };

    window.__mgNoAudioStopWrapped = true;
  }

  function stopConnectedBuzz() {
    const nodes = state.connectedBuzzNodes;

    if (!nodes) {
      return;
    }

    state.connectedBuzzNodes = null;

    const context = nodes.context;
    const now = context.currentTime;

    try {
      nodes.masterGain.gain.cancelScheduledValues(now);
      nodes.masterGain.gain.setValueAtTime(nodes.masterGain.gain.value || 0.0001, now);
      nodes.masterGain.gain.linearRampToValueAtTime(0.0001, now + 0.18);
    } catch (error) {}

    window.setTimeout(() => {
      ["oscA", "oscB"].forEach(key => {
        try {
          nodes[key].stop();
        } catch (error) {}

        try {
          nodes[key].disconnect();
        } catch (error) {}
      });

      try {
        nodes.filter.disconnect();
      } catch (error) {}

      try {
        nodes.masterGain.disconnect();
      } catch (error) {}
    }, 260);
  }

  function playConnectedBuzz() {
    stopConnectedBuzz();

    let context = null;

    try {
      if (typeof getAudioContext === "function") {
        context = getAudioContext();
      }
    } catch (error) {}

    if (!context) {
      return;
    }

    const start = () => {
      const now = context.currentTime + 0.025;

      const masterGain = context.createGain();
      masterGain.gain.setValueAtTime(0.0001, now);

      const filter = context.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(610, now);
      filter.Q.setValueAtTime(4.2, now);

      const oscA = context.createOscillator();
      oscA.type = "sine";
      oscA.frequency.setValueAtTime(610, now);

      const oscB = context.createOscillator();
      oscB.type = "sine";
      oscB.frequency.setValueAtTime(625, now);

      oscA.connect(filter);
      oscB.connect(filter);
      filter.connect(masterGain);
      masterGain.connect(context.destination);

      oscA.start(now);
      oscB.start(now);

      /*
        Old-phone connected tone:
        three delicate pulses over about two seconds.
        It is not attached to the HTML audio element, so the play bar stays idle.
      */
      const gain = masterGain.gain;
      const pulses = [0, 0.68, 1.36];

      pulses.forEach(offset => {
        const t = now + offset;

        gain.setValueAtTime(0.0001, t);
        gain.linearRampToValueAtTime(0.052, t + 0.045);
        gain.setValueAtTime(0.052, t + 0.21);
        gain.linearRampToValueAtTime(0.0001, t + 0.42);
      });

      state.connectedBuzzNodes = {
        context,
        masterGain,
        filter,
        oscA,
        oscB
      };

      window.setTimeout(stopConnectedBuzz, 2180);
    };

    if (context.state === "suspended") {
      context.resume()
        .then(start)
        .catch(() => {});
    } else {
      start();
    }
  }

  function maybePlayConnectedBuzzAtIranZoom() {
    if (
      typeof activeStory === "undefined" ||
      !activeStory ||
      hasRealStoryAudio(activeStory)
    ) {
      return;
    }

    if (typeof journeyPhase === "undefined" || journeyPhase !== "home-zoom") {
      return;
    }

    const tokenPart =
      typeof journeyToken !== "undefined"
        ? String(journeyToken)
        : "journey";

    const key = `${clean(activeStory.id)}::${tokenPart}`;

    if (state.lastBuzzKey === key) {
      return;
    }

    state.lastBuzzKey = key;

    /*
      The buzz begins exactly when the Iran zoom phase begins.
    */
    playConnectedBuzz();
  }

  /*
    Reset cleanup wrappers.
  */
  if (typeof resetView === "function" && !window.__mgNoAudioResetWrapped) {
    const previousResetView = resetView;

    resetView = function noAudioResetView() {
      stopConnectedBuzz();
      setDockNoAudioState(false);
      state.lastBuzzKey = "";
      state.syntheticEndedSentForStory.clear();

      return previousResetView.apply(this, arguments);
    };

    window.__mgNoAudioResetWrapped = true;
  }

  if (typeof goToIranView === "function" && !window.__mgNoAudioIranViewWrapped) {
    const previousGoToIranView = goToIranView;

    goToIranView = function noAudioIranView() {
      stopConnectedBuzz();
      setDockNoAudioState(false);
      state.lastBuzzKey = "";

      return previousGoToIranView.apply(this, arguments);
    };

    window.__mgNoAudioIranViewWrapped = true;
  }

  /*
    Main monitor:
    - keeps old dock patches from reactivating the player for no-audio rows
    - starts connected buzz at home-zoom
  */
  state.dockFightTimer = window.setInterval(() => {
    normalizeExistingStories();
    fightOldDockUpdatesIfNeeded();
    maybePlayConnectedBuzzAtIranZoom();
  }, 120);

  window.setTimeout(normalizeExistingStories, 250);
  window.setTimeout(normalizeExistingStories, 1000);
})();
/* ==========================================================
   RIGHT PANEL — LARGE READING VIEW FOR LONG TEXTS

   Goal:
   - Add a small enlarge/read button to the left of the close button
     in the right-side submitted-fragment panel.
   - Open long submitted text in a larger, elegant, scrollable reader.
   - Preserve current language/direction:
       English -> LTR
       Persian -> RTL
   - Works with:
       .mg-hard-bilingual-text
       .mg-unified-media-text
       older post-audio text panels
   - Applies to future long text submissions.
   - Does not change spreadsheet logic.

   Paste at the VERY BOTTOM of script.js.
   ========================================================== */

// installLargeSubmittedTextReader: guard-disabled dead block removed during cleanup (guard pre-sets __mgLargeSubmittedTextReaderReady=true, so this IIFE always early-returned)
/* ==========================================================
   FINAL FIX — IMAGE ABOVE TEXT + DOWN ARROW OPENS LARGE READER

   Goal:
   - If a submission has image + text, always show image first.
   - If the image was missing because the long text rebuilt the panel,
     repair/inject the image section from PublicMapData.
   - Keep long text preview clipped with a downward reading cue.
   - Clicking the down arrow opens the large text reader, not a tiny panel expansion.
   - Works for future submissions too.

   Paste at the VERY BOTTOM of script.js.
   ========================================================== */

// finalImageAboveTextAndReaderArrow: guard-disabled dead block removed during cleanup (guard pre-sets __mgFinalImageAboveTextAndReaderArrowReady=true, so this IIFE always early-returned)
/* ==========================================================
   PERFORMANCE MEDIA PANEL CONTROLLER

   Fixes:
   - Image appears above text.
   - Long text shows a down-arrow reading cue.
   - Down arrow opens the large reader.
   - English / فارسی switch remains available.
   - Image click opens an in-page image viewer.
   - No forever polling.
   - No whole-body MutationObserver.
   - CSV media fields are hydrated once per page load.

   Paste at the VERY BOTTOM of script.js.
   ========================================================== */

(function mgPerformanceMediaPanelController() {
  if (window.__mgPerformanceMediaPanelControllerReady) {
    return;
  }

  window.__mgPerformanceMediaPanelControllerReady = true;

  const PANEL_ID = "mg-unified-media-panel";
  const READER_ID = "mg-large-submitted-text-reader";
  const IMAGE_MODAL_ID = "mg-perf-image-modal";

  const state = {
    rowsById: new Map(),
    rowsPromise: null,
    languageByStoryId: new Map(),
    repairRaf: null
  };

  function clean(value) {
    return String(value || "").trim();
  }

  function hasPersian(value) {
    return /[\u0600-\u06FF]/.test(String(value || ""));
  }

  function normalizeMediaUrl(value) {
    if (typeof normalizeUrl === "function") {
      try {
        return clean(normalizeUrl(value));
      } catch (error) {}
    }

    const text = clean(value);

    if (!text) {
      return "";
    }

    if (/^https?:\/\//i.test(text)) {
      return text;
    }

    if (/^www\./i.test(text)) {
      return `https://${text}`;
    }

    return "";
  }

  function prepareImageUrl(value) {
    let url = normalizeMediaUrl(value);

    if (!url) {
      return "";
    }

    try {
      const parsed = new URL(url, window.location.href);

      if (/drive\.google\.com$/i.test(parsed.hostname)) {
        const fileMatch = parsed.pathname.match(/\/file\/d\/([^/]+)/);
        const id = fileMatch && fileMatch[1]
          ? fileMatch[1]
          : parsed.searchParams.get("id");

        if (id) {
          return `https://drive.google.com/uc?export=view&id=${id}`;
        }
      }

      if (/dropbox\.com$/i.test(parsed.hostname)) {
        parsed.searchParams.set("raw", "1");
        parsed.searchParams.delete("dl");
        return parsed.toString();
      }
    } catch (error) {}

    return url;
  }

  function looksLikeAudioUrl(url) {
    return /\.(mp3|wav|m4a|aac|ogg|oga|flac)(\?.*)?$/i.test(clean(url));
  }

  function looksLikeDocumentOrVideoUrl(url) {
    return /\.(pdf|doc|docx|zip|mp4|mov|avi|webm|mkv|ppt|pptx|xls|xlsx)(\?.*)?$/i.test(clean(url));
  }

  function looksLikeImageUrl(value, trustImageColumn = false) {
    const url = prepareImageUrl(value);

    if (!url) {
      return false;
    }

    if (/\.(jpg|jpeg|png|gif|webp|avif|svg)(\?.*)?$/i.test(url)) {
      return true;
    }

    if (
      /(storage\.tally\.so|drive\.google\.com|googleusercontent\.com|dropbox\.com|cloudinary\.com|supabase\.co)/i.test(url) &&
      !looksLikeAudioUrl(url) &&
      !looksLikeDocumentOrVideoUrl(url)
    ) {
      return true;
    }

    return Boolean(
      trustImageColumn &&
      /^https?:\/\//i.test(url) &&
      !looksLikeAudioUrl(url) &&
      !looksLikeDocumentOrVideoUrl(url)
    );
  }

  function getPanel() {
    return document.getElementById(PANEL_ID);
  }

  function panelIsVisible(panel) {
    return Boolean(
      panel &&
      panel.classList.contains("visible") &&
      panel.getAttribute("aria-hidden") !== "true"
    );
  }

  function getActiveStorySafe() {
    if (typeof activeStory !== "undefined" && activeStory) {
      return activeStory;
    }

    return null;
  }

  function storyIdForPanel(panel) {
    const panelStoryId = clean(panel && panel.dataset.storyId);

    if (panelStoryId) {
      return panelStoryId;
    }

    const story = getActiveStorySafe();

    return clean(story && story.id);
  }

  function storyForPanel(panel) {
    const id = storyIdForPanel(panel);
    const active = getActiveStorySafe();

    if (active && clean(active.id) === id) {
      return active;
    }

    if (Array.isArray(stories) && id) {
      return stories.find(story => clean(story && story.id) === id) || null;
    }

    return active || null;
  }

  function rowForPanel(panel) {
    const id = storyIdForPanel(panel);

    return id ? state.rowsById.get(id) || null : null;
  }

  function hydrateRowsOnce() {
    if (state.rowsPromise) {
      return state.rowsPromise;
    }

    if (
      typeof d3 === "undefined" ||
      !d3.csv ||
      typeof PUBLIC_MAP_CSV_URL === "undefined" ||
      !PUBLIC_MAP_CSV_URL
    ) {
      state.rowsPromise = Promise.resolve();
      return state.rowsPromise;
    }

    state.rowsPromise = d3
      .csv(`${PUBLIC_MAP_CSV_URL}&perfMediaPanel=${Date.now()}`)
      .then(rows => {
        rows.forEach(row => {
          const id = clean(row.id);

          if (id) {
            state.rowsById.set(id, row);
          }
        });

        if (Array.isArray(stories)) {
          stories.forEach(story => {
            const row = state.rowsById.get(clean(story && story.id));

            if (row) {
              applyRowToStory(story, row);
            }
          });
        }

        const active = getActiveStorySafe();

        if (active) {
          const row = state.rowsById.get(clean(active.id));

          if (row) {
            applyRowToStory(active, row);
          }
        }
      })
      .catch(error => {
        console.warn("Missing Geographies: could not hydrate media rows.", error);
      });

    return state.rowsPromise;
  }

  function firstPreparedImageUrl(values, trustImageColumn) {
    for (let i = 0; i < values.length; i++) {
      const url = prepareImageUrl(values[i]);

      if (url && looksLikeImageUrl(url, trustImageColumn)) {
        return url;
      }
    }

    return "";
  }

  function imageUrlForStoryAndRow(story, row) {
    const directImage = firstPreparedImageUrl(
      [
        story && story.imageUrl,
        story && story.image_url,
        story && story.photoUrl,
        story && story.photo_url,
        row && row.image_url,
        row && row.photo_url,
        row && row.image,
        row && row.photo,
        row && row.uploaded_image,
        row && row.image_file
      ],
      true
    );

    if (directImage) {
      return directImage;
    }

    return firstPreparedImageUrl(
      [
        story && story.fileOrLink,
        story && story.file_or_link,
        row && row.file_or_link,
        row && row.file,
        row && row.upload,
        row && row.attachment,
        row && row.submitted_file
      ],
      false
    );
  }

  function externalLinkForStoryAndRow(story, row) {
    const imageUrl = imageUrlForStoryAndRow(story, row);

    const candidates = [
      story && story.externalLink,
      story && story.external_link,
      story && story.linkUrl,
      story && story.link_url,
      row && row.external_link,
      row && row.link_url,
      row && row.link,
      row && row.url,
      story && story.fileOrLink,
      story && story.file_or_link,
      row && row.file_or_link
    ];

    for (let i = 0; i < candidates.length; i++) {
      const url = normalizeMediaUrl(candidates[i]);

      if (!url || url === imageUrl || looksLikeAudioUrl(url)) {
        continue;
      }

      if (!looksLikeImageUrl(url, false)) {
        return url;
      }
    }

    return "";
  }

  function applyRowToStory(story, row) {
    if (!story || !row) {
      return story;
    }

    const imageUrl = imageUrlForStoryAndRow(story, row);
    const externalLink = externalLinkForStoryAndRow(story, row);

    const textFragment = clean(
      row.text_fragment ||
      row.submitted_text ||
      row.full_text ||
      row.quote ||
      ""
    );

    const translationEn = clean(
      row.translation_en ||
      row.translationEn ||
      row.english_translation ||
      ""
    );

    const transcriptFa = clean(
      row.transcript_fa ||
      row.transcriptFa ||
      row.persian_text ||
      row.persian_transcript ||
      ""
    );

    const contentLanguage = clean(
      row.content_language ||
      row.contentLanguage ||
      ""
    );

    if (imageUrl) {
      story.imageUrl = imageUrl;
      story.image_url = imageUrl;
    }

    if (externalLink) {
      story.externalLink = externalLink;
      story.external_link = externalLink;
    }

    if (textFragment) {
      story.textFragment = story.textFragment || textFragment;
      story.submittedText = story.submittedText || textFragment;
      story.quote = story.quote || textFragment;
    }

    if (translationEn) {
      story.translationEn = translationEn;
      story.translation_en = translationEn;
    }

    if (transcriptFa) {
      story.transcriptFa = transcriptFa;
      story.transcript_fa = transcriptFa;
    }

    if (contentLanguage) {
      story.contentLanguage = contentLanguage;
      story.content_language = contentLanguage;
    }

    if (!story.fileOrLink) {
      story.fileOrLink = imageUrl || externalLink || "";
    }

    return story;
  }

  function panelTitle(panel) {
    const title =
      panel &&
      (
        panel.querySelector(".mg-unified-media-title") ||
        panel.querySelector(".story-post-audio-fragment-title")
      );

    return clean(title && title.textContent) || "Submitted fragment";
  }

  function getTextVariants(panel) {
    const story = storyForPanel(panel);
    const row = rowForPanel(panel);

    if (story && row) {
      applyRowToStory(story, row);
    }

    const mainText = clean(
      (row && (row.text_fragment || row.submitted_text || row.full_text || row.quote)) ||
      (story && (story.textFragment || story.submittedText || story.fullText || story.quote)) ||
      ""
    );

    const translationEn = clean(
      (row && (row.translation_en || row.translationEn || row.english_translation)) ||
      (story && (story.translationEn || story.translation_en || story.englishTranslation)) ||
      ""
    );

    let transcriptFa = clean(
      (row && (row.transcript_fa || row.transcriptFa || row.persian_text || row.persian_transcript)) ||
      (story && (story.transcriptFa || story.transcript_fa)) ||
      ""
    );

    if (!transcriptFa && hasPersian(mainText)) {
      transcriptFa = mainText;
    }

    let englishText = translationEn;

    if (!englishText && mainText && !hasPersian(mainText)) {
      englishText = mainText;
    }

    const contentLanguage = clean(
      (row && (row.content_language || row.contentLanguage)) ||
      (story && (story.contentLanguage || story.content_language)) ||
      ""
    ).toLowerCase();

    const defaultLanguage =
      contentLanguage.includes("fa") ||
      contentLanguage.includes("farsi") ||
      contentLanguage.includes("persian") ||
      hasPersian(mainText) ||
      (!englishText && transcriptFa)
        ? "fa"
        : "en";

    return {
      en: englishText,
      fa: transcriptFa,
      defaultLanguage
    };
  }

  function hideOldTextSections(panel) {
    if (!panel) {
      return;
    }

    panel
      .querySelectorAll(
        ".mg-unified-media-text-section:not(.mg-perf-bilingual-text-section), .mg-hard-bilingual-text-section:not(.mg-perf-bilingual-text-section)"
      )
      .forEach(section => {
        section.style.display = "none";
        section.setAttribute("aria-hidden", "true");
      });

    panel
      .querySelectorAll(".mg-unified-media-language-toolbar")
      .forEach(toolbar => {
        toolbar.style.display = "none";
        toolbar.setAttribute("aria-hidden", "true");
      });
  }

  function ensureTextSection(panel) {
    const body = panel && panel.querySelector(".mg-unified-media-body");
    const variants = getTextVariants(panel);

    if (!body || (!variants.en && !variants.fa)) {
      return null;
    }

    hideOldTextSections(panel);

    let section = panel.querySelector(".mg-perf-bilingual-text-section");

    if (!section) {
      section = document.createElement("section");
      section.className =
        "mg-unified-media-section mg-hard-bilingual-text-section mg-perf-bilingual-text-section";
      section.setAttribute("aria-label", "Submitted text");

      section.innerHTML = `
        <div class="mg-hard-bilingual-toolbar" aria-label="Text language">
          <button
            class="mg-hard-bilingual-button"
            type="button"
            data-hard-language="en"
            aria-label="Show English text"
          >English</button>

          <button
            class="mg-hard-bilingual-button"
            type="button"
            data-hard-language="fa"
            aria-label="Show Persian text"
          >فارسی</button>
        </div>

        <div class="mg-hard-bilingual-text"></div>
      `;
    }

    section.style.display = "";
    section.setAttribute("aria-hidden", "false");

    if (section.parentElement !== body) {
      body.appendChild(section);
    }

    return section;
  }

  function setPanelLanguage(panel, requestedLanguage) {
    if (!panelIsVisible(panel)) {
      return;
    }

    const section = ensureTextSection(panel);
    const variants = getTextVariants(panel);

    if (!section || (!variants.en && !variants.fa)) {
      return;
    }

    const id = storyIdForPanel(panel);

    let language =
      requestedLanguage ||
      state.languageByStoryId.get(id) ||
      variants.defaultLanguage ||
      "en";

    if (language === "en" && !variants.en) {
      language = "fa";
    }

    if (language === "fa" && !variants.fa) {
      language = "en";
    }

    const nextText = language === "fa" ? variants.fa : variants.en;

    if (!nextText) {
      return;
    }

    state.languageByStoryId.set(id, language);

    const text = section.querySelector(".mg-hard-bilingual-text");

    if (text) {
      text.textContent = nextText;
      text.setAttribute("dir", language === "fa" ? "rtl" : "ltr");
      text.setAttribute("lang", language === "fa" ? "fa" : "en");
    }

    section.classList.toggle("is-fa", language === "fa");
    section.classList.toggle("is-en", language === "en");

    panel.classList.toggle("mg-hard-panel-language-fa", language === "fa");
    panel.classList.toggle("mg-hard-panel-language-en", language === "en");

    section
      .querySelectorAll(".mg-hard-bilingual-button")
      .forEach(button => {
        const buttonLanguage = clean(button.dataset.hardLanguage);
        const available =
          buttonLanguage === "en"
            ? Boolean(variants.en)
            : Boolean(variants.fa);

        const active = buttonLanguage === language;

        button.classList.toggle("active", active);
        button.classList.toggle("unavailable", !available);
        button.setAttribute("aria-pressed", active ? "true" : "false");
        button.setAttribute("aria-disabled", available ? "false" : "true");
      });
  }

  function ensureImageSection(panel) {
    const body = panel && panel.querySelector(".mg-unified-media-body");

    if (!body) {
      return null;
    }

    const story = storyForPanel(panel);
    const row = rowForPanel(panel);

    if (story && row) {
      applyRowToStory(story, row);
    }

    const imageUrl = imageUrlForStoryAndRow(story, row);

    if (!imageUrl) {
      panel.classList.remove("mg-image-above-text-ready");
      return null;
    }

    let section = body.querySelector(".mg-unified-media-image-section");

    if (!section) {
      section = document.createElement("section");
      section.className = "mg-unified-media-section mg-unified-media-image-section";

      section.innerHTML = `
        <button
          class="mg-unified-media-image-button"
          type="button"
          aria-label="Open image larger"
        >
          <img class="mg-unified-media-image" alt="Submitted image fragment" />
        </button>

        <p class="mg-unified-media-image-hint">Click image to enlarge</p>
      `;
    }

    const button = section.querySelector(".mg-unified-media-image-button");
    const image = section.querySelector(".mg-unified-media-image");
    const title = panelTitle(panel);

    section.classList.remove("image-failed");

    if (button) {
      button.type = "button";
      button.dataset.imageUrl = imageUrl;
      button.dataset.url = imageUrl;
      button.dataset.imageTitle = title;
    }

    if (image) {
      if (clean(image.getAttribute("src")) !== imageUrl) {
        image.src = imageUrl;
      }

      image.alt = `${title} image fragment`;
      image.dataset.imageUrl = imageUrl;

      if (image.dataset.mgPerfImageEvents !== "yes") {
        image.dataset.mgPerfImageEvents = "yes";

        image.addEventListener("load", () => {
          section.classList.remove("image-failed");
        });

        image.addEventListener("error", () => {
          section.classList.add("image-failed");
        });
      }
    }

    if (section.parentElement !== body) {
      body.insertBefore(section, body.firstChild);
    }

    panel.classList.add("mg-image-above-text-ready");

    return section;
  }

  function ensureLinkSection(panel) {
    const body = panel && panel.querySelector(".mg-unified-media-body");

    if (!body) {
      return null;
    }

    const story = storyForPanel(panel);
    const row = rowForPanel(panel);
    const linkUrl = externalLinkForStoryAndRow(story, row);

    if (!linkUrl) {
      return body.querySelector(".mg-unified-media-link-section");
    }

    let section = body.querySelector(".mg-unified-media-link-section");
    let link = section && section.querySelector(".mg-unified-media-link");

    if (!section) {
      section = document.createElement("section");
      section.className = "mg-unified-media-section mg-unified-media-link-section";
      section.innerHTML = `<a class="mg-unified-media-link">Open submitted link</a>`;
      link = section.querySelector(".mg-unified-media-link");
    }

    if (link) {
      link.href = linkUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.dataset.url = linkUrl;
      link.dataset.externalLink = linkUrl;
      link.textContent = "Open submitted link";
    }

    return section;
  }

  function orderSections(panel) {
    const body = panel && panel.querySelector(".mg-unified-media-body");

    if (!body) {
      return;
    }

    const imageSection = body.querySelector(".mg-unified-media-image-section:not(.image-failed)");
    const textSection = body.querySelector(".mg-perf-bilingual-text-section");
    const linkSection = body.querySelector(".mg-unified-media-link-section");

    /*
      Final order:
      image → text → link
    */
    [linkSection, textSection, imageSection]
      .filter(Boolean)
      .forEach(section => {
        body.insertBefore(section, body.firstChild);
      });

    body.classList.add("mg-image-text-link-ordered");
  }

  function currentTextElement(panel) {
    if (!panel) {
      return null;
    }

    const perfText = panel.querySelector(".mg-perf-bilingual-text-section .mg-hard-bilingual-text");

    if (perfText && clean(perfText.textContent)) {
      return perfText;
    }

    const hardText = panel.querySelector(".mg-hard-bilingual-text");

    if (hardText && clean(hardText.textContent)) {
      return hardText;
    }

    const unifiedText = panel.querySelector(".mg-unified-media-text");

    if (unifiedText && clean(unifiedText.textContent)) {
      return unifiedText;
    }

    return null;
  }

  function currentTextPayload(panel) {
    const textElement = currentTextElement(panel);

    if (!textElement) {
      return null;
    }

    const text = clean(textElement.textContent);

    if (!text) {
      return null;
    }

    const dir = clean(textElement.getAttribute("dir"));
    const lang = clean(textElement.getAttribute("lang"));

    const isFa =
      dir === "rtl" ||
      lang === "fa" ||
      hasPersian(text);

    return {
      title: panelTitle(panel),
      text,
      dir: isFa ? "rtl" : "ltr",
      lang: isFa ? "fa" : "en"
    };
  }

  function textIsLong(panel) {
    const payload = currentTextPayload(panel);

    if (!payload) {
      return false;
    }

    const textElement = currentTextElement(panel);
    const clipped =
      textElement &&
      textElement.scrollHeight > textElement.clientHeight + 18;

    return payload.text.length > 260 || clipped;
  }

  function ensureDownArrow(panel) {
    if (!panel) {
      return null;
    }

    let button = panel.querySelector(".mg-unified-media-expand");

    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "mg-unified-media-expand";

      button.innerHTML = `
        <span class="mg-unified-media-expand-glow" aria-hidden="true"></span>
        <span class="mg-unified-media-expand-arrow" aria-hidden="true">⌄</span>
        <span class="mg-unified-media-expand-text">Read full text</span>
      `;

      panel.appendChild(button);
    }

    button.setAttribute("aria-label", "Open full submitted text");
    button.setAttribute("title", "Read full text");
    button.setAttribute("aria-expanded", "false");

    const arrow = button.querySelector(".mg-unified-media-expand-arrow");

    if (arrow) {
      arrow.textContent = "⌄";
    }

    const label = button.querySelector(".mg-unified-media-expand-text");

    if (label) {
      label.textContent = "Read full text";
    }

    return button;
  }

  function syncLongTextCue(panel) {
    const isLong = textIsLong(panel);
    const button = ensureDownArrow(panel);

    panel.classList.toggle("mg-long-text-uses-reader", isLong);

    if (button) {
      button.hidden = !isLong;
      button.setAttribute("aria-hidden", isLong ? "false" : "true");
      button.tabIndex = isLong ? 0 : -1;
    }
  }

  function ensureReaderModal() {
    let modal = document.getElementById(READER_ID);

    if (modal) {
      return modal;
    }

    modal = document.createElement("div");
    modal.id = READER_ID;
    modal.className = "mg-large-submitted-text-reader";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-hidden", "true");
    modal.setAttribute("aria-label", "Large submitted text reader");

    modal.innerHTML = `
      <div class="mg-large-reader-backdrop"></div>

      <article class="mg-large-reader-panel">
        <header class="mg-large-reader-header">
          <div>
            <p class="mg-large-reader-eyebrow">Submitted fragment</p>
            <h3 class="mg-large-reader-title">Submitted text</h3>
          </div>

          <button
            class="mg-large-reader-close"
            type="button"
            aria-label="Close large reader"
            title="Close"
          >×</button>
        </header>

        <div class="mg-large-reader-scroll">
          <div class="mg-large-reader-text"></div>
        </div>
      </article>
    `;

    modal.addEventListener(
      "click",
      event => {
        const closeButton = event.target.closest(".mg-large-reader-close");
        const backdrop = event.target.classList.contains("mg-large-reader-backdrop");

        if (closeButton || backdrop) {
          event.preventDefault();
          closeReader();
          return;
        }

        event.stopPropagation();
      },
      true
    );

    modal.addEventListener(
      "pointerdown",
      event => {
        event.stopPropagation();
      },
      true
    );

    document.body.appendChild(modal);

    return modal;
  }

  function openReaderFromPanel(panel) {
    const payload = currentTextPayload(panel);

    if (!payload) {
      return;
    }

    const modal = ensureReaderModal();
    const title = modal.querySelector(".mg-large-reader-title");
    const text = modal.querySelector(".mg-large-reader-text");
    const scroll = modal.querySelector(".mg-large-reader-scroll");

    if (title) {
      title.textContent = payload.title;
    }

    if (text) {
      text.textContent = payload.text;
      text.setAttribute("dir", payload.dir);
      text.setAttribute("lang", payload.lang);
    }

    if (scroll) {
      scroll.scrollTop = 0;
    }

    modal.classList.toggle("is-fa", payload.dir === "rtl");
    modal.classList.toggle("is-en", payload.dir !== "rtl");

    modal.classList.add("visible");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("mg-large-reader-open");
  }

  function closeReader() {
    const modal = document.getElementById(READER_ID);

    if (!modal) {
      return;
    }

    modal.classList.remove("visible");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("mg-large-reader-open");
  }

  function ensureImageModal() {
    let modal = document.getElementById(IMAGE_MODAL_ID);

    if (modal) {
      return modal;
    }

    modal = document.createElement("div");
    modal.id = IMAGE_MODAL_ID;
    modal.className = "mg-final-media-image-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-hidden", "true");
    modal.setAttribute("aria-label", "Submitted image viewer");

    modal.innerHTML = `
      <div class="mg-final-media-image-modal-backdrop"></div>

      <div class="mg-final-media-image-modal-inner">
        <button
          class="mg-final-media-image-modal-close"
          type="button"
          aria-label="Close image"
          title="Close"
        >×</button>

        <img
          class="mg-final-media-image-modal-img"
          alt="Submitted image fragment"
        />
      </div>
    `;

    modal.addEventListener(
      "click",
      event => {
        if (
          event.target.classList.contains("mg-final-media-image-modal-backdrop") ||
          event.target.closest(".mg-final-media-image-modal-close")
        ) {
          event.preventDefault();
          closeImageModal();
        }
      },
      true
    );

    modal.addEventListener(
      "pointerdown",
      event => {
        event.stopPropagation();
      },
      true
    );

    document.body.appendChild(modal);

    return modal;
  }

  function openImageModal(url, label) {
    const imageUrl = prepareImageUrl(url);

    if (!imageUrl) {
      return;
    }

    const modal = ensureImageModal();
    const image = modal.querySelector(".mg-final-media-image-modal-img");

    if (image) {
      image.src = imageUrl;
      image.alt = label || "Submitted image fragment";
    }

    modal.classList.add("visible");
    modal.setAttribute("aria-hidden", "false");
    document.documentElement.classList.add("mg-final-media-image-open");
  }

  function closeImageModal() {
    const modal = document.getElementById(IMAGE_MODAL_ID);

    if (!modal) {
      return;
    }

    modal.classList.remove("visible");
    modal.setAttribute("aria-hidden", "true");
    document.documentElement.classList.remove("mg-final-media-image-open");
  }

  function openExternalLink(url) {
    const link = normalizeMediaUrl(url);

    if (!link) {
      return;
    }

    const opened = window.open(link, "_blank", "noopener,noreferrer");

    if (opened) {
      try {
        opened.opener = null;
      } catch (error) {}
    }
  }

  function repairVisiblePanel() {
    const panel = getPanel();

    if (!panelIsVisible(panel)) {
      return;
    }

    const story = storyForPanel(panel);
    const row = rowForPanel(panel);

    if (story && row) {
      applyRowToStory(story, row);
    }

    ensureImageSection(panel);
    ensureTextSection(panel);
    setPanelLanguage(panel, state.languageByStoryId.get(storyIdForPanel(panel)));
    ensureLinkSection(panel);
    orderSections(panel);
    syncLongTextCue(panel);
  }

  function requestRepair() {
    if (state.repairRaf) {
      return;
    }

    state.repairRaf = window.requestAnimationFrame(() => {
      state.repairRaf = null;
      repairVisiblePanel();
    });
  }

  function repairSoonSeries() {
    hydrateRowsOnce().then(() => {
      requestRepair();

      /*
        Limited retries only. No forever loop.
        These catch the panel after audio-ended or older code has just built it.
      */
      [120, 320, 700, 1200, 1900].forEach(delay => {
        window.setTimeout(requestRepair, delay);
      });
    });
  }

  function clearBadTranslationSubtitleOnce() {
    const story = getActiveStorySafe();

    if (!story) {
      return;
    }

    if (clean(story.subtitleCuesEn) || clean(story.subtitleEn)) {
      return;
    }

    const translation = clean(story.translationEn || story.translation_en);

    if (!translation) {
      return;
    }

    const overlay = document.getElementById("map-subtitle-overlay");

    if (
      overlay &&
      clean(overlay.textContent) === translation
    ) {
      overlay.textContent = "";
      overlay.classList.remove("visible");
    }
  }

  document.addEventListener(
    "click",
    event => {
      const target = event.target;

      if (!target || !target.closest) {
        return;
      }

      const langButton = target.closest(".mg-hard-bilingual-button");

      if (langButton) {
        const panel = langButton.closest(`#${PANEL_ID}`);

        if (!panel || langButton.classList.contains("unavailable")) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        setPanelLanguage(panel, clean(langButton.dataset.hardLanguage));
        requestRepair();
        return;
      }

      const expandButton = target.closest(".mg-unified-media-expand");

      if (expandButton) {
        const panel = expandButton.closest(`#${PANEL_ID}`);

        if (!panel || !panel.classList.contains("mg-long-text-uses-reader")) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        openReaderFromPanel(panel);
        return;
      }

      const imageTrigger = target.closest(
        `#${PANEL_ID} .mg-unified-media-image-button, #${PANEL_ID} .mg-unified-media-image`
      );

      if (imageTrigger) {
        const button =
          imageTrigger.closest(".mg-unified-media-image-button") ||
          imageTrigger;

        const imageUrl =
          button.dataset.imageUrl ||
          button.dataset.url ||
          imageTrigger.dataset.imageUrl ||
          imageTrigger.currentSrc ||
          imageTrigger.src ||
          "";

        if (imageUrl) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();

          openImageModal(imageUrl, panelTitle(button.closest(`#${PANEL_ID}`)));
          return;
        }
      }

      const linkTrigger = target.closest(`#${PANEL_ID} .mg-unified-media-link`);

      if (linkTrigger) {
        const linkUrl =
          linkTrigger.dataset.externalLink ||
          linkTrigger.dataset.url ||
          linkTrigger.getAttribute("href");

        if (linkUrl) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();

          openExternalLink(linkUrl);
        }
      }
    },
    true
  );

  document.addEventListener(
    "pointerdown",
    event => {
      const target = event.target;

      if (
        target &&
        target.closest &&
        target.closest(
          `#${PANEL_ID} .mg-hard-bilingual-button,
           #${PANEL_ID} .mg-unified-media-expand,
           #${PANEL_ID} .mg-unified-media-image-button,
           #${PANEL_ID} .mg-unified-media-link,
           #${READER_ID},
           #${IMAGE_MODAL_ID}`
        )
      ) {
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
    },
    true
  );

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      closeReader();
      closeImageModal();
    }
  });

  if (typeof selectStory === "function" && !window.__mgPerfSelectStoryWrapped) {
    const previousSelectStory = selectStory;

    selectStory = function mgPerfSelectStory(story, options = {}) {
      closeReader();
      closeImageModal();

      const result = previousSelectStory.call(this, story, options);

      repairSoonSeries();

      return result;
    };

    window.__mgPerfSelectStoryWrapped = true;
  }

  if (typeof playStoryAudio === "function" && !window.__mgPerfPlayStoryAudioWrapped) {
    const previousPlayStoryAudio = playStoryAudio;

    playStoryAudio = function mgPerfPlayStoryAudio(story) {
      const result = previousPlayStoryAudio.apply(this, arguments);

      repairSoonSeries();

      window.setTimeout(clearBadTranslationSubtitleOnce, 300);
      window.setTimeout(clearBadTranslationSubtitleOnce, 1000);

      return result;
    };

    window.__mgPerfPlayStoryAudioWrapped = true;
  }

  if (typeof audio !== "undefined" && audio && typeof audio.addEventListener === "function") {
    audio.addEventListener("ended", () => {
      repairSoonSeries();
    });
  }

  hydrateRowsOnce();
  window.setTimeout(repairSoonSeries, 600);
})();
/* ==========================================================
   STABLE MEDIA PANEL REPAIR + MODAL CURSOR FIX

   Fixes:
   1. Submissions with image + long text show BOTH image and text.
   2. Long text gets a stable "read larger" control.
   3. Enlarged image and enlarged text reader are clickable and scrollable.
   4. Cursor/lantern stays visible above enlarged image/text boxes.
   5. Lightweight: no forever polling, no whole-body observer.

   Paste at the VERY BOTTOM of script.js.
   ========================================================== */

(function mgStableMediaPanelRepairAndModalFix() {
  if (window.__mgStableMediaPanelRepairAndModalFixReady) {
    return;
  }

  window.__mgStableMediaPanelRepairAndModalFixReady = true;

  const PANEL_ID = "mg-unified-media-panel";
  const READER_ID = "mg-stable-large-text-reader";
  const IMAGE_MODAL_ID = "mg-stable-image-modal";

  const state = {
    rowsById: new Map(),
    rowsPromise: null,
    lastHydrateAt: 0,
    languageByStoryId: new Map(),
    repairRaf: null
  };

  function clean(value) {
    return String(value || "").trim();
  }

  function hasPersian(value) {
    return /[\u0600-\u06FF]/.test(String(value || ""));
  }

  function isPlaceholderText(value) {
    const text = clean(value).toLowerCase();

    return (
      !text ||
      text === "no story text yet." ||
      text === "click a blinking point outside iran. the map will carry the call back home."
    );
  }

  function normalizeMediaUrl(value) {
    if (typeof normalizeUrl === "function") {
      try {
        return clean(normalizeUrl(value));
      } catch (error) {}
    }

    const text = clean(value);

    if (!text) {
      return "";
    }

    if (/^https?:\/\//i.test(text)) {
      return text;
    }

    if (/^www\./i.test(text)) {
      return `https://${text}`;
    }

    return "";
  }

  function looksLikeAudioUrl(value) {
    return /\.(mp3|wav|m4a|aac|ogg|oga|flac)(\?.*)?$/i.test(clean(value));
  }

  function looksLikeImageUrl(value) {
    const url = normalizeMediaUrl(value);

    if (!url) {
      return false;
    }

    if (/\.(jpg|jpeg|png|gif|webp|avif|svg)(\?.*)?$/i.test(url)) {
      return true;
    }

    /*
      Tally storage URLs often do not expose a clean extension.
      If it is Tally storage and not obviously audio/video/document,
      let the browser try it as an image.
    */
    if (
      /storage\.tally\.so/i.test(url) &&
      !/\.(mp3|wav|m4a|aac|ogg|oga|flac|mp4|mov|avi|webm|pdf|doc|docx|zip)(\?.*)?$/i.test(url)
    ) {
      return true;
    }

    return false;
  }

  // escapeHtml: use the global definition (see top of file); duplicate removed during cleanup
  
  function getPanel() {
    return document.getElementById(PANEL_ID);
  }

  function panelIsVisible(panel) {
    return Boolean(
      panel &&
      panel.classList.contains("visible") &&
      panel.getAttribute("aria-hidden") !== "true"
    );
  }

  function storyIdForPanel(panel) {
    const panelStoryId = clean(panel && panel.dataset.storyId);

    if (panelStoryId) {
      return panelStoryId;
    }

    if (typeof activeStory !== "undefined" && activeStory) {
      return clean(activeStory.id);
    }

    return "";
  }

  function storyForPanel(panel) {
    const id = storyIdForPanel(panel);

    if (
      typeof activeStory !== "undefined" &&
      activeStory &&
      (!id || clean(activeStory.id) === id)
    ) {
      return activeStory;
    }

    if (Array.isArray(stories) && id) {
      return stories.find(story => clean(story.id) === id) || null;
    }

    return null;
  }

  async function hydrateRowsOnce(force = false) {
    const now = Date.now();

    if (!force && state.rowsById.size && now - state.lastHydrateAt < 15000) {
      return;
    }

    if (state.rowsPromise) {
      return state.rowsPromise;
    }

    if (
      typeof d3 === "undefined" ||
      !d3.csv ||
      typeof PUBLIC_MAP_CSV_URL === "undefined" ||
      !PUBLIC_MAP_CSV_URL
    ) {
      return;
    }

    state.lastHydrateAt = now;

    state.rowsPromise = d3
      .csv(`${PUBLIC_MAP_CSV_URL}&stableMediaRepair=${now}`)
      .then(rows => {
        rows.forEach(row => {
          const id = clean(row.id);

          if (id) {
            state.rowsById.set(id, row);
          }
        });

        if (Array.isArray(stories)) {
          stories.forEach(story => {
            const row = state.rowsById.get(clean(story.id));

            if (row) {
              applyRowToStory(story, row);
            }
          });
        }

        if (typeof activeStory !== "undefined" && activeStory) {
          const row = state.rowsById.get(clean(activeStory.id));

          if (row) {
            applyRowToStory(activeStory, row);
          }
        }
      })
      .catch(error => {
        console.warn("Missing Geographies: stable media repair could not hydrate PublicMapData.", error);
      })
      .finally(() => {
        state.rowsPromise = null;
      });

    return state.rowsPromise;
  }

  function rowForPanel(panel) {
    const id = storyIdForPanel(panel);

    if (id && state.rowsById.has(id)) {
      return state.rowsById.get(id);
    }

    const story = storyForPanel(panel);

    if (!story) {
      return null;
    }

    return {
      id: clean(story.id),
      quote: clean(story.quote || story.textFragment || story.submittedText || ""),
      text_fragment: clean(story.textFragment || story.submittedText || ""),
      full_text: clean(story.fullText || ""),
      translation_en: clean(story.translationEn || story.translation_en || ""),
      transcript_fa: clean(story.transcriptFa || story.transcript_fa || ""),
      content_language: clean(story.contentLanguage || story.content_language || ""),
      file_or_link: clean(story.fileOrLink || ""),
      image_url: clean(story.imageUrl || story.image_url || ""),
      external_link: clean(story.externalLink || story.external_link || "")
    };
  }

  function imageUrlFromRowOrStory(row, story) {
    const candidates = [
      row && row.image_url,
      row && row.photo_url,
      row && row.image,
      row && row.photo,
      row && row.file_or_link,
      story && story.imageUrl,
      story && story.image_url,
      story && story.photoUrl,
      story && story.photo_url,
      story && story.fileOrLink
    ];

    for (let i = 0; i < candidates.length; i++) {
      const url = normalizeMediaUrl(candidates[i]);

      if (url && looksLikeImageUrl(url)) {
        return url;
      }
    }

    return "";
  }

  function externalLinkFromRowOrStory(row, story, imageUrl) {
    const candidates = [
      row && row.external_link,
      row && row.link_url,
      row && row.link,
      row && row.url,
      row && row.file_or_link,
      story && story.externalLink,
      story && story.external_link,
      story && story.linkUrl,
      story && story.link_url,
      story && story.fileOrLink
    ];

    for (let i = 0; i < candidates.length; i++) {
      const url = normalizeMediaUrl(candidates[i]);

      if (!url || url === imageUrl) {
        continue;
      }

      if (!looksLikeImageUrl(url) && !looksLikeAudioUrl(url)) {
        return url;
      }
    }

    return "";
  }

  function applyRowToStory(story, row) {
    if (!story || !row) {
      return story;
    }

    const imageUrl = imageUrlFromRowOrStory(row, story);
    const externalLink = externalLinkFromRowOrStory(row, story, imageUrl);

    const textFragment = clean(
      row.text_fragment ||
      row.submitted_text ||
      row.full_text ||
      row.quote ||
      ""
    );

    const translationEn = clean(
      row.translation_en ||
      row.translationEn ||
      row.english_translation ||
      ""
    );

    const transcriptFa = clean(
      row.transcript_fa ||
      row.transcriptFa ||
      row.persian_text ||
      row.persian_transcript ||
      ""
    );

    const contentLanguage = clean(
      row.content_language ||
      row.contentLanguage ||
      ""
    );

    if (imageUrl) {
      story.imageUrl = imageUrl;
      story.image_url = imageUrl;
    }

    if (externalLink) {
      story.externalLink = externalLink;
      story.external_link = externalLink;
    }

    if (textFragment) {
      story.textFragment = story.textFragment || textFragment;
      story.submittedText = story.submittedText || textFragment;

      /*
        Important:
        Do not let the image-only case erase the story text.
        If quote is placeholder or empty, replace it with the submitted text.
      */
      if (isPlaceholderText(story.quote)) {
        story.quote = textFragment;
      }
    }

    if (translationEn) {
      story.translationEn = translationEn;
      story.translation_en = translationEn;
    }

    if (transcriptFa) {
      story.transcriptFa = transcriptFa;
      story.transcript_fa = transcriptFa;
    }

    if (contentLanguage) {
      story.contentLanguage = contentLanguage;
      story.content_language = contentLanguage;
    }

    if (!story.fileOrLink) {
      story.fileOrLink = imageUrl || externalLink || "";
    }

    return story;
  }

  function textVariantsForPanel(panel) {
    const story = storyForPanel(panel);
    const row = rowForPanel(panel);

    if (story && row) {
      applyRowToStory(story, row);
    }

    const mainText = clean(
      (row && (row.text_fragment || row.submitted_text || row.full_text || row.quote)) ||
      (story && (story.textFragment || story.submittedText || story.fullText || story.quote)) ||
      ""
    );

    const translationEn = clean(
      (row && (row.translation_en || row.translationEn || row.english_translation)) ||
      (story && (story.translationEn || story.translation_en || story.englishTranslation)) ||
      ""
    );

    let transcriptFa = clean(
      (row && (row.transcript_fa || row.transcriptFa || row.persian_text || row.persian_transcript)) ||
      (story && (story.transcriptFa || story.transcript_fa)) ||
      ""
    );

    if (!transcriptFa && hasPersian(mainText)) {
      transcriptFa = mainText;
    }

    let englishText = translationEn;

    if (!englishText && mainText && !hasPersian(mainText)) {
      englishText = mainText;
    }

    const contentLanguage = clean(
      (row && (row.content_language || row.contentLanguage)) ||
      (story && (story.contentLanguage || story.content_language)) ||
      ""
    ).toLowerCase();

    const defaultLanguage =
      contentLanguage.includes("fa") ||
      contentLanguage.includes("farsi") ||
      contentLanguage.includes("persian") ||
      hasPersian(mainText) ||
      (!englishText && transcriptFa)
        ? "fa"
        : "en";

    return {
      en: englishText,
      fa: transcriptFa,
      defaultLanguage
    };
  }

  function currentPanelTitle(panel) {
    const title =
      panel &&
      (
        panel.querySelector(".mg-unified-media-title") ||
        panel.querySelector(".story-post-audio-fragment-title")
      );

    return clean(title && title.textContent) || "Submitted fragment";
  }

  function ensureBody(panel) {
    if (!panel) {
      return null;
    }

    let body = panel.querySelector(".mg-unified-media-body");

    if (!body) {
      body = document.createElement("div");
      body.className = "mg-unified-media-body";
      panel.appendChild(body);
    }

    return body;
  }

  function hideOldTextSections(panel) {
    if (!panel) {
      return;
    }

    panel
      .querySelectorAll(
        ".mg-unified-media-text-section:not(.mg-stable-text-section), .mg-hard-bilingual-text-section, .mg-perf-bilingual-text-section"
      )
      .forEach(section => {
        section.style.display = "none";
        section.setAttribute("aria-hidden", "true");
      });

    panel
      .querySelectorAll(
        ".mg-unified-media-language-toolbar, .mg-hard-bilingual-toolbar, .mg-final-translation-toolbar"
      )
      .forEach(toolbar => {
        toolbar.style.display = "none";
        toolbar.setAttribute("aria-hidden", "true");
      });
  }

  function ensureImageSection(panel) {
    const body = ensureBody(panel);
    const story = storyForPanel(panel);
    const row = rowForPanel(panel);

    if (!body || !story) {
      return null;
    }

    const imageUrl = imageUrlFromRowOrStory(row, story);

    if (!imageUrl) {
      return null;
    }

    let section =
      panel.querySelector(".mg-unified-media-image-section") ||
      panel.querySelector(".mg-stable-image-section");

    if (!section) {
      section = document.createElement("section");
      section.className =
        "mg-unified-media-section mg-unified-media-image-section mg-stable-image-section";

      section.innerHTML = `
        <button
          class="mg-unified-media-image-button mg-stable-image-button"
          type="button"
          aria-label="Open image larger"
        >
          <img
            class="mg-unified-media-image mg-stable-image"
            alt="Submitted image fragment"
          />
        </button>

        <p class="mg-unified-media-image-hint">Click image to enlarge</p>
      `;
    }

    section.classList.remove("image-failed");
    section.dataset.stableImageUrl = imageUrl;

    const button = section.querySelector(".mg-unified-media-image-button");
    const img = section.querySelector(".mg-unified-media-image");

    if (button) {
      button.dataset.imageUrl = imageUrl;
      button.dataset.imageTitle = currentPanelTitle(panel);
    }

    if (img) {
      if (img.getAttribute("src") !== imageUrl) {
        img.src = imageUrl;
      }

      img.alt = `${currentPanelTitle(panel)} image fragment`;
      img.onerror = () => {
        section.classList.add("image-failed");
      };
    }

    body.appendChild(section);

    return section;
  }

  function ensureTextSection(panel, requestedLanguage) {
    const body = ensureBody(panel);
    const variants = textVariantsForPanel(panel);

    if (!body || (!variants.en && !variants.fa)) {
      return null;
    }

    hideOldTextSections(panel);

    let section = panel.querySelector(".mg-stable-text-section");

    if (!section) {
      section = document.createElement("section");
      section.className =
        "mg-unified-media-section mg-stable-text-section";
      section.setAttribute("aria-label", "Submitted text");

      section.innerHTML = `
        <div class="mg-stable-lang-toolbar" aria-label="Submitted text language">
          <button
            class="mg-stable-lang-button"
            type="button"
            data-stable-language="en"
            aria-label="Show English text"
          >English</button>

          <button
            class="mg-stable-lang-button"
            type="button"
            data-stable-language="fa"
            aria-label="Show Persian text"
          >فارسی</button>
        </div>

        <div class="mg-stable-text"></div>

        <button
          class="mg-stable-read-cue"
          type="button"
          aria-label="Open submitted text in larger reader"
          title="Read larger"
        >⌄</button>
      `;
    }

    body.appendChild(section);

    const storyId = storyIdForPanel(panel);

    let language =
      requestedLanguage ||
      state.languageByStoryId.get(storyId) ||
      variants.defaultLanguage;

    if (language === "en" && !variants.en) {
      language = "fa";
    }

    if (language === "fa" && !variants.fa) {
      language = "en";
    }

    const text = language === "fa" ? variants.fa : variants.en;

    if (!text) {
      return section;
    }

    state.languageByStoryId.set(storyId, language);

    const textElement = section.querySelector(".mg-stable-text");
    const readCue = section.querySelector(".mg-stable-read-cue");

    if (textElement) {
      textElement.textContent = text;
      textElement.setAttribute("dir", language === "fa" ? "rtl" : "ltr");
      textElement.setAttribute("lang", language === "fa" ? "fa" : "en");
    }

    const isLong = text.length > 420;

    section.classList.toggle("is-long", isLong);
    section.classList.toggle("is-fa", language === "fa");
    section.classList.toggle("is-en", language === "en");

    if (readCue) {
      readCue.hidden = !isLong;
      readCue.setAttribute("aria-hidden", isLong ? "false" : "true");
      readCue.tabIndex = isLong ? 0 : -1;
    }

    section
      .querySelectorAll(".mg-stable-lang-button")
      .forEach(button => {
        const buttonLanguage = clean(button.dataset.stableLanguage);
        const available =
          buttonLanguage === "en"
            ? Boolean(variants.en)
            : Boolean(variants.fa);

        const active = buttonLanguage === language;

        button.classList.toggle("active", active);
        button.classList.toggle("unavailable", !available);
        button.setAttribute("aria-pressed", active ? "true" : "false");
        button.setAttribute("aria-disabled", available ? "false" : "true");
      });

    panel.classList.add("mg-stable-media-panel-ready");
    panel.classList.toggle("mg-stable-language-fa", language === "fa");
    panel.classList.toggle("mg-stable-language-en", language === "en");

    ensureReaderOpenButton(panel, isLong);

    return section;
  }

  function ensureExternalLinkSection(panel) {
    const body = ensureBody(panel);
    const story = storyForPanel(panel);
    const row = rowForPanel(panel);

    if (!body || !story) {
      return null;
    }

    const imageUrl = imageUrlFromRowOrStory(row, story);
    const linkUrl = externalLinkFromRowOrStory(row, story, imageUrl);

    if (!linkUrl) {
      return null;
    }

    let section = panel.querySelector(".mg-unified-media-link-section");

    if (!section) {
      section = document.createElement("section");
      section.className =
        "mg-unified-media-section mg-unified-media-link-section";

      section.innerHTML = `
        <a
          class="mg-unified-media-link"
          target="_blank"
          rel="noopener noreferrer"
        >Open submitted link ↗</a>
      `;
    }

    const link = section.querySelector(".mg-unified-media-link");

    if (link) {
      link.href = linkUrl;
      link.dataset.url = linkUrl;
      link.dataset.externalLink = linkUrl;
    }

    body.appendChild(section);

    return section;
  }

  function ensureReaderOpenButton(panel, shouldShow) {
    const header = panel && panel.querySelector(".mg-unified-media-header");
    const closeButton = panel && panel.querySelector(".mg-unified-media-close");

    if (!header || !closeButton) {
      return;
    }

    let button = panel.querySelector(".mg-stable-reader-open");

    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "mg-stable-reader-open";
      button.setAttribute("aria-label", "Read submitted text larger");
      button.setAttribute("title", "Read larger");
      button.innerHTML = `<span aria-hidden="true"></span>`;
    }

    if (button.parentElement !== header || button.nextElementSibling !== closeButton) {
      header.insertBefore(button, closeButton);
    }

    button.hidden = !shouldShow;
    button.setAttribute("aria-hidden", shouldShow ? "false" : "true");
    button.tabIndex = shouldShow ? 0 : -1;
  }

  function orderSections(panel) {
    const body = ensureBody(panel);

    if (!body) {
      return;
    }

    body.style.display = "flex";
    body.style.flexDirection = "column";

    panel
      .querySelectorAll(".mg-unified-media-image-section, .mg-stable-image-section")
      .forEach(section => {
        section.style.order = "1";
      });

    panel
      .querySelectorAll(".mg-stable-text-section")
      .forEach(section => {
        section.style.order = "2";
      });

    panel
      .querySelectorAll(".mg-unified-media-link-section")
      .forEach(section => {
        section.style.order = "3";
      });
  }

  function repairPanelNow() {
    const panel = getPanel();

    if (!panelIsVisible(panel)) {
      return;
    }

    const story = storyForPanel(panel);
    const row = rowForPanel(panel);

    if (story && row) {
      applyRowToStory(story, row);
    }

    ensureImageSection(panel);
    ensureTextSection(panel);
    ensureExternalLinkSection(panel);
    orderSections(panel);
  }

  function requestRepair() {
    if (state.repairRaf) {
      return;
    }

    state.repairRaf = window.requestAnimationFrame(() => {
      state.repairRaf = null;
      repairPanelNow();
    });
  }

  function repairSoonSeries(forceHydrate = false) {
    hydrateRowsOnce(forceHydrate).then(() => {
      requestRepair();

      [80, 220, 520, 900, 1500, 2400].forEach(delay => {
        window.setTimeout(requestRepair, delay);
      });
    });
  }

  function currentTextPayload(panel) {
    if (!panel) {
      return null;
    }

    const textElement =
      panel.querySelector(".mg-stable-text") ||
      panel.querySelector(".mg-perf-text") ||
      panel.querySelector(".mg-hard-bilingual-text") ||
      panel.querySelector(".mg-unified-media-text");

    const text = clean(textElement && textElement.textContent);

    if (!text) {
      return null;
    }

    const dir =
      clean(textElement.getAttribute("dir")) === "rtl" ||
      hasPersian(text)
        ? "rtl"
        : "ltr";

    return {
      title: currentPanelTitle(panel),
      text,
      dir,
      lang: dir === "rtl" ? "fa" : "en"
    };
  }

  function ensureLargeReaderModal() {
    let modal = document.getElementById(READER_ID);

    if (modal) {
      return modal;
    }

    modal = document.createElement("div");
    modal.id = READER_ID;
    modal.className = "mg-stable-large-text-reader";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-hidden", "true");
    modal.setAttribute("aria-label", "Large submitted text reader");

    modal.innerHTML = `
      <div class="mg-stable-large-reader-backdrop"></div>

      <article class="mg-stable-large-reader-panel">
        <header class="mg-stable-large-reader-header">
          <div>
            <p class="mg-stable-large-reader-eyebrow">Submitted fragment</p>
            <h3 class="mg-stable-large-reader-title">Submitted text</h3>
          </div>

          <button
            class="mg-stable-large-reader-close"
            type="button"
            aria-label="Close large reader"
            title="Close"
          >×</button>
        </header>

        <div class="mg-stable-large-reader-scroll">
          <div class="mg-stable-large-reader-text"></div>
        </div>
      </article>
    `;

    modal.addEventListener(
      "pointerdown",
      event => {
        event.stopPropagation();
      },
      true
    );

    modal.addEventListener(
      "click",
      event => {
        const closeButton = event.target.closest(".mg-stable-large-reader-close");
        const backdrop = event.target.classList.contains("mg-stable-large-reader-backdrop");

        if (closeButton || backdrop) {
          event.preventDefault();
          closeLargeReaderModal();
          return;
        }

        event.stopPropagation();
      },
      true
    );

    document.body.appendChild(modal);

    return modal;
  }

  function openLargeReaderFromPanel(panel) {
    const payload = currentTextPayload(panel);

    if (!payload) {
      return;
    }

    const modal = ensureLargeReaderModal();
    const title = modal.querySelector(".mg-stable-large-reader-title");
    const text = modal.querySelector(".mg-stable-large-reader-text");
    const scroll = modal.querySelector(".mg-stable-large-reader-scroll");

    if (title) {
      title.textContent = payload.title;
    }

    if (text) {
      text.textContent = payload.text;
      text.setAttribute("dir", payload.dir);
      text.setAttribute("lang", payload.lang);
    }

    if (scroll) {
      scroll.scrollTop = 0;
    }

    modal.classList.toggle("is-fa", payload.dir === "rtl");
    modal.classList.toggle("is-en", payload.dir !== "rtl");

    modal.classList.add("visible");
    modal.setAttribute("aria-hidden", "false");

    document.documentElement.classList.add("mg-stable-reader-open");
    document.body.classList.add("mg-stable-reader-open");

    const closeButton = modal.querySelector(".mg-stable-large-reader-close");

    if (closeButton) {
      window.setTimeout(() => {
        try {
          closeButton.focus({ preventScroll: true });
        } catch (error) {}
      }, 40);
    }
  }

  function closeLargeReaderModal() {
    const modal = document.getElementById(READER_ID);

    if (!modal) {
      return;
    }

    modal.classList.remove("visible");
    modal.setAttribute("aria-hidden", "true");

    document.documentElement.classList.remove("mg-stable-reader-open");
    document.body.classList.remove("mg-stable-reader-open");
  }

  function ensureImageModal() {
    let modal = document.getElementById(IMAGE_MODAL_ID);

    if (modal) {
      return modal;
    }

    modal = document.createElement("div");
    modal.id = IMAGE_MODAL_ID;
    modal.className = "mg-stable-image-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-hidden", "true");
    modal.setAttribute("aria-label", "Submitted image viewer");

    modal.innerHTML = `
      <div class="mg-stable-image-modal-backdrop"></div>

      <div class="mg-stable-image-modal-inner">
        <button
          class="mg-stable-image-modal-close"
          type="button"
          aria-label="Close image"
          title="Close"
        >×</button>

        <img
          class="mg-stable-image-modal-img"
          alt="Submitted image fragment"
        />
      </div>
    `;

    modal.addEventListener(
      "pointerdown",
      event => {
        event.stopPropagation();
      },
      true
    );

    modal.addEventListener(
      "click",
      event => {
        const closeButton = event.target.closest(".mg-stable-image-modal-close");
        const backdrop = event.target.classList.contains("mg-stable-image-modal-backdrop");

        if (closeButton || backdrop) {
          event.preventDefault();
          closeImageModal();
          return;
        }

        event.stopPropagation();
      },
      true
    );

    document.body.appendChild(modal);

    return modal;
  }

  function openImageModal(url, title) {
    const safeUrl = normalizeMediaUrl(url);

    if (!safeUrl) {
      return;
    }

    const modal = ensureImageModal();
    const image = modal.querySelector(".mg-stable-image-modal-img");

    if (image) {
      image.src = safeUrl;
      image.alt = title || "Submitted image fragment";
    }

    modal.classList.add("visible");
    modal.setAttribute("aria-hidden", "false");

    document.documentElement.classList.add("mg-stable-image-open");
    document.body.classList.add("mg-stable-image-open");
  }

  function closeImageModal() {
    const modal = document.getElementById(IMAGE_MODAL_ID);

    if (!modal) {
      return;
    }

    modal.classList.remove("visible");
    modal.setAttribute("aria-hidden", "true");

    document.documentElement.classList.remove("mg-stable-image-open");
    document.body.classList.remove("mg-stable-image-open");
  }

  window.addEventListener(
    "click",
    event => {
      const target = event.target;

      if (!target || !target.closest) {
        return;
      }

      const languageButton = target.closest(".mg-stable-lang-button");

      if (languageButton) {
        const panel = languageButton.closest(`#${PANEL_ID}`);

        if (!panel) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        if (languageButton.classList.contains("unavailable")) {
          return;
        }

        const language = clean(languageButton.dataset.stableLanguage);
        const storyId = storyIdForPanel(panel);

        state.languageByStoryId.set(storyId, language);

        ensureTextSection(panel, language);
        orderSections(panel);
        return;
      }

      const readerButton =
        target.closest(".mg-stable-reader-open") ||
        target.closest(".mg-stable-read-cue");

      if (readerButton) {
        const panel = readerButton.closest(`#${PANEL_ID}`);

        if (!panel) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        openLargeReaderFromPanel(panel);
        return;
      }

      const imageTarget = target.closest(
        ".mg-unified-media-image-button, .mg-unified-media-image, .mg-stable-image-button, .mg-stable-image"
      );

      if (imageTarget) {
        const panel = imageTarget.closest(`#${PANEL_ID}`);

        if (!panel) {
          return;
        }

        const button =
          imageTarget.closest(".mg-unified-media-image-button") ||
          imageTarget.closest(".mg-stable-image-button");

        const img =
          imageTarget.tagName &&
          imageTarget.tagName.toLowerCase() === "img"
            ? imageTarget
            : imageTarget.querySelector && imageTarget.querySelector("img");

        const url =
          clean(button && button.dataset.imageUrl) ||
          clean(img && (img.currentSrc || img.src)) ||
          clean(imageTarget.dataset.imageUrl);

        if (url) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();

          openImageModal(url, currentPanelTitle(panel));
          return;
        }
      }

      if (target.closest(".mg-stable-image-modal-close")) {
        event.preventDefault();
        closeImageModal();
        return;
      }

      if (target.closest(".mg-stable-large-reader-close")) {
        event.preventDefault();
        closeLargeReaderModal();
        return;
      }
    },
    true
  );

  window.addEventListener(
    "pointerdown",
    event => {
      const target = event.target;

      if (
        target &&
        target.closest &&
        target.closest(
          ".mg-stable-lang-button, .mg-stable-reader-open, .mg-stable-read-cue, .mg-unified-media-image-button, .mg-stable-image-modal, .mg-stable-large-text-reader"
        )
      ) {
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
    },
    true
  );

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      closeImageModal();
      closeLargeReaderModal();
    }
  });

  if (typeof updateStoryPanelFinal === "function" && !window.__mgStableMediaUpdateFinalWrapped) {
    const previousUpdateStoryPanelFinal = updateStoryPanelFinal;

    updateStoryPanelFinal = function stableMediaUpdateStoryPanelFinal(story) {
      const result = previousUpdateStoryPanelFinal.apply(this, arguments);

      repairSoonSeries(false);

      return result;
    };

    window.__mgStableMediaUpdateFinalWrapped = true;
  }

  if (typeof playStoryAudio === "function" && !window.__mgStableMediaPlayWrapped) {
    const previousPlayStoryAudio = playStoryAudio;

    playStoryAudio = function stableMediaPlayStoryAudio(story) {
      const result = previousPlayStoryAudio.apply(this, arguments);

      repairSoonSeries(false);

      return result;
    };

    window.__mgStableMediaPlayWrapped = true;
  }

  if (typeof resetView === "function" && !window.__mgStableMediaResetWrapped) {
    const previousResetView = resetView;

    resetView = function stableMediaResetView() {
      closeImageModal();
      closeLargeReaderModal();

      return previousResetView.apply(this, arguments);
    };

    window.__mgStableMediaResetWrapped = true;
  }

  if (typeof goToIranView === "function" && !window.__mgStableMediaIranWrapped) {
    const previousGoToIranView = goToIranView;

    goToIranView = function stableMediaGoToIranView() {
      closeImageModal();
      closeLargeReaderModal();

      return previousGoToIranView.apply(this, arguments);
    };

    window.__mgStableMediaIranWrapped = true;
  }

  const audioElement =
    typeof audio !== "undefined"
      ? audio
      : document.getElementById("story-audio");

  if (audioElement && audioElement.dataset.mgStableMediaBound !== "yes") {
    audioElement.dataset.mgStableMediaBound = "yes";
    audioElement.addEventListener("ended", () => repairSoonSeries(false));
  }

  document.addEventListener(
    "click",
    event => {
      if (
        event.target &&
        event.target.closest &&
        event.target.closest(".map-point, .story-button")
      ) {
        repairSoonSeries(false);
      }
    },
    true
  );

  hydrateRowsOnce(true).then(() => {
    repairSoonSeries(false);
  });

  window.setTimeout(() => repairSoonSeries(false), 700);
  window.setTimeout(() => repairSoonSeries(false), 1600);
})();
/* ==========================================================
   RANDOM CALL ARCHIVE + PERSONALIZED FLOATING FRAGMENTS

   Fixes:
   1. Call room / archive order becomes random:
      - on page refresh
      - when the archive dropdown opens/closes
      - whenever createStoryButtons() is called again

   2. Floating fragments become more personal:
      - person-name fragments like "Bahar Shahmehri - 2008"
      - Iranian city fragments
      - diaspora city/country fragments
      - no more year-only fragments

   Paste at the VERY BOTTOM of script.js.
   ========================================================== */

(function installRandomArchiveAndPersonalFragments() {
  if (window.__mgRandomArchiveAndPersonalFragmentsReady) {
    return;
  }

  window.__mgRandomArchiveAndPersonalFragmentsReady = true;

  const MEMORY_FRAGMENT_MAX_COUNT = 96;

  function clean(value) {
    return String(value || "").trim();
  }

  // escapeHtml: use the global definition (see top of file); duplicate removed during cleanup

  function shuffleCopy(items) {
    const copy = Array.isArray(items) ? items.slice() : [];

    for (let index = copy.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(Math.random() * (index + 1));
      const temporary = copy[index];

      copy[index] = copy[randomIndex];
      copy[randomIndex] = temporary;
    }

    return copy;
  }

  function isUsefulText(value) {
    const text = clean(value);
    const lowered = text.toLowerCase();

    return Boolean(
      text &&
      text !== "—" &&
      lowered !== "unknown" &&
      lowered !== "unknown origin" &&
      lowered !== "unknown destination" &&
      lowered !== "anonymous voice 01"
    );
  }

  function storyPerson(story) {
    const person = clean(
      story &&
      (
        story.person ||
        story.displayName ||
        story.display_name ||
        story.contributor ||
        ""
      )
    );

    return person || "Anonymous";
  }

  function isNamedPerson(person) {
    const text = clean(person);
    const lowered = text.toLowerCase();

    return Boolean(
      text &&
      lowered !== "anonymous" &&
      lowered !== "unknown" &&
      lowered !== "no name" &&
      lowered !== "n/a" &&
      lowered !== "—"
    );
  }

  function storyYear(story) {
    const year = clean(story && story.yearLeft);

    return isUsefulText(year) ? year : "";
  }

  function makeArchiveLabel(story) {
    const fromCity = escapeHtml(clean(story && story.destinationCity) || "Unknown");
    const toCity = escapeHtml(clean(story && story.originCity) || "Iran");

    return `
      <strong>${fromCity} → ${toCity}</strong>
    `;
  }

  function createArchiveButton(story) {
    const button = document.createElement("button");

    button.type = "button";
    button.className = "story-button";
    button.dataset.storyId = story.id;

    button.innerHTML = makeArchiveLabel(story);

    button.setAttribute(
      "aria-label",
      `${story.destinationCity || "Unknown"} to ${story.originCity || "Iran"}`
    );

    button.title = `${story.destinationCity || "Unknown"} → ${story.originCity || "Iran"}`;

    button.addEventListener("pointerdown", () => {
      if (typeof isJourneyAnimating !== "undefined" && isJourneyAnimating) {
        return;
      }

      if (typeof startWaitingBuzz === "function") {
        startWaitingBuzz();
      }
    });

    button.addEventListener("click", () => {
      if (typeof selectStory === "function") {
        selectStory(story, { keepBuzz: true });
      }
    });

    return button;
  }

  function createRandomizedStoryButtons() {
    const list = document.getElementById("story-list");

    if (!list || !Array.isArray(stories)) {
      return;
    }

    const orderedStories = shuffleCopy(stories)
      .filter(story => story && story.id);

    list.innerHTML = "";

    orderedStories.forEach(story => {
      list.appendChild(createArchiveButton(story));
    });

    if (typeof updateStoryButtons === "function") {
      updateStoryButtons();
    }
  }

  /*
    Final override:
    Any future call to createStoryButtons() now rebuilds the archive randomly.
  */
  if (typeof createStoryButtons === "function") {
    createStoryButtons = createRandomizedStoryButtons;
  }

  function archiveDetailsElement() {
    const list = document.getElementById("story-list");

    if (!list) {
      return null;
    }

    return (
      list.closest("details") ||
      document.querySelector(".call-room-dropdown")
    );
  }

  function bindArchiveToggle() {
    const details = archiveDetailsElement();

    if (!details || details.dataset.mgRandomArchiveBound === "yes") {
      return;
    }

    details.dataset.mgRandomArchiveBound = "yes";

    /*
      Randomize on both opening and closing.
      If it randomizes while closed, the next opening already feels fresh.
    */
    details.addEventListener("toggle", () => {
      window.setTimeout(createRandomizedStoryButtons, 30);
    });
  }

  /*
    Some browsers/patches rebuild the details element later, so bind gently.
  */
  document.addEventListener(
    "click",
    event => {
      const summary =
        event.target &&
        event.target.closest &&
        event.target.closest(".call-room-dropdown > summary, details > summary");

      if (!summary) {
        return;
      }

      const details = summary.closest("details");

      if (!details) {
        return;
      }

      if (
        details.classList.contains("call-room-dropdown") ||
        details.querySelector("#story-list")
      ) {
        window.setTimeout(createRandomizedStoryButtons, 120);
      }
    },
    true
  );

  function refreshArchiveWhenReady() {
    if (!Array.isArray(stories) || !stories.length) {
      window.setTimeout(refreshArchiveWhenReady, 350);
      return;
    }

    bindArchiveToggle();
    createRandomizedStoryButtons();
  }

  window.setTimeout(refreshArchiveWhenReady, 300);
  window.setTimeout(bindArchiveToggle, 1000);


  /* --------------------------------------------------------
     Personalized floating memory fragments
     -------------------------------------------------------- */

  function fragmentSublineForStory(story) {
    const originCity = clean(story && story.originCity);
    const destinationCity = clean(story && story.destinationCity);

    if (isUsefulText(originCity) && isUsefulText(destinationCity)) {
      return `${originCity} → ${destinationCity}`;
    }

    if (isUsefulText(originCity)) {
      return originCity;
    }

    if (isUsefulText(destinationCity)) {
      return destinationCity;
    }

    return storyPerson(story);
  }

  function pushFragment(bucket, fragment) {
    const word = clean(fragment && fragment.word);

    if (!isUsefulText(word)) {
      return;
    }

    bucket.push({
      ...fragment,
      word
    });
  }

  function buildPersonalizedMemoryCloudFragments() {
    const personFragments = [];
    const iranCityFragments = [];
    const diasporaFragments = [];

    if (!Array.isArray(stories)) {
      return [];
    }

    stories.forEach(story => {
      if (!story) {
        return;
      }

      const person = storyPerson(story);
      const year = storyYear(story);
      const originCity = clean(story.originCity);
      const destinationCity = clean(story.destinationCity);
      const destinationCountry = clean(story.destinationCountry);

      /*
        Main personal fragment:
        "Bahar Shahmehri - 2008"
      */
      if (isNamedPerson(person)) {
        pushFragment(personFragments, {
          kind: "person",
          word: year ? `${person} - ${year}` : person,
          person,
          subline: fragmentSublineForStory(story),
          story
        });
      }

      /*
        Iranian city fragment:
        "Yazd", "Qazvin", "Neyshabur", etc.
      */
      if (isUsefulText(originCity)) {
        pushFragment(iranCityFragments, {
          kind: "city",
          word: originCity,
          person,
          subline: person,
          story
        });
      }

      /*
        Diaspora/current place fragment:
        use city first, country second.
      */
      if (isUsefulText(destinationCity)) {
        pushFragment(diasporaFragments, {
          kind: "diaspora-city",
          word: destinationCity,
          person,
          subline: person,
          story
        });
      } else if (isUsefulText(destinationCountry)) {
        pushFragment(diasporaFragments, {
          kind: "diaspora-country",
          word: destinationCountry,
          person,
          subline: person,
          story
        });
      }
    });

    /*
      Split share:
      - all available named people
      - most Iranian city fragments
      - some diaspora place/country fragments
      This keeps the cloud personal without losing geography.
    */
    const storyCount = Math.max(1, stories.length);

    const chosenPeople = shuffleCopy(personFragments);
    const chosenCities = shuffleCopy(iranCityFragments)
      .slice(0, Math.ceil(storyCount * 0.85));

    const chosenDiaspora = shuffleCopy(diasporaFragments)
      .slice(0, Math.ceil(storyCount * 0.55));

    return shuffleCopy([
      ...chosenPeople,
      ...chosenCities,
      ...chosenDiaspora
    ]).slice(0, MEMORY_FRAGMENT_MAX_COUNT);
  }

  /*
    Final override:
    setupMemoryCloud() calls buildMemoryCloudFragments(), so replacing this
    function changes the floating fragments without rewriting the motion system.
  */
  if (typeof buildMemoryCloudFragments === "function") {
    buildMemoryCloudFragments = buildPersonalizedMemoryCloudFragments;
  }

  /*
    Canvas text refinement:
    Use fragment.subline visually when present, while keeping fragment.person
    as the contributor identity for aria labels/click behavior.
  */
  if (typeof renderMemoryCloudCanvas === "function") {
    renderMemoryCloudCanvas = function renderPersonalizedMemoryCloudCanvas(fragment) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);

      const primaryText = clean(fragment && fragment.word);
      const secondaryText = clean(
        fragment && (fragment.subline || fragment.person || "")
      );

      const isPersonFragment = fragment && fragment.kind === "person";
      const isDiasporaFragment =
        fragment &&
        (
          fragment.kind === "diaspora-city" ||
          fragment.kind === "diaspora-country"
        );

      const wordFontSize =
        isPersonFragment
          ? 15.3
          : isDiasporaFragment
            ? 14.4
            : fragment && fragment.kind === "country"
              ? 14.4
              : 15;

      const personFontSize = isPersonFragment ? 8.1 : 8.3;

      const wordFont = `700 ${wordFontSize}px Georgia, "Times New Roman", serif`;
      const personFont = `700 ${personFontSize}px Arial, sans-serif`;

      const measuringCanvas = document.createElement("canvas");
      const measuringContext = measuringCanvas.getContext("2d");

      measuringContext.font = wordFont;
      const wordWidth = measuringContext.measureText(primaryText).width;

      measuringContext.font = personFont;
      const secondaryWidth = measuringContext
        .measureText(secondaryText.toUpperCase())
        .width;

      const paddingX = isPersonFragment ? 20 : 18;
      const paddingY = 12;
      const gap = 5;

      const cssWidth = Math.ceil(
        Math.max(wordWidth, secondaryWidth) + paddingX * 2
      );

      const cssHeight = Math.ceil(
        wordFontSize + personFontSize + gap + paddingY * 2
      );

      const canvas = document.createElement("canvas");

      canvas.width = Math.ceil(cssWidth * dpr);
      canvas.height = Math.ceil(cssHeight * dpr);
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;

      const context = canvas.getContext("2d");

      context.scale(dpr, dpr);
      context.textAlign = "center";
      context.textBaseline = "middle";

      const centerX = cssWidth / 2;

      context.shadowColor = isPersonFragment
        ? "rgba(255, 207, 102, 0.20)"
        : "rgba(255, 207, 102, 0.14)";

      context.shadowBlur = isPersonFragment ? 16 : 13;

      context.fillStyle = isPersonFragment
        ? "rgba(255, 239, 198, 0.76)"
        : "rgba(232, 218, 190, 0.68)";

      context.font = wordFont;
      context.fillText(primaryText, centerX, paddingY + wordFontSize / 2);

      context.shadowColor = "rgba(0, 0, 0, 0.42)";
      context.shadowBlur = 9;
      context.fillStyle = isPersonFragment
        ? "rgba(221, 198, 146, 0.54)"
        : "rgba(202, 181, 137, 0.48)";

      context.font = personFont;
      context.fillText(
        secondaryText.toUpperCase(),
        centerX,
        paddingY + wordFontSize + gap + personFontSize / 2
      );

      return canvas;
    };
  }

  function rebuildMemoryCloudWhenIdle() {
    if (
      typeof setupMemoryCloud !== "function" ||
      !Array.isArray(stories) ||
      !stories.length
    ) {
      return;
    }

    if (
      typeof activeStory !== "undefined" &&
      activeStory
    ) {
      return;
    }

    if (
      typeof isJourneyAnimating !== "undefined" &&
      isJourneyAnimating
    ) {
      return;
    }

    setupMemoryCloud();
  }

  /*
    If this patch loads after the first cloud was already created, rebuild it once.
    On normal page load, the override usually lands before setupMemoryCloud runs.
  */
  window.setTimeout(rebuildMemoryCloudWhenIdle, 1200);
  window.setTimeout(rebuildMemoryCloudWhenIdle, 2600);
})();
/* ==========================================================
   DROPDOWN INTRODUCTION/INVITATION → BLINKING-I TEXT BOX

   Goal:
   - Add "Introduction/Invitation" to the Missing Geographies dropdown.
   - Place it between About and Contribute when possible.
   - Clicking it opens the existing blinking-i invitation text box.
   - Keep the poetic hover interaction exactly as it is.
   - Keep the existing English / فارسی toggle inside the box.
   - Let Escape or outside click close the manually opened box.

   Paste at the VERY BOTTOM of script.js.
   ========================================================== */

(function addIntroductionInvitationDropdownButton() {
  if (window.__mgIntroductionInvitationDropdownReady) {
    return;
  }

  window.__mgIntroductionInvitationDropdownReady = true;

  const BUTTON_TEXT = "Introduction/Invitation";
  const BUTTON_CLASS = "mg-intro-invitation-trigger";
  const BACKDROP_ID = "mg-intro-invitation-backdrop";

  let manualInvitationOpen = false;
  let keepOpenTimer = null;

  function clean(value) {
    return String(value || "").trim();
  }

  function normalizeText(value) {
    return clean(value)
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function getDropdown() {
    return document.querySelector(".site-pages-dropdown");
  }

  function getDropdownPanel() {
    return document.querySelector(".site-pages-dropdown .site-pages-card, .site-pages-card");
  }

  function getQuoteBox() {
    return document.getElementById("title-memory-quote");
  }

  function getLiveI() {
    return document.querySelector(".title-live-i");
  }

  function isAboutElement(element) {
    return normalizeText(element && element.textContent) === "about";
  }

  function isContributeElement(element) {
    return normalizeText(element && element.textContent) === "contribute";
  }

  function isIntroInvitationElement(element) {
    return Boolean(
      element &&
      (
        element.classList.contains(BUTTON_CLASS) ||
        normalizeText(element.textContent) === normalizeText(BUTTON_TEXT)
      )
    );
  }

  function getMenuItems(panel) {
    if (!panel) {
      return [];
    }

    return Array.from(
      panel.querySelectorAll(".site-pages-link, a, button")
    ).filter(item => {
      return item.closest(".site-pages-card") === panel;
    });
  }

  function makeIntroInvitationButton() {
    const button = document.createElement("button");

    button.type = "button";
    button.className = `site-pages-link site-pages-link-introduction-invitation ${BUTTON_CLASS}`;
    button.setAttribute("aria-label", "Open project introduction and invitation");
    button.setAttribute("title", BUTTON_TEXT);

    button.innerHTML = `
      <span>${BUTTON_TEXT}</span>
    `;

    return button;
  }

  function installIntroInvitationButton() {
    const panel = getDropdownPanel();

    if (!panel) {
      return false;
    }

    const existing = panel.querySelector(`.${BUTTON_CLASS}`);

    if (existing) {
      return true;
    }

    const button = makeIntroInvitationButton();
    const items = getMenuItems(panel);

    const aboutItem = items.find(isAboutElement);
    const contributeItem = items.find(isContributeElement);

    /*
      Preferred placement:
      directly before Contribute, which visually places it between
      About and Contribute in the final menu.
    */
    if (contributeItem && contributeItem.parentNode === panel) {
      panel.insertBefore(button, contributeItem);
      return true;
    }

    /*
      Fallback:
      directly after About.
    */
    if (aboutItem && aboutItem.parentNode === panel) {
      aboutItem.insertAdjacentElement("afterend", button);
      return true;
    }

    panel.appendChild(button);
    return true;
  }

  function closeDropdown() {
    const dropdown = getDropdown();

    if (!dropdown) {
      return;
    }

    dropdown.open = false;
    dropdown.classList.remove("site-pages-closing");
  }

  function closeAboutPanelIfOpen() {
    const panel = document.getElementById("mg-dropdown-about-panel");

    if (!panel) {
      return;
    }

    panel.classList.remove("visible");
    panel.setAttribute("aria-hidden", "true");
  }

  function ensureBackdrop() {
    let backdrop = document.getElementById(BACKDROP_ID);

    if (backdrop) {
      return backdrop;
    }

    backdrop = document.createElement("div");
    backdrop.id = BACKDROP_ID;
    backdrop.className = "mg-intro-invitation-backdrop";
    backdrop.setAttribute("aria-hidden", "true");

    backdrop.addEventListener(
      "click",
      event => {
        event.preventDefault();
        event.stopPropagation();
        closeManualInvitationBox();
      },
      true
    );

    document.body.appendChild(backdrop);

    return backdrop;
  }

  function showBackdrop() {
    const backdrop = ensureBackdrop();

    backdrop.classList.add("visible");
    backdrop.setAttribute("aria-hidden", "false");
  }

  function hideBackdrop() {
    const backdrop = document.getElementById(BACKDROP_ID);

    if (!backdrop) {
      return;
    }

    backdrop.classList.remove("visible");
    backdrop.setAttribute("aria-hidden", "true");
  }

  function nudgeExistingInvitationSystem() {
    const marker = getLiveI();

    if (!marker) {
      return;
    }

    const rect = marker.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    /*
      This gently wakes the existing hover/proximity system if the box
      has not been created yet.
    */
    try {
      const pointerEvent = new PointerEvent("pointermove", {
        bubbles: true,
        clientX: x,
        clientY: y,
        pointerType: "mouse"
      });

      document.dispatchEvent(pointerEvent);
      marker.dispatchEvent(pointerEvent);
    } catch (error) {
      const mouseEvent = new MouseEvent("mousemove", {
        bubbles: true,
        clientX: x,
        clientY: y
      });

      document.dispatchEvent(mouseEvent);
      marker.dispatchEvent(mouseEvent);
    }
  }

  function createFallbackInvitationBox() {
    if (getQuoteBox()) {
      return getQuoteBox();
    }

    const box = document.createElement("aside");

    box.id = "title-memory-quote";
    box.className =
      "title-memory-quote title-memory-quote-bilingual title-memory-quote-persian title-memory-quote-farsi";
    box.dataset.language = "fa";
    box.setAttribute("lang", "fa");
    box.setAttribute("dir", "rtl");
    box.setAttribute("aria-hidden", "true");
    box.setAttribute("aria-label", "Missing Geographies introduction and invitation");

    /*
      Minimal skeleton.
      Your existing final Persian/English invitation patches will replace
      the inner content because they look for these same inner containers.
    */
    box.innerHTML = `
      <div class="title-memory-invitation-toolbar" dir="ltr">
        <button
          id="title-memory-language-toggle"
          class="title-memory-language-toggle"
          type="button"
          aria-label="Show English translation"
        >English</button>
      </div>

      <div
        id="title-memory-invitation-scroll"
        class="title-memory-invitation-scroll"
        lang="fa"
        dir="rtl"
      >
        <div
          class="title-memory-invitation-inner title-memory-invitation-inner-fa"
          lang="fa"
          dir="rtl"
        >
          <p
            class="title-memory-invitation-greeting"
            lang="fa"
            dir="rtl"
          >هموطن عزیزم،</p>
        </div>
      </div>
    `;

    document.body.appendChild(box);

    return box;
  }

  async function ensureInvitationBox() {
    let box = getQuoteBox();

    if (box) {
      return box;
    }

    nudgeExistingInvitationSystem();

    await new Promise(resolve => window.setTimeout(resolve, 90));

    box = getQuoteBox();

    if (box) {
      return box;
    }

    return createFallbackInvitationBox();
  }

  function ensureManualCloseButton(box) {
    if (!box) {
      return;
    }

    let closeButton = box.querySelector(".mg-intro-invitation-close");

    if (closeButton) {
      return;
    }

    closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "mg-intro-invitation-close";
    closeButton.setAttribute("aria-label", "Close introduction and invitation");
    closeButton.setAttribute("title", "Close");
    closeButton.textContent = "×";

    closeButton.addEventListener(
      "click",
      event => {
        event.preventDefault();
        event.stopPropagation();
        closeManualInvitationBox();
      },
      true
    );

    box.appendChild(closeButton);
  }

  function forceInvitationBoxOpen() {
    const box = getQuoteBox();

    if (!box || !manualInvitationOpen) {
      return;
    }

    box.classList.add(
      "visible",
      "mg-intro-invitation-open",
      "mg-title-invitation-expanded",
      "title-memory-quote-bilingual"
    );

    box.setAttribute("aria-hidden", "false");

    /*
      Keep the full letter readable when opened from the dropdown.
      The hover version can still behave compactly when opened from the i.
    */
    box.classList.remove("mg-title-invitation-collapsed");

    ensureManualCloseButton(box);
  }

  function startKeepingInvitationOpen() {
    stopKeepingInvitationOpen();

    keepOpenTimer = window.setInterval(() => {
      if (!manualInvitationOpen) {
        stopKeepingInvitationOpen();
        return;
      }

      forceInvitationBoxOpen();
    }, 220);
  }

  function stopKeepingInvitationOpen() {
    if (keepOpenTimer) {
      window.clearInterval(keepOpenTimer);
      keepOpenTimer = null;
    }
  }

  async function openManualInvitationBox() {
    closeDropdown();
    closeAboutPanelIfOpen();

    const box = await ensureInvitationBox();

    if (!box) {
      return;
    }

    manualInvitationOpen = true;

    document.documentElement.classList.add("mg-intro-invitation-active");
    document.body.classList.add("mg-intro-invitation-active");

    showBackdrop();
    forceInvitationBoxOpen();
    startKeepingInvitationOpen();

    const scroll = document.getElementById("title-memory-invitation-scroll");

    if (scroll) {
      scroll.scrollTop = 0;
    }

    /*
      Let the existing final-letter patches populate/repair the content,
      then force the box open again after they do their work.
    */
    window.setTimeout(forceInvitationBoxOpen, 80);
    window.setTimeout(forceInvitationBoxOpen, 260);
    window.setTimeout(forceInvitationBoxOpen, 700);
  }

  function closeManualInvitationBox() {
    manualInvitationOpen = false;
    stopKeepingInvitationOpen();
    hideBackdrop();

    document.documentElement.classList.remove("mg-intro-invitation-active");
    document.body.classList.remove("mg-intro-invitation-active");

    const box = getQuoteBox();

    if (!box) {
      return;
    }

    box.classList.remove(
      "visible",
      "mg-intro-invitation-open",
      "mg-title-invitation-expanded"
    );

    box.setAttribute("aria-hidden", "true");
  }

  function handleIntroInvitationActivation(event) {
    const trigger =
      event.target &&
      event.target.closest &&
      event.target.closest(`.${BUTTON_CLASS}`);

    if (!trigger) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    openManualInvitationBox();
  }

  document.addEventListener("click", handleIntroInvitationActivation, true);

  document.addEventListener(
    "keydown",
    event => {
      if (event.key === "Escape") {
        closeManualInvitationBox();
        return;
      }

      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      const trigger =
        event.target &&
        event.target.closest &&
        event.target.closest(`.${BUTTON_CLASS}`);

      if (!trigger) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      openManualInvitationBox();
    },
    true
  );

  document.addEventListener(
    "pointerdown",
    event => {
      if (!manualInvitationOpen) {
        return;
      }

      const box = getQuoteBox();

      const clickedInsideBox = box && box.contains(event.target);
      const clickedTrigger =
        event.target &&
        event.target.closest &&
        event.target.closest(`.${BUTTON_CLASS}`);

      const clickedBackdrop =
        event.target &&
        event.target.id === BACKDROP_ID;

      if (clickedInsideBox || clickedTrigger || clickedBackdrop) {
        return;
      }

      closeManualInvitationBox();
    },
    true
  );

  /*
    If the language toggle rebuilds the box, keep the manual opening alive.
  */
  document.addEventListener(
    "click",
    event => {
      if (
        !manualInvitationOpen ||
        !event.target ||
        !event.target.closest ||
        !event.target.closest("#title-memory-language-toggle")
      ) {
        return;
      }

      window.setTimeout(forceInvitationBoxOpen, 40);
      window.setTimeout(forceInvitationBoxOpen, 180);
      window.setTimeout(forceInvitationBoxOpen, 420);
    },
    true
  );

  function initializeIntroInvitationButton() {
    installIntroInvitationButton();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeIntroInvitationButton);
  } else {
    initializeIntroInvitationButton();
  }

  /*
    The dropdown can be rebuilt by existing patches, so restore our item
    after rebuilds without touching the rest of the menu.
  */
  window.setTimeout(initializeIntroInvitationButton, 250);
  window.setTimeout(initializeIntroInvitationButton, 700);
  window.setTimeout(initializeIntroInvitationButton, 1400);
  window.setTimeout(initializeIntroInvitationButton, 2400);

  const observer = new MutationObserver(() => {
    installIntroInvitationButton();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
})();
/* ==========================================================
   FIX INTRODUCTION/INVITATION BUTTON — USE EXISTING I-BOX ONLY

   Goal:
   - Keep the Introduction/Invitation dropdown button.
   - Clicking it opens the existing blinking-i invitation box.
   - Do NOT create a new invitation box.
   - Do NOT center the box.
   - Do NOT use the old manual modal/backdrop behavior.
   - Keep the normal blinking-i hover interaction intact.

   Paste at the VERY BOTTOM of script.js.
   ========================================================== */

(function fixIntroInvitationToUseExistingTitleBoxOnly() {
  if (window.__mgIntroInvitationUseExistingBoxOnlyReady) {
    return;
  }

  window.__mgIntroInvitationUseExistingBoxOnlyReady = true;

  const BUTTON_TEXT = "Introduction/Invitation";
  const BUTTON_CLASS = "mg-intro-invitation-trigger";
  const OLD_BACKDROP_ID = "mg-intro-invitation-backdrop";

  let openedFromDropdown = false;
  let cleanupTimer = null;

  function clean(value) {
    return String(value || "").trim();
  }

  function normalizeText(value) {
    return clean(value)
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function getQuoteBox() {
    return document.getElementById("title-memory-quote");
  }

  function getLiveI() {
    return document.querySelector(".title-live-i");
  }

  function getDropdown() {
    return document.querySelector(".site-pages-dropdown");
  }

  function getDropdownPanel() {
    return document.querySelector(
      ".site-pages-dropdown .site-pages-card, .site-pages-card"
    );
  }

  function isIntroButton(element) {
    if (!element) {
      return false;
    }

    return (
      element.classList.contains(BUTTON_CLASS) ||
      normalizeText(element.textContent) === normalizeText(BUTTON_TEXT)
    );
  }

  function isAboutItem(element) {
    return normalizeText(element && element.textContent) === "about";
  }

  function isContributeItem(element) {
    return normalizeText(element && element.textContent) === "contribute";
  }

  function getDropdownItems(panel) {
    if (!panel) {
      return [];
    }

    return Array.from(
      panel.querySelectorAll(".site-pages-link, a, button")
    ).filter(item => {
      return item.closest(".site-pages-card") === panel;
    });
  }

  function makeButton() {
    const button = document.createElement("button");

    button.type = "button";
    button.className =
      `site-pages-link site-pages-link-introduction-invitation ${BUTTON_CLASS}`;

    button.setAttribute(
      "aria-label",
      "Open project introduction and invitation"
    );

    button.setAttribute("title", BUTTON_TEXT);
    button.textContent = BUTTON_TEXT;

    return button;
  }

  function ensureDropdownButton() {
    const panel = getDropdownPanel();

    if (!panel) {
      return false;
    }

    let button = panel.querySelector(`.${BUTTON_CLASS}`);

    if (!button) {
      button = makeButton();
    }

    const items = getDropdownItems(panel);
    const contribute = items.find(isContributeItem);
    const about = items.find(isAboutItem);

    /*
      Preferred placement:
      About
      Introduction/Invitation
      Contribute
    */
    if (contribute && contribute.parentNode === panel) {
      if (button.parentNode !== panel || button.nextElementSibling !== contribute) {
        panel.insertBefore(button, contribute);
      }

      return true;
    }

    if (about && about.parentNode === panel) {
      if (button.parentNode !== panel || about.nextElementSibling !== button) {
        about.insertAdjacentElement("afterend", button);
      }

      return true;
    }

    if (button.parentNode !== panel) {
      panel.appendChild(button);
    }

    return true;
  }

  function closeDropdown() {
    const dropdown = getDropdown();

    if (dropdown) {
      dropdown.open = false;
      dropdown.classList.remove("site-pages-closing");
    }
  }

  function removeOldManualModalArtifacts() {
    /*
      This neutralizes the previous patch that created a modal-style
      backdrop and centered the box.
    */
    const backdrop = document.getElementById(OLD_BACKDROP_ID);

    if (backdrop) {
      backdrop.classList.remove("visible");
      backdrop.setAttribute("aria-hidden", "true");
      backdrop.style.display = "none";
      backdrop.style.pointerEvents = "none";
    }

    document.documentElement.classList.remove("mg-intro-invitation-active");
    document.body.classList.remove("mg-intro-invitation-active");

    const box = getQuoteBox();

    if (box) {
      box.classList.remove("mg-intro-invitation-open");

      const oldClose = box.querySelector(".mg-intro-invitation-close");

      if (oldClose) {
        oldClose.remove();
      }
    }
  }

  function positionExistingBoxNearTitleDot() {
    const box = getQuoteBox();
    const marker = getLiveI();

    if (!box || !marker) {
      return;
    }

    /*
      This mirrors the existing title-dot invitation positioning:
      keep the box near the blinking i, not centered as a modal.
    */
    const width = Math.min(640, window.innerWidth - 34);
    const maxHeight = Math.min(700, window.innerHeight * 0.74);

    const markerRect = marker.getBoundingClientRect();

    const preferredLeft =
      markerRect.left + markerRect.width / 2 - width * 0.16;

    const left = Math.max(
      17,
      Math.min(preferredLeft, window.innerWidth - width - 17)
    );

    let top = markerRect.bottom + 18;

    if (top + maxHeight > window.innerHeight - 18) {
      top = Math.max(74, window.innerHeight - maxHeight - 18);
    }

    box.style.setProperty("position", "fixed", "important");
    box.style.setProperty("left", `${left}px`, "important");
    box.style.setProperty("top", `${top}px`, "important");
    box.style.setProperty("right", "auto", "important");
    box.style.setProperty("bottom", "auto", "important");
    box.style.setProperty("transform", "none", "important");
    box.style.setProperty("width", `${width}px`, "important");
    box.style.setProperty("height", `${maxHeight}px`, "important");
    box.style.setProperty("max-height", `${maxHeight}px`, "important");
    box.style.setProperty("overflow", "hidden", "important");
  }

  function wakeExistingTitleDotSystem() {
    const marker = getLiveI();

    if (!marker) {
      return;
    }

    const rect = marker.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    /*
      Existing hover/proximity logic listens to pointermove near the i.
      This simulates that instead of creating a new box.
    */
    try {
      const event = new PointerEvent("pointermove", {
        bubbles: true,
        clientX: x,
        clientY: y,
        pointerType: "mouse"
      });

      document.dispatchEvent(event);
      marker.dispatchEvent(event);
    } catch (error) {
      const event = new MouseEvent("mousemove", {
        bubbles: true,
        clientX: x,
        clientY: y
      });

      document.dispatchEvent(event);
      marker.dispatchEvent(event);
    }

    /*
      Existing focus behavior also opens the same box.
    */
    try {
      marker.focus({ preventScroll: true });
    } catch (error) {
      marker.focus();
    }
  }

  function openExistingInvitationBox() {
    closeDropdown();
    removeOldManualModalArtifacts();
    wakeExistingTitleDotSystem();

    const box = getQuoteBox();

    if (!box) {
      return;
    }

    openedFromDropdown = true;

    box.classList.add("visible", "mg-existing-invitation-open-from-dropdown");
    box.classList.remove("mg-intro-invitation-open");

    box.setAttribute("aria-hidden", "false");

    positionExistingBoxNearTitleDot();

    const scroll = document.getElementById("title-memory-invitation-scroll");

    if (scroll) {
      scroll.scrollTop = 0;
    }

    /*
      The final Persian/English letter patches may rewrite the box
      immediately after opening. Reposition again after they settle.
    */
    window.setTimeout(() => {
      removeOldManualModalArtifacts();

      const currentBox = getQuoteBox();

      if (currentBox && openedFromDropdown) {
        currentBox.classList.add("visible", "mg-existing-invitation-open-from-dropdown");
        currentBox.setAttribute("aria-hidden", "false");
        positionExistingBoxNearTitleDot();
      }
    }, 80);

    window.setTimeout(() => {
      if (openedFromDropdown) {
        positionExistingBoxNearTitleDot();
      }
    }, 260);

    window.setTimeout(() => {
      if (openedFromDropdown) {
        positionExistingBoxNearTitleDot();
      }
    }, 700);
  }

  function closeExistingInvitationBox() {
    openedFromDropdown = false;

    const box = getQuoteBox();

    if (!box) {
      return;
    }

    box.classList.remove("visible", "mg-existing-invitation-open-from-dropdown");
    box.setAttribute("aria-hidden", "true");
  }

  /*
    IMPORTANT:
    Use window capture so this runs BEFORE the previous document-level
    Intro/Invitation patch. This prevents the old centered modal behavior.
  */
  window.addEventListener(
    "click",
    event => {
      const trigger =
        event.target &&
        event.target.closest &&
        event.target.closest(`.${BUTTON_CLASS}, .site-pages-link`);

      if (!trigger || !isIntroButton(trigger)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      openExistingInvitationBox();
    },
    true
  );

  window.addEventListener(
    "keydown",
    event => {
      if (event.key === "Escape") {
        closeExistingInvitationBox();
        return;
      }

      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      const trigger =
        event.target &&
        event.target.closest &&
        event.target.closest(`.${BUTTON_CLASS}, .site-pages-link`);

      if (!trigger || !isIntroButton(trigger)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      openExistingInvitationBox();
    },
    true
  );

  /*
    Click outside closes the dropdown-opened version.
    The normal hover interaction still behaves as before.
  */
  document.addEventListener(
    "pointerdown",
    event => {
      if (!openedFromDropdown) {
        return;
      }

      const box = getQuoteBox();
      const clickedBox = box && box.contains(event.target);
      const clickedTrigger =
        event.target &&
        event.target.closest &&
        event.target.closest(`.${BUTTON_CLASS}`);

      if (!clickedBox && !clickedTrigger) {
        closeExistingInvitationBox();
      }
    },
    true
  );

  window.addEventListener("resize", () => {
    if (openedFromDropdown) {
      positionExistingBoxNearTitleDot();
    }
  });

  function initialize() {
    ensureDropdownButton();
    removeOldManualModalArtifacts();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize);
  } else {
    initialize();
  }

  window.setTimeout(initialize, 250);
  window.setTimeout(initialize, 700);
  window.setTimeout(initialize, 1400);
  window.setTimeout(initialize, 2400);

  /*
    Lightweight cleanup. This prevents the previous centered modal class
    from winning if that old patch was already pasted.
  */
  cleanupTimer = window.setInterval(() => {
    ensureDropdownButton();

    if (!openedFromDropdown) {
      removeOldManualModalArtifacts();
      return;
    }

    const box = getQuoteBox();

    if (box) {
      box.classList.add("visible", "mg-existing-invitation-open-from-dropdown");
      box.classList.remove("mg-intro-invitation-open");
      box.setAttribute("aria-hidden", "false");
      positionExistingBoxNearTitleDot();
    }

    const backdrop = document.getElementById(OLD_BACKDROP_ID);

    if (backdrop) {
      backdrop.classList.remove("visible");
      backdrop.setAttribute("aria-hidden", "true");
      backdrop.style.display = "none";
      backdrop.style.pointerEvents = "none";
    }
  }, 400);
})();

/* ==========================================================
   LOW-BANDWIDTH SPEED TUNING — PRESERVE FLOATING FRAGMENTS

   This replaces the earlier lite-mode runtime controller that
   converted the animated memory fragments into a static cloud.

   What stays:
   - cached sheet/world loading from the smart loader above
   - image lazy decoding
   - gentle audio preload reduction for slow connections
   - optional render throttle during heavy map animation

   What is removed:
   - setupLiteMemoryCloud()
   - mg-lite-memory-cloud
   - hiding .memory-cloud / .iran-scatter-cloud / .canvas-cloud-layer

   Result:
   Low-bandwidth users still get lighter loading, but the floating
   fragment animation keeps working.
   ========================================================== */

(function mgLowBandwidthRuntimeTuningPreserveFragments() {
  if (window.__mgLowBandwidthRuntimeTuningPreserveFragmentsReady) {
    return;
  }

  window.__mgLowBandwidthRuntimeTuningPreserveFragmentsReady = true;

  function isLiteMode() {
    return Boolean(
      window.mgLowBandwidthMode ||
      document.documentElement.classList.contains("mg-low-bandwidth-mode")
    );
  }

  function clean(value) {
    return String(value || "").trim();
  }

  function isRealAudioUrl(value) {
    const src = clean(value);

    return Boolean(
      src &&
      !/^about:blank$/i.test(src) &&
      !/(^|\/)assets\/audio\/story-001\.wav([?#].*)?$/i.test(src)
    );
  }

  function removeOldLiteCloudArtifacts() {
    document.getElementById("mg-lite-memory-cloud")?.remove();

    const oldRuntimeStyle = document.getElementById("mg-low-bandwidth-runtime-style");

    if (oldRuntimeStyle) {
      oldRuntimeStyle.remove();
    }
  }

  function injectSafeLiteModeCss() {
    if (document.getElementById("mg-low-bandwidth-runtime-style-safe")) {
      return;
    }

    removeOldLiteCloudArtifacts();

    const style = document.createElement("style");
    style.id = "mg-low-bandwidth-runtime-style-safe";
    style.textContent = `
      html.mg-low-bandwidth-mode body::before {
        opacity: 0.045 !important;
        background-size: 14px 14px !important;
      }

      html.mg-low-bandwidth-mode .page-atmosphere {
        opacity: 0.38 !important;
      }

      html.mg-low-bandwidth-mode .story-card,
      html.mg-low-bandwidth-mode .site-pages-card,
      html.mg-low-bandwidth-mode .mg-dropdown-about-panel,
      html.mg-low-bandwidth-mode .title-memory-quote,
      html.mg-low-bandwidth-mode .audio-dock,
      html.mg-low-bandwidth-mode #mg-unified-media-panel,
      html.mg-low-bandwidth-mode .mg-unified-media-panel,
      html.mg-low-bandwidth-mode [class*="modal"],
      html.mg-low-bandwidth-mode [class*="reader"] {
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
      }

      html.mg-low-bandwidth-mode .connection-line,
      html.mg-low-bandwidth-mode .call-country-outline,
      html.mg-low-bandwidth-mode .iran-outline {
        filter: none !important;
      }

      html.mg-low-bandwidth-mode img {
        image-rendering: auto !important;
      }

      html.mg-low-bandwidth-mode .mg-stable-image,
      html.mg-low-bandwidth-mode .mg-unified-media-image,
      html.mg-low-bandwidth-mode .story-post-audio-image {
        filter: none !important;
        box-shadow: 0 0 0 1px rgba(255, 207, 102, 0.08) !important;
      }

      /* Critical repair: never hide or replace the animated fragments. */
      html.mg-low-bandwidth-mode .memory-cloud,
      html.mg-low-bandwidth-mode .memory-cloud-front,
      html.mg-low-bandwidth-mode .memory-cloud-back,
      html.mg-low-bandwidth-mode .iran-scatter-cloud,
      html.mg-low-bandwidth-mode .fixed-memory-cloud,
      html.mg-low-bandwidth-mode .canvas-cloud-layer {
        display: block !important;
        visibility: visible !important;
      }

      html.mg-low-bandwidth-mode .memory-cloud-item,
      html.mg-low-bandwidth-mode .iran-scatter-cloud-item,
      html.mg-low-bandwidth-mode .fixed-memory-cloud-item {
        animation-play-state: running !important;
      }

      #mg-lite-memory-cloud,
      .mg-lite-memory-cloud {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }
    `;

    document.head.appendChild(style);
  }

  /*
    Keep this throttle modest. It affects the globe render loop during
    heavy travel, not the separate memory-cloud requestAnimationFrame loop.
  */
  if (typeof render === "function" && !window.__mgLiteRenderThrottleInstalled) {
    const previousRender = render;

    let lastRenderAt = 0;
    let lastPhase = "";
    let lastScale = 0;

    render = function mgLiteThrottledRenderPreserveFragments() {
      if (!isLiteMode()) {
        return previousRender.apply(this, arguments);
      }

      const now = performance.now();
      const phase = typeof journeyPhase !== "undefined" ? journeyPhase : "";
      const scale = typeof currentScale !== "undefined" ? currentScale : 0;

      const phaseChanged = phase !== lastPhase;
      const scaleJumped = Math.abs(scale - lastScale) > 24;
      const notAnimating =
        typeof isJourneyAnimating === "undefined" ||
        !isJourneyAnimating;

      if (
        !phaseChanged &&
        !scaleJumped &&
        !notAnimating &&
        now - lastRenderAt < 34
      ) {
        return;
      }

      lastRenderAt = now;
      lastPhase = phase;
      lastScale = scale;

      return previousRender.apply(this, arguments);
    };

    window.__mgLiteRenderThrottleInstalled = true;
  }

  /*
    Do not override setupMemoryCloud or destroyMemoryCloud.
    The previous patch did that, and that is what stopped the animated
    fragments. We only repair if an old static cloud is present.
  */
  function repairAnimatedMemoryCloud() {
    removeOldLiteCloudArtifacts();

    const hasAnimatedCloud = Boolean(
      document.querySelector(".memory-cloud, .iran-scatter-cloud, .fixed-memory-cloud, .canvas-cloud-layer")
    );

    if (
      !hasAnimatedCloud &&
      Array.isArray(stories) &&
      stories.length &&
      !activeStory &&
      !isJourneyAnimating &&
      typeof setupMemoryCloud === "function"
    ) {
      try {
        setupMemoryCloud();
      } catch (error) {}
    }
  }

  if (
    typeof prepareStoryAudio === "function" &&
    !window.__mgLiteAudioPrepareInstalled
  ) {
    const previousPrepareStoryAudio = prepareStoryAudio;

    prepareStoryAudio = function mgLitePrepareStoryAudioPreserveFragments(story) {
      if (
        isLiteMode() &&
        story &&
        isRealAudioUrl(story.audio)
      ) {
        audio.preload = "none";
        audio.dataset.mgPendingAudio = story.audio;

        try {
          audio.pause();
          audio.removeAttribute("src");
          audio.load();
        } catch (error) {}

        if (typeof refreshAudioDock === "function") {
          refreshAudioDock();
        }

        return;
      }

      return previousPrepareStoryAudio.apply(this, arguments);
    };

    window.__mgLiteAudioPrepareInstalled = true;
  }

  if (
    typeof playStoryAudio === "function" &&
    !window.__mgLiteAudioPlayInstalled
  ) {
    const previousPlayStoryAudio = playStoryAudio;

    playStoryAudio = function mgLitePlayStoryAudioPreserveFragments(story) {
      if (
        isLiteMode() &&
        story &&
        isRealAudioUrl(story.audio)
      ) {
        audio.preload = "metadata";
      }

      return previousPlayStoryAudio.apply(this, arguments);
    };

    window.__mgLiteAudioPlayInstalled = true;
  }

  function optimizeImageElement(image) {
    if (!image || image.dataset.mgLiteOptimized === "yes") {
      return;
    }

    image.dataset.mgLiteOptimized = "yes";
    image.loading = "lazy";
    image.decoding = "async";

    if (isLiteMode()) {
      image.setAttribute("fetchpriority", "low");
    }
  }

  document.querySelectorAll("img").forEach(optimizeImageElement);

  const imageObserver = new MutationObserver(mutations => {
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (!node || node.nodeType !== 1) {
          return;
        }

        if (node.tagName && node.tagName.toLowerCase() === "img") {
          optimizeImageElement(node);
          return;
        }

        node.querySelectorAll?.("img").forEach(optimizeImageElement);
      });
    });
  });

  imageObserver.observe(document.body, {
    childList: true,
    subtree: true
  });

  injectSafeLiteModeCss();

  window.setTimeout(repairAnimatedMemoryCloud, 500);
  window.setTimeout(repairAnimatedMemoryCloud, 1400);
  window.setTimeout(repairAnimatedMemoryCloud, 2800);

  if (isLiteMode()) {
    document.documentElement.classList.add("mg-low-bandwidth-mode");
  }
})();

