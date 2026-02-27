const { getDb } = require('../database');
const {
  TD_CHECKING_ACCOUNT_ID,
  backfillTdCheckingRentalIncome,
} = require('../services/accountStrategies/tdCheckingRentalIncomeStrategy');

function parseArg(name) {
  const idx = process.argv.findIndex((a) => a === name);
  if (idx < 0) return null;
  return process.argv[idx + 1] || null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function main() {
  const db = getDb();
  const accountId = Number(parseArg('--account-id') || TD_CHECKING_ACCOUNT_ID);
  const startDate = parseArg('--start-date');
  const endDate = parseArg('--end-date');
  const apply = hasFlag('--apply');

  const result = backfillTdCheckingRentalIncome(db, {
    accountId,
    startDate: startDate || null,
    endDate: endDate || null,
    dryRun: !apply,
  });

  console.log(JSON.stringify(result, null, 2));
  if (!apply) {
    console.log('Dry run complete. Re-run with --apply to persist changes.');
  }
}

main();

