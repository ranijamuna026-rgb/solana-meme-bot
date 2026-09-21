# ============================================================================
# SOLANA MEMECOIN BOT — PRODUCTION DOCKERFILE
# Mode: PAPER TRADING ONLY (Zero real transaction capability)
# ============================================================================

FROM node:20-alpine

# Set working directory inside container
WORKDIR /app

# Copy package manifest files and set ownership
COPY --chown=node:node package*.json ./

# Install production dependencies only
RUN npm install --omit=dev

# Copy application source code and static assets with non-root ownership
COPY --chown=node:node src/ ./src/
COPY --chown=node:node public/ ./public/
COPY --chown=node:node paper_trades_history.json ./

# Set default non-secret environment variables (Default: PAPER TRADING ONLY)
ENV NODE_ENV=production \
    TRADING_MODE=PAPER \
    PORT=3000

# Expose default HTTP dashboard and health check port
EXPOSE 3000

# Switch to unprivileged non-root node user
USER node

# Health check configuration using standard /healthz endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/healthz || exit 1

# Start continuous paper-trading bot process
CMD ["npm", "start"]
