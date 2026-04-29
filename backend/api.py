# File: backend/api.py

import math
import copy
from flask import Flask, request, jsonify
from flask_cors import CORS
import numpy as np
import traceback

# Import Your Engine
from simulation_core_v1_1 import run_simulation, calculate_metrics

app = Flask(__name__)
app.json.sort_keys = False  # Preserve metrics dict insertion order
CORS(app)


# =====================================================================
# Shared parameter assembly
# =====================================================================
# Both /run_simulation and /run_sensitivity start from the same flat
# JSON shape, so we factor the assembly out into one helper. It returns
# (deal_inputs, stochastic_params, num_simulations) ready to feed into
# run_simulation().

def _build_params(data):
    """Convert flat user-input JSON into the nested dictionaries
    that simulation_core_v1_1.run_simulation expects."""

    # --- Trimodal Risk Inputs ---
    failure_rate_pct = float(data.get('failure_rate_pct', 0))
    zombie_rate_pct = float(data.get('zombie_rate_pct', 0))
    rec_min = float(data.get('rec_min', 0))
    rec_mode = float(data.get('rec_mode', 0))
    rec_max = float(data.get('rec_max', 0))

    # --- "Success" Path Inputs ---
    initial_investment = float(data.get('initial_investment', 0))
    val_min = float(data.get('val_min', 0))
    val_mode = float(data.get('val_mode', 0))
    val_max = float(data.get('val_max', 0))
    tam_min_p10 = float(data.get('tam_min_p10', 0))
    tam_max_p90 = float(data.get('tam_max_p90', 0))
    time_min = float(data.get('time_min', 0))
    time_mode = float(data.get('time_mode', 0))
    time_max = float(data.get('time_max', 0))
    ms_min_p10_pct = float(data.get('ms_min_p10_pct', 0))
    ms_max_p90_pct = float(data.get('ms_max_p90_pct', 0))
    q1_mult = float(data.get('q1_mult', 0))
    median_mult = float(data.get('median_mult', 0))
    q3_mult = float(data.get('q3_mult', 0))
    rounds_min = int(data.get('rounds_min', 0))
    rounds_max = int(data.get('rounds_max', 0))
    dil_min = float(data.get('dil_min', 0))
    dil_mode = float(data.get('dil_mode', 0))
    dil_max = float(data.get('dil_max', 0))
    num_simulations = int(data.get('num_simulations', 100_000))

    # --- Validation ---
    if (failure_rate_pct + zombie_rate_pct) > 100:
        raise ValueError("Sum of Failure Rate and Zombie Rate cannot exceed 100%.")
    if not (rec_min <= rec_mode <= rec_max):
        raise ValueError("Recovery on Zombie is illogical: Min <= Mode <= Max.")
    if not (val_min <= val_mode <= val_max):
        raise ValueError("Post-Money Valuation is illogical: Min <= Mode <= Max.")
    if not (tam_min_p10 < tam_max_p90):
        raise ValueError("TAM is illogical: Min (P10) must be < Max (P90).")
    if ms_min_p10_pct <= 0 or ms_max_p90_pct <= 0:
        raise ValueError("Market Share percentiles must be strictly positive.")

    # --- LOGNORMAL PARAMETERIZATION ---
    Z_90 = 1.28155
    Z_75 = 0.6745

    log_p10_tam = math.log(tam_min_p10)
    log_p90_tam = math.log(tam_max_p90)
    mu_tam = (log_p90_tam + log_p10_tam) / 2
    sigma_tam = (log_p90_tam - log_p10_tam) / (2 * Z_90)

    ms_min_p10 = ms_min_p10_pct / 100.0
    ms_max_p90 = ms_max_p90_pct / 100.0
    log_p10_share = math.log(ms_min_p10)
    log_p90_share = math.log(ms_max_p90)
    mu_share = (log_p90_share + log_p10_share) / 2
    sigma_share = (log_p90_share - log_p10_share) / (2 * Z_90)

    mu_mult = math.log(median_mult)
    if q3_mult <= median_mult or q1_mult <= 0:
        sigma_mult = 0
    else:
        sigma_mult = (math.log(q3_mult) - mu_mult) / Z_75

    deal_inputs = {
        'initial_investment': initial_investment
    }

    stochastic_params = {
        'trimodal_risk': {
            'failure_rate': failure_rate_pct / 100.0,
            'zombie_rate': zombie_rate_pct / 100.0
        },
        'recovery_on_zombie': {
            'min': rec_min,
            'mode': rec_mode,
            'max': rec_max
        },
        'post_money_val_cap': {'min': val_min, 'mode': val_mode, 'max': val_max},
        'time_to_exit_yrs': {'min': time_min, 'mode': time_mode, 'max': time_max},
        'num_future_rounds': {'min': rounds_min, 'max': rounds_max},
        'dilution_per_round': {
            'min': dil_min / 100.0,
            'mode': dil_mode / 100.0,
            'max': dil_max / 100.0
        },
        'tam_lognormal': {'mu': mu_tam, 'sigma': sigma_tam},
        'market_share_lognormal': {'mu': mu_share, 'sigma': sigma_share},
        'exit_multiple_lognormal': {'mu': mu_mult, 'sigma': sigma_mult},

        # Original Inputs (for display/reporting, optional but good to keep)
        'tam_inputs': {'min': tam_min_p10, 'max': tam_max_p90},
        'market_share_inputs': {'min': ms_min_p10, 'max': ms_max_p90},
        'exit_multiple_inputs': {'q1': q1_mult, 'median': median_mult, 'q3': q3_mult}
    }

    return deal_inputs, stochastic_params, num_simulations


