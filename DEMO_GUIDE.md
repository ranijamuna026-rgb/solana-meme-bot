# Demonstration & Presentation Guide

> **Solana Memecoin Automated Pre-Launch & Paper-Trading Bot**  
> *Project Presentation & Live Verification Walkthrough*

---

## Demonstration Overview

This guide outlines a structured 5–10 minute demonstration sequence designed for mentors, project evaluators, and technical reviews.

### Core Safety Guarantee
- **Execution Mode**: `REAL SOLANA MAINNET MARKET DATA + PAPER TRADING ONLY`
- **Real Transactions**: **0** (Zero real BUY, SELL, wallet connect, or Web3 signing)

---

## DEMO 1 — Bot Startup & Initialization

### Objective
Demonstrate clean system startup, RPC connectivity, configuration loading, and server initialization.

### Step-by-Step Instructions
1. Open terminal in project root (`C:\solana-meme-bot`).
2. Run the one-command startup script:
   ```bash
   npm start
   ```
3. Highlight the terminal startup log:
   - **Mode**: `PAPER TRADING ONLY`
   - **RPC Connection**: Connected to `https://api.mainnet-beta.solana.com`
   - **Dashboard Server**: Running on `http://localhost:3000`
   - **Launch-Day Scheduler**: Active with 60s polling interval

---

## DEMO 2 — Read-Only Dashboard API Verification

### Objective
Show read-only REST API endpoints and runtime state reporting.

### Key Endpoints to Show

#### 1. Bot Status & Safety Mode
- **URL**: `http://localhost:3000/api/status`
- **Key Fields**:
  - `"mode": "PAPER TRADING ONLY"`
  - `"liveTradingStatus": "DISABLED"`
  - `"paperTradingActive": true`

#### 2. Automated Launch-Day Scheduler Status
- **URL**: `http://localhost:3000/api/launch-day-scheduler/status`
- **Key Fields**:
  - `"enabled": true`
  - `"running": true`
  - `"pollIntervalMs": 60000`
  - `"lastRunStatus": "NO_VERIFIED_TOMORROW_DATA"`

#### 3. Risk Engine Limits
- **URL**: `http://localhost:3000/api/risk`
- **Key Fields**:
  - `"minLiquidityUsd": 10000`
  - `"min5mVolumeUsd": 5000`
  - `"minStrategyScore": 70`
  - `"maxRiskScore": 60`

---

## DEMO 3 — Pre-Launch Intelligence & Data Honesty

### Objective
Explain pre-launch discovery and demonstrate data honesty when no upcoming launches exist.

### Demonstration Points
1. Explain the discovery workflow:
   - Queries public sources (Metaplex Genesis, DexScreener, Launchpad.meme).
   - Extracts explicit launch timestamps & calculates timezone date matching.
   - Deduplicates projects by mint address & merges multi-source evidence.
2. Query Tomorrow Watchlist API:
   - **URL**: `http://localhost:3000/api/prelaunch/tomorrow`
   - Output: `"status": "NO_VERIFIED_TOMORROW_DATA"`, `"watchedCandidatesCount": 0`.
3. Highlight **Data Honesty**:
   - Emphasize that the bot **does not invent fake tokens** or force synthetic candidates into production state when zero verified launches are found.

---

## DEMO 4 — Launch-Day Verification Pipeline

### Objective
Explain the 6-stage candidate evaluation filter before paper trading handoff.

### Pipeline Gates
1. **Mint Identity Verification**: Verify token mint against official project announcement.
2. **DEX Market Verification**: Confirm Solana DEX pair existence on DexScreener.
3. **Liquidity Verification**: Check initial liquidity $\ge \$10,000$.
4. **Volume Verification**: Check 5-minute volume $\ge \$5,000$.
5. **Risk Manager Check**: Verify risk score $\le 60$.
6. **Strategy Score Check**: Verify strategy score $\ge 70$.

Only candidates achieving **`FINAL_PASS`** across all 6 gates are permitted to reach the paper trader.

---

## DEMO 5 — Paper Trading Engine Execution

### Objective
Demonstrate paper trading position management and risk limits.

### Position Parameters
- **Position Size**: Fixed **\$10.00 USD**
- **Take Profit (TP)**: Fixed **+5.00%**
- **Stop Loss (SL)**: Fixed **-3.00%**
- **Maximum Hold Time**: **5 minutes**

### Demonstration Points
1. Explain paper buy execution: records entry price, quantity, and timestamp without submitting Solana blockchain transactions.
2. Show active trade monitor: continuously checks live price against +5% TP / -3% SL.
3. Show exit execution: closes trade on TP/SL hit or 5-minute hold expiration, recording P&L.

---

## DEMO 6 — Automated Unit & Integration Testing

### Objective
Demonstrate comprehensive automated test coverage.

### Command
```bash
npm test
```

### Verification Point
Point out that **138 / 138 test cases pass 100%**, validating paper trading rules, risk filters, pre-launch discovery, scheduler orchestration, and security locks.

---

## Presentation Conclusion & Summary

1. **Fully Autonomous Pipeline**: From public launch announcement to simulated paper execution.
2. **Strict Risk Control**: Multi-layer filtering ($10k liquidity, $5k volume, risk $\le 60$, strategy $\ge 70$).
3. **Zero Financial Risk**: Operation is 100% simulated using real mainnet market data.
