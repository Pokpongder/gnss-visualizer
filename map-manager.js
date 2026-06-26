/**
 * ==========================================================================
 * GNSS Observation Offline Visualizer - Leaflet Map Manager
 * ==========================================================================
 */

// Global leaflet map instance and marker registry
let leafletMap = null;
const mapMarkers = {};

/**
 * Initializes the Leaflet map with dark theme tiles.
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

    // CartoDB Dark Matter tile layer (Premium Dark Mode)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20,
        noWrap: true,
        bounds: maxBounds
    }).addTo(leafletMap);

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
                <h4 style="margin: 0 0 4px 0; font-size: 1.1rem; color: #fff;">${station.name}</h4>
                <p style="margin: 0 0 8px 0; font-size: 0.8rem; color: #9ca3af;">
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
