// ============================================================================
// SOLANA MEME COIN BOT MONITORING DASHBOARD (public/app.js)
// Purpose: Read-only UI controller consuming Phase 8.5.1 API endpoints + Phase 8.6 Analytics
// Theme: BLACK + WHITE + PINK
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
    hasNotifiedCompletion: false,
    candidateFilter: 'ALL',
    lastSyncTime: null,
    autoRefreshInterval: null,
    isFetchPending: false,
    consecutiveFetchFailures: 0
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

    // Modal
    modal: document.getElementById('candidate-modal'),
    modalTitle: document.getElementById('modal-candidate-title'),
    modalBody: document.getElementById('modal-candidate-body'),
    btnModalClose: document.getElementById('btn-modal-close'),
    btnModalDismiss: document.getElementById('btn-modal-dismiss')
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
    if (!addr || typeof addr !== 'string') return 'N/A';
    if (addr.length <= 12) return addr;
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
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
      const [statusRes, candidatesRes, activeTradeRes, riskRes, tradesRes, perfRes, valRes] = await Promise.allSettled([
        fetch('/api/status'),
        fetch('/api/candidates'),
        fetch('/api/active-trade'),
        fetch('/api/risk'),
        fetch('/api/trades'),
        fetch('/api/performance'),
        fetch('/api/validation')
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

  // Render Section F, G, H, I: Active Paper Trade Cards
  function renderActiveTrade() {
    const container = elements.activeTradeContainer;
    if (!container) return;

    const data = state.activeTrade;

    if (!data || !data.active || !data.trade) {
      container.innerHTML = `
        <div class="empty-state-trade">
          <div class="empty-icon">⚡</div>
          <div class="empty-title">NO ACTIVE PAPER TRADE</div>
          <div class="empty-desc">The bot is currently scanning Solana mainnet DEX pairs for valid candidate setups meeting risk criteria.</div>
        </div>
      `;
      return;
    }

    const t = data.trade;
    const pnlPct = t.paperPnlPct || 0;
    const pnlUsd = t.paperPnlUsd || 0;
    const pnlClass = pnlPct >= 0 ? 'pink-glow-text' : '';

    container.innerHTML = `
      <div class="active-trade-grid">
        <!-- TOKEN & SYMBOL CARD -->
        <div class="trade-metric-box">
          <div class="metric-header">TOKEN / ADDRESS</div>
          <div class="metric-val-main">${t.symbol || 'TOKEN'}</div>
          <div class="metric-sub">${truncateAddress(t.tokenAddress)}</div>
        </div>

        <!-- ENTRY PRICE CARD -->
        <div class="trade-metric-box">
          <div class="metric-header">ENTRY PRICE</div>
          <div class="metric-val-white">${formatCurrency(t.entryPriceUsd)}</div>
          <div class="metric-sub">Base Entry</div>
        </div>

        <!-- CURRENT PRICE CARD -->
        <div class="trade-metric-box">
          <div class="metric-header">CURRENT PRICE</div>
          <div class="metric-val-main">${formatCurrency(t.currentPriceUsd)}</div>
          <div class="metric-sub">Real-Time Oracle</div>
        </div>

        <!-- PAPER P&L CARD -->
        <div class="trade-metric-box">
          <div class="metric-header">PAPER P&L</div>
          <div class="metric-val-main ${pnlClass}">${formatPercent(pnlPct)}</div>
          <div class="metric-sub">${formatCurrency(pnlUsd, 2)} USD</div>
        </div>
      </div>

      <!-- TRADE PARAMETERS & RISK CONTROLS BANNER -->
      <div class="trade-parameters-banner">
        <div class="param-item">
          <span class="param-label">TAKE PROFIT (TP)</span>
          <span class="param-val pink-text">+${t.tpPct || 5}%</span>
        </div>
        <div class="param-item">
          <span class="param-label">STOP LOSS (SL)</span>
          <span class="param-val pink-text">${t.slPct || -3}%</span>
        </div>
        <div class="param-item">
          <span class="param-label">MAX HOLD TIME</span>
          <span class="param-val pink-text">${t.maxHoldMinutes || 5} MIN</span>
        </div>
        <div class="param-item">
          <span class="param-label">ELAPSED HOLD TIME</span>
          <span class="param-val">${formatSeconds(t.elapsedSeconds || 0)}</span>
        </div>
        <div class="param-item">
          <span class="param-label">POSITION STATUS</span>
          <span class="param-val pink-text">${t.status || 'OPEN'}</span>
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
      
      const riskScore = c.riskScore !== undefined ? c.riskScore : (c.riskFilter ? c.riskFilter.score : 0);
      const strategyScore = c.strategyScore !== undefined ? c.strategyScore : (c.strategy ? c.strategy.score : 0);
      
      const isApproved = (c.riskManager && c.riskManager.approved) || (c.decision === 'APPROVED');
      const decisionBadge = isApproved
        ? `<span class="decision-badge approved">APPROVED</span>`
        : `<span class="decision-badge rejected">REJECTED</span>`;

      const timeStr = c.timestamp ? new Date(c.timestamp).toLocaleTimeString() : 'Just now';

      return `
        <tr>
          <td>
            <strong style="color: var(--text-white);">${symbol}</strong>
            <div style="font-size: 11px; color: var(--text-muted);">${name}</div>
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
              <span class="score-num">${strategyScore}/100</span>
              <div class="score-track">
                <div class="score-fill-pink" style="width: ${Math.min(100, Math.max(0, strategyScore))}%;"></div>
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

  // Render Section K: Completed Paper Trade History
  function renderTradeHistory() {
    const tbody = elements.historyTableBody;
    if (!tbody) return;

    const trades = state.trades || [];

    if (trades.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" class="table-loading">No completed paper trades recorded yet.</td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = trades.map(t => {
      const pnlPct = t.paperPnlPct || 0;
      const pnlUsd = t.paperPnlUsd || 0;
      const pnlStr = `${formatPercent(pnlPct)} (${formatCurrency(pnlUsd, 2)})`;
      const pnlColor = pnlPct >= 0 ? '#FF69B4' : '#FFFFFF';

      const resultBadge = `<span class="decision-badge ${t.result === 'WIN' || pnlPct >= 0 ? 'approved' : 'rejected'}">${t.result || 'CLOSED'}</span>`;
      const durationStr = formatSeconds(t.durationSeconds || 0);
      const timeStr = t.exitTime ? new Date(t.exitTime).toLocaleTimeString() : 'N/A';

      return `
        <tr>
          <td><strong style="color: var(--text-white);">${t.symbol || 'TOKEN'}</strong></td>
          <td>${formatCurrency(t.entryPriceUsd)}</td>
          <td>${formatCurrency(t.exitPriceUsd)}</td>
          <td style="color: ${pnlColor}; font-weight: 700;">${pnlStr}</td>
          <td>${resultBadge}</td>
          <td>${durationStr}</td>
          <td style="color: var(--text-muted);">${t.exitReason || 'Target Reached'}</td>
          <td style="color: var(--text-muted);">${timeStr}</td>
        </tr>
      `;
    }).join('');
  }

  // Candidate Details Modal Handler
  function showCandidateModal(candidate) {
    if (!candidate) return;
    if (elements.modalTitle) {
      elements.modalTitle.textContent = `CANDIDATE: ${candidate.symbol || 'TOKEN'} (${truncateAddress(candidate.address)})`;
    }
    if (elements.modalBody) {
      elements.modalBody.textContent = JSON.stringify(candidate, null, 2);
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

    // Modal Close Triggers
    if (elements.btnModalClose) elements.btnModalClose.addEventListener('click', hideModal);
    if (elements.btnModalDismiss) elements.btnModalDismiss.addEventListener('click', hideModal);
    if (elements.modal) {
      elements.modal.addEventListener('click', (e) => {
        if (e.target === elements.modal) hideModal();
      });
    }
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
