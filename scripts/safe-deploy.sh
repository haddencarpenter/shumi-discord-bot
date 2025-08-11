#!/bin/bash
# Safe deployment script for Shumi Discord Bot
# This script ensures data safety during deployments

set -e  # Exit on any error

echo "🔐 SAFE DEPLOYMENT SCRIPT FOR SHUMI BOT"
echo "========================================"

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
  echo "❌ ERROR: DATABASE_URL not set"
  exit 1
fi

# Step 1: Create backup (if pg_dump available)
if command -v pg_dump &> /dev/null; then
  echo "📦 Creating database backup..."
  mkdir -p backups
  BACKUP_FILE="backups/shumi_backup_$(date +%F_%H%M%S).dump"
  pg_dump "$DATABASE_URL" -Fc -f "$BACKUP_FILE"
  echo "✅ Backup created: $BACKUP_FILE"
else
  echo "⚠️  WARNING: pg_dump not found, skipping backup"
  echo "   Consider installing PostgreSQL client tools for backups"
fi

# Step 2: Run migrations (SAFE - never drops data)
echo "🔄 Running database migrations..."
npm run migrate:up
echo "✅ Migrations completed"

# Step 3: Verify database structure
echo "🔍 Verifying database tables..."
node -e "
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function verify() {
  const client = await pool.connect();
  try {
    const result = await client.query(
      \"SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename\"
    );
    console.log('✅ Database tables present:');
    result.rows.forEach(r => console.log('   -', r.tablename));
    
    // Check for migration history
    const migrations = await client.query(
      \"SELECT name, run_on FROM pgmigrations ORDER BY run_on DESC LIMIT 5\"
    ).catch(() => null);
    
    if (migrations) {
      console.log('\\n📝 Recent migrations:');
      migrations.rows.forEach(m => 
        console.log('   -', m.name, 'at', new Date(m.run_on).toISOString())
      );
    }
  } finally {
    client.release();
    await pool.end();
  }
}

verify().catch(console.error);
"

echo ""
echo "✅ DEPLOYMENT PREPARATION COMPLETE"
echo "   Your database is safe and migrations are applied"
echo "   The bot can now be started/restarted"