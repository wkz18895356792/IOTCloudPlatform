const mysql = require('mysql2/promise');
const crypto = require('crypto');

async function createAdminUser() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'zhang525252d',
    database: 'babymonitor'
  });

  try {
    // Delete existing admin user if exists
    await connection.execute('DELETE FROM users WHERE username = ?', ['admin']);
    console.log('Deleted existing admin user (if any)');

    // Hash the password "admin123" using SHA-256
    const password = 'admin123';
    const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
    console.log('Password hash for "admin123":', passwordHash);

    // Insert new admin user
    const userId = 'admin-' + Date.now();
    await connection.execute(`
      INSERT INTO users (
        id, username, email, passwordHash, nickname, role, status,
        emailVerified, phoneVerified, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `, [
      userId,
      'admin',
      'admin@smarthome.com',
      passwordHash,
      '超级管理员',
      'admin',
      'active',
      1,
      0
    ]);

    console.log('Admin user created successfully!');
    console.log('Username: admin');
    console.log('Password: admin123');

    // Verify the user was created
    const [rows] = await connection.execute('SELECT id, username, email, role FROM users WHERE username = ?', ['admin']);
    console.log('Verification:', rows);

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await connection.end();
  }
}

createAdminUser();
