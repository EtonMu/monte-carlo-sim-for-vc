/* File: docs/app.js */

// --- IMPORTANT: Set your API URL ---
// This is your *live* Render URL.
const API_URL = "https://monte-carlo-sim-for-vc.onrender.com/run_simulation";

// Get references to all UI elements
const runButton = document.getElementById('run-button');
const loadingMessage = document.getElementById('loading-message');
const errorMessage = document.getElementById('error-message');
const metricsOutput = document.getElementById('metrics-output');
const irrPlotDiv = document.getElementById('irr-plot');
const moicPlotDiv = document.getElementById('moic-plot');

// Listen for the button click
runButton.addEventListener('click', async () => {

    // 1. Show loading state & clear old results
    loadingMessage.style.display = 'block';
    errorMessage.style.display = 'none';
    metricsOutput.textContent = '';
    Plotly.purge(irrPlotDiv); // Clear old plots
    Plotly.purge(moicPlotDiv);

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
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(inputData)
        });

        const results = await response.json();

        if (!response.ok) {
            // Show an error if the API returned one (e.g., 400 or 500)
            throw new Error(results.error || "An unknown error occurred");
        }

        // 4. Render the results

        // --- Render Metrics ---
        // This logic now handles the section headers from your Python script
        let metricsText = "";
        for (const [key, value] of Object.entries(results.metrics)) {
            if (typeof value === 'string' && value === "") {
                metricsText += `\n${key}\n`;
            } else if (typeof value === 'string') {
                metricsText += `${key.padEnd(32)}: ${value}\n`;
            } else if (key.includes("IRR") || key.includes("P(")) {
                metricsText += `${key.padEnd(32)}: ${(value * 100).toFixed(2)}%\n`;
            } else if (key.includes("MOIC")) {
                metricsText += `${key.padEnd(32)}: ${value.toFixed(2)}x\n`;
            } else if (key.includes("Val") || key.includes("Proceeds")) {
                metricsText += `${key.padEnd(32)}: $${Math.round(value).toLocaleString()}\n`;
            } else {
                metricsText += `${key.padEnd(32)}: ${value.toFixed(2)}\n`;
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

        // --- Render MOIC Plot (Log Scale Histogram) ---
        const moicTrace = {
            x: results.plot_data_moic.filter(m => m > 0.01), // Filter for log scale
            type: 'histogram',
            name: 'MOIC',
            marker: { color: '#28a745' }
        };
        const moicLayout = {
            title: 'MOIC Distribution (Log Scale)',
            xaxis: {
                title: 'MOIC (Log Scale, > 0.01x)',
                type: 'log' // Set log scale
            },
            yaxis: { title: 'Frequency' },
            bargap: 0.05
        };
        Plotly.newPlot(moicPlotDiv, [moicTrace], moicLayout);

    } catch (error) {
        // Show any network or API errors
        errorMessage.textContent = `Error: ${error.message}`;
        errorMessage.style.display = 'block';
    } finally {
        // 5. Hide loading state
        loadingMessage.style.display = 'none';
    }
});