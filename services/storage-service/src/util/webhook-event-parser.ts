/**
 * 云存储事件格式解析器
 *
 * 将 AWS S3 / 腾讯云 COS / 阿里云 OSS 三种事件通知格式
 * 归一化为统一的 NormalizedStorageEvent
 */

export type StorageProvider = 'aws_s3' | 'tencent_cos' | 'aliyun_oss';

export interface NormalizedStorageEvent {
  provider: StorageProvider;
  eventName: string;
  bucket: string;
  fileKey: string;
  fileSize: number;
  etag: string;
  eventTime: Date;
  requestId?: string;
}

/**
 * URL 解码 S3 对象 key（S3 用 + 替代空格，部分字符编码）
 */
function decodeKey(key: string): string {
  return decodeURIComponent(key.replace(/\+/g, ' '));
}

// ==================== AWS S3 ====================

/**
 * 解析 AWS S3 事件通知
 *
 * 格式来自 S3 Event Notification（通过 SNS/EventBridge/SQS 投递）：
 * {
 *   "Records": [{
 *     "eventName": "ObjectCreated:Put",
 *     "eventTime": "2026-04-14T09:30:00.000Z",
 *     "s3": {
 *       "bucket": { "name": "video-storage" },
 *       "object": { "key": "recordings/dev1/...", "size": 1234, "eTag": "abc" }
 *     },
 *     "responseElements": { "x-amz-request-id": "REQ123" }
 *   }]
 * }
 */
export function parseS3Event(body: any): NormalizedStorageEvent[] {
  const records = body?.Records;
  if (!Array.isArray(records)) return [];

  const results: NormalizedStorageEvent[] = [];
  for (const record of records) {
    const object = record?.s3?.object;
    const bucket = record?.s3?.bucket;
    if (!object?.key) continue;

    results.push({
      provider: 'aws_s3',
      eventName: record.eventName || '',
      bucket: bucket?.name || '',
      fileKey: decodeKey(object.key),
      fileSize: object.size || 0,
      etag: (object.eTag || '').replace(/"/g, ''),
      eventTime: record.eventTime ? new Date(record.eventTime) : new Date(),
      requestId: record.responseElements?.['x-amz-request-id'] || undefined,
    });
  }
  return results;
}

// ==================== 腾讯云 COS ====================

/**
 * 解析腾讯云 COS 事件通知
 *
 * 格式来自 COS Bucket Notification（通过 COS 事件通知推送）：
 * {
 *   "Records": [{
 *     "eventTime": "2026-04-14T09:30:00.000Z",
 *     "eventName": "cos:ObjectCreated:Put",
 *     "cos": {
 *       "bucket": { "name": "video-storage-1234567890" },
 *       "object": { "key": "recordings/dev1/...", "size": 1234, "eTag": "abc" }
 *     },
 *     "requestId": "REQ123"
 *   }]
 * }
 */
export function parseCOSEvent(body: any): NormalizedStorageEvent[] {
  const records = body?.Records;
  if (!Array.isArray(records)) return [];

  const results: NormalizedStorageEvent[] = [];
  for (const record of records) {
    const object = record?.cos?.object;
    const bucket = record?.cos?.bucket;
    if (!object?.key) continue;

    results.push({
      provider: 'tencent_cos',
      eventName: record.eventName || '',
      bucket: bucket?.name || '',
      fileKey: decodeKey(object.key),
      fileSize: object.size || 0,
      etag: (object.eTag || '').replace(/"/g, ''),
      eventTime: record.eventTime ? new Date(record.eventTime) : new Date(),
      requestId: record.requestId || undefined,
    });
  }
  return results;
}

// ==================== 阿里云 OSS ====================

/**
 * 解析阿里云 OSS 事件通知
 *
 * 格式来自 OSS 事件通知（通过 MNS/EventBridge 投递）：
 * {
 *   "events": [{
 *     "eventName": "ObjectCreated:PutObject",
 *     "eventTime": "2026-04-14T09:30:00.000Z",
 *     "oss": {
 *       "bucket": { "name": "video-storage" },
 *       "object": { "key": "recordings/dev1/...", "size": 1234, "eTag": "abc" }
 *     },
 *     "requestId": "REQ123"
 *   }]
 * }
 */
export function parseOSSEvent(body: any): NormalizedStorageEvent[] {
  const events = body?.events;
  if (!Array.isArray(events)) return [];

  const results: NormalizedStorageEvent[] = [];
  for (const event of events) {
    const object = event?.oss?.object;
    const bucket = event?.oss?.bucket;
    if (!object?.key) continue;

    results.push({
      provider: 'aliyun_oss',
      eventName: event.eventName || '',
      bucket: bucket?.name || '',
      fileKey: decodeKey(object.key),
      fileSize: object.size || 0,
      etag: (object.eTag || '').replace(/"/g, ''),
      eventTime: event.eventTime ? new Date(event.eventTime) : new Date(),
      requestId: event.requestId || undefined,
    });
  }
  return results;
}

// ==================== 自动识别 ====================

/**
 * 根据请求体和请求头自动识别云厂商并解析事件
 *
 * 识别策略：
 * - S3: body.Records[*].s3 存在，或 header 含 x-amz-sns-message-type
 * - COS: body.Records[*].cos 存在，或 header 含 x-cos-request-id
 * - OSS: body.events[*].oss 存在
 */
export function detectProviderAndParse(
  body: any,
  headers: Record<string, string>,
): NormalizedStorageEvent[] {
  // SNS 订阅确认消息（不处理，由 controller 层处理）
  if (body?.Type === 'SubscriptionConfirmation' || body?.Type === 'UnsubscribeConfirmation') {
    return [];
  }

  const headerKeys = Object.keys(headers).map(k => k.toLowerCase());

  // 优先通过 body 结构识别
  if (Array.isArray(body?.Records)) {
    const firstRecord = body.Records[0];

    if (firstRecord?.s3) {
      return parseS3Event(body);
    }

    if (firstRecord?.cos) {
      return parseCOSEvent(body);
    }
  }

  if (Array.isArray(body?.events) && body.events[0]?.oss) {
    return parseOSSEvent(body);
  }

  // 通过 header 识别
  if (headerKeys.includes('x-amz-sns-message-type')) {
    // SNS 包装的 S3 事件：body 可能是 JSON 字符串
    if (typeof body?.Message === 'string') {
      try {
        const inner = JSON.parse(body.Message);
        return parseS3Event(inner);
      } catch {
        return [];
      }
    }
    return parseS3Event(body);
  }

  if (headerKeys.includes('x-cos-request-id')) {
    return parseCOSEvent(body);
  }

  // 无法识别
  return [];
}

/**
 * 检查是否为 SNS 订阅确认消息
 */
export function isSNSSubscriptionConfirmation(body: any): boolean {
  return body?.Type === 'SubscriptionConfirmation';
}

/**
 * 提取 SNS 订阅确认 URL
 */
export function getSNSSubscribeURL(body: any): string | null {
  return body?.SubscribeURL || null;
}
