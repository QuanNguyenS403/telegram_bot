const { validateConfig } = require('./src/config');
const { initBot } = require('./src/bot');

console.log('====================================================');
console.log('🚀 KHỞI ĐỘNG HỆ THỐNG AI SPY & MARKET RESEARCH BOT');
console.log('   Ngách: Đồ ngủ / Sleepwear / Loungewear');
console.log('====================================================');

// Kiểm tra biến môi trường
validateConfig();

// Khởi chạy Bot Telegram
const bot = initBot();

// Xử lý lỗi ngoại lệ toàn cục tránh crash process
process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ Unhandled Promise Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
});

// Xử lý tín hiệu tắt ứng dụng an toàn
process.on('SIGINT', () => {
  console.log('\n🛑 Đang dừng Bot...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Đang dừng Bot...');
  process.exit(0);
});
