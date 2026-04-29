/* File: docs/app.js */

// --- IMPORTANT: Set your API URL ---
const API_URL = "https://monte-carlo-sim-for-vc.onrender.com/run_simulation";
const SENSITIVITY_URL = "https://monte-carlo-sim-for-vc.onrender.com/run_sensitivity";

// === DOM references ===
const runButton           = document.getElementById('run-button');
const saveAsAButton       = document.getElementById('save-as-a');
const saveAsBButton       = document.getElementById('save-as-b');
const compareABButton     = document.getElementById('compare-ab');
const saveJsonButton      = document.getElementById('save-json');
const loadJsonInput       = document.getElementById('load-json');
const runTornadoButton    = document.getElementById('run-tornado');
const statusA             = document.getElementById('status-a');
const statusB             = document.getElementById('status-b');

const loadingMessage      = document.getElementById('loading-message');
const errorMessage        = document.getElementById('error-message');
const metricsOutput       = document.getElementById('metrics-output');
const irrPlotDiv          = document.getElementById('irr-plot');
const moicPlotDiv         = document.getElementById('moic-plot');
const ccdfPlotDiv         = document.getElementById('ccdf-plot');
const tornadoSection      = document.getElementById('tornado-section');
const tornadoPlotDiv      = document.getElementById('tornado-plot');
const compareSection      = document.getElementById('compare-section');
const metricsOutputA      = document.getElementById('metrics-output-a');
const metricsOutputB      = document.getElementById('metrics-output-b');
const compareIrrPlotDiv   = document.getElementById('compare-irr-plot');
const compareMoicPlotDiv  = document.getElementById('compare-moic-plot');

// === In-memory scenario store ===
let scenarioA = null;  // { inputs, results }
let scenarioB = null;

// All numeric form fields. Used by gatherInputs() and applyInputs().
const FIELD_IDS = [
    'failure-rate', 'zombie-rate', 'rec-min', 'rec-mode', 'rec-max',
    'investment', 'val-min', 'val-mode', 'val-max',
    'tam-min', 'tam-max', 'ms-min', 'ms-max',
    'mult-q1', 'mult-median', 'mult-q3',
    'time-min', 'time-mode', 'time-max',
    'rounds-min', 'rounds-max',
    'dil-min', 'dil-mode', 'dil-max',
    'num-sims'
];

// =====================================================================
// LIVE THOUSANDS-SEPARATOR FORMATTING
// =====================================================================
// Inputs marked with data-format="number" are <input type="text"> so they
// can show commas. We format on every keystroke and preserve cursor
// position so typing feels normal.

function formatNumberInput(input) {
    const oldValue = input.value;
    const oldCursor = input.selectionStart || 0;

    // Count digits before the cursor in the old (potentially formatted) value
    let digitsBefore = 0;
    for (let i = 0; i < oldCursor; i++) {
        if (/\d/.test(oldValue[i])) digitsBefore++;
    }

    // Strip everything except digits and a single decimal point
    let cleaned = oldValue.replace(/[^\d.]/g, '');
    // Keep only the first '.' if multiple were typed
    const firstDot = cleaned.indexOf('.');
    if (firstDot !== -1) {
        cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
    }

    if (cleaned === '' || cleaned === '.') {
        input.value = cleaned;
        return;
    }

    const parts = cleaned.split('.');
    const intPart = parts[0] === '' ? '0' : parts[0];
    const decimalPart = parts.length > 1 ? '.' + parts[1] : '';

    const intNum = parseInt(intPart, 10);
    const formatted = (Number.isFinite(intNum) ? intNum.toLocaleString('en-US') : '0') + decimalPart;
    input.value = formatted;

    // Restore cursor — walk forward and stop after the same digit count
    let newCursor = formatted.length;
    if (digitsBefore === 0) {
        newCursor = 0;
    } else {
        let digitsSeen = 0;
        for (let i = 0; i < formatted.length; i++) {
            if (/\d/.test(formatted[i])) {
                digitsSeen++;
                if (digitsSeen === digitsBefore) {
                    newCursor = i + 1;
                    break;
                }
            }
        }
    }
    input.setSelectionRange(newCursor, newCursor);
}

