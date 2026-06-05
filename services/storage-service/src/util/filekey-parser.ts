/**
 * 录像文件路径解析工具
 *
 * 从标准化 S3 路径中提取元数据：
 *   recordings/{deviceId}/{YYYY}/{MM}/{DD}/{HH}/{filename}.{ext}
 *
 * 文件名格式：
 *   - 20260414T093000_300.ts  (标准 + 时长)
 *   - 20260414T093000.ts      (标准无时长)
 *   - 14.ts                   (分段无时长)
 *   - 14_300.ts               (分段 + 时长)
 */

export interface ParsedFileKey {
  isValid: boolean;
  deviceId: string | null;
  startTime: Date | null;
  duration: number | null;
  extension: string | null;
  contentType: string;
}

/** 录像文件路径前缀 */
const RECORDING_PREFIX = 'recordings/';

/** MIME 类型映射 */
const EXT_TO_MIME: Record<string, string> = {
  ts: 'video/mp2t',
  mp4: 'video/mp4',
  mpg: 'video/mpeg',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
};

/**
 * 快速判断是否为录像文件路径
 */
export function isRecordingFileKey(fileKey: string): boolean {
  return fileKey.startsWith(RECORDING_PREFIX);
}

/**
 * 从文件路径中解析录像元数据
 */
export function parseFileKey(fileKey: string): ParsedFileKey {
  const result: ParsedFileKey = {
    isValid: false,
    deviceId: null,
    startTime: null,
    duration: null,
    extension: null,
    contentType: 'video/mp2t',
  };

  // URL 解码（S3 可能对 key 做了编码）
  const decoded = decodeURIComponent(fileKey.replace(/\+/g, ' '));

  // 匹配路径：recordings/{deviceId}/{YYYY}/{MM}/{DD}/{HH}/{filename}.{ext}
  const pathRegex = /^recordings\/([^/]+)\/(\d{4})\/(\d{2})\/(\d{2})\/(\d{2})\/(.+)$/;
  const match = decoded.match(pathRegex);

  if (!match) {
    return result;
  }

  const [, deviceId, year, month, day, hour, filename] = match;

  // 解析文件名：{timestamp}_{duration}.{ext} 或 {timestamp}.{ext}
  const fileRegex = /^(\d{8}T\d{6})(?:_(\d+))?\.(\w+)$/;
  // 分段文件名：{mm}_{duration}.{ext} 或 {mm}.{ext}
  const segmentRegex = /^(\d{2})(?:_(\d+))?\.(\w+)$/;

  let fileMatch = filename.match(fileRegex);
  let isSegment = false;

  if (!fileMatch) {
    fileMatch = filename.match(segmentRegex);
    isSegment = true;
  }

  if (!fileMatch) {
    return result;
  }

  const [, timePart, durationStr, ext] = fileMatch;

  // 构造 startTime
  let startTime: Date;
  if (isSegment) {
    // 分段格式：只有分钟，拼接日期
    const minute = timePart;
    startTime = new Date(
      Date.UTC(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        parseInt(hour),
        parseInt(minute),
        0,
      ),
    );
  } else {
    // 标准格式：YYYYMMDDTHHMMSS
    const y = timePart.slice(0, 4);
    const mo = timePart.slice(4, 6);
    const d = timePart.slice(6, 8);
    const h = timePart.slice(9, 11);
    const mi = timePart.slice(11, 13);
    const s = timePart.slice(13, 15);
    startTime = new Date(
      Date.UTC(
        parseInt(y),
        parseInt(mo) - 1,
        parseInt(d),
        parseInt(h),
        parseInt(mi),
        parseInt(s),
      ),
    );
  }

  result.isValid = true;
  result.deviceId = deviceId;
  result.startTime = startTime;
  result.duration = durationStr ? parseInt(durationStr) : null;
  result.extension = ext;
  result.contentType = EXT_TO_MIME[ext] || 'video/mp2t';

  return result;
}

/**
 * 去掉文件名中的 _duration 后缀，返回基础 key
 * 用于匹配：设备上传时 key 不含 duration，回调可能带也可能不带
 */
export function stripDurationFromKey(fileKey: string): string {
  const lastDot = fileKey.lastIndexOf('.');
  if (lastDot === -1) return fileKey;

  const namePart = fileKey.substring(0, lastDot);
  const extPart = fileKey.substring(lastDot);

  // 去掉 _NNN 后缀
  const stripped = namePart.replace(/_\d+$/, '');
  return `${stripped}${extPart}`;
}
