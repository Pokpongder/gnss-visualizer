/**
 * ==========================================================================
 * GNSS Observation Offline Visualizer - Core Application Logic & State
 * ==========================================================================
 */

// Application State Store
const state = {
    db: null,
    loadedData: {},      // Structure: { "KMIT6": [ {epoch_data}, ... ], ... }
    activeStation: null,  // Current station analyzed in sidebar
    tempParsedRows: null, // Temporary CSV rows prior to column mapping
    tempHeaders: [],      // Temporary CSV headers
    activeDay: '121',     // Active observation day DOY ('121', '123', '124', '087')
    posMode: 'spp',       // Positioning solution mode ('spp', 'dgnss')
    theme: 'dark',        // Current active UI theme ('dark', 'light')
    ippData: null,        // Loaded day's IPP data
    ippLayerEnabled: false,
    ippShowLines: true,
    ippConstellation: 'all',
    ippMetric: 'vtec'
};

// Auto-detection Regex Rules for CSV Headers
const AUTO_DETECT_RULES = {
    station: /station|code|name|id|st/i,
    time: /time|timestamp|date|epoch|datetime|t\b/i,
    lat: /lat|latitude/i,
    lon: /lon|longitude|lng/i,
    errEast: /error_east|east_error|de\b|error_e|dx\b|error_x/i,
    errNorth: /error_north|north_error|dn\b|error_n|dy\b|error_y/i,
    errUp: /error_up|up_error|du\b|error_u|dz\b|error_z/i,
    s4: /s4|scintillation|s4_index|s4_c1c/i,
    vtec: /vtec|tec\b|vertical_tec|v_tec/i
};

/* ==========================================================================
   1. IndexedDB Wrapper for Client-Side Dataset Storage
   ========================================================================== */
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("GNSSObservationDB", 1);
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains("datasets")) {
                db.createObjectStore("datasets", { keyPath: "stationName" });
            }
        };

        request.onsuccess = (event) => {
            state.db = event.target.result;
            resolve(state.db);
        };

        request.onerror = (event) => {
            console.error("IndexedDB open error:", event.target.error);
            reject(event.target.error);
        };
    });
}

function saveStationToDB(stationName, dataPoints) {
    return new Promise((resolve, reject) => {
        const transaction = state.db.transaction(["datasets"], "readwrite");
        const store = transaction.objectStore("datasets");
        const request = store.put({ stationName: stationName.toUpperCase(), dataPoints: dataPoints });

        request.onsuccess = () => resolve();
        request.onerror = (e) => reject(e.target.error);
    });
}

function getAllStationsFromDB() {
    return new Promise((resolve, reject) => {
        const transaction = state.db.transaction(["datasets"], "readonly");
        const store = transaction.objectStore("datasets");
        const request = store.getAll();

        request.onsuccess = (event) => {
            const results = event.target.result;
            const dataMap = {};
            results.forEach(item => {
                dataMap[item.stationName] = item.dataPoints;
            });
            resolve(dataMap);
        };
        request.onerror = (e) => reject(e.target.error);
    });
}

function clearAllDBData() {
    return new Promise((resolve, reject) => {
        const transaction = state.db.transaction(["datasets"], "readwrite");
        const store = transaction.objectStore("datasets");
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = (e) => reject(e.target.error);
    });
}

/* ==========================================================================
   2. App Initialization & Lifecycles
   ========================================================================== */
window.addEventListener("DOMContentLoaded", async () => {
    // Initialize Theme immediately to prevent flash
    const savedTheme = localStorage.getItem('theme') || 'dark';
    state.theme = savedTheme;
    document.documentElement.setAttribute('data-theme', savedTheme);

    // Set initial theme toggle icon before loading Lucide icons
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    if (themeToggleBtn) {
        const icon = themeToggleBtn.querySelector('i');
        if (icon) {
            icon.setAttribute('data-lucide', savedTheme === 'dark' ? 'sun' : 'moon');
        }
    }

    // Set initial chart defaults
    if (typeof setChartTheme === 'function') {
        setChartTheme(savedTheme);
    }

    // 1. Load icons
    lucide.createIcons();

    // 2. Initialize Database & Map
    try {
        await initDB();
        initMap();
        
        // 3. Load Datasets
        await loadDatasets();

        // 4. Register DOM Event Listeners
        registerDOMEvents();
        
    } catch (err) {
        console.error("Initialization error:", err);
    }
});

// Preloaded GNSS observation dataset configurations (located in /data/ folder)
const DATASET_CONFIG = {
    "121": {
        name: "Day 121 (2026 - Quiet)",
        folder: "data/121_quiet/",
        doy: 121,
        year: 2026,
        stations: ["CADT", "CHAN", "CHMA", "CM01", "CNBR", "DPT9", "HUEV", "ITC0", "KKU0", "KMIT6", "LPBR", "NKNY", "NKRM", "NKSW", "NUO2", "PJRK", "RUT1", "SISK", "SOKA", "SPBR", "SRTN", "STFD", "UDON", "UTTD"],
        hasDgnss: true,
        vtecPattern: (st) => `data/121_quiet/VTEC_${st}_121.csv`,
        rotiPattern: (st) => `data/121_quiet/ROTI_${st}_121.csv`,
        posSppPattern: (st) => `data/121_quiet/${st}1210_spp.pos`,
        posDgnssPattern: (st) => `data/121_quiet/${st}1210_dgnss.pos`
    },
    "123": {
        name: "Day 123 (2026 - Severe Disturbance)",
        folder: "data/123_severe_dist/",
        doy: 123,
        year: 2026,
        stations: ["CADT", "CHAN", "CHMA", "CM01", "CNBR", "DPT9", "HUEV", "ITC0", "KKU0", "KMIT6", "LPBR", "NKNY", "NKRM", "NKSW", "NUO2", "PJRK", "RUT1", "SISK", "SOKA", "SPBR", "SRTN", "STFD", "UDON", "UTTD"],
        hasDgnss: true,
        vtecPattern: (st) => `data/123_severe_dist/VTEC_${st}_123.csv`,
        rotiPattern: (st) => `data/123_severe_dist/ROTI_${st}_123.csv`,
        posSppPattern: (st) => `data/123_severe_dist/${st}1230_spp.pos`,
        posDgnssPattern: (st) => `data/123_severe_dist/${st}1230_dgnss.pos`
    },
    "124": {
        name: "Day 124 (2026 - Quiet)",
        folder: "data/124_quiet/",
        doy: 124,
        year: 2026,
        stations: ["CADT", "CHAN", "CHMA", "CM01", "CNBR", "DPT9", "HUEV", "ITC0", "KKU0", "KMIT6", "LPBR", "NKNY", "NKRM", "NKSW", "NUO2", "PJRK", "RUT1", "SISK", "SOKA", "SPBR", "SRTN", "STFD", "UDON", "UTTD"],
        hasDgnss: true,
        vtecPattern: (st) => `data/124_quiet/VTEC_${st}_124.csv`,
        rotiPattern: (st) => `data/124_quiet/ROTI_${st}_124.csv`,
        posSppPattern: (st) => `data/124_quiet/${st}1240_spp.pos`,
        posDgnssPattern: (st) => `data/124_quiet/${st}1240_dgnss.pos`
    },
    "087": {
        name: "Day 087 (2025 - Earthquake)",
        folder: "data/087_2025_earthquake/",
        doy: 87,
        year: 2025,
        stations: ["CADT", "CHAN", "CHMA", "CM01", "CNBR", "DPT9", "HUEV", "ITC0", "KMIT6", "LPBR", "NKNY", "NKRM", "NKSW", "NUO2", "PJRK", "SISK", "SOKA", "SPBR", "SRTN", "STFD", "UDON", "UTTD"],
        hasDgnss: true,
        vtecPattern: (st) => `data/087_2025_earthquake/VTEC_${st}_ 87.csv`,
        rotiPattern: (st) => `data/087_2025_earthquake/ROTI_${st}_ 87.csv`,
        posSppPattern: (st) => `data/087_2025_earthquake/${st}0870_spp.pos`,
        posDgnssPattern: (st) => `data/087_2025_earthquake/${st}0870_dgnss.pos`
    }
};

