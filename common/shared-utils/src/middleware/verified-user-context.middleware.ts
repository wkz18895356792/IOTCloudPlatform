import { Middleware } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { UserContextSigner } from '../service/user-context-signer';

/**
 * 已验证的用户上下文中间件
 *
 * 从 API Gateway 传递的 HTTP Headers 中提取用户信息，
 * 并验证 HMAC 签名以防止伪造。
 *
 * 行为：
 * - 若 USER_CONTEXT_SIGNING_SECRET 已配置：强制验证签名，失败返回 401
 * - 若未配置：直接信任 Header（向后兼容）
 */
@Middleware()
export class VerifiedUserContextMiddleware {
  resolve() {
    return async (ctx: Context, next: () => Promise<any>) => {
      const userId = ctx.get('X-User-ID');
      const userRole = ctx.get('X-User-Role');
      const username = ctx.get('X-User-Username');
      const sessionId = ctx.get('X-Session-Id');
      const token = ctx.get('X-User-Token');

      // 无用户上下文 Header → 未认证请求（如健康检查），直接放行
      if (!userId) {
        await next();
        return;
      }

      const signingSecret = process.env.USER_CONTEXT_SIGNING_SECRET;

      if (signingSecret) {
        // ---- 安全模式：验证签名 ----
        const signature = ctx.get('X-User-Context-Signature');
        const timestampStr = ctx.get('X-User-Context-Timestamp');

        if (!signature || !timestampStr) {
          ctx.status = 401;
          ctx.body = {
            success: false,
            code: 'USER_CONTEXT_SIGNATURE_MISSING',
            message: 'User context signature is required',
          };
          return;
        }

        const timestamp = parseInt(timestampStr, 10);
        if (isNaN(timestamp)) {
          ctx.status = 401;
          ctx.body = {
            success: false,
            code: 'USER_CONTEXT_INVALID_TIMESTAMP',
            message: 'Invalid user context timestamp',
          };
          return;
        }

        const result = UserContextSigner.verify(
          { userId, role: userRole, username, sessionId, token },
          timestamp,
          signature,
          signingSecret
        );

        if (!result.valid) {
          ctx.logger?.warn(
            `[VerifiedUserContext] Rejected: ${result.reason}, userId=${userId}, path=${ctx.path}`
          );
          ctx.status = 401;
          ctx.body = {
            success: false,
            code: result.reason === 'TIMESTAMP_EXPIRED'
              ? 'USER_CONTEXT_EXPIRED'
              : 'USER_CONTEXT_INVALID_SIGNATURE',
            message: result.reason === 'TIMESTAMP_EXPIRED'
              ? 'User context has expired'
              : 'User context signature is invalid',
          };
          return;
        }
      }
      // ---- else: 未配置密钥，旧模式直接信任（向后兼容）----

      // 设置用户上下文 — 与原中间件格式完全一致
      ctx.state.user = {
        userId,
        role: userRole,
        username,
        sessionId,
        token,
      };

      await next();
    };
  }
}
