const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const axios = require('axios');
const { config } = require('./config');
const { getAllTargets, addTarget, removeTarget } = require('./services/supabase');
const {
  scrapeWebsites,
  scrapeCustomWebsites,
  scrapeSocialTrends,
  scrapeMetaAds,
  fetchSocialPostMetadata,
} = require('./services/scrapers');
const { scoreAndFilterItems } = require('./services/signals');
const {
  enqueueBatch,
  processQueueBatch,
  getQueueStats,
  startQueueWorker,
  startWebhookServer,
} = require('./services/queue');
const {
  searchSimilarAnalyses,
  getRecentAnalyses,
  getAnalysesByBrand,
} = require('./services/vectorMemory');
const {
  analyzeAndGenerateReport,
  analyzeCustomPhoto,
  generateRetentionStrategy,
  generateCustomerInsight,
  spyAndAnalyzeMarketingContent,
  summarizeWeeklyTrends,
} = require('./services/gemini');
const { saveToGoogleSheets } = require('./services/sheets');

let bot = null;

/**
 * Gửi tin nhắn Markdown an toàn, nếu lỗi cú pháp entity thì tự động chuyển sang văn bản thường
 */
async function sendSafeMarkdown(chatId, text, options = {}) {
  if (!bot) return;
  try {
    return await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', ...options });
  } catch (err) {
    return await bot.sendMessage(chatId, text, { ...options });
  }
}

/**
 * ==========================================
 * GỬI ALBUM ẢNH SẢN PHẨM & ADS VÀO TELEGRAM
 * ==========================================
 */
async function sendVisualAlbums(targetChatId, webData, metaAdsData) {
  if (!bot) return;

  // 1. Gửi Album Sản phẩm mới từ Website đối thủ
  const productsWithImages = (webData || []).filter(
    item => item.imageUrl && item.imageUrl.startsWith('http')
  );

  if (productsWithImages.length > 0) {
    await sendSafeMarkdown(targetChatId, '👗 *ALBUM SẢN PHẨM ĐỒ NGỦ MỚI RA MẮT (SHOPIFY & WEB THUẦN):*');

    for (let i = 0; i < productsWithImages.length; i += 10) {
      const batch = productsWithImages.slice(i, i + 10);

      if (batch.length === 1) {
        const item = batch[0];
        const badge = item.badge || (item.sourceType === 'custom_web' ? '🌐 [Web Thuần]' : '🛍️ [Shopify]');
        await bot.sendPhoto(targetChatId, item.imageUrl, {
          caption: `${badge} *${item.brand}* - ${item.title}\n💰 Giá: ${item.price}\n🔗 [Xem sản phẩm](${item.productUrl})`,
          parse_mode: 'Markdown'
        }).catch(async () => {
          await bot.sendPhoto(targetChatId, item.imageUrl, {
            caption: `${badge} ${item.brand} - ${item.title}\nGiá: ${item.price}\nLink: ${item.productUrl}`
          }).catch(e => console.error('Lỗi gửi ảnh đơn:', e.message));
        });
      } else {
        const mediaGroup = batch.map(item => ({
          type: 'photo',
          media: item.imageUrl,
          caption: `🏷️ ${item.brand} - ${item.title} (${item.price})`
        }));

        await bot.sendMediaGroup(targetChatId, mediaGroup).catch(err => {
          console.error('Lỗi gửi Album sản phẩm:', err.message);
        });
      }
    }
  }

  // 2. Gửi Album Creative Quảng cáo từ Meta Ad Library
  const adsWithImages = (metaAdsData || []).filter(
    ad => ad.imageUrl && ad.imageUrl.startsWith('http')
  );

  if (adsWithImages.length > 0) {
    await sendSafeMarkdown(targetChatId, '📢 *ALBUM CREATIVE QUẢNG CÁO ĐỐI THỦ (META ADS):*');

    for (let i = 0; i < adsWithImages.length; i += 10) {
      const batch = adsWithImages.slice(i, i + 10);

      if (batch.length === 1) {
        const ad = batch[0];
        const badge = ad.badge || (ad.daysRunning >= 10 ? '🔥 [WINNING AD]' : '📢 [META AD]');
        const captionText = `${badge} *${ad.brand}* (${ad.mediaType})\n🎯 CTA: ${ad.ctaText}\n📝 "${ad.bodyText.slice(0, 150)}..."\n🔗 [Trang đích](${ad.linkUrl})`;
        await bot.sendPhoto(targetChatId, ad.imageUrl, {
          caption: captionText,
          parse_mode: 'Markdown'
        }).catch(async () => {
          await bot.sendPhoto(targetChatId, ad.imageUrl, {
            caption: `${ad.brand} (${ad.mediaType})\nCTA: ${ad.ctaText}\nCaption: ${ad.bodyText.slice(0, 150)}...\nLink: ${ad.linkUrl}`
          }).catch(e => console.error('Lỗi gửi ảnh Ad đơn:', e.message));
        });
      } else {
        const mediaGroup = batch.map(ad => ({
          type: 'photo',
          media: ad.imageUrl,
          caption: `🔥 ${ad.brand} (${ad.mediaType}) | CTA: ${ad.ctaText}`
        }));

        await bot.sendMediaGroup(targetChatId, mediaGroup).catch(err => {
          console.error('Lỗi gửi Album Ads:', err.message);
        });
      }
    }
  }
}