/**
 * Handles station name aliases (e.g. KMIT6 is named KMI6 in local filenames)
 */
function getFileStationName(stationName) {
    const name = stationName.toUpperCase();
    if (name === 'KMIT6') return 'KMI6';
    return name;
}

/**
 * Helper to fetch a text file.
 */
async function fetchFileText(url) {
    if (!url) return null;
    try {
        const response = await fetch(url);
        if (!response.ok) {
            console.warn(`File not found: ${url} (HTTP ${response.status})`);
            return null;
        }
        return await response.text();
    } catch (err) {
        console.error(`Error fetching ${url}:`, err);
        return null;
    }
}

/**
 * Lazy loads all files for a selected station on-demand.
 */
async function loadStationOnDemand(stationName) {
    const config = DATASET_CONFIG[state.activeDay];
    if (!config) return;

    const fileStation = getFileStationName(stationName);
    const vtecUrl = config.vtecPattern(fileStation);
    const rotiUrl = config.rotiPattern(fileStation);
    const isDgnssMode = state.posMode === 'dgnss' && config.hasDgnss;
    const posUrl = isDgnssMode ? config.posDgnssPattern(fileStation) : config.posSppPattern(fileStation);

    console.log(`Loading station ${stationName} on-demand (Day ${state.activeDay}, Mode: ${state.posMode})...`);

    // Fetch texts concurrently
    const [vtecText, rotiText, posText] = await Promise.all([
        fetchFileText(vtecUrl),
        fetchFileText(rotiUrl),
        fetchFileText(posUrl)
    ]);

    let successCount = 0;

    // Parse sequentially to avoid database race conditions/overwrite issues
    if (vtecText) {
        await parseAndStoreCSVText(vtecUrl.split('/').pop(), vtecText);
        successCount++;
    }
    if (rotiText) {
        await parseAndStoreCSVText(rotiUrl.split('/').pop(), rotiText);
        successCount++;
    }
    if (posText) {
        await parseAndStorePOSText(posUrl.split('/').pop(), posText);
        successCount++;
        state.loadedPOS[stationName] = state.posMode;
    }

    if (successCount === 0) {
        throw new Error(`Failed to load files for station ${stationName}.`);
    }

    // Refresh UI stats
    updateDashboardStats();
}

/**
 * Toggles the map floating preloading progress bar
 */
function showMapLoading(show) {
    const indicator = document.getElementById('map-loading-indicator');
    if (show) {
        indicator.classList.add('active');
    } else {
        indicator.classList.remove('active');
    }
}

/**
 * Loads positioning .pos file on-demand for the active mode
 */
async function loadStationPOSOnDemand(stationName) {
    const config = DATASET_CONFIG[state.activeDay];
    if (!config) return;

    const fileStation = getFileStationName(stationName);
    const isDgnssMode = state.posMode === 'dgnss' && config.hasDgnss;
    const posUrl = isDgnssMode ? config.posDgnssPattern(fileStation) : config.posSppPattern(fileStation);

    if (!posUrl) return;

    console.log(`Loading positioning file on-demand for ${stationName}: ${posUrl}`);
    const posText = await fetchFileText(posUrl);
    if (!posText) {
        throw new Error(`Failed to load positioning error file.`);
    }

    await parseAndStorePOSText(posUrl.split('/').pop(), posText);
    state.loadedPOS[stationName] = state.posMode;
}

/**
 * Loads preloaded datasets from the data/ folder.
 * Preloads VTEC & ROTI for ALL active stations of the selected day.
 */
async function loadDatasets() {
    console.log(`Initializing datasets for Day: ${state.activeDay}`);
    
    // Always clear IndexedDB and start fresh to load from the /data/ folder
    await clearAllDBData();
    state.loadedData = {};
    state.loadedPOS = {};

    // Refresh UI states
    updateDashboardStats();
    updatePosModeToggleState();

    const config = DATASET_CONFIG[state.activeDay];
    
    // Show map preloading bar
    showMapLoading(true);

    // Build URL queue and fetch texts in parallel
    const fetchPromises = [];
    const stationOrder = [];

    config.stations.forEach(station => {
        const fileStation = getFileStationName(station);
        const vtecUrl = config.vtecPattern(fileStation);
        const rotiUrl = config.rotiPattern(fileStation);

        stationOrder.push({ type: 'vtec', fileName: vtecUrl.split('/').pop() });
        fetchPromises.push(fetchFileText(vtecUrl));

        stationOrder.push({ type: 'roti', fileName: rotiUrl.split('/').pop() });
        fetchPromises.push(fetchFileText(rotiUrl));
    });

    const results = await Promise.all(fetchPromises);
    showMapLoading(false);

    // Parse and store sequentially to prevent write conflict race conditions
    for (let i = 0; i < results.length; i++) {
        const text = results[i];
        if (text) {
            await parseAndStoreCSVText(stationOrder[i].fileName, text);
        }
    }

    // Update active stations markers on the map
    updateMapMarkers(config.stations);
    updateDashboardStats();

    // Retain currently active station if it exists in the new day's dataset
    const prevStation = state.activeStation;
    const keepSelected = prevStation && config.stations.includes(prevStation.toUpperCase());

    if (keepSelected) {
        try {
            await window.handleStationSelect(prevStation);
        } catch (err) {
            console.error(`Failed to reload active station ${prevStation}:`, err);
        }
    } else {
        state.activeStation = null;
        closeSidebar();
    }

    // Load IPP data for the new day
    await loadIPPDataset();
}

/**
 * Recalculate stats shown on map floating card overlays
 */
function updateDashboardStats() {
    const config = DATASET_CONFIG[state.activeDay];
    const totalStations = config ? config.stations.length : PRESET_STATIONS.length;
    const loadedStations = Object.keys(state.loadedData).length;
    
    let totalEpochs = 0;
    for (const station in state.loadedData) {
        totalEpochs += state.loadedData[station].length;
    }

    document.getElementById('stat-total-stations').textContent = totalStations;
    document.getElementById('stat-loaded-stations').textContent = loadedStations;
    document.getElementById('stat-total-epochs').textContent = totalEpochs.toLocaleString();

    // Update status labels to show selected day
    const dayName = config ? config.name : "Preloaded Datasets";
    document.getElementById('dataset-name-display').textContent = `Active: ${dayName}`;
    
    const dot = document.getElementById('status-dot');
    if (loadedStations > 0) {
        dot.className = "pulse-dot green";
    } else {
        dot.className = "pulse-dot";
        dot.style.backgroundColor = "#4b5563";
        dot.style.boxShadow = "none";
    }
}

