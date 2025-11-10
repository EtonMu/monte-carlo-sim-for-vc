# File: Model/simulation_core.py
#
# This file contains the "engine" of the simulation.
# It has NO (zero) dependencies on tkinter or matplotlib.
# It only takes data, crunches numbers, and returns data.

import numpy as np
import pandas as pd
import scipy.stats as stats
import math


# --- SIMULATION CORE (TRIMODAL) ---

def run_simulation(deal_inputs, stochastic_params, num_simulations=100_000):
    """
    Runs the Monte Carlo simulation for venture capital returns.

    *** PROVED MECHANISM: TRIMODAL (3-PATH) MIXTURE MODEL ***
    This model separates outcomes into three distinct paths:
    1. Total Loss (Failure): MOIC = 0.0
    2. Low Recovery (Zombie): MOIC = Triangular(0.1, 0.3, 0.9)
    3. Success (Power-Law): MOIC = Full Lognormal diligence model
    """

    # --- 1. Static Calculations ---
    initial_investment = deal_inputs['initial_investment']

    # --- 2. Trimodal Risk Parameters ---
    risk_params = stochastic_params['trimodal_risk']
    failure_rate = risk_params['failure_rate']
    zombie_rate = risk_params['zombie_rate']
    # Success rate is the remainder
    success_rate_threshold = failure_rate + zombie_rate  # e.g., 0.50 + 0.25 = 0.75

    # Generate the "master die roll" that decides the path
    path_switch = stats.uniform(loc=0, scale=1).rvs(num_simulations)

    # --- 3. Generate "Path 2: Zombie" Returns (Vectorized) ---
    rec_params = stochastic_params['recovery_on_zombie']
    rec_loc = rec_params['min']
    rec_scale = rec_params['max'] - rec_params['min']
    rec_c = (rec_params['mode'] - rec_params['min']) / rec_scale if rec_scale > 0 else 0.5
    moic_zombie_path = stats.triang(c=rec_c, loc=rec_loc, scale=rec_scale).rvs(num_simulations)

    # --- 4. Generate "Path 3: Success" Returns (Vectorized) ---
    # This is the entire Lognormal model (same as before)

    # Post-Money Valuation (Triangular)
    val_params = stochastic_params['post_money_val_cap']
    val_loc = val_params['min']
    val_scale = val_params['max'] - val_params['min']
    val_c = (val_params['mode'] - val_params['min']) / val_scale if val_scale > 0 else 0.5
    post_money_valuations = stats.triang(c=val_c, loc=val_loc, scale=val_scale).rvs(num_simulations)

    # Time to Exit (Triangular)
    time_params = stochastic_params['time_to_exit_yrs']
    time_loc = time_params['min']
    time_scale = time_params['max'] - time_params['min']
    time_c = (time_params['mode'] - time_params['min']) / time_scale if time_scale > 0 else 0.5
    holding_periods = stats.triang(c=time_c, loc=time_loc, scale=time_scale).rvs(num_simulations)
    holding_periods = np.maximum(holding_periods, 0.01)  # Avoid divide by zero

    # TAM (Lognormal)
    tam_params = stochastic_params['tam_lognormal']
    tam_samples = stats.lognorm(
        s=tam_params['sigma'],
        scale=math.exp(tam_params['mu'])
    ).rvs(num_simulations)

    # Market Share (Lognormal)
    ms_params = stochastic_params['market_share_lognormal']
    market_shares = stats.lognorm(
        s=ms_params['sigma'],
        scale=math.exp(ms_params['mu'])
    ).rvs(num_simulations)

    # Exit Multiple (Lognormal)
    mult_params = stochastic_params['exit_multiple_lognormal']
    exit_multiples = stats.lognorm(
        s=mult_params['sigma'],
        scale=math.exp(mult_params['mu'])
    ).rvs(num_simulations)

    # Dilution (Triangular/Discrete)
    round_params = stochastic_params['num_future_rounds']
    sampled_num_rounds = stats.randint(
        low=round_params['min'],
        high=round_params['max'] + 1
    ).rvs(num_simulations)

    dil_params = stochastic_params['dilution_per_round']
    dil_loc = dil_params['min']
    dil_scale = dil_params['max'] - dil_params['min']
    dil_c = (dil_params['mode'] - dil_params['min']) / dil_scale if dil_scale > 0 else 0.5
    sampled_dilution_per_round = stats.triang(
        c=dil_c, loc=dil_loc, scale=dil_scale
    ).rvs(num_simulations)

    cumulative_dilution_factor = (1 - sampled_dilution_per_round) ** sampled_num_rounds

    # --- 5. Calculate "Path 3: Success" MOIC ---
    initial_ownership_pct = np.where(
        post_money_valuations > 0,
        initial_investment / post_money_valuations,
        0
    )
    final_ownership_pct = initial_ownership_pct * cumulative_dilution_factor
    exit_revenue = tam_samples * market_shares
    exit_valuation = exit_revenue * exit_multiples
    exit_proceeds = exit_valuation * final_ownership_pct

    moic_success_path = np.where(initial_investment > 0, exit_proceeds / initial_investment, 0)

    # --- 6. Combine All 3 Paths ---
    moic = np.where(
        path_switch < failure_rate,
        0.0,  # Path 1: Total Loss
        np.where(
            path_switch < success_rate_threshold,
            moic_zombie_path,  # Path 2: Zombie
            moic_success_path  # Path 3: Success
        )
    )

    # Calculate final IRR based on the *actual* (trimodal) MOIC
    irr = np.where(
        (moic > 0) & (holding_periods > 0),
        (moic ** (1 / holding_periods)) - 1,
        -1.0  # IRR is -100% for all 0.0 MOIC runs
    )

    # --- 7. Store Results ---
    results_df = pd.DataFrame({
        'IRR': irr,
        'MOIC': moic,
        'HoldingPeriod': holding_periods,
        'ExitValuation': exit_valuation,
        'ExitMultiple': exit_multiples,
        'MarketShare': market_shares,
        'TAM': tam_samples,
        'PostMoneyValuation': post_money_valuations
    })

    return results_df


