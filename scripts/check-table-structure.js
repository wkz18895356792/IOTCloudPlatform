const mysql = require('mysql2/promise');
require('dotenv').config();

async function checkTableStructure() {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT || '3306'),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'babymonitor',
  });

  try {
    console.log('Checking table structures...\n');

    // 检查 domains 表结构
    const [domainsColumns] = await connection.query(`
      SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'babymonitor' AND TABLE_NAME = 'domains'
      ORDER BY ORDINAL_POSITION
    `);
    console.log('domains table columns:');
    domainsColumns.forEach(col => console.log(`  - ${col.COLUMN_NAME}: ${col.COLUMN_TYPE}`));

    // 检查 domain_roles 表结构
    const [domainRolesColumns] = await connection.query(`
      SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'babymonitor' AND TABLE_NAME = 'domain_roles'
      ORDER BY ORDINAL_POSITION
    `);
    console.log('\ndomain_roles table columns:');
    domainRolesColumns.forEach(col => console.log(`  - ${col.COLUMN_NAME}: ${col.COLUMN_TYPE}`));

    // 检查 platform_admins 表结构
    const [platformAdminsColumns] = await connection.query(`
      SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'babymonitor' AND TABLE_NAME = 'platform_admins'
      ORDER BY ORDINAL_POSITION
    `);
    console.log('\nplatform_admins table columns:');
    platformAdminsColumns.forEach(col => console.log(`  - ${col.COLUMN_NAME}: ${col.COLUMN_TYPE}`));

    // 检查每个表的数据量
    const [domainCount] = await connection.query('SELECT COUNT(*) as count FROM domains');
    const [domainRoleCount] = await connection.query('SELECT COUNT(*) as count FROM domain_roles');
    const [platformAdminCount] = await connection.query('SELECT COUNT(*) as count FROM platform_admins');

    console.log('\nData counts:');
    console.log(`  - domains: ${domainCount[0].count} rows`);
    console.log(`  - domain_roles: ${domainRoleCount[0].count} rows`);
    console.log(`  - platform_admins: ${platformAdminCount[0].count} rows`);

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await connection.end();
  }
}

checkTableStructure();
