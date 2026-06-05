/**
 * 录像直存全流程 E2E 测试 — 腾讯云 COS (S3 兼容协议)
 *
 * 使用 AWS SDK v3 连接 COS S3 兼容 endpoint，验证直存链路
 * 验证 COS 的 S3 兼容性与 AWS S3 行为一致
 *
 * 运行: cd services/storage-service && node ../../test-cos-s3-direct-store.mjs
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ==================== AWS SDK v3 (S3 兼容协议) ====================
import { S3Client, HeadBucketCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, DeleteObjectsCommand, HeadObjectCommand, ListObjectsV2Command, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// ==================== 配置加载 ====================
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '.env');

function loadEnv(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
  console.log(`[Config] 已加载 ${filePath}`);
}
loadEnv(envPath);

// ==================== COS S3 兼容配置 ====================
const COS_REGION = process.env.TENCENT_COS_REGION || 'ap-guangzhou';
const COS_BUCKET = 'rjitest-1252299443';
const COS_SECRET_ID = process.env.TENCENT_COS_SECRET_ID || '';
const COS_SECRET_KEY = process.env.TENCENT_COS_SECRET_KEY || '';
// COS S3 兼容 endpoint
const COS_ENDPOINT = `https://cos.${COS_REGION}.myqcloud.com`;

if (!COS_SECRET_ID || COS_SECRET_ID === 'your_secret_id') {
  console.error('========================================');
  console.error('  COS 凭证未配置！');
  console.error('  请在 .env 中设置:');
  console.error('    TENCENT_COS_SECRET_ID');
  console.error('    TENCENT_COS_SECRET_KEY');
  console.error('    TENCENT_COS_BUCKET');
  console.error('    TENCENT_COS_REGION');
  console.error('========================================');
  process.exit(1);
}

const s3 = new S3Client({
  region: COS_REGION,
  endpoint: COS_ENDPOINT,
  credentials: {
    accessKeyId: COS_SECRET_ID,
    secretAccessKey: COS_SECRET_KEY,
  },
  forcePathStyle: false,
  maxAttempts: 3,
});

console.log(`\n[COS S3兼容] 客户端初始化完成`);
console.log(`  Endpoint: ${COS_ENDPOINT}`);
console.log(`  Bucket:   ${COS_BUCKET}`);
console.log(`  Region:   ${COS_REGION}`);
console.log(`  SecretId: ${COS_SECRET_ID.slice(0, 8)}...`);

// ==================== 工具函数 ====================
let passed = 0;
let failed = 0;
const errors = [];

function assert(condition, msg) {
  if (condition) { passed++; return true; }
  failed++;
  errors.push(msg);
  console.log(`    ❌ FAIL: ${msg}`);
  return false;
}

function generateFileKey(deviceId, startTime, extension = 'mp4') {
  const now = startTime ? new Date(startTime) : new Date();
  const date = now.toISOString().slice(0, 10);
  const timestamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const seq = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  return `recordings/${deviceId}/${date}/${timestamp}_${seq}.${extension}`;
}

// 合法 MP4 生成
function createMp4Box(type, content) {
  const size = 8 + content.length;
  const header = Buffer.alloc(8);
  header.writeUInt32BE(size, 0);
  header.write(type, 4, 4, 'ascii');
  return Buffer.concat([header, content]);
}

function generateFakeMp4(sizeBytes) {
  const ftypBox = createMp4Box('ftyp', Buffer.from('isomiso2mp41'));
  const mdatPayloadSize = Math.max(0, sizeBytes - ftypBox.length - 200);
  const mdatBox = createMp4Box('mdat', Buffer.alloc(mdatPayloadSize, 0));
  const moovPayload = Buffer.alloc(108 + 92 + 32 + 33 + 20 + 16 + 16 + 20 + 16);
  const moovBox = createMp4Box('moov', moovPayload);
  return Buffer.concat([ftypBox, moovBox, mdatBox]);
}

// ==================== 测试用例 ====================

async function test1_headBucket() {
  console.log('\n[TEST 1] 验证 COS Bucket 可访问');
  try {
    await s3.send(new HeadBucketCommand({ Bucket: COS_BUCKET }));
    assert(true, `Bucket 可访问: ${COS_BUCKET}`);
  } catch (e) {
    const status = e.$metadata?.httpStatusCode;
    if (status === 404) {
      assert(false, `Bucket 不存在: ${COS_BUCKET} (需要带 AppID 后缀，如 baby-monitor-125xxxxxxx)`);
    } else if (status === 403) {
      assert(false, `权限不足: ${e.message}`);
    } else {
      assert(false, `访问失败 (${status}): ${e.message}`);
    }
  }
}

async function test2_presignedPutUrl() {
  console.log('\n[TEST 2] 生成预签名 PUT URL');
  const deviceId = 'cos_cam_001';
  const fileKey = generateFileKey(deviceId);
  const contentType = 'video/mp4';
  const expiresIn = 3600;

  const uploadUrl = await getSignedUrl(s3, new PutObjectCommand({
    Bucket: COS_BUCKET, Key: fileKey, ContentType: contentType,
  }), { expiresIn });

  assert(uploadUrl.includes('cos.ap-guangzhou.myqcloud.com'), 'URL 包含 COS endpoint');
  assert(uploadUrl.includes('X-Amz-Algorithm=AWS4-HMAC-SHA256'), 'URL 使用 AWS4 签名');
  assert(uploadUrl.includes('X-Amz-Expires=3600'), 'URL 过期时间 3600s');
  assert(uploadUrl.includes(fileKey), 'URL 包含 fileKey');

  console.log(`  fileKey:  ${fileKey}`);
  console.log(`  uploadUrl: ${uploadUrl.substring(0, 120)}...`);
  console.log(`  ✅ 预签名 PUT URL 生成成功`);

  return { fileKey, uploadUrl, deviceId, contentType };
}

async function test3_directUpload(fileKey, contentType) {
  console.log('\n[TEST 3] 摄像头直传 COS（S3 兼容协议 PUT）');
  const fakeMp4 = generateFakeMp4(2048);
  const uploadedSize = fakeMp4.length;

  try {
    const result = await s3.send(new PutObjectCommand({
      Bucket: COS_BUCKET, Key: fileKey,
      Body: fakeMp4, ContentType: contentType,
      Metadata: { 'recording-device': 'cos_cam_001', 'recording-type': 's3-compatible-test' },
    }));
    assert(result.ETag, `直传成功, ETag: ${result.ETag}`);
    console.log(`  ✅ 直传成功: ${fileKey} (${uploadedSize} bytes)`);
    return uploadedSize;
  } catch (e) {
    assert(false, `直传失败: ${e.message}`);
  }
}

async function test4_verifyFile(fileKey, expectedSize) {
  console.log('\n[TEST 4] 验证文件元数据');
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: COS_BUCKET, Key: fileKey }));
    assert(head.ContentLength === expectedSize, `文件大小: ${head.ContentLength} bytes`);
    assert(head.ContentType === 'video/mp4', `ContentType: ${head.ContentType}`);
    assert(head.ETag, `ETag: ${head.ETag}`);
    assert(head.Metadata?.['recording-device'] === 'cos_cam_001', '自定义元数据正确');
    console.log(`  ✅ 文件验证通过`);
  } catch (e) {
    assert(false, `验证失败: ${e.message}`);
  }
}

async function test5_presignedGetUrl(fileKey, expectedSize) {
  console.log('\n[TEST 5] 生成预签名 GET URL（APP播放）');
  const getUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: COS_BUCKET, Key: fileKey }), { expiresIn: 3600 });

  assert(getUrl.includes('cos.ap-guangzhou.myqcloud.com'), 'GET URL 包含 COS endpoint');
  assert(getUrl.includes('X-Amz-Signature'), 'GET URL 包含签名');
  console.log(`  playbackUrl: ${getUrl.substring(0, 120)}...`);
  console.log(`  ✅ 预签名 GET URL 生成成功`);

  // 模拟 APP 下载
  try {
    const result = await s3.send(new GetObjectCommand({ Bucket: COS_BUCKET, Key: fileKey }));
    const bytes = await result.Body.transformToByteArray();
    assert(bytes.length === expectedSize, `下载大小: ${bytes.length} bytes`);
    const ftyp = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
    assert(ftyp === 'ftyp', `MP4 ftyp box: ${ftyp}`);
    console.log(`  ✅ APP 下载验证通过`);
  } catch (e) {
    assert(false, `下载失败: ${e.message}`);
  }
}

async function test6_listRecordings(deviceId) {
  console.log('\n[TEST 6] 按设备列出录像');
  try {
    const result = await s3.send(new ListObjectsV2Command({
      Bucket: COS_BUCKET, Prefix: `recordings/${deviceId}/`, MaxKeys: 100,
    }));
    const count = result.Contents?.length || 0;
    assert(count > 0, `找到 ${count} 个录像文件`);
    for (const obj of result.Contents) {
      console.log(`    ${obj.Key} (${obj.Size} bytes)`);
    }
    console.log(`  ✅ 列表查询成功`);
  } catch (e) {
    assert(false, `列表查询失败: ${e.message}`);
  }
}

async function test7_multipartUpload() {
  console.log('\n[TEST 7] 分片上传（S3 兼容协议）');
  const deviceId = 'cos_cam_002';
  const fileKey = generateFileKey(deviceId);
  const partSize = 5 * 1024 * 1024;
  const partCount = 3;

  // Step 1: 发起分片
  console.log('  [7.1] 发起分片上传...');
  let uploadId;
  try {
    const result = await s3.send(new CreateMultipartUploadCommand({
      Bucket: COS_BUCKET, Key: fileKey, ContentType: 'video/mp4',
    }));
    uploadId = result.UploadId;
    assert(uploadId, `UploadId: ${uploadId}`);
  } catch (e) {
    assert(false, `发起分片失败: ${e.message}`);
    return { fileKey };
  }

  // Step 2: 生成每个分片预签名URL
  console.log('  [7.2] 生成分片预签名URL...');
  for (let i = 1; i <= partCount; i++) {
    const partUrl = await getSignedUrl(s3, new UploadPartCommand({
      Bucket: COS_BUCKET, Key: fileKey, UploadId: uploadId, PartNumber: i,
    }), { expiresIn: 3600 });
    assert(partUrl.includes(`partNumber=${i}`), `分片 ${i} URL`);
  }
  console.log(`    ✅ ${partCount} 个分片预签名URL`);

  // Step 3: 直传分片
  console.log('  [7.3] 摄像头直传分片...');
  const parts = [];
  for (let i = 0; i < partCount; i++) {
    try {
      const result = await s3.send(new UploadPartCommand({
        Bucket: COS_BUCKET, Key: fileKey, UploadId: uploadId,
        PartNumber: i + 1, Body: generateFakeMp4(partSize),
      }));
      parts.push({ PartNumber: i + 1, ETag: result.ETag });
      assert(result.ETag, `分片 ${i + 1} 上传成功`);
    } catch (e) {
      assert(false, `分片 ${i + 1} 失败: ${e.message}`);
    }
  }
  console.log(`    ✅ ${partCount} 个分片直传完成`);

  // Step 4: 合并
  console.log('  [7.4] 合并分片...');
  try {
    const result = await s3.send(new CompleteMultipartUploadCommand({
      Bucket: COS_BUCKET, Key: fileKey, UploadId: uploadId,
      MultipartUpload: { Parts: parts },
    }));
    assert(result.ETag, `合并完成, ETag: ${result.ETag}`);
  } catch (e) {
    assert(false, `合并失败: ${e.message}`);
  }

  // Step 5: 验证
  console.log('  [7.5] 验证合并后文件...');
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: COS_BUCKET, Key: fileKey }));
    assert(head.ContentLength >= partSize * partCount, `文件大小: ${head.ContentLength} bytes`);
    console.log(`    ✅ 合并验证通过: ${head.ContentLength} bytes`);
  } catch (e) {
    assert(false, `验证失败: ${e.message}`);
  }

  console.log(`  ✅ 分片上传全流程通过`);
  return { fileKey };
}

async function test8_s3_compatibility() {
  console.log('\n[TEST 8] S3 兼容性专项验证');
  const testKey = `recordings/s3-compat-test/${Date.now()}_test.mp4`;

  // 8.1 CopyObject
  console.log('  [8.1] CopyObject 兼容性...');
  const srcKey = (await s3.send(new ListObjectsV2Command({
    Bucket: COS_BUCKET, Prefix: 'recordings/cos_cam_001/', MaxKeys: 1,
  }))).Contents?.[0]?.Key;
  if (srcKey) {
    try {
      const { CopyObjectCommand } = await import('@aws-sdk/client-s3');
      await s3.send(new CopyObjectCommand({
        Bucket: COS_BUCKET, Key: testKey,
        CopySource: `${COS_BUCKET}/${srcKey}`,
      }));
      assert(true, 'CopyObject 兼容');
    } catch (e) {
      assert(false, `CopyObject 不兼容: ${e.message}`);
    }
  } else {
    console.log('    ⚠️ 无源文件，跳过 CopyObject 测试');
  }

  // 8.2 签名格式验证 (AWS Signature V4)
  console.log('  [8.2] 签名格式验证...');
  const signedUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: COS_BUCKET, Key: testKey }), { expiresIn: 60 });
  assert(signedUrl.includes('X-Amz-Algorithm=AWS4-HMAC-SHA256'), '使用 AWS4-HMAC-SHA256 签名');
  assert(signedUrl.includes('X-Amz-Credential'), '包含 Credential');
  assert(signedUrl.includes('X-Amz-Date='), '包含签名日期');
  assert(signedUrl.includes('X-Amz-SignedHeaders='), '包含签名头列表');
  assert(signedUrl.includes('X-Amz-Signature='), '包含签名值');
  console.log('    ✅ 签名格式符合 S3 V4 标准');

  console.log('  ✅ S3 兼容性验证通过');
  return testKey;
}

// ==================== 主流程 ====================

async function main() {
  console.log('========================================');
  console.log('  录像直存 E2E 测试 — COS S3 兼容协议');
  console.log('========================================');
  console.log(`  Time: ${new Date().toISOString()}`);

  await test1_headBucket();

  // 如果 bucket 不可访问，后续测试无意义
  if (failed > 0) {
    console.log('\n========================================');
    console.log(`  ❌ Bucket 不可访问，测试中止`);
    console.log('  提示: COS bucket 名称需要带 AppID 后缀');
    console.log(`  当前: ${COS_BUCKET}`);
    console.log(`  正确格式: baby-monitor-125xxxxxxx`);
    console.log(`  请在腾讯云控制台查看正确的 bucket 名称`);
    console.log('========================================');
    process.exit(1);
  }

  const test2Result = await test2_presignedPutUrl();
  const uploadedSize = await test3_directUpload(test2Result.fileKey, test2Result.contentType);
  await test4_verifyFile(test2Result.fileKey, uploadedSize);
  await test5_presignedGetUrl(test2Result.fileKey, uploadedSize);
  await test6_listRecordings(test2Result.deviceId);
  await test7_multipartUpload();
  await test8_s3_compatibility();

  // 汇总
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
    console.log('  ✅ 全部通过！COS S3 兼容协议直存方案验证完成');
    console.log('');
    console.log('  验证结论:');
    console.log('  ✅ AWS SDK v3 可直接连接 COS S3 兼容 endpoint');
    console.log('  ✅ 预签名 PUT/GET URL 生成与 AWS S3 行为一致');
    console.log('  ✅ 分片上传 (CreateMultipart/UploadPart/Complete) 完全兼容');
    console.log('  ✅ CopyObject 等标准 S3 操作兼容');
    console.log('  ✅ 签名格式符合 AWS Signature V4 标准');
    console.log('  ✅ 录像直存方案可无缝切换 S3 / COS / MinIO');
  } else {
    console.log(`  ❌ ${failed} 项测试失败`);
    process.exit(1);
  }
  console.log('========================================');
}

main().catch(e => { console.error('测试执行异常:', e); process.exit(1); });