def calculate_metrics(results_df, deal_inputs):
    """
    Calculates all required summary statistics and asymmetry metrics.
    (*** MODIFIED to include more granular metrics ***)
    """

    # --- IRR Metrics ---
    expected_irr = results_df['IRR'].mean()
    median_irr = results_df['IRR'].median()
    irr_p05 = results_df['IRR'].quantile(0.05)
    irr_p10 = results_df['IRR'].quantile(0.10)
    irr_p25 = results_df['IRR'].quantile(0.25)
    irr_p75 = results_df['IRR'].quantile(0.75)
    irr_p90 = results_df['IRR'].quantile(0.90)
    irr_p95 = results_df['IRR'].quantile(0.95)

    # --- MOIC Metrics ---
    expected_moic = results_df['MOIC'].mean()
    median_moic = results_df['MOIC'].median()
    moic_p10 = results_df['MOIC'].quantile(0.10)
    moic_p25 = results_df['MOIC'].quantile(0.25)
    moic_p75 = results_df['MOIC'].quantile(0.75)
    moic_p90 = results_df['MOIC'].quantile(0.90)

    # --- Probability Metrics ---
    p_moic_lt_0_1 = (results_df['MOIC'] < 0.1).mean()
    p_moic_gte_3 = (results_df['MOIC'] >= 3).mean()
    p_moic_gte_10 = (results_df['MOIC'] >= 10).mean()

    # --- Valuation & Proceeds Metrics ---
    # Note: 'ExitValuation' column is the *success path* valuation
    mean_exit_valuation = results_df['ExitValuation'].mean()
    p25_exit_valuation = results_df['ExitValuation'].quantile(0.25)
    median_exit_valuation = results_df['ExitValuation'].median()
    p75_exit_valuation = results_df['ExitValuation'].quantile(0.75)

    mean_investor_proceeds = results_df['MOIC'].mean() * deal_inputs['initial_investment']
    median_investor_proceeds = results_df['MOIC'].median() * deal_inputs['initial_investment']

    # --- Holding Period Metrics ---
    mean_holding_period = results_df['HoldingPeriod'].mean()
    p25_holding_period = results_df['HoldingPeriod'].quantile(0.25)
    median_holding_period = results_df['HoldingPeriod'].median()
    p75_holding_period = results_df['HoldingPeriod'].quantile(0.75)

    # --- Asymmetry Score (AS) ---
    irr_p90_threshold = results_df['IRR'].quantile(0.90)

    top_10_percent_runs = results_df[results_df['IRR'] >= irr_p90_threshold]
    conditional_upside_e_plus = 0.0
    if not top_10_percent_runs.empty:
        conditional_upside_e_plus = top_10_percent_runs['IRR'].mean()

    losing_runs = results_df[results_df['IRR'] < 0]
    conditional_downside_e_minus = 0.0
    if not losing_runs.empty:
        conditional_downside_e_minus = losing_runs['IRR'].mean()

    asymmetry_score = 0.0
    if conditional_downside_e_minus != 0:
        if np.isinf(conditional_downside_e_minus) or abs(conditional_downside_e_minus) < 1e-9:
            asymmetry_score = np.inf
        else:
            asymmetry_score = conditional_upside_e_plus / abs(conditional_downside_e_minus)

    # --- Recommendation ---
    recommendation = "N/A"
    if losing_runs.empty:
        if conditional_upside_e_plus > 0:
            recommendation = "Strongly Recommend (No Downside Registered)"
        else:
            recommendation = "N/A (No Upside or Downside Registered)"
    elif asymmetry_score > 10:
        recommendation = "Strongly Recommend (Exceptional Asymmetry)"
    elif asymmetry_score > 3:
        recommendation = "Recommend (Favorable Asymmetry)"
    elif asymmetry_score > 1:
        recommendation = "Proceed with Caution (Marginally Favorable)"
    elif asymmetry_score >= 0:
        recommendation = "Not Recommended (Unfavorable Asymmetry)"
    else:
        recommendation = "Not Recommended (Unfavorable Asymmetry)"

    # --- Assemble Final Dictionary ---
    metrics = {
        "--- Central Tendency (IRR) ---": "",
        "Expected IRR (Mean)": expected_irr,
        "Median IRR (50th Pctl)": median_irr,

        "--- IRR Distribution ---": "",
        "5th Percentile IRR": irr_p05,
        "10th Percentile IRR": irr_p10,
        "25th Percentile IRR": irr_p25,
        "75th Percentile IRR": irr_p75,
        "90th Percentile IRR": irr_p90,
        "95th Percentile IRR": irr_p95,

        "--- Central Tendency (MOIC) ---": "",
        "Expected MOIC (Mean)": expected_moic,
        "Median MOIC (50th Pctl)": median_moic,

        "--- MOIC Distribution ---": "",
        "10th Percentile MOIC": moic_p10,
        "25th Percentile MOIC": moic_p25,
        "75th Percentile MOIC": moic_p75,
        "90th Percentile MOIC": moic_p90,

        "--- Probability Metrics ---": "",
        "P(Total Loss, MOIC < 0.1x)": p_moic_lt_0_1,
        "P(MOIC >= 3x)": p_moic_gte_3,
        "P(MOIC >= 10x)": p_moic_gte_10,

        "--- Valuation & Proceeds ---": "",
        "Mean 'Success Path' ExitVal": mean_exit_valuation,
        "25th Pctl 'Success Path' ExitVal": p25_exit_valuation,
        "Median 'Success Path' ExitVal": median_exit_valuation,
        "75th Pctl 'Success Path' ExitVal": p75_exit_valuation,
        "Mean Final Investor Proceeds": mean_investor_proceeds,
        "Median Final Investor Proceeds": median_investor_proceeds,

        "--- Holding Period ---": "",
        "Mean Holding Period": mean_holding_period,
        "25th Pctl Holding Period": p25_holding_period,
        "Median Holding Period": median_holding_period,
        "75th Pctl Holding Period": p75_holding_period,

        "--- Asymmetry Analysis (Doc 2, 7.2) ---": "",
        "Conditional Upside (E+)": conditional_upside_e_plus,
        "Conditional Downside (E-)": conditional_downside_e_minus,
        "Asymmetry Score (E+ / |E-|)": asymmetry_score,

        "--- Recommendation (Doc 1, 3.3) ---": "",
        "Recommendation": recommendation
    }

    return metrics