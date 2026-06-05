/**
 * 测试 IoT Video 鉴权接口（消费版 v20211125）
 *
 * 用法: npx ts-node test-iotvideo-auth.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import { existsSync } from 'fs';

const envPaths = [path.resolve(__dirname, '.env')];
for (const envPath of envPaths) {
  if (existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}

const secretId = process.env.TENCENT_CLOUD_SECRET_ID;
const secretKey = process.env.TENCENT_CLOUD_SECRET_KEY;
const region = process.env.TENCENT_CLOUD_REGION || 'ap-guangzhou';
const productId = process.env.TENCENT_IOT_VIDEO_PRODUCT_ID || '';

if (!secretId || !secretKey) {
  console.error('缺少 TENCENT_CLOUD_SECRET_ID 或 TENCENT_CLOUD_SECRET_KEY');
  process.exit(1);
}

async function main() {
  console.log('=== IoT Video 消费版 (v20211125) 鉴权测试 ===\n');
  console.log(`Region: ${region}, ProductId: ${productId}`);
  console.log(`SecretId: ${secretId?.substring(0, 8)}...`);

  const tencentcloud = await import('tencentcloud-sdk-nodejs-iotvideo');
  const BizClient = tencentcloud.iotvideo.v20211125.Client;

  const bizClient = new BizClient({
    credential: { secretId, secretKey },
    region,
  });

  const testUserId = 'test_user_001';
  const ttlMinutes = 60;

  // ========== 测试 1: DescribeUser（获取消费版账号信息） ==========
  console.log('\n========== 测试 1: DescribeUser ==========');
  try {
    const userResult = await bizClient.DescribeUser();
    console.log(`  Result: ${JSON.stringify(userResult, null, 2)}`);
    console.log('  >> 测试 1 通过');
  } catch (error: any) {
    console.error(`  >> 测试 1 失败: ${error.code} - ${error.message}`);
  }

  // ========== 测试 2: 通过 v20191126 版本号调 CreateAppUsr（用消费版 client） ==========
  console.log('\n========== 测试 2: CreateAppUsr via v20191126 version ==========');
  try {
    console.log(`  用 v20211125 client 发送 v20191126 版本的 CreateAppUsr`);
    const result = await (bizClient as any).request("CreateAppUsr", {
      CunionId: testUserId,
    }, "2019-11-26");

    console.log(`  AccessId:   ${result.AccessId}`);
    console.log(`  NewRegist:  ${result.NewRegist}`);
    console.log('  >> 测试 2 通过');
  } catch (error: any) {
    console.error(`  >> 测试 2 失败: ${error.code} - ${error.message}`);
  }

  // ========== 测试 3: CreateUsrToken（用消费版 client + v20191126 版本号） ==========
  console.log('\n========== 测试 3: CreateUsrToken via v20191126 version ==========');
  try {
    console.log(`  用 v20211125 client 发送 v20191126 版本的 CreateUsrToken`);
    const result = await (bizClient as any).request("CreateUsrToken", {
      AccessId: testUserId,
      UniqueId: `app_${testUserId}_${Date.now()}`,
      TtlMinutes: ttlMinutes,
    }, "2019-11-26");

    const now = Math.floor(Date.now() / 1000);
    console.log(`  AccessToken: ${result.AccessToken?.substring(0, 40)}...`);
    console.log(`  ExpireTime:  ${result.ExpireTime} (TTL: ${result.ExpireTime - now}s)`);
    console.log('  >> 测试 3 通过');
  } catch (error: any) {
    console.error(`  >> 测试 3 失败: ${error.code} - ${error.message}`);
  }

  // ========== 测试 3: DescribeProducts ==========
  console.log('\n========== 测试 3: DescribeProducts ==========');
  try {
    const prodResult: any = await bizClient.DescribeProducts({ Offset: 0, Limit: 5 });
    console.log(`  Total: ${prodResult?.Total}`);
    if (prodResult?.Products) {
      for (const p of prodResult.Products.slice(0, 3)) {
        console.log(`  - ProductId: ${p.ProductId}, Name: ${p.ProductName}`);
      }
    }
    console.log('  >> 测试 3 通过');
  } catch (error: any) {
    console.error(`  >> 测试 3 失败: ${error.code} - ${error.message}`);
  }
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
