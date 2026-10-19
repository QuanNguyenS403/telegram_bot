const fs = require('fs');
const { config } = require('../config');

let sheets = null;

function initSheetsClient() {
  if (sheets) return sheets;

  const { sheetId, credentialsPath } = config.googleSheets;

  if (!sheetId) {
    return null;
  }

  if (!fs.existsSync(credentialsPath)) {
    console.warn(`⚠️ Không tìm thấy file Google Service Account tại: ${credentialsPath}. Tính năng Google Sheets sẽ tạm tắt.`);
    return null;
  }

  try {
    const { google } = require('googleapis');
    const auth = new google.auth.GoogleAuth({
      keyFile: credentialsPath,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    sheets = google.sheets({ version: 'v4', auth });
    return sheets;
  } catch (err) {
    console.error('❌ Lỗi khởi tạo Google Sheets Client:', err.message);
    return null;
  }
}

/**
 * Đảm bảo các tab cơ bản (Raw_Data, AI_Reports) tồn tại và có tiêu đề cột
 */
async function ensureSheetsAndHeaders(client, spreadsheetId) {
  try {
    const res = await client.spreadsheets.get({ spreadsheetId });
    const existingTitles = res.data.sheets.map(s => s.properties.title);

    const requiredTabs = ['Raw_Data', 'AI_Reports'];
    const addRequests = [];

    for (const tab of requiredTabs) {
      if (!existingTitles.includes(tab)) {
        addRequests.push({
          addSheet: {
            properties: { title: tab }
          }
        });
      }
    }

    if (addRequests.length > 0) {
      await client.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: addRequests }
      });
    }

    // Đặt header nếu tab mới được tạo hoặc rỗng
    if (!existingTitles.includes('Raw_Data')) {
      await client.spreadsheets.values.update({
        spreadsheetId,
        range: 'Raw_Data!A1:G1',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[
            'Thời gian',
            'Nguồn dữ liệu',
            'Thương hiệu / Kênh',
            'Tiêu đề / Loại',
            'Chỉ số / Giá / Nền tảng',
            'Mô tả chi tiết / Caption',
            'Đường dẫn liên kết'
          ]]
        }
      });
    }

    if (!existingTitles.includes('AI_Reports')) {
      await client.spreadsheets.values.update({
        spreadsheetId,
        range: 'AI_Reports!A1:E1',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[
            'Thời gian',
            'Số SP Web mới',
            'Số TikTok Trend',
            'Số Meta Ads mới',
            'Nội dung Báo cáo Chiến lược AI'
          ]]
        }
      });
    }
  } catch (err) {
    // Không chặn luồng chính nếu lỗi kiểm tra header
    console.warn('⚠️ Ghi chú kiểm tra cấu trúc Google Sheets:', err.message);
  }
}

/**
 * Lưu dữ liệu thô và báo cáo phân tích AI vào Google Sheets
 */
async function saveToGoogleSheets(webData, socialData, metaAdsData, aiReport) {
  const client = initSheetsClient();
  const spreadsheetId = config.googleSheets.sheetId;

  if (!client || !spreadsheetId) {
    return null;
  }

  const today = new Date().toLocaleString('vi-VN', { timeZone: config.cron.timezone });
  const rawRows = [];

  // 1. Chuẩn hóa dữ liệu Sản phẩm Web
  webData.forEach(item => {
    rawRows.push([
      today,
      'Website (Shopify)',
      item.brand,
      item.title,
      `Giá: $${item.price} | Loại: ${item.type || 'N/A'}`,
      item.description || '',
      item.productUrl || ''
    ]);
  });

  // 2. Chuẩn hóa dữ liệu TikTok
  socialData.forEach(video => {
    rawRows.push([
      today,
      'TikTok Trend',
      video.author || 'TikToker',
      video.text?.slice(0, 100) || 'Video TikTok',
      `Views: ${video.views || 0} | Likes: ${video.likes || 0}`,
      video.text || '',
      video.url || ''
    ]);
  });

  // 3. Chuẩn hóa dữ liệu Meta Ads
  metaAdsData.forEach(ad => {
    rawRows.push([
      today,
      'Meta Ad Library',
      ad.brand,
      `[${ad.mediaType}] CTA: ${ad.ctaText}`,
      `Chạy từ: ${ad.startDate} | Nền tảng: ${(ad.platforms || []).join(', ')}`,
      ad.bodyText || '',
      ad.linkUrl || ''
    ]);
  });

  try {
    await ensureSheetsAndHeaders(client, spreadsheetId);

    // Ghi dữ liệu thô vào tab 'Raw_Data'
    if (rawRows.length > 0) {
      await client.spreadsheets.values.append({
        spreadsheetId,
        range: 'Raw_Data!A:G',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: rawRows,
        },
      });
    }

    // Ghi Báo cáo phân tích của AI vào tab 'AI_Reports'
    if (aiReport) {
      await client.spreadsheets.values.append({
        spreadsheetId,
        range: 'AI_Reports!A:E',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[
            today,
            webData.length,
            socialData.length,
            metaAdsData.length,
            aiReport
          ]],
        },
      });
    }

    return `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
  } catch (error) {
    console.error('❌ Lỗi khi ghi vào Google Sheets:', error.message);
    return null;
  }
}

module.exports = {
  saveToGoogleSheets,
};