/**
 * ==========================================
 * LUỒNG CHẠY QUÉT DỮ LIỆU & BƠM VÀO HÀNG ĐỢI BẤT ĐỒNG BỘ
 * ==========================================
 */
async function runDailyTask(targetChatId) {
  if (!bot) return;

  await sendSafeMarkdown(
    targetChatId,
    '⏳ *Bắt đầu nhiệm vụ:* Đang quét Website đối thủ, Mạng xã hội và Meta Ad Library...'
  );

  try {
    const [shopifyData, customWebData, socialData, metaAdsData] = await Promise.all([
      scrapeWebsites(),
      scrapeCustomWebsites(),
      scrapeSocialTrends(),
      scrapeMetaAds()
    ]);

    const webData = [...shopifyData, ...customWebData];
    const totalNew = webData.length + socialData.length + metaAdsData.length;

    if (totalNew === 0) {
      await sendSafeMarkdown(
        targetChatId,
        '✅ *Hoàn thành kiểm tra:* Chưa có sản phẩm hay chiến dịch mới nào phát sinh so với cơ sở dữ liệu.'
      );
      return;
    }

    // 1. Chấm điểm Winning Signals ở tầng Middleware
    const scoredWeb = scoreAndFilterItems(webData, 'shopify');
    const scoredAds = scoreAndFilterItems(metaAdsData, 'meta_ads');
    const scoredSocial = scoreAndFilterItems(socialData, 'social');

    const allScoredItems = [...scoredWeb, ...scoredAds, ...scoredSocial];
    const winningCount = allScoredItems.filter(i => i.priority === 'HIGH').length;

    // 2. Đưa toàn bộ vào Hàng đợi Bất đồng bộ (Queue)
    const enqueued = await enqueueBatch(allScoredItems, 'scheduled_scan');

    await sendSafeMarkdown(
      targetChatId,
      `🔍 *Đã thu thập & chấm điểm:* ${allScoredItems.length} mục mới.\n🏆 *Phát hiện:* *${winningCount}* mục đạt chuẩn **[🔥 TÍN HIỆU CHIẾN THẮNG]**.\n📥 Đã đưa *${enqueued}* mục vào Hàng đợi Bất đồng bộ (Queue Worker đang giải phẫu tuần tự để bảo vệ tài nguyên).`
    );

    // 3. Gửi Album hình ảnh trực quan ngay lập tức
    await sendVisualAlbums(targetChatId, scoredWeb, scoredAds);

    // 4. Kích hoạt Worker giải phẫu ngay lô Winning Signals đầu tiên
    await sendSafeMarkdown(targetChatId, '⚙️ *Đang tiến hành giải phẫu các mục Winning Signals hàng đầu...*');
    await processQueueBatch(bot, targetChatId);

  } catch (error) {
    console.error('❌ Lỗi thực thi nhiệm vụ:', error);
    await sendSafeMarkdown(
      targetChatId,
      `❌ *Có lỗi xảy ra khi thực thi nhiệm vụ:* ${error.message}`
    );
  }
}

