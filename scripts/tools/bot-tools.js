#!/usr/bin/env node

/**
 * 🛠️ Bot工具集 - 开发和调试工具
 */

const commands = {
  'test': '运行测试: node tests/test-runner.js [type]',
  'debug': '调试播放: node scripts/tools/debug-playback.js', 
  'clean': '清理日志: rm -rf logs/* temp/*',
  'quick': '快速启动: npm run quick',
  'status': '检查状态: node scripts/tools/bot-status.js'
};

if (process.argv.length < 3) {
  console.log('🛠️ Bot工具集 - 可用命令:');
  Object.entries(commands).forEach(([cmd, desc]) => {
    console.log(`   ${cmd.padEnd(8)} - ${desc}`);
  });
  process.exit(0);
}

const command = process.argv[2];
if (commands[command]) {
  console.log(`🚀 执行: ${command}`);
  // 这里可以添加具体的命令执行逻辑
} else {
  console.log(`❌ 未知命令: ${command}`);
}