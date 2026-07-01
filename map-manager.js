/**
 * ==========================================================================
 * GNSS Observation Offline Visualizer - Leaflet Map Manager
 * ==========================================================================
 */

// Global leaflet map instance and marker registry
let leafletMap = null;
let activeTileLayer = null;
const mapMarkers = {};
let ippLayerGroup = null;

/**
 * Sets the map tile layer to match the active theme.
 * @param {string} theme - 'dark' or 'light'
 */
function setMapTheme(theme) {
    if (!leafletMap) return;

    if (activeTileLayer) {
        leafletMap.removeLayer(activeTileLayer);
    }

    const maxBounds = [[-20, 60], [45, 140]];
    const tileUrl = theme === 'light' 
        ? 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
        : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

    activeTileLayer = L.tileLayer(tileUrl, {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20,
        noWrap: true,
        bounds: maxBounds
    });

    activeTileLayer.addTo(leafletMap);
}

/**
 * Initializes the Leaflet map with theme-appropriate tiles.
 */
function initMap() {
    const defaultCenter = [13.0, 101.5]; // Thailand centered
    const defaultZoom = 6;
    const maxBounds = [[-20, 60], [45, 140]]; // Constrain bounds to Southeast Asia/Asia

    leafletMap = L.map('map', {
        minZoom: 4,
        maxZoom: 12,
        zoomControl: false,
        maxBounds: maxBounds,
        maxBoundsViscosity: 1.0
    }).setView(defaultCenter, defaultZoom);

    // Zoom buttons positioned bottom right
    L.control.zoom({ position: 'bottomright' }).addTo(leafletMap);

    // Initialize tile layer based on active theme
    const initialTheme = (window.state && window.state.theme) || 'dark';
    setMapTheme(initialTheme);

    // Initialize layer group for IPPs
    ippLayerGroup = L.layerGroup().addTo(leafletMap);

    // Reset view button bind
    document.getElementById('reset-view-btn').onclick = () => {
        leafletMap.setView(defaultCenter, defaultZoom);
        closeSidebar();
    };

    // Render preset station markers on startup
    renderPresetMarkers();
}

/**
 * Creates custom divIcon for station markers based on loaded status.
 * @param {string} colorClass - CSS color class for the dot (green, gray).
 * @param {boolean} isGlowing - If true, adds a pulse animation.
 */
function createStationMarkerIcon(status = 'inactive') {
    let dotColor = '#4b5563'; // Gray for inactive
    let shadowGlow = 'rgba(75, 85, 99, 0.3)';
    let animateClass = '';

    if (status === 'active') {
        dotColor = '#10b981'; // Neon Green
        shadowGlow = 'rgba(16, 185, 129, 0.6)';
        animateClass = 'pulse-animation'; // Animation defined in CSS or via box-shadow pulse
    }

    return L.divIcon({
        className: 'marker-status-dot',
        html: `
            <div style="
                width: 14px; 
                height: 14px; 
                border-radius: 50%; 
                background: ${dotColor}; 
                border: 2px solid #ffffff; 
                box-shadow: 0 0 8px ${shadowGlow};
                transition: all 0.3s ease;
            "></div>
        `,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
        popupAnchor: [0, -10]
    });
}

/**
 * Plots the initial set of 25 GNSS stations from PRESET_STATIONS
 */
function renderPresetMarkers() {
    PRESET_STATIONS.forEach((station) => {
        // Default to inactive state
        const markerIcon = createStationMarkerIcon('inactive');
        
        const marker = L.marker([station.lat, station.lon], {
            icon: markerIcon,
            title: station.name
        });

        // Popup Content
        const popupContent = `
            <div style="font-family: 'Outfit', sans-serif; padding: 4px;">
                <h4 style="margin: 0 0 4px 0; font-size: 1.1rem; color: var(--text-main);">${station.name}</h4>
                <p style="margin: 0 0 8px 0; font-size: 0.8rem; color: var(--text-muted);">
                    Org: ${station.code}<br>
                    Lat: ${station.lat.toFixed(4)}°<br>
                    Lon: ${station.lon.toFixed(4)}°
                </p>
                <a href="javascript:void(0)" class="popup-link" onclick="handleStationSelect('${station.name}')">
                    Analyze Station &rarr;
                </a>
            </div>
        `;

        marker.bindPopup(popupContent);
        marker.addTo(leafletMap);
        
        // Save marker reference
        mapMarkers[station.name.toUpperCase()] = marker;
    });
}

/**
 * Updates marker icons on the map based on which stations have loaded data.
 * @param {Array<string>} activeStationNames - Names of stations with loaded CSV data.
 */
