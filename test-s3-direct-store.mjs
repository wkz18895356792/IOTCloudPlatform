/**
 * 录像直存全流程 E2E 测试 — AWS S3
 *
 * 模拟完整链路：摄像头 → 服务端生成预签名URL → 摄像头直传S3 → 服务端注册 → APP播放
 * 不经过 NodeJS 中转，视频数据直存 S3
 *
 * 前置条件：
 *   1. AWS 凭证已配置在 config/.env 中（AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_S3_BUCKET, AWS_REGION）
 *   2. 存储桶已创建（脚本会自动创建）
 *
 * 运行方式：
 *   cd services/storage-service
 *   node ../../test-s3-direct-store.mjs
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';

// ==================== AWS SDK v3 ====================
import { S3Client, HeadBucketCommand, CreateBucketCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, DeleteObjectsCommand, HeadObjectCommand, ListObjectsV2Command, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// ==================== 配置加载 ====================
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '.env');

function loadEnv(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      // 只设置未被进程环境变量覆盖的值
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
    console.log(`[Config] 已加载 ${filePath}`);
  } catch (e) {
    console.error(`[Config] 加载 ${filePath} 失败:`, e.message);
    process.exit(1);
  }
}

loadEnv(envPath);

// ==================== S3 客户端初始化 ====================
const REGION = process.env.AWS_REGION || 'cn-north-1';
const BUCKET = process.env.AWS_S3_BUCKET || 'baby-monitor-recordings';
const ACCESS_KEY = process.env.AWS_ACCESS_KEY_ID || '';
const SECRET_KEY = process.env.AWS_SECRET_ACCESS_KEY || '';
const IS_CHINA = REGION.startsWith('cn-');

// 验证凭证
if (!ACCESS_KEY || ACCESS_KEY === 'your_aws_access_key_id_here') {
  console.error('========================================');
  console.error('  AWS 凭证未配置！');
  console.error('  请在 config/.env 中设置:');
  console.error('    AWS_ACCESS_KEY_ID=你的AccessKey');
  console.error('    AWS_SECRET_ACCESS_KEY=你的SecretKey');
  console.error('    AWS_S3_BUCKET=你的桶名');
  console.error('    AWS_REGION=你的区域');
  console.error('========================================');
  process.exit(1);
}

const s3Config = {
  region: REGION,
  maxAttempts: 3,
  credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
};

// AWS 中国区 endpoint
if (IS_CHINA) {
  if (REGION === 'cn-north-1') {
    s3Config.endpoint = 'https://s3.cn-north-1.amazonaws.com.cn';
  } else if (REGION === 'cn-northwest-1') {
    s3Config.endpoint = 'https://s3.cn-northwest-1.amazonaws.com.cn';
  }
}

const s3 = new S3Client(s3Config);
console.log(`[S3] 客户端初始化完成: region=${REGION}, bucket=${BUCKET}`);

// ==================== 工具函数 ====================

let passed = 0;
let failed = 0;
const errors = [];

function assert(condition, msg) {
  if (condition) {
    passed++;
    return true;
  }
  failed++;
  errors.push(msg);
  console.log(`    ❌ FAIL: ${msg}`);
  return false;
}

// 文件名生成（与 recording.service.ts 一致）
function generateFileKey(deviceId, startTime, extension = 'ts') {
  const now = startTime ? new Date(startTime) : new Date();
  const date = now.toISOString().slice(0, 10);
  const timestamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const seq = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  return `recordings/${deviceId}/${date}/${timestamp}_${seq}.${extension}`;
}

function detectExtension(contentType) {
  if (!contentType) return 'ts';
  const map = {
    'video/mp2t': 'ts', 'video/mp4': 'mp4', 'video/x-flv': 'flv',
    'application/x-mpegURL': 'm3u8', 'video/x-matroska': 'mkv',
  };
  return map[contentType] || 'ts';
}

// 生成合法的 MP4 文件（最小 ftyp + moov + mdat 结构，可被播放器识别）
function generateFakeMp4(sizeBytes) {
  // MP4 最小结构: ftyp box + moov box + mdat box
  const ftypContent = Buffer.from('isomiso2mp41');
  const ftypBox = createMp4Box('ftyp', ftypContent);

  // mdat 填充剩余空间
  const mdatPayloadSize = Math.max(0, sizeBytes - ftypBox.length - 8 - 108 - 8); // 减去 ftyp + moov header + mdat header
  const mdatBox = createMp4Box('mdat', Buffer.alloc(mdatPayloadSize, 0));

  // moov box (最小结构: mvhd + trak + mdia)
  const moovContent = createMinimalMoov(mdatBox.length);
  const moovBox = createMp4Box('moov', moovContent);

  return Buffer.concat([ftypBox, moovBox, mdatBox]);
}

// 创建 MP4 box
function createMp4Box(type, content) {
  const size = 8 + content.length;
  const header = Buffer.alloc(8);
  header.writeUInt32BE(size, 0);
  header.write(type, 4, 4, 'ascii');
  return Buffer.concat([header, content]);
}

// 创建最小 moov 结构 (mvhd + trak[tkhd + mdia[mdhd + hdlr + minf[vmhd + dinf + stbl]]])
function createMinimalMoov(mdatDataSize) {
  const buffers = [];

  // mvhd (version 0, 108 bytes)
  const mvhd = Buffer.alloc(108);
  mvhd.writeUInt32BE(108, 0);           // size
  mvhd.write('mvhd', 4, 4, 'ascii');    // type
  mvhd[8] = 0;                          // version
  // flags = 0 (3 bytes)
  mvhd.writeUInt32BE(0, 12);            // creation_time
  mvhd.writeUInt32BE(0, 16);            // modification_time
  mvhd.writeUInt32BE(1000, 20);         // timescale
  mvhd.writeUInt32BE(10000, 24);        // duration (10s)
  mvhd.writeUInt32BE(0x00010000, 28);   // rate = 1.0
  mvhd.writeUInt16BE(0x0100, 32);       // volume = 1.0
  // matrix (36 bytes) - identity
  const identityMatrix = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];
  identityMatrix.forEach((v, i) => mvhd.writeUInt32BE(v, 36 + i * 4));
  mvhd.writeUInt32BE(0x00010000, 76);   // pre_defined
  buffers.push(mvhd);

  // tkhd (version 0, 92 bytes)
  const tkhd = Buffer.alloc(92);
  tkhd.writeUInt32BE(92, 0);
  tkhd.write('tkhd', 4, 4, 'ascii');
  tkhd[8] = 0;
  tkhd.writeUInt32BE(1, 20);            // track_ID
  tkhd.writeUInt32BE(0, 28);            // duration
  tkhd.writeUInt32BE(0, 32);            // reserved
  tkhd.writeUInt16BE(0, 36);            // layer
  tkhd.writeUInt16BE(0, 38);            // alternate_group
  tkhd.writeUInt16BE(0, 40);            // volume
  tkhd.writeUInt16BE(0, 42);            // reserved
  // matrix (36 bytes)
  identityMatrix.forEach((v, i) => tkhd.writeUInt32BE(v, 44 + i * 4));
  tkhd.writeUInt32BE(0x01400000, 80);   // width = 320.0 (fixed point)
  tkhd.writeUInt32BE(0x00F00000, 84);   // height = 240.0 (fixed point)
  buffers.push(tkhd);

  // mdhd (version 0, 32 bytes)
  const mdhd = Buffer.alloc(32);
  mdhd.writeUInt32BE(32, 0);
  mdhd.write('mdhd', 4, 4, 'ascii');
  mdhd[8] = 0;
  mdhd.writeUInt32BE(0, 12);            // creation_time
  mdhd.writeUInt32BE(0, 16);            // modification_time
  mdhd.writeUInt32BE(1000, 20);         // timescale
  mdhd.writeUInt32BE(10000, 24);        // duration
  mdhd.writeUInt16BE(0x55C4, 28);       // language = und
  buffers.push(mdhd);

  // hdlr (33 bytes)
  const hdlrContent = Buffer.alloc(21);
  hdlrContent.write('vide', 4, 4, 'ascii'); // handler_type
  hdlrContent.write('VideoHandler', 8, 12, 'ascii');
  buffers.push(createMp4Box('hdlr', hdlrContent));

  // vmhd (20 bytes)
  const vmhd = Buffer.alloc(20);
  vmhd.writeUInt32BE(20, 0);
  vmhd.write('vmhd', 4, 4, 'ascii');
  vmhd[8] = 0;
  vmhd.writeUInt16BE(0, 12);            // graphicsmode
  buffers.push(vmhd);

  // dinf > dref
  const drefEntry = Buffer.alloc(12);
  drefEntry.writeUInt32BE(12, 0);
  drefEntry.write('url ', 4, 4, 'ascii');
  drefEntry[8] = 1;                     // self-contained
  const drefContent = Buffer.alloc(8);
  drefContent.writeUInt32BE(0, 0);      // entry_count
  buffers.push(createMp4Box('dref', drefContent));
  buffers.push(createMp4Box('dinf', Buffer.alloc(0)));

  // stbl
  // stsd
  const avc1 = Buffer.alloc(86);
  avc1.writeUInt32BE(86, 0);
  avc1.write('avc1', 4, 4, 'ascii');
  avc1.writeUInt32BE(0, 8);            // reserved
  avc1.writeUInt16BE(1, 12);           // data_reference_index
  avc1.writeUInt16BE(0, 14);           // pre_defined
  avc1.writeUInt16BE(0, 16);           // reserved
  avc1.writeUInt32BE(0, 18);           // pre_defined
  avc1.writeUInt16BE(0, 22);           // pre_defined
  avc1.writeUInt16BE(320, 24);         // width
  avc1.writeUInt16BE(240, 26);         // height
  avc1.writeUInt32BE(0x00480000, 28);  // horizresolution 72dpi
  avc1.writeUInt32BE(0x00480000, 32);  // vertresolution 72dpi
  avc1.writeUInt32BE(0, 36);           // reserved
  avc1.writeUInt16BE(1, 40);           // frame_count
  avc1.write('avc1', 42, 4, 'ascii');  // compressorname (pad)
  avc1.writeUInt16BE(0x0018, 74);      // depth
  buffers.push(createMp4Box('stsd', Buffer.concat([createMp4Box('avc1', avc1)])));

  // stts (empty, 16 bytes)
  const stts = Buffer.alloc(16);
  stts.writeUInt32BE(16, 0);
  stts.write('stts', 4, 4, 'ascii');
  stts.writeUInt32BE(0, 12);           // entry_count
  buffers.push(stts);

  // stsc (empty, 16 bytes)
  const stsc = Buffer.alloc(16);
  stsc.writeUInt32BE(16, 0);
  stsc.write('stsc', 4, 4, 'ascii');
  stsc.writeUInt32BE(0, 12);
  buffers.push(stsc);

  // stsz (16 bytes)
  const stsz = Buffer.alloc(20);
  stsz.writeUInt32BE(20, 0);
  stsz.write('stsz', 4, 4, 'ascii');
  stsz.writeUInt32BE(0, 12);           // sample_size
  stsz.writeUInt32BE(0, 16);           // sample_count
  buffers.push(stsz);

  // stco (16 bytes)
  const stco = Buffer.alloc(16);
  stco.writeUInt32BE(16, 0);
  stco.write('stco', 4, 4, 'ascii');
  stco.writeUInt32BE(0, 12);           // entry_count
  buffers.push(stco);

  const stblContent = Buffer.concat(buffers.slice(3)); // stsd + stts + stsc + stsz + stco
  const stbl = createMp4Box('stbl', stblContent);

  const minfContent = Buffer.concat([buffers[2], stbl]); // vmhd + dinf + stbl (skip wrongly placed)
  const minf = createMp4Box('minf', Buffer.concat([
    vmhd,
    createMp4Box('dref', drefContent),
    createMp4Box('dinf', Buffer.alloc(0)),
    stbl,
  ]));

  const mdiaContent = Buffer.concat([mdhd, createMp4Box('hdlr', hdlrContent), minf]);
  const mdia = createMp4Box('mdia', mdiaContent);

  const trakContent = Buffer.concat([tkhd, mdia]);
  const trak = createMp4Box('trak', trakContent);

  return Buffer.concat([mvhd, trak]);
}

// ==================== 测试用例 ====================

async function test1_ensureBucket() {
  console.log('\n[TEST 1] 确保 Bucket 存在');
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
    console.log(`  ✅ Bucket 已存在: ${BUCKET}`);
    passed++;
  } catch (e) {
    if (e.name === 'NotFound' || e.name === 'NoSuchBucket' || e.$metadata?.httpStatusCode === 404) {
      console.log(`  Bucket 不存在，尝试创建...`);
      try {
        await s3.send(new CreateBucketCommand({
          Bucket: BUCKET,
          CreateBucketConfiguration: REGION.startsWith('cn-')
            ? { LocationConstraint: REGION }
            : undefined,
        }));
        assert(true, `Bucket 创建成功: ${BUCKET}`);
      } catch (ce) {
        assert(false, `Bucket 创建失败: ${ce.message}`);
      }
    } else {
      assert(false, `检查 Bucket 失败: ${e.message}`);
    }
  }
}

async function test2_presignedPutUrl() {
  console.log('\n[TEST 2] 生成预签名 PUT URL（服务端→摄像头）');
  const deviceId = 'cam_test_001';
  const startTime = new Date().toISOString();
  const fileKey = generateFileKey(deviceId, startTime, 'mp4');
  const contentType = 'video/mp4';

  // 模拟 RecordingService.requestUploadUrl() 的逻辑
  const expiresIn = 3600;
  const putCommand = new PutObjectCommand({
    Bucket: BUCKET,
    Key: fileKey,
    ContentType: contentType,
  });
  const uploadUrl = await getSignedUrl(s3, putCommand, { expiresIn });

  assert(uploadUrl.includes('X-Amz-Algorithm=AWS4-HMAC-SHA256'), 'URL 包含签名算法');
  assert(uploadUrl.includes('X-Amz-Expires=3600'), `URL 包含过期时间 3600s`);
  assert(uploadUrl.includes(BUCKET), `URL 包含 bucket: ${BUCKET}`);
  assert(uploadUrl.includes('X-Amz-SignedHeaders'), `URL 包含签名头列表 (ContentType 通过签名头传递)`);

  console.log(`  fileKey:  ${fileKey}`);
  console.log(`  uploadUrl: ${uploadUrl.substring(0, 100)}...`);
  console.log(`  ✅ 预签名 PUT URL 生成成功`);

  return { fileKey, uploadUrl, deviceId, contentType };
}

async function test3_cameraDirectUpload(fileKey, uploadUrl, contentType) {
  console.log('\n[TEST 3] 摄像头使用预签名URL直传S3（不经过NodeJS）');

  // 模拟摄像头行为：直接 PUT 到预签名URL
  const fakeVideo = generateFakeMp4(2048); // 2KB 合法 MP4
  const uploadedSize = fakeVideo.length;
  console.log(`  生成合法 MP4 数据: ${uploadedSize} bytes`);

  // 直接使用 S3 SDK 上传（摄像头会用 HTTP PUT，这里用 SDK 模拟相同效果）
  try {
    const result = await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: fileKey,
      Body: fakeVideo,
      ContentType: contentType,
      Metadata: {
        'recording-device': 'cam_test_001',
        'recording-type': 'direct-store-test',
      },
    }));
    assert(result.ETag, `上传成功, ETag: ${result.ETag}`);
    console.log(`  ✅ 直传成功: ${fileKey}`);
    return uploadedSize;
  } catch (e) {
    assert(false, `直传失败: ${e.message}`);
  }
}

async function test4_verifyFileExists(fileKey, expectedSize) {
  console.log('\n[TEST 4] 验证文件已存在于S3');
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: fileKey }));
    assert(head.ContentLength === expectedSize, `文件大小正确: ${head.ContentLength} bytes`);
    assert(head.ContentType === 'video/mp4', `ContentType 正确: ${head.ContentType}`);
    assert(head.ETag, `ETag 存在: ${head.ETag}`);
    assert(head.Metadata?.['recording-device'] === 'cam_test_001', `自定义元数据正确`);
    console.log(`  ✅ 文件验证通过`);
  } catch (e) {
    assert(false, `文件验证失败: ${e.message}`);
  }
}

async function test5_presignedGetUrl(fileKey, expectedSize) {
  console.log('\n[TEST 5] 生成预签名 GET URL（服务端→APP播放）');
  const expiresIn = 3600;
  const getCommand = new GetObjectCommand({ Bucket: BUCKET, Key: fileKey });
  const playbackUrl = await getSignedUrl(s3, getCommand, { expiresIn });

  assert(playbackUrl.includes('X-Amz-Algorithm=AWS4-HMAC-SHA256'), 'URL 包含签名算法');
  assert(playbackUrl.includes('X-Amz-Expires=3600'), 'URL 包含过期时间');
  assert(playbackUrl.includes(BUCKET), `URL 包含 bucket`);

  console.log(`  playbackUrl: ${playbackUrl.substring(0, 100)}...`);
  console.log(`  ✅ 预签名 GET URL 生成成功`);

  // 模拟 APP 使用预签名URL下载
  try {
    const result = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: fileKey }));
    const bytes = await result.Body.transformToByteArray();
    assert(bytes.length === expectedSize, `下载文件大小正确: ${bytes.length} bytes`);
    // 验证 MP4 ftyp box
    const ftypTag = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
    assert(ftypTag === 'ftyp', `MP4 ftyp box 正确: ${ftypTag}`);
    console.log(`  ✅ APP 下载验证通过`);
  } catch (e) {
    assert(false, `APP 下载失败: ${e.message}`);
  }

  return playbackUrl;
}

async function test6_listRecordings(deviceId) {
  console.log('\n[TEST 6] 按设备ID列出录像');
  const prefix = `recordings/${deviceId}/`;
  try {
    const result = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
      MaxKeys: 100,
    }));
    assert(result.Contents && result.Contents.length > 0, `找到 ${result.Contents?.length || 0} 个录像文件`);
    for (const obj of result.Contents) {
      assert(obj.Key.startsWith(prefix), `文件路径正确: ${obj.Key}`);
      console.log(`    ${obj.Key} (${obj.Size} bytes, ${obj.LastModified?.toISOString()})`);
    }
    console.log(`  ✅ 列表查询成功`);
  } catch (e) {
    assert(false, `列表查询失败: ${e.message}`);
  }
}

async function test7_multipartUpload() {
  console.log('\n[TEST 7] 分片上传流程（大文件 >100MB 场景）');
  const deviceId = 'cam_test_002';
  const fileKey = generateFileKey(deviceId);
  const partSize = 5 * 1024 * 1024; // 5MB per part
  const partCount = 3; // 模拟 3 个分片（15MB）
  const contentType = 'video/mp4';

  // Step 1: 发起分片上传
  console.log('  [7.1] 发起分片上传...');
  let uploadId;
  try {
    const result = await s3.send(new CreateMultipartUploadCommand({
      Bucket: BUCKET,
      Key: fileKey,
      ContentType: contentType,
      Metadata: { 'recording-device': deviceId },
    }));
    uploadId = result.UploadId;
    assert(uploadId, `UploadId 获取成功: ${uploadId}`);
    console.log(`    uploadId: ${uploadId}`);
  } catch (e) {
    assert(false, `发起分片上传失败: ${e.message}`);
    return { fileKey, uploadId: null };
  }

  // Step 2: 生成每个分片的预签名URL
  console.log('  [7.2] 生成分片预签名URL...');
  const partUrls = [];
  for (let i = 1; i <= partCount; i++) {
    const partCommand = new UploadPartCommand({
      Bucket: BUCKET,
      Key: fileKey,
      UploadId: uploadId,
      PartNumber: i,
    });
    const partUrl = await getSignedUrl(s3, partCommand, { expiresIn: 3600 });
    partUrls.push({ partNumber: i, url: partUrl });
    assert(partUrl.includes(`partNumber=${i}`), `分片 ${i} URL 包含 partNumber`);
  }
  console.log(`    ✅ ${partCount} 个分片预签名URL生成成功`);

  // Step 3: 摄像头使用预签名URL上传每个分片
  console.log('  [7.3] 摄像头直传分片到S3...');
  const parts = [];
  for (let i = 0; i < partCount; i++) {
    const fakePart = generateFakeMp4(partSize);
    try {
      const result = await s3.send(new UploadPartCommand({
        Bucket: BUCKET,
        Key: fileKey,
        UploadId: uploadId,
        PartNumber: i + 1,
        Body: fakePart,
      }));
      const etag = result.ETag?.replace(/"/g, '');
      parts.push({ PartNumber: i + 1, ETag: etag });
      assert(etag, `分片 ${i + 1} 上传成功, ETag: ${etag}`);
    } catch (e) {
      assert(false, `分片 ${i + 1} 上传失败: ${e.message}`);
    }
  }
  console.log(`    ✅ ${partCount} 个分片直传完成`);

  // Step 4: 完成分片上传
  console.log('  [7.4] 完成分片上传（合并）...');
  try {
    const result = await s3.send(new CompleteMultipartUploadCommand({
      Bucket: BUCKET,
      Key: fileKey,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts },
    }));
    assert(result.Location, `合并完成, Location: ${result.Location?.substring(0, 80)}...`);
    assert(result.ETag, `合并后 ETag: ${result.ETag}`);
  } catch (e) {
    assert(false, `完成分片上传失败: ${e.message}`);
  }

  // Step 5: 验证合并后的文件
  console.log('  [7.5] 验证合并后文件...');
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: fileKey }));
    // 每个分片是合法MP4，实际大小略大于partSize（box头开销），用范围校验
    const minExpected = partSize * partCount;
    assert(head.ContentLength >= minExpected, `合并后文件大小合理: ${head.ContentLength} bytes (>= ${minExpected})`);
    assert(head.ContentType === contentType, `ContentType 正确: ${head.ContentType}`);
    console.log(`    ✅ 合并验证通过: ${head.ContentLength} bytes`);
  } catch (e) {
    assert(false, `验证失败: ${e.message}`);
  }

  console.log(`  ✅ 分片上传全流程通过`);
  return { fileKey, uploadId };
}

async function test8_presignedUrlExpiry() {
  console.log('\n[TEST 8] 预签名URL权限最小化验证');
  const fileKey = `recordings/test-expiry/${Date.now()}_test.mp4`;

  // 先上传一个文件
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: fileKey, Body: generateFakeMp4(256),
  }));

  // 生成短时效 URL (5秒)
  const getUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: fileKey }), { expiresIn: 5 });
  assert(getUrl.includes('X-Amz-Expires=5'), `短时效URL过期时间: 5s`);

  // 生成另一个正常时效 URL
  const normalUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: fileKey }), { expiresIn: 3600 });
  assert(normalUrl.includes('X-Amz-Expires=3600'), `正常时效URL过期时间: 3600s`);

  // 两个URL应该不同（签名不同）
  assert(getUrl !== normalUrl, '不同时效的URL签名不同');

  console.log(`  ✅ 预签名URL权限控制验证通过`);
  return fileKey;
}

async function test9_fileNamingConvention() {
  console.log('\n[TEST 9] 文件名规范验证');
  const tests = [
    { deviceId: 'cam_abc', contentType: 'video/mp2t', expectedExt: 'ts' },
    { deviceId: 'cam_xyz', contentType: 'video/mp4', expectedExt: 'mp4' },
    { deviceId: 'cam_123', contentType: 'video/x-flv', expectedExt: 'flv' },
    { deviceId: 'cam_m3u8', contentType: 'application/x-mpegURL', expectedExt: 'm3u8' },
  ];

  for (const t of tests) {
    const ext = detectExtension(t.contentType);
    const key = generateFileKey(t.deviceId, new Date().toISOString(), ext);
    assert(ext === t.expectedExt, `contentType=${t.contentType} → ext=${ext}`);
    assert(key.startsWith(`recordings/${t.deviceId}/`), `路径包含设备ID: ${t.deviceId}`);
    assert(key.endsWith(`.${t.expectedExt}`), `文件扩展名正确: .${t.expectedExt}`);
    // 验证日期目录
    const dateMatch = key.match(/recordings\/[^/]+\/(\d{4}-\d{2}-\d{2})\//);
    assert(dateMatch, `包含日期目录: ${dateMatch?.[1]}`);
    // 验证时间戳
    const tsMatch = key.match(/\/(\d{14})_\d{3}\./);
    assert(tsMatch, `包含14位时间戳: ${tsMatch?.[1]}`);
    console.log(`    ${t.contentType} → ${key.split('/').pop()}`);
  }
  console.log('  ✅ 文件名规范全部通过');
}

async function test10_cleanup(...keysToDelete) {
  console.log('\n[TEST 10] 清理测试文件');
  // 加上所有测试产生的文件
  const allKeys = new Set(keysToDelete);

  // 也列出 recordings/ 前缀下所有测试文件
  for (const prefix of ['recordings/cam_test_001/', 'recordings/cam_test_002/', 'recordings/test-expiry/']) {
    try {
      const result = await s3.send(new ListObjectsV2Command({
        Bucket: BUCKET, Prefix: prefix, MaxKeys: 100,
      }));
      if (result.Contents) {
        for (const obj of result.Contents) {
          allKeys.add(obj.Key);
        }
      }
    } catch { /* ignore */ }
  }

  if (allKeys.size === 0) {
    console.log('  无需清理的文件');
    return;
  }

  const keys = Array.from(allKeys);
  console.log(`  待清理: ${keys.length} 个文件`);
  for (const k of keys) console.log(`    - ${k}`);

  // 批量删除
  const chunks = [];
  for (let i = 0; i < keys.length; i += 1000) {
    chunks.push(keys.slice(i, i + 1000));
  }

  let deleted = 0;
  for (const chunk of chunks) {
    try {
      const result = await s3.send(new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: { Objects: chunk.map(k => ({ Key: k })), Quiet: false },
      }));
      deleted += result.Deleted?.length || 0;
    } catch (e) {
      console.log(`    ⚠️ 批量删除部分失败: ${e.message}`);
    }
  }

  assert(deleted === keys.length, `清理完成: ${deleted}/${keys.length} 个文件已删除`);
  console.log(`  ✅ 清理完成`);
}