function parseFormattedNumber(value) {
    if (value === null || value === undefined) return NaN;
    const str = String(value).replace(/,/g, '').trim();
    if (str === '') return NaN;
    return parseFloat(str);
}

// Wire up live formatting for every text input flagged as number
document.querySelectorAll('input[data-format="number"]').forEach(el => {
    el.addEventListener('input', () => formatNumberInput(el));
    // Also format the initial default value on load
    formatNumberInput(el);
});

function readFieldValue(id) {
    const el = document.getElementById(id);
    if (!el) return NaN;
    if (el.dataset.format === 'number') return parseFormattedNumber(el.value);
    return parseFloat(el.value);
}

function writeFieldValue(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.dataset.format === 'number' && Number.isFinite(value)) {
        el.value = Number(value).toLocaleString('en-US');
    } else {
        el.value = value;
    }
}

// =====================================================================
// INPUT GATHERING / RESTORATION
// =====================================================================

function gatherInputs() {
    return {
        failure_rate_pct:  readFieldValue('failure-rate'),
        zombie_rate_pct:   readFieldValue('zombie-rate'),
        rec_min:           readFieldValue('rec-min'),
        rec_mode:          readFieldValue('rec-mode'),
        rec_max:           readFieldValue('rec-max'),

        initial_investment: readFieldValue('investment'),
        val_min:            readFieldValue('val-min'),
        val_mode:           readFieldValue('val-mode'),
        val_max:            readFieldValue('val-max'),

        tam_min_p10:        readFieldValue('tam-min'),
        tam_max_p90:        readFieldValue('tam-max'),
        ms_min_p10_pct:     readFieldValue('ms-min'),
        ms_max_p90_pct:     readFieldValue('ms-max'),
        q1_mult:            readFieldValue('mult-q1'),
        median_mult:        readFieldValue('mult-median'),
        q3_mult:            readFieldValue('mult-q3'),

        time_min:           readFieldValue('time-min'),
        time_mode:          readFieldValue('time-mode'),
        time_max:           readFieldValue('time-max'),
        rounds_min:         parseInt(readFieldValue('rounds-min'), 10),
        rounds_max:         parseInt(readFieldValue('rounds-max'), 10),
        dil_min:            readFieldValue('dil-min'),
        dil_mode:           readFieldValue('dil-mode'),
        dil_max:            readFieldValue('dil-max'),

        num_simulations:    parseInt(readFieldValue('num-sims'), 10)
    };
}

// Map between API field names and DOM ids (mostly identical, just
// different separators)
const API_TO_DOM = {
    failure_rate_pct: 'failure-rate',
    zombie_rate_pct:  'zombie-rate',
    rec_min: 'rec-min', rec_mode: 'rec-mode', rec_max: 'rec-max',
    initial_investment: 'investment',
    val_min: 'val-min', val_mode: 'val-mode', val_max: 'val-max',
    tam_min_p10: 'tam-min', tam_max_p90: 'tam-max',
    ms_min_p10_pct: 'ms-min', ms_max_p90_pct: 'ms-max',
    q1_mult: 'mult-q1', median_mult: 'mult-median', q3_mult: 'mult-q3',
    time_min: 'time-min', time_mode: 'time-mode', time_max: 'time-max',
    rounds_min: 'rounds-min', rounds_max: 'rounds-max',
    dil_min: 'dil-min', dil_mode: 'dil-mode', dil_max: 'dil-max',
    num_simulations: 'num-sims'
};

