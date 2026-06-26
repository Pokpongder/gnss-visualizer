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
    comparison: {
        stationA: null,
        stationB: null,
        metric: 'vtec'
    }
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

/**
 * Loads dataset from IndexedDB. If empty, imports mock datasets.
 */
// Preloaded GNSS observation CSV and POS files (placed in the /data/ directory)
const PRELOADED_FILES = [
    "data/VTEC_CADT_121.csv",
    "data/ROTI_CADT_121.csv",
    "data/CADT1210_spp.pos"
];

/**
 * Loads preloaded datasets from the data/ folder.
 */
async function loadDatasets() {
    console.log("Initializing preloaded datasets...");
    
    // Always clear IndexedDB and start fresh to load from the /data/ folder
    await clearAllDBData();
    state.loadedData = {};

    for (const url of PRELOADED_FILES) {
        try {
            console.log(`Preloading GNSS file: ${url}`);
            const response = await fetch(url);
            if (!response.ok) {
                console.warn(`Could not preload ${url}: HTTP status ${response.status}`);
                continue;
            }
            const fileText = await response.text();
            const fileName = url.split('/').pop();
            
            // Branch based on file extension
            if (fileName.toLowerCase().endsWith('.pos')) {
                await parseAndStorePOSText(fileName, fileText);
            } else {
                await parseAndStoreCSVText(fileName, fileText);
            }
        } catch (err) {
            console.error(`Error loading preloaded dataset ${url}:`, err);
        }
    }

    // Refresh GUI states
    updateDashboardStats();
    updateMapMarkers(Object.keys(state.loadedData));
}

/**
 * Recalculate stats shown on map floating card overlays
 */
function updateDashboardStats() {
    const totalStations = PRESET_STATIONS.length;
    const loadedStations = Object.keys(state.loadedData).length;
    
    let totalEpochs = 0;
    for (const station in state.loadedData) {
        totalEpochs += state.loadedData[station].length;
    }

    document.getElementById('stat-total-stations').textContent = totalStations;
    document.getElementById('stat-loaded-stations').textContent = loadedStations;
    document.getElementById('stat-total-epochs').textContent = totalEpochs.toLocaleString();

    // Update status labels
    document.getElementById('dataset-name-display').textContent = "Active: Preloaded Datasets (/data/)";
    
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
    const compareBtn = document.getElementById('compare-btn');
    const downloadSampleBtn = document.getElementById('download-sample-btn');
    
    const importModal = document.getElementById('import-modal');
    const compareModal = document.getElementById('compare-modal');
    
    const closeImportBtn = document.getElementById('close-import-modal');
    const closeCompareBtn = document.getElementById('close-compare-modal');

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

    compareBtn.onclick = () => {
        openComparisonWizard();
        compareModal.classList.add('open');
    };
    closeCompareBtn.onclick = () => compareModal.classList.remove('open');
    
    downloadSampleBtn.onclick = downloadSampleCSV;

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

    // Close Modal overlays clicking outside content
    window.onclick = (event) => {
        if (event.target === importModal) importModal.classList.remove('open');
        if (event.target === compareModal) compareModal.classList.remove('open');
        if (event.target === expandedModal) {
            expandedModal.classList.remove('open');
            if (activeCharts.expanded) {
                activeCharts.expanded.destroy();
                activeCharts.expanded = null;
            }
        }
    };
}

/* ==========================================================================
   4. Station Selection & Sidebar Display
   ========================================================================== */
