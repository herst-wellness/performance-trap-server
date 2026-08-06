'use strict';

// Kids on the Bus now lives in its own self-contained application folder.
// The main Performance Trap server delegates only that page, its assets, and
// its namespaced API routes to the companion. Every other route remains under
// the existing server.
module.exports = require('./kids-on-the-bus/server');
