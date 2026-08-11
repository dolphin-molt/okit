const express = require('express');
const path = require('path');
const { getTools, toolAction, submitAuthCode, openApp } = require('./api/tools');
const { listVault, setVault, deleteVault, exportVault, importVault, getVaultValue, syncVaultToProject, browseDirs, checkKeyImpact, listProjects, listVaultWithProjects, testApiKey, migrateGroups } = require('./api/vault');
const { autoCreateKey, recoverLatestZaiGlobalKey, cdpStatus, listAutoCreatePlatforms, openVerificationLoginTabs } = require('./api/auto-create');
const { getLogs } = require('./api/logs');
const { checkWrangler, listStores, listStoreSecrets, syncToCloudflare } = require('./api/cloudflare-sync');
const { getMonitor, getDu, getCleanupScan, getCleanupAi, deleteCleanupItem, getCleanupAgent, confirmCleanupAgent } = require('./api/monitor');
const { agentChat, agentConfirm, listConversations, getConversation, createConversation, updateConversation, deleteConversation } = require('./api/agent');
const { getSettings, updateSettings, testPlatformConnection, testAgentConnection, syncSecretsToPlatform, getPresets, getOnboarding, dismissOnboarding, resetOnboarding } = require('./api/settings');
const { handlePush, handlePull, handleStatus, handleExportCode, handleImportCode } = require('./api/sync');
const { listProviders, getAdaptersList, createProvider, updateProvider, deleteProvider, switchProvider, launchAgent, getAuthStatus, triggerOAuthLogin, fetchModels } = require('./api/providers');
const { getUsage, getSupportedUsageProviders } = require('./api/usage');

function createServer(port = 3780) {
  const app = express();

  // Middleware
  app.use(express.json());
  const publicDir = path.join(__dirname, 'public');
  app.use(express.static(publicDir, { maxAge: 0, etag: false, lastModified: false, setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  } }));

  // API Routes
  app.get('/api/tools', getTools);
  app.post('/api/tools/action', toolAction);
  app.post('/api/tools/auth-code', submitAuthCode);
  app.post('/api/tools/open', openApp);
  app.get('/api/logs', getLogs);
  app.get('/api/vault', listVaultWithProjects);
  app.get('/api/vault/list', listVault);
  app.post('/api/vault', setVault);
  app.delete('/api/vault', deleteVault);
  app.get('/api/vault/export', exportVault);
  app.post('/api/vault/import', importVault);
  app.get('/api/vault/value', getVaultValue);
  app.post('/api/vault/sync-to-project', syncVaultToProject);
  app.get('/api/vault/browse-dirs', browseDirs);
  app.get('/api/vault/impact', checkKeyImpact);
  app.get('/api/vault/projects', listProjects);
  app.post('/api/vault/test-key', testApiKey);
  app.post('/api/vault/migrate-groups', migrateGroups);
  app.post('/api/vault/auto-create', autoCreateKey);
  app.post('/api/vault/auto-create/recover-zai-latest', async (_req, res) => {
    try {
      const result = await recoverLatestZaiGlobalKey();
      res.json({ success: true, platform: 'zai-global', name: result.name, valueLength: result.valueLength });
    } catch (error) {
      res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
  app.get('/api/vault/auto-create/platforms', listAutoCreatePlatforms);
  app.post('/api/vault/auto-create/open-login-tabs', openVerificationLoginTabs);
  app.get('/api/vault/cdp-status', cdpStatus);

  // Lightweight health-check endpoint for the Chrome extension.
  // The extension probes /ping before each WebSocket attempt so that
  // ERR_CONNECTION_REFUSED (uncatchable on new WebSocket()) stays out of
  // the extension console. No auth/header required.
  app.get('/ping', (_req, res) => res.json({ ok: true }));

  // Cloudflare sync routes
  app.get('/api/cloudflare/check', checkWrangler);
  app.get('/api/cloudflare/stores', listStores);
  app.get('/api/cloudflare/store-secrets', listStoreSecrets);
  app.post('/api/cloudflare/sync', syncToCloudflare);

  // Monitor routes
  app.get('/api/monitor', getMonitor);
  app.get('/api/monitor/du', getDu);
  app.get('/api/monitor/cleanup-scan', getCleanupScan);
  app.post('/api/monitor/cleanup-ai', getCleanupAi);
  app.post('/api/monitor/cleanup-delete', deleteCleanupItem);
  app.post('/api/monitor/cleanup-agent', getCleanupAgent);
  app.post('/api/monitor/cleanup-agent/confirm', confirmCleanupAgent);

  // Agent routes
  app.post('/api/agent/chat', agentChat);
  app.post('/api/agent/confirm', agentConfirm);
  app.get('/api/agent/conversations', listConversations);
  app.get('/api/agent/conversations/:id', getConversation);
  app.post('/api/agent/conversations', createConversation);
  app.put('/api/agent/conversations/:id', updateConversation);
  app.delete('/api/agent/conversations/:id', deleteConversation);

  // Settings routes
  app.get('/api/settings', getSettings);
  app.post('/api/settings', updateSettings);
  app.post('/api/settings/test', testPlatformConnection);
  app.post('/api/settings/test-agent', testAgentConnection);
  app.get('/api/settings/presets', getPresets);
  app.get('/api/settings/onboarding', getOnboarding);
  app.post('/api/settings/onboarding/dismiss', dismissOnboarding);
  app.post('/api/settings/onboarding/reset', resetOnboarding);
  app.post('/api/settings/sync-to-cloud', syncSecretsToPlatform);

  // Sync routes
  app.post('/api/sync/push', handlePush);
  app.post('/api/sync/pull', handlePull);
  app.get('/api/sync/status', handleStatus);
  app.post('/api/sync/code/export', handleExportCode);
  app.post('/api/sync/code/import', handleImportCode);

  // Provider routes
  app.get('/api/providers', listProviders);
  app.get('/api/providers/adapters', getAdaptersList);
  app.post('/api/providers', createProvider);
  app.put('/api/providers/:id', updateProvider);
  app.delete('/api/providers/:id', deleteProvider);
  app.post('/api/providers/switch', switchProvider);
  app.post('/api/providers/launch', launchAgent);
  app.get('/api/providers/auth', getAuthStatus);
  app.post('/api/providers/auth/login', triggerOAuthLogin);
  app.post('/api/providers/fetch-models', fetchModels);

  // Usage / quota routes
  app.get('/api/usage/supported', getSupportedUsageProviders);
  app.get('/api/usage/:providerId', getUsage);

  // SPA fallback
  app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'Not found' });
    }
    // Pass the public directory as `root` instead of sending one absolute
    // path. The `send` package treats dot-prefixed segments in an absolute
    // workspace path (for example `.codex`) as hidden files and returns 404.
    res.sendFile('index.html', { root: publicDir });
  });

  return app;
}

function startServer(port = 3780, onStarted) {
  const { setupWebSocket, sendToExtension, isExtensionConnected } = require('./api/ws-extension');
const app = createServer(port);

  const server = require('http').createServer(app);
  setupWebSocket(server);

  server.listen(port, '127.0.0.1', () => {
    console.log(`\n  OKIT Web UI is running at http://localhost:${port}`);
    console.log(`  Press Ctrl+C to stop\n`);
    if (onStarted) onStarted(port);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      const nextPort = port + 1;
      console.log(`  Port ${port} in use, trying ${nextPort}...`);
      startServer(nextPort, onStarted);
    } else {
      throw err;
    }
  });

  return app;
}

module.exports = { createServer, startServer };
