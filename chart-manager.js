/**
 * ==========================================================================
 * GNSS Observation Offline Visualizer - Chart Manager (Chart.js Wrapper)
 * ==========================================================================
 */

// Global storage for chart instances to allow reuse/updates
const activeCharts = {
    scatterError: null,
    timeseriesError: null,
    s4: null,
    vtec: null,
    expanded: null
};

// Global styling defaults for Chart.js (Dark/Light Mode theme)
const chartDefaults = {
    textColor: '#9ca3af',
    borderColor: 'rgba(255, 255, 255, 0.06)',
    gridColor: 'rgba(255, 255, 255, 0.05)',
    fontFamily: "'Space Grotesk', sans-serif",
    tooltipBg: 'rgba(14, 22, 38, 0.95)',
    tooltipBorder: 'rgba(255, 255, 255, 0.1)',
    tooltipTitleColor: '#ffffff'
};

/**
 * Updates Chart.js defaults and active charts to match the theme.
 * @param {string} theme - 'dark' or 'light'
 */
function setChartTheme(theme) {
    if (theme === 'light') {
        chartDefaults.textColor = '#475569';
        chartDefaults.borderColor = 'rgba(15, 23, 42, 0.06)';
        chartDefaults.gridColor = 'rgba(15, 23, 42, 0.05)';
        chartDefaults.tooltipBg = 'rgba(255, 255, 255, 0.95)';
        chartDefaults.tooltipBorder = 'rgba(15, 23, 42, 0.1)';
        chartDefaults.tooltipTitleColor = '#0f172a';
    } else {
        chartDefaults.textColor = '#9ca3af';
        chartDefaults.borderColor = 'rgba(255, 255, 255, 0.06)';
        chartDefaults.gridColor = 'rgba(255, 255, 255, 0.05)';
        chartDefaults.tooltipBg = 'rgba(14, 22, 38, 0.95)';
        chartDefaults.tooltipBorder = 'rgba(255, 255, 255, 0.1)';
        chartDefaults.tooltipTitleColor = '#ffffff';
    }

    // Update all active chart instances
    for (const key in activeCharts) {
        const chart = activeCharts[key];
        if (!chart) continue;

        // Update scales (grid, ticks, titles)
        if (chart.options.scales) {
            for (const scaleKey in chart.options.scales) {
                const scale = chart.options.scales[scaleKey];
                if (scale.ticks) {
                    scale.ticks.color = chartDefaults.textColor;
                }
                if (scale.grid) {
                    scale.grid.color = chartDefaults.gridColor;
                }
                if (scale.title) {
                    scale.title.color = chartDefaults.textColor;
                }
            }
        }

        // Update plugins (legend, tooltip)
        if (chart.options.plugins) {
            if (chart.options.plugins.legend && chart.options.plugins.legend.labels) {
                chart.options.plugins.legend.labels.color = chartDefaults.textColor;
            }
            if (chart.options.plugins.tooltip) {
                chart.options.plugins.tooltip.backgroundColor = chartDefaults.tooltipBg;
                chart.options.plugins.tooltip.borderColor = chartDefaults.tooltipBorder;
                chart.options.plugins.tooltip.titleColor = chartDefaults.tooltipTitleColor;
                chart.options.plugins.tooltip.bodyColor = chartDefaults.textColor;
            }
        }

        chart.update();
    }
}

/**
 * Initializes or updates all sidebar charts for a selected station.
 * @param {string} stationName - Name of the selected station.
 * @param {Array} stationData - Data points for the selected station.
 */
function updateStationCharts(stationName, stationData) {
    if (!stationData || stationData.length === 0) return;

    // Sort data chronologically just in case
    const sortedData = [...stationData].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    // Extract time labels and metrics
    const timestamps = sortedData.map(d => d.timestamp.split(' ')[1] || d.timestamp); // Use time portion if available
    const errorEast = sortedData.map(d => d.error_east);
    const errorNorth = sortedData.map(d => d.error_north);
    const errorUp = sortedData.map(d => d.error_up);
    const s4Data = sortedData.map(d => d.s4_index);
    const vtecData = sortedData.map(d => d.vtec);

    // 1. SCATTER ERROR CHART (East vs North bulls-eye target)
    renderScatterErrorChart(sortedData);

    // 2. TIMESERIES ERROR CHART (ENU errors)
    renderTimeseriesErrorChart(timestamps, errorEast, errorNorth, errorUp);

    // 3. S4 SCINTILLATION CHART
    renderS4Chart(timestamps, s4Data);

    // 4. VTEC CHART
    renderVtecChart(timestamps, vtecData);
}

