'use strict';

/** Yield the Node event loop so HTTP/WebSocket can respond during long startup work. */
function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

module.exports = { yieldToEventLoop };