def _asymmetry_score(metrics):
    """Pull asymmetry score out of the metrics dict, treating
    inf / NaN as a large finite number so the tornado plot doesn't blow up."""
    raw = metrics.get("Asymmetry Score (E+ / |E-|)", 0.0)
    try:
        f = float(raw)
    except (TypeError, ValueError):
        return 0.0
    if not math.isfinite(f):
        return 999.0  # cap so the tornado renders sensibly
    return f


# =====================================================================
# Main simulation endpoint
# =====================================================================

@app.route("/run_simulation", methods=["POST"])
def handle_simulation():
    try:
        data = request.json
        if not data:
            return jsonify({"error": "No input data provided"}), 400

        try:
            deal_inputs, stochastic_params, num_simulations = _build_params(data)
        except ValueError as ve:
            return jsonify({"error": str(ve)}), 400

        simulation_results = run_simulation(
            deal_inputs,
            stochastic_params,
            num_simulations=num_simulations
        )
        summary_metrics = calculate_metrics(simulation_results, deal_inputs)

        plot_data_irr = simulation_results['IRR'].tolist()
        plot_data_moic = simulation_results['MOIC'].tolist()
        plot_data_path = simulation_results['Path'].astype(int).tolist()

        return jsonify({
            "metrics": summary_metrics,
            "plot_data_irr": plot_data_irr,
            "plot_data_moic": plot_data_moic,
            "plot_data_path": plot_data_path
        })

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": f"Server-side error: {str(e)}"}), 500


# =====================================================================
# Sensitivity / tornado endpoint
# =====================================================================
# For each "input group" we shift all of its fields by ±20% (relative)
# — except Failure Rate / Zombie Rate, which are absolute probabilities
# and get shifted by ±10 percentage points instead.
#
# To keep latency manageable on a free-tier server, we use a smaller
# simulation count (default 25k) than the main run.

