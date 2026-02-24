const express = require('express');
const router = express.Router();
const { listRecentImportRuns } = require('../services/importHistory');

router.get('/', (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit || '25', 10), 1), 100);
  const data = listRecentImportRuns(limit);
  res.json(data);
});

module.exports = router;
