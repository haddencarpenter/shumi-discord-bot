# Database Migration Guide - IMPORTANT

## ⚠️ CRITICAL: Never Drop Production Tables

This project uses **safe, non-destructive migrations** to manage the database schema.

## Quick Commands

```bash
# Run migrations (SAFE - never drops data)
npm run migrate:up

# Create a new migration
npm run migrate:create -- my_migration_name

# Rollback last migration (use with caution)
npm run migrate:down

# Create backup
npm run db:backup
```

## ⚠️ PostgreSQL Version Compatibility

**IMPORTANT:** pg_dump must match your database server version to avoid connection errors.

**Check your database version first:**
```sql
-- Connect to your database and run:
SELECT version();
```

**Install matching PostgreSQL version:**
```bash
# If your database is PostgreSQL 17:
brew install postgresql@17
echo 'export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"' >> ~/.zshrc

# If your database is PostgreSQL 16:
brew install postgresql@16
echo 'export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"' >> ~/.zshrc

# Then reload your shell:
source ~/.zshrc
```

**Common error:** `server version: 17.x; pg_dump version: 14.x` means version mismatch - upgrade your local pg_dump.

## Safe Deployment Process

Always use the safe deployment script:

```bash
./scripts/safe-deploy.sh
```

This script:
1. Creates a database backup
2. Runs migrations safely
3. Verifies database structure

## Migration Rules

1. **NEVER use DROP TABLE in production migrations**
2. **ALWAYS use CREATE TABLE IF NOT EXISTS**
3. **Use ALTER TABLE for schema changes**
4. **Test migrations locally first**
5. **Keep backups before major changes**

## Creating New Migrations

```bash
# Create a new migration file
npm run migrate:create -- add_user_stats

# Edit the generated file in migrations/
# Use safe SQL patterns:
```

Example safe migration:
```sql
-- Add new column (safe)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='users' AND column_name='total_pnl'
  ) THEN
    ALTER TABLE users ADD COLUMN total_pnl DECIMAL(10,2) DEFAULT 0;
  END IF;
END$$;

-- Create new table (safe)
CREATE TABLE IF NOT EXISTS user_stats (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  -- ...
);
```

## Database User Permissions

For production safety, consider using two database users:

1. **Bot user** (limited permissions):
   - SELECT, INSERT, UPDATE on all tables
   - NO DROP, TRUNCATE, ALTER permissions

2. **Migration user** (admin):
   - Full permissions
   - Used only for migrations

## Recovery from Data Loss

If data is lost:
1. Check `backups/` directory for recent dumps
2. Restore: `pg_restore -d "$DATABASE_URL" backup_file.dump`
3. Contact team immediately

## Migration History

Migrations are tracked in the `pgmigrations` table. To see history:

```sql
SELECT * FROM pgmigrations ORDER BY run_on DESC;
```

---

**Remember: In production, data is sacred. Never drop tables.**