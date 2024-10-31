import { ChainProviders } from './providers.js';
import { PoolMonitor } from './pool-monitor.js';
import { ArbitrageExecutor } from './arbitrage.js';
import { config } from './config.js';
import { HealthMonitor } from './services/health-monitor.js';
import logger from './services/logger.js';
import express from 'express';
import { register } from './services/metrics.js';

async function main() {
  logger.info('Starting arbitrage bot...');

  // Initialize providers
  const providers = new ChainProviders();
  
  // Initialize pool monitors
  const ethPool = new PoolMonitor(
    providers.providers.ethereum,
    config.ethereum.poolAddress,
    'ethereum'
  );
  
  const blastPool = new PoolMonitor(
    providers.providers.blast,
    config.blast.poolAddress,
    'blast'
  );

  // Initialize arbitrage executor
  const arbitrage = new ArbitrageExecutor(providers, ethPool, blastPool);

  // Initialize health monitor
  const healthMonitor = new HealthMonitor(providers, { ethPool, blastPool });

  // Setup metrics endpoint
  if (config.metrics.enabled) {
    const app = express();
    app.get('/metrics', async (req, res) => {
      res.set('Content-Type', register.contentType);
      res.end(await register.metrics());
    });
    app.listen(config.metrics.port, () => {
      logger.info(`Metrics server listening on port ${config.metrics.port}`);
    });
  }

  // Main monitoring loop with error handling
  const monitorLoop = async () => {
    try {
      const opportunity = await arbitrage.checkArbitrageProfitability();
      
      if (opportunity?.isProfitable) {
        logger.info('Found profitable opportunity:', opportunity);
        await arbitrage.executeArbitrage(opportunity);
      }
    } catch (error) {
      logger.error('Error in monitoring loop:', error);
    } finally {
      // Schedule next iteration
      setTimeout(monitorLoop, 1000);
    }
  };

  // Start monitoring
  monitorLoop();

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM signal. Starting graceful shutdown...');
    // Cleanup logic here
    process.exit(0);
  });
}

main().catch(error => {
  logger.error('Fatal error:', error);
  process.exit(1);
});