function applyInputs(inputs) {
    Object.entries(API_TO_DOM).forEach(([apiKey, domId]) => {
        if (inputs[apiKey] !== undefined && inputs[apiKey] !== null) {
            writeFieldValue(domId, inputs[apiKey]);
        }
    });
}

// =====================================================================
// METRIC FORMATTING
// =====================================================================

function formatMetrics(metrics) {
    const PAD = 45;
    let out = '';
    for (const [key, value] of Object.entries(metrics)) {
        if (typeof value === 'string' && value === '') {
            out += `\n${key}\n`;
        } else if (typeof value === 'string') {
            out += `  ${key.padEnd(PAD)}: ${value}\n`;
        } else if (key.includes('IRR') || key.includes('P(')) {
            out += `  ${key.padEnd(PAD)}: ${(value * 100).toFixed(2)}%\n`;
        } else if (key.includes('MOIC')) {
            out += `  ${key.padEnd(PAD)}: ${value.toFixed(2)}x\n`;
        } else if (key.includes('Valuation') || key.includes('Proceeds') ||
                   key.includes('Post-Money Val') || key.includes('TAM (Success)')) {
            out += `  ${key.padEnd(PAD)}: $${Math.round(value).toLocaleString()}\n`;
        } else if (key.includes('Ownership')) {
            out += `  ${key.padEnd(PAD)}: ${(value * 100).toFixed(4)}%\n`;
        } else if (key.includes('Market Share')) {
            out += `  ${key.padEnd(PAD)}: ${(value * 100).toFixed(3)}%\n`;
        } else {
            out += `  ${key.padEnd(PAD)}: ${value.toFixed(2)}\n`;
        }
    }
    return out.trim();
}

// =====================================================================
// API CALLS
// =====================================================================

async function runSimulation(inputData) {
    const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inputData)
    });
    const results = await response.json();
    if (!response.ok) throw new Error(results.error || 'Unknown API error');
    return results;
}

async function runSensitivity(inputData) {
    const response = await fetch(SENSITIVITY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inputData)
    });
    const results = await response.json();
    if (!response.ok) throw new Error(results.error || 'Unknown sensitivity error');
    return results;
}

// =====================================================================
// PLOTTING
// =====================================================================

function downloadChart(plotDiv, filename) {
    Plotly.toImage(plotDiv, { format: 'png', width: 1200, height: 700, scale: 2 })
        .then(dataUrl => {
            const a = document.createElement('a');
            a.href = dataUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        });
}

// IRR histogram (single scenario, single trace)
function renderIRRPlot(target, irrData) {
    const trace = {
        x: irrData,
        type: 'histogram',
        nbinsx: 100,
        name: 'IRR',
        marker: { color: '#007bff' }
    };
    const layout = {
        title: 'IRR Distribution',
        xaxis: { title: 'IRR', tickformat: '.0%' },
        yaxis: { title: 'Frequency' },
        bargap: 0.05
    };
    Plotly.newPlot(target, [trace], layout, { responsive: true });
}