_SENSITIVITY_GROUPS_RELATIVE = [
    ('Recovery (Zombie)',  ['rec_min', 'rec_mode', 'rec_max']),
    ('Initial Investment', ['initial_investment']),
    ('Post-Money Val',     ['val_min', 'val_mode', 'val_max']),
    ('TAM',                ['tam_min_p10', 'tam_max_p90']),
    ('Market Share',       ['ms_min_p10_pct', 'ms_max_p90_pct']),
    ('Exit Multiple',      ['q1_mult', 'median_mult', 'q3_mult']),
    ('Time to Exit',       ['time_min', 'time_mode', 'time_max']),
    ('Dilution / Round',   ['dil_min', 'dil_mode', 'dil_max']),
]
_SENSITIVITY_GROUPS_ABSOLUTE_PCT = [
    # Shift in absolute percentage points (added/subtracted, not multiplied)
    ('Failure Rate',       ['failure_rate_pct']),
    ('Zombie Rate',        ['zombie_rate_pct']),
]


def _safe_run_score(data_payload):
    """Build params, run simulation, return the asymmetry score.
    Returns None if the perturbed inputs are invalid (so the row
    gets skipped instead of the whole tornado failing)."""
    try:
        deal_inputs, stochastic_params, num_simulations = _build_params(data_payload)
        sim = run_simulation(deal_inputs, stochastic_params, num_simulations=num_simulations)
        metrics = calculate_metrics(sim, deal_inputs)
        return _asymmetry_score(metrics)
    except Exception:
        traceback.print_exc()
        return None


@app.route("/run_sensitivity", methods=["POST"])
def handle_sensitivity():
    try:
        data = request.json
        if not data:
            return jsonify({"error": "No input data provided"}), 400

        # Reduce simulation count for speed during sensitivity sweeps
        baseline = copy.deepcopy(data)
        sens_sims = int(data.get('sensitivity_sims', 25_000))
        baseline['num_simulations'] = sens_sims

        rel_perturb = float(data.get('relative_perturb_pct', 20)) / 100.0   # ±20% by default
        abs_perturb_pp = float(data.get('absolute_perturb_pp', 10))         # ±10pp by default

        baseline_score = _safe_run_score(baseline)
        if baseline_score is None:
            return jsonify({"error": "Baseline simulation failed; check your inputs."}), 400

        results = []

        # --- Relative groups (multiplicative ±X%) ---
        for label, fields in _SENSITIVITY_GROUPS_RELATIVE:
            up = copy.deepcopy(baseline)
            down = copy.deepcopy(baseline)
            for f in fields:
                base_v = float(up.get(f, 0))
                up[f]   = base_v * (1.0 + rel_perturb)
                down[f] = base_v * (1.0 - rel_perturb)
            up_score = _safe_run_score(up)
            down_score = _safe_run_score(down)
            results.append({
                'name': label,
                'up_score':   up_score   if up_score   is not None else baseline_score,
                'down_score': down_score if down_score is not None else baseline_score,
                'shift_label': f'±{int(rel_perturb * 100)}%'
            })

        # --- Absolute percentage-point groups ---
        for label, fields in _SENSITIVITY_GROUPS_ABSOLUTE_PCT:
            up = copy.deepcopy(baseline)
            down = copy.deepcopy(baseline)
            for f in fields:
                base_v = float(up.get(f, 0))
                up[f]   = max(0.0, min(95.0, base_v + abs_perturb_pp))
                down[f] = max(0.0, min(95.0, base_v - abs_perturb_pp))
            up_score = _safe_run_score(up)
            down_score = _safe_run_score(down)
            results.append({
                'name': label,
                'up_score':   up_score   if up_score   is not None else baseline_score,
                'down_score': down_score if down_score is not None else baseline_score,
                'shift_label': f'±{int(abs_perturb_pp)}pp'
            })

        return jsonify({
            'baseline': baseline_score,
            'results': results,
            'sensitivity_sims': sens_sims,
            'relative_perturb_pct': rel_perturb * 100,
            'absolute_perturb_pp': abs_perturb_pp
        })

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": f"Server-side error: {str(e)}"}), 500


if __name__ == "__main__":
    app.run(debug=True, port=5000)