/* ==========================================================================
   3. Event Handlers & Dom Bindings
   ========================================================================== */
function registerDOMEvents() {
    // Dropdown / Modal Controls
    const importBtn = document.getElementById('import-btn');
    const downloadSampleBtn = document.getElementById('download-sample-btn');
    
    const importModal = document.getElementById('import-modal');
    
    const closeImportBtn = document.getElementById('close-import-modal');

    // Sidebar Close
    document.getElementById('close-sidebar-btn').onclick = closeSidebar;

    // Open/Close Modals
    importBtn.onclick = () => {
        // Reset file input and display
        document.getElementById('csv-file-input').value = '';
        document.getElementById('dropzone').style.display = 'block';
        document.getElementById('mapping-wizard').style.display = 'none';
        importModal.classList.add('open');
    };
    closeImportBtn.onclick = () => importModal.classList.remove('open');
    
    downloadSampleBtn.onclick = downloadSampleCSV;

    // Theme Toggle Binding
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    if (themeToggleBtn) {
        themeToggleBtn.onclick = () => toggleTheme();
    }

    // CSV File Select Bindings
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('csv-file-input');

    dropzone.onclick = () => fileInput.click();
    fileInput.onchange = (e) => handleFileSelect(e.target.files[0]);

    // Drag-and-Drop
    dropzone.ondragover = (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
    };
    dropzone.ondragleave = () => dropzone.classList.remove('dragover');
    dropzone.ondrop = (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            handleFileSelect(e.dataTransfer.files[0]);
        }
    };

    // Mapping Back Button
    document.getElementById('back-to-upload').onclick = () => {
        document.getElementById('mapping-wizard').style.display = 'none';
        document.getElementById('dropzone').style.display = 'block';
    };

    // Mapping Confirm Button
    document.getElementById('confirm-mapping').onclick = processAndLoadCSVData;

    // Tab buttons bindings
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.onclick = (e) => {
            const tabId = btn.dataset.tab;
            
            // Remove active classes
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            
            // Add active classes
            btn.classList.add('active');
            document.getElementById(tabId).classList.add('active');

            // Force Chart resize/updates because they may render weirdly in hidden containers
            if (activeCharts.scatterError) activeCharts.scatterError.resize();
            if (activeCharts.timeseriesError) activeCharts.timeseriesError.resize();
            if (activeCharts.s4) activeCharts.s4.resize();
            if (activeCharts.vtec) activeCharts.vtec.resize();
        };
    });

    // Expanded Chart Modal Controls
    const expandedModal = document.getElementById('chart-expanded-modal');
    const closeExpandedBtn = document.getElementById('close-expanded-modal');
    
    closeExpandedBtn.onclick = () => {
        expandedModal.classList.remove('open');
        if (activeCharts.expanded) {
            activeCharts.expanded.destroy();
            activeCharts.expanded = null;
        }
    };

    // Chart click to expand logic
    document.querySelectorAll('.chart-wrapper').forEach(wrapper => {
        wrapper.onclick = (e) => {
            // Ignore direct clicks on the canvas (so legend/tooltip interactions work)
            if (e.target.tagName === 'CANVAS') {
                return;
            }
            
            const chartType = wrapper.dataset.chartType;
            if (!chartType) return;

            const stationName = state.activeStation;
            if (!stationName) return;

            const stationData = state.loadedData[stationName];
            if (!stationData) return;

            // Show modal
            expandedModal.classList.add('open');
            
            // Draw chart
            renderExpandedChart(chartType, stationName, stationData);
        };
    });

    // Day Selection Change Event
    document.getElementById('day-select').onchange = async (e) => {
        state.activeDay = e.target.value;
        await loadDatasets();
    };

    // Positioning Mode Toggle Events (SPP vs DGNSS)
    document.querySelectorAll('[data-pos-mode]').forEach(btn => {
        btn.onclick = async () => {
            const mode = btn.dataset.posMode;
            if (mode === state.posMode) return;

            // Toggle active styles
            document.querySelectorAll('[data-pos-mode]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            state.posMode = mode;

            // If we have an active station, reload it in the new mode and update charts!
            if (state.activeStation) {
                try {
                    showSidebarLoading(true);
                    await loadStationOnDemand(state.activeStation);
                    showSidebarLoading(false);
                    
                    // Refresh charts
                    const stationData = state.loadedData[state.activeStation];
                    updateStationCharts(state.activeStation, stationData);
                } catch (err) {
                    showSidebarLoading(false);
                    alert(`Error switching positioning mode: ${err.message}`);
                }
            }
        };
    });

    // Close Modal overlays clicking outside content
    window.onclick = (event) => {
        if (event.target === importModal) importModal.classList.remove('open');
        if (event.target === expandedModal) {
            expandedModal.classList.remove('open');
            if (activeCharts.expanded) {
                activeCharts.expanded.destroy();
                activeCharts.expanded = null;
            }
        }
    };

    // IPP Layer Toggles & Filters
    const ippLayerToggle = document.getElementById('ipp-layer-toggle');
    const ippControlsGroup = document.getElementById('ipp-controls-group');
    const ippMetricSelect = document.getElementById('ipp-metric-select');
    const ippConstellationSelect = document.getElementById('ipp-constellation-select');
    const ippLinesToggle = document.getElementById('ipp-lines-toggle');

    const timelineContainer = document.getElementById('timeline-container');
    const timelineSlider = document.getElementById('timeline-slider');
    const playBtn = document.getElementById('timeline-play-btn');

    // Toggle Station Layer visibility
    const stationLayerToggle = document.getElementById('station-layer-toggle');
    if (stationLayerToggle) {
        stationLayerToggle.onchange = (e) => {
            if (typeof toggleStationMarkersVisibility === 'function') {
                toggleStationMarkersVisibility(e.target.checked);
            }
        };
    }

    // Metric Selector (VTEC vs ROTI)
    if (ippMetricSelect) {
        ippMetricSelect.onchange = (e) => {
            const metric = e.target.value;
            state.ippMetric = metric;
            
            const legendTitle = document.getElementById('legend-metric-title');
            const legendBar = document.getElementById('legend-color-bar');
            
            if (metric === 'roti') {
                legendTitle.textContent = "ROTI Intensity (TECU/min)";
                document.getElementById('legend-tick-0').textContent = "0";
                document.getElementById('legend-tick-1').textContent = "0.1";
                document.getElementById('legend-tick-2').textContent = "0.25";
                document.getElementById('legend-tick-3').textContent = "0.5";
                document.getElementById('legend-tick-4').textContent = "1.0+";
                
                // ROTI gradient blocks aligned to boundaries: 0-0.1 (Green), 0.1-0.25 (Yellow), 0.25-0.5 (Orange), 0.5-1.0 (Red), 1.0+ (Pink)
                legendBar.style.background = "linear-gradient(to right, #10b981 0%, #10b981 25%, #f59e0b 25%, #f59e0b 50%, #f97316 50%, #f97316 75%, #ef4444 75%, #ef4444 90%, #ec4899 90%, #ec4899 100%)";
            } else {
                legendTitle.textContent = "VTEC Intensity (TECU)";
                document.getElementById('legend-tick-0').textContent = "0";
                document.getElementById('legend-tick-1').textContent = "15";
                document.getElementById('legend-tick-2').textContent = "40";
                document.getElementById('legend-tick-3').textContent = "70";
                document.getElementById('legend-tick-4').textContent = "100+";
                
                // VTEC gradient blocks aligned to boundaries: 0-15 (Green), 15-40 (Yellow), 40-70 (Red), 70-100+ (Pink)
                legendBar.style.background = "linear-gradient(to right, #10b981 0%, #10b981 25%, #f59e0b 25%, #f59e0b 50%, #ef4444 50%, #ef4444 75%, #ec4899 75%, #ec4899 100%)";
            }
            
            updateIPPMapVisualization();
        };
    }

    // Toggle IPP Layer visibility
    if (ippLayerToggle) {
        ippLayerToggle.onchange = async (e) => {
            state.ippLayerEnabled = e.target.checked;
            if (state.ippLayerEnabled) {
                ippControlsGroup.style.display = 'block';
                if (!state.ippData) {
                    showMapLoading(true);
                    await loadIPPDataset();
                    showMapLoading(false);
                } else {
                    timelineContainer.style.display = 'block';
                    updateIPPMapVisualization();
                }
            } else {
                ippControlsGroup.style.display = 'none';
                timelineContainer.style.display = 'none';
                if (isPlaying) {
                    togglePlayback();
                }
                updateIPPMapVisualization();
            }
        };
    }

    // Toggle connection lines
    if (ippLinesToggle) {
        ippLinesToggle.onchange = (e) => {
            state.ippShowLines = e.target.checked;
            updateIPPMapVisualization();
        };
    }

    // Constellation Filter Select
    if (ippConstellationSelect) {
        ippConstellationSelect.onchange = (e) => {
            state.ippConstellation = e.target.value;
            updateIPPMapVisualization();
        };
    }

    // Timeline Slider Change
    if (timelineSlider) {
        timelineSlider.oninput = () => {
            updateIPPMapVisualization();
        };
    }

    // Timeline Play/Pause Button
    if (playBtn) {
        playBtn.onclick = () => {
            togglePlayback();
        };
    }
}

