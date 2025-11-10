# File: backend/api.py

import math
from flask import Flask, request, jsonify
from flask_cors import CORS
import numpy as np
import traceback

# Import Your Engine
from simulation_core_v1_1 import run_simulation, calculate_metrics

app = Flask(__name__)
CORS(app)


# --- REPLACE YOUR OLD FUNCTION WITH THIS ---
@app.route("/run_simulation", methods=["POST"])
def handle_simulation():
    try:
        # 1. Get all the inputs from the user's web request
        data = request.json
        if not data:
            return jsonify({"error": "No input data provided"}), 400

        # 2. Gather and validate ALL inputs from the 'data' dictionary

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

        # --- Validation Block (Copied from gui_app.py) ---
        if (failure_rate_pct + zombie_rate_pct) > 100:
            return jsonify({"error": "Sum of Failure Rate and Zombie Rate cannot exceed 100%."}), 400
        if not (rec_min <= rec_mode <= rec_max):
            return jsonify({"error": "Recovery on Zombie is illogical: Min <= Mode <= Max."}), 400
        if not (val_min <= val_mode <= val_max):
            return jsonify({"error": "Post-Money Valuation is illogical: Min <= Mode <= Max."}), 400
        if not (tam_min_p10 < tam_max_p90):
            return jsonify({"error": "TAM is illogical: Min (P10) must be < Max (P90)."}), 400
        # (Add any other validation you need)

        # --- 3. LOGNORMAL PARAMETERIZATION (Copied from gui_app.py) ---
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

        # --- 4. Assemble Parameter Dictionaries (THE FIX IS HERE) ---
        # We must create the *exact* nested structure
        # that simulation_core_v1_1.py expects.

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
            'time_to_exit_yrs': {'min': time_min, 'mode': time_mode, 'max': time_max},  # <-- Fixed bug from gui_app
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

        # --- 5. Run Simulation & Analysis ---
        simulation_results = run_simulation(
            deal_inputs,
            stochastic_params,
            num_simulations=num_simulations
        )
        summary_metrics = calculate_metrics(simulation_results, deal_inputs)

        # --- 6. Prepare Data for JSON Response ---
        plot_data_irr = simulation_results['IRR'].tolist()
        plot_data_moic = simulation_results['MOIC'].tolist()

        # 7. Send the data back to the frontend
        return jsonify({
            "metrics": summary_metrics,
            "plot_data_irr": plot_data_irr,
            "plot_data_moic": plot_data_moic
        })

    except Exception as e:
        traceback.print_exc()
        # Return the specific error to the frontend
        return jsonify({"error": f"Server-side error: {str(e)}"}), 500


# --- END OF REPLACED FUNCTION ---

if __name__ == "__main__":
    app.run(debug=True, port=5000)