import fs from 'fs';
import path from 'path';

const migrationsDir = path.resolve(__dirname, '../supabase/migrations');
const outputFile = path.resolve(__dirname, '../supabase/complete_prod_schema.sql');

const files = fs.readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

console.log(`Bundling ${files.length} migrations into complete_prod_schema.sql...`);

let combinedSql = `-- =====================================================================
-- SIMPLIFY Billing & Expense SaaS - Complete Production Database Schema
-- Auto-generated from 53 migrations
-- =====================================================================

`;

for (const file of files) {
  const filePath = path.join(migrationsDir, file);
  const sql = fs.readFileSync(filePath, 'utf8');
  combinedSql += `\n-- >>> Migration: ${file} <<<\n`;
  combinedSql += sql + '\n';
}

fs.writeFileSync(outputFile, combinedSql, 'utf8');
const stats = fs.statSync(outputFile);
console.log(`✅ complete_prod_schema.sql successfully created! Size: ${(stats.size / 1024).toFixed(1)} KB`);
