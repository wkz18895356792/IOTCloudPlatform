import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('family_invitations')
@Index(['inviteCode'], { unique: true })
@Index(['familyId'])
@Index(['status'])
export class FamilyInvitation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', comment: '家庭ID' })
  familyId!: string;

  @Column({ type: 'varchar', length: 16, comment: '邀请码' })
  inviteCode!: string;

  @Column({ type: 'uuid', comment: '邀请人ID' })
  inviterId!: string;

  @Column({ type: 'varchar', length: 128, nullable: true, comment: '被邀请人邮箱' })
  inviteeEmail!: string;

  @Column({ type: 'varchar', length: 20, nullable: true, comment: '被邀请人手机号' })
  inviteePhone!: string;

  @Column({
    type: 'enum',
    enum: ['admin', 'member'],
    comment: '邀请角色',
  })
  role!: 'admin' | 'member';

  @Column({
    type: 'enum',
    enum: ['pending', 'accepted', 'rejected', 'expired'],
    default: 'pending',
    comment: '邀请状态',
  })
  status!: 'pending' | 'accepted' | 'rejected' | 'expired';

  @Column({ type: 'timestamp', comment: '过期时间' })
  expiresAt!: Date;

  @Column({ type: 'timestamp', nullable: true, comment: '接受时间' })
  acceptedAt!: Date;

  @CreateDateColumn({ type: 'timestamp', comment: '创建时间' })
  createdAt!: Date;
}
