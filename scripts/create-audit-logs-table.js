const mysql = require('mysql2/promise');

async function createAuditLogsTable() {
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

    // Create audit_logs table
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        domain_id VARCHAR(36) NULL COMMENT '域ID（NULL表示平台级操作）',
        user_id VARCHAR(36) NOT NULL COMMENT '操作用户ID',
        action VARCHAR(64) NOT NULL COMMENT '操作类型',
        resource_type VARCHAR(64) NOT NULL COMMENT '资源类型',
        resource_id VARCHAR(36) NULL COMMENT '资源ID',
        details JSON NULL COMMENT '操作详情',
        ip_address VARCHAR(64) NULL COMMENT 'IP地址',
        user_agent VARCHAR(512) NULL COMMENT '用户代理',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_domain_id (domain_id),
        INDEX idx_user_id (user_id),
        INDEX idx_action (action),
        INDEX idx_resource_type (resource_type),
        INDEX idx_resource_id (resource_id),
        INDEX idx_created_at (created_at),
        INDEX idx_audit_domain_time (domain_id, created_at DESC)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='审计日志表';
    `;

    await connection.query(createTableSQL);
    console.log('audit_logs table created successfully!');

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

createAuditLogsTable();
