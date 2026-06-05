const mysql = require('mysql2/promise');

async function dropTables() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'zhang525252d',
    database: 'babymonitor'
  });

  const tables = [
    'users',
    'user_sessions',
    'user_profiles',
    'user_devices',
    'family_members',
    'family_invitations',
    'third_party_bindings',
    'user_feedback',
    'user_action_logs'
  ];

  for (const table of tables) {
    await connection.execute(`DROP TABLE IF EXISTS \`${table}\``);
    console.log(`✓ Dropped table: ${table}`);
  }

  await connection.end();
  console.log('\nAll tables dropped successfully!');
}

dropTables().catch(console.error);