/**
 * Toggles the loading overlay in the station detail sidebar
 */
function showSidebarLoading(show) {
    const overlay = document.getElementById('sidebar-loading-overlay');
    if (show) {
        overlay.classList.add('active');
    } else {
        overlay.classList.remove('active');
    }
}

/**
 * Updates the DGNSS toggle state based on availability in active day configuration
 */
function updatePosModeToggleState() {
    const config = DATASET_CONFIG[state.activeDay];
    const dgnssBtn = document.getElementById('dgnss-toggle-btn');
    if (config && config.hasDgnss) {
        dgnssBtn.disabled = false;
        dgnssBtn.title = "Differential positioning solution (DGNSS)";
    } else {
        dgnssBtn.disabled = true;
        dgnssBtn.title = "DGNSS data not available for this day";
        // If mode was DGNSS, switch to SPP
        if (state.posMode === 'dgnss') {
            state.posMode = 'spp';
            document.querySelectorAll('[data-pos-mode]').forEach(btn => {
                if (btn.dataset.posMode === 'spp') btn.classList.add('active');
                else btn.classList.remove('active');
            });
        }
    }
}

/* ==========================================================================
   4. Station Selection & Sidebar Display
   ========================================================================== */
window.handleStationSelect = async function(stationName) {
    const formattedName = stationName.toUpperCase();
    
    // Focus marker on the map and open its popup
    focusOnStation(formattedName);

    state.activeStation = formattedName;

    // Set Sidebar title and open it instantly
    document.getElementById('sidebar-station-name').textContent = formattedName;
    document.getElementById('sidebar').classList.add('open');

    // Populate Sidebar UI instantly using preloaded VTEC/ROTI data
    const preloadedData = state.loadedData[formattedName] || [];
    populateSidebarUI(formattedName, preloadedData);
    updateStationCharts(formattedName, preloadedData);

    // If positioning errors (.pos file) are not loaded yet for the active mode, fetch them on-demand
    if (state.loadedPOS[formattedName] !== state.posMode) {
        showSidebarLoading(true);
        try {
            await loadStationPOSOnDemand(formattedName);
            showSidebarLoading(false);
            
            // Re-populate and re-render now that the positioning errors are loaded
            const mergedData = state.loadedData[formattedName] || [];
            populateSidebarUI(formattedName, mergedData);
            updateStationCharts(formattedName, mergedData);
        } catch (err) {
            showSidebarLoading(false);
            console.error(`Failed to load positioning errors for station ${formattedName}:`, err);
        }
    }
};

/**
 * Populates sidebar geodetic coordinates and calculated scientific metrics
 */
function populateSidebarUI(stationName, stationData) {
    // Set Presets coordinates
    const lookup = STATIONS_COORDINATES_LOOKUP[stationName];
    if (lookup) {
        document.getElementById('sidebar-lat').textContent = `${lookup.lat.toFixed(4)}° N`;
        document.getElementById('sidebar-lon').textContent = `${lookup.lon.toFixed(4)}° E`;
    } else if (stationData && stationData.length > 0) {
        // Fallback to coordinates found in first data row
        const fallbackLat = stationData[0].latitude;
        const fallbackLon = stationData[0].longitude;
        document.getElementById('sidebar-lat').textContent = fallbackLat ? `${fallbackLat.toFixed(4)}°` : 'N/A';
        document.getElementById('sidebar-lon').textContent = fallbackLon ? `${fallbackLon.toFixed(4)}°` : 'N/A';
    } else {
        document.getElementById('sidebar-lat').textContent = 'N/A';
        document.getElementById('sidebar-lon').textContent = 'N/A';
    }

    // Calculate metrics: Vertical error mean, Max S4 (ROTI), Mean VTEC
    let sumVertError = 0;
    let maxS4 = 0;
    let sumVTEC = 0;
    let validVertCount = 0;
    let validVtecCount = 0;

    stationData.forEach(d => {
        // Check if positioning errors are loaded (are not 0)
        if (d.error_up !== 0) {
            sumVertError += Math.abs(d.error_up);
            validVertCount++;
        }
        if (d.s4_index !== undefined) {
            if (d.s4_index > maxS4) maxS4 = d.s4_index;
        }
        if (d.vtec !== undefined) {
            sumVTEC += d.vtec;
            validVtecCount++;
        }
    });

    const avgVertError = validVertCount > 0 ? (sumVertError / validVertCount).toFixed(3) : '-';
    const avgVtec = validVtecCount > 0 ? (sumVTEC / validVtecCount).toFixed(1) : '-';

    document.getElementById('metric-avg-vert-error').textContent = avgVertError;
    document.getElementById('metric-max-roti').textContent = maxS4.toFixed(3);
    document.getElementById('metric-avg-vtec').textContent = avgVtec;
}

function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    state.activeStation = null;
}

/* ==========================================================================
   5. CSV Parsing & Column Mapping Flow
   ========================================================================== */
