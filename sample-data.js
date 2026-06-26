/**
 * ==========================================================================
 * GNSS Observation Offline Visualizer - Preset Stations & Mock Data Generator
 * ==========================================================================
 */

// Preset stations list from reference project with coordinates and group information
const PRESET_STATIONS = [
    { name: "CM01", code: "KMITL", lat: 18.8000, lon: 98.9500 },
    { name: "CADT", code: "KMITL", lat: 11.6545, lon: 104.9116 },
    { name: "KMIT6", code: "KMITL", lat: 13.7278, lon: 100.7724 },
    { name: "STFD", code: "KMITL", lat: 13.7356, lon: 100.6611 },
    { name: "RUT1", code: "KMITL", lat: 14.9889, lon: 102.1206 },
    { name: "CPN1", code: "KMITL", lat: 10.7247, lon: 99.3744 },
    { name: "NUO2", code: "KMITL", lat: 18.0400, lon: 102.6347 },
    { name: "ITC0", code: "KMITL", lat: 11.5705, lon: 104.8994 },
    { name: "HUEV", code: "KMITL", lat: 16.4155, lon: 107.5687 },
    { name: "KKU0", code: "KMITL", lat: 16.4721, lon: 102.8260 },
    { name: "NKSW", code: "DPT", lat: 15.690637, lon: 100.114112 },
    { name: "UTTD", code: "DPT", lat: 17.630094, lon: 100.096343 },
    { name: "CHAN", code: "DPT", lat: 12.610310, lon: 102.102411 },
    { name: "SPBR", code: "DPT", lat: 14.518875, lon: 100.130580 },
    { name: "DPT9", code: "DPT", lat: 13.756782, lon: 100.573200 },
    { name: "PJRK", code: "DPT", lat: 11.811621, lon: 99.796348 },
    { name: "SRTN", code: "DPT", lat: 9.132225, lon: 99.331361 },
    { name: "NKNY", code: "DPT", lat: 14.212003, lon: 101.202211 },
    { name: "SOKA", code: "DPT", lat: 7.206694, lon: 100.596121 },
    { name: "UDON", code: "DPT", lat: 17.412732, lon: 102.780704 },
    { name: "CNBR", code: "DPT", lat: 13.406019, lon: 100.997652 },
    { name: "NKRM", code: "DPT", lat: 14.992119, lon: 102.129470 },
    { name: "LPBR", code: "DPT", lat: 14.800907, lon: 100.651246 },
    { name: "SISK", code: "DPT", lat: 15.116122, lon: 104.285676 },
    { name: "CHMA", code: "DPT", lat: 18.8400, lon: 98.9700 }
];

// Helper to generate coordinates lookup map
const STATIONS_COORDINATES_LOOKUP = PRESET_STATIONS.reduce((acc, current) => {
    acc[current.name.toUpperCase()] = { lat: current.lat, lon: current.lon, code: current.code };
    return acc;
}, {});

/**
 * Generates highly realistic simulated offline GNSS data for testing.
 * Simulates East-North-Up errors, S4 scintillation indices, and VTEC curves over 24 hours.
 */
