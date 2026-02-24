#!/usr/bin/env node
// server/setup.js — Run once to seed your rules and import initial CSVs

const path = require('path');
const fs = require('fs');

// Bootstrap DB
const { getDb } = require('./database');
const { seedRulesFromJson, recategorizeAll } = require('./services/categorizer');
const { importCSV } = require('./services/csvParser');

async function main() {
  console.log('\n🚀 Ledger Setup — Initial Data Import\n');

  getDb(); // Init schema

  // 1. Seed rules from bundled JSON
  const rulesPath = path.join(__dirname, 'default_rules.json');
  if (fs.existsSync(rulesPath)) {
    console.log('📋 Seeding categorization rules...');
    const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
    seedRulesFromJson(rules);
    console.log('   ✓ Rules loaded');
  } else {
    console.log('⚠  No default_rules.json found. Copy Transaction_Categorization_Rules.json as server/default_rules.json');
  }

  // 2. Import any CSV files passed as arguments
  const csvDir = process.argv[2] || path.join(__dirname, '../data');
  if (fs.existsSync(csvDir)) {
    const files = fs.readdirSync(csvDir).filter(f => f.endsWith('.csv'));
    if (files.length) {
      console.log(`\n📂 Importing ${files.length} CSV file(s) from ${csvDir}...`);
      for (const filename of files) {
        try {
          const buffer = fs.readFileSync(path.join(csvDir, filename));
          const result = importCSV(filename, buffer);
          console.log(`   ✓ ${filename}: ${result.imported} imported, ${result.skipped} skipped`);
        } catch (err) {
          console.log(`   ✗ ${filename}: ${err.message}`);
        }
      }
    }
  }

  // 3. Auto-categorize all uncategorized
  console.log('\n🏷  Running auto-categorization...');
  const n = recategorizeAll(false);
  console.log(`   ✓ Categorized ${n} transactions`);

  console.log('\n✅ Setup complete! Run: npm run dev\n');
}

main().catch(console.error);
