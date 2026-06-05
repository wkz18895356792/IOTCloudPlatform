/**
 * 服务发现服务
 *
 * 提供微服务架构中的服务注册、发现和负载均衡功能。
 * 使用 Redis 存储服务实例信息，支持多种负载均衡策略。
 *
 * 主要功能：
 * - 服务注册与注销
 * - 服务发现与实例选择
 * - 健康检查与心跳机制
 * - 路由管理
 * - 多种负载均衡策略（轮询、随机、最少连接、加权）
 */
import { Provide, Inject, Scope, ScopeEnum } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import { CacheManager } from '@baby-monitor/shared-utils';

/**
 * 服务实例
 */
export interface ServiceInstance {
  id: string;
  name: string;
  host: string;
  port: number;
  protocol?: 'http' | 'https';
  healthCheckUrl?: string;
  metadata?: Record<string, any>;
  registeredAt: number;
  lastHeartbeat: number;
  status: 'healthy' | 'unhealthy' | 'draining';
}

/**
 * 服务注册信息
 */
export interface ServiceRegistration {
  name: string;
  host: string;
  port: number;
  protocol?: 'http' | 'https';
  healthCheckUrl?: string;
  metadata?: Record<string, any>;
  ttl?: number; // 生存时间（秒）
}

/**
 * 服务选择策略
 */
export type SelectionStrategy = 'round-robin' | 'random' | 'least-connections' | 'weighted';

/**
 * 服务路由配置
 */
export interface ServiceRoute {
  path: string;
  serviceName: string;
  methods: string[];
  stripPath?: boolean;
  timeout?: number;
  retries?: number;
}

