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
const {
  analyzeAndGenerateReport,
  analyzeCustomPhoto,
  generateRetentionStrategy,
  generateCustomerInsight,
  spyAndAnalyzeMarketingContent,
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
    // Nếu lỗi Markdown parsing của Telegram, fallback gửi plain text
    return await bot.sendMessage(chatId, text, { ...options });
  }
}

/**
 * ==========================================
 * BƯỚC C3: HÀM GỬI ALBUM ẢNH SẢN PHẨM & ADS VÀO TELEGRAM
 * ==========================================
 */
async function sendVisualAlbums(targetChatId, webData, metaAdsData) {
  if (!bot) return;

  // 1. Gửi Album Sản phẩm mới từ Website đối thủ (Shopify & Web Thuần)
  const productsWithImages = (webData || []).filter(
    item => item.imageUrl && item.imageUrl.startsWith('http')
  );

  if (productsWithImages.length > 0) {
    await sendSafeMarkdown(targetChatId, '👗 *ALBUM SẢN PHẨM ĐỒ NGỦ MỚI RA MẮT (SHOPIFY & WEB THUẦN):*');

    for (let i = 0; i < productsWithImages.length; i += 10) {
      const batch = productsWithImages.slice(i, i + 10);

      if (batch.length === 1) {
        const item = batch[0];
        const badge = item.sourceType === 'custom_web' ? '🌐 [Web Thuần]' : '🛍️ [Shopify]';
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
        const captionText = `🔥 *${ad.brand}* (${ad.mediaType})\n🎯 CTA: ${ad.ctaText}\n📝 "${ad.bodyText.slice(0, 150)}..."\n🔗 [Trang đích](${ad.linkUrl})`;
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
 * BƯỚC D: LUỒNG CHẠY TASK CHÍNH & BÁO CÁO TELEGRAM
 * ==========================================
 */
async function runDailyTask(targetChatId) {
  if (!bot) return;

  await sendSafeMarkdown(
    targetChatId,
    '⏳ *Bắt đầu nhiệm vụ:* Đang quét Website đối thủ (Shopify & Web thuần), Thị trường Trends và Meta Ad Library...'
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

    await sendSafeMarkdown(
      targetChatId,
      `🔍 Đã thu thập được: *${shopifyData.length}* sản phẩm Shopify, *${customWebData.length}* sản phẩm Web thuần, *${socialData.length}* thông tin xu hướng, và *${metaAdsData.length}* chiến dịch Meta Ads.\n🖼️ Đang gửi Album hình ảnh và phân tích bằng Gemini Vision...`
    );

    // 1. Gửi Album hình ảnh trực quan trước để quan sát mẫu mã ngay
    await sendVisualAlbums(targetChatId, webData, metaAdsData);

    // 2. Phân tích đa phương thức bằng Gemini AI
    const aiReport = await analyzeAndGenerateReport(webData, socialData, metaAdsData);

    // 3. Lưu vào Google Sheets (nếu đã cấu hình)
    const sheetUrl = await saveToGoogleSheets(webData, socialData, metaAdsData, aiReport);

    // 4. Gửi báo cáo phân tích về Telegram (chia nhỏ nếu > 3900 ký tự)
    await sendSafeMarkdown(targetChatId, '📊 *BÁO CÁO PHÂN TÍCH CHIẾN LƯỢC TỪ AI:*');
    const chunks = aiReport.match(/[\s\S]{1,3900}/g) || [aiReport];

    for (const chunk of chunks) {
      await sendSafeMarkdown(targetChatId, chunk);
    }

    // 5. Gửi kèm đường link mở bảng Google Sheets ở cuối tin nhắn
    if (sheetUrl) {
      await sendSafeMarkdown(
        targetChatId,
        `📁 *Dữ liệu chi tiết và link gốc đã được lưu vào Google Sheets:*\n[👉 Bấm vào đây để mở bảng dữ liệu](${sheetUrl})`,
        { disable_web_page_preview: true }
      );
    }

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
 * KHỞI TẠO BOT & CÁC LỆNH ĐIỀU KHIỂN
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
🤖 *BẢNG ĐIỀU KHIỂN BOT AI SPY & MARKETING NGHÀNH THỜI TRANG ĐỒ NGỦ*

🕵️‍♂️ *SPY MARKETING CONTENT ĐỐI THỦ (MỚI NHẤT)*:
• \`/spy <Link hoặc Nội dung>\` - Phẫu thuật công thức Triệu View, 3s Hook, Mạch giữ chân & Kịch bản Remix TikTok/Reels từ đối thủ (Hỗ trợ link TikTok, Reels, Shorts, Meta Ads, Pinterest, hoặc paste kịch bản).
• 💡 *Gợi ý nhanh*: Bạn chỉ cần **dán trực tiếp link video TikTok/Reels** vào chat, bot sẽ tự động spy ngay!

🧠 *INSIGHT & CHIẾN LƯỢC KÉO CHÂN KHÁCH HÀNG*:
• \`/insight <Chủ đề / Phân khúc>\` - Bóc tách Chân dung khách hàng, Động lực mua hàng ẩn giấu & Nỗi sợ rào cản
• \`/retention <Chủ đề / Sản phẩm>\` - Kế hoạch Membership Club, Ma trận Voucher kéo chân & Quà tặng GWP

📸 *PHÂN TÍCH HÌNH ẢNH TRỰC DIỆN*:
• Gửi ảnh mẫu đồ ngủ: AI soi rập, bối cảnh chụp, insight khách hàng & đề xuất combo voucher.
• Gửi ảnh chụp màn hình bài post/quảng cáo kèm chữ \`/spy\`: AI bóc tách hình ảnh visual hook & copy quảng cáo của đối thủ!

⚙️ *QUẢN LÝ NGUỒN CÀO DỮ LIỆU*:
• \`/scan\` - Kích hoạt quét toàn bộ các nguồn và xuất báo cáo AI ngay
• \`/list_brands\` - Xem danh sách thương hiệu (Shopify & Web thuần) đang theo dõi
• \`/add_brand Tên | Link_Web\` - Thêm website đối thủ (Tự nhận diện Shopify hoặc Web thuần)
• \`/add_site Tên | Link_Web\` - Thêm trực tiếp website code index thuần HTML
• \`/add_ad Tên | Link_Meta_Ads\` - Thêm đường dẫn quét Meta Ad Library
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

  // 1. Lệnh /list_brands: Xem danh sách theo dõi
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

  // 2. Lệnh /add_brand: Thông minh tự nhận diện Shopify hoặc Web Thuần (HTML)
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

  // 3. Lệnh /add_site: Thêm trực tiếp website code index thuần không qua Shopify
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

  // 4. Lệnh /add_ad: Thêm đường dẫn theo dõi Meta Ad Library
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

  // 5. Lệnh /remove_brand: Xóa đối thủ theo ID
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

  // 6. Lệnh /retention - Tư vấn chiến lược Membership, Voucher & Kéo chân khách hàng
  bot.onText(/\/retention(?: (.+))?/, async (msg, match) => {
    const topic = match[1]?.trim() || 'Thương hiệu thời trang đồ ngủ thiết kế cao cấp tại Việt Nam';

    await sendSafeMarkdown(
      msg.chat.id,
      `🔄 *Đang phân tích và xây dựng Chiến lược Kéo chân Khách hàng (Retention & Loyalty)* cho: *${topic}*...`
    );

    try {
      const blueprint = await generateRetentionStrategy(topic);
      const chunks = blueprint.match(/[\s\S]{1,3900}/g) || [blueprint];

      for (const chunk of chunks) {
        await sendSafeMarkdown(msg.chat.id, chunk);
      }
    } catch (error) {
      console.error('❌ Lỗi tạo Retention Strategy:', error.message);
      sendSafeMarkdown(msg.chat.id, `❌ Lỗi: ${error.message}`);
    }
  });

  // 7. Lệnh /insight - Bóc tách Chân dung khách hàng & Động lực mua hàng
  bot.onText(/\/insight(?: (.+))?/, async (msg, match) => {
    const topic = match[1]?.trim() || 'Khách hàng mua đồ ngủ pijama lụa cao cấp';

    await sendSafeMarkdown(
      msg.chat.id,
      `🧠 *Đang mổ xẻ Insight Khách hàng & Tâm lý Tiêu dùng* cho phân khúc: *${topic}*...`
    );

    try {
      const report = await generateCustomerInsight(topic);
      const chunks = report.match(/[\s\S]{1,3900}/g) || [report];

      for (const chunk of chunks) {
        await sendSafeMarkdown(msg.chat.id, chunk);
      }
    } catch (error) {
      console.error('❌ Lỗi phân tích Customer Insight:', error.message);
      sendSafeMarkdown(msg.chat.id, `❌ Lỗi: ${error.message}`);
    }
  });

  // 8. KỸ NĂNG MỚI: Lệnh /spy - Bóc tách Marketing Content, Hook & Kịch bản Remix từ đối thủ
  // Cú pháp: /spy <Link TikTok/FB/Instagram/YouTube Shorts hoặc Text nội dung>
  bot.onText(/\/spy(?: (.+))?/, async (msg, match) => {
    const input = match[1]?.trim();
    if (!input) {
      return sendSafeMarkdown(
        msg.chat.id,
        '⚠️ *Vui lòng nhập link bài đăng hoặc nội dung cần spy!* Ví dụ:\n• `/spy https://vt.tiktok.com/...`\n• `/spy https://youtube.com/shorts/...`\n• `/spy https://www.facebook.com/ads/library/...`\n• `/spy Đoạn văn bản caption hoặc kịch bản video...`'
      );
    }

    await handleSpyContent(msg.chat.id, input);
  });

  /**
   * Hàm xử lý chung cho Spy Content
   */
  async function handleSpyContent(chatId, input, customCaption = '') {
    await sendSafeMarkdown(chatId, '🕵️‍♂️ *Đang kết nối và bóc tách dữ liệu bài đăng/video từ đối thủ...*');

    try {
      const socialData = await fetchSocialPostMetadata(input);
      await sendSafeMarkdown(
        chatId,
        `🎯 Đã nhận diện: *${socialData.platform}*\n📌 Tiêu đề: *${socialData.title || 'N/A'}*\n🧠 Đang giải phẫu công thức Triệu View, 3s Hook và Kịch bản Remix...`
      );

      const analysis = await spyAndAnalyzeMarketingContent(socialData, customCaption);
      const chunks = analysis.match(/[\s\S]{1,3900}/g) || [analysis];

      for (const chunk of chunks) {
        await sendSafeMarkdown(chatId, chunk);
      }
    } catch (err) {
      console.error('❌ Lỗi Spy Marketing Content:', err.message);
      sendSafeMarkdown(chatId, `❌ Lỗi khi phân tích: ${err.message}`);
    }
  }

  // Tự động nhận diện khi người dùng dán link mạng xã hội trực tiếp vào chat mà không cần gõ /spy
  bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;

    const text = msg.text.trim();
    const isSocialLink = /https?:\/\/(www\.)?(tiktok\.com|youtube\.com|youtu\.be|facebook\.com|fb\.watch|instagram\.com|pinterest\.com)\/[^\s]+/i.test(text);

    if (isSocialLink) {
      await handleSpyContent(msg.chat.id, text);
    }
  });

  // 9. Gửi ảnh bất kỳ vào Telegram để AI phân tích
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
        console.error('❌ Lỗi phân tích ảnh spy:', error.message);
        sendSafeMarkdown(chatId, `❌ Lỗi: ${error.message}`);
      }
      return;
    }

    // Nếu là ảnh sản phẩm mẫu thông thường
    await sendSafeMarkdown(
      chatId,
      '👁️ *Đang dùng Gemini Vision soi chi tiết rập may, bối cảnh chụp, insight khách hàng & đề xuất combo voucher cho mẫu này...*'
    );

    try {
      const fileUrl = await bot.getFileLink(highestResPhoto.file_id);
      const analysisText = await analyzeCustomPhoto(fileUrl, caption || null);

      await sendSafeMarkdown(
        chatId,
        `🎨 *PHÂN TÍCH TOÀN DIỆN TỪ GEMINI VISION:*\n\n${analysisText}`
      );
    } catch (error) {
      console.error('❌ Lỗi phân tích ảnh lẻ:', error.message);
      sendSafeMarkdown(chatId, `❌ Lỗi khi phân tích ảnh: ${error.message}`);
    }
  });

  // ==========================================
  // LẬP LỊCH TỰ ĐỘNG (CRON JOB)
  // ==========================================
  if (config.cron.schedule && config.telegram.chatId) {
    cron.schedule(config.cron.schedule, () => {
      console.log(`⏰ [CRON] Chạy báo cáo tự động lúc ${new Date().toLocaleTimeString()}...`);
      runDailyTask(config.telegram.chatId);
    }, {
      timezone: config.cron.timezone
    });
    console.log(`⏰ Đã kích hoạt lịch chạy tự động: "${config.cron.schedule}" (${config.cron.timezone}) gửi tới Chat ID: ${config.telegram.chatId}`);
  } else {
    console.warn('ℹ️ Chưa cấu hình TELEGRAM_CHAT_ID trong .env. Cronjob tự động sẽ kích hoạt ngay khi bạn điền Chat ID.');
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
