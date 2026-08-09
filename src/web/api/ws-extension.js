/**
 * WebSocket bridge between OKIT server and Chrome Extension (v2 atomic-capability protocol).
 *
 * Extension connects via ws://localhost:3780/ws/extension and exposes generic
 * atoms: exec, navigate, network-capture-start, network-capture-read, etc.
 * OKIT server orchestrates platform-specific flows by composing these atoms
 * via sendCommand().
 *
 * Protocol message shapes:
 *   Server → Extension:  { id, action, ...params }   (a Command)
 *   Extension → Server:  { id, ok, data?, error? }   (a Result)
 *                        { type: 'hello', version }  (version handshake on connect)
 *                        { type: 'log', level, msg } (forwarded console output)
 *
 * Legacy support: sendToExtension({ type: 'auto-create', ... }) is kept for
 * volcengine/minimax until they migrate to the atomic protocol (Phase 3).
 */

const { WebSocketServer } = require('ws');

const PENDING = new Map(); // requestId -> { resolve, reject, timer }
let extWs = null;
let reqCounter = 0;
let extensionVersion = null;
let extensionProtocol = null;

function setupWebSocket(httpServer) {
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws/extension',
  });

  wss.on('connection', (ws, req) => {
    console.log(`[WS] Extension connected from ${req.socket.remoteAddress} at ${new Date().toISOString()}`);

    // Close previous connection if exists (single-extension model)
    if (extWs && extWs !== ws) {
      extWs.close();
    }
    extWs = ws;

    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }

      // Version handshake (extension sends this on connect)
      if (msg.type === 'hello') {
        extensionVersion = msg.version;
        extensionProtocol = msg.protocol || 'legacy';
        console.log(`[WS] Extension hello: v${msg.version} protocol=${extensionProtocol}`);
        return;
      }

      // Forwarded console log from the service worker
      if (msg.type === 'log') {
        const level = msg.level || 'info';
        const prefix = level === 'error' ? '[ext-error]' : level === 'warn' ? '[ext-warn]' : '[ext-log]';
        console.log(`${prefix} ${msg.msg || ''}`);
        return;
      }

      // Ignore other non-response keepalive/pong messages
      if (msg.type === 'debug' || msg.type === 'keepalive' || msg.type === 'pong') return;

      // Result correlation by id (covers both atomic Result and legacy responses)
      const pending = PENDING.get(msg.id);
      if (!pending) return;

      clearTimeout(pending.timer);
      PENDING.delete(msg.id);

      // Atomic protocol: { id, ok, data?, error? }
      if (msg.ok === false) {
        pending.reject(new Error(msg.error || 'Extension command failed'));
      } else if (msg.ok === true) {
        pending.resolve(msg);
      } else if (msg.type === 'error') {
        // Legacy error shape
        pending.reject(new Error(msg.error));
      } else {
        // Legacy success shape (type: 'key-created' | 'login-required' | 'key-not-found' | etc.)
        pending.resolve(msg);
      }
    });

    ws.on('close', () => {
      console.log('[WS] Extension disconnected');
      if (extWs === ws) {
        extWs = null;
        extensionVersion = null;
        extensionProtocol = null;
      }
      // Reject every pending request — prevents callers from hanging forever
      for (const [id, pending] of PENDING.entries()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Extension disconnected'));
        PENDING.delete(id);
      }
    });
  });

  console.log('[WS] WebSocket server ready on /ws/extension');
  return wss;
}

/**
 * Send an atomic-capability command to the extension and wait for the result.
 * This is the primary API for platform orchestration (used by auto-create.js).
 *
 * @param {string} action - one of: exec, navigate, tabs, cookies, screenshot,
 *   close-window, cdp, set-file-input, insert-text, network-capture-start,
 *   network-capture-read
 * @param {object} params - action-specific parameters (code, url, pattern, ...)
 * @param {number} timeoutMs - default 60s
 * @returns {Promise<{id, ok, data}>} the extension's Result
 */
function sendCommand(action, params = {}, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    if (!extWs || extWs.readyState !== 1) {
      reject(new Error('Chrome Extension not connected. Please install the OKIT extension (chrome://extensions → Load unpacked → select okit/extension).'));
      return;
    }

    const id = `cmd_${Date.now()}_${++reqCounter}`;
    const timer = setTimeout(() => {
      PENDING.delete(id);
      reject(new Error(`Extension command "${action}" timed out (${timeoutMs / 1000}s)`));
    }, timeoutMs);

    PENDING.set(id, { resolve, reject, timer });

    extWs.send(JSON.stringify({ id, action, ...params }));
  });
}

/**
 * Send a legacy-shape command to the Chrome Extension and wait for response.
 * Kept for volcengine/minimax until they migrate to the atomic protocol.
 *
 * @param {object} command - must include a `type` field (e.g. {type:'auto-create',...})
 * @param {number} timeoutMs - default 60s
 */
function sendToExtension(command, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    if (!extWs || extWs.readyState !== 1) {
      reject(new Error('Chrome Extension not connected. Please install the OKIT extension.'));
      return;
    }

    const id = String(++reqCounter);
    const timer = setTimeout(() => {
      PENDING.delete(id);
      reject(new Error('Extension command timed out'));
    }, timeoutMs);

    PENDING.set(id, { resolve, reject, timer });

    extWs.send(JSON.stringify({ id, ...command }));
  });
}

/**
 * Check if extension is connected.
 */
function isExtensionConnected() {
  return extWs !== null && extWs.readyState === 1;
}

/**
 * Get the connected extension's reported version (null if not connected or pre-hello).
 */
function getExtensionVersion() {
  return extensionVersion;
}

/**
 * Get the connected extension's reported protocol ('atomic-v2' for the new
 * extension, 'legacy' for the old v1, or null if not connected/pre-hello).
 */
function getExtensionProtocol() {
  return extensionProtocol;
}

module.exports = {
  setupWebSocket,
  sendCommand,        // atomic-capability API (new, preferred)
  sendToExtension,    // legacy shape (volcengine/minimax until Phase 3)
  isExtensionConnected,
  getExtensionVersion,
  getExtensionProtocol,
};