function handleFileSelect(file) {
    if (!file) return;

    state.tempFileName = file.name;

    const reader = new FileReader();
    reader.onload = function(e) {
        const csvText = e.target.result;
        state.tempCSVText = csvText;

        // Show loading indicator inside dropzone or simple text
        const dropzone = document.getElementById('dropzone');
        dropzone.innerHTML = `<i data-lucide="loader-2" class="dropzone-icon logo-spin"></i><p class="primary-text">Parsing CSV file...</p>`;
        lucide.createIcons();

        Papa.parse(csvText, {
            header: true,
            skipEmptyLines: true,
            complete: function (results) {
                if (results.errors.length > 0 && results.data.length === 0) {
                    alert("Error parsing CSV: " + results.errors[0].message);
                    resetDropzone();
                    return;
                }
                
                state.tempHeaders = results.meta.fields || [];
                state.tempParsedRows = results.data;

                if (state.tempHeaders.length === 0 || state.tempParsedRows.length === 0) {
                    alert("No data or headers found in CSV file.");
                    resetDropzone();
                    return;
                }

                displayColumnMapperWizard();
            },
            error: function(err) {
                alert("File parse error: " + err.message);
                resetDropzone();
            }
        });
    };
    reader.readAsText(file);
}

function resetDropzone() {
    const dropzone = document.getElementById('dropzone');
    dropzone.style.display = 'block';
    dropzone.innerHTML = `
        <i data-lucide="upload-cloud" class="dropzone-icon"></i>
        <p class="primary-text">Drag and drop your CSV file here</p>
        <p class="secondary-text">or click to browse local files</p>
    `;
    lucide.createIcons();
}

/**
 * Reveals mapping configuration panels and populates dropdown selections
 */
function displayColumnMapperWizard() {
    // 1. Hide upload dropzone, show wizard
    document.getElementById('dropzone').style.display = 'none';
    const wizard = document.getElementById('mapping-wizard');
    wizard.style.display = 'block';

    // Check if it's a satellite columns file (e.g. headers look like G01, C06, etc.)
    const satCols = state.tempHeaders.filter(h => /^[GCRES]\d{2}$/i.test(h));
    const isSatelliteCSV = satCols.length > 0;

    // Show/hide optional standard mapping forms
    const optionalRows = ['mapping-row-station', 'mapping-row-coords', 'mapping-row-errors', 'mapping-row-ionosphere'];
    optionalRows.forEach(id => {
        document.getElementById(id).style.display = isSatelliteCSV ? 'none' : 'block';
    });

    const banner = document.getElementById('mapping-info-banner');
    const defaultStationBox = document.getElementById('default-station-container');
    const defaultStationInput = document.getElementById('default-station-name');

    if (isSatelliteCSV) {
        // Attempt to parse station and DOY from filename
        let detectedStation = 'CADT';
        let detectedDoy = '121';
        let dataType = 'VTEC';

        const cleanFilename = state.tempFileName.split(/[\\/]/).pop(); // Get basename
        const filenameMatch = cleanFilename.match(/^(ROTI|VTEC)_([A-Za-z0-9]+)_(\s?\d+|\d{3})\.csv$/i);

        if (filenameMatch) {
            dataType = filenameMatch[1].toUpperCase();
            detectedStation = filenameMatch[2].toUpperCase();
            if (detectedStation === 'KMI6') detectedStation = 'KMIT6'; // Map KMI6 -> KMIT6
            detectedDoy = filenameMatch[3].trim();
        } else {
            // Fuzzy search station in filename
            const foundPreset = PRESET_STATIONS.find(s => cleanFilename.toUpperCase().includes(s.name.toUpperCase()));
            if (foundPreset) detectedStation = foundPreset.name;

            if (cleanFilename.toUpperCase().includes('ROTI')) dataType = 'ROTI';
            else if (cleanFilename.toUpperCase().includes('VTEC')) dataType = 'VTEC';

            const doyMatch = cleanFilename.match(/_(\d{3})\b|\b(\d{3})\b/);
            detectedDoy = doyMatch ? doyMatch[1] || doyMatch[2] : '121';
        }

        // Show banner and update labels
        banner.style.display = 'flex';
        const bannerText = document.getElementById('mapping-info-text');
        bannerText.textContent = `Satellite-by-satellite GNSS dataset detected (${dataType}). The application will automatically average all visible satellite columns (${satCols.length} columns) and load the values for station ${detectedStation} (Day of Year ${detectedDoy}).`;

        // Prepopulate default station name
        defaultStationBox.style.display = 'block';
        defaultStationInput.value = detectedStation;
    } else {
        banner.style.display = 'none';
        defaultStationBox.style.display = 'none';
    }

    // 2. Select boxes populating
    const dropdownIds = [
        'map-station', 'map-time', 'map-lat', 'map-lon', 
        'map-err-east', 'map-err-north', 'map-err-up', 'map-s4', 'map-vtec'
    ];

    dropdownIds.forEach(id => {
        const select = document.getElementById(id);
        select.innerHTML = '<option value="">-- Ignore / Select Column --</option>';
        
        state.tempHeaders.forEach(header => {
            select.innerHTML += `<option value="${header}">${header}</option>`;
        });
    });

    // 3. Attempt Auto-Detection using regex rules
    dropdownIds.forEach(id => {
        const select = document.getElementById(id);
        const ruleName = id.replace('map-', '');
        
        // Find matching key from regexes
        let matchedRuleKey = '';
        if (ruleName === 'station') matchedRuleKey = 'station';
        else if (ruleName === 'time') matchedRuleKey = 'time';
        else if (ruleName === 'lat') matchedRuleKey = 'lat';
        else if (ruleName === 'lon') matchedRuleKey = 'lon';
        else if (ruleName === 'err-east') matchedRuleKey = 'errEast';
        else if (ruleName === 'err-north') matchedRuleKey = 'errNorth';
        else if (ruleName === 'err-up') matchedRuleKey = 'errUp';
        else if (ruleName === 's4') matchedRuleKey = 's4';
        else if (ruleName === 'vtec') matchedRuleKey = 'vtec';

        if (matchedRuleKey && AUTO_DETECT_RULES[matchedRuleKey]) {
            const regex = AUTO_DETECT_RULES[matchedRuleKey];
            const matchingHeader = state.tempHeaders.find(h => regex.test(h));
            if (matchingHeader) {
                select.value = matchingHeader;
            }
        }
    });

    // If station column is missing (and not a satellite CSV which uses defaultStationBox directly), show default station input box
    if (!isSatelliteCSV) {
        const stationSelect = document.getElementById('map-station');
        const toggleDefaultStation = () => {
            if (stationSelect.value === "") {
                defaultStationBox.style.display = 'block';
            } else {
                defaultStationBox.style.display = 'none';
            }
        };
        stationSelect.onchange = toggleDefaultStation;
        toggleDefaultStation();
    }

    // 4. Render preview table of the first 3 rows
    const thead = document.querySelector('#preview-table thead');
    const tbody = document.querySelector('#preview-table tbody');
    thead.innerHTML = '';
    tbody.innerHTML = '';

    // Headers
    let headerHtml = '<tr>';
    state.tempHeaders.forEach(h => headerHtml += `<th>${h}</th>`);
    headerHtml += '</tr>';
    thead.innerHTML = headerHtml;

    // Rows
    const previewRows = state.tempParsedRows.slice(0, 3);
    previewRows.forEach(row => {
        let rowHtml = '<tr>';
        state.tempHeaders.forEach(h => {
            rowHtml += `<td>${row[h] || '-'}</td>`;
        });
        rowHtml += '</tr>';
        tbody.innerHTML += rowHtml;
    });
}

