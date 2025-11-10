# File: backend/api.py

import math
from flask import Flask, request, jsonify
from flask_cors import CORS
import numpy as np  # Keep numpy for np.isinf
import traceback  # To help debug

# --- Import Your Engine ---
# Note: In your original gui_app.py, you imported from ".simulation_core_v1_1"
# Because we are in the same folder, we just import the file name.
from simulation_core_v1_1 import run_simulation, calculate_metrics

app = Flask(__name__)
# --- IMPORTANT: Enable CORS ---
# This allows your frontend (on github.io) to make requests to your backend (on render.com)
CORS(app)


@app.route("/run_simulation", methods=["POST"])
def handle_simulation():
    try:
        # 1. Get all the inputs from the user's web request
        data = request.json

        # 2. Re-create the validation & parameter logic from your old gui_app.py
        # This part is CRITICAL. You are moving the logic from your old
        # "run_model" function into this API endpoint.

        # --- Gather Inputs (Example) ---
        failure_rate_pct = float(data.get('failure_rate_pct', 0))
        zombie_rate_pct = float(data.get('zombie_rate_pct', 0))
        # ... get ALL other inputs from the 'data' dictionary ...
        initial_investment = float(data.get('initial_investment', 0))
        val_min = float(data.get('val_min', 0))
        val_mode = float(data.get('val_mode', 0))
        # ... etc. ...

        # (You MUST include your validation logic here)
        if (failure_rate_pct + zombie_rate_pct) > 100:
            return jsonify({"error": "Failure + Zombie rate cannot exceed 100%"}), 400

        # --- Lognormal Parameterization (Copied from gui_app.py) ---
        # (You MUST copy all your math.log(), Z_90, mu_tam, etc. logic here)
        # ...
        Z_90 = 1.28155
        Z_75 = 0.6745
        # ...
        # (Assuming you've gathered all inputs)
        tam_min_p10 = float(data.get('tam_min_p10', 0))
        tam_max_p90 = float(data.get('tam_max_p90', 0))
        log_p10_tam = math.log(tam_min_p10)
        # ... (all the other parameterization) ...

        # 3. Assemble Parameter Dictionaries (Copied from gui_app.py)
        # (This section will be identical to your old file)
        deal_inputs = {
            'initial_investment': initial_investment
        }
        stochastic_params = {
            # ... all the nested dictionaries ...
        }
        num_simulations = int(data.get('num_simulations', 100_000))

        # 4. Run the Engine!
        simulation_results = run_simulation(
            deal_inputs,
            stochastic_params,
            num_simulations=num_simulations
        )
        summary_metrics = calculate_metrics(simulation_results, deal_inputs)

        # 5. Prepare Data for JSON Response
        # We can't send the whole DataFrame (it's too big).
        # We send the metrics and *only* the data needed for the plots.
        plot_data_irr = simulation_results['IRR'].tolist()
        plot_data_moic = simulation_results['MOIC'].tolist()

        # 6. Send the data back to the frontend
        return jsonify({
            "metrics": summary_metrics,
            "plot_data_irr": plot_data_irr,
            "plot_data_moic": plot_data_moic
        })

    except Exception as e:
        # Send a detailed error back to the frontend
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    # This is only for local testing, not for production
    app.run(debug=True, port=5000)