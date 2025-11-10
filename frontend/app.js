// File: frontend/app.js

// --- IMPORTANT: Set your API URL ---
// For local testing:
// const API_URL = "http://127.0.0.1:5000/run_simulation";
// After deploying (see Phase 3):
const API_URL = "https://your-app-name.onrender.com/run_simulation"; // <-- You will change this

// Get references to all the UI elements
const runButton = document.getElementById('run-button');
const loadingMessage = document.getElementById('loading-message');
const errorMessage = document.getElementById('error-message');
const metricsOutput = document.getElementById('metrics-output');
const irrPlotDiv = document.getElementById('irr-plot');
const moicPlotDiv = document.getElementById('moic-plot');

// Listen for the button click
runButton.addEventListener('click', async () => {

    // 1. Show loading state
    loadingMessage.style.display = 'block';
    errorMessage.style.display = 'none';
    metricsOutput.textContent = '';
    Plotly.purge(irrPlotDiv); // Clear old plots
    Plotly.purge(moicPlotDiv);

    try {
        // 2. Gather all inputs from the form
        // (This MUST match what your API expects)
        const inputData = {
            failure_rate_pct: parseFloat(document.getElementById('failure-rate').value),
            zombie_rate_pct: parseFloat(document.getElementById('zombie-rate').value),
            initial_investment: parseFloat(document.getElementById('investment').value),
            num_simulations: parseInt(document.getElementById('num-sims').value),
            // ... Get ALL other inputs from their <input> IDs ...
            // e.g., val_min: parseFloat(document.getElementById('val-min').value),
            // ... tam_min_p10: parseFloat(document.getElementById('tam-min').value),
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
            // Show an error if the API returned one
            throw new Error(results.error || "An unknown error occurred");
        }

        // 4. Render the results

        // --- Render Metrics ---
        // (This formats the metrics JSON for display)
        let metricsText = "--- Simulation Metrics ---\n\n";
        for (const [key, value] of Object.entries(results.metrics)) {
            if (typeof value === 'string') {
                metricsText += `${key}\n`; // For headers
            } else {
                // You can add more formatting here if you like
                metricsText += `${key.padEnd(32)}: ${value.toFixed(2)}\n`;
            }
        }
        metricsOutput.textContent = metricsText;

        // --- Render IRR Plot (using Plotly.js) ---
        const irrTrace = {
            x: results.plot_data_irr,
            type: 'histogram',
            nbinsx: 100,
            name: 'IRR',
        };
        const irrLayout = {
            title: 'IRR Distribution',
            xaxis: { title: 'IRR' },
            yaxis: { title: 'Frequency' }
        };
        Plotly.newPlot(irrPlotDiv, [irrTrace], irrLayout);

        // --- Render MOIC Plot (using Plotly.js) ---
        // (You can create the log-scale plot here)
        const moicTrace = {
            x: results.plot_data_moic.filter(m => m > 0.01), // Filter for log
            type: 'histogram',
            name: 'MOIC',
        };
        const moicLayout = {
            title: 'MOIC Distribution (Log Scale)',
            xaxis: {
                title: 'MOIC (Log)',
                type: 'log' // Set log scale
            },
            yaxis: { title: 'Frequency' }
        };
        Plotly.newPlot(moicPlotDiv, [moicTrace], moicLayout);

    } catch (error) {
        // Show any errors
        errorMessage.textContent = `Error: ${error.message}`;
        errorMessage.style.display = 'block';
    } finally {
        // 5. Hide loading state
        loadingMessage.style.display = 'none';
    }
});