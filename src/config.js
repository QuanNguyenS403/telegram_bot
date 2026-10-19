const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const config = {
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
  },
  supabase: {
    url: process.env.SUPABASE_URL || '',
    key: process.env.SUPABASE_KEY || '',
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
  },
  apify: {
    token: process.env.APIFY_TOKEN || '',
  },
  googleSheets: {
    sheetId: process.env.GOOGLE_SHEET_ID || '',
    credentialsPath: path.resolve(__dirname, '../google-credentials.json'),
  },
  cron: {
    schedule: process.env.CRON_SCHEDULE || '0 8 * * *',
    timezone: process.env.TIMEZONE || 'Asia/Ho_Chi_Minh',
  },
};

function validateConfig() {
  const missing = [];
  if (!config.telegram.botToken) missing.push('TELEGRAM_BOT_TOKEN (Tạo miễn phí từ @BotFather)');
  if (!config.gemini.apiKey) missing.push('GEMINI_API_KEY (Lấy miễn phí 100% tại aistudio.google.com)');

  if (missing.length > 0) {
    console.warn('⚠️ [CẢNH BÁO] Cần điền các khóa API miễn phí sau vào .env để bot chạy:');
    missing.forEach(item => console.warn(`   👉 ${item}`));
  }

  if (!config.supabase.url || !config.supabase.key) {
    console.log('ℹ️ [HOÀN TOÀN MIỄN PHÍ] Không có SUPABASE_URL: Bot đang tự động dùng Cơ sở dữ liệu Cục bộ (data/local_db.json) với 0 đồng chi phí.');
  }

  if (!config.apify.token) {
    console.log('ℹ️ [HOÀN TOÀN MIỄN PHÍ] Không có APIFY_TOKEN: Bot tự động dùng Google Fashion Trends RSS miễn phí.');
  }

  if (!config.googleSheets.sheetId) {
    console.log('ℹ️ [TÙY CHỌN] Chưa cấu hình GOOGLE_SHEET_ID: Báo cáo và Album ảnh sẽ được gửi trực tiếp 100% qua Telegram.');
  }

  return { isValid: missing.length === 0, missing };
}

module.exports = {
  config,
  validateConfig,
};
