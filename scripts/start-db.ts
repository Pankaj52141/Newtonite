/**
 * Starts an embedded PostgreSQL server for development and testing.
 * This eliminates the need for a system-level PostgreSQL installation.
 */
// @ts-ignore
import EmbeddedPostgres from 'embedded-postgres';

const fs = require('fs');
const path = require('path');

const DATA_DIR = './pg-data';
let PORT = 5432; // Default fallback

// Fallback port is used

async function main() {
  let pg: any;
  let started = false;
  
  while (!started) {
    pg = new EmbeddedPostgres({
      databaseDir: DATA_DIR,
      user: 'newtonite',
      password: 'newtonite_dev',
      port: PORT,
      persistent: true,
    });

    console.log(`🐘 Starting embedded PostgreSQL on port ${PORT}...`);
    
    if (!fs.existsSync(DATA_DIR) || fs.readdirSync(DATA_DIR).length === 0) {
      console.log('Initializing new database cluster...');
      await pg.initialise();
    }

    try {
      await pg.start();
      started = true;
      console.log(`✅ PostgreSQL successfully bound to port ${PORT}`);
      
// .env sync removed
    } catch (e: any) {
      console.log(`⚠️  Port ${PORT} failed to start. It may be busy (${e.message}). Trying ${PORT + 1}...`);
      PORT++;
    }
  }
  
  // Create the database if it doesn't exist
  try {
    await pg.createDatabase('newtonite');
    console.log('✅ Created database "newtonite"');
  } catch (e: any) {
    if (e.message?.includes('already exists')) {
      console.log('ℹ️  Database "newtonite" already exists');
    } else {
      console.error('Failed to create database:', e.message);
    }
  }

  // Create test database
  try {
    await pg.createDatabase('newtonite_test');
    console.log('✅ Created database "newtonite_test"');
  } catch (e: any) {
    if (e.message?.includes('already exists')) {
      console.log('ℹ️  Database "newtonite_test" already exists');
    } else {
      console.error('Failed to create test database:', e.message);
    }
  }

  console.log('\n📋 Connection URLs:');
  console.log(`  DATABASE_URL=postgresql://newtonite:newtonite_dev@localhost:${PORT}/newtonite`);
  console.log(`  TEST_DATABASE_URL=postgresql://newtonite:newtonite_dev@localhost:${PORT}/newtonite_test`);
  console.log('\nPress Ctrl+C to stop.');

  process.on('SIGINT', async () => {
    console.log('\n🛑 Stopping PostgreSQL...');
    await pg.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await pg.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Failed to start PostgreSQL:', err);
  process.exit(1);
});
