# Monte Carlo Simulator for Venture Capital

A Monte Carlo simulator for early-stage VC deal analysis. You enter your assumptions about a deal (valuation, market size, exit multiples, dilution, etc.), it runs tens of thousands of randomized "what-if" trials, and gives you back a distribution of outcomes — IRR, MOIC, and an asymmetry score that summarizes upside vs. downside.

**Live tool:** https://etonmu.github.io/monte-carlo-sim-for-vc/

---

## Table of contents

1. What this tool does (and what it does not do)
2. Methodology in plain English
3. Where to get good input numbers
4. How the code is laid out
5. For successors: how to deploy your own copy
6. Known limitations
7. Sources and references

---

## 1. What this tool does (and what it does not do)

**It does:** Takes one deal at a time and answers the question "if my assumptions are right on average, what does the spread of possible outcomes look like?" It is built to make the asymmetry of VC returns visible — most deals lose money or break even, a small number return a lot — so you can stress-test whether a single deal's upside is worth its downside.

**It does not:**
- Model a portfolio of deals. Each run is one deal. (See "Known limitations.")
- Model liquidation preferences, participating preferred, or capped participation.
- Model follow-on / pro-rata reinvestment.
- Account for correlations between inputs (see Known Limitations).
- Predict the future. Garbage in, garbage out — the quality of the output depends entirely on the quality of the assumptions.

If you want a portfolio simulator or a waterfall calculator, this is the wrong tool today. The roadmap below lists those as future work.

---

## 2. Methodology in plain English

### 2.1 The "three paths" model

Empirically, VC outcomes are not a normal distribution. They look more like three distinct buckets:

1. **Total loss (Failure).** The company shuts down. Investor gets back roughly nothing. MOIC = 0.
2. **Partial recovery (Zombie).** The company sells for parts, gets acqui-hired, or returns a sliver of capital through a small secondary. MOIC is somewhere between 0.1x and ~1x.
3. **Success (Power-law).** The company exits via M&A or IPO at a real valuation. This is the only bucket where the upside lives, and within this bucket the distribution itself is heavy-tailed — most successes are modest, a few are 100x+.

So before each Monte Carlo trial we roll a single die to decide which bucket we're in:

- `Failure rate` — probability of bucket 1 (default 50%, Correlation Ventures-style)
- `Zombie rate` — probability of bucket 2 (default 25%)
- The remainder is Success.

**Why this matters:** If you only used a single lognormal distribution for all outcomes, you'd dramatically underweight the "goose-egg" probability that dominates VC. If you only used a triangular distribution, you'd lose the heavy tail that makes the asset class actually work. The trimodal split keeps both honest.

### 2.2 What happens inside each bucket

**Failure path:** MOIC = 0. Done.

**Zombie path:** MOIC is sampled from a triangular distribution on (`rec_min`, `rec_mode`, `rec_max`). Triangular is appropriate when you have a min/max/most-likely opinion but not enough data to fit a real distribution. Default is (0.1, 0.3, 0.9) — i.e. you generally get back somewhere between 10% and 90% of your money, with 30% being the most likely outcome.

**Success path:** This is the structured one. We compute the exit MOIC bottom-up:

```
Exit Revenue   = TAM × MarketShareAtExit
Exit Valuation = ExitRevenue × ExitMultiple        (EV/Revenue)
Your Ownership = (Investment / PostMoneyValuation) × (1 − DilutionPerRound)^Rounds
Exit Proceeds  = ExitValuation × YourOwnership
MOIC           = ExitProceeds / Investment
```

Then we sample each input from a distribution shaped to the kind of belief you typically have about it:

| Input                  | Distribution      | Why                                                                                        |
|------------------------|-------------------|--------------------------------------------------------------------------------------------|
| Post-Money Valuation   | Triangular        | You usually have a min/likely/max range from the term sheet or comps.                      |
| Time to Exit (years)   | Triangular        | Same: you have a "fastest / typical / slowest" intuition, not a fitted distribution.       |
| TAM ($)                | Lognormal         | TAM estimates have huge uncertainty and are bounded below by zero. Lognormal is standard.  |
| Market Share at Exit   | Lognormal         | Same logic. (Caveat in Limitations: lognormal is unbounded above.)                         |
| Exit Multiple (EV/Rev) | Lognormal         | M&A and IPO multiples are right-skewed and clearly lognormal in any historical dataset.    |
| Number of Rounds       | Discrete uniform  | Simple integer sampling between min and max.                                               |
| Dilution per Round     | Triangular        | Same intuition: a low / typical / high estimate.                                           |

**Lognormal calibration.** You don't enter μ and σ directly. You enter percentiles — for TAM and Market Share you give the 10th and 90th percentiles, for Exit Multiple you give Q1 / median / Q3. The backend then uses standard z-scores to back out the matching lognormal parameters:

- `μ = (ln(P90) + ln(P10)) / 2`
- `σ = (ln(P90) − ln(P10)) / (2 × 1.28155)` for P10/P90 inputs (1.28155 ≈ z₉₀)
- For multiples, σ uses the upper quartile only: `σ = (ln(Q3) − ln(median)) / 0.6745`