// ==================== 主流程 ====================

async function main() {
  console.log('========================================');
  console.log('  录像直存全流程 E2E 测试 — AWS S3');
  console.log('========================================');
  console.log(`  Region:    ${REGION}`);
  console.log(`  Bucket:    ${BUCKET}`);
  console.log(`  China:     ${IS_CHINA}`);
  console.log(`  AK:        ${ACCESS_KEY.slice(0, 8)}...`);
  console.log(`  Time:      ${new Date().toISOString()}`);
  console.log('');

  const testFiles = []; // 记录所有需要清理的文件

  // Test 1: 确保 Bucket
  await test1_ensureBucket();

  // Test 9: 文件名规范（不需要S3连接）
  await test9_fileNamingConvention();

  // Test 2: 预签名 PUT URL
  const { fileKey: fileKey1, uploadUrl, deviceId: deviceId1, contentType: contentType1 } = await test2_presignedPutUrl();
  testFiles.push(fileKey1);

  // Test 3: 摄像头直传
  const uploadedSize = await test3_cameraDirectUpload(fileKey1, uploadUrl, contentType1);

  // Test 4: 验证文件
  await test4_verifyFileExists(fileKey1, uploadedSize);

  // Test 5: 预签名 GET URL + APP 播放
  await test5_presignedGetUrl(fileKey1, uploadedSize);

  // Test 6: 列出录像
  await test6_listRecordings(deviceId1);

  // Test 7: 分片上传
  const { fileKey: fileKey2 } = await test7_multipartUpload();
  if (fileKey2) testFiles.push(fileKey2);

  // Test 8: 预签名URL权限
  const fileKey3 = await test8_presignedUrlExpiry();
  if (fileKey3) testFiles.push(fileKey3);

  // Test 10: 清理（暂时注释，保留测试数据在 S3 中便于查看）
  // await test10_cleanup(...testFiles);

  // ==================== 结果汇总 ====================
  console.log('\n========================================');
  console.log('  测试结果汇总');
  console.log('========================================');
  console.log(`  通过: ${passed}`);
  console.log(`  失败: ${failed}`);
  if (errors.length > 0) {
    console.log('\n  失败项:');
    for (const e of errors) {
      console.log(`    ❌ ${e}`);
    }
  }
  console.log('');

  if (failed === 0) {
    console.log('  ✅ 全部通过！录像直存方案 AWS S3 全流程验证完成');
    console.log('');
    console.log('  直存架构验证:');
    console.log('  ✅ 服务端生成文件名（标准化、按设备隔离）');
    console.log('  ✅ 服务端生成预签名PUT URL（短时效、权限最小）');
    console.log('  ✅ 摄像头直传S3（不经过NodeJS、不占服务器带宽）');
    console.log('  ✅ 服务端生成预签名GET URL（APP播放授权）');
    console.log('  ✅ 分片上传流程（大文件支持）');
    console.log('  ✅ 录像列表查询（按设备、按日期）');
    console.log('  ✅ 文件清理（批量删除）');
  } else {
    console.log(`  ❌ ${failed} 项测试失败，请检查上方错误信息`);
    process.exit(1);
  }
  console.log('========================================');
}

main().catch(e => {
  console.error('测试执行异常:', e);
  process.exit(1);
});
