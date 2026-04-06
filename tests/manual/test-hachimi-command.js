/**
 * Manual Test for Hachimi Command
 * Tests the /hachimi command functionality including Bilibili API integration
 */

const bilibiliApi = require('../../src/bilibili/api');
const logger = require('../../src/services/logger_service');

async function testBilibiliApi() {
  console.log('🧪 Testing Bilibili API...');
  
  try {
    // Test search functionality
    console.log('📡 Testing search for 哈基米 videos...');
    const videos = await bilibiliApi.searchVideos('哈基米', 1, 20);
    
    if (videos && videos.length > 0) {
      console.log(`✅ Found ${videos.length} videos`);
      
      // Display first few videos
      videos.slice(0, 3).forEach((video, index) => {
        console.log(`\n📹 Video ${index + 1}:`);
        console.log(`   Title: ${video.title}`);
        console.log(`   Author: ${video.author}`);
        console.log(`   Views: ${video.view.toLocaleString()}`);
        console.log(`   Likes: ${video.like.toLocaleString()}`);
        console.log(`   Duration: ${video.duration}`);
        console.log(`   URL: ${video.url}`);
      });
      
      // Test quality filtering
      console.log('\n🔍 Testing quality filtering...');
      const qualifiedVideos = bilibiliApi.filterQualityVideos(videos);
      console.log(`✅ Found ${qualifiedVideos.length} qualified videos out of ${videos.length} total`);
      
      if (qualifiedVideos.length > 0) {
        console.log('\n🎯 Top qualified videos:');
        qualifiedVideos.slice(0, 5).forEach((video, index) => {
          console.log(`   ${index + 1}. ${video.title} (${video.qualificationReason})`);
          console.log(`      Views: ${video.view.toLocaleString()}, Likes: ${video.like.toLocaleString()}, Rate: ${video.likeRate.toFixed(2)}%`);
        });
      }
      
    } else {
      console.log('❌ No videos found');
    }
    
  } catch (error) {
    console.error('❌ Bilibili API test failed:', error.message);
    console.error('Stack:', error.stack);
  }
}

async function testHachimiSearch() {
  console.log('\n🎵 Testing Hachimi-specific search...');
  
  try {
    const hachimiVideos = await bilibiliApi.searchHachimiVideos();
    
    if (hachimiVideos && hachimiVideos.length > 0) {
      console.log(`✅ Found ${hachimiVideos.length} qualified Hachimi videos`);
      
      hachimiVideos.forEach((video, index) => {
        console.log(`\n🍯 Hachimi Video ${index + 1}:`);
        console.log(`   Title: ${video.title}`);
        console.log(`   Author: ${video.author}`);
        console.log(`   Qualification: ${video.qualificationReason}`);
        console.log(`   Stats: ${video.view.toLocaleString()} views, ${video.like.toLocaleString()} likes (${video.likeRate.toFixed(2)}%)`);
      });
      
    } else {
      console.log('❌ No qualified Hachimi videos found');
    }
    
  } catch (error) {
    console.error('❌ Hachimi search test failed:', error.message);
  }
}

async function runTests() {
  console.log('🚀 Starting Hachimi Command Tests\n');
  
  await testBilibiliApi();
  await testHachimiSearch();
  
  console.log('\n✨ Hachimi tests completed!');
  console.log('\n📝 Next steps:');
  console.log('   1. Start the Discord bot: npm start');
  console.log('   2. Join a voice channel in Discord');
  console.log('   3. Use the /hachimi command');
  console.log('   4. Verify that 10 qualified videos are added to the queue');
}

// Run tests if this file is executed directly
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = {
  testBilibiliApi,
  testHachimiSearch,
  runTests
};
