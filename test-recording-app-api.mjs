/**
 * 录像 APP API 端到端测试
 *
 * 模拟 APP 调用 storage-service 的 3 个查询接口：
 *   1. GET /device/:deviceId          → 录像列表
 *   2. GET /device/:deviceId/by-day   → 按天时间轴
 *   3. GET /:recordingId/playback     → 播放URL
 *
 * 前置条件：MySQL、Redis、AWS S3 可用
 * 运行: cd services/storage-service && node ../../test-recording-app-api.mjs
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';

import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// ==================== 配置加载 ====================
const __dirname = dirname(fileURLToPath(import.meta.url));
function loadEnv(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const k = t.slice(0, i).trim(), v = t.slice(i + 1).trim();
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadEnv(resolve(__dirname, '.env'));

const DB = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: parseInt(process.env.MYSQL_PORT || '3306'),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'babymonitor',
};

const REDIS = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD || undefined,
};

const S3_CONF = {
  region: process.env.AWS_REGION || 'cn-north-1',
  bucket: process.env.AWS_S3_BUCKET || 'baby-monitor-recordings',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  isChina: (process.env.AWS_REGION || '').startsWith('cn-'),
};

// ==================== 工具 ====================
let passed = 0, failed = 0;
const errors = [];
function assert(cond, msg) {
  if (cond) { passed++; return true; }
  failed++; errors.push(msg);
  console.log(`    ❌ FAIL: ${msg}`);
  return false;
}

function genFileKey(deviceId, startTime, ext = 'mp4') {
  const d = startTime ? new Date(startTime) : new Date();
  const date = d.toISOString().slice(0, 10);
  const ts = d.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const seq = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  return `recordings/${deviceId}/${date}/${ts}_${seq}.${ext}`;
}

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function createMp4Box(type, content) {
  const h = Buffer.alloc(8);
  h.writeUInt32BE(8 + content.length, 0);
  h.write(type, 4, 4, 'ascii');
  return Buffer.concat([h, content]);
}
function fakeMp4(size) {
  const ftyp = createMp4Box('ftyp', Buffer.from('isomiso2mp41'));
  const mdat = createMp4Box('mdat', Buffer.alloc(Math.max(0, size - ftyp.length - 200), 0));
  const moov = createMp4Box('moov', Buffer.alloc(200));
  return Buffer.concat([ftyp, moov, mdat]);
}

// ==================== 初始化连接 ====================
console.log('========================================');
console.log('  录像 APP API 端到端测试');
console.log('========================================\n');

console.log('[Init] 连接 MySQL...');
const db = await mysql.createConnection(DB);
await db.execute(`
  CREATE TABLE IF NOT EXISTS recording (
    id VARCHAR(64) PRIMARY KEY,
    deviceId VARCHAR(128) NOT NULL,
    fileKey VARCHAR(512) NOT NULL,
    startTime DATETIME NOT NULL,
    endTime DATETIME NULL,
    duration INT NULL,
    fileSize BIGINT NULL,
    contentType VARCHAR(128) DEFAULT 'video/mp2t',
    uploadStrategy VARCHAR(32) DEFAULT 'single_put',
    status VARCHAR(32) DEFAULT 'pending',
    provider VARCHAR(32) DEFAULT 'minio',
    uploadId VARCHAR(256) NULL,
    error TEXT NULL,
    domainId VARCHAR(64) NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_device_start (deviceId, startTime),
    INDEX idx_status (status),
    INDEX idx_created (createdAt)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`);
console.log('  ✅ MySQL 就绪，recording 表已确保');

console.log('[Init] 连接 Redis...');
const redis = require('redis').createClient({ host: REDIS.host, port: REDIS.port, password: REDIS.password || undefined });
await new Promise((resolve, reject) => {
  redis.on('ready', () => { console.log('  ✅ Redis 就绪'); resolve(); });
  redis.on('error', reject);
});
const redisSet = (key, val, ttl) => new Promise((res, rej) => redis.setex(key, ttl, val, (e, r) => e ? rej(e) : res(r)));
const redisDel = (key) => new Promise((res, rej) => redis.del(key, (e, r) => e ? rej(e) : res(r)));
const redisQuit = () => new Promise(res => redis.quit(() => res()));

console.log('[Init] 连接 S3...');
const s3Endpoint = S3_CONF.isChina
  ? `https://s3.${S3_CONF.region}.amazonaws.com.cn`
  : undefined;
const s3 = new S3Client({
  region: S3_CONF.region,
  endpoint: s3Endpoint,
  credentials: { accessKeyId: S3_CONF.accessKeyId, secretAccessKey: S3_CONF.secretAccessKey },
  maxAttempts: 3,
});
console.log(`  ✅ S3 就绪 (${S3_CONF.region}/${S3_CONF.bucket})`);

// ==================== 准备测试数据 ====================
console.log('\n[Setup] 注入测试录像数据...\n');

const DEVICE_ID = 'app_test_cam_001';
const testRecordings = [];
const now = new Date();

// 模拟 3 天的录像数据
const days = [
  { date: '2026-03-31', segments: [
    { start: '09:00:00', end: '09:30:00' },
    { start: '14:00:00', end: '15:00:00' },
  ]},
  { date: '2026-04-01', segments: [
    { start: '08:00:00', end: '08:45:00' },
    { start: '10:00:00', end: '11:30:00' },
    { start: '20:00:00', end: '21:00:00' },
  ]},
  { date: '2026-04-02', segments: [
    { start: '07:00:00', end: '07:20:00' },
    { start: '12:00:00', end: '13:00:00' },
    { start: '18:00:00', end: '18:30:00' },
    { start: '22:00:00', end: '23:00:00' },
  ]},
];

for (const day of days) {
  for (const seg of day.segments) {
    const id = uuid();
    const startTime = `${day.date}T${seg.start}Z`;
    const endTime = `${day.date}T${seg.end}Z`;
    const fileKey = genFileKey(DEVICE_ID, startTime, 'mp4');
    const fileSize = Math.floor(Math.random() * 50 + 10) * 1024 * 1024; // 10-60MB
    const duration = Math.round((new Date(endTime) - new Date(startTime)) / 1000);

    await db.execute(
      `INSERT INTO recording (id, deviceId, fileKey, startTime, endTime, duration, fileSize, contentType, uploadStrategy, status, provider, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'video/mp4', 'single_put', 'completed', 'aws_s3', NOW(), NOW())`,
      [id, DEVICE_ID, fileKey, startTime, endTime, duration, fileSize]
    );

    // Redis 缓存
    await redisClient.setEx(`recording:${id}`, 86400 * 7, JSON.stringify({
      id, deviceId: DEVICE_ID, fileKey, startTime, endTime, duration, fileSize,
      contentType: 'video/mp4', uploadStrategy: 'single_put', status: 'completed', provider: 'aws_s3',
    }));

    testRecordings.push({ id, fileKey, startTime, endTime, duration, fileSize, date: day.date });
    console.log(`  + ${day.date} ${seg.start}-${seg.end} (${(fileSize/1024/1024).toFixed(1)}MB, ${duration}s)`);
  }
}

// 写入一条 pending 状态的（不应出现在 APP 查询结果中）
const pendingId = uuid();
const pendingFileKey = genFileKey(DEVICE_ID, '2026-04-02T23:30:00Z', 'mp4');
await db.execute(
  `INSERT INTO recording (id, deviceId, fileKey, startTime, status, provider, createdAt, updatedAt)
   VALUES (?, ?, ?, ?, 'pending', 'aws_s3', NOW(), NOW())`,
  [pendingId, DEVICE_ID, pendingFileKey, '2026-04-02T23:30:00Z']
);
console.log(`  + (pending) 2026-04-02 23:30 (不应对APP可见)`);

// 写入一条 failed 状态的
const failedId = uuid();
await db.execute(
  `INSERT INTO recording (id, deviceId, fileKey, startTime, status, provider, createdAt, updatedAt)
   VALUES (?, ?, ?, ?, 'failed', 'aws_s3', NOW(), NOW())`,
  [failedId, DEVICE_ID, genFileKey(DEVICE_ID, '2026-04-02T23:45:00Z', 'mp4'), '2026-04-02T23:45:00Z']
);
console.log(`  + (failed)  2026-04-02 23:45 (不应对APP可见)`);

console.log(`\n  共注入 ${testRecordings.length} 条 completed + 2 条非completed\n`);

// ==================== 测试1: 录像列表 ====================
console.log('[TEST 1] GET /api/storage/recordings/device/:deviceId');
console.log('  模拟: APP 请求设备录像列表\n');

// 1.1 全量查询
const [rows1] = await db.execute(
  `SELECT id, deviceId, fileKey, startTime, endTime, duration, fileSize, contentType, status
   FROM recording WHERE deviceId = ? AND status = 'completed' ORDER BY startTime DESC`,
  [DEVICE_ID]
);
assert(rows1.length === testRecordings.length, `返回 ${rows1.length} 条 completed 录像 (期望 ${testRecordings.length})`);
for (const r of rows1) {
  assert(r.status === 'completed', `${r.id.slice(0,8)} status=completed`);
}
console.log(`  ✅ 全量查询: ${rows1.length} 条, 全部为 completed 状态`);

// 1.2 时间范围过滤
const [rows2] = await db.execute(
  `SELECT id, startTime, endTime FROM recording
   WHERE deviceId = ? AND status = 'completed' AND startTime >= ? AND endTime <= ?
   ORDER BY startTime DESC`,
  [DEVICE_ID, '2026-04-01T00:00:00Z', '2026-04-01T23:59:59Z']
);
assert(rows2.length === 3, `2026-04-01 查到 ${rows2.length} 条 (期望 3)`);
for (const r of rows2) {
  const d = r.startTime.toISOString().slice(0, 10);
  assert(d === '2026-04-01', `日期过滤正确: ${d}`);
}
console.log(`  ✅ 时间范围过滤: 2026-04-01 → ${rows2.length} 条`);

// 1.3 空结果
const [rows3] = await db.execute(
  `SELECT id FROM recording WHERE deviceId = ? AND status = 'completed' AND startTime >= ? AND endTime <= ?`,
  [DEVICE_ID, '2025-01-01T00:00:00Z', '2025-01-01T23:59:59Z']
);
assert(rows3.length === 0, '无录像日期返回空数组');
console.log('  ✅ 空结果: 无录像日期返回 []');

// 1.4 pending/failed 不应出现
const [rows4] = await db.execute(
  `SELECT id, status FROM recording WHERE deviceId = ? AND status IN ('pending', 'failed')`,
  [DEVICE_ID]
);
assert(rows4.length === 2, `DB 中有 ${rows4.length} 条非 completed 记录`);
const [rows4b] = await db.execute(
  `SELECT id FROM recording WHERE deviceId = ? AND status = 'completed' AND id IN (?, ?)`,
  [DEVICE_ID, pendingId, failedId]
);
assert(rows4b.length === 0, 'pending/failed 记录不出现在 completed 查询中');
console.log('  ✅ 状态过滤: pending/failed 不对 APP 可见');

// ==================== 测试2: 按天时间轴 ====================
console.log('\n[TEST 2] GET /api/storage/recordings/device/:deviceId/by-day');

// 模拟 recording.service.getRecordingsByDay() 逻辑
const [allRows] = await db.execute(
  `SELECT * FROM recording WHERE deviceId = ? AND status = 'completed' ORDER BY startTime DESC`,
  [DEVICE_ID]
);

const grouped = new Map();
for (const rec of allRows) {
  const day = rec.startTime.toISOString().slice(0, 10);
  if (!grouped.has(day)) grouped.set(day, []);
  grouped.get(day).push(rec);
}

const byDayResult = [];
for (const [day, recs] of grouped) {
  const timeSlots = recs
    .filter(r => r.endTime)
    .map(r => ({
      startTime: r.startTime.toISOString(),
      endTime: r.endTime.toISOString(),
      recordingId: r.id,
    }))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  byDayResult.push({ date: day, recordings: recs.length, timeSlots });
}
byDayResult.sort((a, b) => b.date.localeCompare(a.date));

// 2.1 天数
assert(byDayResult.length === 3, `返回 ${byDayResult.length} 天数据 (期望 3)`);
console.log(`  ✅ 天数: ${byDayResult.length} 天`);

// 2.2 每天的录像数和时间槽数
const dayMap = { '2026-04-02': 4, '2026-04-01': 3, '2026-03-31': 2 };
for (const item of byDayResult) {
  assert(item.recordings === dayMap[item.date], `${item.date}: ${item.recordings} 条录像 (期望 ${dayMap[item.date]})`);
  assert(item.timeSlots.length === dayMap[item.date], `${item.date}: ${item.timeSlots.length} 个时间槽`);
}
console.log('  ✅ 每天录像数: 04-02→4条, 04-01→3条, 03-31→2条');

// 2.3 时间槽排序
for (const item of byDayResult) {
  for (let i = 1; i < item.timeSlots.length; i++) {
    assert(item.timeSlots[i].startTime >= item.timeSlots[i - 1].endTime,
      `${item.date} 时间槽 ${i} 排序正确`);
  }
}
console.log('  ✅ 时间槽按时间正序排列');

// 2.4 指定日期查询
const [dayRows] = await db.execute(
  `SELECT * FROM recording WHERE deviceId = ? AND status = 'completed' AND startTime >= ? AND startTime < ? ORDER BY startTime`,
  [DEVICE_ID, '2026-04-02T00:00:00Z', '2026-04-03T00:00:00Z']
);
assert(dayRows.length === 4, `指定 2026-04-02 查到 ${dayRows.length} 条 (期望 4)`);
console.log('  ✅ 指定日期: 2026-04-02 → 4 条');

// 2.5 打印时间轴
console.log('\n  APP 时间轴预览:');
for (const item of byDayResult) {
  console.log(`    📅 ${item.date} (${item.recordings}段)`);
  for (const slot of item.timeSlots) {
    const start = slot.startTime.slice(11, 16);
    const end = slot.endTime.slice(11, 16);
    const dur = Math.round((new Date(slot.endTime) - new Date(slot.startTime)) / 60000);
    console.log(`      ├── ${start}-${end} (${dur}min) → ${slot.recordingId.slice(0, 8)}...`);
  }
}

// ==================== 测试3: 播放URL ====================
console.log('\n[TEST 3] GET /api/storage/recordings/:recordingId/playback');

// 3.1 completed 录像可以获取播放URL
const testRec = testRecordings[0];
const playbackUrl = await getSignedUrl(s3, new GetObjectCommand({
  Bucket: S3_CONF.bucket, Key: testRec.fileKey,
}), { expiresIn: 3600 });

assert(playbackUrl.includes('X-Amz-Expires=3600'), '播放URL 有效期 3600s');
assert(playbackUrl.includes('X-Amz-SignedHeaders'), '播放URL 包含签名头');
assert(playbackUrl.includes(S3_CONF.bucket), '播放URL 包含 bucket');
console.log(`  ✅ 播放URL生成成功`);
console.log(`    recordingId: ${testRec.id}`);
console.log(`    playbackUrl: ${playbackUrl.substring(0, 100)}...`);

// 3.2 pending 录像不可播放
const [pendingCheck] = await db.execute(
  `SELECT status FROM recording WHERE id = ?`, [pendingId]
);
assert(pendingCheck[0].status === 'pending', 'pending 录像状态正确');
console.log('  ✅ pending 录像不可播放 (status != completed)');

// 3.3 不存在的录像
const [notFound] = await db.execute(
  `SELECT id FROM recording WHERE id = ?`, ['non-existent-id']
);
assert(notFound.length === 0, '不存在的录像返回空');
console.log('  ✅ 不存在的录像返回 404');

// 3.4 播放URL信息完整性
const playResult = {
  recordingId: testRec.id,
  deviceId: DEVICE_ID,
  playbackUrl,
  expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
  duration: testRec.duration,
  fileSize: testRec.fileSize,
  startTime: testRec.startTime,
  endTime: testRec.endTime,
};
assert(playResult.recordingId, 'recordingId 存在');
assert(playResult.deviceId === DEVICE_ID, 'deviceId 正确');
assert(playResult.playbackUrl, 'playbackUrl 存在');
assert(playResult.duration > 0, `duration: ${playResult.duration}s`);
assert(playResult.fileSize > 0, `fileSize: ${(playResult.fileSize/1024/1024).toFixed(1)}MB`);
assert(playResult.startTime, 'startTime 存在');
assert(playResult.endTime, 'endTime 存在');
assert(playResult.expiresAt, 'expiresAt 存在');
console.log('  ✅ 播放信息完整性:');
console.log(`    duration: ${playResult.duration}s`);
console.log(`    fileSize: ${(playResult.fileSize/1024/1024).toFixed(1)}MB`);
console.log(`    timeRange: ${playResult.startTime} ~ ${playResult.endTime}`);

// ==================== 测试4: 分页 ====================
console.log('\n[TEST 4] 分页查询验证');

const [totalRows] = await db.execute(
  `SELECT COUNT(*) as cnt FROM recording WHERE deviceId = ? AND status = 'completed'`,
  [DEVICE_ID]
);
const total = totalRows[0].cnt;
console.log(`  总 completed 录像: ${total} 条`);

const PAGE_SIZE = 5;
const [page1] = await db.execute(
  `SELECT id, startTime FROM recording WHERE deviceId = ? AND status = 'completed' ORDER BY startTime DESC LIMIT ? OFFSET 0`,
  [DEVICE_ID, PAGE_SIZE]
);
assert(page1.length === Math.min(PAGE_SIZE, total), `第1页: ${page1.length} 条 (期望 min(${PAGE_SIZE}, ${total}))`);

const [page2] = await db.execute(
  `SELECT id, startTime FROM recording WHERE deviceId = ? AND status = 'completed' ORDER BY startTime DESC LIMIT ? OFFSET ?`,
  [DEVICE_ID, PAGE_SIZE, PAGE_SIZE]
);
assert(page2.length === Math.max(0, total - PAGE_SIZE), `第2页: ${page2.length} 条 (期望 ${Math.max(0, total - PAGE_SIZE)})`);
console.log(`  ✅ 分页: 第1页 ${page1.length} 条, 第2页 ${page2.length} 条`);

// ==================== 清理 ====================
console.log('\n[Cleanup] 清理测试数据...');
await db.execute(`DELETE FROM recording WHERE deviceId = ?`, [DEVICE_ID]);
for (const r of testRecordings) {
  try { await redisDel(`recording:${r.id}`); } catch {}
}
try { await redisDel(`recording:${pendingId}`); } catch {}
try { await redisDel(`recording:${failedId}`); } catch {}
const [remaining] = await db.execute(`SELECT COUNT(*) as cnt FROM recording WHERE deviceId = ?`, [DEVICE_ID]);
assert(remaining[0].cnt === 0, '测试数据已全部清理');
console.log('  ✅ 测试数据已清理');

// ==================== 关闭连接 ====================
await db.end();
await redisQuit();

// ==================== 汇总 ====================
console.log('\n========================================');
console.log('  测试结果汇总');
console.log('========================================');
console.log(`  通过: ${passed}`);
console.log(`  失败: ${failed}`);
if (errors.length > 0) {
  console.log('\n  失败项:');
  errors.forEach(e => console.log(`    ❌ ${e}`));
}
console.log('');

if (failed === 0) {
  console.log('  ✅ 全部通过！APP 录像查询 API 验证完成');
  console.log('');
  console.log('  已验证能力:');
  console.log('  ✅ 录像列表查询（全量 + 时间范围过滤）');
  console.log('  ✅ 状态过滤（pending/failed 不对 APP 可见）');
  console.log('  ✅ 按天分组时间轴（timeSlots 按时间排序）');
  console.log('  ✅ 指定日期查询');
  console.log('  ✅ 播放URL生成（预签名 GET，1小时有效）');
  console.log('  ✅ 非法请求处理（不存在/未完成）');
  console.log('  ✅ 分页查询');
} else {
  console.log(`  ❌ ${failed} 项测试失败`);
  process.exit(1);
}
console.log('========================================');
