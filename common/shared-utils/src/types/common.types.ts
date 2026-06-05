/**
 * Common Types for Services
 *
 * Reusable type definitions to reduce `any` usage across services
 */

// ==================== Geometry Types ====================

/**
 * 2D Point coordinates
 */
export interface Point {
  x: number;
  y: number;
}

/**
 * 2D Bounding Box
 */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 3D Bounding Box (for spatial detection)
 */
export interface BoundingBox3D {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
}

// ==================== Zone Types ====================

/**
 * Zone type enumeration
 */
export type ZoneType = 'polygon' | 'rectangle' | 'circle' | 'ellipse';

/**
 * Base zone interface
 */
export interface BaseZone {
  zoneId: string;
  name: string;
  type: ZoneType;
  enabled?: boolean;
}

/**
 * Polygon zone (defined by array of points)
 */
export interface PolygonZone extends BaseZone {
  type: 'polygon';
  coordinates: Point[];
}

/**
 * Rectangle zone (defined by bounding box)
 */
export interface RectangleZone extends BaseZone {
  type: 'rectangle';
  coordinates: BoundingBox;
}

/**
 * Circle zone (defined by center and radius)
 */
export interface CircleZone extends BaseZone {
  type: 'circle';
  coordinates: {
    center: Point;
    radius: number;
  };
}

/**
 * Ellipse zone (defined by center, radii, and rotation)
 */
export interface EllipseZone extends BaseZone {
  type: 'ellipse';
  coordinates: {
    center: Point;
    radiusX: number;
    radiusY: number;
    rotation?: number; // in radians
  };
}

/**
 * Union type for all zones
 */
export type Zone = PolygonZone | RectangleZone | CircleZone | EllipseZone;

// ==================== Face Detection Types ====================

/**
 * Face detection result from AI/ML services
 */
export interface FaceDetection {
  faceId: string;
  confidence: number;
  boundingBox: BoundingBox;
  emotion?: string;
  emotionConfidence?: number;
  age?: number;
  gender?: 'male' | 'female' | 'other';
  landmarks?: Point[];
  embedding?: number[]; // Face embedding for recognition
}

/**
 * Face recognition result
 */
export interface FaceRecognition {
  faceId: string;
  personId?: string;
  personName?: string;
  confidence: number;
  isKnown: boolean;
  matchedAt: Date;
}

// ==================== AI/ML Types ====================

/**
 * Video frame metadata
 */
export interface VideoFrame {
  deviceId: string;
  timestamp: Date;
  width: number;
  height: number;
  format: 'rgb' | 'rgba' | 'jpeg' | 'h264';
  data: Buffer | string; // Buffer or base64 string
  sequenceNumber?: number;
}

/**
 * AI Detection result
 */
export interface AIDetection {
  type: string;
  confidence: number;
  boundingBox?: BoundingBox;
  data?: Record<string, unknown>;
  timestamp: Date;
}

/**
 * AI Event type enumeration
 */
export type AIEventType =
  | 'motion_detected'
  | 'person_detected'
  | 'face_recognized'
  | 'face_unknown'
  | 'emotion_changed'
  | 'crying_detected'
  | 'zone_entered'
  | 'zone_exited'
  | 'object_detected'
  | 'alert_triggered';

/**
 * AI Event data
 */
export interface AIEvent {
  eventId: string;
  deviceId: string;
  eventType: AIEventType;
  confidence: number;
  data: Record<string, unknown>;
  timestamp: Date;
}

// ==================== Device Types ====================

/**
 * Device message payload
 */
export interface DeviceMessagePayload {
  type: 'report' | 'status' | 'event' | 'command' | 'response';
  deviceId: string;
  timestamp: number;
  data: Record<string, unknown>;
}

/**
 * Device command
 */
export interface DeviceCommand {
  commandId: string;
  deviceId: string;
  commandType: string;
  payload: Record<string, unknown>;
  timeout?: number;
  retry?: number;
}

/**
 * Device command response
 */
