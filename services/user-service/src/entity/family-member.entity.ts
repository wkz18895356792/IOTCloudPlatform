import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('family_members')
@Index(['familyId'])
@Index(['userId'])
@Index(['familyId', 'userId'])
export class FamilyMember {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', comment: '家庭ID' })
  familyId!: string;

  @Column({ type: 'uuid', comment: '用户ID' })
  userId!: string;

  @Column({
    type: 'enum',
    enum: ['owner', 'admin', 'member'],
    comment: '成员角色',
  })
  role!: 'owner' | 'admin' | 'member';

  @Column({ type: 'json', nullable: true, comment: '权限列表' })
  permissions!: string[];

  @Column({ type: 'uuid', nullable: true, comment: '邀请人ID' })
  invitedBy!: string;

  @Column({ type: 'timestamp', comment: '加入时间' })
  joinedAt!: Date;

  @CreateDateColumn({ type: 'timestamp', comment: '创建时间' })
  createdAt!: Date;
}
