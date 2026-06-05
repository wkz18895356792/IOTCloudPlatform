/**
 * Type declarations for @project-chip/matter.js
 *
 * Note: These are placeholder declarations for compilation.
 * The actual API structure changed in v0.9.x
 */

declare module '@project-chip/matter.js' {
  export class CommissioningController {
    static create(options: any): Promise<CommissioningController>;
    connect(): Promise<void>;
    close(): Promise<void>;
    commissionNode(options: any): Promise<any>;
    removeNode(nodeId: any): Promise<void>;
    getConnectedNode(nodeId: any): any;
  }

  export interface CommissioningOptions {
    regulatoryLocation?: number;
    regulatoryCountryCode?: string;
    controllerOptions?: {
      vendorId: VendorId;
      vendorName: string;
      productId: number;
      productName: string;
      productLabel: string;
    };
  }

  export class ControllerNode {
    initialize(): Promise<void>;
    close(): Promise<void>;
  }

  export interface NodeCommissioningOptions {
    regulatoryLocation?: number;
    regulatoryCountryCode?: string;
    wifiNetwork?: {
      ssid: string;
      credentials: string;
    };
    commissioning?: {
      discriminator: number;
      passcode: number;
    };
    discovery?: {
      discoveryCapabilities?: {
        onIpNetwork?: boolean;
      };
      identifierData?: {
        discriminator?: number;
      };
    };
  }

  export class VendorId {
    static of(id: number): VendorId;
    id: number;
  }
}

declare module '@project-chip/matter.js/cluster' {
  export class BasicInformationCluster {
    static readonly id: number;
    static readonly Attributes: Record<string, any>;
    static readonly Commands: Record<string, any>;
  }
  export class OnOffCluster {
    static readonly id: number;
    static readonly Attributes: Record<string, any>;
    static readonly Commands: Record<string, any>;
  }
  export class LevelControlCluster {
    static readonly id: number;
    static readonly Attributes: Record<string, any>;
    static readonly Commands: Record<string, any>;
  }
  export class ColorControlCluster {
    static readonly id: number;
    static readonly Attributes: Record<string, any>;
    static readonly Commands: Record<string, any>;
  }
  export class TemperatureMeasurementCluster {
    static readonly id: number;
    static readonly Attributes: Record<string, any>;
    static readonly Commands: Record<string, any>;
  }
  export class RelativeHumidityMeasurementCluster {
    static readonly id: number;
    static readonly Attributes: Record<string, any>;
    static readonly Commands: Record<string, any>;
  }
  export class DoorLockCluster {
    static readonly id: number;
    static readonly Attributes: Record<string, any>;
    static readonly Commands: Record<string, any>;
  }
  export class WindowCoveringCluster {
    static readonly id: number;
    static readonly Attributes: Record<string, any>;
    static readonly Commands: Record<string, any>;
  }
  export class ThermostatCluster {
    static readonly id: number;
    static readonly Attributes: Record<string, any>;
    static readonly Commands: Record<string, any>;
  }
  export class PowerSourceCluster {
    static readonly id: number;
    static readonly Attributes: Record<string, any>;
    static readonly Commands: Record<string, any>;
  }
  export class DescriptorCluster {
    static readonly id: number;
    static readonly Attributes: Record<string, any>;
    static readonly Commands: Record<string, any>;
  }
  export class IdentifyCluster {
    static readonly id: number;
    static readonly Attributes: Record<string, any>;
    static readonly Commands: Record<string, any>;
  }
  export class GroupsCluster {
    static readonly id: number;
    static readonly Attributes: Record<string, any>;
    static readonly Commands: Record<string, any>;
  }
  export class ScenesCluster {
    static readonly id: number;
    static readonly Attributes: Record<string, any>;
    static readonly Commands: Record<string, any>;
  }
  export class BooleanStateCluster {
    static readonly id: number;
    static readonly Attributes: Record<string, any>;
    static readonly Commands: Record<string, any>;
  }
  export class OccupancySensingCluster {
    static readonly id: number;
    static readonly Attributes: Record<string, any>;
    static readonly Commands: Record<string, any>;
  }
}

declare module '@project-chip/matter.js/devices' {
  export interface DeviceTypeDefinition {
    code: number;
    name: string;
  }

  export const DeviceTypes: {
    [key: string]: DeviceTypeDefinition;
  };

  export const OnOffLightDevice: DeviceTypeDefinition;
  export const DimmableLightDevice: DeviceTypeDefinition;
  export const ColorTemperatureLightDevice: DeviceTypeDefinition;
  export const OnOffPluginUnitDevice: DeviceTypeDefinition;
  export const DimmablePluginUnitDevice: DeviceTypeDefinition;
  export const TemperatureSensorDevice: DeviceTypeDefinition;
  export const HumiditySensorDevice: DeviceTypeDefinition;
  export const OccupancySensorDevice: DeviceTypeDefinition;
  export const ContactSensorDevice: DeviceTypeDefinition;
  export const DoorLockDevice: DeviceTypeDefinition;
  export const WindowCoveringDevice: DeviceTypeDefinition;
  export const ThermostatDevice: DeviceTypeDefinition;
}

declare module '@project-chip/matter.js/environment' {
  export class Environment {
    static default: Environment;
    get(name: string): any;
    set(name: string, value: any): void;
  }

  export class StorageService {
    static create(name: string): StorageService;
    createContext(name: string): StorageContext;
  }

  export class StorageContext {
    get<T>(key: string): Promise<T | undefined>;
    set<T>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<void>;
  }
}

declare module '@project-chip/matter.js/mdns' {
  export interface MdnsDiscoveryResult {
    deviceName: string;
    deviceType: number;
    vendorId: number;
    productId: number;
    addresses: string[];
    port: number;
    discriminator: number;
  }

  export class MdnsInstance {
    static create(): Promise<MdnsInstance>;
    start(): Promise<void>;
    close(): Promise<void>;
    stop(): Promise<void>;
    announce(): void;
    advertise(options: any): void;
    discover(options: any): Promise<MdnsDiscoveryResult[]>;
    on(event: string, callback: (result: MdnsDiscoveryResult) => void): void;
    off(event: string, callback: (result: MdnsDiscoveryResult) => void): void;
  }
}

declare module '@project-chip/matter.js/log' {
  export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    NOTICE = 2,
    WARN = 3,
    ERROR = 4,
    FATAL = 5,
  }

  export class Logger {
    static level: LogLevel;
    static setLogLevel(level: LogLevel): void;
    static get(name: string): Logger;
    debug(message: string, ...args: any[]): void;
    info(message: string, ...args: any[]): void;
    warn(message: string, ...args: any[]): void;
    error(message: string, ...args: any[]): void;
  }
}

declare module '@project-chip/matter.js/datatype' {
  export class NodeId {
    constructor(id: number | bigint);
    static readonly EMPTY: NodeId;
    static fromString(str: string): NodeId;
    id: bigint;
    toString(): string;
    equals(other: NodeId): boolean;
  }
}
