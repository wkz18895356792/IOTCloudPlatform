const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  // Database configuration from .env
  const config = {
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: 'zhang525252d',
    database: 'babymonitor',
    multipleStatements: true
  };

  console.log('Connecting to MySQL...');
  console.log(`Host: ${config.host}:${config.port}`);
  console.log(`Database: ${config.database}`);

  let connection;

  try {
    connection = await mysql.createConnection(config);
    console.log('Connected successfully!');

    // Read the migration SQL file
    const migrationPath = path.join(__dirname, '../database/migrations/add-domain-tables.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    console.log('Executing migration...');
    await connection.query(sql);
    console.log('Migration completed successfully!');

    // Verify tables were created
    const [tables] = await connection.query("SHOW TABLES LIKE 'domain%'");
    console.log('\nCreated domain tables:');
    tables.forEach(table => {
      const tableName = Object.values(table)[0];
      console.log(`  - ${tableName}`);
    });

  } catch (error) {
    console.error('Migration failed:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.error('\nPlease make sure MySQL is running on localhost:3306');
    }
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('\nConnection closed.');
    }
  }
}

runMigration();