/**
 * Renders the 2D Horizontal Positioning Error Scatter Plot
 */
function renderScatterErrorChart(data) {
    const ctx = document.getElementById('scatterErrorChart').getContext('2d');
    
    // Format scatter points: {x: East error, y: North error}
    const points = data.map(d => ({ x: d.error_east, y: d.error_north }));

    // Calculate 95% Circular Error Probability (CEP95)
    // Formula approximation: 2D error = sqrt(dE^2 + dN^2)
    const horizontalErrors = data.map(d => Math.sqrt(d.error_east ** 2 + d.error_north ** 2));
    horizontalErrors.sort((a, b) => a - b);
    const cep95Index = Math.floor(horizontalErrors.length * 0.95);
    const cep95Radius = horizontalErrors[cep95Index] || 0.05;

    // Generate circle points for drawing the CEP95 circle
    const circlePoints = [];
    const numPoints = 100;
    for (let i = 0; i <= numPoints; i++) {
        const angle = (i / numPoints) * 2 * Math.PI;
        circlePoints.push({
            x: parseFloat((cep95Radius * Math.cos(angle)).toFixed(4)),
            y: parseFloat((cep95Radius * Math.sin(angle)).toFixed(4))
        });
    }

    // Find dynamic boundaries to center the scatter plot
    const maxVal = Math.max(
        ...data.map(d => Math.max(Math.abs(d.error_east), Math.abs(d.error_north))),
        cep95Radius,
        0.05 // Minimum grid size
    );
    const limit = parseFloat((maxVal * 1.15).toFixed(3)); // 15% padding

    const chartData = {
        datasets: [
            {
                label: 'Pos Errors (E, N)',
                data: points,
                backgroundColor: 'rgba(59, 130, 246, 0.65)',
                borderColor: '#60a5fa',
                borderWidth: 1,
                pointRadius: 3,
                pointHoverRadius: 5,
                zIndex: 2
            },
            {
                label: `CEP95 (${(cep95Radius * 100).toFixed(1)} cm)`,
                data: circlePoints,
                borderColor: '#ef4444',
                borderWidth: 1.5,
                borderDash: [5, 5],
                pointRadius: 0,
                fill: false,
                showLine: true,
                tension: 0.1,
                zIndex: 1
            }
        ]
    };

    if (activeCharts.scatterError) {
        activeCharts.scatterError.data = chartData;
        activeCharts.scatterError.options.scales.x.min = -limit;
        activeCharts.scatterError.options.scales.x.max = limit;
        activeCharts.scatterError.options.scales.y.min = -limit;
        activeCharts.scatterError.options.scales.y.max = limit;
        activeCharts.scatterError.update();
    } else {
        activeCharts.scatterError = new Chart(ctx, {
            type: 'scatter',
            data: chartData,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            color: chartDefaults.textColor,
                            boxWidth: 15,
                            font: { family: chartDefaults.fontFamily }
                        }
                    },
                    tooltip: {
                        backgroundColor: chartDefaults.tooltipBg,
                        borderColor: chartDefaults.tooltipBorder,
                        borderWidth: 1,
                        titleColor: chartDefaults.tooltipTitleColor,
                        bodyColor: chartDefaults.textColor,
                        callbacks: {
                            label: function(context) {
                                return `East: ${(context.raw.x * 100).toFixed(1)} cm, North: ${(context.raw.y * 100).toFixed(1)} cm`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        title: { display: true, text: 'East Error (meters)', color: chartDefaults.textColor },
                        grid: { color: chartDefaults.gridColor, drawOrigin: true },
                        ticks: { color: chartDefaults.textColor },
                        min: -limit,
                        max: limit
                    },
                    y: {
                        title: { display: true, text: 'North Error (meters)', color: chartDefaults.textColor },
                        grid: { color: chartDefaults.gridColor, drawOrigin: true },
                        ticks: { color: chartDefaults.textColor },
                        min: -limit,
                        max: limit
                    }
                }
            }
        });
    }
}

