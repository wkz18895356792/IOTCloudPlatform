import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('user_profiles')
@Index(['userId'], { unique: true })
export class UserProfile {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', comment: '用户ID' })
  userId!: string;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '昵称' })
  nickname!: string;

  @Column({ type: 'varchar', length: 512, nullable: true, comment: '头像URL' })
  avatar!: string;

  @Column({
    type: 'enum',
    enum: ['male', 'female', 'other'],
    nullable: true,
    comment: '性别',
  })
  gender!: 'male' | 'female' | 'other';

  @Column({ type: 'date', nullable: true, comment: '出生日期' })
  birthDate!: Date;

  @Column({ type: 'varchar', length: 256, nullable: true, comment: '所在地' })
  location!: string;

  @Column({ type: 'text', nullable: true, comment: '个人简介' })
  bio!: string;

  @Column({ type: 'json', nullable: true, comment: '用户偏好设置' })
  preferences!: {
    language?: string;
    timezone?: string;
    notifications?: {
      email?: boolean;
      sms?: boolean;
      push?: boolean;
    };
  };

  @CreateDateColumn({ type: 'timestamp', comment: '创建时间' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp', comment: '更新时间' })
  updatedAt!: Date;
}
