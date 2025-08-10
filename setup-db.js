import pg from 'pg';
const { Pool } = pg;

// Use Render's internal PostgreSQL connection
const pool = new Pool({
  connectionString: 'postgresql://shumi_discord_bot_user:l0Wq8Hom3018Dj6bG5apDPva1qSJtONT@dpg-d2bipdhr0fns73fohgrg-a.frankfurt-postgres.render.com/shumi_discord_bot',
  ssl: { rejectUnauthorized: false }
});

async function setupDatabase() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Setting up database tables...');
    
    // Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        discord_id VARCHAR(255) UNIQUE NOT NULL,
        discord_username VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Users table ready');
    
    // Competitions table (matches code expectations)
    await client.query(`
      CREATE TABLE IF NOT EXISTS competitions (
        id SERIAL PRIMARY KEY,
        week_number INTEGER UNIQUE NOT NULL,
        start_at TIMESTAMP NOT NULL,
        end_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Competitions table ready');
    
    // Entries table (what the code expects instead of competition_participants)
    await client.query(`
      CREATE TABLE IF NOT EXISTS entries (
        id SERIAL PRIMARY KEY,
        competition_id INTEGER REFERENCES competitions(id),
        user_id INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(competition_id, user_id)
      );
    `);
    console.log('✅ Entries table ready');
    
    // Trades table (matches code expectations)
    await client.query(`
      CREATE TABLE IF NOT EXISTS trades (
        id SERIAL PRIMARY KEY,
        entry_id INTEGER REFERENCES entries(id),
        ticker VARCHAR(50) NOT NULL,
        side VARCHAR(10) CHECK (side IN ('long', 'short')),
        entry_price DECIMAL(20, 8),
        exit_price DECIMAL(20, 8),
        entry_time TIMESTAMP,
        exit_time TIMESTAMP,
        pnl_pct DECIMAL(10, 4),
        comment TEXT,
        status VARCHAR(10) DEFAULT 'open' CHECK (status IN ('open', 'closed')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Trades table ready');
    
    // Check all tables exist
    const tablesResult = await client.query(`
      SELECT tablename FROM pg_tables 
      WHERE schemaname = 'public' 
      ORDER BY tablename;
    `);
    
    console.log('\n📊 Database tables:');
    tablesResult.rows.forEach(row => {
      console.log(`  - ${row.tablename}`);
    });
    
    console.log('\n🎉 Database setup complete!');
    
  } catch (error) {
    console.error('❌ Database setup error:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

// Run setup
setupDatabase()
  .then(() => {
    console.log('Setup finished successfully');
    process.exit(0);
  })
  .catch(error => {
    console.error('Setup failed:', error);
    process.exit(1);
  });