/**
 * Renders the Time-Series ENU Error Chart
 */
function renderTimeseriesErrorChart(labels, east, north, up) {
    const ctx = document.getElementById('timeseriesErrorChart').getContext('2d');
    
    const chartData = {
        labels: labels,
        datasets: [
            {
                label: 'East Error (dE)',
                data: east,
                borderColor: '#3b82f6', // Blue
                backgroundColor: 'rgba(59, 130, 246, 0.05)',
                borderWidth: 1.5,
                pointRadius: 0,
                tension: 0.1
            },
            {
                label: 'North Error (dN)',
                data: north,
                borderColor: '#10b981', // Green
                backgroundColor: 'rgba(16, 185, 129, 0.05)',
                borderWidth: 1.5,
                pointRadius: 0,
                tension: 0.1
            },
            {
                label: 'Up Error (dU)',
                data: up,
                borderColor: '#8b5cf6', // Violet
                backgroundColor: 'rgba(139, 92, 246, 0.05)',
                borderWidth: 1.5,
                pointRadius: 0,
                tension: 0.1
            }
        ]
    };

    if (activeCharts.timeseriesError) {
        activeCharts.timeseriesError.data = chartData;
        activeCharts.timeseriesError.update();
    } else {
        activeCharts.timeseriesError = new Chart(ctx, {
            type: 'line',
            data: chartData,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            color: chartDefaults.textColor,
                            boxWidth: 15,
                            font: { family: chartDefaults.fontFamily }
                        }
                    },
                    tooltip: {
                        backgroundColor: chartDefaults.tooltipBg,
                        borderColor: chartDefaults.tooltipBorder,
                        borderWidth: 1,
                        titleColor: chartDefaults.tooltipTitleColor,
                        bodyColor: chartDefaults.textColor
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: chartDefaults.textColor, maxTicksLimit: 8 }
                    },
                    y: {
                        title: { display: true, text: 'Error (meters)', color: chartDefaults.textColor },
                        grid: { color: chartDefaults.gridColor },
                        ticks: { color: chartDefaults.textColor }
                    }
                }
            }
        });
    }
}

/**
 * Renders the S4 Scintillation Index Chart
 */
function renderS4Chart(labels, s4Data) {
    const ctx = document.getElementById('s4Chart').getContext('2d');
    
    // Custom plugin to draw color-coded background bands for Scintillation severity
    const s4BandsPlugin = {
        id: 's4Bands',
        beforeDraw: (chart) => {
            const { ctx, chartArea, scales: { y } } = chart;
            if (!chartArea) return;

            const drawBand = (startVal, endVal, color) => {
                const top = y.getPixelForValue(endVal);
                const bottom = y.getPixelForValue(startVal);
                ctx.fillStyle = color;
                ctx.fillRect(chartArea.left, top, chartArea.width, bottom - top);
            };

            // Severe: 0.6 - 1.0 (light red zone)
            drawBand(0.6, 1.0, 'rgba(239, 68, 68, 0.04)');
            // Moderate: 0.4 - 0.6 (light amber zone)
            drawBand(0.4, 0.6, 'rgba(245, 158, 11, 0.03)');
            // Low: 0.0 - 0.4 (light green zone)
            drawBand(0.0, 0.4, 'rgba(16, 185, 129, 0.02)');
        }
    };

    const chartData = {
        labels: labels,
        datasets: [{
            label: 'ROTI',
            data: s4Data,
            borderColor: '#f59e0b', // Amber/gold
            backgroundColor: 'rgba(245, 158, 11, 0.1)',
            borderWidth: 2,
            pointRadius: 0,
            fill: true,
            tension: 0.2
        }]
    };

    if (activeCharts.s4) {
        activeCharts.s4.data = chartData;
        activeCharts.s4.update();
    } else {
        activeCharts.s4 = new Chart(ctx, {
            type: 'line',
            data: chartData,
            plugins: [s4BandsPlugin],
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: chartDefaults.tooltipBg,
                        borderColor: chartDefaults.tooltipBorder,
                        borderWidth: 1,
                        titleColor: chartDefaults.tooltipTitleColor,
                        bodyColor: chartDefaults.textColor
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: chartDefaults.textColor, maxTicksLimit: 8 }
                    },
                    y: {
                        title: { display: true, text: 'ROTI (TECU/min)', color: chartDefaults.textColor },
                        grid: { color: chartDefaults.gridColor },
                        ticks: { color: chartDefaults.textColor },
                        min: 0,
                        suggestedMax: 0.2
                    }
                }
            }
        });
    }
}

