const express = require('express');
const path = require('path');
const { getStats } = require('./api/stats');
const { getConfig, updateConfig } = require('./api/config');

function createServer(port = 3000) {
  const app = express();

  // Middleware
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  // API Routes
  app.get('/api/stats', getStats);
  app.get('/api/config', getConfig);
  app.post('/api/config', updateConfig);

  // SPA fallback - handle 404 for non-API routes
  app.use((req, res) => {
    // Don't redirect API routes
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
    console.log(`\n🌐 Claude UI is running at http://localhost:${port}`);
    console.log(`Press Ctrl+C to stop\n`);
  });

  return app;
}

module.exports = { createServer, startServer };
