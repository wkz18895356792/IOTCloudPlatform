import { Controller, Get, Post, Put, Del, Body, Param, Query, Inject } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { ApiOperation, ApiResponse, ApiTags, ApiParam, ApiQuery, ApiBody } from '@midwayjs/swagger';
import { DeviceService } from '../service/device.service';
import { DeviceStatus, ProductType } from '../entity/device.entity';
import { PaginationParams, DeviceCommandType } from '@baby-monitor/shared-types';

/**
 * 设备控制器
 * 处理设备的增删改查、状态查询、命令发送等操作
 */
/**
 * 设备控制器
 *
 * 处理设备的增删改查、状态查询、命令发送等操作
 *
 * API端点：
 * - POST   /api/devices           - 创建设备
 * - GET    /api/devices           - 获取设备列表（分页）
 * - GET    /api/devices/:deviceId - 获取设备详情
 * - PUT    /api/devices/:deviceId - 更新设备信息
 * - DELETE /api/devices/:deviceId - 删除设备
 * - GET    /api/devices/:deviceId/state - 获取设备状态
 * - POST   /api/devices/:deviceId/command - 发送设备命令
 * - GET    /api/devices/:deviceId/online - 检查设备在线状态
 */
@ApiTags('设备管理')
@Controller('/api/devices')
export class DeviceController {
  @Inject()
  ctx!: Context;

  @Inject()
  deviceService!: DeviceService;

