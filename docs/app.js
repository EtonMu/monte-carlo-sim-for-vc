/* File: docs/app.js */

// --- IMPORTANT: Set your API URL ---
const API_URL = "https://monte-carlo-sim-for-vc.onrender.com/run_simulation";

// Get references to all UI elements
const runButton = document.getElementById('run-button');
const loadingMessage = document.getElementById('loading-message');
const errorMessage = document.getElementById('error-message');
const metricsOutput = document.getElementById('metrics-output');
const irrPlotDiv = document.getElementById('irr-plot');
const moicPlotDiv = document.getElementById('moic-plot');

// --- Helper: Download a Plotly chart as PNG ---
function downloadChart(plotDiv, filename) {
    Plotly.toImage(plotDiv, { format: 'png', width: 1200, height: 700, scale: 2 })
        .then(function (dataUrl) {
            const a = document.createElement('a');
            a.href = dataUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        });
}

// Listen for the button click
runButton.addEventListener('click', async () => {

    // 1. Show loading state & clear old results
    loadingMessage.style.display = 'block';
    errorMessage.style.display = 'none';
    metricsOutput.textContent = '';
    Plotly.purge(irrPlotDiv);
    Plotly.purge(moicPlotDiv);

    // Hide download buttons while loading
    document.getElementById('download-irr').style.display = 'none';
    document.getElementById('download-moic').style.display = 'none';

    try {
        // 2. Gather ALL inputs from the form
        const inputData = {
            // Trimodal Risk
            failure_rate_pct: parseFloat(document.getElementById('failure-rate').value),
            zombie_rate_pct: parseFloat(document.getElementById('zombie-rate').value),
            rec_min: parseFloat(document.getElementById('rec-min').value),
            rec_mode: parseFloat(document.getElementById('rec-mode').value),
            rec_max: parseFloat(document.getElementById('rec-max').value),

            // Deal Inputs
            initial_investment: parseFloat(document.getElementById('investment').value),
            val_min: parseFloat(document.getElementById('val-min').value),
            val_mode: parseFloat(document.getElementById('val-mode').value),
            val_max: parseFloat(document.getElementById('val-max').value),

            // Market & Exit
            tam_min_p10: parseFloat(document.getElementById('tam-min').value),
            tam_max_p90: parseFloat(document.getElementById('tam-max').value),
            ms_min_p10_pct: parseFloat(document.getElementById('ms-min').value),
            ms_max_p90_pct: parseFloat(document.getElementById('ms-max').value),
            q1_mult: parseFloat(document.getElementById('mult-q1').value),
            median_mult: parseFloat(document.getElementById('mult-median').value),
            q3_mult: parseFloat(document.getElementById('mult-q3').value),

            // Timing & Dilution
            time_min: parseFloat(document.getElementById('time-min').value),
            time_mode: parseFloat(document.getElementById('time-mode').value),
            time_max: parseFloat(document.getElementById('time-max').value),
            rounds_min: parseInt(document.getElementById('rounds-min').value),
            rounds_max: parseInt(document.getElementById('rounds-max').value),
            dil_min: parseFloat(document.getElementById('dil-min').value),
            dil_mode: parseFloat(document.getElementById('dil-mode').value),
            dil_max: parseFloat(document.getElementById('dil-max').value),

            // Sim Settings
            num_simulations: parseInt(document.getElementById('num-sims').value)
        };

        // 3. Send the data to your Flask API
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(inputData)
        });

        const results = await response.json();

        if (!response.ok) {
            throw new Error(results.error || "An unknown error occurred");
        }

        // 4. Render the results

        // --- Render Metrics ---
        const PAD = 45;
        let metricsText = "";
        for (const [key, value] of Object.entries(results.metrics)) {
            if (typeof value === 'string' && value === "") {
                metricsText += `\n${key}\n`;
            } else if (typeof value === 'string') {
                metricsText += `  ${key.padEnd(PAD)}: ${value}\n`;
            } else if (key.includes("IRR") || key.includes("P(")) {
                metricsText += `  ${key.padEnd(PAD)}: ${(value * 100).toFixed(2)}%\n`;
            } else if (key.includes("MOIC")) {
                metricsText += `  ${key.padEnd(PAD)}: ${value.toFixed(2)}x\n`;
            } else if (key.includes("Valuation") || key.includes("Proceeds") || key.includes("Post-Money Val") || key.includes("TAM (Success)")) {
                metricsText += `  ${key.padEnd(PAD)}: $${Math.round(value).toLocaleString()}\n`;
            } else if (key.includes("Ownership")) {
                metricsText += `  ${key.padEnd(PAD)}: ${(value * 100).toFixed(4)}%\n`;
            } else if (key.includes("Market Share")) {
                metricsText += `  ${key.padEnd(PAD)}: ${(value * 100).toFixed(3)}%\n`;
            } else {
                metricsText += `  ${key.padEnd(PAD)}: ${value.toFixed(2)}\n`;
            }
        }
        metricsOutput.textContent = metricsText.trim();

        // --- Render IRR Plot (Histogram) ---
        const irrTrace = {
            x: results.plot_data_irr,
            type: 'histogram',
            nbinsx: 100,
            name: 'IRR',
            marker: { color: '#007bff' }
        };
        const irrLayout = {
            title: 'IRR Distribution',
            xaxis: { title: 'IRR', tickformat: '.0%' },
            yaxis: { title: 'Frequency' },
            bargap: 0.05
        };
        Plotly.newPlot(irrPlotDiv, [irrTrace], irrLayout);

        // --- Render MOIC Plot (Log-Transformed Histogram) ---
        // Plotly's histogram + log x-axis has known binning issues.
        // Instead, compute log10(MOIC) and plot as a regular histogram,
        // then relabel the x-axis ticks to show original MOIC values.
        const moicPositive = results.plot_data_moic.filter(m => m > 0);
        const failureCount = results.plot_data_moic.filter(m => m <= 0).length;
        const logMoic = moicPositive.map(m => Math.log10(m));

        const moicTrace = {
            x: logMoic,
            type: 'histogram',
            nbinsx: 80,
            name: 'MOIC (non-zero)',
            marker: { color: '#28a745' }
        };

        // Build tick values from 0.01x to 10000x in log10 steps
        const tickVals = [-2, -1, 0, 0.477, 1, 1.477, 2, 3, 4];
        const tickText = ['0.01x', '0.1x', '1x', '3x', '10x', '30x', '100x', '1,000x', '10,000x'];

        const moicLayout = {
            title: `MOIC Distribution (${failureCount.toLocaleString()} failures at 0x not shown)`,
            xaxis: {
                title: 'MOIC',
                tickvals: tickVals,
                ticktext: tickText
            },
            yaxis: { title: 'Frequency' },
            bargap: 0.05,
            shapes: [{
                type: 'line',
                x0: 0, x1: 0,
                y0: 0, y1: 1,
                yref: 'paper',
                line: { color: 'red', width: 2, dash: 'dash' }
            }],
            annotations: [{
                x: 0,
                y: 1.02,
                yref: 'paper',
                text: 'Break-even (1x)',
                showarrow: false,
                font: { color: 'red', size: 11 }
            }]
        };
        Plotly.newPlot(moicPlotDiv, [moicTrace], moicLayout);

        // Show download buttons
        document.getElementById('download-irr').style.display = 'inline-block';
        document.getElementById('download-moic').style.display = 'inline-block';

    } catch (error) {
        errorMessage.textContent = `Error: ${error.message}`;
        errorMessage.style.display = 'block';
    } finally {
        loadingMessage.style.display = 'none';
    }
});

// --- Download button listeners ---
document.getElementById('download-irr').addEventListener('click', () => {
    downloadChart(irrPlotDiv, 'IRR_Distribution.png');
});
document.getElementById('download-moic').addEventListener('click', () => {
    downloadChart(moicPlotDiv, 'MOIC_Distribution.png');
});
