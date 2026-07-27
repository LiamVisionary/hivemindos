#!/usr/bin/env python3
"""Dependency-free, independent statistical validator for research backtests."""

from __future__ import annotations

import itertools
import json
import math
import random
import statistics
import sys
from typing import Any


TRADING_DAYS = 252.0
EPSILON = 1e-12
REQUIRED_FACTOR_SERIES = ("MKT", "SMB", "HML", "RMW", "CMA", "MOM", "LOW_VOL")


def policy_number(policy: dict[str, Any], key: str, fallback: float) -> float:
    value = policy.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return fallback
    return float(value)


def enforce_policy(value: Any) -> dict[str, float | int]:
    policy = value if isinstance(value, dict) else {}
    return {
        "minObservations": max(252, round(policy_number(policy, "minObservations", 252))),
        "minHacTStat": max(3.0, policy_number(policy, "minHacTStat", 3.0)),
        "maxHacPValue": max(0.0, min(0.01, policy_number(policy, "maxHacPValue", 0.01))),
        "maxFdrQValue": max(0.0, min(0.05, policy_number(policy, "maxFdrQValue", 0.05))),
        "bootstrapIterations": max(10_000, round(policy_number(policy, "bootstrapIterations", 10_000))),
        "bootstrapBlockSize": max(5, round(policy_number(policy, "bootstrapBlockSize", 10))),
        "placeboIterations": max(2_000, round(policy_number(policy, "placeboIterations", 2_000))),
        "maxPlaceboPValue": max(0.0, min(0.05, policy_number(policy, "maxPlaceboPValue", 0.05))),
        "maxOosSharpeDegradation": max(0.0, min(0.30, policy_number(policy, "maxOosSharpeDegradation", 0.30))),
        "maxProbabilityBacktestOverfit": max(0.0, min(0.50, policy_number(policy, "maxProbabilityBacktestOverfit", 0.50))),
        "minPositiveRegimes": max(2, round(policy_number(policy, "minPositiveRegimes", 2))),
        "maxSingleRegimePnlShare": max(0.0, min(0.70, policy_number(policy, "maxSingleRegimePnlShare", 0.70))),
        "minFactorAlphaTStat": max(3.0, policy_number(policy, "minFactorAlphaTStat", 3.0)),
        "hacLags": max(5, round(policy_number(policy, "hacLags", 5))),
        "hmmStates": max(2, min(5, round(policy_number(policy, "hmmStates", 3)))),
        "hmmIterations": max(40, round(policy_number(policy, "hmmIterations", 40))),
        "pboSegments": max(6, round(policy_number(policy, "pboSegments", 8))),
        "metricTolerance": max(0.0, min(1e-8, policy_number(policy, "metricTolerance", 1e-8))),
        "minDeflatedSharpeProbability": min(1.0, max(0.95, policy_number(policy, "minDeflatedSharpeProbability", 0.95))),
        "seed": round(policy_number(policy, "seed", 0)),
    }


def fail(message: str) -> None:
    print(f"quant research validator rejected request: {message}", file=sys.stderr)
    raise SystemExit(2)


def finite_series(value: Any, name: str, *, required: bool = True) -> list[float] | None:
    if (value is None or value == []) and not required:
        return None
    if not isinstance(value, list) or not value:
        fail(f"{name} must be a non-empty numeric array")
    result = []
    for item in value:
        if isinstance(item, bool) or not isinstance(item, (int, float)) or not math.isfinite(item):
            fail(f"{name} contains a non-finite number")
        result.append(float(item))
    return result


def mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def sample_variance(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    center = mean(values)
    return sum((value - center) ** 2 for value in values) / (len(values) - 1)


def sharpe(values: list[float]) -> float:
    variance = sample_variance(values)
    return mean(values) / math.sqrt(variance) * math.sqrt(TRADING_DAYS) if variance > EPSILON else 0.0


def normal_two_sided_p(t_stat: float) -> float:
    return math.erfc(abs(t_stat) / math.sqrt(2.0))


def normal_cdf(value: float) -> float:
    return 0.5 * (1.0 + math.erf(value / math.sqrt(2.0)))


def hac_mean_test(values: list[float], lags: int) -> dict[str, float]:
    count = len(values)
    center = mean(values)
    centered = [value - center for value in values]
    gamma_zero = sum(value * value for value in centered) / count
    long_run_variance = gamma_zero
    for lag in range(1, min(lags, count - 1) + 1):
        weight = 1.0 - lag / (lags + 1.0)
        covariance = sum(centered[index] * centered[index - lag] for index in range(lag, count)) / count
        long_run_variance += 2.0 * weight * covariance
    standard_error = math.sqrt(max(long_run_variance, EPSILON) / count)
    t_stat = center / standard_error
    return {
        "mean": center,
        "standardError": standard_error,
        "longRunVariance": long_run_variance,
        "tStat": t_stat,
        "pValue": normal_two_sided_p(t_stat),
        "lags": min(lags, max(0, count - 1)),
    }


def percentile(values: list[float], probability: float) -> float:
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = probability * (len(ordered) - 1)
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    weight = position - lower
    return ordered[lower] * (1.0 - weight) + ordered[upper] * weight


def circular_block_bootstrap(
    values: list[float], iterations: int, block_size: int, rng: random.Random
) -> dict[str, Any]:
    count = len(values)
    block_size = min(block_size, count)
    block_sums = [
        sum(values[(start + offset) % count] for offset in range(block_size))
        for start in range(count)
    ]
    complete_blocks, remainder = divmod(count, block_size)
    samples = []
    for _ in range(iterations):
        total = sum(block_sums[rng.randrange(count)] for _ in range(complete_blocks))
        if remainder:
            start = rng.randrange(count)
            total += sum(values[(start + offset) % count] for offset in range(remainder))
        samples.append(total / count)
    non_positive = sum(value <= 0.0 for value in samples)
    return {
        "iterations": iterations,
        "blockSize": block_size,
        "meanCi95": [percentile(samples, 0.025), percentile(samples, 0.975)],
        "nonPositiveProbability": non_positive / iterations,
    }


def benjamini_hochberg(candidate_p: float, trial_p_values: list[float]) -> dict[str, Any]:
    values = [candidate_p] + [min(1.0, max(0.0, value)) for value in trial_p_values]
    ordered = sorted(enumerate(values), key=lambda item: item[1])
    adjusted = [1.0] * len(values)
    running = 1.0
    for reverse_index in range(len(ordered) - 1, -1, -1):
        original_index, p_value = ordered[reverse_index]
        rank = reverse_index + 1
        running = min(running, p_value * len(values) / rank)
        adjusted[original_index] = min(1.0, running)
    return {
        "method": "Benjamini-Hochberg",
        "familySize": len(values),
        "candidatePValue": candidate_p,
        "candidateQValue": adjusted[0],
    }


def probability_backtest_overfit(candidate_returns: list[list[float]], segments: int = 8) -> dict[str, Any]:
    if len(candidate_returns) < 2:
        return {"coverage": "missing", "reason": "At least two candidate return series are required."}
    length = len(candidate_returns[0])
    if any(len(values) != length for values in candidate_returns) or length < segments * 4:
        return {"coverage": "missing", "reason": "Aligned candidate histories are required for CSCV."}
    segments = min(segments, length // 4)
    if segments % 2:
        segments -= 1
    if segments < 4:
        return {"coverage": "missing", "reason": "At least four CSCV segments are required."}
    boundaries = [round(index * length / segments) for index in range(segments + 1)]
    segment_rows = [list(range(boundaries[index], boundaries[index + 1])) for index in range(segments)]
    negative_logits = 0
    combinations = 0
    for selected in itertools.combinations(range(segments), segments // 2):
        selected_set = set(selected)
        in_indices = [index for segment in selected for index in segment_rows[segment]]
        out_indices = [
            index
            for segment in range(segments)
            if segment not in selected_set
            for index in segment_rows[segment]
        ]
        in_scores = [sharpe([values[index] for index in in_indices]) for values in candidate_returns]
        selected_candidate = max(range(len(in_scores)), key=lambda index: in_scores[index])
        out_scores = [sharpe([values[index] for index in out_indices]) for values in candidate_returns]
        selected_score = out_scores[selected_candidate]
        ascending_rank = 1 + sum(score < selected_score for score in out_scores)
        relative_rank = ascending_rank / (len(out_scores) + 1.0)
        logit = math.log(relative_rank / (1.0 - relative_rank))
        negative_logits += int(logit <= 0.0)
        combinations += 1
    return {
        "coverage": "complete",
        "method": "combinatorially-symmetric-cross-validation",
        "segments": segments,
        "combinations": combinations,
        "probability": negative_logits / combinations if combinations else 1.0,
    }


def shifted_signal_placebo(
    actual_returns: list[float],
    positions: list[float] | None,
    asset_returns: list[float] | None,
    costs: dict[str, Any],
    iterations: int,
    rng: random.Random,
) -> dict[str, Any]:
    if positions is None or asset_returns is None or len(positions) != len(actual_returns) or len(asset_returns) != len(actual_returns):
        return {"coverage": "missing", "reason": "Aligned positions and assetReturns are required."}
    one_way_cost = (float(costs.get("commissionBps", 0.0)) + float(costs.get("slippageBps", 0.0))) / 10_000.0
    daily_borrow = float(costs.get("annualBorrowBps", 0.0)) / 10_000.0 / TRADING_DAYS
    actual_mean = mean(actual_returns)
    placebo_means = []
    count = len(positions)
    valid_shifts = list(range(1, count))
    for _ in range(iterations):
        shift = valid_shifts[rng.randrange(len(valid_shifts))]
        shifted = positions[-shift:] + positions[:-shift]
        previous = 0.0
        returns = []
        for position, asset_return in zip(shifted, asset_returns):
            transaction_cost = abs(position - previous) * one_way_cost
            borrow_cost = abs(position) * daily_borrow if position < 0.0 else 0.0
            returns.append(position * asset_return - transaction_cost - borrow_cost)
            previous = position
        placebo_means.append(mean(returns))
    exceedances = sum(value >= actual_mean for value in placebo_means)
    return {
        "coverage": "complete",
        "method": "circular-signal-shift",
        "iterations": iterations,
        "actualMean": actual_mean,
        "placeboMeanCi95": [percentile(placebo_means, 0.025), percentile(placebo_means, 0.975)],
        "pValue": (exceedances + 1) / (iterations + 1),
    }


def standardize(values: list[float]) -> list[float]:
    center = mean(values)
    scale = math.sqrt(max(sample_variance(values), EPSILON))
    return [(value - center) / scale for value in values]


def trailing_volatility(values: list[float], window: int = 20) -> list[float]:
    result = []
    for index in range(len(values)):
        sample = values[max(0, index + 1 - window):index + 1]
        result.append(math.sqrt(max(sample_variance(sample), 0.0)))
    return result


def gaussian_density(values: list[float], centers: list[float], variances: list[float]) -> float:
    log_density = 0.0
    for value, center, raw_variance in zip(values, centers, variances):
        variance = max(raw_variance, 1e-8)
        log_density += -0.5 * (
            math.log(2.0 * math.pi * variance)
            + (value - center) ** 2 / variance
        )
    return max(1e-300, math.exp(max(-700.0, min(700.0, log_density))))


def fit_gaussian_hmm(observations: list[list[float]], states: int, iterations: int) -> dict[str, Any]:
    if len(observations) < max(30, states * 8):
        return {"coverage": "missing", "kind": "gaussian-hmm", "reason": "Insufficient market history."}
    dimensions = len(observations[0])
    if dimensions < 2 or any(len(row) != dimensions for row in observations):
        return {"coverage": "missing", "kind": "gaussian-hmm", "reason": "Aligned return and volatility features are required."}
    states = max(2, min(states, 5))
    ordered = sorted(observations, key=lambda row: (row[1], row[0]))
    means = [
        ordered[min(len(ordered) - 1, round((index + 1) * (len(ordered) - 1) / (states + 1)))][:]
        for index in range(states)
    ]
    base_variances = [
        max(sample_variance([row[dimension] for row in observations]), 1e-8)
        for dimension in range(dimensions)
    ]
    variances = [base_variances[:] for _ in range(states)]
    initial = [1.0 / states for _ in range(states)]
    transition = [
        [0.9 if row == column else 0.1 / (states - 1) for column in range(states)]
        for row in range(states)
    ]
    gamma = [[1.0 / states for _ in range(states)] for _ in observations]

    for _ in range(iterations):
        emissions = [
            [gaussian_density(row, means[state], variances[state]) for state in range(states)]
            for row in observations
        ]
        alpha = [[0.0] * states for _ in observations]
        scales = [0.0] * len(observations)
        for state in range(states):
            alpha[0][state] = initial[state] * emissions[0][state]
        scales[0] = max(sum(alpha[0]), EPSILON)
        alpha[0] = [value / scales[0] for value in alpha[0]]
        for time in range(1, len(observations)):
            for state in range(states):
                alpha[time][state] = emissions[time][state] * sum(
                    alpha[time - 1][prior] * transition[prior][state]
                    for prior in range(states)
                )
            scales[time] = max(sum(alpha[time]), EPSILON)
            alpha[time] = [value / scales[time] for value in alpha[time]]

        beta = [[0.0] * states for _ in observations]
        beta[-1] = [1.0] * states
        for time in range(len(observations) - 2, -1, -1):
            for state in range(states):
                beta[time][state] = sum(
                    transition[state][future]
                    * emissions[time + 1][future]
                    * beta[time + 1][future]
                    for future in range(states)
                ) / max(scales[time + 1], EPSILON)

        for time in range(len(observations)):
            denominator = max(sum(alpha[time][state] * beta[time][state] for state in range(states)), EPSILON)
            gamma[time] = [alpha[time][state] * beta[time][state] / denominator for state in range(states)]

        xi_sum = [[0.0] * states for _ in range(states)]
        for time in range(len(observations) - 1):
            denominator = 0.0
            for state in range(states):
                for future in range(states):
                    denominator += (
                        alpha[time][state]
                        * transition[state][future]
                        * emissions[time + 1][future]
                        * beta[time + 1][future]
                    )
            denominator = max(denominator, EPSILON)
            for state in range(states):
                for future in range(states):
                    xi_sum[state][future] += (
                        alpha[time][state]
                        * transition[state][future]
                        * emissions[time + 1][future]
                        * beta[time + 1][future]
                        / denominator
                    )

        initial = gamma[0][:]
        for state in range(states):
            row_total = max(sum(xi_sum[state]), EPSILON)
            transition[state] = [value / row_total for value in xi_sum[state]]
            weight = max(sum(row[state] for row in gamma), EPSILON)
            for dimension in range(dimensions):
                means[state][dimension] = sum(
                    responsibility[state] * observation[dimension]
                    for responsibility, observation in zip(gamma, observations)
                ) / weight
                variances[state][dimension] = max(
                    sum(
                        responsibility[state]
                        * (observation[dimension] - means[state][dimension]) ** 2
                        for responsibility, observation in zip(gamma, observations)
                    ) / weight,
                    1e-8,
                )

    raw_states = [max(range(states), key=lambda state: row[state]) for row in gamma]
    state_order = sorted(range(states), key=lambda state: (means[state][1], means[state][0]))
    remap = {state: rank for rank, state in enumerate(state_order)}
    labels = [remap[state] for state in raw_states]
    return {
        "coverage": "complete",
        "kind": "gaussian-hmm",
        "states": states,
        "iterations": iterations,
        "stateMeans": [means[state] for state in state_order],
        "stateVariances": [variances[state] for state in state_order],
        "labels": labels,
    }


def regime_robustness(strategy_returns: list[float], market_returns: list[float] | None, states: int, iterations: int) -> dict[str, Any]:
    if market_returns is None or len(market_returns) != len(strategy_returns):
        return {"coverage": "missing", "kind": "gaussian-hmm", "reason": "Aligned marketReturns are required."}
    market_volatility = trailing_volatility(market_returns)
    feature_rows = [
        [market_return, volatility]
        for market_return, volatility in zip(
            standardize(market_returns),
            standardize(market_volatility),
        )
    ]
    model = fit_gaussian_hmm(feature_rows, states, iterations)
    model["features"] = ["marketReturn", "trailingVolatility"]
    labels = model.pop("labels", None)
    if model.get("coverage") != "complete" or labels is None:
        return model
    summaries = []
    for state in range(model["states"]):
        values = [value for value, label in zip(strategy_returns, labels) if label == state]
        summaries.append({
            "state": state,
            "observations": len(values),
            "meanReturn": mean(values),
            "cumulativePnl": sum(values),
            "sharpe": sharpe(values),
        })
    absolute_pnl = sum(abs(item["cumulativePnl"]) for item in summaries)
    model["regimes"] = summaries
    model["positiveRegimes"] = sum(item["meanReturn"] > 0.0 for item in summaries if item["observations"])
    model["maxSingleRegimePnlShare"] = (
        max(abs(item["cumulativePnl"]) for item in summaries) / absolute_pnl
        if absolute_pnl > EPSILON else 1.0
    )
    return model


def matrix_inverse(matrix: list[list[float]]) -> list[list[float]]:
    size = len(matrix)
    augmented = [row[:] + [1.0 if row_index == column else 0.0 for column in range(size)] for row_index, row in enumerate(matrix)]
    for column in range(size):
        pivot = max(range(column, size), key=lambda row: abs(augmented[row][column]))
        if abs(augmented[pivot][column]) < EPSILON:
            fail("factor matrix is singular")
        augmented[column], augmented[pivot] = augmented[pivot], augmented[column]
        divisor = augmented[column][column]
        augmented[column] = [value / divisor for value in augmented[column]]
        for row in range(size):
            if row == column:
                continue
            multiplier = augmented[row][column]
            augmented[row] = [
                current - multiplier * pivot_value
                for current, pivot_value in zip(augmented[row], augmented[column])
            ]
    return [row[size:] for row in augmented]


def matrix_multiply(left: list[list[float]], right: list[list[float]]) -> list[list[float]]:
    return [
        [sum(left[row][inner] * right[inner][column] for inner in range(len(right))) for column in range(len(right[0]))]
        for row in range(len(left))
    ]


def factor_alpha_model(returns: list[float], factors: Any, hac_lags: int) -> dict[str, Any]:
    if not isinstance(factors, dict) or not factors:
        return {"coverage": "missing", "reason": "Aligned factorReturns are required."}
    missing = [name for name in REQUIRED_FACTOR_SERIES if name not in factors]
    if missing:
        return {
            "coverage": "missing",
            "reason": f"Factor coverage is missing {', '.join(missing)}.",
        }
    names = sorted(factors)
    columns = []
    for name in names:
        values = finite_series(factors[name], f"factorReturns.{name}")
        if len(values) != len(returns):
            return {"coverage": "missing", "reason": f"Factor {name} is not aligned."}
        columns.append(values)
    design = [[1.0] + [column[index] for column in columns] for index in range(len(returns))]
    width = len(design[0])
    xtx = [[sum(row[left] * row[right] for row in design) for right in range(width)] for left in range(width)]
    for index in range(width):
        xtx[index][index] += 1e-12
    inverse = matrix_inverse(xtx)
    xty = [sum(row[column] * target for row, target in zip(design, returns)) for column in range(width)]
    coefficients = [sum(inverse[row][column] * xty[column] for column in range(width)) for row in range(width)]
    residuals = [target - sum(value * coefficient for value, coefficient in zip(row, coefficients)) for row, target in zip(design, returns)]

    meat = [[0.0] * width for _ in range(width)]
    for time, row in enumerate(design):
        for left in range(width):
            for right in range(width):
                meat[left][right] += residuals[time] ** 2 * row[left] * row[right]
    for lag in range(1, min(hac_lags, len(returns) - 1) + 1):
        weight = 1.0 - lag / (hac_lags + 1.0)
        for time in range(lag, len(returns)):
            current = design[time]
            prior = design[time - lag]
            covariance = residuals[time] * residuals[time - lag] * weight
            for left in range(width):
                for right in range(width):
                    meat[left][right] += covariance * (
                        current[left] * prior[right] + prior[left] * current[right]
                    )
    covariance = matrix_multiply(matrix_multiply(inverse, meat), inverse)
    alpha_standard_error = math.sqrt(max(covariance[0][0], EPSILON))
    alpha_t_stat = coefficients[0] / alpha_standard_error
    return {
        "coverage": "complete",
        "method": "OLS with Newey-West HAC covariance",
        "factorNames": names,
        "alpha": coefficients[0],
        "alphaTStat": alpha_t_stat,
        "alphaPValue": normal_two_sided_p(alpha_t_stat),
        "betas": {name: coefficients[index + 1] for index, name in enumerate(names)},
        "hacLags": min(hac_lags, len(returns) - 1),
    }


def deflated_sharpe(values: list[float], trial_count: int) -> dict[str, float]:
    observed = sharpe(values)
    trial_count = max(1, trial_count)
    null_max = math.sqrt(2.0 * math.log(trial_count)) * math.sqrt(TRADING_DAYS / max(2, len(values) - 1)) if trial_count > 1 else 0.0
    standard_error = math.sqrt(TRADING_DAYS / max(2, len(values) - 1))
    probability = normal_cdf((observed - null_max) / max(standard_error, EPSILON))
    return {"observedSharpe": observed, "nullMaxSharpe": null_max, "probability": probability}


def gate(identifier: str, passed: bool, value: Any, threshold: Any, detail: str, coverage: str = "complete") -> dict[str, Any]:
    return {
        "id": identifier,
        "passed": bool(passed),
        "coverage": coverage,
        "value": value,
        "threshold": threshold,
        "detail": detail,
    }


def validate(request: dict[str, Any]) -> dict[str, Any]:
    if request.get("schemaVersion") != 1:
        fail("schemaVersion must be 1")
    if request.get("researchOnly") is not True:
        fail("validator accepts research-only requests only")
    returns = finite_series(request.get("returns"), "returns")
    in_sample = finite_series(request.get("inSampleReturns"), "inSampleReturns")
    out_of_sample = finite_series(request.get("outOfSampleReturns"), "outOfSampleReturns")
    market_returns = finite_series(request.get("marketReturns"), "marketReturns", required=False)
    positions = finite_series(request.get("positions"), "positions", required=False)
    asset_returns = finite_series(request.get("assetReturns"), "assetReturns", required=False)
    sibling_returns = [finite_series(values, "siblingCandidateReturns") for values in request.get("siblingCandidateReturns", [])]
    other_candidate_returns = [
        finite_series(values, "otherCandidateReturns")
        for values in request.get("otherCandidateReturns", [])
    ]
    trial_p_values = finite_series(request.get("trialPValues", []), "trialPValues", required=False) or []
    policy = enforce_policy(request.get("policy"))
    seed = int(policy["seed"])
    hac_lags = int(policy["hacLags"])

    hac = hac_mean_test(returns, hac_lags)
    bootstrap = circular_block_bootstrap(
        returns,
        int(policy["bootstrapIterations"]),
        int(policy["bootstrapBlockSize"]),
        random.Random(seed + 1),
    )
    family_p_values = trial_p_values or [
        hac_mean_test(values, hac_lags)["pValue"]
        for values in other_candidate_returns
    ]
    fdr = benjamini_hochberg(hac["pValue"], family_p_values)
    pbo = probability_backtest_overfit(sibling_returns, int(policy["pboSegments"]))
    placebo = shifted_signal_placebo(
        returns,
        positions,
        asset_returns,
        request.get("costs") if isinstance(request.get("costs"), dict) else {},
        int(policy["placeboIterations"]),
        random.Random(seed + 2),
    )
    factor_model = factor_alpha_model(returns, request.get("factorReturns"), hac_lags)
    regime_model = regime_robustness(
        returns,
        market_returns,
        int(policy["hmmStates"]),
        int(policy["hmmIterations"]),
    )
    in_sharpe = sharpe(in_sample)
    out_sharpe = sharpe(out_of_sample)
    degradation = max(0.0, (in_sharpe - out_sharpe) / max(abs(in_sharpe), EPSILON)) if in_sharpe > 0.0 else 1.0
    claimed = request.get("claimedMetrics") if isinstance(request.get("claimedMetrics"), dict) else {}
    claimed_mean = claimed.get("meanReturn")
    metric_difference = abs(float(claimed_mean) - mean(returns)) if isinstance(claimed_mean, (int, float)) and not isinstance(claimed_mean, bool) else math.inf
    deflated = deflated_sharpe(returns, max(len(trial_p_values) + 1, len(sibling_returns)))

    min_observations = int(policy["minObservations"])
    min_hac_t = float(policy["minHacTStat"])
    max_hac_p = float(policy["maxHacPValue"])
    max_fdr_q = float(policy["maxFdrQValue"])
    max_degradation = float(policy["maxOosSharpeDegradation"])
    max_pbo = float(policy["maxProbabilityBacktestOverfit"])
    max_placebo_p = float(policy["maxPlaceboPValue"])
    min_alpha_t = float(policy["minFactorAlphaTStat"])
    min_positive_regimes = int(policy["minPositiveRegimes"])
    max_regime_share = float(policy["maxSingleRegimePnlShare"])
    metric_tolerance = float(policy["metricTolerance"])
    min_deflated_probability = float(policy["minDeflatedSharpeProbability"])

    gates = [
        gate("minimum_observations", len(returns) >= min_observations, len(returns), {"min": min_observations}, "Enough aligned daily observations."),
        gate("hac_significance", abs(hac["tStat"]) >= min_hac_t and hac["pValue"] <= max_hac_p, {"tStat": hac["tStat"], "pValue": hac["pValue"]}, {"minAbsTStat": min_hac_t, "maxPValue": max_hac_p}, "Newey-West significance corrects for autocorrelation and heteroskedasticity."),
        gate("block_bootstrap", bootstrap["meanCi95"][0] > 0.0, bootstrap["meanCi95"], {"lowerBoundAbove": 0.0}, "Circular block bootstrap preserves local dependence."),
        gate("multiple_testing_fdr", fdr["candidateQValue"] <= max_fdr_q, fdr["candidateQValue"], {"maxQValue": max_fdr_q}, "Benjamini-Hochberg controls false discovery across the submitted trial family."),
        gate("oos_degradation", degradation <= max_degradation, {"degradation": degradation, "inSampleSharpe": in_sharpe, "outOfSampleSharpe": out_sharpe}, {"maxDegradation": max_degradation}, "Purged out-of-sample Sharpe must remain close to in-sample Sharpe."),
        gate("probability_backtest_overfit", pbo.get("coverage") == "complete" and pbo.get("probability", 1.0) <= max_pbo, pbo.get("probability"), {"maxProbability": max_pbo}, "CSCV estimates selection overfit across candidate strategies.", pbo.get("coverage", "missing")),
        gate("signal_placebo", placebo.get("coverage") == "complete" and placebo.get("pValue", 1.0) <= max_placebo_p, placebo.get("pValue"), {"maxPValue": max_placebo_p}, "Circularly shifted positions must not reproduce the claimed edge.", placebo.get("coverage", "missing")),
        gate("factor_residual_alpha", factor_model.get("coverage") == "complete" and abs(factor_model.get("alphaTStat", 0.0)) >= min_alpha_t, factor_model.get("alphaTStat"), {"minAbsTStat": min_alpha_t}, "Factor-residual alpha must survive HAC inference.", factor_model.get("coverage", "missing")),
        gate("regime_robustness", regime_model.get("coverage") == "complete" and regime_model.get("positiveRegimes", 0) >= min_positive_regimes and regime_model.get("maxSingleRegimePnlShare", 1.0) <= max_regime_share, {"positiveRegimes": regime_model.get("positiveRegimes"), "maxSingleRegimePnlShare": regime_model.get("maxSingleRegimePnlShare")}, {"minPositiveRegimes": min_positive_regimes, "maxSingleRegimePnlShare": max_regime_share}, "Gaussian-HMM market regimes prevent one-state performance from passing as robust.", regime_model.get("coverage", "missing")),
        gate("metric_reconciliation", metric_difference <= metric_tolerance, metric_difference if math.isfinite(metric_difference) else None, {"maxAbsoluteDifference": metric_tolerance}, "The independent mean-return calculation must reconcile with the engine claim.", "complete" if claimed_mean is not None else "missing"),
        gate("deflated_sharpe", deflated["probability"] >= min_deflated_probability, deflated["probability"], {"minProbability": min_deflated_probability}, "Deflated Sharpe discounts the best result expected from repeated trials."),
    ]
    failed = [item["id"] for item in gates if not item["passed"]]
    return {
        "schemaVersion": 1,
        "validator": "hivemindos-python-independent-validator",
        "validatorVersion": "0.1.0",
        "researchOnly": True,
        "candidateId": str(request.get("candidateId") or "candidate"),
        "passed": not failed,
        "failedGateIds": failed,
        "gates": gates,
        "statistics": {
            "observations": len(returns),
            "meanReturn": mean(returns),
            "sharpe": sharpe(returns),
            "hacTStat": hac["tStat"],
            "hacPValue": hac["pValue"],
            "hac": hac,
            "bootstrap": bootstrap,
            "multipleTesting": fdr,
            "pbo": pbo,
            "placebo": placebo,
            "deflatedSharpe": deflated,
            "inSampleSharpe": in_sharpe,
            "outOfSampleSharpe": out_sharpe,
            "oosSharpeDegradation": degradation,
        },
        "factorModel": factor_model,
        "regimeModel": regime_model,
        "warnings": [
            "Research output only; passing gates is not evidence of future profitability.",
            "Dataset provenance and point-in-time construction remain independently auditable inputs.",
        ],
    }


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        fail(f"invalid JSON: {error}")
    if not isinstance(payload, dict):
        fail("request must be a JSON object")
    result = validate(payload)
    json.dump(result, sys.stdout, sort_keys=True, separators=(",", ":"), allow_nan=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