export interface DeviceCommandResponse {
  commandId: string;
  deviceId: string;
  status: 'pending' | 'sent' | 'acknowledged' | 'timeout' | 'failed' | 'completed';
  result?: Record<string, unknown>;
  error?: string;
  executedAt?: Date;
}

// ==================== Configuration Types ====================

/**
 * AI Configuration
 */
export interface AIConfig {
  enabled: boolean;
  model?: string;
  confidence?: {
    minimum: number;
    high: number;
    medium: number;
    low: number;
  };
  detection?: {
    face?: boolean;
    person?: boolean;
    emotion?: boolean;
    crying?: boolean;
    motion?: boolean;
  };
  alerts?: {
    enabled: boolean;
    cooldown?: number; // seconds
  };
}

/**
 * Service health status
 */
export interface ServiceHealth {
  status: 'healthy' | 'unhealthy' | 'degraded';
  uptime: number;
  memory: {
    used: number;
    total: number;
    percentage: number;
  };
  cpu?: {
    usage: number;
  };
  lastCheck: Date;
}

// ==================== Pagination Types ====================

/**
 * Pagination options
 */
export interface PaginationOptions {
  page: number;
  pageSize: number;
  sortBy?: string;
  sortOrder?: 'ASC' | 'DESC';
}

/**
 * Paginated response
 */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

// ==================== Error Types ====================

/**
 * Service error details
 */
export interface ServiceError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  timestamp: Date;
  service?: string;
}

/**
 * API Response wrapper
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ServiceError;
  timestamp: Date;
}

// ==================== Storage Types ====================

/**
 * Storage provider type
 */
export type StorageProviderType = 'aws_s3' | 'tencent_cos' | 'minio' | 's3' | 'cos';

/**
 * File metadata
 */
export interface FileMetadata {
  fileId: string;
  fileName: string;
  fileSize: number;
  contentType: string;
  storageProvider: 'aws_s3' | 'tencent_cos' | 'minio';
  storageClass: 'hot' | 'cold' | 'archive';
  url?: string;
  etag?: string;
  checksum?: string;
  metadata?: Record<string, string | number | boolean>;
  createdAt: Date;
  updatedAt?: Date;
}

// ==================== Stream Types ====================

/**
 * Stream session info
 */
export interface StreamSession {
  sessionId: string;
  deviceId: string;
  provider: 'aws_kvs' | 'tencent' | 'webrtc';
  protocol: 'hls' | 'webrtc' | 'rtmp' | 'rtsp';
  status: 'starting' | 'streaming' | 'stopped' | 'error';
  url?: string;
  config: Record<string, unknown>;
  createdAt: Date;
  stoppedAt?: Date;
}

/**
 * Recording task info
 */
export interface RecordingTask {
  taskId: string;
  deviceId: string;
  sessionId?: string;
  provider: 'aws_kvs' | 'tencent' | 'webrtc';
  format: 'mp4' | 'flv' | 'm3u8';
  storageType: 'hot' | 'cold' | 'archive';
  status: 'recording' | 'completed' | 'failed';
  fileUrl?: string;
  fileSize?: number;
  duration?: number;
  createdAt: Date;
  completedAt?: Date;
}

// ==================== Service Response Helpers ====================

/**
 * Create a successful API response
 */
export function successResponse<T>(data: T): ApiResponse<T> {
  return {
    success: true,
    data,
    timestamp: new Date(),
  };
}

/**
 * Create an error API response
 */
export function errorResponse(
  code: string,
  message: string,
  details?: Record<string, unknown>
): ApiResponse<never> {
  return {
    success: false,
    error: {
      code,
      message,
      details,
      timestamp: new Date(),
    },
    timestamp: new Date(),
  };
}

/**
 * Create a paginated API response
 */
export function paginatedResponse<T>(
  data: T[],
  total: number,
  page: number,
  pageSize: number
): ApiResponse<PaginatedResponse<T>> {
  return successResponse({
    data,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
    hasNext: page * pageSize < total,
    hasPrevious: page > 1,
  });
}