/**
 * Renders the VTEC (Total Electron Content) Chart
 */
function renderVtecChart(labels, vtecData) {
    const ctx = document.getElementById('vtecChart').getContext('2d');
    
    const chartData = {
        labels: labels,
        datasets: [{
            label: 'VTEC',
            data: vtecData,
            borderColor: '#a78bfa', // Purple
            backgroundColor: 'rgba(139, 92, 246, 0.05)',
            borderWidth: 2,
            pointRadius: 0,
            fill: true,
            tension: 0.1
        }]
    };

    if (activeCharts.vtec) {
        activeCharts.vtec.data = chartData;
        activeCharts.vtec.update();
    } else {
        activeCharts.vtec = new Chart(ctx, {
            type: 'line',
            data: chartData,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: chartDefaults.tooltipBg,
                        borderColor: chartDefaults.tooltipBorder,
                        borderWidth: 1,
                        titleColor: chartDefaults.tooltipTitleColor,
                        bodyColor: chartDefaults.textColor
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: chartDefaults.textColor, maxTicksLimit: 8 }
                    },
                    y: {
                        title: { display: true, text: 'VTEC (TECU)', color: chartDefaults.textColor },
                        grid: { color: chartDefaults.gridColor },
                        ticks: { color: chartDefaults.textColor }
                    }
                }
            }
        });
    }
}



/**
 * Renders a large-scale expanded chart in the zoom modal
 */
