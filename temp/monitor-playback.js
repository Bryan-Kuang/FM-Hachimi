#!/usr/bin/env node

/**
 * 实时播放状态监控
 * 用于调试音频播放状态问题
 */

const { spawn } = require('child_process');

console.log('🔍 开始实时监控Discord机器人播放状态...\n');

// 监控机器人进程输出
const botProcess = spawn('npm', ['start'], { 
  stdio: ['inherit', 'pipe', 'pipe'],
  env: { ...process.env, NODE_ENV: 'development', LOG_LEVEL: 'debug' }
});

botProcess.stdout.on('data', (data) => {
  const output = data.toString();
  
  // 筛选播放相关的日志
  if (output.includes('Playing') || 
      output.includes('audio') || 
      output.includes('player') ||
      output.includes('voice') ||
      output.includes('FFmpeg') ||
      output.includes('resource')) {
    console.log('📊 [PLAYBACK]', output.trim());
  }
});

botProcess.stderr.on('data', (data) => {
  const output = data.toString();
  console.log('🚨 [ERROR]', output.trim());
});

botProcess.on('close', (code) => {
  console.log(`\n机器人进程退出，代码: ${code}`);
});

console.log('✅ 监控已启动，现在请在Discord中运行 /play 命令...');
console.log('按 Ctrl+C 停止监控\n');

process.on('SIGINT', () => {
  console.log('\n🛑 停止监控...');
  botProcess.kill();
  process.exit(0);
});