/**
 * ==========================================
 * KHỞI TẠO BOT & CÁC LỆNH ĐIỀU KHIỂN NÂNG CẤP
 * ==========================================
 */
function initBot() {
  if (!config.telegram.botToken) {
    console.error('❌ Không thể khởi động bot vì TELEGRAM_BOT_TOKEN còn trống trong .env.');
    return null;
  }

  bot = new TelegramBot(config.telegram.botToken, { polling: true });

  bot.on('polling_error', (error) => {
    console.error('⚠️ Lỗi kết nối Telegram Polling:', error.message);
  });

  // Lệnh /start & /help
  const handleHelp = (msg) => {
    const helpText = `
🤖 *BẢNG ĐIỀU KHIỂN CHIEF SLEEPWEAR INTELLIGENCE AI (V2)*
_Hệ thống Tình báo Cạnh tranh & Phân tích Chiến lược Đồ ngủ Chuyên sâu_

🏆 *TÍNH NĂNG MỚI (NÂNG CẤP V2)*:
• \`/trend_tuan\` - Báo cáo Tổng hợp Xu hướng Thị trường 7-14 ngày qua (Bóc tách dịch chuyển rập, chất liệu, màu sắc & góc marketing chiếm sóng).
• \`/so_sanh <Tên_Đối_Thủ>\` - So sánh chiến lược, giá & điểm mạnh/yếu của 1 đối thủ cụ thể so với thị trường.
• \`/tim_y_tuong <Mô tả mã hàng>\` - **Truy vấn Vector (Semantic Search)**: Tìm kiếm tương đồng trong kho dữ liệu đối thủ để gợi ý ngay *1 Core Insight* & *Ma trận 4 Góc tiếp cận*.
• \`/queue\` - Kiểm tra trạng thái Hàng đợi Bất đồng bộ (Async Queue Worker).

🕵️‍♂️ *SPY MARKETING & KỊCH BẢN VIDEO*:
• \`/spy <Link hoặc Nội dung>\` - Mổ xẻ 3s Hook, Visual Hook, Mạch giữ chân & Kịch bản Remix TikTok/Reels/Shorts.
• 💡 *Gợi ý*: Chỉ cần **dán trực tiếp link video TikTok/Reels** vào chat, bot sẽ tự động spy!

📸 *GIẢI PHẪU THỊ GIÁC & TỪ ĐIỂN KỸ THUẬT*:
• Gửi ảnh mẫu đồ ngủ: AI soi chiếu qua 2 lăng kính: *Garment & Pattern Anatomy* (cổ sen, ve lật, viền lé piping, cúc ngọc trai) và *Visual Art Direction* (ánh sáng warm cozy, concept phòng ngủ drap trắng).
• Gửi ảnh screenshot quảng cáo kèm chữ \`/spy\`: AI bóc tách bố cục visual và copywriting đối thủ.

🧠 *CHIẾN LƯỢC KÉO CHÂN & INSIGHT*:
• \`/insight <Chủ đề / Phân khúc>\` - Bóc tách Chân dung khách hàng & Động lực mua hàng cốt lõi
• \`/retention <Chủ đề / Sản phẩm>\` - Kế hoạch Membership Club, Ma trận Voucher & Quà tặng GWP

⚙️ *QUẢN LÝ NGUỒN CÀO & HỆ THỐNG*:
• \`/scan\` - Kích hoạt quét toàn bộ nguồn, lọc tín hiệu chiến thắng & bơm vào hàng đợi
• \`/list_brands\` - Xem danh sách đối thủ đang theo dõi
• \`/add_brand Tên | Link_Web\` - Thêm website đối thủ (Tự nhận diện Shopify/Web thuần)
• \`/add_site Tên | Link_Web\` - Thêm trực tiếp website HTML thuần
• \`/add_ad Tên | Link_Meta_Ads\` - Thêm nguồn quét Meta Ad Library
• \`/remove_brand <ID>\` - Xóa đối thủ theo mã số ID
• \`/id\` - Xem Chat ID Telegram của bạn
    `;
    sendSafeMarkdown(msg.chat.id, helpText);
  };

  bot.onText(/\/start/, handleHelp);
  bot.onText(/\/help/, handleHelp);

  // Lệnh /scan
  bot.onText(/\/scan/, (msg) => {
    runDailyTask(msg.chat.id);
  });

  // Lệnh /id
  bot.onText(/\/id/, (msg) => {
    sendSafeMarkdown(msg.chat.id, `Chat ID của bạn là: \`${msg.chat.id}\``);
  });

  // ==========================================
  // NÂNG CẤP 5: LỆNH /trend_tuan - TỔNG HỢP XU HƯỚNG BẰNG VECTOR
  // ==========================================
  bot.onText(/\/trend_tuan/, async (msg) => {
    await sendSafeMarkdown(msg.chat.id, '⏳ *Đang trích xuất dữ liệu từ Trí nhớ Dài hạn và phân tích xu hướng 14 ngày qua...*');
    try {
      const recent = await getRecentAnalyses(14, 25);
      if (!recent || recent.length === 0) {
        return sendSafeMarkdown(
          msg.chat.id,
          '📭 *Chưa có đủ dữ liệu lịch sử:* Hãy gõ `/scan` để thu thập và phân tích các đối thủ trước.'
        );
      }

      await sendSafeMarkdown(
        msg.chat.id,
        `📊 *Đã tổng hợp ${recent.length} chiến dịch/sản phẩm đối thủ gần nhất.* Đang lập Báo Cáo Xu Hướng Toàn Cảnh...`
      );

      const summary = await summarizeWeeklyTrends(recent);
      const chunks = summary.match(/[\s\S]{1,3900}/g) || [summary];
      for (const chunk of chunks) {
        await sendSafeMarkdown(msg.chat.id, chunk);
      }
    } catch (err) {
      console.error('❌ Lỗi /trend_tuan:', err.message);
      sendSafeMarkdown(msg.chat.id, `❌ Lỗi: ${err.message}`);
    }
  });

  // ==========================================
  // NÂNG CẤP 5: LỆNH /so_sanh [Tên_Đối_Thủ]
  // ==========================================
  bot.onText(/\/so_sanh(?: (.+))?/, async (msg, match) => {
    const brandName = match[1]?.trim();
    if (!brandName) {
      return sendSafeMarkdown(
        msg.chat.id,
        '⚠️ *Vui lòng nhập tên đối thủ cần so sánh!* Ví dụ:\n• `/so_sanh Eberjey`\n• `/so_sanh Cozy Earth`'
      );
    }

    await sendSafeMarkdown(msg.chat.id, `🔍 *Đang truy xuất lịch sử chiến dịch của "${brandName}" trong cơ sở dữ liệu...*`);
    try {
      const brandData = await getAnalysesByBrand(brandName, 10);
      if (!brandData || brandData.length === 0) {
        return sendSafeMarkdown(
          msg.chat.id,
          `⚠️ Chưa có dữ liệu phân tích nào cho thương hiệu *${brandName}*. Bạn có thể thêm link bằng lệnh \`/add_brand\` hoặc \`/scan\`.`
        );
      }

      const report = await summarizeWeeklyTrends(brandData);
      await sendSafeMarkdown(msg.chat.id, `📊 *KẾT QUẢ SO SÁNH & ĐÁNH GIÁ ĐỐI THỦ: ${brandName.toUpperCase()}*`);
      const chunks = report.match(/[\s\S]{1,3900}/g) || [report];
      for (const chunk of chunks) {
        await sendSafeMarkdown(msg.chat.id, chunk);
      }
    } catch (err) {
      sendSafeMarkdown(msg.chat.id, `❌ Lỗi so sánh: ${err.message}`);
    }
  });

  // ==========================================
  // NÂNG CẤP 5: LỆNH /tim_y_tuong [Mô tả hoặc Mã sản phẩm]
  // ==========================================
  bot.onText(/\/tim_y_tuong(?: (.+))?/, async (msg, match) => {
    const query = match[1]?.trim();
    if (!query) {
      return sendSafeMarkdown(
        msg.chat.id,
        '⚠️ *Vui lòng nhập mô tả hoặc mã hàng cần tìm ý tưởng!* Ví dụ:\n• `/tim_y_tuong Pijama lụa tay cộc quần dài cổ sen`\n• `/tim_y_tuong Váy ngủ 2 dây lụa phối ren gợi cảm`'
      );
    }

    await sendSafeMarkdown(
      msg.chat.id,
      `🧠 *Đang tìm kiếm tương đồng ngữ nghĩa (Vector Semantic Search) trong kho dữ liệu đối thủ cho:* "${query}"...`
    );

    try {
      const matches = await searchSimilarAnalyses(query, 3, 0.35);

      if (!matches || matches.length === 0) {
        return sendSafeMarkdown(
          msg.chat.id,
          '💡 *Chưa tìm thấy mẫu đối thủ nào tương đồng trong bộ nhớ vector.* Đang tạo ý tưởng mới trực tiếp từ Gemini...'
        );
      }

      let responseText = `🎯 *KHO Ý TƯỞNG THAM CHIẾU TỪ ĐỐI THỦ (TƯƠNG ĐỒNG CAO NHẤT):*\n\n`;
      matches.forEach((m, idx) => {
        responseText += `*Case Study ${idx + 1}: ${m.brand} - ${m.title}* (Độ khớp: ${Math.round(m.similarity * 100)}%)\n`;
        responseText += `🎯 *Core Insight đối thủ dùng:* "${m.core_insight || 'N/A'}"\n`;
        responseText += `📝 *Tóm tắt:* ${m.full_analysis.slice(0, 300)}...\n\n`;
      });
      responseText += `💡 _Sử dụng các góc tiếp cận trên để phát triển kịch bản và Lookbook cho sản phẩm của bạn!_`;

      const chunks = responseText.match(/[\s\S]{1,3900}/g) || [responseText];
      for (const chunk of chunks) {
        await sendSafeMarkdown(msg.chat.id, chunk);
      }
    } catch (err) {
      sendSafeMarkdown(msg.chat.id, `❌ Lỗi tìm ý tưởng: ${err.message}`);
    }
  });

  // ==========================================
  // NÂNG CẤP 2: LỆNH /queue - KIỂM TRA HÀNG ĐỢI
  // ==========================================
  bot.onText(/\/queue/, async (msg) => {
    try {
      const stats = await getQueueStats();
      const message = `
📊 *TRẠNG THÁI HÀNG ĐỢI BẤT ĐỒNG BỘ (ASYNC QUEUE):*
• ⏳ Đang chờ phân tích (Pending): *${stats.pending}*
• ⚙️ Đang xử lý (Processing): *${stats.processing}*
• ✅ Đã hoàn tất (Completed): *${stats.completed}*
• ❌ Lỗi xử lý (Failed): *${stats.failed}*
• 🏆 Mục đạt Winning Signal (High Priority): *${stats.highPrio}*

💡 _Queue Worker tự động chạy ngầm mỗi 2 phút, lấy 3-5 mục ưu tiên cao nhất để Gemini Vision phân tích mà không gây nghẽn hệ thống._
      `;
      sendSafeMarkdown(msg.chat.id, message);
    } catch (err) {
      sendSafeMarkdown(msg.chat.id, `❌ Lỗi: ${err.message}`);
    }
  });

  // Lệnh /list_brands
  bot.onText(/\/list_brands/, async (msg) => {
    try {
      const data = await getAllTargets();
      if (!data || data.length === 0) {
        return sendSafeMarkdown(msg.chat.id, '📭 Danh sách theo dõi hiện đang trống.');
      }

      let message = '📋 *DANH SÁCH ĐỐI THỦ & KÊNH ĐANG THEO DÕI:*\n\n';
      data.forEach(item => {
        let icon = '🛍️ [Shopify]';
        if (item.type === 'custom_web') icon = '🌐 [Web Thuần]';
        if (item.type === 'meta_ads') icon = '📢 [Meta Ads]';

        const status = item.is_active ? '✅' : '⏸️';
        message += `*ID: ${item.id}* | ${status} ${icon} *${item.name}*\n🔗 \`${item.url}\`\n\n`;
      });
      message += '💡 _Gõ_ `/remove_brand <ID>` _để xóa một mục._';

      sendSafeMarkdown(msg.chat.id, message, { disable_web_page_preview: true });
    } catch (err) {
      sendSafeMarkdown(msg.chat.id, `❌ Lỗi: ${err.message}`);
    }
  });

  // Lệnh /add_brand
  bot.onText(/\/add_brand (.+)/, async (msg, match) => {
    const input = match[1].split('|').map(s => s.trim());
    if (input.length < 2) {
      return sendSafeMarkdown(
        msg.chat.id,
        '⚠️ *Sai cú pháp!* Vui lòng nhập theo mẫu:\n`/add_brand Tên Thương Hiệu | https://domain.com`'
      );
    }

    const [name, rawUrl] = input;
    const cleanUrl = rawUrl.replace(/\/$/, '');
    await sendSafeMarkdown(msg.chat.id, `⏳ Đang kiểm tra loại website tại \`${cleanUrl}\`...`);

    let shopifyUrl = cleanUrl.includes('products.json') ? cleanUrl : `${cleanUrl}/products.json?limit=5`;
    let isShopify = false;

    try {
      const shopifyRes = await axios.get(shopifyUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        timeout: 8000
      });
      if (shopifyRes.data && Array.isArray(shopifyRes.data.products)) {
        isShopify = true;
      }
    } catch (e) {
      isShopify = false;
    }

    if (isShopify) {
      try {
        await addTarget('shopify', name, shopifyUrl);
        return sendSafeMarkdown(
          msg.chat.id,
          `✅ Nhận diện thành công **Shopify Store**!\nĐã thêm thương hiệu *${name}* vào danh sách quét hàng ngày.\n🔗 Endpoint: \`${shopifyUrl}\``
        );
      } catch (err) {
        return sendSafeMarkdown(msg.chat.id, `❌ Lỗi lưu dữ liệu: ${err.message}`);
      }
    }

    try {
      await axios.get(cleanUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        timeout: 10000
      });

      await addTarget('custom_web', name, cleanUrl);
      return sendSafeMarkdown(
        msg.chat.id,
        `✅ Nhận diện thành công **Website Code Thuần (Custom HTML)**!\nĐã thêm *${name}* vào danh sách bóc tách qua cấu trúc HTML/JSON-LD.\n🔗 URL: \`${cleanUrl}\``
      );
    } catch (err) {
      return sendSafeMarkdown(
        msg.chat.id,
        `❌ Không thể kết nối tới website \`${cleanUrl}\`: ${err.message}`
      );
    }
  });

  // Lệnh /add_site
  bot.onText(/\/add_site (.+)/, async (msg, match) => {
    const input = match[1].split('|').map(s => s.trim());
    if (input.length < 2) {
      return sendSafeMarkdown(
        msg.chat.id,
        '⚠️ *Sai cú pháp!* Vui lòng nhập theo mẫu:\n`/add_site Tên Website | https://domain.com`'
      );
    }

    const [name, rawUrl] = input;
    const cleanUrl = rawUrl.replace(/\/$/, '');

    await sendSafeMarkdown(msg.chat.id, `⏳ Đang kiểm tra kết nối tới trang web thuần \`${cleanUrl}\`...`);

    try {
      await axios.get(cleanUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        timeout: 10000
      });

      await addTarget('custom_web', name, cleanUrl);
      sendSafeMarkdown(
        msg.chat.id,
        `✅ Đã thêm website code thuần *${name}* vào danh sách quét hàng ngày!\n🔗 URL: \`${cleanUrl}\``
      );
    } catch (err) {
      sendSafeMarkdown(
        msg.chat.id,
        `❌ Không thể kết nối tới website \`${cleanUrl}\`: ${err.message}`
      );
    }
  });

  // Lệnh /add_ad
  bot.onText(/\/add_ad (.+)/, async (msg, match) => {
    const input = match[1].split('|').map(s => s.trim());
    if (input.length < 2) {
      return sendSafeMarkdown(
        msg.chat.id,
        '⚠️ *Sai cú pháp!* Vui lòng nhập theo mẫu:\n`/add_ad Tên Chiến Dịch | https://www.facebook.com/ads/library/...`'
      );
    }

    const [name, url] = input;
    try {
      await addTarget('meta_ads', name, url);
      sendSafeMarkdown(
        msg.chat.id,
        `✅ Đã thêm nguồn quảng cáo *${name}* vào danh sách theo dõi!`
      );
    } catch (error) {
      sendSafeMarkdown(msg.chat.id, `❌ Lỗi khi lưu vào cơ sở dữ liệu: ${error.message}`);
    }
  });

  // Lệnh /remove_brand
  bot.onText(/\/remove_brand (\d+)/, async (msg, match) => {
    const targetId = parseInt(match[1], 10);
    try {
      const data = await removeTarget(targetId);
      if (!data || data.length === 0) {
        return sendSafeMarkdown(msg.chat.id, `⚠️ Không tìm thấy mục nào có ID là *${targetId}*.`);
      }
      sendSafeMarkdown(msg.chat.id, `🗑️ Đã xóa *${data[0].name}* (ID: ${targetId}) khỏi danh sách theo dõi!`);
    } catch (err) {
      sendSafeMarkdown(msg.chat.id, `❌ Lỗi khi xóa: ${err.message}`);
    }
  });

  // Lệnh /retention
  bot.onText(/\/retention(?: (.+))?/, async (msg, match) => {
    const topic = match[1]?.trim() || 'Thương hiệu thời trang đồ ngủ thiết kế cao cấp tại Việt Nam';
    await sendSafeMarkdown(msg.chat.id, `🔄 *Đang phân tích Chiến lược Kéo chân & Membership VIP* cho: *${topic}*...`);

    try {
      const blueprint = await generateRetentionStrategy(topic);
      const chunks = blueprint.match(/[\s\S]{1,3900}/g) || [blueprint];
      for (const chunk of chunks) {
        await sendSafeMarkdown(msg.chat.id, chunk);
      }
    } catch (error) {
      sendSafeMarkdown(msg.chat.id, `❌ Lỗi: ${error.message}`);
    }
  });

  // Lệnh /insight
  bot.onText(/\/insight(?: (.+))?/, async (msg, match) => {
    const topic = match[1]?.trim() || 'Khách hàng mua đồ ngủ pijama lụa cao cấp';
    await sendSafeMarkdown(msg.chat.id, `🧠 *Đang mổ xẻ Insight Khách hàng & Tâm lý Tiêu dùng* cho: *${topic}*...`);

    try {
      const report = await generateCustomerInsight(topic);
      const chunks = report.match(/[\s\S]{1,3900}/g) || [report];
      for (const chunk of chunks) {
        await sendSafeMarkdown(msg.chat.id, chunk);
      }
    } catch (error) {
      sendSafeMarkdown(msg.chat.id, `❌ Lỗi: ${error.message}`);
    }
  });

  // Lệnh /spy
  bot.onText(/\/spy(?: (.+))?/, async (msg, match) => {
    const input = match[1]?.trim();
    if (!input) {
      return sendSafeMarkdown(
        msg.chat.id,
        '⚠️ *Vui lòng nhập link bài đăng hoặc nội dung cần spy!* Ví dụ:\n• `/spy https://vt.tiktok.com/...`\n• `/spy https://youtube.com/shorts/...`'
      );
    }
    await handleSpyContent(msg.chat.id, input);
  });

  async function handleSpyContent(chatId, input, customCaption = '') {
    await sendSafeMarkdown(chatId, '🕵️‍♂️ *Đang kết nối và bóc tách dữ liệu bài đăng/video từ đối thủ...*');

    try {
      const socialData = await fetchSocialPostMetadata(input);
      await sendSafeMarkdown(
        chatId,
        `🎯 Đã nhận diện: *${socialData.platform}*\n📌 Tiêu đề: *${socialData.title || 'N/A'}*\n🧠 Đang giải phẫu công thức Triệu View, 3s Hook và Ma trận 4 Góc tiếp cận...`
      );

      const analysis = await spyAndAnalyzeMarketingContent(socialData, customCaption);
      const chunks = analysis.match(/[\s\S]{1,3900}/g) || [analysis];
      for (const chunk of chunks) {
        await sendSafeMarkdown(chatId, chunk);
      }
    } catch (err) {
      console.error('❌ Lỗi Spy Content:', err.message);
      sendSafeMarkdown(chatId, `❌ Lỗi: ${err.message}`);
    }
  }

  // Tự động nhận diện link mạng xã hội
  bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;
    const text = msg.text.trim();
    const isSocialLink = /https?:\/\/(www\.)?(tiktok\.com|youtube\.com|youtu\.be|facebook\.com|fb\.watch|instagram\.com|pinterest\.com)\/[^\s]+/i.test(text);

    if (isSocialLink) {
      await handleSpyContent(msg.chat.id, text);
    }
  });

  // Nhận ảnh từ Telegram để phân tích theo Sleepwear Taxonomy & Multi-Angle
  bot.on('photo', async (msg) => {
    const chatId = msg.chat.id;
    const photoArray = msg.photo;
    if (!photoArray || photoArray.length === 0) return;

    const highestResPhoto = photoArray[photoArray.length - 1];
    const caption = msg.caption || '';
    const isSpyScreenshot = /spy|quảng cáo|ad|đối thủ|content/i.test(caption);

    if (isSpyScreenshot) {
      await sendSafeMarkdown(
        chatId,
        '🕵️‍♂️ *Phát hiện ảnh chụp màn hình bài đăng/quảng cáo của đối thủ! Đang phân tích Visual Hook, Bố cục & Thông điệp...*'
      );
      try {
        const fileUrl = await bot.getFileLink(highestResPhoto.file_id);
        const socialData = {
          platform: 'Ảnh Chụp Màn Hình Bài Đăng / Quảng Cáo Đối Thủ',
          title: caption || 'Screenshot bài đăng đối thủ',
          text: caption || 'Phân tích bố cục, visual hook, câu chữ hiển thị trên ảnh',
          thumbnailUrl: fileUrl,
          rawInput: caption
        };

        const analysis = await spyAndAnalyzeMarketingContent(socialData, caption);
        const chunks = analysis.match(/[\s\S]{1,3900}/g) || [analysis];
        for (const chunk of chunks) {
          await sendSafeMarkdown(chatId, chunk);
        }
      } catch (error) {
        sendSafeMarkdown(chatId, `❌ Lỗi: ${error.message}`);
      }
      return;
    }

    // Nếu là ảnh sản phẩm mẫu thông thường: Áp dụng Từ điển kỹ thuật đồ ngủ & 4 Góc tiếp cận
    await sendSafeMarkdown(
      chatId,
      '👁️ *Đang dùng Gemini Vision soi chi tiết rập may, bối cảnh chụp, insight khách hàng & Ma trận 4 góc tiếp cận cho mẫu này...*'
    );

    try {
      const fileUrl = await bot.getFileLink(highestResPhoto.file_id);
      const analysisText = await analyzeCustomPhoto(fileUrl, caption || null);

      const chunks = analysisText.match(/[\s\S]{1,3900}/g) || [analysisText];
      for (const chunk of chunks) {
        await sendSafeMarkdown(chatId, chunk);
      }
    } catch (error) {
      console.error('❌ Lỗi phân tích ảnh lẻ:', error.message);
      sendSafeMarkdown(chatId, `❌ Lỗi khi phân tích ảnh: ${error.message}`);
    }
  });

  // ==========================================
  // NÂNG CẤP 2: KHỞI ĐỘNG QUEUE WORKER & WEBHOOK SERVER
  // ==========================================
  startQueueWorker(bot, () => config.telegram.chatId, 120000);
  startWebhookServer(bot, () => config.telegram.chatId, process.env.WEBHOOK_PORT || 3005);

  // LẬP LỊCH TỰ ĐỘNG (CRON JOB)
  if (config.cron.schedule && config.telegram.chatId) {
    cron.schedule(config.cron.schedule, () => {
      console.log(`⏰ [CRON] Chạy báo cáo tự động lúc ${new Date().toLocaleTimeString()}...`);
      runDailyTask(config.telegram.chatId);
    }, {
      timezone: config.cron.timezone
    });
    console.log(`⏰ Đã kích hoạt lịch chạy tự động: "${config.cron.schedule}" (${config.cron.timezone}) gửi tới Chat ID: ${config.telegram.chatId}`);
  } else {
    console.warn('ℹ️ Chưa cấu hình TELEGRAM_CHAT_ID trong .env.');
  }

  console.log('🤖 Bot Telegram đã khởi động và sẵn sàng nhận nhiệm vụ!');
  return bot;
}

module.exports = {
  initBot,
  runDailyTask,
  sendSafeMarkdown,
  sendVisualAlbums,
};