// MOIC histogram with 3 stacked path-conditional traces
// (Failure / Zombie / Success on log10 axis)
function renderMOICPlot(target, moicData, pathData) {
    // Split MOIC by path, and only plot positive values (failures sit at 0)
    const failureCount = moicData.filter((m, i) => pathData[i] === 0).length;
    const zombieMoic   = moicData.filter((m, i) => pathData[i] === 1 && m > 0).map(Math.log10);
    const successMoic  = moicData.filter((m, i) => pathData[i] === 2 && m > 0).map(Math.log10);

    const traces = [
        {
            x: zombieMoic,
            type: 'histogram',
            nbinsx: 60,
            name: `Zombie (${zombieMoic.length.toLocaleString()})`,
            marker: { color: '#f0ad4e' },
            opacity: 0.75,
            xbins: { start: -2, end: 4, size: 0.075 }
        },
        {
            x: successMoic,
            type: 'histogram',
            nbinsx: 60,
            name: `Success (${successMoic.length.toLocaleString()})`,
            marker: { color: '#28a745' },
            opacity: 0.75,
            xbins: { start: -2, end: 4, size: 0.075 }
        }
    ];

    const tickVals = [-2, -1, 0, 0.477, 1, 1.477, 2, 3, 4];
    const tickText = ['0.01x', '0.1x', '1x', '3x', '10x', '30x', '100x', '1,000x', '10,000x'];

    const layout = {
        title: `MOIC Distribution by Path (${failureCount.toLocaleString()} failures at 0x not shown)`,
        barmode: 'stack',
        xaxis: { title: 'MOIC (log scale)', tickvals: tickVals, ticktext: tickText },
        yaxis: { title: 'Frequency' },
        bargap: 0.05,
        legend: { orientation: 'h', y: -0.2 },
        shapes: [{
            type: 'line', x0: 0, x1: 0, y0: 0, y1: 1, yref: 'paper',
            line: { color: 'red', width: 2, dash: 'dash' }
        }],
        annotations: [{
            x: 0, y: 1.02, yref: 'paper',
            text: 'Break-even (1x)', showarrow: false,
            font: { color: 'red', size: 11 }
        }]
    };
    Plotly.newPlot(target, traces, layout, { responsive: true });
}

// Empirical CCDF (1 - CDF) on log-log axes. Power-law tails appear linear.
function computeCCDF(values) {
    const positive = values.filter(v => v > 0).sort((a, b) => a - b);
    const n = positive.length;
    if (n === 0) return { x: [], y: [] };
    // Sub-sample for plot speed (don't draw 100k points)
    const step = Math.max(1, Math.floor(n / 600));
    const xs = [];
    const ys = [];
    for (let i = 0; i < n; i += step) {
        xs.push(positive[i]);
        ys.push(1 - i / n);
    }
    // Always include the tail
    xs.push(positive[n - 1]);
    ys.push(1 / n);
    return { x: xs, y: ys };
}

function renderCCDFPlot(target, moicData) {
    const { x, y } = computeCCDF(moicData);
    const trace = {
        x: x,
        y: y,
        mode: 'lines',
        type: 'scatter',
        name: 'P(MOIC ≥ x)',
        line: { color: '#6f42c1', width: 2 }
    };
    const layout = {
        title: 'MOIC Survival Function (CCDF, log-log) — power-law tails appear linear',
        xaxis: { title: 'MOIC (x)', type: 'log', dtick: 1 },
        yaxis: { title: 'P(MOIC ≥ x)', type: 'log' },
        showlegend: false
    };
    Plotly.newPlot(target, [trace], layout, { responsive: true });
}

// Tornado chart of asymmetry-score sensitivity
function renderTornadoPlot(target, baseline, results) {
    // Sort by absolute total swing
    const enriched = results.map(r => {
        const upDelta = (r.up_score - baseline);
        const downDelta = (r.down_score - baseline);
        const swing = Math.max(Math.abs(upDelta), Math.abs(downDelta));
        return { ...r, upDelta, downDelta, swing };
    }).sort((a, b) => a.swing - b.swing);  // ascending — biggest at top in horizontal layout

    const names = enriched.map(r => r.name);
    const upDeltas = enriched.map(r => r.upDelta);
    const downDeltas = enriched.map(r => r.downDelta);

    const traceUp = {
        x: upDeltas,
        y: names,
        type: 'bar',
        orientation: 'h',
        name: '+perturbation',
        marker: { color: '#28a745' },
        text: upDeltas.map(v => v.toFixed(2)),
        textposition: 'outside'
    };
    const traceDown = {
        x: downDeltas,
        y: names,
        type: 'bar',
        orientation: 'h',
        name: '-perturbation',
        marker: { color: '#dc3545' },
        text: downDeltas.map(v => v.toFixed(2)),
        textposition: 'outside'
    };

    const layout = {
        title: `Asymmetry Score Sensitivity (Baseline = ${baseline.toFixed(2)})`,
        barmode: 'overlay',
        xaxis: { title: 'Δ Asymmetry Score' },
        yaxis: { title: '', automargin: true },
        height: Math.max(400, names.length * 40 + 100),
        legend: { orientation: 'h', y: -0.15 },
        shapes: [{ type: 'line', x0: 0, x1: 0, yref: 'paper', y0: 0, y1: 1, line: { color: '#333', width: 1 } }]
    };
    Plotly.newPlot(target, [traceDown, traceUp], layout, { responsive: true });
}

