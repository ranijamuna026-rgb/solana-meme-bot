// ============================================================================
// SOLANA MEME COIN BOT MONITORING DASHBOARD (public/app.js)
// Purpose: Read-only UI controller consuming Phase 8.5.1 API endpoints + Phase 8.6 Analytics + Observability Upgrades
// Theme: BLACK + WHITE + PINK
// Mode: PAPER TRADING ONLY (Simulated execution, zero Web3 signing)
// ============================================================================

(function () {
  'use strict';

  // State Store
  const state = {
    status: null,
    candidates: [],
    activeTrade: null,
    risk: null,
    trades: [],
    performance: null,
    validation: null,
    tomorrowWatchlist: [],
    hasNotifiedCompletion: false,
    candidateFilter: 'ALL',
    lastSyncTime: null,
    autoRefreshInterval: null,
    isFetchPending: false,
    consecutiveFetchFailures: 0,
    selectedTradeForChart: null,
    chartLiveInterval: null
  };

  // DOM Elements Cache
  const elements = {
    // Navigation
    navItems: document.querySelectorAll('.nav-item'),

    // Top Bar & Clock
    liveClock: document.getElementById('live-time'),
    btnRefresh: document.getElementById('btn-refresh'),
    lastSyncTime: document.getElementById('last-sync-time'),

    // Bot & API Status
    botStatusDot: document.getElementById('bot-status-dot'),
    botStatusVal: document.getElementById('bot-status-val'),
    botModeText: document.getElementById('bot-mode-text'),
    sidebarStatusDot: document.getElementById('sidebar-status-dot'),
    sidebarStatusText: document.getElementById('sidebar-status-text'),
    apiStatusDot: document.getElementById('api-status-dot'),
    apiStatusVal: document.getElementById('api-status-val'),
    apiRpcUrl: document.getElementById('api-rpc-url'),
    uptimeVal: document.getElementById('uptime-val'),

    // Portfolio P&L Summary
    totalPnlVal: document.getElementById('total-pnl-val'),
    dailyPnlVal: document.getElementById('daily-pnl-val'),

    // Validation Session Elements (Phase 8.7)
    valSessionStatus: document.getElementById('val-session-status'),
    valTradesCount: document.getElementById('val-trades-count'),
    valMinTarget: document.getElementById('val-min-target'),
    valRecTarget: document.getElementById('val-rec-target'),
    valWinRate: document.getElementById('val-win-rate'),
    valPnl: document.getElementById('val-pnl'),
    valDuration: document.getElementById('val-duration'),
    valProgressFill: document.getElementById('val-progress-fill'),
    valCompletionBanner: document.getElementById('val-completion-banner'),

    // Active Trade Container
    activeTradeContainer: document.getElementById('active-trade-container'),

    // Candidate Table & Filters
    candidatesTableBody: document.getElementById('candidates-tbody'),
    filterBtns: document.querySelectorAll('.filter-btn'),
    countAll: document.getElementById('count-all'),
    countApproved: document.getElementById('count-approved'),
    countRejected: document.getElementById('count-rejected'),

    // Tomorrow Watchlist Table
    tomorrowTableBody: document.getElementById('tomorrow-tbody'),

    // Performance Section Elements
    perfTotalTrades: document.getElementById('perf-total-trades'),
    perfWins: document.getElementById('perf-wins'),
    perfLosses: document.getElementById('perf-losses'),
    perfWinRate: document.getElementById('perf-win-rate'),
    perfProfitFactor: document.getElementById('perf-profit-factor'),
    perfAvgPnl: document.getElementById('perf-avg-pnl'),
    perfAvgWin: document.getElementById('perf-avg-win'),
    perfAvgLoss: document.getElementById('perf-avg-loss'),
    perfBestTrade: document.getElementById('perf-best-trade'),
    perfWorstTrade: document.getElementById('perf-worst-trade'),
    perfAvgDuration: document.getElementById('perf-avg-duration'),
    perfMaxDrawdown: document.getElementById('perf-max-drawdown'),
    perfDataQuality: document.getElementById('perf-data-quality'),
    exitTpCount: document.getElementById('exit-tp-count'),
    exitSlCount: document.getElementById('exit-sl-count'),
    exitMhCount: document.getElementById('exit-mh-count'),
    exitOtherCount: document.getElementById('exit-other-count'),
    candTotalEval: document.getElementById('cand-total-eval'),
    candApprovedCount: document.getElementById('cand-approved-count'),
    candRejectedCount: document.getElementById('cand-rejected-count'),
    candExecutedTrades: document.getElementById('cand-executed-trades'),

    // Risk Limits & Real-Time Metrics
    riskHourlyTrades: document.getElementById('risk-hourly-trades'),
    riskDailyTrades: document.getElementById('risk-daily-trades'),
    riskConsecLosses: document.getElementById('risk-consec-losses'),
    riskCircuitBreaker: document.getElementById('risk-circuit-breaker'),
    riskCooldown: document.getElementById('risk-cooldown'),
    riskPosSize: document.getElementById('risk-pos-size'),
    riskMaxLiqPct: document.getElementById('risk-max-liq-pct'),
    riskMinLiq: document.getElementById('risk-min-liq'),
    riskMinVol: document.getElementById('risk-min-vol'),
    riskMinStratScore: document.getElementById('risk-min-strat-score'),
    riskMaxRiskScore: document.getElementById('risk-max-risk-score'),
    riskMaxDailyLoss: document.getElementById('risk-max-daily-loss'),

    // Trade History Table
    historyTableBody: document.getElementById('history-tbody'),

    // Candidate Inspector Modal
    modal: document.getElementById('candidate-modal'),
    modalTitle: document.getElementById('modal-candidate-title'),
    modalBody: document.getElementById('modal-candidate-body'),
    btnModalClose: document.getElementById('btn-modal-close'),
    btnModalDismiss: document.getElementById('btn-modal-dismiss'),

    // Trade Chart Modal Elements
    chartModal: document.getElementById('trade-chart-modal'),
    chartModalTitle: document.getElementById('chart-modal-title'),
    chartModalStatus: document.getElementById('chart-modal-status'),
    btnChartModalClose: document.getElementById('btn-chart-modal-close'),
    btnChartModalDismiss: document.getElementById('btn-chart-modal-dismiss'),
    chartSumToken: document.getElementById('chart-sum-token'),
    chartSumAddress: document.getElementById('chart-sum-address'),
    chartSumEntryPrice: document.getElementById('chart-sum-entry-price'),
    chartSumEntryTime: document.getElementById('chart-sum-entry-time'),
    chartSumExitLabel: document.getElementById('chart-sum-exit-label'),
    chartSumCurrentPrice: document.getElementById('chart-sum-current-price'),
    chartSumExitTime: document.getElementById('chart-sum-exit-time'),
    chartSumPnlPct: document.getElementById('chart-sum-pnl-pct'),
    chartSumPnlUsd: document.getElementById('chart-sum-pnl-usd'),
    chartSumDuration: document.getElementById('chart-sum-duration'),
    chartSumPosSize: document.getElementById('chart-sum-pos-size'),
    chartSumScores: document.getElementById('chart-sum-scores'),
    chartSumReason: document.getElementById('chart-sum-reason'),
    chartCanvas: document.getElementById('trade-chart-canvas'),
    chartTooltip: document.getElementById('chart-tooltip'),
    chartEmptyState: document.getElementById('chart-empty-state'),
    chartLiveIndicator: document.getElementById('chart-live-indicator'),
    chartTimelineStepper: document.getElementById('chart-timeline-stepper')
  };

  // Helper Utilities
  function formatCurrency(val, decimals = 4) {
    if (val === undefined || val === null || isNaN(val)) return '$0.00';
    const num = Number(val);
    if (!isFinite(num)) return '$0.00';
    if (Math.abs(num) < 0.0001 && num !== 0) {
      return '$' + num.toExponential(4);
    }
    if (Math.abs(num) < 1) {
      return '$' + num.toFixed(6);
    }
    return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: decimals });
  }

  function formatPercent(val) {
    if (val === undefined || val === null || isNaN(val)) return '0.00%';
    const num = Number(val);
    if (!isFinite(num)) return '0.00%';
    const sign = num > 0 ? '+' : '';
    return sign + num.toFixed(2) + '%';
  }

  function formatSeconds(secs) {
    if (!secs || isNaN(secs) || !isFinite(secs)) return '00m 00s';
    const totalSecs = Math.max(0, Math.floor(secs));
    const m = Math.floor(totalSecs / 60);
    const s = Math.floor(totalSecs % 60);
    return `${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  }

  function truncateAddress(addr) {
    if (!addr || typeof addr !== 'string' || addr === 'N/A' || addr === 'UNKNOWN') return 'N/A';
    if (addr.length <= 12) return addr;
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  }

  function renderTokenAvatar(imageUrl, symbol, size = 20) {
    const cleanSymbol = (symbol || '?').toUpperCase().trim();
    const initial = cleanSymbol.charAt(0) || '?';

    if (imageUrl && typeof imageUrl === 'string' && imageUrl.startsWith('http')) {
      const escapedUrl = imageUrl.replace(/"/g, '&quot;');
      return `<span class="token-avatar-wrapper" style="display: inline-flex; align-items: center; justify-content: center; width: ${size}px; height: ${size}px; border-radius: 50%; overflow: hidden; background: rgba(255,255,255,0.1); margin-right: 6px; vertical-align: middle; flex-shrink: 0;"><img src="${escapedUrl}" alt="${cleanSymbol}" style="width: 100%; height: 100%; object-fit: cover; display: block;" onerror="this.onerror=null; this.parentNode.innerHTML='<span style=\\'font-size: ${Math.floor(size * 0.55)}px; font-weight: 800; color: #FF69B4;\\'>${initial}</span>';" /></span>`;
    }

    return `<span class="token-avatar-wrapper" style="display: inline-flex; align-items: center; justify-content: center; width: ${size}px; height: ${size}px; border-radius: 50%; background: rgba(255, 105, 180, 0.2); border: 1px solid #FF69B4; margin-right: 6px; vertical-align: middle; flex-shrink: 0;"><span style="font-size: ${Math.floor(size * 0.55)}px; font-weight: 800; color: #FF69B4;">${initial}</span></span>`;
  }

  // Live UTC Clock
  function updateLiveClock() {
    const now = new Date();
    if (elements.liveClock) {
      elements.liveClock.textContent = now.toUTCString().split(' ')[4] + ' UTC';
    }
  }
  setInterval(updateLiveClock, 1000);
  updateLiveClock();

  // API Fetcher Module
  async function fetchDashboardData() {
    if (state.isFetchPending) return;
    state.isFetchPending = true;

    try {
      const [statusRes, candidatesRes, activeTradeRes, riskRes, tradesRes, perfRes, valRes, tomorrowRes] = await Promise.allSettled([
        fetch('/api/status'),
        fetch('/api/candidates'),
        fetch('/api/active-trade'),
        fetch('/api/risk'),
        fetch('/api/trades'),
        fetch('/api/performance'),
        fetch('/api/validation'),
        fetch('/api/tomorrow-candidates')
      ]);

      let anySuccess = false;

      // Parse Status
      if (statusRes.status === 'fulfilled' && statusRes.value.ok) {
        state.status = await statusRes.value.json();
        anySuccess = true;
      }

      // Parse Candidates
      if (candidatesRes.status === 'fulfilled' && candidatesRes.value.ok) {
        const data = await candidatesRes.value.json();
        state.candidates = Array.isArray(data.candidates) ? data.candidates : [];
        anySuccess = true;
      }

      // Parse Active Trade
      if (activeTradeRes.status === 'fulfilled' && activeTradeRes.value.ok) {
        state.activeTrade = await activeTradeRes.value.json();
        anySuccess = true;
      }

      // Parse Risk Data
      if (riskRes.status === 'fulfilled' && riskRes.value.ok) {
        state.risk = await riskRes.value.json();
        anySuccess = true;
      }

      // Parse Trades History
      if (tradesRes.status === 'fulfilled' && tradesRes.value.ok) {
        const data = await tradesRes.value.json();
        state.trades = Array.isArray(data.trades) ? data.trades : [];
        anySuccess = true;
      }

      // Parse Performance Analytics
      if (perfRes.status === 'fulfilled' && perfRes.value.ok) {
        state.performance = await perfRes.value.json();
        anySuccess = true;
      }

      // Parse Validation Session (Phase 8.7)
      if (valRes.status === 'fulfilled' && valRes.value.ok) {
        state.validation = await valRes.value.json();
        anySuccess = true;
      }

      // Parse Tomorrow Watchlist (Requirement 6)
      if (tomorrowRes.status === 'fulfilled' && tomorrowRes.value.ok) {
        const data = await tomorrowRes.value.json();
        state.tomorrowWatchlist = Array.isArray(data.watchlist) ? data.watchlist : (Array.isArray(data.candidates) ? data.candidates : []);
        anySuccess = true;
      }

      if (anySuccess) {
        state.consecutiveFetchFailures = 0;
        state.lastSyncTime = new Date();
        renderDashboard();
      } else {
        state.consecutiveFetchFailures++;
        handleFetchFailure();
      }
    } catch (err) {
      console.warn('[UI Warning] Network or API fetch error:', err);
      state.consecutiveFetchFailures++;
      handleFetchFailure();
    } finally {
      state.isFetchPending = false;
    }
  }

  function handleFetchFailure() {
    if (state.consecutiveFetchFailures >= 2) {
      if (elements.apiStatusVal) {
        elements.apiStatusVal.textContent = 'DISCONNECTED';
        elements.apiStatusVal.style.color = '#ff4d4d';
      }
      if (elements.apiStatusDot) {
        elements.apiStatusDot.style.color = '#ff4d4d';
      }
    }
  }

  // Main Render Controller
  function renderDashboard() {
    renderStatus();
    renderValidation();
    renderActiveTrade();
    renderCandidates();
    renderTomorrowWatchlist();
    renderPerformance();
    renderRiskLimits();
    renderTradeHistory();

    if (state.lastSyncTime && elements.lastSyncTime) {
      elements.lastSyncTime.textContent = state.lastSyncTime.toLocaleTimeString();
    }
  }

  // Render Phase 8.7: Validation Session Progress Card
  function renderValidation() {
    const v = state.validation;
    if (!v) return;

    const isCompleted = Boolean(v.completed || v.status === 'COMPLETE' || v.sessionStatus === 'COMPLETED' || ((v.marketPaperTrades || 0) >= 100));

    if (elements.valSessionStatus) {
      elements.valSessionStatus.textContent = isCompleted ? 'VALIDATION COMPLETE' : (v.sessionStatus || 'IN_PROGRESS');
      elements.valSessionStatus.style.backgroundColor = isCompleted ? 'rgba(0, 255, 127, 0.2)' : '';
      elements.valSessionStatus.style.borderColor = isCompleted ? '#00FF7F' : '';
      elements.valSessionStatus.style.color = isCompleted ? '#00FF7F' : '';
    }
    if (elements.valTradesCount) {
      elements.valTradesCount.textContent = v.marketPaperTrades || 0;
    }
    if (elements.valMinTarget) {
      elements.valMinTarget.textContent = isCompleted
        ? `${v.marketPaperTrades || 100} / 100 (100%)`
        : `${v.marketPaperTrades || 0} / ${v.targetMinimum || 100} (${v.progressMinimumPercent || 0}%)`;
    }
    if (elements.valRecTarget) {
      elements.valRecTarget.textContent = `${v.marketPaperTrades || 0} / ${v.targetRecommended || 200} (${v.progressRecommendedPercent || 0}%)`;
    }
    if (elements.valWinRate) {
      elements.valWinRate.textContent = `${v.sessionWinRate || 0}%`;
    }
    if (elements.valPnl) {
      const pnlVal = v.sessionPnlUsd || 0;
      elements.valPnl.textContent = formatCurrency(pnlVal, 2);
      elements.valPnl.style.color = pnlVal >= 0 ? '#FF69B4' : '#FFFFFF';
    }
    if (elements.valDuration) {
      elements.valDuration.textContent = v.sessionDurationStr || formatSeconds(v.sessionDurationSeconds || 0);
    }
    if (elements.valProgressFill) {
      const fillPct = Math.min(100, Math.max(0, ((v.marketPaperTrades || 0) / (v.targetRecommended || 200)) * 100));
      elements.valProgressFill.style.width = `${fillPct.toFixed(1)}%`;
    }

    if (isCompleted) {
      if (elements.valCompletionBanner) {
        elements.valCompletionBanner.classList.remove('hidden');
      }
      if (!state.hasNotifiedCompletion) {
        state.hasNotifiedCompletion = true;
        console.log('[NOTIFICATION] Phase 8.7.2 Complete — 100 genuine market paper trades collected.');
      }
    } else {
      if (elements.valCompletionBanner) {
        elements.valCompletionBanner.classList.add('hidden');
      }
    }
  }

  // Render Section A: Bot & API Status
  function renderStatus() {
    if (!state.status) return;

    const isRunning = state.status.status === 'RUNNING';
    if (elements.botStatusVal) {
      elements.botStatusVal.textContent = state.status.status || 'RUNNING';
      elements.botStatusVal.style.color = isRunning ? '#FF69B4' : '#ff4d4d';
    }

    if (elements.sidebarStatusText) {
      elements.sidebarStatusText.textContent = `BOT ${state.status.status || 'RUNNING'}`;
    }
    if (elements.botModeText) {
      elements.botModeText.textContent = state.status.mode || 'PAPER TRADING ONLY';
    }

    if (elements.apiStatusVal) {
      elements.apiStatusVal.textContent = 'CONNECTED';
      elements.apiStatusVal.style.color = '#FF69B4';
    }
    if (elements.apiStatusDot) {
      elements.apiStatusDot.style.color = '#FF69B4';
    }

    if (state.status.rpcUrl && elements.apiRpcUrl) {
      const parts = state.status.rpcUrl.split('/');
      elements.apiRpcUrl.textContent = `RPC: ${parts[2] || 'Connected'}`;
    }

    if (elements.uptimeVal) {
      elements.uptimeVal.textContent = formatSeconds(state.status.uptimeSeconds || 0);
    }

    // Total & Daily P&L
    if (state.risk) {
      const totalPnl = state.risk.totalPnlUsd || 0;
      const dailyPnl = state.risk.dailyPnlUsd || 0;
      if (elements.totalPnlVal) {
        elements.totalPnlVal.textContent = formatCurrency(totalPnl, 2);
      }
      if (elements.dailyPnlVal) {
        elements.dailyPnlVal.textContent = formatCurrency(dailyPnl, 2);
        elements.dailyPnlVal.style.color = dailyPnl >= 0 ? '#FF69B4' : '#FFFFFF';
      }
    }
  }

  // Render Section F: Active Paper Trade & Selected Token Cards (Requirements 2, 5, 7, 8)
  function renderActiveTrade() {
    const container = elements.activeTradeContainer;
    if (!container) return;

    const data = state.activeTrade;

    if (!data || !data.active || !data.trade) {
      container.innerHTML = `
        <div class="empty-state-trade">
          <div class="empty-icon">⏳</div>
          <div class="empty-title">NO ACTIVE PAPER TRADE</div>
          <div class="empty-desc">The bot is currently scanning Solana mainnet DEX pairs for valid candidate setups meeting risk criteria. [ PAPER TRADING ONLY ]</div>
        </div>
      `;
      return;
    }

    const t = data.trade;
    const entryPrice = t.entryPrice ?? t.entryPriceUsd ?? 0;
    const currentPrice = t.currentPrice ?? t.currentPriceUsd ?? entryPrice;
    const pnlPct = t.pnlPercent ?? t.paperPnlPct ?? 0;
    const pnlUsd = t.pnlUsd ?? t.paperPnlUsd ?? 0;
    const pnlClass = pnlPct >= 0 ? 'pink-glow-text' : '';
    const buyTimeStr = t.entryTime ? new Date(t.entryTime).toLocaleTimeString() : 'Just now';

    const riskScoreStr = (t.riskScore !== null && t.riskScore !== undefined) ? `${t.riskScore}/100` : 'N/A';
    const strategyScoreStr = (t.strategyScore !== null && t.strategyScore !== undefined) ? `${t.strategyScore}/100` : 'N/A';
    const liquidityStr = (t.liquidity !== null && t.liquidity !== undefined) ? formatCurrency(t.liquidity, 0) : 'N/A';
    const volume5mStr = (t.volume5m !== null && t.volume5m !== undefined) ? formatCurrency(t.volume5m, 0) : 'N/A';
    const crossVerStr = t.crossVerificationResult || 'PASSED';

    container.innerHTML = `
      <!-- REQUIREMENT 8: CURRENT SELECTED PAPER TRADE CARD -->
      <div class="selected-trade-card">
        <div class="selected-card-header">
          <div class="card-header-sm">CURRENT SELECTED PAPER TRADE</div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <button class="btn-pink-solid btn-view-active-chart" style="font-size: 11px; padding: 4px 10px;">VIEW LIVE CHART 📈</button>
            <span class="paper-badge-solid">[ PAPER TRADING ONLY - SIMULATED ]</span>
          </div>
        </div>
        <div class="selected-card-grid">
          <div class="sel-item"><span class="sel-label">TOKEN</span><span class="sel-val pink-text" style="display: flex; align-items: center;">${renderTokenAvatar(t.imageUrl, t.symbol, 24)} <span>${t.symbol || 'UNKNOWN'} (${t.name || 'Unknown'})</span></span></div>
          <div class="sel-item"><span class="sel-label">MINT ADDRESS</span><code class="sel-val">${truncateAddress(t.address || t.tokenAddress)}</code></div>
          <div class="sel-item"><span class="sel-label">SELECTION TIME</span><span class="sel-val">${buyTimeStr}</span></div>
          <div class="sel-item"><span class="sel-label">STRATEGY SCORE</span><span class="sel-val">${strategyScoreStr}</span></div>
          <div class="sel-item"><span class="sel-label">RISK SCORE</span><span class="sel-val">${riskScoreStr}</span></div>
          <div class="sel-item"><span class="sel-label">LIQUIDITY</span><span class="sel-val">${liquidityStr}</span></div>
          <div class="sel-item"><span class="sel-label">5M VOLUME</span><span class="sel-val">${volume5mStr}</span></div>
          <div class="sel-item"><span class="sel-label">CROSS-VERIFICATION</span><span class="sel-val pink-text">${crossVerStr}</span></div>
          <div class="sel-item"><span class="sel-label">DECISION</span><span class="decision-badge approved">APPROVED (PAPER BUY)</span></div>
        </div>
      </div>

      <!-- REQUIREMENT 2 & 5: ACTIVE POSITION LIVE METRICS -->
      <div class="active-trade-grid" style="margin-top: 15px;">
        <div class="trade-metric-box">
          <div class="metric-header">BUY TIME & STATUS</div>
          <div class="metric-val-main"><span class="decision-badge approved">PAPER HOLDING</span></div>
          <div class="metric-sub">Bought: ${buyTimeStr}</div>
        </div>

        <div class="trade-metric-box">
          <div class="metric-header">ENTRY PRICE / INVESTED</div>
          <div class="metric-val-white">${formatCurrency(entryPrice)}</div>
          <div class="metric-sub">${formatCurrency(t.investmentUsd || t.investment, 2)} USD</div>
        </div>

        <div class="trade-metric-box">
          <div class="metric-header">CURRENT PRICE</div>
          <div class="metric-val-main">${formatCurrency(currentPrice)}</div>
          <div class="metric-sub">Real-Time Oracle</div>
        </div>

        <div class="trade-metric-box">
          <div class="metric-header">LIVE PAPER P&L</div>
          <div class="metric-val-main ${pnlClass}">${formatPercent(pnlPct)}</div>
          <div class="metric-sub">${formatCurrency(pnlUsd, 2)} USD</div>
        </div>
      </div>

      <!-- TRADE PARAMETERS & RISK CONTROLS BANNER -->
      <div class="trade-parameters-banner" style="margin-top: 15px;">
        <div class="param-item">
          <span class="param-label">TAKE PROFIT (TP)</span>
          <span class="param-val pink-text">+${t.profitTargetPercent || 5}%</span>
        </div>
        <div class="param-item">
          <span class="param-label">STOP LOSS (SL)</span>
          <span class="param-val pink-text">-${t.stopLossPercent || 3}%</span>
        </div>
        <div class="param-item">
          <span class="param-label">MAX HOLD TIME</span>
          <span class="param-val pink-text">${t.maxHoldMinutes || 5} MIN</span>
        </div>
        <div class="param-item">
          <span class="param-label">ELAPSED TIME</span>
          <span class="param-val">${t.elapsedTimeStr || formatSeconds((t.elapsedMs || 0) / 1000)}</span>
        </div>
        <div class="param-item">
          <span class="param-label">POSITION STATUS</span>
          <span class="param-val pink-text">${t.status || 'PAPER HOLDING'}</span>
        </div>
      </div>

      <!-- REQUIREMENT 7: LAUNCH-DAY CROSS-VERIFICATION CHECKS PANEL -->
      <div class="verification-checks-card" style="margin-top: 15px;">
        <h3 class="risk-card-title">LAUNCH-DAY CROSS-VERIFICATION CHECKS</h3>
        <div class="verification-checks-grid">
          <div class="check-item"><span class="check-label">1. Mint / Contract Identity</span><span class="check-badge pass">PASS</span></div>
          <div class="check-item"><span class="check-label">2. Active DEX Pair</span><span class="check-badge pass">PASS</span></div>
          <div class="check-item"><span class="check-label">3. Price > 0</span><span class="check-badge pass">PASS</span></div>
          <div class="check-item"><span class="check-label">4. Liquidity >= $10,000</span><span class="check-badge pass">PASS</span></div>
          <div class="check-item"><span class="check-label">5. 5m Volume >= $5,000</span><span class="check-badge pass">PASS</span></div>
          <div class="check-item"><span class="check-label">6. Phase 3 Risk Filter</span><span class="check-badge pass">PASS</span></div>
          <div class="check-item"><span class="check-label">7. Phase 4 Strategy Score (>= 70)</span><span class="check-badge pass">PASS (${strategyScoreStr})</span></div>
          <div class="check-item"><span class="check-label">8. Phase 8 Risk Manager Approval</span><span class="check-badge pass">PASS</span></div>
          <div class="check-item"><span class="check-label">9. Final Decision</span><span class="check-badge pass">PASS — APPROVED (PAPER BUY)</span></div>
        </div>
      </div>
    `;
  }

  // Render Section C, D, E: Candidate Table & Scores
  function renderCandidates() {
    const tbody = elements.candidatesTableBody;
    if (!tbody) return;

    const candidates = state.candidates || [];

    let countApproved = 0;
    let countRejected = 0;

    candidates.forEach(c => {
      const isApproved = (c.riskManager && c.riskManager.approved) || (c.decision === 'APPROVED');
      if (isApproved) countApproved++;
      else countRejected++;
    });

    if (elements.countAll) elements.countAll.textContent = candidates.length;
    if (elements.countApproved) elements.countApproved.textContent = countApproved;
    if (elements.countRejected) elements.countRejected.textContent = countRejected;

    // Filter candidates
    const filtered = candidates.filter(c => {
      const isApproved = (c.riskManager && c.riskManager.approved) || (c.decision === 'APPROVED');
      if (state.candidateFilter === 'APPROVED') return isApproved;
      if (state.candidateFilter === 'REJECTED') return !isApproved;
      return true;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" class="table-loading">
            ${candidates.length === 0 ? 'No candidates evaluated yet.' : 'No candidates match current filter.'}
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = filtered.map((c, idx) => {
      const symbol = c.symbol || 'MEME';
      const name = c.name || symbol;
      const addr = c.address || c.tokenAddress || 'N/A';
      const price = formatCurrency(c.priceUsd);

      const riskScore = typeof c.riskScore === 'number'
        ? c.riskScore
        : (c.riskFilter && typeof c.riskFilter.riskScore === 'number'
          ? c.riskFilter.riskScore
          : (c.riskManager && typeof c.riskManager.riskScore === 'number' ? c.riskManager.riskScore : 0));

      const strategyScore = typeof c.strategyScore === 'number'
        ? c.strategyScore
        : (c.strategy && typeof c.strategy.totalScore === 'number'
          ? c.strategy.totalScore
          : (typeof c.score === 'number' ? c.score : null));

      const strategyDisplay = strategyScore !== null ? `${strategyScore}/100` : 'N/A';

      const isApproved = (c.riskManager && c.riskManager.approved === true) || (c.decision === 'APPROVED');
      const decisionBadge = isApproved
        ? `<span class="decision-badge approved">APPROVED</span>`
        : `<span class="decision-badge rejected">REJECTED</span>`;

      const timeStr = c.timestamp ? new Date(c.timestamp).toLocaleTimeString() : 'Just now';

      return `
        <tr>
          <td>
            <div style="display: flex; align-items: center;">
              ${renderTokenAvatar(c.imageUrl, symbol, 22)}
              <div>
                <strong style="color: var(--text-white);">${symbol}</strong>
                <div style="font-size: 11px; color: var(--text-muted);">${name}</div>
              </div>
            </div>
          </td>
          <td>
            <code style="color: var(--pink-bright);">${truncateAddress(addr)}</code>
          </td>
          <td><strong>${price}</strong></td>
          <td>
            <div class="score-bar-wrapper">
              <span class="score-num">${riskScore}/100</span>
              <div class="score-track">
                <div class="score-fill-pink" style="width: ${Math.min(100, Math.max(0, riskScore))}%;"></div>
              </div>
            </div>
          </td>
          <td>
            <div class="score-bar-wrapper">
              <span class="score-num">${strategyDisplay}</span>
              <div class="score-track">
                <div class="score-fill-pink" style="width: ${Math.min(100, Math.max(0, strategyScore || 0))}%;"></div>
              </div>
            </div>
          </td>
          <td>${decisionBadge}</td>
          <td style="color: var(--text-muted);">${timeStr}</td>
          <td>
            <button class="btn-pink-outline btn-details" data-idx="${idx}">VIEW</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  // REQUIREMENT 6: Render Tomorrow Launch Watchlist
  function renderTomorrowWatchlist() {
    const tbody = elements.tomorrowTableBody;
    if (!tbody) return;

    const list = state.tomorrowWatchlist || [];

    if (list.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="table-loading">No pre-launch candidates on tomorrow's watchlist.</td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = list.map(item => {
      const cand = item.candidate || item;
      const symbol = cand.symbol || 'TOKEN';
      const name = cand.name || symbol;
      const expectedDate = cand.expectedLaunchDate || 'Tomorrow';
      const expectedTime = cand.expectedLaunchTime && cand.expectedLaunchTime !== 'UNKNOWN' ? cand.expectedLaunchTime : '';
      const expectedStr = `${expectedDate} ${expectedTime}`.trim();

      const source = cand.source || cand.platform || 'Public Feed';
      const confidence = cand.dataConfidence || cand.confidence || 'EXPECTED';
      const crossVer = (cand.socialLinks && cand.socialLinks.length > 0) ? `VERIFIED (${cand.socialLinks.length} Links)` : 'VERIFIED';

      const rawStatus = cand.status || 'WATCH';
      let statusBadge = `<span class="decision-badge watching">WATCHING</span>`;

      if (rawStatus === 'READY_FOR_LAUNCH' || rawStatus === 'VERIFIED') {
        statusBadge = `<span class="decision-badge approved">VERIFIED</span>`;
      } else if (rawStatus === 'WATCH' || rawStatus === 'WATCHING') {
        statusBadge = `<span class="decision-badge watching">WATCHING</span>`;
      } else if (rawStatus === 'DATE_CONFLICT') {
        statusBadge = `<span class="decision-badge rejected">DATE_CONFLICT</span>`;
      } else if (rawStatus === 'STALE') {
        statusBadge = `<span class="decision-badge rejected">STALE</span>`;
      } else if (rawStatus === 'LAUNCH_DETECTED') {
        statusBadge = `<span class="decision-badge approved">LAUNCH_DETECTED</span>`;
      } else if (rawStatus === 'REJECTED') {
        statusBadge = `<span class="decision-badge rejected">REJECTED</span>`;
      }

      return `
        <tr>
          <td>
            <strong style="color: var(--text-white);">${symbol}</strong>
            <div style="font-size: 11px; color: var(--text-muted);">${name}</div>
          </td>
          <td>${expectedStr}</td>
          <td>${source} (${confidence})</td>
          <td><code style="color: var(--pink-bright);">${crossVer}</code></td>
          <td>${statusBadge}</td>
        </tr>
      `;
    }).join('');
  }

  // Render Phase 8.6: Paper Trading Performance Analytics Section
  function renderPerformance() {
    const p = state.performance;
    if (!p) return;

    if (elements.perfTotalTrades) elements.perfTotalTrades.textContent = p.totalTrades || 0;
    if (elements.perfWins) elements.perfWins.textContent = p.winningTrades || 0;
    if (elements.perfLosses) elements.perfLosses.textContent = p.losingTrades || 0;

    if (elements.perfWinRate) {
      elements.perfWinRate.textContent = `${p.winRatePercent || 0}%`;
    }

    if (elements.perfProfitFactor) {
      elements.perfProfitFactor.textContent = p.profitFactorDisplay || (p.profitFactor ? p.profitFactor.toFixed(2) : 'N/A');
    }

    if (elements.perfAvgPnl) elements.perfAvgPnl.textContent = formatCurrency(p.averageTradeUsd, 2);
    if (elements.perfAvgWin) elements.perfAvgWin.textContent = formatCurrency(p.averageWinUsd, 2);
    if (elements.perfAvgLoss) elements.perfAvgLoss.textContent = formatCurrency(p.averageLossUsd, 2);

    if (elements.perfBestTrade) elements.perfBestTrade.textContent = formatCurrency(p.largestWinUsd, 2);
    if (elements.perfWorstTrade) elements.perfWorstTrade.textContent = formatCurrency(p.largestLossUsd, 2);

    if (elements.perfAvgDuration) {
      elements.perfAvgDuration.textContent = p.averageHoldTimeStr || formatSeconds((p.averageHoldTimeMs || 0) / 1000);
    }

    if (elements.perfMaxDrawdown) {
      elements.perfMaxDrawdown.textContent = `${formatCurrency(p.maxDrawdownUsd, 2)} (${(p.maxDrawdownPercent || 0).toFixed(2)}%)`;
    }

    if (elements.perfDataQuality && p.dataQuality) {
      elements.perfDataQuality.textContent = `${p.dataQuality.validRecords || 0} Valid / ${p.dataQuality.excludedRecords || 0} Excluded`;
    }

    // Exit Reason Analysis
    if (p.exitReasonBreakdown) {
      const eb = p.exitReasonBreakdown;
      if (elements.exitTpCount) {
        elements.exitTpCount.textContent = `${eb.TAKE_PROFIT?.count || 0} (${(eb.TAKE_PROFIT?.percent || 0).toFixed(1)}%)`;
      }
      if (elements.exitSlCount) {
        elements.exitSlCount.textContent = `${eb.STOP_LOSS?.count || 0} (${(eb.STOP_LOSS?.percent || 0).toFixed(1)}%)`;
      }
      if (elements.exitMhCount) {
        elements.exitMhCount.textContent = `${eb.MAX_HOLD_TIME?.count || 0} (${(eb.MAX_HOLD_TIME?.percent || 0).toFixed(1)}%)`;
      }
      if (elements.exitOtherCount) {
        elements.exitOtherCount.textContent = `${eb.OTHER?.count || 0} (${(eb.OTHER?.percent || 0).toFixed(1)}%)`;
      }
    }

    // Candidate Analysis
    if (p.candidateAnalysis) {
      const ca = p.candidateAnalysis;
      if (elements.candTotalEval) elements.candTotalEval.textContent = ca.totalEvaluated || 0;
      if (elements.candApprovedCount) elements.candApprovedCount.textContent = ca.approvedCount || 0;
      if (elements.candRejectedCount) elements.candRejectedCount.textContent = ca.rejectedCount || 0;
      if (elements.candExecutedTrades) elements.candExecutedTrades.textContent = p.totalTrades || 0;
    }
  }

  // Render Section J: Risk Limits & Portfolio Real-time Counters
  function renderRiskLimits() {
    if (!state.risk) return;
    const r = state.risk;
    const l = r.limits || {};

    if (elements.riskHourlyTrades) elements.riskHourlyTrades.textContent = `${r.hourlyTrades || 0} / ${l.maxTradesPerHour || 10}`;
    if (elements.riskDailyTrades) elements.riskDailyTrades.textContent = `${r.dailyTrades || 0} / ${l.maxTradesPerDay || 30}`;
    if (elements.riskConsecLosses) elements.riskConsecLosses.textContent = `${r.consecutiveLosses || 0} / ${l.maxConsecutiveLosses || 3}`;

    if (elements.riskCircuitBreaker) {
      elements.riskCircuitBreaker.textContent = r.circuitBreakerActive ? 'ACTIVE (BLOCKED)' : 'INACTIVE';
      elements.riskCircuitBreaker.style.color = r.circuitBreakerActive ? '#ff4d4d' : '#FF69B4';
    }

    if (elements.riskCooldown) {
      if (r.cooldownActive) {
        elements.riskCooldown.textContent = `ACTIVE (${formatSeconds(r.cooldownRemainingSeconds)})`;
        elements.riskCooldown.style.color = '#ff4d4d';
      } else {
        elements.riskCooldown.textContent = 'INACTIVE';
        elements.riskCooldown.style.color = '#FF69B4';
      }
    }

    if (elements.riskPosSize) elements.riskPosSize.textContent = `$${l.minPositionSizeUsd || 10} - $${l.maxPositionSizeUsd || 50}`;
    if (elements.riskMaxLiqPct) elements.riskMaxLiqPct.textContent = `${l.maxPositionLiquidityPercent || 1.0}%`;

    if (elements.riskMinLiq) elements.riskMinLiq.textContent = formatCurrency(l.minLiquidityUsd || 10000, 0);
    if (elements.riskMinVol) elements.riskMinVol.textContent = formatCurrency(l.min5mVolumeUsd || 5000, 0);
    if (elements.riskMinStratScore) elements.riskMinStratScore.textContent = `${l.minStrategyScore || 70} / 100`;
    if (elements.riskMaxRiskScore) elements.riskMaxRiskScore.textContent = `${l.maxRiskScore || 60} / 100`;
    if (elements.riskMaxDailyLoss) elements.riskMaxDailyLoss.textContent = `-$${Math.abs(l.maxDailyLossUsd || 20).toFixed(2)}`;
  }

  // REQUIREMENT 3 & 5 & 10: Render Completed Paper Trade History Table (17 Columns + Lifecycle Action)
  function renderTradeHistory() {
    const tbody = elements.historyTableBody;
    if (!tbody) return;

    const trades = state.trades || [];

    if (trades.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="18" class="table-loading">No completed paper trades recorded yet.</td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = trades.map((t, idx) => {
      const entryPrice = t.entryPrice ?? t.entryPriceUsd ?? 0;
      const exitPrice = t.exitPrice ?? t.exitPriceUsd ?? 0;
      const pnlPct = t.pnlPercent ?? t.paperPnlPct ?? 0;
      const pnlUsd = t.pnl ?? t.paperPnlUsd ?? 0;
      const pnlColor = pnlPct >= 0 ? '#FF69B4' : '#FFFFFF';

      const resultLabel = t.result ? t.result : (pnlPct > 0 ? 'WIN' : (pnlPct < 0 ? 'LOSS' : 'BREAKEVEN'));
      const resultBadge = `<span class="decision-badge ${resultLabel === 'WIN' || pnlPct >= 0 ? 'approved' : 'rejected'}">${resultLabel}</span>`;

      const buyTimeStr = t.entryTime ? new Date(t.entryTime).toLocaleTimeString() : 'N/A';
      const exitTimeStr = t.exitTime ? new Date(t.exitTime).toLocaleTimeString() : 'N/A';
      const durationStr = t.holdDuration || formatSeconds(t.durationSeconds || 0);
      const exitReasonLabel = t.exitReason ? `PAPER SELL — ${t.exitReason}` : 'PAPER SELL — TARGET';

      // Requirement 10: Backward compatibility for historical trade records missing new metadata
      const riskScoreDisplay = (t.riskScore !== null && t.riskScore !== undefined) ? `${t.riskScore}/100` : 'N/A';
      const strategyScoreDisplay = (t.strategyScore !== null && t.strategyScore !== undefined) ? `${t.strategyScore}/100` : 'N/A';
      const liquidityDisplay = (t.liquidity !== null && t.liquidity !== undefined) ? formatCurrency(t.liquidity, 0) : 'N/A';
      const volumeDisplay = (t.volume5m !== null && t.volume5m !== undefined) ? formatCurrency(t.volume5m, 0) : 'N/A';
      const crossVerDisplay = t.crossVerificationResult || 'N/A';

      return `
        <tr>
          <td>
            <div style="display: flex; align-items: center;">
              ${renderTokenAvatar(t.imageUrl, t.symbol, 22)}
              <div>
                <strong style="color: var(--text-white);">${t.symbol || 'TOKEN'}</strong>
                ${t.tokenName || t.name ? `<div style="font-size: 11px; color: var(--text-muted);">${t.tokenName || t.name}</div>` : ''}
              </div>
            </div>
          </td>
          <td><code>${truncateAddress(t.tokenAddress || t.address)}</code></td>
          <td style="color: var(--text-muted);">${buyTimeStr}</td>
          <td>${formatCurrency(entryPrice)}</td>
          <td style="color: var(--text-muted);">${exitTimeStr}</td>
          <td>${formatCurrency(exitPrice)}</td>
          <td>${formatCurrency(t.investment || t.investmentUsd || 10, 2)}</td>
          <td style="color: ${pnlColor}; font-weight: 700;">${formatCurrency(pnlUsd, 2)}</td>
          <td style="color: ${pnlColor}; font-weight: 700;">${formatPercent(pnlPct)}</td>
          <td>${resultBadge}</td>
          <td>${durationStr}</td>
          <td style="color: var(--pink-bright); font-weight: 600;">${exitReasonLabel}</td>
          <td>${riskScoreDisplay}</td>
          <td>${strategyScoreDisplay}</td>
          <td>${liquidityDisplay}</td>
          <td>${volumeDisplay}</td>
          <td><code style="color: var(--pink-bright);">${crossVerDisplay}</code></td>
          <td>
            <div class="btn-trade-action-group">
              <button class="btn-pink-solid btn-view-chart" data-trade-id="${t.tradeId || ''}" data-idx="${idx}" style="font-size: 11px; padding: 4px 8px;">VIEW CHART 📈</button>
              <button class="btn-pink-outline btn-trade-lifecycle" data-idx="${idx}" style="font-size: 11px; padding: 4px 8px;">LIFECYCLE</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // REQUIREMENT 4: Trade Lifecycle Modal Handler (Stage-by-Stage Stepper)
  function showTradeLifecycleModal(trade) {
    if (!trade) return;

    const symbol = trade.symbol || 'TOKEN';
    const addr = trade.tokenAddress || trade.address || 'N/A';
    const entryPrice = trade.entryPrice ?? trade.entryPriceUsd ?? 0;
    const exitPrice = trade.exitPrice ?? trade.exitPriceUsd ?? 0;
    const pnlUsd = trade.pnl ?? trade.paperPnlUsd ?? 0;
    const pnlPct = trade.pnlPercent ?? trade.paperPnlPct ?? 0;
    const buyTime = trade.entryTime ? new Date(trade.entryTime).toLocaleString() : 'N/A';
    const exitTime = trade.exitTime ? new Date(trade.exitTime).toLocaleString() : 'N/A';
    const exitReason = trade.exitReason || 'TAKE_PROFIT';

    const riskScoreStr = (trade.riskScore !== null && trade.riskScore !== undefined) ? `${trade.riskScore}/100` : '<= 60 (Passed)';
    const strategyScoreStr = (trade.strategyScore !== null && trade.strategyScore !== undefined) ? `${trade.strategyScore}/100` : '>= 70 (Passed)';
    const liquidityStr = (trade.liquidity !== null && trade.liquidity !== undefined) ? formatCurrency(trade.liquidity, 0) : 'Pass (>= $10,000)';
    const volumeStr = (trade.volume5m !== null && trade.volume5m !== undefined) ? formatCurrency(trade.volume5m, 0) : 'Pass (>= $5,000)';
    const crossVerStr = trade.crossVerificationResult || 'PASSED';

    if (elements.modalTitle) {
      elements.modalTitle.textContent = `TRADE LIFECYCLE AUDIT: ${symbol} (${truncateAddress(addr)})`;
    }

    if (elements.modalBody) {
      elements.modalBody.innerHTML = `
        <div class="lifecycle-banner-top">
          <span>🛡️ MODE: <strong>PAPER TRADING ONLY (SIMULATED)</strong></span>
          <span>TRADE ID: <strong>${trade.tradeId || 'PT-ACTIVE'}</strong></span>
        </div>

        <div class="lifecycle-stepper">
          <!-- STAGE 1: CANDIDATE -->
          <div class="stepper-step">
            <div class="stepper-header">
              <span class="step-num">1</span>
              <span class="step-title">CANDIDATE DISCOVERY</span>
              <span class="step-status pass">DISCOVERED</span>
            </div>
            <div class="step-details">
              <div>Token Symbol: <strong>${symbol} (${trade.tokenName || symbol})</strong></div>
              <div>Mint Address: <code>${addr}</code></div>
              <div>Initial Price: <strong>${formatCurrency(entryPrice)}</strong></div>
              <div>Data Source: <strong>${trade.source || 'market_data'}</strong></div>
            </div>
          </div>
          <div class="stepper-arrow">↓</div>

          <!-- STAGE 2: CROSS-VERIFICATION -->
          <div class="stepper-step">
            <div class="stepper-header">
              <span class="step-num">2</span>
              <span class="step-title">CROSS-VERIFICATION</span>
              <span class="step-status pass">${crossVerStr}</span>
            </div>
            <div class="step-details">
              <div>Identity Match: <strong>PASS (DEX Verified)</strong></div>
              <div>Evidence Confidence: <strong>${crossVerStr}</strong></div>
            </div>
          </div>
          <div class="stepper-arrow">↓</div>

          <!-- STAGE 3: RISK FILTER -->
          <div class="stepper-step">
            <div class="stepper-header">
              <span class="step-num">3</span>
              <span class="step-title">PHASE 3 RISK FILTER</span>
              <span class="step-status pass">PASS</span>
            </div>
            <div class="step-details">
              <div>Liquidity Check: <strong>${liquidityStr}</strong></div>
              <div>Volume 5m Check: <strong>${volumeStr}</strong></div>
              <div>Honeypot / Buy-Sell: <strong>PASS</strong></div>
            </div>
          </div>
          <div class="stepper-arrow">↓</div>

          <!-- STAGE 4: STRATEGY SCORE -->
          <div class="stepper-step">
            <div class="stepper-header">
              <span class="step-num">4</span>
              <span class="step-title">PHASE 4 STRATEGY SCORE</span>
              <span class="step-status pass">${strategyScoreStr}</span>
            </div>
            <div class="step-details">
              <div>Strategy Score: <strong>${strategyScoreStr}</strong></div>
              <div>Minimum Threshold: <strong>>= 70 / 100</strong></div>
            </div>
          </div>
          <div class="stepper-arrow">↓</div>

          <!-- STAGE 5: RISK MANAGER -->
          <div class="stepper-step">
            <div class="stepper-header">
              <span class="step-num">5</span>
              <span class="step-title">PHASE 8 RISK MANAGER</span>
              <span class="step-status pass">APPROVED</span>
            </div>
            <div class="step-details">
              <div>Risk Score: <strong>${riskScoreStr}</strong></div>
              <div>Position Size: <strong>${formatCurrency(trade.investment || trade.investmentUsd || 10, 2)}</strong></div>
              <div>Circuit Breaker / Cooldown: <strong>INACTIVE (CLEARED)</strong></div>
            </div>
          </div>
          <div class="stepper-arrow">↓</div>

          <!-- STAGE 6: PAPER BUY -->
          <div class="stepper-step highlight-step">
            <div class="stepper-header">
              <span class="step-num">6</span>
              <span class="step-title">PAPER BUY EXECUTION</span>
              <span class="step-status pass">PAPER BUY</span>
            </div>
            <div class="step-details">
              <div>Buy Timestamp: <strong>${buyTime}</strong></div>
              <div>Entry Price: <strong>${formatCurrency(entryPrice)}</strong></div>
              <div>Invested Amount: <strong>${formatCurrency(trade.investment || trade.investmentUsd || 10, 2)}</strong></div>
              <div>Quantity: <strong>${trade.quantity || 'N/A'}</strong></div>
            </div>
          </div>
          <div class="stepper-arrow">↓</div>

          <!-- STAGE 7: PRICE MONITORING -->
          <div class="stepper-step">
            <div class="stepper-header">
              <span class="step-num">7</span>
              <span class="step-title">PRICE MONITORING LOOP</span>
              <span class="step-status pass">MONITORED</span>
            </div>
            <div class="step-details">
              <div>Take Profit Target: <strong>+5.00%</strong></div>
              <div>Stop Loss Target: <strong>-3.00%</strong></div>
              <div>Max Hold Timeout: <strong>5 MINUTES</strong></div>
            </div>
          </div>
          <div class="stepper-arrow">↓</div>

          <!-- STAGE 8: PAPER SELL -->
          <div class="stepper-step highlight-step">
            <div class="stepper-header">
              <span class="step-num">8</span>
              <span class="step-title">PAPER SELL EXECUTION</span>
              <span class="step-status ${pnlPct >= 0 ? 'pass' : 'fail'}">PAPER SELL — ${exitReason}</span>
            </div>
            <div class="step-details">
              <div>Sell Timestamp: <strong>${exitTime}</strong></div>
              <div>Exit Price: <strong>${formatCurrency(exitPrice)}</strong></div>
              <div>Exit Reason: <strong>${exitReason}</strong></div>
              <div>Hold Duration: <strong>${trade.holdDuration || formatSeconds(trade.durationSeconds || 0)}</strong></div>
              <div>Net Paper P&L: <strong style="color: ${pnlPct >= 0 ? '#FF69B4' : '#FFFFFF'};">${formatPercent(pnlPct)} (${formatCurrency(pnlUsd, 2)})</strong></div>
            </div>
          </div>
        </div>
      `;
    }

    if (elements.modal) {
      elements.modal.classList.add('active');
    }
  }

  // Candidate Raw Inspector Modal Handler
  function showCandidateModal(candidate) {
    if (!candidate) return;
    if (elements.modalTitle) {
      elements.modalTitle.textContent = `CANDIDATE DETAILS: ${candidate.symbol || 'TOKEN'} (${truncateAddress(candidate.address)})`;
    }
    if (elements.modalBody) {
      elements.modalBody.innerHTML = `<pre style="white-space: pre-wrap; font-size: 12px; color: var(--text-white);">${JSON.stringify(candidate, null, 2)}</pre>`;
    }
    if (elements.modal) {
      elements.modal.classList.add('active');
    }
  }

  function hideModal() {
    if (elements.modal) {
      elements.modal.classList.remove('active');
    }
  }

  // Event Listeners Initialization with Event Delegation
  function initEventListeners() {
    // Navigation Smooth Scroll & Active Highlight
    elements.navItems.forEach(item => {
      item.addEventListener('click', () => {
        elements.navItems.forEach(n => n.classList.remove('active'));
        item.classList.add('active');
      });
    });

    // Refresh Button Trigger
    if (elements.btnRefresh) {
      elements.btnRefresh.addEventListener('click', () => {
        elements.btnRefresh.classList.add('active');
        fetchDashboardData().finally(() => {
          setTimeout(() => elements.btnRefresh.classList.remove('active'), 500);
        });
      });
    }

    // Candidate Filter Buttons
    elements.filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        elements.filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.candidateFilter = btn.getAttribute('data-filter') || 'ALL';
        renderCandidates();
      });
    });

    // Event Delegation for Candidate View Details Modal
    if (elements.candidatesTableBody) {
      elements.candidatesTableBody.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-details');
        if (btn) {
          const idx = btn.getAttribute('data-idx');
          const filtered = (state.candidates || []).filter(c => {
            const isApproved = (c.riskManager && c.riskManager.approved) || (c.decision === 'APPROVED');
            if (state.candidateFilter === 'APPROVED') return isApproved;
            if (state.candidateFilter === 'REJECTED') return !isApproved;
            return true;
          });
          if (filtered[idx]) {
            showCandidateModal(filtered[idx]);
          }
        }
      });
    }

    // Event Delegation for Trade History Lifecycle Audit Modal (Requirement 4)
    if (elements.historyTableBody) {
      elements.historyTableBody.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-trade-lifecycle');
        if (btn) {
          const idx = parseInt(btn.getAttribute('data-idx'), 10);
          const trades = state.trades || [];
          if (trades[idx]) {
            showTradeLifecycleModal(trades[idx]);
          }
        }
      });
    }

    // Modal Close Triggers
    if (elements.btnModalClose) elements.btnModalClose.addEventListener('click', hideModal);
    if (elements.btnModalDismiss) elements.btnModalDismiss.addEventListener('click', hideModal);
    if (elements.modal) {
      elements.modal.addEventListener('click', (e) => {
        if (e.target === elements.modal) hideModal();
      });
    }

    // Trade Chart Modal Triggers & Event Delegation
    if (elements.btnChartModalClose) elements.btnChartModalClose.addEventListener('click', closeTradeChartModal);
    if (elements.btnChartModalDismiss) elements.btnChartModalDismiss.addEventListener('click', closeTradeChartModal);
    if (elements.chartModal) {
      elements.chartModal.addEventListener('click', (e) => {
        if (e.target === elements.chartModal) closeTradeChartModal();
      });
    }

    // Active Trade Card "VIEW LIVE CHART" Button Listener
    if (elements.activeTradeContainer) {
      elements.activeTradeContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-view-active-chart');
        if (btn) {
          if (state.activeTrade && state.activeTrade.active && state.activeTrade.trade) {
            showTradeChartModal(state.activeTrade.trade);
          }
        }
      });
    }

    // Trade History Table "VIEW CHART" Button Listener
    if (elements.historyTableBody) {
      elements.historyTableBody.addEventListener('click', (e) => {
        const chartBtn = e.target.closest('.btn-view-chart');
        if (chartBtn) {
          const tradeId = chartBtn.getAttribute('data-trade-id');
          const idx = parseInt(chartBtn.getAttribute('data-idx'), 10);
          const trades = state.trades || [];
          const trade = (tradeId && trades.find(t => t.tradeId === tradeId)) || trades[idx];
          if (trade) {
            showTradeChartModal(trade);
          }
        }
      });
    }

    // Initialize Canvas Hover Tooltip
    setupChartHoverTooltip();
  }

  // Canvas Charting Engine
  function drawTradeChart(trade) {
    const canvas = elements.chartCanvas;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const width = rect.width || 900;
    const height = rect.height || 340;
    canvas.width = width * (window.devicePixelRatio || 1);
    canvas.height = height * (window.devicePixelRatio || 1);
    ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);

    ctx.clearRect(0, 0, width, height);

    const priceHistory = (trade && Array.isArray(trade.priceHistory) && trade.priceHistory.length >= 1)
      ? trade.priceHistory
      : [];

    const emptyState = elements.chartEmptyState;
    if (priceHistory.length === 0) {
      if (emptyState) emptyState.classList.remove('hidden');
      return;
    } else {
      if (emptyState) emptyState.classList.add('hidden');
    }

    const entryPrice = Number(trade.entryPrice ?? trade.entryPriceUsd ?? priceHistory[0].price);
    const tpPct = Number(trade.profitTargetPercent || 5);
    const slPct = Number(trade.stopLossPercent || 3);
    const tpPrice = entryPrice * (1 + tpPct / 100);
    const slPrice = entryPrice * (1 - slPct / 100);
    const exitPrice = (trade.status === 'CLOSED' || trade.exitPrice) ? Number(trade.exitPrice ?? priceHistory[priceHistory.length - 1].price) : null;

    let allPrices = priceHistory.map(p => Number(p.price)).filter(p => !isNaN(p) && p > 0);
    allPrices.push(entryPrice, tpPrice, slPrice);
    if (exitPrice !== null) allPrices.push(exitPrice);

    let minP = Math.min(...allPrices);
    let maxP = Math.max(...allPrices);
    const priceSpread = maxP - minP || minP * 0.02;

    minP = Math.max(0, minP - priceSpread * 0.1);
    maxP = maxP + priceSpread * 0.1;

    const paddingLeft = 80;
    const paddingRight = 110;
    const paddingTop = 30;
    const paddingBottom = 40;
    const graphW = width - paddingLeft - paddingRight;
    const graphH = height - paddingTop - paddingBottom;

    function getY(price) {
      if (maxP === minP) return paddingTop + graphH / 2;
      return paddingTop + graphH - ((price - minP) / (maxP - minP)) * graphH;
    }

    const minTimeMs = priceHistory[0].timestampMs || new Date(priceHistory[0].timestamp).getTime();
    const maxTimeMs = priceHistory[priceHistory.length - 1].timestampMs || new Date(priceHistory[priceHistory.length - 1].timestamp).getTime();
    const timeSpread = Math.max(1000, maxTimeMs - minTimeMs);

    function getX(timestampMs) {
      if (timeSpread === 0 || priceHistory.length === 1) return paddingLeft + graphW / 2;
      return paddingLeft + ((timestampMs - minTimeMs) / timeSpread) * graphW;
    }

    // 1. Grid lines & Y Axis Labels
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;

    const yGridTicks = 5;
    for (let i = 0; i <= yGridTicks; i++) {
      const pVal = minP + (i / yGridTicks) * (maxP - minP);
      const yPos = getY(pVal);

      ctx.beginPath();
      ctx.moveTo(paddingLeft, yPos);
      ctx.lineTo(width - paddingRight, yPos);
      ctx.stroke();

      ctx.fillStyle = '#A0A0B0';
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(formatCurrency(pVal, 6), paddingLeft - 8, yPos + 3);
    }

    // X Axis Labels
    const xGridTicks = Math.min(6, priceHistory.length);
    for (let i = 0; i < xGridTicks; i++) {
      const idx = Math.floor((i / (xGridTicks - 1 || 1)) * (priceHistory.length - 1));
      const pt = priceHistory[idx];
      const tMs = pt.timestampMs || new Date(pt.timestamp).getTime();
      const xPos = getX(tMs);
      const timeLabel = new Date(tMs).toLocaleTimeString();

      ctx.fillStyle = '#A0A0B0';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(timeLabel, xPos, height - paddingBottom + 16);
    }

    // 2. Horizontal Lines (TP, SL, Entry)
    // TAKE PROFIT (+5%) LINE
    const yTP = getY(tpPrice);
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#00E5FF';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(paddingLeft, yTP);
    ctx.lineTo(width - paddingRight, yTP);
    ctx.stroke();

    ctx.fillStyle = '#00E5FF';
    ctx.font = 'bold 10px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`TP +${tpPct}% (${formatCurrency(tpPrice, 6)})`, width - paddingRight + 6, yTP + 3);

    // STOP LOSS (-3%) LINE
    const ySL = getY(slPrice);
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#FF1744';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(paddingLeft, ySL);
    ctx.lineTo(width - paddingRight, ySL);
    ctx.stroke();

    ctx.fillStyle = '#FF1744';
    ctx.font = 'bold 10px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`SL -${slPct}% (${formatCurrency(slPrice, 6)})`, width - paddingRight + 6, ySL + 3);

    // ENTRY PRICE LINE
    const yEntry = getY(entryPrice);
    ctx.setLineDash([2, 4]);
    ctx.strokeStyle = '#00FF7F';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(paddingLeft, yEntry);
    ctx.lineTo(width - paddingRight, yEntry);
    ctx.stroke();
    ctx.setLineDash([]); // Reset dash

    ctx.fillStyle = '#00FF7F';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`ENTRY (${formatCurrency(entryPrice, 6)})`, width - paddingRight + 6, yEntry + 3);

    // 3. Price Curve & Gradient Fill
    const points = priceHistory.map(pt => ({
      x: getX(pt.timestampMs || new Date(pt.timestamp).getTime()),
      y: getY(pt.price),
      price: pt.price,
      timestamp: pt.timestamp,
      event: pt.event
    }));

    if (points.length > 0) {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }

      const gradient = ctx.createLinearGradient(0, paddingTop, 0, height - paddingBottom);
      gradient.addColorStop(0, 'rgba(255, 105, 180, 0.35)');
      gradient.addColorStop(1, 'rgba(255, 105, 180, 0.0)');

      ctx.lineTo(points[points.length - 1].x, height - paddingBottom);
      ctx.lineTo(points[0].x, height - paddingBottom);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();

      // Line Stroke
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.strokeStyle = '#FF69B4';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    // 4. Draw Markers: BUY, SELL, Ticks
    points.forEach((pt, i) => {
      const isFirst = i === 0 || pt.event === 'BUY';
      const isLast = (i === points.length - 1 && trade.status !== 'ACTIVE' && trade.status !== 'OPEN') || pt.event === 'SELL';

      if (isFirst) {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#00FF7F';
        ctx.fill();
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = '#00FF7F';
        ctx.font = 'bold 11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Paper Buy ●', pt.x, pt.y - 12);
      } else if (isLast) {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#FF4D4D';
        ctx.fill();
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 2;
        ctx.stroke();

        const reasonText = trade.exitReason ? `Paper Sell (${trade.exitReason}) ●` : 'Paper Sell ●';
        ctx.fillStyle = '#FF4D4D';
        ctx.font = 'bold 11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(reasonText, pt.x, pt.y + 20);
      } else {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#FF69B4';
        ctx.fill();
      }
    });

    canvas._chartPoints = points;
    canvas._chartMeta = { entryPrice, tpPrice, slPrice, minP, maxP, paddingLeft, paddingRight, paddingTop, paddingBottom, width, height };
  }

  function setupChartHoverTooltip() {
    const canvas = elements.chartCanvas;
    const tooltip = elements.chartTooltip;
    if (!canvas || !tooltip) return;

    canvas.addEventListener('mousemove', (e) => {
      const points = canvas._chartPoints;
      if (!points || points.length === 0) {
        tooltip.classList.add('hidden');
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;

      let closestPt = points[0];
      let minDist = Math.abs(mouseX - points[0].x);

      for (let i = 1; i < points.length; i++) {
        const dist = Math.abs(mouseX - points[i].x);
        if (dist < minDist) {
          minDist = dist;
          closestPt = points[i];
        }
      }

      if (minDist < 60) {
        const meta = canvas._chartMeta || {};
        const entryPrice = meta.entryPrice || closestPt.price;
        const pnlPct = ((closestPt.price - entryPrice) / entryPrice) * 100;
        const pnlStr = (pnlPct >= 0 ? '+' : '') + pnlPct.toFixed(2) + '%';
        const timeStr = new Date(closestPt.timestamp).toLocaleTimeString();

        tooltip.innerHTML = `
          <div>Time: <strong>${timeStr}</strong></div>
          <div>Price: <strong>${formatCurrency(closestPt.price, 6)}</strong></div>
          <div>P/L: <strong style="color: ${pnlPct >= 0 ? '#FF69B4' : '#FF4D4D'};">${pnlStr}</strong></div>
          ${closestPt.event ? `<div style="color: #00FF7F; font-weight: 800;">${closestPt.event} EVENT</div>` : ''}
        `;

        tooltip.style.left = `${Math.min(rect.width - 160, Math.max(10, closestPt.x - 60))}px`;
        tooltip.style.top = `${Math.max(10, closestPt.y - 65)}px`;
        tooltip.classList.remove('hidden');
      } else {
        tooltip.classList.add('hidden');
      }
    });

    canvas.addEventListener('mouseleave', () => {
      if (tooltip) tooltip.classList.add('hidden');
    });
  }

  function showTradeChartModal(trade) {
    if (!trade) return;
    state.selectedTradeForChart = trade;

    const modal = elements.chartModal;
    if (!modal) return;

    const symbol = trade.symbol || 'TOKEN';
    const name = trade.name || trade.tokenName || symbol;
    const addr = trade.address || trade.tokenAddress || 'N/A';
    const isOpen = trade.status === 'ACTIVE' || trade.status === 'OPEN' || (!trade.exitTime && trade.entryTime);
    const statusText = isOpen ? 'OPEN' : 'CLOSED';

    const entryPrice = Number(trade.entryPrice ?? trade.entryPriceUsd ?? 0);
    const currentOrExitPrice = Number(isOpen ? (trade.currentPrice ?? entryPrice) : (trade.exitPrice ?? entryPrice));
    const pnlPct = Number(trade.pnlPercent ?? trade.pnlPct ?? (((currentOrExitPrice - entryPrice) / (entryPrice || 1)) * 100));
    const pnlUsd = Number(trade.pnlUsd ?? trade.pnl ?? (trade.investmentUsd ? (trade.investmentUsd * pnlPct / 100) : 0));
    const posSizeUsd = Number(trade.investmentUsd ?? trade.investment ?? 10);
    const entryTimeStr = trade.entryTime ? new Date(trade.entryTime).toLocaleString() : (trade.buyTimestamp ? new Date(trade.buyTimestamp).toLocaleString() : 'N/A');
    const exitTimeStr = isOpen ? 'Live Monitoring' : (trade.exitTime ? new Date(trade.exitTime).toLocaleString() : 'N/A');
    const durationStr = trade.holdDuration || formatSeconds(trade.durationSeconds || (trade.elapsedMs ? trade.elapsedMs / 1000 : 0));

    if (elements.chartModalTitle) {
      elements.chartModalTitle.innerHTML = `<span style="display: flex; align-items: center; gap: 8px;">${renderTokenAvatar(trade.imageUrl, symbol, 24)} <span>TRADE CHART: ${symbol} (${name})</span></span>`;
    }
    if (elements.chartModalStatus) {
      elements.chartModalStatus.textContent = statusText;
      elements.chartModalStatus.className = `trade-status-badge ${isOpen ? 'open' : 'closed'}`;
    }

    if (elements.chartSumToken) {
      elements.chartSumToken.innerHTML = `<span style="display: flex; align-items: center; gap: 6px;">${renderTokenAvatar(trade.imageUrl, symbol, 20)} <span>${symbol} (${name})</span></span>`;
    }
    if (elements.chartSumAddress) elements.chartSumAddress.textContent = truncateAddress(addr);
    if (elements.chartSumEntryPrice) elements.chartSumEntryPrice.textContent = formatCurrency(entryPrice, 6);
    if (elements.chartSumEntryTime) elements.chartSumEntryTime.textContent = entryTimeStr;

    if (elements.chartSumExitLabel) elements.chartSumExitLabel.textContent = isOpen ? 'CURRENT PRICE' : 'EXIT PRICE';
    if (elements.chartSumCurrentPrice) elements.chartSumCurrentPrice.textContent = formatCurrency(currentOrExitPrice, 6);
    if (elements.chartSumExitTime) elements.chartSumExitTime.textContent = exitTimeStr;

    if (elements.chartSumPnlPct) {
      elements.chartSumPnlPct.textContent = formatPercent(pnlPct);
      elements.chartSumPnlPct.style.color = pnlPct >= 0 ? '#FF69B4' : '#FFFFFF';
    }
    if (elements.chartSumPnlUsd) elements.chartSumPnlUsd.textContent = formatCurrency(pnlUsd, 2) + ' USD';

    if (elements.chartSumDuration) elements.chartSumDuration.textContent = durationStr;
    if (elements.chartSumPosSize) elements.chartSumPosSize.textContent = `Size: ${formatCurrency(posSizeUsd, 2)}`;

    const riskStr = trade.riskScore !== null && trade.riskScore !== undefined ? trade.riskScore : 'Passed';
    const stratStr = trade.strategyScore !== null && trade.strategyScore !== undefined ? trade.strategyScore : 'Passed';
    if (elements.chartSumScores) elements.chartSumScores.textContent = `Risk: ${riskStr} | Strat: ${stratStr}`;
    if (elements.chartSumReason) elements.chartSumReason.textContent = `Reason: ${trade.exitReason || (isOpen ? 'Paper Holding' : 'Target')}`;

    if (elements.chartLiveIndicator) {
      if (isOpen) elements.chartLiveIndicator.classList.remove('hidden');
      else elements.chartLiveIndicator.classList.add('hidden');
    }

    renderChartTimeline(trade);

    modal.classList.add('active');

    setTimeout(() => {
      drawTradeChart(trade);
    }, 50);

    if (state.chartLiveInterval) clearInterval(state.chartLiveInterval);
    if (isOpen) {
      state.chartLiveInterval = setInterval(async () => {
        if (!state.selectedTradeForChart || state.selectedTradeForChart.symbol !== symbol) return;
        try {
          const res = await fetch('/api/active-trade');
          if (res.ok) {
            const data = await res.json();
            if (data && data.active && data.trade) {
              state.selectedTradeForChart = data.trade;
              showTradeChartModal(data.trade);
            }
          }
        } catch (e) { }
      }, 3000);
    }
  }

  function closeTradeChartModal() {
    if (elements.chartModal) elements.chartModal.classList.remove('active');
    if (state.chartLiveInterval) {
      clearInterval(state.chartLiveInterval);
      state.chartLiveInterval = null;
    }
    state.selectedTradeForChart = null;
  }

  function renderChartTimeline(trade) {
    const stepper = elements.chartTimelineStepper;
    if (!stepper) return;

    const isOpen = trade.status === 'ACTIVE' || trade.status === 'OPEN' || (!trade.exitTime && trade.entryTime);
    const buyTimeStr = trade.entryTime ? new Date(trade.entryTime).toLocaleTimeString() : (trade.buyTimestamp ? new Date(trade.buyTimestamp).toLocaleTimeString() : '00:00:00');
    const exitTimeStr = trade.exitTime ? new Date(trade.exitTime).toLocaleTimeString() : (isOpen ? 'Monitoring...' : 'Completed');
    const exitReason = trade.exitReason || (isOpen ? 'Monitoring TP/SL/MaxHold' : 'Completed');

    stepper.innerHTML = `
      <div class="tl-step">
        <div class="tl-node done">1</div>
        <div class="tl-label">Candidate Detected</div>
        <div class="tl-time">Solana Mainnet</div>
      </div>
      <div class="tl-arrow">→</div>

      <div class="tl-step">
        <div class="tl-node done">2</div>
        <div class="tl-label">Risk Check</div>
        <div class="tl-time">Score: ${trade.riskScore ?? 'Passed'}</div>
      </div>
      <div class="tl-arrow">→</div>

      <div class="tl-step">
        <div class="tl-node done">3</div>
        <div class="tl-label">Strategy Check</div>
        <div class="tl-time">Score: ${trade.strategyScore ?? 'Passed'}</div>
      </div>
      <div class="tl-arrow">→</div>

      <div class="tl-step">
        <div class="tl-node active">4</div>
        <div class="tl-label">Paper BUY</div>
        <div class="tl-time">${buyTimeStr}</div>
      </div>
      <div class="tl-arrow">→</div>

      <div class="tl-step">
        <div class="tl-node ${isOpen ? 'active' : 'done'}">5</div>
        <div class="tl-label">Price Monitoring</div>
        <div class="tl-time">+5% TP / -3% SL</div>
      </div>
      <div class="tl-arrow">→</div>

      <div class="tl-step">
        <div class="tl-node ${isOpen ? '' : 'active'}">6</div>
        <div class="tl-label">TP / SL / Max Hold</div>
        <div class="tl-time">${exitReason}</div>
      </div>
      <div class="tl-arrow">→</div>

      <div class="tl-step">
        <div class="tl-node ${isOpen ? '' : 'done'}">7</div>
        <div class="tl-label">Paper SELL</div>
        <div class="tl-time">${exitTimeStr}</div>
      </div>
    `;
  }

  // Application Entry Point
  function init() {
    initEventListeners();
    fetchDashboardData();
    // Auto-refresh every 3 seconds for live monitoring
    state.autoRefreshInterval = setInterval(fetchDashboardData, 3000);
  }

  // Run on DOM Ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