/**
 * 服务发现服务类
 *
 * 采用单例模式，使用 Redis 作为存储后端实现服务发现功能。
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class ServiceDiscoveryService {
  @Inject()
  logger!: ILogger;

  @Inject()
  redis!: RedisService;

  @Inject()
  cacheManager!: CacheManager;

  // Redis key 前缀，用于区分不同类型的数据
  private readonly SERVICE_PREFIX = 'discovery:service:'; // 服务集合前缀
  private readonly INSTANCE_PREFIX = 'discovery:instance:'; // 服务实例前缀
  private readonly ROUTE_PREFIX = 'discovery:route:'; // 路由配置前缀
  private readonly DEFAULT_TTL = 30; // 默认 TTL（秒）
  private readonly HEARTBEAT_TIMEOUT = 60000; // 心跳超时时间（毫秒）

  // 轮询策略的索引计数器，记录每个服务的当前索引位置
  private roundRobinIndex = new Map<string, number>();

  /**
   * 注册服务实例
   *
   * 将新的服务实例注册到服务发现中心。每个实例会分配一个唯一的实例 ID。
   * 实例信息会存储在 Redis 中，并设置过期时间。
   *
   * @param registration - 服务注册信息，包含服务名称、地址、端口等
   * @returns 新注册的实例 ID
   */
  async register(registration: ServiceRegistration): Promise<string> {
    // 生成唯一的实例 ID（服务名-地址:端口-时间戳）
    const instanceId = `${registration.name}-${registration.host}:${registration.port}-${Date.now()}`;
    const ttl = registration.ttl || this.DEFAULT_TTL;

    // 构造服务实例对象
    const instance: ServiceInstance = {
      id: instanceId,
      name: registration.name,
      host: registration.host,
      port: registration.port,
      protocol: registration.protocol || 'http',
      healthCheckUrl: registration.healthCheckUrl || '/health',
      metadata: registration.metadata,
      registeredAt: Date.now(),
      lastHeartbeat: Date.now(),
      status: 'healthy',
    };

    // 保存实例信息到 Redis，设置过期时间为 TTL 的 2 倍（容错）
    const instanceKey = `${this.INSTANCE_PREFIX}${instanceId}`;
    await this.redis.set(instanceKey, JSON.stringify(instance));
    await this.redis.expire(instanceKey, ttl * 2);

    // 将实例 ID 添加到该服务的实例集合中
    const serviceKey = `${this.SERVICE_PREFIX}${registration.name}`;
    await this.redis.sadd(serviceKey, instanceId);
    await this.redis.expire(serviceKey, ttl * 2);

    console.log(`[Service Discovery] Registered instance: ${instanceId} for service ${registration.name}`);

    return instanceId;
  }

  /**
   * 注销服务实例
   *
   * 从服务发现中心移除指定的服务实例。
   * 会同时删除实例信息和从服务集合中移除该实例 ID。
   *
   * @param instanceId - 要注销的实例 ID
   * @returns 是否成功注销（false 表示实例不存在）
   */
  async deregister(instanceId: string): Promise<boolean> {
    const instanceKey = `${this.INSTANCE_PREFIX}${instanceId}`;
    const instanceData = await this.redis.get(instanceKey);

    // 实例不存在
    if (!instanceData) {
      return false;
    }

    // 解析实例信息获取服务名
    const instance: ServiceInstance = JSON.parse(instanceData);
    const serviceKey = `${this.SERVICE_PREFIX}${instance.name}`;

    // 删除实例信息和从服务集合中移除
    await this.redis.del(instanceKey);
    await this.redis.srem(serviceKey, instanceId);

    console.log(`[Service Discovery] Deregistered instance: ${instanceId}`);

    return true;
  }

  /**
   * 发送服务心跳
   *
   * 服务实例定期调用此方法更新最后心跳时间，保持实例健康状态。
   * 心跳超时的实例会被标记为不健康。
   *
   * @param instanceId - 实例 ID
   * @returns 是否成功更新心跳（false 表示实例不存在）
   */
  async heartbeat(instanceId: string): Promise<boolean> {
    const instanceKey = `${this.INSTANCE_PREFIX}${instanceId}`;
    const instanceData = await this.redis.get(instanceKey);

    // 实例不存在
    if (!instanceData) {
      return false;
    }

    // 更新心跳时间和状态
    const instance: ServiceInstance = JSON.parse(instanceData);
    instance.lastHeartbeat = Date.now();
    instance.status = 'healthy'; // 心跳成功，恢复健康状态

    // 保存并延长过期时间
    await this.redis.set(instanceKey, JSON.stringify(instance));
    await this.redis.expire(instanceKey, this.DEFAULT_TTL * 2);

    return true;
  }

  /**
   * 发现服务实例
   *
   * 获取指定服务的所有实例，包括健康和不健康的实例。
   * 会检查心跳超时，自动标记超时实例为不健康。
   * 同时清理已失效的实例 ID。
   *
   * @param serviceName - 服务名称
   * @returns 服务实例列表
   */
  async discover(serviceName: string): Promise<ServiceInstance[]> {
    const serviceKey = `${this.SERVICE_PREFIX}${serviceName}`;
    const instanceIds = await this.redis.smembers(serviceKey);

    const instances: ServiceInstance[] = [];
    const now = Date.now();

    // 遍历所有实例 ID
    for (const instanceId of instanceIds) {
      const instanceKey = `${this.INSTANCE_PREFIX}${instanceId}`;
      const instanceData = await this.redis.get(instanceKey);

      if (instanceData) {
        const instance: ServiceInstance = JSON.parse(instanceData);

        // 检查心跳是否超时
        if (now - instance.lastHeartbeat > this.HEARTBEAT_TIMEOUT) {
          instance.status = 'unhealthy'; // 标记为不健康
        }

        instances.push(instance);
      } else {
        // 实例数据不存在，从服务集合中清理该 ID
        await this.redis.srem(serviceKey, instanceId);
      }
    }

    return instances;
  }

  /**
   * 选择一个服务实例
   *
   * 根据指定的负载均衡策略从健康的服务实例中选择一个。
   * 只会选择状态为 'healthy' 的实例。
   *
   * @param serviceName - 服务名称
   * @param strategy - 负载均衡策略，默认为轮询（round-robin）
   * @returns 选中的服务实例，如果没有可用实例则返回 null
   */
  async selectInstance(serviceName: string, strategy: SelectionStrategy = 'round-robin'): Promise<ServiceInstance | null> {
    // 获取所有实例
    const instances = await this.discover(serviceName);

    // 过滤出健康的实例
    const healthyInstances = instances.filter(i => i.status === 'healthy');

    // 没有可用实例
    if (healthyInstances.length === 0) {
      console.warn(`[Service Discovery] No healthy instances for service ${serviceName}`);
      return null;
    }

    // 根据策略选择实例
    switch (strategy) {
      case 'round-robin':
        return this.selectRoundRobin(serviceName, healthyInstances);

      case 'random':
        return this.selectRandom(healthyInstances);

      case 'least-connections':
        return this.selectLeastConnections(serviceName, healthyInstances);

      case 'weighted':
        return this.selectWeighted(healthyInstances);

      default:
        return this.selectRoundRobin(serviceName, healthyInstances);
    }
  }

  /**
   * 轮询策略选择实例
   *
   * 按顺序依次选择每个实例，实现负载均衡。
   * 使用索引计数器记录当前选择位置。
   *
   * @param serviceName - 服务名称
   * @param instances - 可用实例列表
   * @returns 选中的实例
   */
  private selectRoundRobin(serviceName: string, instances: ServiceInstance[]): ServiceInstance {
    // 获取当前服务的索引，不存在则从 0 开始
    let index = this.roundRobinIndex.get(serviceName) || 0;
    // 使用取模运算实现循环
    const instance = instances[index % instances.length];

    // 更新索引到下一个位置
    index = (index + 1) % instances.length;
    this.roundRobinIndex.set(serviceName, index);

    return instance;
  }

  /**
   * 随机策略选择实例
   *
   * 从可用实例中随机选择一个，适合实例性能相近的场景。
   *
   * @param instances - 可用实例列表
   * @returns 随机选中的实例
   */
  private selectRandom(instances: ServiceInstance[]): ServiceInstance {
    const index = Math.floor(Math.random() * instances.length);
    return instances[index];
  }

  /**
   * 最少连接策略选择实例
   *
   * 选择当前活跃连接数最少的实例。
   * 连接数信息存储在实例的 metadata.activeConnections 字段中。
   *
   * @param serviceName - 服务名称（此参数未使用，保留用于扩展）
   * @param instances - 可用实例列表
   * @returns 连接数最少的实例
   */
  private selectLeastConnections(serviceName: string, instances: ServiceInstance[]): ServiceInstance {
    // 简化实现：从实例的 metadata 中获取连接数
    // 实际生产环境需要维护活跃连接数的实时统计
    let minConnections = Infinity;
    let selected = instances[0];

    for (const instance of instances) {
      const connections = instance.metadata?.activeConnections || 0;
      if (connections < minConnections) {
        minConnections = connections;
        selected = instance;
      }
    }

    return selected;
  }

  /**
   * 加权策略选择实例
   *
   * 根据实例的权重进行选择，权重越高被选中的概率越大。
   * 权重值存储在实例的 metadata.weight 字段中，默认为 1。
   *
   * @param instances - 可用实例列表
   * @returns 根据权重选中的实例
   */
  private selectWeighted(instances: ServiceInstance[]): ServiceInstance {
    let totalWeight = 0;
    const weightedInstances: Array<{ instance: ServiceInstance; weight: number }> = [];

    // 计算总权重并构建加权实例列表
    for (const instance of instances) {
      const weight = instance.metadata?.weight || 1; // 默认权重为 1
      totalWeight += weight;
      weightedInstances.push({ instance, weight });
    }

    // 生成随机权重值
    let random = Math.random() * totalWeight;

    // 找到命中的权重区间
    for (const { instance, weight } of weightedInstances) {
      random -= weight;
      if (random <= 0) {
        return instance;
      }
    }

    // 兜底返回第一个实例
    return weightedInstances[0].instance;
  }

  /**
   * 获取服务的完整 URL
   *
   * 根据服务名和负载均衡策略选择一个实例，返回其完整 URL。
   *
   * @param serviceName - 服务名称
   * @param strategy - 负载均衡策略，可选
   * @returns 服务 URL，格式为 protocol://host:port，无可用实例时返回 null
   */
  async getServiceUrl(serviceName: string, strategy?: SelectionStrategy): Promise<string | null> {
    // 选择实例
    const instance = await this.selectInstance(serviceName, strategy);

    if (!instance) {
      return null;
    }

    // 构造 URL
    const protocol = instance.protocol || 'http';
    return `${protocol}://${instance.host}:${instance.port}`;
  }

  /**
   * 创建服务路由
   *
   * 将 URL 路径模式映射到目标服务，实现基于路径的服务路由。
   * 支持通配符匹配。
   *
   * @param route - 路由配置，包含路径、服务名、HTTP 方法等
   */
  async createRoute(route: ServiceRoute): Promise<void> {
    const routeKey = `${this.ROUTE_PREFIX}${route.path}`;
    await this.redis.set(routeKey, JSON.stringify(route));
    await this.redis.expire(routeKey, 86400); // 24 小时过期

    console.log(`[Service Discovery] Created route: ${route.path} -> ${route.serviceName}`);
  }

  /**
   * 删除服务路由
   *
   * 移除指定路径的路由配置。
   *
   * @param path - 路由路径
   * @returns 是否成功删除（true 表示删除成功，false 表示路由不存在）
   */
  async removeRoute(path: string): Promise<boolean> {
    const routeKey = `${this.ROUTE_PREFIX}${path}`;
    const result = await this.redis.del(routeKey);

    return result > 0;
  }

  /**
   * 查找匹配的路由
   *
   * 先进行精确匹配，如果没找到则尝试通配符模式匹配。
   *
   * @param path - 请求路径
   * @returns 匹配的路由配置，未找到则返回 null
   */
  async findRoute(path: string): Promise<ServiceRoute | null> {
    // 精确匹配
    const exactKey = `${this.ROUTE_PREFIX}${path}`;
    const exactData = await this.redis.get(exactKey);

    if (exactData) {
      return JSON.parse(exactData);
    }

    // 模式匹配（支持通配符）
    const keys = await this.cacheManager.keysByPattern(`${this.ROUTE_PREFIX}*`);

    for (const key of keys) {
      const routePath = key.replace(this.ROUTE_PREFIX, '');

      // 检查是否是通配符模式
      if (routePath.includes('*')) {
        // 将通配符模式转换为正则表达式
        const pattern = routePath.replace(/\*/g, '.*').replace(/\//g, '\\/');
        const regex = new RegExp(`^${pattern}$`);

        if (regex.test(path)) {
          const data = await this.redis.get(key);
          if (data) {
            return JSON.parse(data);
          }
        }
      }
    }

    return null;
  }

  /**
   * 获取所有服务及其实例
   *
   * 返回系统中已注册的所有服务，以及每个服务的实例列表。
   *
   * @returns 服务列表，包含服务名和对应的实例列表
   */
  async getAllServices(): Promise<Array<{ name: string; instances: ServiceInstance[] }>> {
    const serviceKeys = await this.cacheManager.keysByPattern(`${this.SERVICE_PREFIX}*`);
    const services: Array<{ name: string; instances: ServiceInstance[] }> = [];

    for (const serviceKey of serviceKeys) {
      const serviceName = serviceKey.replace(this.SERVICE_PREFIX, '');
      const instances = await this.discover(serviceName);

      services.push({
        name: serviceName,
        instances,
      });
    }

    return services;
  }

  /**
   * 获取服务状态
   *
   * 返回指定服务的详细状态信息，包括实例总数、健康/不健康实例数等。
   *
   * @param serviceName - 服务名称
   * @returns 服务状态信息，服务不存在时返回 null
   */
  async getServiceStatus(serviceName: string): Promise<{
    name: string;
    totalInstances: number;
    healthyInstances: number;
    unhealthyInstances: number;
    instances: ServiceInstance[];
  } | null> {
    const instances = await this.discover(serviceName);

    if (instances.length === 0) {
      return null;
    }

    const healthyInstances = instances.filter(i => i.status === 'healthy').length;

    return {
      name: serviceName,
      totalInstances: instances.length,
      healthyInstances,
      unhealthyInstances: instances.length - healthyInstances,
      instances,
    };
  }

  /**
   * 更新实例元数据
   *
   * 更新指定实例的元数据，如权重、连接数等信息。
   * 采用合并策略，保留未更新的字段。
   *
   * @param instanceId - 实例 ID
   * @param metadata - 要更新的元数据
   * @returns 是否成功更新（false 表示实例不存在）
   */
  async updateInstanceMetadata(instanceId: string, metadata: Record<string, any>): Promise<boolean> {
    const instanceKey = `${this.INSTANCE_PREFIX}${instanceId}`;
    const instanceData = await this.redis.get(instanceKey);

    if (!instanceData) {
      return false;
    }

    const instance: ServiceInstance = JSON.parse(instanceData);
    // 合并元数据，新值覆盖旧值
    instance.metadata = { ...instance.metadata, ...metadata };

    await this.redis.set(instanceKey, JSON.stringify(instance));

    return true;
  }

  /**
   * 设置实例状态
   *
   * 手动设置服务实例的健康状态。
   * 可用于维护时将实例标记为 'draining'（排出）状态。
   *
   * @param instanceId - 实例 ID
   * @param status - 要设置的状态（healthy/unhealthy/draining）
   * @returns 是否成功设置（false 表示实例不存在）
   */
  async setInstanceStatus(instanceId: string, status: ServiceInstance['status']): Promise<boolean> {
    const instanceKey = `${this.INSTANCE_PREFIX}${instanceId}`;
    const instanceData = await this.redis.get(instanceKey);

    if (!instanceData) {
      return false;
    }

    const instance: ServiceInstance = JSON.parse(instanceData);
    instance.status = status;

    await this.redis.set(instanceKey, JSON.stringify(instance));

    console.log(`[Service Discovery] Instance ${instanceId} status set to ${status}`);

    return true;
  }

  /**
   * 清理不健康的实例
   *
   * 扫描所有服务，注销状态为 'unhealthy' 的实例。
   * 通常由定时任务定期调用，保持服务列表的清洁。
   *
   * @returns 清理的实例数量
   */
  async cleanupUnhealthyInstances(): Promise<number> {
    const services = await this.getAllServices();
    let cleaned = 0;

    for (const service of services) {
      for (const instance of service.instances) {
        if (instance.status === 'unhealthy') {
          await this.deregister(instance.id);
          cleaned++;
        }
      }
    }

    if (cleaned > 0) {
      console.log(`[Service Discovery] Cleaned up ${cleaned} unhealthy instances`);
    }

    return cleaned;
  }

  /**
   * 获取所有路由配置
   *
   * 返回系统中配置的所有服务路由。
   *
   * @returns 路由配置列表
   */
  async getAllRoutes(): Promise<ServiceRoute[]> {
    const keys = await this.cacheManager.keysByPattern(`${this.ROUTE_PREFIX}*`);
    const routes: ServiceRoute[] = [];

    for (const key of keys) {
      const data = await this.redis.get(key);
      if (data) {
        routes.push(JSON.parse(data));
      }
    }

    return routes;
  }

  /**
   * 获取全局统计信息
   *
   * 返回整个服务发现系统的统计数据，用于监控和展示。
   *
   * @returns 全局统计数据，包含服务数、实例数、路由数等
   */
  async getGlobalStatistics(): Promise<{
    totalServices: number;
    totalInstances: number;
    healthyInstances: number;
    unhealthyInstances: number;
    totalRoutes: number;
  }> {
    const services = await this.getAllServices();
    const routes = await this.getAllRoutes();

    let totalInstances = 0;
    let healthyInstances = 0;
    let unhealthyInstances = 0;

    // 统计所有服务的实例数
    for (const service of services) {
      totalInstances += service.instances.length;
      healthyInstances += service.instances.filter(i => i.status === 'healthy').length;
      unhealthyInstances += service.instances.filter(i => i.status === 'unhealthy').length;
    }

    return {
      totalServices: services.length,
      totalInstances,
      healthyInstances,
      unhealthyInstances,
      totalRoutes: routes.length,
    };
  }
}
