/**
 * 批量启动多个模拟设备
 * 用于测试平台的多设备处理能力
 */

const { spawn } = require('child_process');
const path = require('path');

// 设备配置
const devices = [
  { id: 'camera-001', type: 'camera', name: 'Living Room Camera' },
  { id: 'camera-002', type: 'camera', name: 'Bedroom Camera' },
  { id: 'camera-003', type: 'camera', name: 'Nursery Camera' },
  { id: 'screen-001', type: 'screen', name: 'Living Room Screen' },
  { id: 'screen-002', type: 'screen', name: 'Bedroom Screen' },
  { id: 'sensor-001', type: 'sensor', name: 'Temperature Sensor' },
  { id: 'sensor-002', type: 'sensor', name: 'Humidity Sensor' },
];

const runningProcesses = [];

/**
 * 启动单个设备
 */
function startDevice(device) {
  return new Promise((resolve) => {
    const process = spawn('node', ['mock-device.js', device.id], {
      cwd: __dirname,
      stdio: 'pipe',
    });

    // 为每个设备输出添加前缀
    const prefix = `[${device.id}]`;

    process.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      lines.forEach(line => {
        if (line.trim()) {
          console.log(`${prefix} ${line}`);
        }
      });
    });

    process.stderr.on('data', (data) => {
      const lines = data.toString().split('\n');
      lines.forEach(line => {
        if (line.trim()) {
          console.error(`${prefix} ERROR: ${line}`);
        }
      });
    });

    process.on('close', (code) => {
      console.log(`${prefix} Process exited with code ${code}`);
    });

    runningProcesses.push({ device, process });
    resolve(process);
  });
}

/**
 * 启动所有设备
 */
async function startAllDevices() {
  console.log('=======================================');
  console.log('  Starting Mock Devices');
  console.log('=======================================');
  console.log(`Total devices: ${devices.length}\n`);

  // 依次启动设备
  for (const device of devices) {
    console.log(`Starting ${device.name} (${device.id})...`);
    await startDevice(device);
    // 等待一小段时间再启动下一个设备
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('\n=======================================');
  console.log(`  All ${devices.length} devices started`);
  console.log('=======================================');
  console.log('\nPress Ctrl+C to stop all devices\n');
}

/**
 * 停止所有设备
 */
function stopAllDevices() {
  console.log('\n=======================================');
  console.log('  Stopping all devices...');
  console.log('=======================================');

  runningProcesses.forEach(({ device, process }) => {
    console.log(`Stopping ${device.id}...`);
    process.kill('SIGTERM');
  });

  setTimeout(() => {
    console.log('All devices stopped');
    process.exit(0);
  }, 2000);
}

// 主程序
startAllDevices().catch(err => {
  console.error('Error starting devices:', err);
  process.exit(1);
});

// 信号处理
process.on('SIGINT', stopAllDevices);
process.on('SIGTERM', stopAllDevices);