function updateMapMarkers(activeStationNames) {
    const uppercaseActiveNames = activeStationNames.map(name => name.toUpperCase());

    PRESET_STATIONS.forEach(station => {
        const marker = mapMarkers[station.name.toUpperCase()];
        if (!marker) return;

        const isCurrentlyActive = uppercaseActiveNames.includes(station.name.toUpperCase());
        
        // Update marker icon
        marker.setIcon(createStationMarkerIcon(isCurrentlyActive ? 'active' : 'inactive'));

        // Reset element opacity based on search filter status
        const el = marker.getElement();
        if (el) {
            el.classList.remove('marker-faded');
        }
    });
}

/**
 * Highlight a specific station by panning to it and pulsing its marker size
 * @param {string} stationName - Station to focus.
 */
function focusOnStation(stationName) {
    const marker = mapMarkers[stationName.toUpperCase()];
    if (!marker) return;

    const latlng = marker.getLatLng();
    leafletMap.setView(latlng, 8, { animate: true, duration: 1.0 });
    marker.openPopup();
}

/**
 * Renders Ionospheric Pierce Points (IPPs) and connection lines on the map.
 * @param {Array<Object>} ippPoints - Array of IPP objects: { st, sat, lat, lon, v, r }
 * @param {string} constellationFilter - 'all', 'GPS', or 'BDS'
 * @param {boolean} showLines - If true, draws connection lines
 * @param {string} metricType - 'vtec' or 'roti'
 */
function renderIPPData(ippPoints, constellationFilter = 'all', showLines = true, metricType = 'vtec') {
    if (!ippLayerGroup) return;
    ippLayerGroup.clearLayers();

    if (!ippPoints || ippPoints.length === 0) return;

    ippPoints.forEach(pt => {
        // Filter by constellation
        if (constellationFilter === 'GPS' && !pt.sat.startsWith('G')) return;
        if (constellationFilter === 'BDS' && !pt.sat.startsWith('C')) return;

        // Metric and Color Coding selection
        let val = metricType === 'roti' ? pt.r : pt.v;
        let color = '#3b82f6'; // Default blue

        if (metricType === 'roti') {
            // ROTI thresholds: Green < 0.1, Yellow < 0.25, Orange < 0.5, Red < 1.0, Pink >= 1.0
            if (val < 0.1) {
                color = '#10b981'; // Green
            } else if (val < 0.25) {
                color = '#f59e0b'; // Yellow
            } else if (val < 0.5) {
                color = '#f97316'; // Orange
            } else if (val < 1.0) {
                color = '#ef4444'; // Red
            } else {
                color = '#ec4899'; // Pink/Magenta
            }
        } else {
            // VTEC thresholds: low < 15, medium < 40, high < 70, extreme >= 70
            if (val < 15) {
                color = '#10b981'; // Green
            } else if (val < 40) {
                color = '#f59e0b'; // Yellow/Orange
            } else if (val < 70) {
                color = '#ef4444'; // Red
            } else {
                color = '#ec4899'; // Pink/Magenta
            }
        }

        // Draw Circle at IPP
        const circle = L.circleMarker([pt.lat, pt.lon], {
            radius: 5,
            fillColor: color,
            color: '#ffffff',
            weight: 1,
            opacity: 0.8,
            fillOpacity: 0.9
        });

        // Tooltip detail
        const valueDisplay = metricType === 'roti' 
            ? `<strong>ROTI:</strong> ${val.toFixed(3)} TECU/min`
            : `<strong>VTEC:</strong> ${val.toFixed(2)} TECU`;

        const tooltipContent = `
            <div style="font-family: 'Outfit', sans-serif; font-size: 0.8rem; line-height: 1.3;">
                <strong>Sat:</strong> ${pt.sat}<br>
                ${valueDisplay}<br>
                <strong>IPP:</strong> ${pt.lat.toFixed(2)}°, ${pt.lon.toFixed(2)}°<br>
                <strong>Station:</strong> ${pt.st}
            </div>
        `;
        circle.bindTooltip(tooltipContent, { direction: 'top', className: 'ipp-tooltip' });

        // Add to group
        ippLayerGroup.addLayer(circle);

        // Draw connection line to originating station if enabled
        if (showLines) {
            const stationName = pt.st.toUpperCase();
            const stationInfo = STATIONS_COORDINATES_LOOKUP[stationName];
            if (stationInfo) {
                const line = L.polyline([[stationInfo.lat, stationInfo.lon], [pt.lat, pt.lon]], {
                    color: color,
                    weight: 1,
                    dashArray: '3, 4',
                    opacity: 0.45
                });
                ippLayerGroup.addLayer(line);
            }
        }
    });
}

/**
 * Toggles the visibility of station markers on the map.
 * @param {boolean} visible - If true, displays markers, otherwise removes them.
 */
function toggleStationMarkersVisibility(visible) {
    if (!leafletMap) return;
    Object.values(mapMarkers).forEach(marker => {
        if (visible) {
            if (!leafletMap.hasLayer(marker)) {
                marker.addTo(leafletMap);
            }
        } else {
            if (leafletMap.hasLayer(marker)) {
                leafletMap.removeLayer(marker);
            }
        }
    });
}


