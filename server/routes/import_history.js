const express = require('express');
const router = express.Router();
const { listRecentImportRuns } = require('../services/importHistory');

router.get('/', (req, res) => {
  const parsedLimit = parseInt(req.query.limit || '25', 10);
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), 100)
    : 25;
  const data = listRecentImportRuns(limit);
  res.json(data);
});

module.exports = router;
