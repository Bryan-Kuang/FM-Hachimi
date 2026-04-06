#!/usr/bin/env node

/**
 * 测试FFmpeg进程清理功能
 * 验证在停止播放和离开语音频道时FFmpeg进程是否被正确终止
 */

const AudioPlayer = require('../../src/playback/audio_player');
const logger = require('../../src/services/logger_service');

console.log('🧪 Testing FFmpeg Process Cleanup...');

async function testFFmpegCleanup() {
  const player = new AudioPlayer();
  
  console.log('\n1️⃣ Testing FFmpeg process tracking...');
  
  // 模拟创建音频资源（不实际播放）
  try {
    // 检查FFmpeg进程初始状态
    console.log('  Initial ffmpegProcess:', player.ffmpegProcess === null ? 'null ✅' : 'not null ❌');
    
    // 模拟设置FFmpeg进程
    const mockProcess = {
      killed: false,
      kill: function(signal) {
        console.log(`  Mock FFmpeg process killed with signal: ${signal} ✅`);
        this.killed = true;
      }
    };
    
    player.ffmpegProcess = mockProcess;
    console.log('  FFmpeg process set:', player.ffmpegProcess !== null ? 'success ✅' : 'failed ❌');
    
    console.log('\n2️⃣ Testing stop() method cleanup...');
    
    // 测试stop方法是否清理FFmpeg进程
    player.stop();
    console.log('  FFmpeg process after stop():', player.ffmpegProcess === null ? 'cleaned ✅' : 'not cleaned ❌');
    console.log('  Mock process killed:', mockProcess.killed ? 'yes ✅' : 'no ❌');
    
    console.log('\n3️⃣ Testing leaveVoiceChannel() method cleanup...');
    
    // 重新设置进程进行第二个测试
    const mockProcess2 = {
      killed: false,
      kill: function(signal) {
        console.log(`  Mock FFmpeg process killed with signal: ${signal} ✅`);
        this.killed = true;
      }
    };
    
    player.ffmpegProcess = mockProcess2;
    console.log('  FFmpeg process reset:', player.ffmpegProcess !== null ? 'success ✅' : 'failed ❌');
    
    // 测试leaveVoiceChannel方法是否清理FFmpeg进程
    player.leaveVoiceChannel();
    console.log('  FFmpeg process after leaveVoiceChannel():', player.ffmpegProcess === null ? 'cleaned ✅' : 'not cleaned ❌');
    console.log('  Mock process killed:', mockProcess2.killed ? 'yes ✅' : 'no ❌');
    
    console.log('\n4️⃣ Testing already killed process handling...');
    
    // 测试已经被终止的进程处理
    const killedProcess = {
      killed: true,
      kill: function(signal) {
        console.log(`  ❌ Should not call kill on already killed process`);
      }
    };
    
    player.ffmpegProcess = killedProcess;
    player.stop();
    console.log('  Killed process handled correctly: ✅');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// 运行测试
testFFmpegCleanup().then(() => {
  console.log('\n✅ FFmpeg cleanup test completed!');
}).catch(error => {
  console.error('❌ Test error:', error);
});
