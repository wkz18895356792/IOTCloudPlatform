import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * 设备邀请权限配置
 */
export interface InvitationPermissions {
  read: boolean;
  write: boolean;
  delete: boolean;
  share: boolean;
  manage: boolean;
}

/**
 * 用户设备邀请实体
 *
 * 记录设备所有者发起的观看邀请，统一由 user-service 管理。
 */
@Entity('user_device_invitations')
export class UserDeviceInvitation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'device_id', type: 'varchar', length: 64 })
  @Index()
  deviceId: string;

  @Column({ name: 'inviter_id', type: 'varchar', length: 64 })
  @Index()
  inviterId: string;

  /** 被邀请人手机号 */
  @Column({ name: 'invitee_phone', type: 'varchar', length: 20 })
  @Index()
  inviteePhone: string;

  /** 被邀请人用户ID（接受邀请后填充） */
  @Column({ name: 'invitee_id', type: 'varchar', length: 64, nullable: true })
  @Index()
  inviteeId: string;

  /** 邀请状态 */
  @Column({
    name: 'status',
    type: 'enum',
    enum: ['pending', 'accepted', 'rejected', 'expired'],
    default: 'pending',
  })
  status: 'pending' | 'accepted' | 'rejected' | 'expired';

  /** 权限配置 */
  @Column({ name: 'permissions', type: 'json' })
  permissions: InvitationPermissions;

  /** 邀请过期时间 */
  @Column({ name: 'expires_at', type: 'timestamp', nullable: true })
  expiresAt: Date;

  /** 接受邀请时间 */
  @Column({ name: 'accepted_at', type: 'timestamp', nullable: true })
  acceptedAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;
}
