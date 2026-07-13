'use strict';

// Standalone HTTP stub mimicking Nakama's /v2/rpc surface for the lms-bridge
// contract. Run: npm run mock-nakama  (default port 7360)
// Point the tool at it with NAKAMA_BASE_URL=http://localhost:7360

const express = require('express');
const { handle } = require('./handlers');

const app = express();
app.use(express.json({ limit: '2mb' }));

app.post('/v2/rpc/:id', async (req, res) => {
  try {
    const result = await handle(req.params.id, req.body || {});
    res.json(result);
  } catch (err) {
    if (/no handler/.test(err.message)) return res.status(404).json({ message: err.message });
    res.status(400).json({ message: err.message });
  }
});

const port = parseInt(process.env.MOCK_NAKAMA_PORT || '7360', 10);
app.listen(port, () => console.log(`[mock-nakama] lms-bridge RPC stub on :${port}`));
