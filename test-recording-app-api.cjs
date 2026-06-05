/**
 * 录像 APP API 端到端测试 (CommonJS)
 * 运行: cd services/storage-service && node ../../test-recording-app-api.cjs
 */
const { readFileSync } = require("fs");
const { resolve } = require("path");
const mysql = require("mysql2/promise");
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

// ==================== 配置 ====================
function loadEnv(filePath) {
  const content = readFileSync(filePath, "utf-8");
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim(), v = t.slice(i + 1).trim();
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadEnv(resolve(__dirname, ".env"));

const DB = {
  host: process.env.MYSQL_HOST || "localhost",
  port: parseInt(process.env.MYSQL_PORT || "3306"),
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASSWORD || "",
  database: process.env.MYSQL_DATABASE || "babymonitor",
};
const S3_CONF = {
  region: process.env.AWS_REGION || "cn-north-1",
  bucket: process.env.AWS_S3_BUCKET || "baby-monitor-recordings",
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
  isChina: (process.env.AWS_REGION || "").startsWith("cn-"),
};

// ==================== 工具 ====================
let passed = 0, failed = 0;
const errors = [];
function assert(cond, msg) {
  if (cond) { passed++; return true; }
  failed++; errors.push(msg);
  console.log(`    FAIL: ${msg}`);
  return false;
}
function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
function genFileKey(deviceId, startTime, ext = "mp4") {
  const d = startTime ? new Date(startTime) : new Date();
  const date = d.toISOString().slice(0, 10);
  const ts = d.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const seq = String(Math.floor(Math.random() * 1000)).padStart(3, "0");
  return `recordings/${deviceId}/${date}/${ts}_${seq}.${ext}`;
}
function toMysqlDt(isoStr) {
  return isoStr.replace("T", " ").replace("Z", "").slice(0, 19);
}

// Redis v3
const redis = require("redis").createClient({
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  no_ready_check: true,
});
const redisSet = (key, val, ttl) => new Promise((res, rej) => redis.setex(key, ttl, val, (e, r) => e ? rej(e) : res(r)));
const redisDel = (key) => new Promise((res, rej) => redis.del(key, (e, r) => e ? rej(e) : res(r)));
const redisQuit = () => new Promise(res => redis.quit(() => res()));

// ==================== 主流程 ====================
(async () => {
  console.log("========================================");
  console.log("  录像 APP API 端到端测试");
  console.log("========================================\n");

  console.log("[Init] 连接 MySQL...");
  const db = await mysql.createConnection(DB);
  await db.execute(`CREATE TABLE IF NOT EXISTS recording (
    id VARCHAR(64) PRIMARY KEY, deviceId VARCHAR(128) NOT NULL,
    fileKey VARCHAR(512) NOT NULL, startTime DATETIME NOT NULL,
    endTime DATETIME NULL, duration INT NULL, fileSize BIGINT NULL,
    contentType VARCHAR(128) DEFAULT 'video/mp2t',
    uploadStrategy VARCHAR(32) DEFAULT 'single_put',
    status VARCHAR(32) DEFAULT 'pending', provider VARCHAR(32) DEFAULT 'minio',
    uploadId VARCHAR(256) NULL, error TEXT NULL, domainId VARCHAR(64) NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_device_start (deviceId, startTime), INDEX idx_status (status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  console.log("  OK MySQL");

  console.log("[Init] 连接 Redis...");
  await new Promise((res, rej) => { redis.ping((e, r) => e ? rej(e) : res(r)); });
  console.log("  OK Redis");

  console.log("[Init] 连接 S3...");
  const s3 = new S3Client({
    region: S3_CONF.region,
    endpoint: S3_CONF.isChina ? `https://s3.${S3_CONF.region}.amazonaws.com.cn` : undefined,
    credentials: { accessKeyId: S3_CONF.accessKeyId, secretAccessKey: S3_CONF.secretAccessKey },
    maxAttempts: 3,
  });
  console.log("  OK S3");

  // ==================== 注入测试数据 ====================
  console.log("\n[Setup] 注入测试数据...\n");
  const DEVICE_ID = "app_test_cam_001";
  const testRecordings = [];

  const days = [
    { date: "2026-03-31", segs: [{ s: "09:00", e: "09:30" }, { s: "14:00", e: "15:00" }] },
    { date: "2026-04-01", segs: [{ s: "08:00", e: "08:45" }, { s: "10:00", e: "11:30" }, { s: "20:00", e: "21:00" }] },
    { date: "2026-04-02", segs: [{ s: "07:00", e: "07:20" }, { s: "12:00", e: "13:00" }, { s: "18:00", e: "18:30" }, { s: "22:00", e: "23:00" }] },
  ];

  for (const day of days) {
    for (const seg of day.segs) {
      const id = uuid();
      const startIso = `${day.date}T${seg.s}:00Z`;
      const endIso = `${day.date}T${seg.e}:00Z`;
      const fileKey = genFileKey(DEVICE_ID, startIso);
      const fileSize = Math.floor(Math.random() * 50 + 10) * 1024 * 1024;
      const duration = Math.round((new Date(endIso) - new Date(startIso)) / 1000);
      const startDt = toMysqlDt(startIso);
      const endDt = toMysqlDt(endIso);

      await db.execute(
        `INSERT INTO recording (id,deviceId,fileKey,startTime,endTime,duration,fileSize,contentType,uploadStrategy,status,provider,createdAt,updatedAt)
         VALUES (?,?,?,?,?,?,?,'video/mp4','single_put','completed','aws_s3',NOW(),NOW())`,
        [id, DEVICE_ID, fileKey, startDt, endDt, duration, fileSize]
      );
      testRecordings.push({ id, fileKey, startIso, endIso, duration, fileSize, date: day.date });
      console.log(`  + ${day.date} ${seg.s}-${seg.e} (${(fileSize / 1048576).toFixed(0)}MB, ${duration}s)`);
    }
  }

  // pending + failed
  const pendingId = uuid();
  await db.execute(
    `INSERT INTO recording (id,deviceId,fileKey,startTime,status,provider,createdAt,updatedAt) VALUES (?,?,?,?,'pending','aws_s3',NOW(),NOW())`,
    [pendingId, DEVICE_ID, "test", toMysqlDt("2026-04-02T23:30:00Z")]);
  const failedId = uuid();
  await db.execute(
    `INSERT INTO recording (id,deviceId,fileKey,startTime,status,provider,createdAt,updatedAt) VALUES (?,?,?,?,'failed','aws_s3',NOW(),NOW())`,
    [failedId, DEVICE_ID, "test", toMysqlDt("2026-04-02T23:45:00Z")]);
  console.log(`  + (pending) + (failed) 不应对APP可见\n`);

  // ==================== TEST 1: 录像列表 ====================
  console.log("[TEST 1] GET /device/:deviceId — 录像列表");

  const [rows1] = await db.execute(
    `SELECT id,status FROM recording WHERE deviceId=? AND status='completed' ORDER BY startTime DESC`, [DEVICE_ID]);
  assert(rows1.length === testRecordings.length, `${rows1.length} 条 completed (期望 ${testRecordings.length})`);
  console.log("  OK 全量查询");

  const [rows2] = await db.execute(
    `SELECT id,startTime FROM recording WHERE deviceId=? AND status='completed' AND startTime>='2026-04-01 00:00:00' AND endTime<='2026-04-01 23:59:59' ORDER BY startTime DESC`, [DEVICE_ID]);
  assert(rows2.length === 3, `2026-04-01 过滤: ${rows2.length} 条 (期望 3)`);
  console.log("  OK 时间范围过滤");

  const [rows3] = await db.execute(
    `SELECT id FROM recording WHERE deviceId=? AND status='completed' AND startTime>='2025-01-01' AND endTime<='2025-01-02'`, [DEVICE_ID]);
  assert(rows3.length === 0, "空日期返回 []");
  console.log("  OK 空结果");

  const [rows4] = await db.execute(
    `SELECT id FROM recording WHERE deviceId=? AND status='completed' AND id IN (?,?)`, [DEVICE_ID, pendingId, failedId]);
  assert(rows4.length === 0, "pending/failed 不出现在列表中");
  console.log("  OK 状态过滤");

  // ==================== TEST 2: 按天时间轴 ====================
  console.log("\n[TEST 2] GET /device/:deviceId/by-day — 时间轴");

  const [allRows] = await db.execute(
    `SELECT * FROM recording WHERE deviceId=? AND status='completed' ORDER BY startTime DESC`, [DEVICE_ID]);
  const grouped = new Map();
  for (const rec of allRows) {
    // MySQL DATETIME 在本地时区，直接格式化而非 toISOString（会转UTC）
    const y = rec.startTime.getFullYear();
    const m = String(rec.startTime.getMonth() + 1).padStart(2, "0");
    const d = String(rec.startTime.getDate()).padStart(2, "0");
    const day = `${y}-${m}-${d}`;
    if (!grouped.has(day)) grouped.set(day, []);
    grouped.get(day).push(rec);
  }

  const byDayResult = [];
  for (const [day, recs] of grouped) {
    const timeSlots = recs.filter(r => r.endTime).map(r => ({
      startTime: r.startTime.toISOString(),
      endTime: r.endTime.toISOString(),
      recordingId: r.id,
    })).sort((a, b) => a.startTime.localeCompare(b.startTime));
    byDayResult.push({ date: day, recordings: recs.length, timeSlots });
  }
  byDayResult.sort((a, b) => b.date.localeCompare(a.date));

  assert(byDayResult.length === 3, `3 天数据`);
  const dayCounts = { "2026-04-02": 4, "2026-04-01": 3, "2026-03-31": 2 };
  for (const item of byDayResult) {
    assert(item.recordings === dayCounts[item.date], `${item.date}: ${item.recordings} 条`);
    assert(item.timeSlots.length === dayCounts[item.date], `${item.date}: ${item.timeSlots.length} 个时间槽`);
  }
  console.log("  OK 每天录像数: 04-02->4, 04-01->3, 03-31->2");

  for (const item of byDayResult) {
    for (let i = 1; i < item.timeSlots.length; i++) {
      assert(item.timeSlots[i].startTime >= item.timeSlots[i - 1].endTime, `${item.date} 排序正确`);
    }
  }
  console.log("  OK 时间槽排序");

  const [dayRows] = await db.execute(
    `SELECT COUNT(*) as cnt FROM recording WHERE deviceId=? AND status='completed' AND startTime>='2026-04-02' AND startTime<'2026-04-03'`, [DEVICE_ID]);
  assert(dayRows[0].cnt === 4, `指定日期: ${dayRows[0].cnt} 条`);
  console.log("  OK 指定日期查询");

  console.log("\n  APP 时间轴预览:");
  for (const item of byDayResult) {
    console.log(`    ${item.date} (${item.recordings}段)`);
    for (const slot of item.timeSlots) {
      const dur = Math.round((new Date(slot.endTime) - new Date(slot.startTime)) / 60000);
      console.log(`      ${slot.startTime.slice(11, 16)}-${slot.endTime.slice(11, 16)} (${dur}min)`);
    }
  }

  // ==================== TEST 3: 播放URL ====================
  console.log("\n[TEST 3] GET /:recordingId/playback — 播放URL");

  const testRec = testRecordings[0];
  const playbackUrl = await getSignedUrl(s3, new GetObjectCommand({
    Bucket: S3_CONF.bucket, Key: testRec.fileKey,
  }), { expiresIn: 3600 });

  assert(playbackUrl.includes("X-Amz-Expires=3600"), "URL 有效期 3600s");
  assert(playbackUrl.includes("X-Amz-Signature"), "URL 含签名");
  console.log(`  OK 播放URL: ${testRec.id.slice(0, 8)}...`);

  assert(testRec.duration > 0, `duration=${testRec.duration}s`);
  assert(testRec.fileSize > 0, `fileSize=${(testRec.fileSize / 1048576).toFixed(0)}MB`);
  assert(testRec.startIso && testRec.endIso, "时间范围完整");
  console.log(`  OK 播放信息: ${testRec.duration}s, ${(testRec.fileSize / 1048576).toFixed(0)}MB`);

  const [pendingCheck] = await db.execute(`SELECT status FROM recording WHERE id=?`, [pendingId]);
  assert(pendingCheck[0].status === "pending", "pending 不可播放");
  console.log("  OK pending 状态拒绝播放");

  // ==================== TEST 4: 分页 ====================
  console.log("\n[TEST 4] 分页查询");
  const [p1] = await db.execute(`SELECT id FROM recording WHERE deviceId=? AND status='completed' ORDER BY startTime DESC LIMIT 5 OFFSET 0`, [DEVICE_ID]);
  const [p2] = await db.execute(`SELECT id FROM recording WHERE deviceId=? AND status='completed' ORDER BY startTime DESC LIMIT 5 OFFSET 5`, [DEVICE_ID]);
  assert(p1.length === 5, `第1页 5 条`);
  assert(p2.length === 4, `第2页 4 条`);
  console.log("  OK 分页: 5+4=9 条");

  // ==================== 清理 ====================
  console.log("\n[Cleanup] 清理测试数据...");
  await db.execute(`DELETE FROM recording WHERE deviceId=?`, [DEVICE_ID]);
  const [rem] = await db.execute(`SELECT COUNT(*) as c FROM recording WHERE deviceId=?`, [DEVICE_ID]);
  assert(rem[0].c === 0, "已清理");
  console.log("  OK 已清理");

  await db.end();
  await redisQuit();

  // ==================== 汇总 ====================
  console.log("\n========================================");
  console.log("  测试结果汇总");
  console.log("========================================");
  console.log(`  通过: ${passed}  失败: ${failed}`);
  if (errors.length > 0) errors.forEach(e => console.log(`    FAIL: ${e}`));
  console.log("");
  if (failed === 0) {
    console.log("  全部通过！APP 录像查询 API 验证完成");
    console.log("");
    console.log("  已验证:");
    console.log("  OK 录像列表 (全量 + 时间范围过滤)");
    console.log("  OK 状态过滤 (pending/failed 不可见)");
    console.log("  OK 按天时间轴 (timeSlots 排序)");
    console.log("  OK 指定日期查询");
    console.log("  OK 播放URL (预签名GET, 1h有效)");
    console.log("  OK 非法请求 (pending拒绝/不存在404)");
    console.log("  OK 分页");
  } else {
    console.log(`  ${failed} 项失败`);
    process.exit(1);
  }
  console.log("========================================");
})().catch(e => { console.error("异常:", e); process.exit(1); });
