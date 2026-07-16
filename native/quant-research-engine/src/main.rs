use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::io::{self, Read};

const TRADING_DAYS_PER_YEAR: f64 = 252.0;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BacktestRequest {
    schema_version: u32,
    research_only: bool,
    dataset: Dataset,
    strategy: Strategy,
    costs: Costs,
    split: Split,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Dataset {
    id: String,
    source: String,
    as_of: String,
    point_in_time: bool,
    survivorship_bias_controlled: bool,
    adjusted_prices: String,
    bars: Vec<Bar>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Bar {
    date: String,
    symbol: String,
    close: f64,
    volume: f64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Strategy {
    id: String,
    signal: Signal,
    execution_lag_bars: usize,
    allow_short: bool,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Signal {
    kind: SignalKind,
    lookback: usize,
    threshold: f64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
enum SignalKind {
    Momentum,
    MeanReversion,
    MovingAverage,
    VolatilityBreakout,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Costs {
    commission_bps: f64,
    slippage_bps: f64,
    annual_borrow_bps: f64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Split {
    train_fraction: f64,
    purge_bars: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Observation {
    date: String,
    symbol: String,
    position: f64,
    previous_position: f64,
    asset_return: f64,
    gross_return: f64,
    transaction_cost: f64,
    borrow_cost: f64,
    net_return: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Metrics {
    observations: usize,
    cumulative_return: f64,
    annualized_return: f64,
    annualized_volatility: f64,
    sharpe: f64,
    max_drawdown: f64,
    hit_rate: f64,
    turnover: f64,
    total_cost: f64,
    mean_return: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SplitMetrics {
    purge_bars: usize,
    in_sample: Metrics,
    out_of_sample: Metrics,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExecutionPolicy {
    live_trading_enabled: bool,
    signal_lag_bars: usize,
    cost_model: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BacktestResponse {
    schema_version: u32,
    engine: &'static str,
    engine_version: &'static str,
    research_only: bool,
    dataset_id: String,
    strategy_id: String,
    dataset_hash: String,
    strategy_hash: String,
    execution: ExecutionPolicy,
    observations: Vec<Observation>,
    metrics: Metrics,
    split: SplitMetrics,
    warnings: Vec<String>,
}

fn main() {
    if std::env::args().any(|argument| argument == "--version") {
        println!(
            "{{\"engine\":\"hivemindos-rust-quant-engine\",\"version\":\"{}\",\"researchOnly\":true,\"liveTradingEnabled\":false}}",
            env!("CARGO_PKG_VERSION")
        );
        return;
    }
    if let Err(error) = run() {
        eprintln!("quant research engine rejected request: {error}");
        std::process::exit(2);
    }
}

fn run() -> Result<(), String> {
    let mut input = String::new();
    io::stdin()
        .read_to_string(&mut input)
        .map_err(|error| format!("could not read stdin: {error}"))?;
    let request: BacktestRequest =
        serde_json::from_str(&input).map_err(|error| format!("invalid request JSON: {error}"))?;
    validate_request(&request)?;

    let dataset_hash = hash_json(&request.dataset)?;
    let strategy_hash = hash_json(&request.strategy)?;
    let observations = simulate(&request);
    let metrics = calculate_metrics(&observations);
    let split = calculate_split_metrics(&observations, &request.split);
    let response = BacktestResponse {
        schema_version: 1,
        engine: "hivemindos-rust-quant-engine",
        engine_version: env!("CARGO_PKG_VERSION"),
        research_only: true,
        dataset_id: request.dataset.id,
        strategy_id: request.strategy.id,
        dataset_hash,
        strategy_hash,
        execution: ExecutionPolicy {
            live_trading_enabled: false,
            signal_lag_bars: request.strategy.execution_lag_bars,
            cost_model: "commission + slippage on turnover; annualized borrow on short exposure",
        },
        observations,
        metrics,
        split,
        warnings: vec![
            "Research output only; it is not an order, recommendation, or promise of future performance."
                .to_owned(),
            "Dataset provenance flags are caller assertions and must be independently audited."
                .to_owned(),
        ],
    };
    println!(
        "{}",
        serde_json::to_string(&response)
            .map_err(|error| format!("could not serialize result: {error}"))?
    );
    Ok(())
}

fn validate_request(request: &BacktestRequest) -> Result<(), String> {
    if request.schema_version != 1 {
        return Err("schemaVersion must be 1".to_owned());
    }
    if !request.research_only {
        return Err("research-only engine cannot enable live execution".to_owned());
    }
    if !request.dataset.point_in_time {
        return Err("dataset must be explicitly point-in-time".to_owned());
    }
    if !request.dataset.survivorship_bias_controlled {
        return Err("dataset must document survivorship-bias control".to_owned());
    }
    if request.dataset.source.trim().is_empty() || request.dataset.as_of.trim().is_empty() {
        return Err("dataset source and asOf provenance are required".to_owned());
    }
    let adjusted = request.dataset.adjusted_prices.to_ascii_lowercase();
    if adjusted.trim().is_empty() || adjusted == "raw" || adjusted == "none" {
        return Err("adjustedPrices must document split/dividend handling".to_owned());
    }
    if request.dataset.bars.len() < 3 {
        return Err("dataset needs at least three bars".to_owned());
    }
    if request.strategy.signal.lookback < 2 {
        return Err("signal lookback must be at least 2".to_owned());
    }
    if request.strategy.execution_lag_bars < 1 {
        return Err("executionLagBars must be at least 1 to prevent lookahead".to_owned());
    }
    if !(0.1..=0.9).contains(&request.split.train_fraction) {
        return Err("trainFraction must be between 0.1 and 0.9".to_owned());
    }
    for (name, value) in [
        ("commissionBps", request.costs.commission_bps),
        ("slippageBps", request.costs.slippage_bps),
        ("annualBorrowBps", request.costs.annual_borrow_bps),
    ] {
        if !value.is_finite() || value < 0.0 {
            return Err(format!("{name} must be finite and non-negative"));
        }
    }
    let symbols: BTreeSet<&str> = request
        .dataset
        .bars
        .iter()
        .map(|bar| bar.symbol.as_str())
        .collect();
    if symbols.len() != 1 {
        return Err("each engine request must contain exactly one symbol; orchestrate portfolios as separate point-in-time series".to_owned());
    }
    let mut prior_date = "";
    for bar in &request.dataset.bars {
        if bar.date.len() != 10 || bar.symbol.trim().is_empty() {
            return Err("every bar needs an ISO YYYY-MM-DD date and symbol".to_owned());
        }
        if bar.date.as_str() <= prior_date {
            return Err("bars must be strictly increasing with no duplicate dates".to_owned());
        }
        if !bar.close.is_finite() || bar.close <= 0.0 || !bar.volume.is_finite() || bar.volume < 0.0 {
            return Err("bar close must be positive and volume must be non-negative".to_owned());
        }
        prior_date = &bar.date;
    }
    Ok(())
}

fn hash_json<T: Serialize>(value: &T) -> Result<String, String> {
    let bytes = serde_json::to_vec(value).map_err(|error| format!("hash input failed: {error}"))?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn simulate(request: &BacktestRequest) -> Vec<Observation> {
    let bars = &request.dataset.bars;
    let one_way_cost_bps = request.costs.commission_bps + request.costs.slippage_bps;
    let daily_borrow = request.costs.annual_borrow_bps / 10_000.0 / TRADING_DAYS_PER_YEAR;
    let mut previous_position = 0.0;
    let mut observations = Vec::with_capacity(bars.len() - 1);

    for index in 1..bars.len() {
        let position = signal_position(request, index);
        let asset_return = bars[index].close / bars[index - 1].close - 1.0;
        let gross_return = position * asset_return;
        let transaction_cost =
            (position - previous_position).abs() * one_way_cost_bps / 10_000.0;
        let borrow_cost = if position < 0.0 {
            position.abs() * daily_borrow
        } else {
            0.0
        };
        let net_return = gross_return - transaction_cost - borrow_cost;
        observations.push(Observation {
            date: bars[index].date.clone(),
            symbol: bars[index].symbol.clone(),
            position,
            previous_position,
            asset_return,
            gross_return,
            transaction_cost,
            borrow_cost,
            net_return,
        });
        previous_position = position;
    }
    observations
}

fn signal_position(request: &BacktestRequest, return_index: usize) -> f64 {
    let strategy = &request.strategy;
    let Some(source_index) = return_index.checked_sub(strategy.execution_lag_bars) else {
        return 0.0;
    };
    if source_index < strategy.signal.lookback {
        return 0.0;
    }
    let bars = &request.dataset.bars;
    let lookback = strategy.signal.lookback;
    let momentum = bars[source_index].close / bars[source_index - lookback].close - 1.0;
    let score = match strategy.signal.kind {
        SignalKind::Momentum => momentum,
        SignalKind::MeanReversion => -momentum,
        SignalKind::MovingAverage => {
            let start = source_index + 1 - lookback;
            let average = bars[start..=source_index]
                .iter()
                .map(|bar| bar.close)
                .sum::<f64>()
                / lookback as f64;
            bars[source_index].close / average - 1.0
        }
        SignalKind::VolatilityBreakout => volatility_breakout_score(bars, source_index, lookback),
    };
    let threshold = strategy.signal.threshold.abs();
    let raw = if score > threshold {
        1.0
    } else if score < -threshold {
        -1.0
    } else {
        0.0
    };
    if strategy.allow_short { raw } else { raw.max(0.0) }
}

fn volatility_breakout_score(bars: &[Bar], source_index: usize, lookback: usize) -> f64 {
    let start = source_index + 1 - lookback;
    let returns: Vec<f64> = (start + 1..=source_index)
        .map(|index| bars[index].close / bars[index - 1].close - 1.0)
        .collect();
    if returns.len() < 2 {
        return 0.0;
    }
    let mean = returns.iter().sum::<f64>() / returns.len() as f64;
    let variance = returns
        .iter()
        .map(|value| (value - mean).powi(2))
        .sum::<f64>()
        / (returns.len() - 1) as f64;
    let volatility = variance.sqrt();
    if volatility <= f64::EPSILON {
        0.0
    } else {
        returns.last().copied().unwrap_or(0.0) / volatility
    }
}

fn calculate_split_metrics(observations: &[Observation], split: &Split) -> SplitMetrics {
    let train_end = ((observations.len() as f64) * split.train_fraction).floor() as usize;
    let out_start = (train_end + split.purge_bars).min(observations.len());
    SplitMetrics {
        purge_bars: split.purge_bars,
        in_sample: calculate_metrics(&observations[..train_end]),
        out_of_sample: calculate_metrics(&observations[out_start..]),
    }
}

fn calculate_metrics(observations: &[Observation]) -> Metrics {
    let returns: Vec<f64> = observations.iter().map(|row| row.net_return).collect();
    let count = returns.len();
    if count == 0 {
        return Metrics {
            observations: 0,
            cumulative_return: 0.0,
            annualized_return: 0.0,
            annualized_volatility: 0.0,
            sharpe: 0.0,
            max_drawdown: 0.0,
            hit_rate: 0.0,
            turnover: 0.0,
            total_cost: 0.0,
            mean_return: 0.0,
        };
    }
    let mean = returns.iter().sum::<f64>() / count as f64;
    let variance = if count > 1 {
        returns
            .iter()
            .map(|value| (value - mean).powi(2))
            .sum::<f64>()
            / (count - 1) as f64
    } else {
        0.0
    };
    let daily_volatility = variance.sqrt();
    let growth = returns.iter().fold(1.0, |equity, value| equity * (1.0 + value));
    let cumulative_return = growth - 1.0;
    let annualized_return = if growth > 0.0 {
        growth.powf(TRADING_DAYS_PER_YEAR / count as f64) - 1.0
    } else {
        -1.0
    };
    let annualized_volatility = daily_volatility * TRADING_DAYS_PER_YEAR.sqrt();
    let sharpe = if daily_volatility > f64::EPSILON {
        mean / daily_volatility * TRADING_DAYS_PER_YEAR.sqrt()
    } else {
        0.0
    };
    Metrics {
        observations: count,
        cumulative_return,
        annualized_return,
        annualized_volatility,
        sharpe,
        max_drawdown: max_drawdown(&returns),
        hit_rate: returns.iter().filter(|value| **value > 0.0).count() as f64 / count as f64,
        turnover: observations
            .iter()
            .map(|row| (row.position - row.previous_position).abs())
            .sum(),
        total_cost: observations
            .iter()
            .map(|row| row.transaction_cost + row.borrow_cost)
            .sum(),
        mean_return: mean,
    }
}

fn max_drawdown(returns: &[f64]) -> f64 {
    let mut equity: f64 = 1.0;
    let mut peak: f64 = 1.0;
    let mut worst: f64 = 0.0;
    for value in returns {
        equity *= 1.0 + value;
        peak = peak.max(equity);
        if peak > 0.0 {
            worst = worst.min(equity / peak - 1.0);
        }
    }
    worst
}