/**
 * Parses raw CSV rows based on selected mappings and updates DB/state
 */
/**
 * Parses raw CSV rows based on selected mappings and updates DB/state
 */
async function processAndLoadCSVData() {
    const getMapping = (id) => document.getElementById(id).value;
    
    const colStation = getMapping('map-station');
    const colTime = getMapping('map-time');
    const colLat = getMapping('map-lat');
    const colLon = getMapping('map-lon');
    const colErrEast = getMapping('map-err-east');
    const colErrNorth = getMapping('map-err-north');
    const colErrUp = getMapping('map-err-up');
    const colS4 = getMapping('map-s4');
    const colVtec = getMapping('map-vtec');

    const defaultStationVal = document.getElementById('default-station-name').value.trim().toUpperCase();

    // Verification: Time is required
    if (!colTime) {
        alert("A Timestamp/Time column mapping is required.");
        return;
    }

    // Set loading button
    const confirmBtn = document.getElementById('confirm-mapping');
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = `<i data-lucide="loader-2" class="logo-spin"></i> Loading...`;
    lucide.createIcons();

    try {
        const mappings = {
            time: colTime,
            station: colStation,
            lat: colLat,
            lon: colLon,
            errEast: colErrEast,
            errNorth: colErrNorth,
            errUp: colErrUp,
            s4: colS4,
            vtec: colVtec,
            defaultStation: defaultStationVal
        };

        // Clear first if this is the first custom dataset to replace simulated data!
        const isMockActive = localStorage.getItem('loaded_custom_csv') !== 'true';
        if (isMockActive) {
            await clearAllDBData();
            state.loadedData = {};
            localStorage.setItem('loaded_custom_csv', 'true');
        }

        // Call the common helper
        await parseAndStoreCSVText(state.tempFileName, state.tempCSVText, mappings);

        // Refresh application state
        updateDashboardStats();
        updateMapMarkers(Object.keys(state.loadedData));

        // Reset UI view
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = `<i data-lucide="check"></i> Load Dataset`;
        document.getElementById('import-modal').classList.remove('open');
        
        alert(`Successfully loaded/merged dataset.`);
    } catch (err) {
        alert("Failed to load CSV: " + err.message);
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = `<i data-lucide="check"></i> Load Dataset`;
    }
}

/**
 * Core CSV parsing and IndexedDB merging logic
 * @param {string} fileName - Name of the file being processed
 * @param {string} csvText - Raw CSV file contents
 * @param {object} customMappings - Optional custom mapping configuration from UI wizard
 */
async function parseAndStoreCSVText(fileName, csvText, customMappings = null) {
    const results = Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true
    });

    if (results.errors.length > 0 && results.data.length === 0) {
        throw new Error("CSV parse error: " + results.errors[0].message);
    }

    const headers = results.meta.fields || [];
    const rows = results.data;

    // Detect if it is a satellite-by-satellite columns file
    const satCols = headers.filter(h => /^[GCRES]\d{2}$/i.test(h));
    const isSatelliteCSV = satCols.length > 0;

    // Determine mapping columns
    let colTime = '';
    let colStation = '';
    let colLat = '';
    let colLon = '';
    let colErrEast = '';
    let colErrNorth = '';
    let colErrUp = '';
    let colS4 = '';
    let colVtec = '';
    let defaultStationVal = 'CADT';

    if (customMappings) {
        colTime = customMappings.time;
        colStation = customMappings.station;
        colLat = customMappings.lat;
        colLon = customMappings.lon;
        colErrEast = customMappings.errEast;
        colErrNorth = customMappings.errNorth;
        colErrUp = customMappings.errUp;
        colS4 = customMappings.s4;
        colVtec = customMappings.vtec;
        defaultStationVal = customMappings.defaultStation || '';
    } else {
        // Auto-detect columns
        colTime = headers.find(h => AUTO_DETECT_RULES.time.test(h)) || headers[0];
        colStation = headers.find(h => AUTO_DETECT_RULES.station.test(h));
        colLat = headers.find(h => AUTO_DETECT_RULES.lat.test(h));
        colLon = headers.find(h => AUTO_DETECT_RULES.lon.test(h));
        colErrEast = headers.find(h => AUTO_DETECT_RULES.errEast.test(h));
        colErrNorth = headers.find(h => AUTO_DETECT_RULES.errNorth.test(h));
        colErrUp = headers.find(h => AUTO_DETECT_RULES.errUp.test(h));
        colS4 = headers.find(h => AUTO_DETECT_RULES.s4.test(h));
        colVtec = headers.find(h => AUTO_DETECT_RULES.vtec.test(h));
    }

    const groupedData = {};

    if (isSatelliteCSV) {
        // ----------------------------------------------------
        // SATELLITE COLUMN AVERAGING FLOW
        // ----------------------------------------------------
        let detectedStation = defaultStationVal || 'CADT';
        let detectedDoy = 121;
        let isVtec = true;

        const cleanFilename = fileName.split(/[\\/]/).pop();
        const filenameMatch = cleanFilename.match(/^(ROTI|VTEC)_([A-Za-z0-9]+)_(\s?\d+|\d{3})\.csv$/i);

        if (filenameMatch) {
            isVtec = filenameMatch[1].toUpperCase() === 'VTEC';
            detectedStation = filenameMatch[2].toUpperCase();
            if (detectedStation === 'KMI6') detectedStation = 'KMIT6'; // Map KMI6 -> KMIT6
            detectedDoy = parseInt(filenameMatch[3].trim());
        } else {
            if (cleanFilename.toUpperCase().includes('ROTI')) isVtec = false;
            const doyMatch = cleanFilename.match(/_(\d{3})\b|\b(\d{3})\b/);
            if (doyMatch) detectedDoy = parseInt(doyMatch[1] || doyMatch[2]);
        }

        const stationName = detectedStation;
        if (!groupedData[stationName]) {
            groupedData[stationName] = [];
        }

        // Coordinates lookup
        let latVal = 0.0;
        let lonVal = 0.0;
        const lookup = STATIONS_COORDINATES_LOOKUP[stationName];
        if (lookup) {
            latVal = lookup.lat;
            lonVal = lookup.lon;
        }

        rows.forEach(row => {
            const epochSecs = parseInt(row[colTime]);
            if (isNaN(epochSecs)) return; // Skip invalid rows

            // Convert epoch seconds to date string (using DOY & active year)
            const activeYear = DATASET_CONFIG[state.activeDay] ? DATASET_CONFIG[state.activeDay].year : 2026;
            const date = new Date(activeYear, 0, 1);
            date.setDate(detectedDoy);
            date.setSeconds(epochSecs - 1); // Align epoch 1 to 00:00:00

            const timestampString = formatDate(date);

            // Average satellite columns
            let sum = 0;
            let count = 0;
            satCols.forEach(col => {
                const val = parseFloat(row[col]);
                if (!isNaN(val)) {
                    sum += val;
                    count++;
                }
            });
            const avgVal = count > 0 ? parseFloat((sum / count).toFixed(4)) : 0;

            const epochPoint = {
                timestamp: timestampString,
                station: stationName,
                latitude: latVal,
                longitude: lonVal,
                error_east: 0,
                error_north: 0,
                error_up: 0,
                s4_index: !isVtec ? avgVal : 0,  // Save ROTI as scintillation index proxy
                vtec: isVtec ? avgVal : 0
            };

            groupedData[stationName].push(epochPoint);
        });

    } else {
        // ----------------------------------------------------
        // STANDARD ROW-MAPPED CSV FLOW
        // ----------------------------------------------------
        rows.forEach(row => {
            const stationName = (colStation ? (row[colStation] || '').trim() : defaultStationVal).toUpperCase();
            if (!stationName) return; // Skip rows missing station names

            if (!groupedData[stationName]) {
                groupedData[stationName] = [];
            }

            // Coordinates lookup
            let latVal = undefined;
            let lonVal = undefined;

            if (colLat && row[colLat] !== undefined) latVal = parseFloat(row[colLat]);
            if (colLon && row[colLon] !== undefined) lonVal = parseFloat(row[colLon]);

            // Fallback to presets if coordinates are missing/invalid
            if (latVal === undefined || isNaN(latVal) || lonVal === undefined || isNaN(lonVal)) {
                const lookup = STATIONS_COORDINATES_LOOKUP[stationName];
                if (lookup) {
                    latVal = lookup.lat;
                    lonVal = lookup.lon;
                } else {
                    latVal = 0.0;
                    lonVal = 0.0;
                }
            }

            // Format data point object
            const epochPoint = {
                timestamp: row[colTime],
                station: stationName,
                latitude: latVal,
                longitude: lonVal,
                error_east: colErrEast ? parseFloat(row[colErrEast]) || 0 : 0,
                error_north: colErrNorth ? parseFloat(row[colErrNorth]) || 0 : 0,
                error_up: colErrUp ? parseFloat(row[colErrUp]) || 0 : 0,
                s4_index: colS4 ? parseFloat(row[colS4]) || 0 : 0,
                vtec: colVtec ? parseFloat(row[colVtec]) || 0 : 0
            };

            // Validate types
            if (isNaN(epochPoint.error_east)) epochPoint.error_east = 0;
            if (isNaN(epochPoint.error_north)) epochPoint.error_north = 0;
            if (isNaN(epochPoint.error_up)) epochPoint.error_up = 0;
            if (isNaN(epochPoint.s4_index)) epochPoint.s4_index = 0;
            if (isNaN(epochPoint.vtec)) epochPoint.vtec = 0;

            groupedData[stationName].push(epochPoint);
        });
    }

    // Retrieve database mapping
    const existingDBData = await getAllStationsFromDB();

    // Save each station data, merging with existing station points if present
    for (const stationName in groupedData) {
        const uppercaseStation = stationName.toUpperCase();
        let finalDataPoints = [];

        if (existingDBData[uppercaseStation]) {
            // Merge newly parsed points with existing DB points
            const existingPoints = existingDBData[uppercaseStation];
            const newPoints = groupedData[stationName];

            // Build a fast lookup map of existing points by timestamp
            const pointsMap = {};
            existingPoints.forEach(p => {
                pointsMap[p.timestamp] = p;
            });

            newPoints.forEach(newP => {
                if (pointsMap[newP.timestamp]) {
                    // Merge fields! Keep non-zero values from whichever point has them
                    const extP = pointsMap[newP.timestamp];
                    
                    // Merge coordinates
                    if (newP.latitude !== 0) extP.latitude = newP.latitude;
                    if (newP.longitude !== 0) extP.longitude = newP.longitude;
                    
                    // Merge errors
                    if (newP.error_east !== 0) extP.error_east = newP.error_east;
                    if (newP.error_north !== 0) extP.error_north = newP.error_north;
                    if (newP.error_up !== 0) extP.error_up = newP.error_up;
                    
                    // Merge ionospheric parameters depending on upload type
                    if (isSatelliteCSV) {
                        const isVtec = fileName.toUpperCase().includes('VTEC');
                        if (isVtec) {
                            extP.vtec = newP.vtec;
                        } else {
                            extP.s4_index = newP.s4_index; // ROTI
                        }
                    } else {
                        if (newP.vtec !== 0) extP.vtec = newP.vtec;
                        if (newP.s4_index !== 0) extP.s4_index = newP.s4_index;
                    }
                } else {
                    // Not in database, add it
                    pointsMap[newP.timestamp] = newP;
                }
            });

            finalDataPoints = Object.values(pointsMap);
        } else {
            // Station doesn't exist yet, save as-is
            finalDataPoints = groupedData[stationName];
        }

        // Save back to IndexedDB
        await saveStationToDB(uppercaseStation, finalDataPoints);
        state.loadedData[uppercaseStation] = finalDataPoints;
    }
}

