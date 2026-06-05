-- 插入测试录像数据
-- 设备: test-device-001
-- 场景: 2026-04-14 几个小时的录像，包含连续段和断点

DELETE FROM recordings WHERE deviceId = 'test-device-001';

-- 连续段1: 10:00 - 10:15 (3个5分钟片段，连续无断点)
INSERT INTO recordings (id, deviceId, fileKey, startTime, endTime, duration, fileSize, contentType, uploadStrategy, status, provider, createdAt, updatedAt)
VALUES
(UUID(), 'test-device-001', 'recordings/test-device-001/2026/04/14/10/20260414T100000_300.ts', '2026-04-14 10:00:00', '2026-04-14 10:05:00', 300, 5242880, 'video/mp2t', 'SINGLE_PUT', 'COMPLETED', 'aws-s3', NOW(), NOW()),
(UUID(), 'test-device-001', 'recordings/test-device-001/2026/04/14/10/20260414T100500_300.ts', '2026-04-14 10:05:00', '2026-04-14 10:10:00', 300, 5242880, 'video/mp2t', 'SINGLE_PUT', 'COMPLETED', 'aws-s3', NOW(), NOW()),
(UUID(), 'test-device-001', 'recordings/test-device-001/2026/04/14/10/20260414T101000_300.ts', '2026-04-14 10:10:00', '2026-04-14 10:15:00', 300, 5242880, 'video/mp2t', 'SINGLE_PUT', 'COMPLETED', 'aws-s3', NOW(), NOW());

-- 断点: 10:15 - 10:30 (15分钟缺失)

-- 连续段2: 10:30 - 11:00 (6个5分钟片段，连续无断点)
INSERT INTO recordings (id, deviceId, fileKey, startTime, endTime, duration, fileSize, contentType, uploadStrategy, status, provider, createdAt, updatedAt)
VALUES
(UUID(), 'test-device-001', 'recordings/test-device-001/2026/04/14/10/20260414T103000_300.ts', '2026-04-14 10:30:00', '2026-04-14 10:35:00', 300, 5242880, 'video/mp2t', 'SINGLE_PUT', 'COMPLETED', 'aws-s3', NOW(), NOW()),
(UUID(), 'test-device-001', 'recordings/test-device-001/2026/04/14/10/20260414T103500_300.ts', '2026-04-14 10:35:00', '2026-04-14 10:40:00', 300, 5242880, 'video/mp2t', 'SINGLE_PUT', 'COMPLETED', 'aws-s3', NOW(), NOW()),
(UUID(), 'test-device-001', 'recordings/test-device-001/2026/04/14/10/20260414T104000_300.ts', '2026-04-14 10:40:00', '2026-04-14 10:45:00', 300, 5242880, 'video/mp2t', 'SINGLE_PUT', 'COMPLETED', 'aws-s3', NOW(), NOW()),
(UUID(), 'test-device-001', 'recordings/test-device-001/2026/04/14/10/20260414T104500_300.ts', '2026-04-14 10:45:00', '2026-04-14 10:50:00', 300, 5242880, 'video/mp2t', 'SINGLE_PUT', 'COMPLETED', 'aws-s3', NOW(), NOW()),
(UUID(), 'test-device-001', 'recordings/test-device-001/2026/04/14/10/20260414T105000_300.ts', '2026-04-14 10:50:00', '2026-04-14 10:55:00', 300, 5242880, 'video/mp2t', 'SINGLE_PUT', 'COMPLETED', 'aws-s3', NOW(), NOW()),
(UUID(), 'test-device-001', 'recordings/test-device-001/2026/04/14/10/20260414T105500_300.ts', '2026-04-14 10:55:00', '2026-04-14 11:00:00', 300, 5242880, 'video/mp2t', 'SINGLE_PUT', 'COMPLETED', 'aws-s3', NOW(), NOW());

-- 大断点: 11:00 - 14:00 (3小时缺失)

-- 下午段: 14:00 - 14:20 (2个10分钟片段)
INSERT INTO recordings (id, deviceId, fileKey, startTime, endTime, duration, fileSize, contentType, uploadStrategy, status, provider, createdAt, updatedAt)
VALUES
(UUID(), 'test-device-001', 'recordings/test-device-001/2026/04/14/14/20260414T140000_600.ts', '2026-04-14 14:00:00', '2026-04-14 14:10:00', 600, 10485760, 'video/mp2t', 'SINGLE_PUT', 'COMPLETED', 'aws-s3', NOW(), NOW()),
(UUID(), 'test-device-001', 'recordings/test-device-001/2026/04/14/14/20260414T141000_600.ts', '2026-04-14 14:10:00', '2026-04-14 14:20:00', 600, 10485760, 'video/mp2t', 'SINGLE_PUT', 'COMPLETED', 'aws-s3', NOW(), NOW());

-- 未完成的录像（用于测试 includeIncomplete）
INSERT INTO recordings (id, deviceId, fileKey, startTime, endTime, duration, fileSize, contentType, uploadStrategy, status, provider, createdAt, updatedAt)
VALUES
(UUID(), 'test-device-001', 'recordings/test-device-001/2026/04/14/15/20260414T150000.ts', '2026-04-14 15:00:00', NULL, NULL, NULL, 'video/mp2t', 'SINGLE_PUT', 'UPLOADING', 'aws-s3', NOW(), NOW());

-- 前一天的录像: 2026-04-13
INSERT INTO recordings (id, deviceId, fileKey, startTime, endTime, duration, fileSize, contentType, uploadStrategy, status, provider, createdAt, updatedAt)
VALUES
(UUID(), 'test-device-001', 'recordings/test-device-001/2026/04/13/09/20260413T090000_300.ts', '2026-04-13 09:00:00', '2026-04-13 09:05:00', 300, 5242880, 'video/mp2t', 'SINGLE_PUT', 'COMPLETED', 'aws-s3', NOW(), NOW()),
(UUID(), 'test-device-001', 'recordings/test-device-001/2026/04/13/09/20260413T090500_300.ts', '2026-04-13 09:05:00', '2026-04-13 09:10:00', 300, 5242880, 'video/mp2t', 'SINGLE_PUT', 'COMPLETED', 'aws-s3', NOW(), NOW());