This is industry-standard PERT-ish calibration: you give human-readable boundary values, the model translates.

### 2.3 IRR

After we have a MOIC for the run and a holding period, the IRR is just:

```
IRR = MOIC^(1 / HoldingYears) − 1
```

This is a simplified IRR — it assumes a single capital outflow on day zero and a single inflow at exit. No multi-tranche investments, no partial exits.

### 2.4 The Asymmetry Score

VC is a "limited downside, unlimited upside" asset class, so a single mean or median number is misleading. The Asymmetry Score is:

```
E+  = mean IRR of the top decile of runs
E-  = mean IRR of the runs that lose money
Asymmetry Score = E+ / |E-|
```

**Reading it:** A score of 3 means "the average win is 3x the size of the average loss in IRR terms." Anything above 3 is generally favorable. Above 10 is exceptional. The thresholds in the recommendation are heuristic, not calibrated to fund-level benchmarks — treat them as a starting point, not gospel.

### 2.5 The Tornado (sensitivity) chart

The tornado answers "which of my assumptions matters most for the asymmetry score?"

For each input group (TAM, Exit Multiple, Failure Rate, etc.) we shift the whole group by a perturbation:
- Continuous inputs (TAM, valuations, multiples, dilution, time, etc.) — shifted by **±20% relative**.
- Probabilities (Failure Rate, Zombie Rate) — shifted by **±10 percentage points absolute** because multiplying a probability by 1.2 doesn't make intuitive sense.

We re-run the simulation at a reduced sample size (default 25,000) for each up/down perturbation and plot the change in asymmetry score. The longest bars are the inputs to interrogate hardest in due diligence.

### 2.6 The CCDF chart

The CCDF (Complementary Cumulative Distribution Function) plot is a log-log chart of `P(MOIC ≥ x)`. If MOIC is genuinely power-law distributed in the tail, the right side of this chart will look like a straight line. Histograms hide that signal; CCDFs surface it. If your CCDF is curving sharply downward instead of staying linear, you have a thin tail — meaning your inputs are not generating real outlier outcomes.

### 2.7 A/B scenario comparison

Anyone doing this work seriously will end up running the same deal under a "base case" and a "stress case" or "optimistic case." The Save Inputs / Load Inputs buttons let you persist a scenario as JSON, and the "Run & Save as Scenario A" / "Scenario B" buttons store full result sets in memory so you can compare distributions side-by-side without re-typing 25 fields.

---

## 3. Where to get good input numbers

The model is only as good as your inputs. Some recommended sources:

**Paid data platforms (if you have access through your firm or school):**
- **Dealroom** — strong global coverage of fundraising, valuations, and exits.
- **PitchBook** — gold standard for round-by-round valuation data and exit multiples in the US/EU.
- **CB Insights** — failure rates, sector benchmarks, and exit multiples.
- **Preqin / Cambridge Associates** — fund-level vintage benchmarks (mostly relevant for context, not single-deal inputs).

**Free / public:**
- **Crunchbase** (free tier is limited but useful for spot checks)
- **AngelList / Wellfound** (round data, sometimes valuations)
- **SEC EDGAR** for IPO-era exit multiples
- **Damodaran's data pages** at NYU Stern (industry multiples, beta, etc.)

**Using LLMs for research:**
You can use **Gemini Deep Research**, **Claude with web search**, or **ChatGPT Deep Research** to compile market-share / TAM / failure-rate estimates for your sector. Two non-negotiable rules:

1. **Always source-check.** LLMs hallucinate numbers, especially with confidence. Do not paste a TAM figure from a chatbot into the model without finding the original source the model claims to be citing and verifying that the number actually appears there in the form quoted.
2. **Prefer primary sources over LLM summaries** when you find a citation. If the LLM cites a Gartner or McKinsey report, find the report.

**Quick sanity checks for your inputs:**
- If your Failure Rate is below 30%, you're probably modeling a later stage than you think.
- If your P90 Exit Multiple for a SaaS company is above 20x EV/Revenue, ask yourself when 20x SaaS multiples last printed.
- If your Market Share P90 is above 25%, ask whether the company would actually be an industry monopoly, because that's what 25% market share at exit means.
- If your Asymmetry Score comes out >100, you've almost certainly entered something inconsistent (e.g., zero failure rate). Re-check.

---

## 4. How the code is laid out

```
MonteCarloSimForVC/
├── backend/
│   ├── simulation_core_v1_1.py   # Pure numpy/scipy Monte Carlo engine. No web framework.
│   └── api.py                    # Flask wrapper. /run_simulation and /run_sensitivity endpoints.
├── docs/
│   ├── index.html                # Form, charts, and A/B comparison UI.
│   ├── style.css
│   └── app.js                    # Plotly rendering + tornado + CCDF + scenario comparison.
└── README.md
```

**The split is intentional.** `simulation_core_v1_1.py` has zero web dependencies — you can import it from a Jupyter notebook and use it directly. `api.py` only does input validation, parameter assembly, and HTTP. The frontend (`docs/`) is a static site that talks to the backend over REST.

