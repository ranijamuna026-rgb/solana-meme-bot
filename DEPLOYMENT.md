# Solana Meme Coin Trading Bot — Containerized Cloud Deployment Guide

## Mode: PAPER TRADING ONLY (Real Trading STRICTLY Disabled)

---

## 1. System Requirements

* **Node.js**: `Node.js >= 18.0.0` (ESM module support, native `fetch` API, `node:http`).
* **Container Runtime**: Docker or OCI-compliant container runtime (AWS ECS, GCP Cloud Run, Render, Railway, Kubernetes).
* **Memory**: Minimum `512MB RAM` (Recommended: `1GB RAM`).
* **CPU**: `1 vCPU`.

---

## 2. Environment Variables Configuration

### Safe Non-Secret Parameters

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `TRADING_MODE` | String | `PAPER` | Execution mode. Must default to `PAPER`. |
| `SOLANA_RPC_URL` | String | `https://api.mainnet-beta.solana.com` | Read-only Solana RPC HTTP URL. |
| `DEXSCREENER_API_URL` | String | `https://api.dexscreener.com` | DexScreener market data API. |
| `PORT` | Integer | `3000` | HTTP Dashboard API & Health Check Port. |
| `POLL_INTERVAL_MS` | Integer | `10000` | Token monitoring polling interval (ms). |
| `MIN_LIQUIDITY_USD` | Number | `10000` | Minimum token liquidity threshold ($). |
| `MIN_5M_VOLUME_USD` | Number | `5000` | Minimum 5-minute volume threshold ($). |
| `MIN_5M_BUYS` | Integer | `5` | Minimum 5-minute buy transactions. |
| `MIN_5M_SELLS` | Integer | `2` | Minimum 5-minute sell transactions. |
| `MAX_TOKEN_AGE_MINUTES` | Integer | `180` | Maximum token age (minutes). |
| `MIN_STRATEGY_SCORE` | Integer | `70` | Minimum strategy score filter. |
| `MAX_RISK_SCORE` | Integer | `60` | Maximum risk score filter. |
| `MAX_POSITION_SIZE_USD` | Number | `10` | Maximum paper trade position size ($). |
| `MAX_SLIPPAGE_PERCENT` | Number | `1.0` | Maximum slippage limit (%). |
| `EMERGENCY_KILL_SWITCH` | Boolean | `false` | Emergency kill switch flag. |

### Secret Configuration

* **`SOLANA_PRIVATE_KEY`**: **NOT REQUIRED** for PAPER mode.
* **`SOLANA_WALLET_ADDRESS`**: **NOT REQUIRED** for PAPER mode.

---

## 3. Container & Process Architecture Review

### Single-Process Architecture
The bot runs a single Node.js process (`node src/index.js`) that simultaneously handles:
1. Continuous background token monitoring worker loops (`src/monitor.js`).
2. Read-only HTTP REST API & static web dashboard server (`src/server.js`).

### PM2 / Cluster Mode Evaluation
* **PM2 Cluster Mode**: **DISABLED / NOT RECOMMENDED**. Running multiple worker processes in PM2 cluster mode would spawn multiple parallel bot instances, resulting in duplicate token polling, duplicate paper trade execution, and race conditions on state files.
* **Container Lifecycle Management**: Container orchestrators (Docker restart policies, Kubernetes deployments, AWS ECS task definitions) manage container lifecycle and single-instance restarts cleanly without PM2.

---

## 4. Standard Health & Observability Endpoints

All health endpoints are read-only `GET` endpoints that sanitize output and never expose private keys, credentials, or sensitive environment variables.

* `GET /healthz` — Process Health Indicator (`status: "OK"`, `uptimeSeconds`, `tradingMode`).
* `GET /livez` — Process Liveness Probe (`status: "ALIVE"`, `uptimeSeconds`).
* `GET /readyz` — Application Readiness Probe (`status: "READY"`, `configurationValid`, `rpcConfigured`).

---

## 5. Storage & Persistence Limitation

* **Local Storage**: `paper_trades_history.json` records paper trade executions.
* **Cloud Storage Limitation**: In ephemeral container environments (e.g. AWS ECS Fargate, GCP Cloud Run, Render), local disk changes are lost when containers restart or redeploy.
* **Volume Mount Requirement**: For persistent paper trade history across container replacements, attach a persistent volume (e.g., AWS EFS, Docker volume mount to `/app/paper_trades_history.json`).

---

## 6. Docker Build & Execution Guide

### Build Docker Image
```bash
docker build -t solana-meme-bot:latest .
```

### Run Container in PAPER Mode
```bash
docker run -d \
  --name solana-meme-bot \
  -p 3000:3000 \
  -e TRADING_MODE=PAPER \
  -e SOLANA_RPC_URL=https://api.mainnet-beta.solana.com \
  solana-meme-bot:latest
```

### Test Health Endpoint
```bash
curl http://localhost:3000/healthz
```

---

## 7. Safety Guarantee

> Real trading execution is **STRICTLY DISABLED**. The containerized deployment architecture operates exclusively in `PAPER` trading mode with zero transaction signing capabilities, zero mainnet submission authorization, and zero private key requirements.
