import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('firmware_versions')
@Index(['productId'])
@Index(['version'])
export class FirmwareVersion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, comment: '产品ID' })
  productId!: string;

  @Column({ type: 'varchar', length: 32, comment: '版本号' })
  version!: string;

  @Column({ type: 'text', comment: '版本更新说明' })
  releaseNotes!: string;

  @Column({ type: 'varchar', length: 512, comment: '固件文件URL' })
  fileUrl!: string;

  @Column({ type: 'int', unsigned: true, comment: '文件大小' })
  fileSize!: number;

  @Column({ type: 'varchar', length: 128, comment: '校验和' })
  checksum!: string;

  @Column({
    type: 'enum',
    enum: ['md5', 'sha256'],
    comment: '校验和类型',
  })
  checksumType!: 'md5' | 'sha256';

  @Column({ type: 'boolean', default: false, comment: '是否强制更新' })
  isForced!: boolean;

  @Column({ type: 'boolean', default: false, comment: '是否测试版' })
  isBeta!: boolean;

  @Column({ type: 'boolean', default: true, comment: '是否启用' })
  isActive!: boolean;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '版本名称' })
  versionName!: string;

  @Column({ type: 'varchar', length: 32, nullable: true, comment: '最低可升级版本' })
  minVersion!: string;

  @Column({ type: 'varchar', length: 32, nullable: true, comment: '最高可升级版本' })
  maxVersion!: string;

  @CreateDateColumn({ type: 'timestamp', comment: '上传时间' })
  uploadedAt!: Date;
}