/**
 * Formats a Date object as YYYY-MM-DD HH:MM:SS string
 */
function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${y}-${m}-${d} ${h}:${min}:${s}`;
}

/* ==========================================================================


/**
 * Parses RTKLIB .pos files (SPP solutions), averages coordinates, downsamples to 5-min intervals,
 * and converts geodetic coordinate differences to local East, North, Up (ENU) errors.
 * Merges errors with existing IndexedDB datasets under the same station.
 */
async function parseAndStorePOSText(fileName, posText) {
    const lines = posText.split('\n');
    const validRows = [];
    
    // Parse filename to get station name
    let stationName = 'CADT';
    const cleanFilename = fileName.split(/[\\/]/).pop().toUpperCase();
    
    // Check for KMI6 alias to KMIT6
    if (cleanFilename.startsWith('KMI6')) {
        stationName = 'KMIT6';
    } else {
        // Look up in preset stations list (PRESET_STATIONS is defined in sample-data.js)
        const foundPreset = PRESET_STATIONS.find(s => cleanFilename.startsWith(s.name.toUpperCase()));
        if (foundPreset) {
            stationName = foundPreset.name;
        } else {
            const stationMatch = cleanFilename.match(/^([A-Za-z0-9]+)\d+/);
            if (stationMatch) {
                stationName = stationMatch[1].toUpperCase();
            }
        }
    }

    let latSum = 0;
    let lonSum = 0;
    let heightSum = 0;
    let count = 0;

    // Parse all valid rows first to calculate the mean reference position
    lines.forEach(line => {
        const trimmed = line.trim();
        if (trimmed.startsWith('%') || trimmed === '') return; // Skip comments and empty lines

        const parts = trimmed.split(/\s+/);
        if (parts.length < 5) return; // Skip malformed lines

        // Validate date/time format
        const dateStr = parts[0]; // e.g. 2026/05/01
        const timeStr = parts[1]; // e.g. 00:00:00.000
        const lat = parseFloat(parts[2]);
        const lon = parseFloat(parts[3]);
        const height = parseFloat(parts[4]);

        if (isNaN(lat) || isNaN(lon) || isNaN(height)) return;

        validRows.push({ dateStr, timeStr, lat, lon, height });
        latSum += lat;
        lonSum += lon;
        heightSum += height;
        count++;
    });

    if (count === 0) return;

    // Calculate mean reference position (stable coordinates base)
    const latRef = latSum / count;
    const lonRef = lonSum / count;
    const heightRef = heightSum / count;

    console.log(`Station ${stationName} parsed: Reference Position Lat=${latRef.toFixed(7)}, Lon=${lonRef.toFixed(7)}, Height=${heightRef.toFixed(4)}`);

    // Select epochs at 5-minute intervals and calculate ENU errors
    const selectedPoints = [];

    // Constants for WGS-84 ellipsoid
    const a = 6378137.0; // semi-major axis (m)
    const b = 6356752.3142; // semi-minor axis (m)
    const eSq = 1 - (b * b) / (a * a); // eccentricity squared

    const latRefRad = latRef * Math.PI / 180;
    const sinLat = Math.sin(latRefRad);
    const cosLat = Math.cos(latRefRad);
    const N = a / Math.sqrt(1 - eSq * sinLat * sinLat);
    const M = a * (1 - eSq) / Math.pow(1 - eSq * sinLat * sinLat, 1.5);

    validRows.forEach(row => {
        // Parse time string: HH:MM:SS.SSS
        const timeParts = row.timeStr.split(':');
        if (timeParts.length < 3) return;

        const min = parseInt(timeParts[1]);
        const sec = parseFloat(timeParts[2]);

        // Keep 5-minute epochs (seconds = 0, minutes divisible by 5)
        if (min % 5 === 0 && sec === 0) {
            const dLat = row.lat - latRef;
            const dLon = row.lon - lonRef;
            const dH = row.height - heightRef;

            // Convert geodetic LLA differences to local ENU errors (in meters)
            const dE = dLon * (Math.PI / 180) * (N + dH) * cosLat;
            const dN = dLat * (Math.PI / 180) * M;
            const dU = dH;

            // Date reformatting from YYYY/MM/DD to YYYY-MM-DD
            const formattedDate = row.dateStr.replace(/\//g, '-');
            const timestampString = `${formattedDate} ${row.timeStr.split('.')[0]}`; // Strip milliseconds

            selectedPoints.push({
                timestamp: timestampString,
                station: stationName,
                latitude: row.lat,
                longitude: row.lon,
                error_east: parseFloat(dE.toFixed(4)),
                error_north: parseFloat(dN.toFixed(4)),
                error_up: parseFloat(dU.toFixed(4))
            });
        }
    });

    // Save/Merge to IndexedDB
    const existingDBData = await getAllStationsFromDB();
    const uppercaseStation = stationName.toUpperCase();
    let finalDataPoints = [];

    if (existingDBData[uppercaseStation]) {
        const existingPoints = existingDBData[uppercaseStation];

        // Build a fast lookup map of existing points by timestamp
        const pointsMap = {};
        existingPoints.forEach(p => {
            pointsMap[p.timestamp] = p;
        });

        selectedPoints.forEach(newP => {
            if (pointsMap[newP.timestamp]) {
                const extP = pointsMap[newP.timestamp];
                // Merge errors
                extP.error_east = newP.error_east;
                extP.error_north = newP.error_north;
                extP.error_up = newP.error_up;
                
                // Keep the exact lat/lon from the SPP pos file
                extP.latitude = newP.latitude;
                extP.longitude = newP.longitude;
            } else {
                // Not in DB, initialize empty ROTI/VTEC and add
                newP.vtec = 0;
                newP.s4_index = 0;
                pointsMap[newP.timestamp] = newP;
            }
        });

        finalDataPoints = Object.values(pointsMap);
    } else {
        // Station doesn't exist yet, save as-is (with 0 VTEC/ROTI)
        selectedPoints.forEach(p => {
            p.vtec = 0;
            p.s4_index = 0;
        });
        finalDataPoints = selectedPoints;
    }

    // Save back to IndexedDB
    await saveStationToDB(uppercaseStation, finalDataPoints);
    state.loadedData[uppercaseStation] = finalDataPoints;
}

/**
 * Toggles the application theme between light and dark modes.
 */
function toggleTheme() {
    const newTheme = state.theme === 'dark' ? 'light' : 'dark';
    state.theme = newTheme;
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    
    // Update theme toggle button icon
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    if (themeToggleBtn) {
        const icon = themeToggleBtn.querySelector('i');
        if (icon) {
            icon.setAttribute('data-lucide', newTheme === 'dark' ? 'sun' : 'moon');
            lucide.createIcons();
        }
    }
    
    // Update map tile layer
    if (typeof setMapTheme === 'function') {
        setMapTheme(newTheme);
    }
    
    // Update Chart.js themes
    if (typeof setChartTheme === 'function') {
        setChartTheme(newTheme);
    }
}

/* ==========================================================================
   4. IPP Data Loading and Rendering Helpers
   ========================================================================== */
let playbackInterval = null;
let isPlaying = false;

/**
 * Loads the active day's IPP JSON dataset.
 */
async function loadIPPDataset() {
    state.ippData = null;
    document.getElementById('timeline-container').style.display = 'none';

    if (!state.ippLayerEnabled) return;

    console.log(`Loading IPP JSON data for Day ${state.activeDay}...`);
    try {
        const response = await fetch(`data/ipp_doy_${state.activeDay}.json`);
        if (!response.ok) {
            console.warn(`IPP data not found for day ${state.activeDay}`);
            return;
        }
        state.ippData = await response.json();
        console.log(`Successfully loaded IPP data with ${Object.keys(state.ippData).length} epochs.`);
        
        // Show timeline controls
        document.getElementById('timeline-container').style.display = 'block';
        
        // Trigger initial draw
        updateIPPMapVisualization();
    } catch (err) {
        console.error("Error loading IPP JSON data:", err);
    }
}

/**
 * Triggers rendering of the active epoch's IPP markers.
 */
function updateIPPMapVisualization() {
    if (!state.ippLayerEnabled || !state.ippData) {
        if (typeof renderIPPData === 'function') {
            renderIPPData([]); // Clear
        }
        return;
    }

    const slider = document.getElementById('timeline-slider');
    const epochVal = parseInt(slider.value);
    
    // Map 1-288 epoch index to the actual second timestamp key ("1", "301", "601", etc.)
    const timestampKey = ((epochVal - 1) * 300 + 1).toString();
    const epochPoints = state.ippData[timestampKey] || [];
    
    // Render on map
    if (typeof renderIPPData === 'function') {
        renderIPPData(epochPoints, state.ippConstellation, state.ippShowLines, state.ippMetric);
    }
    
    // Update digital display
    const seconds = (epochVal - 1) * 300 + 1;
    const hour = Math.floor(seconds / 3600);
    const minute = Math.floor((seconds % 3600) / 60);
    const formattedTime = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    document.getElementById('timeline-time-val').textContent = formattedTime;
}

/**
 * Toggles timeline play/pause playback animation loop.
 */
function togglePlayback() {
    const playBtn = document.getElementById('timeline-play-btn');
    const slider = document.getElementById('timeline-slider');
    
    if (isPlaying) {
        // Pause
        clearInterval(playbackInterval);
        isPlaying = false;
        playBtn.innerHTML = '<i data-lucide="play"></i>';
        lucide.createIcons();
    } else {
        // Play
        isPlaying = true;
        playBtn.innerHTML = '<i data-lucide="pause"></i>';
        lucide.createIcons();
        
        playbackInterval = setInterval(() => {
            let currentVal = parseInt(slider.value);
            if (currentVal >= 288) {
                currentVal = 1; // Wrap around
            } else {
                currentVal += 1;
            }
            slider.value = currentVal;
            updateIPPMapVisualization();
        }, 400); // 400ms tick rate
    }
}


