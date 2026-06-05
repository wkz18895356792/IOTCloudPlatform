import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';
import { ThirdPartyProvider } from '@baby-monitor/shared-types';

@Entity('third_party_bindings')
@Index(['userId'])
@Index(['provider', 'openId'])
export class ThirdPartyBinding {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', comment: '用户ID' })
  userId!: string;

  @Column({
    type: 'enum',
    enum: ThirdPartyProvider,
    comment: '第三方提供商',
  })
  provider!: ThirdPartyProvider;

  @Column({ type: 'varchar', length: 128, comment: 'OpenID' })
  openId!: string;

  @Column({ type: 'varchar', length: 128, nullable: true, comment: 'UnionID' })
  unionId!: string;

  @Column({ type: 'json', nullable: true, comment: '第三方用户信息' })
  userInfo!: Record<string, any>;

  @CreateDateColumn({ type: 'timestamp', comment: '绑定时间' })
  bindAt!: Date;
}
