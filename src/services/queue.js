const http = require('http');
const fs = require('fs');
const path = require('path');
const { supabase } = require('./supabase');
const { scoreAndFilterItems } = require('./signals');
const { analyzeSingleItemDeepDive } = require('./gemini');
const { saveAnalysisEmbedding } = require('./vectorMemory');
const { saveToGoogleSheets } = require('./sheets');
const { config } = require('../config');

const localDbPath = path.resolve(__dirname, '../../data/local_db.json');

function getLocalDb() {
  try {
    if (!fs.existsSync(localDbPath)) {
      return { tracked_targets: [], scraped_items: [], scraping_queue: [], analysis_embeddings: [] };
    }
    const data = JSON.parse(fs.readFileSync(localDbPath, 'utf-8'));
    data.scraping_queue = data.scraping_queue || [];
    return data;
  } catch (err) {
    return { tracked_targets: [], scraped_items: [], scraping_queue: [], analysis_embeddings: [] };
  }
}

function saveLocalDb(data) {
  try {
    fs.writeFileSync(localDbPath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('❌ Lỗi ghi Local DB Queue:', err.message);
  }
}

/**
 * ========================================================
 * 1. QUẢN LÝ HÀNG ĐỢI (SCRAPING QUEUE MANAGER)
 * ========================================================
 */

/**
 * Đưa 1 danh sách item đã được chấm điểm vào hàng đợi (Pending)
 */
async function enqueueBatch(items, source = 'website') {
  if (!Array.isArray(items) || items.length === 0) return 0;

  // Lọc và chấm điểm tín hiệu chiến thắng trước khi vào queue
  const scoredItems = scoreAndFilterItems(items, source);
  let enqueuedCount = 0;

  for (const item of scoredItems) {
    const externalId = item.externalId || `${source}_${item.id || Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const record = {
      source: item.sourceType || source,
      external_id: externalId,
      brand: item.brand || 'Đối thủ',
      title: item.title || 'Mã đồ ngủ',
      winning_score: item.winningScore || 0,
      priority: item.priority || 'LOW',
      signal_reason: item.signalReason || 'Chưa có',
      raw_data: item,
      status: 'pending',
      attempts: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (supabase) {
      try {
        const { error } = await supabase
          .from('scraping_queue')
          .upsert(record, { onConflict: 'external_id' });

        if (!error) {
          enqueuedCount++;
          continue;
        }
      } catch (err) {
        // Fallback
      }
    }

    // Local DB fallback
    const local = getLocalDb();
    const existingIndex = local.scraping_queue.findIndex(q => q.external_id === externalId);
    if (existingIndex >= 0) {
      if (local.scraping_queue[existingIndex].status === 'pending') {
        local.scraping_queue[existingIndex] = { ...local.scraping_queue[existingIndex], ...record };
      }
    } else {
      local.scraping_queue.push({
        id: local.scraping_queue.length + 1,
        ...record
      });
      enqueuedCount++;
    }
    saveLocalDb(local);
  }

  console.log(`📥 [Hàng Đợi] Đã nạp ${enqueuedCount} mục vào hàng đợi bất đồng bộ.`);
  return enqueuedCount;
}

/**
 * Lấy danh sách item đang chờ (Ưu tiên điểm Winning Signal cao nhất trước)
 */
async function fetchPendingBatch(limit = 3) {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('scraping_queue')
        .select('*')
        .eq('status', 'pending')
        .order('winning_score', { ascending: false })
        .order('created_at', { ascending: true })
        .limit(limit);

      if (!error && Array.isArray(data) && data.length > 0) {
        return data;
      }
    } catch (err) {
      // Fallback
    }
  }

  const local = getLocalDb();
  return (local.scraping_queue || [])
    .filter(q => q.status === 'pending')
    .sort((a, b) => (b.winning_score || 0) - (a.winning_score || 0))
    .slice(0, limit);
}

/**
 * Cập nhật trạng thái của 1 bản ghi trong queue
 */
async function updateQueueStatus(id, externalId, status, analysisResult = null, errorMessage = null) {
  const updateData = {
    status,
    analysis_result: analysisResult,
    error_message: errorMessage,
    updated_at: new Date().toISOString()
  };

  if (supabase) {
    try {
      await supabase
        .from('scraping_queue')
        .update(updateData)
        .eq('external_id', externalId);
      return;
    } catch (err) {
      // Fallback
    }
  }

  const local = getLocalDb();
  const item = local.scraping_queue.find(q => q.external_id === externalId || q.id === id);
  if (item) {
    Object.assign(item, updateData);
    saveLocalDb(local);
  }
}

/**
 * Thống kê hiện trạng hàng đợi
 */
async function getQueueStats() {
  if (supabase) {
    try {
      const { data } = await supabase
        .from('scraping_queue')
        .select('status, priority');

      if (data) {
        const stats = { pending: 0, processing: 0, completed: 0, failed: 0, highPrio: 0 };
        data.forEach(d => {
          if (stats[d.status] !== undefined) stats[d.status]++;
          if (d.priority === 'HIGH') stats.highPrio++;
        });
        return stats;
      }
    } catch (err) {}
  }

  const local = getLocalDb();
  const stats = { pending: 0, processing: 0, completed: 0, failed: 0, highPrio: 0 };
  (local.scraping_queue || []).forEach(d => {
    if (stats[d.status] !== undefined) stats[d.status]++;
    if (d.priority === 'HIGH') stats.highPrio++;
  });
  return stats;
}

/**
 * ========================================================
 * 2. TIẾN TRÌNH XỬ LÝ THEO LÔ (BATCH WORKER)
 * Chạy mỗi 2-3 phút, lấy 3-5 item để Gemini Vision phân tích
 * ========================================================
 */
let isWorkerBusy = false;

async function processQueueBatch(bot, targetChatId) {
  if (isWorkerBusy) return { processed: 0, status: 'busy' };
  isWorkerBusy = true;

  try {
    const pendingItems = await fetchPendingBatch(3);
    if (!pendingItems || pendingItems.length === 0) {
      return { processed: 0, status: 'empty' };
    }

    console.log(`⚙️ [Queue Worker] Bắt đầu xử lý lô ${pendingItems.length} mục từ hàng đợi...`);

    for (const record of pendingItems) {
      const itemData = record.raw_data || record;
      itemData.priority = record.priority;
      itemData.winningScore = record.winning_score;
      itemData.signalReason = record.signal_reason;

      // 1. Đánh dấu đang xử lý
      await updateQueueStatus(record.id, record.external_id, 'processing');

      try {
        // 2. Gửi ảnh đơn/album vào Telegram trước (nếu có)
        if (bot && targetChatId && itemData.imageUrl) {
          const badge = itemData.priority === 'HIGH' ? '🔥 [WINNING SIGNAL]' : '🔍 [THEO DÕI]';
          await bot.sendPhoto(targetChatId, itemData.imageUrl, {
            caption: `${badge} *${itemData.brand}* - ${itemData.title}\n💰 Giá: ${itemData.price || 'N/A'}\n🎯 Tín hiệu: ${itemData.signalReason || 'Dữ liệu mới'}\n🔗 [Xem gốc](${itemData.productUrl || itemData.linkUrl || itemData.url || ''})`,
            parse_mode: 'Markdown'
          }).catch(() => {});
        }

        // 3. Phân tích chuyên sâu bằng Gemini Vision theo Từ điển kỹ thuật đồ ngủ & 4 Góc tiếp cận
        const { fullReport, coreInsight } = await analyzeSingleItemDeepDive(itemData);

        // 4. Lưu bản phân tích và tạo Vector Embedding (Trí nhớ dài hạn)
        await saveAnalysisEmbedding({
          queue_id: record.id,
          source: record.source,
          brand: record.brand,
          title: record.title,
          winning_score: record.winning_score,
          priority: record.priority,
          core_insight: coreInsight,
          full_analysis: fullReport
        });

        // 5. Lưu vào Google Sheets (nếu đã cấu hình)
        try {
          await saveToGoogleSheets([itemData], [], [], fullReport);
        } catch (e) {}

        // 6. Gửi báo cáo chi tiết về Telegram (chia nhỏ < 3900 ký tự)
        if (bot && targetChatId) {
          const chunks = fullReport.match(/[\s\S]{1,3900}/g) || [fullReport];
          for (const chunk of chunks) {
            await bot.sendMessage(targetChatId, chunk, { parse_mode: 'Markdown' }).catch(async () => {
              await bot.sendMessage(targetChatId, chunk).catch(() => {});
            });
          }
        }

        // 7. Hoàn tất bản ghi
        await updateQueueStatus(record.id, record.external_id, 'completed', fullReport);
        console.log(`✅ [Queue Worker] Hoàn tất phân tích mục: ${record.brand} - ${record.title}`);

      } catch (err) {
        console.error(`❌ [Queue Worker] Lỗi phân tích mục ${record.brand}:`, err.message);
        await updateQueueStatus(record.id, record.external_id, 'failed', null, err.message);
      }
    }

    return { processed: pendingItems.length, status: 'success' };
  } finally {
    isWorkerBusy = false;
  }
}

/**
 * Khởi động Queue Worker chạy định kỳ
 */
function startQueueWorker(bot, getChatIdFn, intervalMs = 120000) {
  console.log(`⏱️ Đã kích hoạt Queue Worker chạy ngầm mỗi ${Math.round(intervalMs / 1000)} giây (Xử lý 3-5 item/lần).`);

  // Chạy ngay 1 lần sau 5 giây khởi động
  setTimeout(() => {
    const chatId = typeof getChatIdFn === 'function' ? getChatIdFn() : getChatIdFn;
    if (chatId) processQueueBatch(bot, chatId);
  }, 5000);

  // Lặp lại định kỳ
  setInterval(() => {
    const chatId = typeof getChatIdFn === 'function' ? getChatIdFn() : getChatIdFn;
    if (chatId) processQueueBatch(bot, chatId);
  }, intervalMs);
}

/**
 * ========================================================
 * 3. MÁY CHỦ WEBHOOK (APIFY & EXTERNAL CRAWLERS)
 * Endpoint: POST /api/webhook/apify
 * ========================================================
 */
function startWebhookServer(bot, getChatIdFn, port = 3000) {
  const server = http.createServer(async (req, res) => {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // GET /health hoặc /api/queue/status
    if (req.method === 'GET' && (req.url === '/health' || req.url === '/api/queue/status')) {
      const stats = await getQueueStats();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'online',
        uptime: process.uptime(),
        queue: stats,
        timestamp: new Date().toISOString()
      }));
      return;
    }

    // POST /api/webhook/apify
    if (req.method === 'POST' && req.url === '/api/webhook/apify') {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });

      req.on('end', async () => {
        try {
          const payload = JSON.parse(body || '{}');
          // Apify có thể gửi array dataset hoặc object chứa datasetItems
          const items = Array.isArray(payload) 
            ? payload 
            : (Array.isArray(payload.items) ? payload.items : [payload]);

          const count = await enqueueBatch(items, 'apify_webhook');

          // Thông báo về Telegram nếu có mục mới
          const chatId = typeof getChatIdFn === 'function' ? getChatIdFn() : getChatIdFn;
          if (bot && chatId && count > 0) {
            bot.sendMessage(
              chatId,
              `⚡ *[Webhook Apify]* Nhận thành công *${count}* dữ liệu mới từ Apify!\n📥 Đã đưa vào Hàng đợi Bất đồng bộ để Worker phân tích tuần tự.`
            ).catch(() => {});
          }

          // Kích hoạt ngay Queue Worker để xử lý
          if (bot && chatId) {
            processQueueBatch(bot, chatId);
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, enqueued: count }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  let currentPort = parseInt(port, 10) || 3005;

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`⚠️ Port ${currentPort} đã bị ứng dụng khác sử dụng, tự động chuyển sang port ${currentPort + 1}...`);
      currentPort++;
      server.listen(currentPort);
    } else {
      console.error('❌ Lỗi Webhook Server:', err.message);
    }
  });

  server.listen(currentPort, () => {
    console.log(`🌐 Máy chủ Webhook Apify đã sẵn sàng tại port ${currentPort} (Endpoint: POST /api/webhook/apify)`);
  });

  return server;
}

module.exports = {
  enqueueBatch,
  fetchPendingBatch,
  updateQueueStatus,
  getQueueStats,
  processQueueBatch,
  startQueueWorker,
  startWebhookServer,
};
