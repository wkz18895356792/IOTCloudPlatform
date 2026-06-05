import { Rule, RuleType } from '@midwayjs/validate';

/**
 * 创建域请求DTO
 */
export class CreateDomainDTO {
  @Rule(RuleType.string().required())
  code: string;           // 域编码（唯一标识）

  @Rule(RuleType.string().required())
  name: string;           // 域名称

  @Rule(RuleType.string().optional())
  description?: string;   // 域描述

  @Rule(RuleType.string().optional())
  type?: string;          // 域类型: trial/standard/premium/enterprise

  @Rule(RuleType.string().optional())
  ownerId?: string;       // 域所有者ID

  @Rule(RuleType.number().optional())
  userLimit?: number;     // 用户数量限制

  @Rule(RuleType.number().optional())
  deviceLimit?: number;   // 设备数量限制

  @Rule(RuleType.number().optional())
  storageLimit?: number;  // 存储空间限制（GB）

  @Rule(RuleType.object().optional())
  config?: Record<string, any>;  // 域配置
}

/**
 * 更新域请求DTO
 */
export class UpdateDomainDTO {
  @Rule(RuleType.string().optional())
  name?: string;

  @Rule(RuleType.string().optional())
  description?: string;

  @Rule(RuleType.string().optional())
  type?: string;

  @Rule(RuleType.string().optional())
  status?: string;        // 域状态: active/suspended/deleted

  @Rule(RuleType.number().optional())
  userLimit?: number;

  @Rule(RuleType.number().optional())
  deviceLimit?: number;

  @Rule(RuleType.number().optional())
  storageLimit?: number;

  @Rule(RuleType.object().optional())
  config?: Record<string, any>;
}

/**
 * 添加用户到域DTO
 */
export class AddUserToDomainDTO {
  @Rule(RuleType.string().required())
  userId: string;         // 用户ID

  @Rule(RuleType.string().required())
  role: string;           // 角色: domain_admin/domain_user/domain_guest

  @Rule(RuleType.array().optional())
  customPermissions?: string[];  // 自定义权限列表
}

/**
 * 更新用户域角色DTO
 */
export class UpdateUserRoleDTO {
  @Rule(RuleType.string().required())
  role: string;           // 新角色
}

/**
 * 域查询参数DTO
 */
export class DomainQueryDTO {
  @Rule(RuleType.string().optional())
  code?: string;          // 按域编码查询

  @Rule(RuleType.string().optional())
  status?: string;        // 按状态查询

  @Rule(RuleType.string().optional())
  type?: string;          // 按类型查询

  @Rule(RuleType.number().optional())
  page?: number = 1;      // 页码

  @Rule(RuleType.number().optional())
  pageSize?: number = 20; // 每页数量
}

/**
 * 创建域权限DTO
 */
export class CreatePermissionDTO {
  @Rule(RuleType.string().required())
  role: string;           // 角色名称

  @Rule(RuleType.string().required())
  resource: string;       // 资源类型

  @Rule(RuleType.string().required())
  action: string;         // 操作类型

  @Rule(RuleType.boolean().optional())
  allowed?: boolean = true;  // 是否允许

  @Rule(RuleType.string().optional())
  description?: string;   // 权限描述
}
