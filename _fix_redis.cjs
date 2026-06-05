const fs = require('fs');
let content = fs.readFileSync('d:/Workspace/BabyMonitor/IOTCloudPlatform/test-recording-app-api.mjs', 'utf8');

// 1. Replace redis init block
const oldBlock = content.match(/console\.log\('\[Init\] 连接 Redis\.\.\.'\);[\s\S]*?console\.log\('  ✅ Redis 就绪'\);/);
if (oldBlock) {
  const newBlock = `console.log('[Init] 连接 Redis...');
const redis = require('redis').createClient({ host: REDIS.host, port: REDIS.port, password: REDIS.password || undefined });
await new Promise((resolve, reject) => {
  redis.on('ready', () => { console.log('  ✅ Redis 就绪'); resolve(); });
  redis.on('error', reject);
});
const redisSet = (key, val, ttl) => new Promise((res, rej) => redis.setex(key, ttl, val, (e, r) => e ? rej(e) : res(r)));
const redisDel = (key) => new Promise((res, rej) => redis.del(key, (e, r) => e ? rej(e) : res(r)));
const redisQuit = () => new Promise(res => redis.quit(() => res()));`;
  content = content.replace(oldBlock[0], newBlock);
}

// 2. Replace setEx calls
content = content.replace(/await redisClient\.setEx\(([^,]+),\s*(\d+),\s*(JSON\.stringify\([^)]+\))\)/g, 'await redisSet($1, $3, $2)');

// 3. Replace del calls
content = content.replace(/await redisClient\.del\(([^)]+)\)/g, 'await redisDel($1)');

// 4. Replace quit
content = content.replace('await redisClient.quit();', 'await redisQuit();');

// 5. Remove broken import line
content = content.replace(/const \{ default: \{ createClient \} \} = await import\("redis"\);\s*/g, '');

fs.writeFileSync('d:/Workspace/BabyMonitor/IOTCloudPlatform/test-recording-app-api.mjs', content, 'utf8');
console.log('Fixed');
