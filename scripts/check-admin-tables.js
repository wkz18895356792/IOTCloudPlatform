const mysql = require('mysql2/promise');
require('dotenv').config();

async function checkAndCreateTables() {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT || '3306'),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'babymonitor',
  });

  try {
    console.log('Checking tables...\n');

    // 检查表是否存在
    const [tables] = await connection.query(`
      SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = 'babymonitor'
      AND TABLE_NAME IN ('domains', 'domain_roles', 'platform_admins')
    `);

    console.log('Existing tables:', tables.map(t => t.TABLE_NAME));

    // 创建 domains 表
    if (!tables.find(t => t.TABLE_NAME === 'domains')) {
      console.log('\nCreating domains table...');
      await connection.query(`
        CREATE TABLE domains (
          id VARCHAR(36) PRIMARY KEY,
          code VARCHAR(64) NOT NULL UNIQUE,
          name VARCHAR(128) NOT NULL,
          description TEXT NULL,
          type ENUM('trial', 'standard', 'premium', 'enterprise') NOT NULL DEFAULT 'trial',
          status ENUM('active', 'suspended', 'deleted') NOT NULL DEFAULT 'active',
          owner_id VARCHAR(36) NOT NULL,
          user_limit INT NOT NULL DEFAULT 100,
          device_limit INT NOT NULL DEFAULT 500,
          storage_limit INT NOT NULL DEFAULT 100,
          trial_expires_at TIMESTAMP NULL,
          subscription_expires_at TIMESTAMP NULL,
          config JSON NULL,
          deleted_at TIMESTAMP NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_code (code),
          INDEX idx_owner_id (owner_id),
          INDEX idx_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('✓ domains table created');
    }

    // 创建 domain_roles 表
    if (!tables.find(t => t.TABLE_NAME === 'domain_roles')) {
      console.log('\nCreating domain_roles table...');
      await connection.query(`
        CREATE TABLE domain_roles (
          id VARCHAR(36) PRIMARY KEY,
          domain_id VARCHAR(36) NOT NULL,
          user_id VARCHAR(36) NOT NULL,
          role ENUM('super_admin', 'domain_admin', 'domain_user', 'domain_guest') NOT NULL DEFAULT 'domain_user',
          custom_permissions JSON NULL,
          expires_at TIMESTAMP NULL,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_domain_id (domain_id),
          INDEX idx_user_id (user_id),
          UNIQUE KEY uk_domain_user (domain_id, user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('✓ domain_roles table created');
    }

    // 创建 platform_admins 表
    if (!tables.find(t => t.TABLE_NAME === 'platform_admins')) {
      console.log('\nCreating platform_admins table...');
      await connection.query(`
        CREATE TABLE platform_admins (
          id VARCHAR(36) PRIMARY KEY,
          user_id VARCHAR(36) NOT NULL UNIQUE,
          permissions JSON NULL,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          last_login_at TIMESTAMP NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_user_id (user_id),
          INDEX idx_is_active (is_active)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('✓ platform_admins table created');
    }

    // 插入默认管理员到 platform_admins
    const [admins] = await connection.query('SELECT * FROM platform_admins WHERE user_id = ?', ['admin-1773045203752']);
    if (admins.length === 0) {
      console.log('\nInserting default platform admin...');
      await connection.query(`
        INSERT INTO platform_admins (id, user_id, permissions, is_active)
        VALUES (UUID(), 'admin-1773045203752', '["*"]', TRUE)
      `);
      console.log('✓ Default platform admin inserted');
    }

    console.log('\n✓ All tables checked/created successfully!');
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await connection.end();
  }
}

checkAndCreateTables();