window.handleStationSelect = function(stationName) {
    const formattedName = stationName.toUpperCase();
    const stationData = state.loadedData[formattedName];
    
    // Open Map Popup / Focus
    focusOnStation(formattedName);

    if (!stationData || stationData.length === 0) {
        alert(`No data loaded for station ${formattedName}. Import a CSV containing data for this station first.`);
        return;
    }

    state.activeStation = formattedName;
    
    // Set Header
    document.getElementById('sidebar-station-name').textContent = formattedName;
    
    // Set Presets coordinates
    const lookup = STATIONS_COORDINATES_LOOKUP[formattedName];
    if (lookup) {
        document.getElementById('sidebar-lat').textContent = `${lookup.lat.toFixed(4)}° N`;
        document.getElementById('sidebar-lon').textContent = `${lookup.lon.toFixed(4)}° E`;
    } else {
        // Fallback to coordinates found in first data row
        const fallbackLat = stationData[0].latitude;
        const fallbackLon = stationData[0].longitude;
        document.getElementById('sidebar-lat').textContent = fallbackLat ? `${fallbackLat.toFixed(4)}°` : 'N/A';
        document.getElementById('sidebar-lon').textContent = fallbackLon ? `${fallbackLon.toFixed(4)}°` : 'N/A';
    }

    // Calculate metrics: Horizontal error mean, Max S4, Mean VTEC
    let sumHorizError = 0;
    let maxS4 = 0;
    let sumVTEC = 0;
    let validHorizCount = 0;
    let validVtecCount = 0;

    stationData.forEach(d => {
        if (d.error_east !== undefined && d.error_north !== undefined) {
            sumHorizError += Math.sqrt(d.error_east ** 2 + d.error_north ** 2);
            validHorizCount++;
        }
        if (d.s4_index !== undefined) {
            if (d.s4_index > maxS4) maxS4 = d.s4_index;
        }
        if (d.vtec !== undefined) {
            sumVTEC += d.vtec;
            validVtecCount++;
        }
    });

    const avgHorizError = validHorizCount > 0 ? (sumHorizError / validHorizCount).toFixed(3) : '-';
    const avgVtec = validVtecCount > 0 ? (sumVTEC / validVtecCount).toFixed(1) : '-';

    document.getElementById('metric-avg-error').textContent = avgHorizError;
    document.getElementById('metric-max-roti').textContent = maxS4.toFixed(3);
    document.getElementById('metric-avg-vtec').textContent = avgVtec;

    // Render Charts
    updateStationCharts(formattedName, stationData);

    // Open Sidebar
    document.getElementById('sidebar').classList.add('open');
};

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
        const filenameMatch = cleanFilename.match(/^(ROTI|VTEC)_([A-Za-z0-9]+)_(\d{3})\.csv$/i);

        if (filenameMatch) {
            dataType = filenameMatch[1].toUpperCase();
            detectedStation = filenameMatch[2].toUpperCase();
            detectedDoy = filenameMatch[3];
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
        const filenameMatch = cleanFilename.match(/^(ROTI|VTEC)_([A-Za-z0-9]+)_(\d{3})\.csv$/i);

        if (filenameMatch) {
            isVtec = filenameMatch[1].toUpperCase() === 'VTEC';
            detectedStation = filenameMatch[2].toUpperCase();
            detectedDoy = parseInt(filenameMatch[3]);
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

            // Convert epoch seconds to date string (using DOY & year 2026)
            const date = new Date(2026, 0, 1);
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
   6. Station Comparison Wizard
   ========================================================================== */
function openComparisonWizard() {
    // Reset comparison states
    state.comparison.stationA = null;
    state.comparison.stationB = null;
    
    document.getElementById('start-comparison-btn').disabled = true;
    document.getElementById('comparison-chart-section').style.display = 'none';

    // Populate Lists of Stations
    const stationsList = Object.keys(state.loadedData);

    const renderList = (elementId, searchVal = '', selectedStation = null) => {
        const ul = document.getElementById(elementId);
        ul.innerHTML = '';

        const filtered = stationsList.filter(s => s.toLowerCase().includes(searchVal.toLowerCase()));

        if (filtered.length === 0) {
            ul.innerHTML = `<li class="station-item" style="color:var(--text-dim); text-align:center; cursor:default;">No active stations</li>`;
            return;
        }

        filtered.forEach(station => {
            const presetInfo = STATIONS_COORDINATES_LOOKUP[station] || { code: 'Custom' };
            const isSelected = selectedStation === station;
            
            const li = document.createElement('li');
            li.className = `station-item ${isSelected ? 'selected' : ''}`;
            li.innerHTML = `
                <span class="station-code">${station}</span>
                <span class="station-group">${presetInfo.code}</span>
            `;
            
            li.onclick = () => {
                if (elementId === 'station-a-list') {
                    state.comparison.stationA = station;
                    renderList('station-a-list', searchVal, station);
                    // Re-render B list to prevent comparing station with itself
                    renderList('station-b-list', document.getElementById('station-b-search').value, state.comparison.stationB);
                } else {
                    state.comparison.stationB = station;
                    renderList('station-b-list', searchVal, station);
                    // Re-render A list
                    renderList('station-a-list', document.getElementById('station-a-search').value, state.comparison.stationA);
                }

                // Check button validation
                const compareBtn = document.getElementById('start-comparison-btn');
                if (state.comparison.stationA && state.comparison.stationB && state.comparison.stationA !== state.comparison.stationB) {
                    compareBtn.disabled = false;
                } else {
                    compareBtn.disabled = true;
                }
            };

            // Don't show selected station from A as an option in B (prevents self-comparison)
            if (elementId === 'station-b-list' && station === state.comparison.stationA) {
                return;
            }
            // Don't show selected station from B as an option in A
            if (elementId === 'station-a-list' && station === state.comparison.stationB) {
                return;
            }

            ul.appendChild(li);
        });
    };

    // Initialize lists
    renderList('station-a-list');
    renderList('station-b-list');

    // Bind searches
    document.getElementById('station-a-search').oninput = (e) => renderList('station-a-list', e.target.value, state.comparison.stationA);
    document.getElementById('station-b-search').oninput = (e) => renderList('station-b-list', e.target.value, state.comparison.stationB);

    // Bind Metric change
    document.querySelectorAll('input[name="compare-metric"]').forEach(radio => {
        radio.onchange = (e) => {
            state.comparison.metric = e.target.value;
            // If chart is already visible, update it live!
            if (document.getElementById('comparison-chart-section').style.display === 'block') {
                triggerComparisonChartDrawing();
            }
        };
    });

    // Start Comparison Button Action
    document.getElementById('start-comparison-btn').onclick = () => {
        triggerComparisonChartDrawing();
        document.getElementById('comparison-chart-section').style.display = 'block';
    };

    // Close Comparison Chart Panel back to configuration selection
    document.getElementById('close-comparison-chart-btn').onclick = () => {
        document.getElementById('comparison-chart-section').style.display = 'none';
    };
}

/**
 * Fetches selected comparison datasets and renders the overlay chart
 */
function triggerComparisonChartDrawing() {
    const { stationA, stationB, metric } = state.comparison;
    if (!stationA || !stationB) return;

    const dataA = state.loadedData[stationA];
    const dataB = state.loadedData[stationB];

    let metricName = metric.toUpperCase();
    if (metric === 's4') metricName = 'ROTI';
    else if (metric === 'error') metricName = '3D RMS Position Error';
    
    document.getElementById('comparison-chart-title').textContent = `${metricName} Comparison: ${stationA} vs ${stationB}`;

    renderComparisonChart(stationA, stationB, metric, dataA, dataB);
}

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

