import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export enum ProductType {
  CAMERA = 'camera',
  SCREEN = 'screen',
  SENSOR = 'sensor',
  GATEWAY = 'gateway',
}

export enum DeviceProtocol {
  PRIVATE = 'private',
  MATTER = 'matter',
}

export enum DeviceStatus {
  ONLINE = 'online',
  OFFLINE = 'offline',
  UNAUTHORIZED = 'unauthorized',
  UPDATING = 'updating',
}

@Entity('devices')
@Index(['serialNumber'])
@Index(['ownerId'])
@Index(['status'])
@Index(['domainId'])
export class Device {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, comment: '设备序列号' })
  serialNumber!: string;

  @Column({ type: 'varchar', length: 64, comment: '产品ID' })
  productId!: string;

  @Column({
    type: 'enum',
    enum: ProductType,
    comment: '产品类型',
  })
  productType!: ProductType;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '设备型号' })
  deviceType!: string;

  @Column({ type: 'varchar', length: 128, comment: '设备名称' })
  name!: string;

  @Column({ type: 'varchar', length: 32, comment: '固件版本' })
  firmwareVersion!: string;

  @Column({
    type: 'enum',
    enum: DeviceProtocol,
    comment: '设备协议',
  })
  protocol!: DeviceProtocol;

  @Column({
    type: 'enum',
    enum: DeviceStatus,
    default: DeviceStatus.OFFLINE,
    comment: '设备状态',
  })
  status!: DeviceStatus;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: 'IP地址' })
  ipAddress!: string;

  @Column({ type: 'varchar', length: 32, nullable: true, comment: 'MAC地址' })
  macAddress!: string;

  @Column({ type: 'tinyint', nullable: true, comment: '云服务提供商(1:AWS/2:腾讯云/3:RJI)' })
  cloudProvider!: number;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: 'IoT Video 产品ID' })
  iotProductId!: string;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: 'IoT Video 设备名称' })
  iotDeviceName!: string;

  @Column({ type: 'varchar', length: 128, nullable: true, comment: 'IoT Video 设备密钥' })
  iotDeviceSecret!: string;

  @Column({ type: 'timestamp', nullable: true, comment: '最后在线时间' })
  lastOnline!: Date;

  @Column({ type: 'uuid', comment: '所有者用户ID' })
  ownerId!: string;

  @Column({ type: 'varchar', length: 36, nullable: true, comment: '所属域ID' })
  domainId!: string;

  @CreateDateColumn({ type: 'timestamp', comment: '创建时间' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp', comment: '更新时间' })
  updatedAt!: Date;
}
