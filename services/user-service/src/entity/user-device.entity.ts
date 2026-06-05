import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

/**
 * User Device Entity
 *
 * Represents the relationship between users and devices.
 * A user can have multiple devices, and a device can be shared with multiple users.
 */
@Entity('user_devices')
@Index(['userId'])
@Index(['userId', 'deviceId'])
@Index(['deviceId'])
@Index(['role'])
export class UserDevice {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * User who owns or has access to this device
   */
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ type: 'uuid', comment: '用户ID' })
  userId!: string;

  /**
   * Device ID (references devices table in device-service)
   * Note: Full relationship requires cross-service reference
   */
  @Column({ type: 'uuid', comment: '设备ID' })
  deviceId!: string;

  @Column({ type: 'varchar', length: 128, nullable: true, comment: '设备别名' })
  deviceName!: string;

  /**
   * User's role for this device
   * - owner: Full control over the device
   * - admin: Can manage device settings and share with others
   * - viewer: Can only view device status
   */
  @Column({
    type: 'enum',
    enum: ['owner', 'admin', 'viewer'],
    default: 'owner',
    comment: '用户角色',
  })
  role!: 'owner' | 'admin' | 'viewer';

  /**
   * Custom permissions override (JSON format)
   * Allows fine-grained permission control beyond the basic roles
   */
  @Column({ type: 'json', nullable: true, comment: '权限列表' })
  permissions!: Record<string, boolean>;

  /**
   * Whether this device was shared with the user by another user
   */
  @Column({ type: 'boolean', default: false, comment: '是否为分享设备' })
  isShared!: boolean;

  /**
   * User ID who shared this device (null if the user is the owner)
   */
  @Column({ type: 'uuid', nullable: true, comment: '分享人ID' })
  sharedBy!: string;

  @Column({ type: 'timestamp', nullable: true, comment: '分享时间' })
  sharedAt!: Date;

  /** 访问过期时间（null 表示永不过期） */
  @Column({ type: 'timestamp', nullable: true, comment: '访问过期时间' })
  expiresAt!: Date | null;

  @CreateDateColumn({ type: 'timestamp', comment: '创建时间' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp', comment: '更新时间' })
  updatedAt!: Date;
}