**Frontend → backend wiring** is in `docs/app.js`, the constants `API_URL` and `SENSITIVITY_URL` at the top of the file. Update these if you move the backend.

---

## 5. For successors: how to deploy your own copy

The frontend in `docs/` is currently published via the original author's GitHub Pages, and the backend currently runs on a personal Render service. **The recommended path for a successor is to fork or branch this repo and stand up your own backend** — that way you control the data, the cost, and the uptime.

### 5.1 Backend (Flask)

The backend is a standard Flask app. To run locally:

```bash
cd backend
python -m venv venv
source venv/bin/activate          # on Windows: venv\Scripts\activate
pip install flask flask-cors numpy pandas scipy
python api.py
```

This serves on `http://localhost:5000`.

To deploy publicly, the simplest options are:

- **Render** (what the original author used). Push the repo, create a new Web Service pointing at `backend/`, set the start command to `gunicorn api:app` (you'll want `pip install gunicorn` first and add it to `requirements.txt`).
- **Fly.io / Railway / Heroku** — same shape, all work.
- **A small VM (DigitalOcean, EC2)** behind nginx if you need more control.

Free tiers often "cold start" — the first request after idle takes 30–60 seconds. For interactive use you may want a paid tier.

### 5.2 Frontend (static site)

The frontend is just three static files in `docs/`. To publish your own:

1. Fork this repository under your GitHub account.
2. In your fork, edit `docs/app.js` and change `API_URL` and `SENSITIVITY_URL` to point at your own backend.
3. In your fork's Settings → Pages, set source to the `docs/` folder on the `main` branch.
4. GitHub will publish it at `https://<your-username>.github.io/<repo-name>/`.

### 5.3 What to commit before going live

- A `requirements.txt` in `backend/` (currently absent — add it: `flask`, `flask-cors`, `numpy`, `pandas`, `scipy`, plus `gunicorn` if deploying).
- A `Procfile` or equivalent for your platform.
- Update the `API_URL` constants in `docs/app.js`.

### 5.4 Things you might want to change

- **CORS.** Currently `CORS(app)` allows all origins. Tighten this to only your published frontend domain in production.
- **Random seed.** The simulation core does not seed numpy. If you want reproducibility, add a seed parameter to `run_simulation` and thread it through `api.py`.
- **Recommendation thresholds** in `simulation_core_v1_1.py` (`calculate_metrics`) are hardcoded. If your investor audience uses different cutoffs, change them there.
- **Sensitivity sample size** defaults to 25,000 in the backend. Increase if your server can handle it; the tornado will be more stable.

---

## 6. Known limitations

These are flagged here for honesty and as a roadmap.

- **All inputs are sampled independently.** TAM, market share, exit multiple, and dilution are correlated in real life (high TAM → bigger raises → more dilution; long hold → more rounds; etc.). Independent sampling under-models extreme outcomes in both directions. Fixing this requires a copula or covariance structure.
- **No liquidation preferences.** Real VC term sheets have 1x non-participating, participating preferred, caps, etc. These materially change proceeds in modest exits. The current model treats every Success-path exit as pro-rata-on-fully-diluted, which is optimistic in low-multiple exits and accurate for high-multiple ones.
- **Market share is unbounded above.** Lognormal samples can exceed 100% market share. With sensible inputs this is rare, but it can happen with aggressive assumptions. A truncated lognormal or a Beta distribution would be more correct.
- **Failure / Zombie probabilities are global, not deal-specific.** Better practice is to vary them by stage (seed vs. Series B) or by quality score.
- **No follow-on capital modeled.** The dilution model assumes you don't reinvest in subsequent rounds. Funds that do pro-rata will see different effective ownership.
- **σ for exit multiple uses Q3 only.** The Q1 input is ignored when calibrating the lognormal width. A least-squares fit using both quartiles would be more robust.
- **Single-deal scope.** No portfolio mode. The asymmetry score is illuminating for a single deal but the real story of VC math only emerges at the portfolio level.
- **Recommendation thresholds are heuristic**, not calibrated to empirical fund returns.

---

## 7. Sources and references

The defaults and structural choices in this model draw from:

- **Correlation Ventures** — frequently cited "65% of seed deals return less than 1x" data, which informs the default 50% failure rate / 25% zombie rate split.
- **AngelList** — public reports on the power-law distribution of seed-stage returns; supports the structural choice to model the success path separately.
- **Cambridge Associates** — fund-level VC benchmarks (used for sanity-checking expected portfolio outcomes, though we do not model portfolios here).
- **Aswath Damodaran (NYU Stern)** — industry exit multiples and revenue multiples; useful as a reference distribution for the Exit Multiple input.
- **Pitchbook annual VC outlook reports** — typical valuations, dilution per round, and time-to-exit ranges.
- **Sahlman, "How Venture Capitalists Evaluate Potential Venture Opportunities,"** HBS Note 9-805-019 — the bottom-up TAM × market share × multiple framing on the Success path follows this template.

When you update defaults, document the source and the access date in a comment near the change.