function renderExpandedChart(chartType, stationName, stationData) {
    const ctx = document.getElementById('expandedChartCanvas').getContext('2d');
    
    // Destroy previous expanded chart instance if exists
    if (activeCharts.expanded) {
        activeCharts.expanded.destroy();
        activeCharts.expanded = null;
    }
    
    if (!stationData || stationData.length === 0) return;
    const sortedData = [...stationData].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const timestamps = sortedData.map(d => d.timestamp.split(' ')[1] || d.timestamp);
    
    let config = {};
    const titleElement = document.getElementById('expanded-chart-title');
    const infoElement = document.getElementById('expanded-chart-info');
    
    // Reset info box
    infoElement.style.display = 'none';
    infoElement.innerHTML = '';
    
    if (chartType === 'scatter') {
        titleElement.textContent = `ENU Horizontal Error Distribution: ${stationName}`;
        infoElement.innerHTML = `<i data-lucide="info"></i><span>CEP95 radius represents 95% circular error probability (CEP). Red circle boundaries represent the threshold limit.</span>`;
        infoElement.className = "chart-info-box info-box";
        infoElement.style.display = 'flex';
        
        const points = sortedData.map(d => ({ x: d.error_east, y: d.error_north }));
        const horizontalErrors = sortedData.map(d => Math.sqrt(d.error_east ** 2 + d.error_north ** 2));
        horizontalErrors.sort((a, b) => a - b);
        const cep95Index = Math.floor(horizontalErrors.length * 0.95);
        const cep95Radius = horizontalErrors[cep95Index] || 0.05;

        const circlePoints = [];
        const numPoints = 100;
        for (let i = 0; i <= numPoints; i++) {
            const angle = (i / numPoints) * 2 * Math.PI;
            circlePoints.push({
                x: parseFloat((cep95Radius * Math.cos(angle)).toFixed(4)),
                y: parseFloat((cep95Radius * Math.sin(angle)).toFixed(4))
            });
        }

        const maxVal = Math.max(
            ...sortedData.map(d => Math.max(Math.abs(d.error_east), Math.abs(d.error_north))),
            cep95Radius,
            0.05
        );
        const limit = parseFloat((maxVal * 1.15).toFixed(3));

        config = {
            type: 'scatter',
            data: {
                datasets: [
                    {
                        label: 'Pos Errors (E, N)',
                        data: points,
                        backgroundColor: 'rgba(59, 130, 246, 0.75)',
                        borderColor: '#60a5fa',
                        borderWidth: 1,
                        pointRadius: 4,
                        pointHoverRadius: 6,
                        zIndex: 2
                    },
                    {
                        label: `CEP95 (${(cep95Radius * 100).toFixed(1)} cm)`,
                        data: circlePoints,
                        borderColor: '#ef4444',
                        borderWidth: 2,
                        borderDash: [5, 5],
                        pointRadius: 0,
                        fill: false,
                        showLine: true,
                        tension: 0.1,
                        zIndex: 1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            color: chartDefaults.textColor,
                            boxWidth: 20,
                            font: { family: chartDefaults.fontFamily, size: 12 }
                        }
                    },
                    tooltip: {
                        backgroundColor: chartDefaults.tooltipBg,
                        borderColor: chartDefaults.tooltipBorder,
                        borderWidth: 1,
                        titleColor: chartDefaults.tooltipTitleColor,
                        bodyColor: chartDefaults.textColor,
                        callbacks: {
                            label: function(context) {
                                return `East: ${(context.raw.x * 100).toFixed(1)} cm, North: ${(context.raw.y * 100).toFixed(1)} cm`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        title: { display: true, text: 'East Error (meters)', color: chartDefaults.textColor, font: { size: 12 } },
                        grid: { color: chartDefaults.gridColor, drawOrigin: true },
                        ticks: { color: chartDefaults.textColor, font: { size: 11 } },
                        min: -limit,
                        max: limit
                    },
                    y: {
                        title: { display: true, text: 'North Error (meters)', color: chartDefaults.textColor, font: { size: 12 } },
                        grid: { color: chartDefaults.gridColor, drawOrigin: true },
                        ticks: { color: chartDefaults.textColor, font: { size: 11 } },
                        min: -limit,
                        max: limit
                    }
                }
            }
        };
    } else if (chartType === 'enu-time') {
        titleElement.textContent = `ENU Position Error Over Time: ${stationName}`;
        
        const east = sortedData.map(d => d.error_east);
        const north = sortedData.map(d => d.error_north);
        const up = sortedData.map(d => d.error_up);

        config = {
            type: 'line',
            data: {
                labels: timestamps,
                datasets: [
                    {
                        label: 'East Error (dE)',
                        data: east,
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.05)',
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0.1
                    },
                    {
                        label: 'North Error (dN)',
                        data: north,
                        borderColor: '#10b981',
                        backgroundColor: 'rgba(16, 185, 129, 0.05)',
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0.1
                    },
                    {
                        label: 'Up Error (dU)',
                        data: up,
                        borderColor: '#8b5cf6',
                        backgroundColor: 'rgba(139, 92, 246, 0.05)',
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0.1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            color: chartDefaults.textColor,
                            boxWidth: 20,
                            font: { family: chartDefaults.fontFamily, size: 12 }
                        }
                    },
                    tooltip: {
                        backgroundColor: chartDefaults.tooltipBg,
                        borderColor: chartDefaults.tooltipBorder,
                        borderWidth: 1,
                        titleColor: chartDefaults.tooltipTitleColor,
                        bodyColor: chartDefaults.textColor
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: chartDefaults.textColor, font: { size: 11 }, maxTicksLimit: 12 }
                    },
                    y: {
                        title: { display: true, text: 'Error (meters)', color: chartDefaults.textColor, font: { size: 12 } },
                        grid: { color: chartDefaults.gridColor },
                        ticks: { color: chartDefaults.textColor, font: { size: 11 } }
                    }
                }
            }
        };
    } else if (chartType === 'roti') {
        titleElement.textContent = `Ionospheric Rate of TEC Index (ROTI): ${stationName}`;
        infoElement.innerHTML = `<i data-lucide="alert-triangle"></i><span>ROTI values above 0.5 TECU/min indicate moderate ionospheric irregularities. Values above 1.0 TECU/min indicate severe irregularities.</span>`;
        infoElement.className = "chart-info-box warning-box";
        infoElement.style.display = 'flex';
        
        const s4Data = sortedData.map(d => d.s4_index);
        const s4BandsPlugin = {
            id: 's4BandsExpanded',
            beforeDraw: (chart) => {
                const { ctx, chartArea, scales: { y } } = chart;
                if (!chartArea) return;
                const drawBand = (startVal, endVal, color) => {
                    const top = y.getPixelForValue(endVal);
                    const bottom = y.getPixelForValue(startVal);
                    ctx.fillStyle = color;
                    ctx.fillRect(chartArea.left, top, chartArea.width, bottom - top);
                };
                drawBand(0.6, 1.0, 'rgba(239, 68, 68, 0.04)');
                drawBand(0.4, 0.6, 'rgba(245, 158, 11, 0.03)');
                drawBand(0.0, 0.4, 'rgba(16, 185, 129, 0.02)');
            }
        };

        config = {
            type: 'line',
            data: {
                labels: timestamps,
                datasets: [{
                    label: 'ROTI',
                    data: s4Data,
                    borderColor: '#f59e0b',
                    backgroundColor: 'rgba(245, 158, 11, 0.1)',
                    borderWidth: 2,
                    pointRadius: 0,
                    fill: true,
                    tension: 0.2
                }]
            },
            plugins: [s4BandsPlugin],
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: chartDefaults.tooltipBg,
                        borderColor: chartDefaults.tooltipBorder,
                        borderWidth: 1,
                        titleColor: chartDefaults.tooltipTitleColor,
                        bodyColor: chartDefaults.textColor
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: chartDefaults.textColor, font: { size: 11 }, maxTicksLimit: 12 }
                    },
                    y: {
                        title: { display: true, text: 'ROTI (TECU/min)', color: chartDefaults.textColor, font: { size: 12 } },
                        grid: { color: chartDefaults.gridColor },
                        ticks: { color: chartDefaults.textColor, font: { size: 11 } },
                        min: 0,
                        suggestedMax: 0.2
                    }
                }
            }
        };
    } else if (chartType === 'vtec') {
        titleElement.textContent = `Vertical Total Electron Content (VTEC): ${stationName}`;
        infoElement.innerHTML = `<i data-lucide="info"></i><span>Diurnal variation displays peak values in mid-afternoon due to solar radiation.</span>`;
        infoElement.className = "chart-info-box info-box";
        infoElement.style.display = 'flex';
        
        const vtecData = sortedData.map(d => d.vtec);

        config = {
            type: 'line',
            data: {
                labels: timestamps,
                datasets: [{
                    label: 'VTEC',
                    data: vtecData,
                    borderColor: '#a78bfa',
                    backgroundColor: 'rgba(139, 92, 246, 0.05)',
                    borderWidth: 2.5,
                    pointRadius: 0,
                    fill: true,
                    tension: 0.1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: chartDefaults.tooltipBg,
                        borderColor: chartDefaults.tooltipBorder,
                        borderWidth: 1,
                        titleColor: chartDefaults.tooltipTitleColor,
                        bodyColor: chartDefaults.textColor
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: chartDefaults.textColor, font: { size: 11 }, maxTicksLimit: 12 }
                    },
                    y: {
                        title: { display: true, text: 'VTEC (TECU)', color: chartDefaults.textColor, font: { size: 12 } },
                        grid: { color: chartDefaults.gridColor },
                        ticks: { color: chartDefaults.textColor, font: { size: 11 } }
                    }
                }
            }
        };
    }

    activeCharts.expanded = new Chart(ctx, config);
    lucide.createIcons();
}