  /**
   * 创建设备
   * @description 创建新的设备记录，通常由设备自动注册或管理员添加
   */
  @Post('/')
  @ApiOperation({ summary: '创建设备', description: '创建新的设备记录，通常由设备自动注册或管理员添加' })
  @ApiResponse({
    status: 200,
    description: '创建成功，返回设备信息',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            deviceId: { type: 'string', example: 'device-123', description: '设备ID' },
            productType: { type: 'string', enum: ['CAMERA', 'MONITOR', 'SENSOR', 'GATEWAY'], example: 'CAMERA', description: '产品类型' },
            deviceName: { type: 'string', example: '卧室摄像头', description: '设备名称' },
            serialNumber: { type: 'string', example: 'SN20240101001', description: '序列号' },
            macAddress: { type: 'string', example: 'AA:BB:CC:DD:EE:FF', description: 'MAC地址' },
            firmwareVersion: { type: 'string', example: '1.0.0', description: '固件版本' },
            status: { type: 'string', enum: ['online', 'offline', 'error'], example: 'online', description: '设备状态' },
            lastOnline: { type: 'string', example: '2024-01-01T00:00:00.000Z', description: '最后在线时间' }
          }
        }
      }
    }
  })
  @ApiResponse({
    status: 400,
    description: '创建失败',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        error: {
          type: 'object',
          properties: {
            code: { type: 'string', example: 'CREATE_FAILED' },
            message: { type: 'string', example: '创建失败' }
          }
        }
      }
    }
  })
  @ApiBody({
    description: '设备信息',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        productType: { type: 'string', enum: ['CAMERA', 'MONITOR', 'SENSOR', 'GATEWAY'], description: '产品类型' },
        deviceName: { type: 'string', description: '设备名称' },
        serialNumber: { type: 'string', description: '序列号' },
        macAddress: { type: 'string', description: 'MAC地址' },
        firmwareVersion: { type: 'string', description: '固件版本' }
      },
      required: ['productType', 'deviceName']
    }
  })
  async createDevice(@Body() body: any) {
    // 从用户上下文获取 ownerId
    const ownerId = this.ctx.state?.user?.userId;

    // 映射字段名并设置默认值
    const deviceData = {
      name: body.deviceName || body.name,
      productType: body.productType,
      serialNumber: body.serialNumber,
      macAddress: body.macAddress,
      firmwareVersion: body.firmwareVersion || '1.0.0',
      productId: body.productId || 'default-product',
      protocol: body.protocol || 'private',
      ownerId: ownerId || body.ownerId,
      ...body,
    };

    const device = await this.deviceService.createDevice(deviceData);
    return {
      success: true,
      data: device,
    };
  }

  /**
   * 获取设备列表
   * @description 获取当前用户的设备列表，支持分页和排序
   */
  @Get('/')
  @ApiOperation({ summary: '获取设备列表', description: '获取当前用户的设备列表，支持分页和排序' })
  @ApiResponse({
    status: 200,
    description: '设备列表',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            list: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  deviceId: { type: 'string', example: 'device-123' },
                  productType: { type: 'string', enum: ['CAMERA', 'MONITOR', 'SENSOR', 'GATEWAY'], example: 'CAMERA' },
                  deviceName: { type: 'string', example: '卧室摄像头' },
                  serialNumber: { type: 'string', example: 'SN20240101001' },
                  status: { type: 'string', enum: ['online', 'offline', 'error'], example: 'online' },
                  lastOnline: { type: 'string', example: '2024-01-01T00:00:00.000Z' },
                  role: { type: 'string', enum: ['owner', 'view', 'control', 'manage'], example: 'owner', description: '用户对该设备的权限角色' },
                  sharedBy: { type: 'string', example: null, description: '分享来源用户ID（自有设备为null）' },
                }
              }
            },
            total: { type: 'number', example: 10, description: '总数' },
            page: { type: 'number', example: 1, description: '当前页' },
            pageSize: { type: 'number', example: 20, description: '每页数量' }
          }
        }
      }
    }
  })
  @ApiQuery({ name: 'page', description: '页码', required: false, example: 1 })
  @ApiQuery({ name: 'pageSize', description: '每页数量', required: false, example: 20 })
  @ApiQuery({ name: 'sortBy', description: '排序字段', required: false })
  @ApiQuery({ name: 'sortOrder', description: '排序方向（asc/desc）', required: false })
  async getDevices(@Query() query: any) {
    const userId = this.ctx.state.user.userId;
    const pagination: PaginationParams = {
      page: parseInt(query.page) || 1,
      pageSize: parseInt(query.pageSize) || 20,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    };

    const result = await this.deviceService.getUserDevices(userId, pagination);
    return {
      success: true,
      data: result,
    };
  }

  /**
   * 获取设备详情
   * @description 获取指定设备的详细信息
   */
  @Get('/:deviceId')
  @ApiOperation({ summary: '获取设备详情', description: '获取指定设备的详细信息' })
  @ApiResponse({
    status: 200,
    description: '设备详情',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            deviceId: { type: 'string', example: 'device-123' },
            productType: { type: 'string', enum: ['CAMERA', 'MONITOR', 'SENSOR', 'GATEWAY'], example: 'CAMERA' },
            deviceName: { type: 'string', example: '卧室摄像头' },
            serialNumber: { type: 'string', example: 'SN20240101001' },
            macAddress: { type: 'string', example: 'AA:BB:CC:DD:EE:FF' },
            firmwareVersion: { type: 'string', example: '1.0.0' },
            status: { type: 'string', enum: ['online', 'offline', 'error'], example: 'online' },
            lastOnline: { type: 'string', example: '2024-01-01T00:00:00.000Z' },
            properties: { type: 'object', example: {} }
          }
        }
      }
    }
  })
  @ApiResponse({
    status: 404,
    description: '设备不存在',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        error: {
          type: 'object',
          properties: {
            code: { type: 'string', example: 'DEVICE_NOT_FOUND' },
            message: { type: 'string', example: '设备不存在' }
          }
        }
      }
    }
  })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  async getDevice(@Param('deviceId') deviceId: string) {
    const device = await this.deviceService.getDevice(deviceId);
    if (!device) {
      return {
        success: false,
        error: {
          code: 'DEVICE_NOT_FOUND',
          message: 'Device not found',
        },
      };
    }
    return {
      success: true,
      data: device,
    };
  }

  /**
   * 更新设备信息
   * @description 更新设备的名称、位置等元信息
   */
  @Put('/:deviceId')
  @ApiOperation({ summary: '更新设备信息', description: '更新设备的名称、位置等元信息' })
  @ApiResponse({
    status: 200,
    description: '更新成功，返回设备信息',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            deviceId: { type: 'string', example: 'device-123' },
            deviceName: { type: 'string', example: '卧室摄像头' },
            location: { type: 'string', example: '卧室' }
          }
        }
      }
    }
  })
  @ApiResponse({
    status: 404,
    description: '设备不存在',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        error: {
          type: 'object',
          properties: {
            code: { type: 'string', example: 'DEVICE_NOT_FOUND' },
            message: { type: 'string', example: '设备不存在' }
          }
        }
      }
    }
  })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  @ApiBody({
    description: '更新的设备信息',
    required: false,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        deviceName: { type: 'string', description: '设备名称' },
        location: { type: 'string', description: '设备位置' }
      }
    }
  })
  async updateDevice(@Param('deviceId') deviceId: string, @Body() body: any) {
    const device = await this.deviceService.updateDevice(deviceId, body);
    if (!device) {
      return {
        success: false,
        error: {
          code: 'DEVICE_NOT_FOUND',
          message: 'Device not found',
        },
      };
    }
    return {
      success: true,
      data: device,
    };
  }

  /**
   * 删除设备
   * @description 删除指定的设备及其关联数据
   */
  @Del('/:deviceId')
  @ApiOperation({ summary: '删除设备', description: '删除指定的设备及其关联数据' })
  @ApiResponse({
    status: 200,
    description: '删除成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true }
      }
    }
  })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  async deleteDevice(@Param('deviceId') deviceId: string) {
    const success = await this.deviceService.deleteDevice(deviceId);
    return {
      success,
    };
  }

  /**
   * 获取设备状态
   * @description 获取设备的实时状态信息
   */
  @Get('/:deviceId/state')
  @ApiOperation({ summary: '获取设备状态', description: '获取设备的实时状态信息' })
  @ApiResponse({
    status: 200,
    description: '设备状态',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            power: { type: 'string', enum: ['on', 'off'], example: 'on', description: '电源状态' },
            recording: { type: 'boolean', example: true, description: '是否录制中' },
            motionDetected: { type: 'boolean', example: false, description: '是否检测到运动' },
            temperature: { type: 'number', example: 25.5, description: '温度（传感器设备）' },
            humidity: { type: 'number', example: 60, description: '湿度（传感器设备）' }
          }
        }
      }
    }
  })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  async getDeviceState(@Param('deviceId') deviceId: string) {
    const state = await this.deviceService.getDeviceState(deviceId);
    return {
      success: true,
      data: state || {},
    };
  }

  /**
   * 发送设备命令
   * @description 向设备发送控制命令，如开关、调节参数等
   */
  @Post('/:deviceId/command')
  @ApiOperation({ summary: '发送设备命令', description: '向设备发送控制命令，如开关、调节参数等' })
  @ApiResponse({
    status: 200,
    description: '命令发送成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            commandId: { type: 'string', example: 'cmd-123', description: '命令ID' },
            status: { type: 'string', enum: ['pending', 'success', 'failed'], example: 'success', description: '命令状态' }
          }
        }
      }
    }
  })
  @ApiResponse({
    status: 400,
    description: '命令发送失败',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        error: {
          type: 'object',
          properties: {
            code: { type: 'string', example: 'COMMAND_FAILED' },
            message: { type: 'string', example: '命令发送失败' }
          }
        }
      }
    }
  })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  @ApiBody({
    description: '命令内容',
    required: true,
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['POWER_ON', 'POWER_OFF', 'START_RECORD', 'STOP_RECORD', 'TAKE_SNAPSHOT', 'SET_RESOLUTION', 'SET_MOTION_DETECTION'],
          description: '命令类型'
        },
        payload: { type: 'object', description: '命令参数' },
        timeout: { type: 'number', description: '超时时间（毫秒）', example: 30000 }
      },
      required: ['type']
    }
  })
  async sendCommand(@Param('deviceId') deviceId: string, @Body() body: any) {
    try {
      const result = await this.deviceService.sendCommand(
        deviceId,
        body.type as DeviceCommandType,
        body.payload || {},
        body.timeout || 30000
      );
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'COMMAND_FAILED',
          message: (error as Error).message,
        },
      };
    }
  }

  /**
   * 检查设备在线状态
   * @description 检查设备是否在线
   */
  @Get('/:deviceId/online')
  @ApiOperation({ summary: '检查设备在线状态', description: '检查设备是否在线' })
  @ApiResponse({
    status: 200,
    description: '在线状态',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            online: { type: 'boolean', example: true, description: '是否在线' }
          }
        }
      }
    }
  })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  async isDeviceOnline(@Param('deviceId') deviceId: string) {
    const online = await this.deviceService.isDeviceOnline(deviceId);
    return {
      success: true,
      data: { online },
    };
  }

  /**
   * 检查用户是否有设备权限
   * @description 内部接口，供API网关调用，检查用户是否有指定设备的访问权限
   */
  @Get('/:deviceId/permissions/:userId')
  @ApiOperation({ summary: '检查设备权限', description: '内部接口，检查用户是否有设备访问权限' })
  @ApiResponse({
    status: 200,
    description: '权限检查结果',
    schema: {
      type: 'object',
      properties: {
        hasPermission: { type: 'boolean', example: true, description: '是否有权限' },
        role: { type: 'string', enum: ['owner', 'admin', 'viewer'], example: 'owner', description: '用户角色' }
      }
    }
  })
  @ApiResponse({
    status: 404,
    description: '设备不存在',
    schema: {
      type: 'object',
      properties: {
        error: { type: 'string', example: '设备不存在' }
      }
    }
  })
  @ApiParam({ name: 'deviceId', description: '设备ID', example: 'device-123' })
  @ApiParam({ name: 'userId', description: '用户ID', example: 'user-123' })
  async checkUserPermission(@Param('deviceId') deviceId: string, @Param('userId') userId: string) {
    const permission = await this.deviceService.checkUserPermission(deviceId, userId);
    return permission;
  }
}