function generateMockGNSSData() {
    const data = [];
    const stationsToGenerate = ["KMIT6", "CPN1", "CM01"];
    const baseDate = new Date();
    baseDate.setHours(0, 0, 0, 0); // Start of today

    // Number of steps (288 points = 5-minute intervals for 24 hours)
    const intervalMinutes = 5;
    const totalPoints = 288;

    stationsToGenerate.forEach((stationName) => {
        const stationCoords = STATIONS_COORDINATES_LOOKUP[stationName];
        
        for (let i = 0; i < totalPoints; i++) {
            const timeOffset = i * intervalMinutes * 60 * 1000;
            const currentEpoch = new Date(baseDate.getTime() + timeOffset);
            
            // Format time string as YYYY-MM-DD HH:MM:SS
            const year = currentEpoch.getFullYear();
            const month = String(currentEpoch.getMonth() + 1).padStart(2, '0');
            const day = String(currentEpoch.getDate()).padStart(2, '0');
            const hours = String(currentEpoch.getHours()).padStart(2, '0');
            const minutes = String(currentEpoch.getMinutes()).padStart(2, '0');
            const seconds = String(currentEpoch.getSeconds()).padStart(2, '0');
            const timestampString = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;

            const hourDecimal = currentEpoch.getHours() + currentEpoch.getMinutes() / 60;

            // 1. POSITIONING ERRORS (dE, dN, dU)
            // East and North errors fluctuate at centimeter-level, Up error at decimeter-level
            let errorEast = normalRandom(0, 0.015);
            let errorNorth = normalRandom(0, 0.012);
            let errorUp = normalRandom(0.01, 0.035); // Height error typically has positive bias

            // Simulate multipath or atmospheric refraction jump around 13:00 - 15:00 local time
            if (hourDecimal >= 13.0 && hourDecimal <= 15.0) {
                const disturbanceFactor = Math.sin((hourDecimal - 13) * Math.PI / 2);
                errorEast += normalRandom(0.04 * disturbanceFactor, 0.02);
                errorNorth += normalRandom(0.03 * disturbanceFactor, 0.015);
                errorUp += normalRandom(0.12 * disturbanceFactor, 0.06);
            }

            // 2. VTEC DIURNAL CURVE
            // Low in the morning, peaking around 14:00 (local time), decaying at night
            // KMIT6 (central) has medium TEC, CPN1 (south, near geomagnetic equator) has higher, CM01 (north) has lower
            let baseTEC = 15;
            let peakTEC = 38;
            if (stationName === "CPN1") {
                baseTEC = 18;
                peakTEC = 48; // Nearer geomagnetic equator -> higher VTEC
            } else if (stationName === "CM01") {
                baseTEC = 12;
                peakTEC = 30;
            }

            // Diurnal cosine curve peaking at 14:00
            const tRad = ((hourDecimal - 14) / 24) * 2 * Math.PI;
            let vtec = baseTEC + (peakTEC - baseTEC) * (0.5 + 0.5 * Math.cos(tRad));
            // Add slight high frequency noise
            vtec += normalRandom(0, 0.4);

            // 3. S4 SCINTILLATION INDEX (amplitude scintillation)
            // Low during the day (~0.05 - 0.12).
            // Equatorial plasma bubbles occur after sunset (19:00 - 23:00), leading to S4 spikes.
            let s4 = 0.06 + Math.random() * 0.06;
            
            // Let's trigger a significant bubble event on CPN1 and KMIT6 in the evening
            if (hourDecimal >= 19.5 && hourDecimal <= 22.5) {
                const bubbleCenter = 21.0;
                const bubbleWidth = 1.0; // std dev
                const intensityFactor = Math.exp(-Math.pow(hourDecimal - bubbleCenter, 2) / (2 * Math.pow(bubbleWidth, 2)));
                
                if (stationName === "CPN1") {
                    // Severe scintillation event
                    s4 += (0.65 * intensityFactor) + (Math.random() * 0.15);
                } else if (stationName === "KMIT6") {
                    // Moderate scintillation event
                    s4 += (0.35 * intensityFactor) + (Math.random() * 0.08);
                }
            }
            // Clamp S4 between 0.02 and 1.0
            s4 = Math.max(0.02, Math.min(1.0, s4));

            data.push({
                timestamp: timestampString,
                station: stationName,
                latitude: stationCoords.lat,
                longitude: stationCoords.lon,
                error_east: parseFloat(errorEast.toFixed(4)),
                error_north: parseFloat(errorNorth.toFixed(4)),
                error_up: parseFloat(errorUp.toFixed(4)),
                s4_index: parseFloat(s4.toFixed(3)),
                vtec: parseFloat(vtec.toFixed(2))
            });
        }
    });

    return data;
}

// Box-Muller transform for normal distribution
function normalRandom(mean = 0, stdDev = 1) {
    let u = 0, v = 0;
    while(u === 0) u = Math.random(); 
    while(v === 0) v = Math.random();
    const num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return num * stdDev + mean;
}

/**
 * Exporter helper to generate and download a sample CSV file matching the auto-detectable template structure.
 */
function downloadSampleCSV() {
    const mockData = generateMockGNSSData();
    
    // Prepare standard headers
    const headers = ["Timestamp", "StationName", "Latitude", "Longitude", "dE_EastError_m", "dN_NorthError_m", "dU_UpError_m", "S4_Index", "VTEC_TECU"];
    
    const csvRows = [];
    csvRows.push(headers.join(","));

    mockData.forEach(row => {
        const values = [
            row.timestamp,
            row.station,
            row.latitude,
            row.longitude,
            row.error_east,
            row.error_north,
            row.error_up,
            row.s4_index,
            row.vtec
        ];
        csvRows.push(values.join(","));
    });

    const csvContent = csvRows.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "gnss_observation_sample.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
