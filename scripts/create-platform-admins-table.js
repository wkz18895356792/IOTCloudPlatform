const mysql = require('mysql2/promise');

async function createPlatformAdminsTable() {
  const config = {
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: 'zhang525252d',
    database: 'babymonitor'
  };

  let connection;

  try {
    connection = await mysql.createConnection(config);
    console.log('Connected to MySQL');

    // Create platform_admins table
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS platform_admins (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL UNIQUE COMMENT '用户ID',
        permissions JSON NULL COMMENT '权限列表',
        is_active BOOLEAN NOT NULL DEFAULT TRUE COMMENT '是否激活',
        last_login_at TIMESTAMP NULL COMMENT '最后登录时间',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_user_id (user_id),
        INDEX idx_is_active (is_active),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='平台管理员表';
    `;

    await connection.query(createTableSQL);
    console.log('platform_admins table created successfully!');

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

createPlatformAdminsTable();
