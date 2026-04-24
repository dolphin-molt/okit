const express = require('express');
const path = require('path');
const { getTools, toolAction, submitAuthCode } = require('./api/tools');
const { listVault, setVault, deleteVault, exportVault, importVault } = require('./api/vault');
const { getLogs } = require('./api/logs');

function createServer(port = 3000) {
  const app = express();

  // Middleware
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0, etag: false }));

  // API Routes
  app.get('/api/tools', getTools);
  app.post('/api/tools/action', toolAction);
  app.post('/api/tools/auth-code', submitAuthCode);
  app.get('/api/logs', getLogs);
  app.get('/api/vault', listVault);
  app.post('/api/vault', setVault);
  app.delete('/api/vault', deleteVault);
  app.get('/api/vault/export', exportVault);
  app.post('/api/vault/import', importVault);

  // SPA fallback
  app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  return app;
}

function startServer(port = 3000) {
  const app = createServer(port);

  app.listen(port, '127.0.0.1', () => {
    console.log(`\n  OKIT Web UI is running at http://localhost:${port}`);
    console.log(`  Press Ctrl+C to stop\n`);
  });

  return app;
}

module.exports = { createServer, startServer };