// Render an A/B comparison: two histograms (IRR + MOIC) overlaid
function renderCompareIRR(target, dataA, dataB) {
    const traces = [
        { x: dataA, type: 'histogram', nbinsx: 100, name: 'Scenario A',
          marker: { color: '#007bff' }, opacity: 0.6, histnorm: 'probability' },
        { x: dataB, type: 'histogram', nbinsx: 100, name: 'Scenario B',
          marker: { color: '#dc3545' }, opacity: 0.6, histnorm: 'probability' }
    ];
    const layout = {
        title: 'IRR Distribution — A vs B (normalized)',
        barmode: 'overlay',
        xaxis: { title: 'IRR', tickformat: '.0%' },
        yaxis: { title: 'Probability' },
        legend: { orientation: 'h', y: -0.2 }
    };
    Plotly.newPlot(target, traces, layout, { responsive: true });
}

function renderCompareMOIC(target, dataA, dataB) {
    const logA = dataA.filter(m => m > 0).map(Math.log10);
    const logB = dataB.filter(m => m > 0).map(Math.log10);
    const traces = [
        { x: logA, type: 'histogram', nbinsx: 80, name: 'Scenario A',
          marker: { color: '#007bff' }, opacity: 0.6, histnorm: 'probability',
          xbins: { start: -2, end: 4, size: 0.075 } },
        { x: logB, type: 'histogram', nbinsx: 80, name: 'Scenario B',
          marker: { color: '#dc3545' }, opacity: 0.6, histnorm: 'probability',
          xbins: { start: -2, end: 4, size: 0.075 } }
    ];
    const tickVals = [-2, -1, 0, 0.477, 1, 1.477, 2, 3, 4];
    const tickText = ['0.01x', '0.1x', '1x', '3x', '10x', '30x', '100x', '1,000x', '10,000x'];
    const layout = {
        title: 'MOIC Distribution — A vs B (normalized, log axis, failures at 0x excluded)',
        barmode: 'overlay',
        xaxis: { title: 'MOIC', tickvals: tickVals, ticktext: tickText },
        yaxis: { title: 'Probability' },
        legend: { orientation: 'h', y: -0.2 }
    };
    Plotly.newPlot(target, traces, layout, { responsive: true });
}

// =====================================================================
// MAIN ACTIONS
// =====================================================================

function clearResults() {
    metricsOutput.textContent = '';
    Plotly.purge(irrPlotDiv);
    Plotly.purge(moicPlotDiv);
    Plotly.purge(ccdfPlotDiv);
    document.getElementById('download-irr').style.display = 'none';
    document.getElementById('download-moic').style.display = 'none';
    document.getElementById('download-ccdf').style.display = 'none';
}

function showLoading(msg) {
    loadingMessage.textContent = msg || 'Running simulation... This may take a few seconds.';
    loadingMessage.style.display = 'block';
    errorMessage.style.display = 'none';
}

function hideLoading() {
    loadingMessage.style.display = 'none';
}

function showError(msg) {
    errorMessage.textContent = `Error: ${msg}`;
    errorMessage.style.display = 'block';
}

