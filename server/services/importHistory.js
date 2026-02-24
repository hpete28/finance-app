const { getDb } = require('../database');

function recordImportRun({
  source,
  accountId,
  accountName,
  fileName,
  importedCount,
  totalCount,
  fromDate,
  toDate,
}) {
  const db = getDb();
  db.prepare(`
    INSERT INTO import_runs
      (source, account_id, account_name, file_name, imported_count, total_count, from_date, to_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(source, accountId, accountName, fileName, importedCount, totalCount, fromDate || null, toDate || null);
}

function listRecentImportRuns(limit = 25) {
  const db = getDb();

  const recent = db.prepare(`
    SELECT
      id,
      source,
      account_id AS accountId,
      account_name AS accountName,
      file_name AS fileName,
      imported_count AS importedCount,
      total_count AS totalCount,
      from_date AS fromDate,
      to_date AS toDate,
      created_at AS createdAt
    FROM import_runs
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT ?
  `).all(limit);

  const latestByAccount = db.prepare(`
    SELECT
      account_name AS accountName,
      source,
      file_name AS fileName,
      imported_count AS importedCount,
      total_count AS totalCount,
      from_date AS fromDate,
      to_date AS toDate,
      created_at AS createdAt
    FROM import_runs r
    WHERE r.id = (
      SELECT r2.id
      FROM import_runs r2
      WHERE r2.account_name = r.account_name
      ORDER BY datetime(r2.created_at) DESC, r2.id DESC
      LIMIT 1
    )
    ORDER BY account_name
  `).all();

  return { recent, latestByAccount };
}

module.exports = { recordImportRun, listRecentImportRuns };