async function handleRunButton() {
    showLoading();
    clearResults();
    try {
        const inputData = gatherInputs();
        const results = await runSimulation(inputData);

        metricsOutput.textContent = formatMetrics(results.metrics);
        renderIRRPlot(irrPlotDiv, results.plot_data_irr);
        renderMOICPlot(moicPlotDiv, results.plot_data_moic, results.plot_data_path || []);
        renderCCDFPlot(ccdfPlotDiv, results.plot_data_moic);

        document.getElementById('download-irr').style.display = 'inline-block';
        document.getElementById('download-moic').style.display = 'inline-block';
        document.getElementById('download-ccdf').style.display = 'inline-block';
        return { inputData, results };
    } catch (err) {
        showError(err.message);
        return null;
    } finally {
        hideLoading();
    }
}

async function handleSaveScenario(slot) {
    const out = await handleRunButton();
    if (!out) return;
    if (slot === 'A') {
        scenarioA = out;
        statusA.textContent = `saved (${out.results.metrics['Recommendation'] || 'ok'})`;
    } else {
        scenarioB = out;
        statusB.textContent = `saved (${out.results.metrics['Recommendation'] || 'ok'})`;
    }
}

function handleCompareAB() {
    if (!scenarioA || !scenarioB) {
        showError('You need to save both Scenario A and Scenario B first.');
        return;
    }
    errorMessage.style.display = 'none';
    metricsOutputA.textContent = formatMetrics(scenarioA.results.metrics);
    metricsOutputB.textContent = formatMetrics(scenarioB.results.metrics);
    renderCompareIRR(compareIrrPlotDiv,  scenarioA.results.plot_data_irr,  scenarioB.results.plot_data_irr);
    renderCompareMOIC(compareMoicPlotDiv, scenarioA.results.plot_data_moic, scenarioB.results.plot_data_moic);
    compareSection.style.display = 'block';
    compareSection.scrollIntoView({ behavior: 'smooth' });
}

function handleSaveJson() {
    const inputData = gatherInputs();
    const blob = new Blob([JSON.stringify(inputData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mc-vc-scenario.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function handleLoadJson(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        try {
            const parsed = JSON.parse(e.target.result);
            applyInputs(parsed);
            errorMessage.style.display = 'none';
        } catch (err) {
            showError(`Invalid JSON file: ${err.message}`);
        }
    };
    reader.readAsText(file);
    // Clear the input so the same file can be re-selected
    event.target.value = '';
}

async function handleRunTornado() {
    showLoading('Running sensitivity analysis (this hits the API multiple times)...');
    tornadoSection.style.display = 'none';
    try {
        const inputData = gatherInputs();
        // Smaller sim count so tornado finishes in reasonable time
        inputData.sensitivity_sims = Math.min(25000, inputData.num_simulations || 25000);
        const sens = await runSensitivity(inputData);
        renderTornadoPlot(tornadoPlotDiv, sens.baseline, sens.results);
        tornadoSection.style.display = 'block';
        tornadoSection.scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
        showError(err.message);
    } finally {
        hideLoading();
    }
}

// =====================================================================
// EVENT WIRING
// =====================================================================

runButton.addEventListener('click', handleRunButton);
saveAsAButton.addEventListener('click', () => handleSaveScenario('A'));
saveAsBButton.addEventListener('click', () => handleSaveScenario('B'));
compareABButton.addEventListener('click', handleCompareAB);
saveJsonButton.addEventListener('click', handleSaveJson);
loadJsonInput.addEventListener('change', handleLoadJson);
runTornadoButton.addEventListener('click', handleRunTornado);

document.getElementById('download-irr').addEventListener('click',
    () => downloadChart(irrPlotDiv, 'IRR_Distribution.png'));
document.getElementById('download-moic').addEventListener('click',
    () => downloadChart(moicPlotDiv, 'MOIC_Distribution.png'));
document.getElementById('download-ccdf').addEventListener('click',
    () => downloadChart(ccdfPlotDiv, 'MOIC_CCDF.png'));
