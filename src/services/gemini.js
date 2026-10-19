const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');
const { config } = require('../config');

let ai = null;

function getAiClient() {
  if (ai) return ai;
  if (!config.gemini.apiKey) {
    throw new Error('Chưa cấu hình GEMINI_API_KEY trong file .env');
  }
  ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  return ai;
}

/**
 * Tải ảnh từ URL và chuyển thành đối tượng dữ liệu inlineData cho Gemini Vision
 */
async function urlToGenerativePart(imageUrl, labelText) {
  try {
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const contentType = response.headers['content-type'] || 'image/jpeg';
    const base64Data = Buffer.from(response.data).toString('base64');

    return [
      { text: `\n[Hình ảnh tham chiếu cho: ${labelText}]` },
      {
        inlineData: {
          data: base64Data,
          mimeType: contentType.split(';')[0]
        }
      }
    ];
  } catch (error) {
    console.warn(`⚠️ Không thể tải ảnh để phân tích Vision (${labelText}):`, error.message);
    return null;
  }
}

/**
 * ==========================================
 * BÁO CÁO TỔNG THỂ HÀNG NGÀY: PHÂN TÍCH ĐA PHƯƠNG THỨC & INSIGHT & RETENTION
 * ==========================================
 */
async function analyzeAndGenerateReport(webData, socialData, metaAdsData) {
  const client = getAiClient();
  const contents = [];

  // 1. Lấy tối đa 4 ảnh sản phẩm mới từ Website để AI soi kiểu dáng/rập
  const sampleProducts = (webData || [])
    .filter(item => item.imageUrl && item.imageUrl.startsWith('http'))
    .slice(0, 4);

  for (const prod of sampleProducts) {
    const imageParts = await urlToGenerativePart(
      prod.imageUrl,
      `Sản phẩm Website: ${prod.brand} - ${prod.title} (${prod.price})`
    );
    if (imageParts) contents.push(...imageParts);
  }

  // 2. Lấy tối đa 4 ảnh Creative Quảng cáo từ Meta Ads để AI soi Concept & Bố cục
  const sampleAds = (metaAdsData || [])
    .filter(ad => ad.imageUrl && ad.imageUrl.startsWith('http'))
    .slice(0, 4);

  for (const ad of sampleAds) {
    const adParts = await urlToGenerativePart(
      ad.imageUrl,
      `Mẫu Quảng cáo Meta của hãng: ${ad.brand} (CTA: ${ad.ctaText})`
    );
    if (adParts) contents.push(...adParts);
  }

  // 3. Đưa toàn bộ dữ liệu Text + Yêu cầu phân tích chuyên sâu vào cuối mảng contents
  const promptText = `
Bạn là Giám đốc Sáng tạo (Creative Director), Chuyên gia Thiết kế Rập Thời trang (Pattern Maker) & Giám đốc Tăng trưởng E-commerce (Head of Customer Retention & Growth) chuyên ngách Đồ ngủ / Loungewear / Sleepwear.

Dưới đây là các hình ảnh thực tế đính kèm (nếu có) và dữ liệu mới quét được hôm nay từ thị trường:
- 1. Sản phẩm mới trên Website đối thủ (Shopify & Web Thuần):
${JSON.stringify(webData, null, 2)}

- 2. Xu hướng mạng xã hội & Thị trường:
${JSON.stringify(socialData, null, 2)}

- 3. Chiến dịch Quảng cáo trả phí trên Meta (Facebook/Instagram Ads):
${JSON.stringify(metaAdsData, null, 2)}

Hãy lập báo cáo phân tích chiến lược chuyên sâu bằng tiếng Việt (rõ ràng, sắc bén, định dạng Markdown đẹp mắt) theo đúng 5 phần sau:

1. ✂️ **Phân tích Thiết kế Rập, Kiểu dáng & Màu sắc**:
   - Form dáng chủ đạo: Cổ áo (cổ sen, cổ pijama bẻ ve, cổ V, hai dây cami...), tay áo, độ dài ống quần, độ xòe/ôm.
   - Chi tiết may rập đắt giá: Đường viền lé (piping), phối ren, nhún bèo, cúc bọc vải/vỏ sò, độ rũ và bóng bề mặt vải.
   - Bảng màu xu hướng: Tông màu Pastel, Neutral/Earth-tone hay màu nổi bật đang chiếm sóng?

2. 📸 **Giải phẫu Concept Chụp ảnh & Bố cục Creative Quảng cáo**:
   - Setting & Bối cảnh: Phòng ngủ ngập nắng, góc ban công chill, studio phông tối giản hay lifestyle sinh hoạt đời thường?
   - Posing & Cảm xúc: Người mẫu biểu cảm như thế nào để truyền tải thông điệp (sang trọng, thư giãn, ấm áp gia đình...)?
   - Visual Hierarchy: Cách đặt text overlay, huy hiệu giảm giá/bán chạy, điểm nhìn chính của bức ảnh.

3. 🧠 **Bóc tách Insight Khách hàng & Tâm lý Tiêu dùng Đồ ngủ**:
   - Động lực mua hàng cốt lõi (Buying Triggers): Mua để tự thưởng bản thân (self-care/self-love); nâng cấp giấc ngủ mát mẻ không bí mồ hôi; đồ mặc nhà lịch sự kín đáo để tự tin mở cửa nhận hàng/tiếp khách; hoặc mua làm quà tặng tinh tế (Bridal, Valentine, sinh nhật).
   - Nỗi đau & Rào cản tâm lý (Pain Points & Objections): Sợ vải pha nilon gây nóng lưng ngứa ngáy; sợ vải nhăn nhúm sau khi giặt máy; sợ cộm đường may khi nằm nghiêng; sợ áo hai dây bị hớ hênh khi không mặc nội y ở nhà.

4. 🎁 **Chiến lược Thu hút & Kéo chân Khách hàng (Retention, Membership & Vouchers)**:
   - Cơ chế thu hút & chuyển đổi khách mới: Welcome Voucher (VD: giảm 10-15% hoặc quà tặng nhỏ scrunchie lụa/túi giặt), Freeship threshold thông minh.
   - Cơ chế kéo chân & gia tăng vòng đời khách hàng (Customer Lifetime Value - LTV):
     * **Chương trình Thành viên (Membership / Pajama VIP Club)**: Cách phân tầng hạng thẻ (Silver, Gold, Diamond), đặc quyền mua sớm bộ sưu tập giới hạn (Early Access), quà tặng sinh nhật bất ngờ.
     * **Ma trận Voucher & Kích thích mua lặp lại**: Voucher chu kỳ 30-45 ngày đổi bộ mới; Combo mua 2 giảm 15%, mua set tặng áo choàng; Voucher nhóm bạn thân/gia đình (Pajama Party).
     * **Quà tặng đính kèm (Gift With Purchase - GWP)**: Nến thơm mini, bịt mắt ngủ lụa thêu tên riêng, xịt thơm gối tinh dầu oải hương.

5. 🇻🇳 **Đề xuất Sản xuất & Triển khai Thực chiến tại Việt Nam**:
   - Gợi ý cụ thể 1 mẫu thiết kế (form dáng, chất liệu lụa/tencel/cotton phù hợp khí hậu nóng ẩm VN, giá dự kiến).
   - 1 kịch bản concept chụp ảnh Lookbook hoặc video ngắn TikTok/Reels mang tính chuyển đổi cao có thể triển khai ngay tuần này.
`;

  contents.push({ text: promptText });

  const modelName = config.gemini.model || 'gemini-3.8-flash';
  const response = await client.models.generateContent({
    model: modelName,
    contents: contents,
  });

  return response.text;
}

/**
 * ==========================================
 * PHÂN TÍCH ẢNH ĐƠN (INTERACTIVE PHOTO VISION)
 * ==========================================
 */
async function analyzeCustomPhoto(fileUrl, customPrompt) {
  const client = getAiClient();
  const imageParts = await urlToGenerativePart(fileUrl, 'Ảnh mẫu do người dùng gửi từ Telegram');

  if (!imageParts) {
    throw new Error('Không thể tải hoặc xử lý hình ảnh này để phân tích.');
  }

  const prompt = customPrompt || `
Hãy đóng vai trò Giám đốc Thiết kế & Chuyên gia Tăng trưởng Khách hàng (Customer Retention) chuyên ngách Đồ ngủ (Sleepwear/Loungewear). Hãy phân tích bức ảnh này theo 6 khía cạnh:

1. ✂️ **Thiết kế rập & Kỹ thuật may**: Kiểu cổ, tay áo, độ rũ vải, các đường may viền/lé, chất liệu dự đoán.
2. 🎨 **Bảng màu & Cảm giác thị giác**: Tông màu chủ đạo và cảm xúc mang lại.
3. 🧠 **Insight & Chân dung Khách hàng**: Nhóm khách hàng nào mê mẩn mẫu này nhất (tuổi tác, nghề nghiệp, phong cách sống)? Động lực mua hàng và nỗi sợ lớn nhất của họ khi chọn mẫu này.
4. 🎁 **Chiến lược Kéo chân & Voucher cho Mẫu này**:
   - Gợi ý 1 kịch bản Combo / Upsell (VD: bán kèm áo choàng, dép bông, scrunchie lụa).
   - Loại Voucher kích thích mua lần đầu và Voucher kéo họ quay lại mua lần 2.
   - Quà tặng kèm (Gift with purchase) giúp tăng tỷ lệ chốt đơn và tỷ lệ khách giới thiệu bạn bè.
5. 📸 **Concept chụp & Ánh sáng**: Góc chụp, bối cảnh, cách người mẫu tạo dáng để tôn dáng sản phẩm.
6. 🇻🇳 **Đề xuất May & Bán tại Việt Nam**: Cách tùy biến mẫu này (về chất liệu, giá thành, cách phối đồ) để dễ bán chạy tại Việt Nam.
`;

  const modelName = config.gemini.model || 'gemini-3.8-flash';
  const response = await client.models.generateContent({
    model: modelName,
    contents: [...imageParts, { text: prompt }],
  });

  return response.text;
}

/**
 * ==========================================
 * KỸ NĂNG MỚI: TƯ VẤN CHIẾN LƯỢC KÉO CHÂN KHÁCH HÀNG (RETENTION & LOYALTY BLUEPRINT)
 * ==========================================
 */
async function generateRetentionStrategy(topic) {
  const client = getAiClient();
  const prompt = `
Bạn là Giám đốc Tăng trưởng Khách hàng & Loyalty Marketing (Head of Customer Retention & CRM) hàng đầu cho các thương hiệu thời trang đồ ngủ cao cấp.

Chủ đề/Yêu cầu từ người dùng:
"${topic}"

Hãy lập Bản thiết kế Chiến lược Thu hút & Kéo chân Khách hàng (Customer Acquisition & Retention Blueprint) thực chiến, bao gồm:

1. 🏆 **Hệ thống Hội viên (Membership / Pajama VIP Club)**:
   - Thiết kế 3 hạng thẻ (VD: Silk Member -> Velvet VIP -> Diamond Queen) với điều kiện chi tiêu rõ ràng.
   - Quyền lợi đắt giá: Mua sớm BST mới (Early Access), quà sinh nhật thiết kế riêng, quyền đổi size tận nhà miễn phí 1 năm.
   - Cơ chế tích điểm & gamification (Tích điểm khi review có ảnh, tích điểm khi giới thiệu bạn bè).

2. 🎟️ **Ma trận Voucher Kéo Chân Khách Hàng (Voucher Ladder)**:
   - **Voucher Chào mừng (Welcome Voucher)**: Cách tạo cảm giác "hời" ngay lần đầu truy cập mà không làm mất giá thương hiệu.
   - **Voucher Kích thích Mua lại (Repeat Purchase Voucher)**: Chu kỳ gửi sau 30-45 ngày (khi khách đã quen set cũ và muốn đổi mới).
   - **Voucher Kích hoạt Khách ngủ đông (Win-back Voucher)**: Kịch bản kéo lại khách hàng sau 60-90 ngày không phát sinh đơn.
   - **Chính sách Combo & Upsell**: Mua 2 giảm 15%, Mua set pijama tặng áo choàng ngủ hoặc voucher hoàn tiền.

3. 🎀 **Nghệ thuật Quà tặng GWP & Trải nghiệm Đập Hộp (Unboxing Experience)**:
   - Các món quà tặng kèm chi phí thấp nhưng giá trị cảm nhận cực cao (Nến thơm phòng ngủ mini, túi giặt đồ ngủ lụa, xịt thơm gối tinh dầu oải hương, scrunchie lụa thêu tên).
   - Trải nghiệm đóng gói tạo sự "Wow": Hộp nắp nam châm thắt nơ, thiệp cảm ơn viết tay, xịt hương thơm đặc trưng của thương hiệu lên giấy lót.

4. 📲 **Kịch bản Chăm sóc Khách hàng Tự động (Zalo ZNS / SMS / Email Automation Flow)**:
   - Ngày 0 (Vừa nhận hàng): Hướng dẫn kiểm tra và thử size nhẹ nhàng.
   - Ngày 3: Hướng dẫn bảo quản & cách giặt lụa/tencel đúng cách để bền đẹp như mới.
   - Ngày 25-30: Thăm dò trải nghiệm giấc ngủ + Gửi tặng Voucher khách hàng thân thiết.
`;

  const modelName = config.gemini.model || 'gemini-3.8-flash';
  const response = await client.models.generateContent({
    model: modelName,
    contents: [{ text: prompt }],
  });

  return response.text;
}

/**
 * ==========================================
 * KỸ NĂNG MỚI: BÓC TÁCH INSIGHT & CHÂN DUNG KHÁCH HÀNG (CUSTOMER PERSONA & BUYING TRIGGERS)
 * ==========================================
 */
async function generateCustomerInsight(topic) {
  const client = getAiClient();
  const prompt = `
Bạn là Chuyên gia Nghiên cứu Hành vi Người tiêu dùng (Consumer Behavior Researcher) & Chuyên gia Tâm lý Học Bán hàng ngách Thời trang Đồ ngủ / Loungewear / Sleepwear.

Chủ đề/Yêu cầu từ người dùng:
"${topic}"

Hãy lập Báo cáo Phân tích Chân dung & Insight Khách hàng chuyên sâu:

1. 🎯 **3 Chân dung Khách hàng Điển hình (Customer Personas)**:
   - Độ tuổi, mức thu nhập, lối sống, thói quen sinh hoạt tại nhà.
   - Bối cảnh họ mặc đồ ngủ (sau một ngày làm việc mệt mỏi, buổi sáng thong thả cuối tuần, khi tiếp bạn bè thân mật tại gia...).

2. 💡 **Động cơ Mua hàng Cốt lõi (Hidden Buying Triggers)**:
   - Nhu cầu cảm xúc sâu kín: Tìm kiếm sự nâng niu, tự thưởng cho bản thân (Self-love); cảm giác mình vẫn quyến rũ, chỉn chu dù chỉ ở trong phòng ngủ.
   - Nhu cầu thực tế: Thoáng mát tối đa trong đêm hè oi bức, chất liệu êm ái xua tan mệt mỏi, form dáng kín đáo nhưng tôn dáng khi ra ngoài phòng khách.

3. ⚠️ **Rào cản Mua hàng & Nỗi sợ (Fears & Objections)**:
   - Những lý do khiến họ chần chừ bấm mua (Sợ vải nhăn, sợ cộm lưng, sợ giặt máy bị co, sợ hớ hênh khi không mặc bra, sợ giá cao nhưng chất liệu pha nylon).
   - Chiến lược giải quyết triệt để từng nỗi sợ trong nội dung bài bán hàng và video.

4. ✍️ **Bộ Thông Điệp Truyền Thông & Câu Hook Bắt Đúng Tim Đen**:
   - 3 câu Hook mở đầu video/bài quảng cáo đánh trúng tâm lý tự thưởng bản thân.
   - 3 góc tiếp cận giải quyết nỗi đau giấc ngủ và tính ứng dụng mặc nhà.
`;

  const modelName = config.gemini.model || 'gemini-3.8-flash';
  const response = await client.models.generateContent({
    model: modelName,
    contents: [{ text: prompt }],
  });

  return response.text;
}

/**
 * ==========================================
 * KỸ NĂNG MỚI: SPY MARKETING CONTENT & PHÂN TÍCH Ý TƯỞNG QUẢNG CÁO ĐỐI THỦ
 * ==========================================
 */
async function spyAndAnalyzeMarketingContent(socialData, customInstructions = '') {
  const client = getAiClient();
  const contents = [];

  // Nếu có ảnh đại diện/thumbnail của video hoặc bài đăng, tải về để Gemini Vision quan sát trực quan
  if (socialData.thumbnailUrl && socialData.thumbnailUrl.startsWith('http')) {
    const imageParts = await urlToGenerativePart(
      socialData.thumbnailUrl,
      `Thumbnail/Ảnh bài đăng đối thủ trên ${socialData.platform}`
    );
    if (imageParts) contents.push(...imageParts);
  }

  const prompt = `
Bạn là Giám đốc Sáng tạo Viral Video (Viral Creative Director), Đạo diễn Kịch bản Video Ngắn (Short-form Scriptwriter) & Bậc thầy Phân tích Content Marketing ngành Thời trang (Sleepwear / Loungewear / Fashion).

Dưới đây là dữ liệu bài đăng / video quảng cáo từ đối thủ mà hệ thống vừa Spy được:
- Nền tảng: ${socialData.platform || 'Mạng xã hội'}
- Tiêu đề / Headline: ${socialData.title || 'N/A'}
- Tác giả / Kênh: ${socialData.author || 'N/A'}
- Đường link gốc: ${socialData.url || 'N/A'}
- Nội dung Text / Caption / Bóc tách:
${socialData.text || socialData.rawInput || 'Không có text chi tiết'}

${customInstructions ? `\nYêu cầu bổ sung từ người dùng: "${customInstructions}"\n` : ''}

Hãy "mổ xẻ phẫu thuật" nội dung này với độ chuẩn xác cao nhất theo đúng 5 phần sau bằng tiếng Việt (định dạng Markdown sắc bén, rõ ràng):

1. 🎯 **Mổ xẻ "Ý Tưởng Lớn" (Big Idea & Viral Formula)**:
   - Ý tưởng cốt lõi (Core Concept) là gì? Đối thủ đang bán "sản phẩm" hay bán "cảm xúc / phong cách sống"?
   - Động cơ tâm lý kích hoạt người xem (Psychological Trigger): Cảm giác tò mò, sự thỏa mãn thị giác (Oddly Satisfying/ASMR), hiệu ứng bầy đàn (Bandwagon), hay tự thưởng bản thân (Self-care)?

2. 🪝 **Giải Phẫu "3 Giây Đầu Tiên" (The Hook Anatomy)**:
   - **Visual Hook**: Hình ảnh đập vào mắt người xem trong 3s đầu là gì (cảnh quay zoom cận chất vải, hành động đổ nước test chống thấm, biểu cảm ngạc nhiên của mẫu...)?
   - **Text / Verbal Hook**: Câu chữ/câu nói đầu tiên nào khiến ngón tay người dùng dừng lướt (Pattern Interrupt)?
   - **Audio Hook**: Tiếng sột soạt lụa (ASMR), âm thanh môi trường hay trend sound nào được sử dụng?

3. 🎬 **Mạch Kể Chuyện & Kỹ Thuật Giữ Chân (Retention & Pacing)**:
   - Cấu trúc kịch bản: Đối thủ triển khai theo công thức nào (VD: Problem - Agitate - Solution; Trước - Sau; Kể chuyện tâm sự POV...)?
   - Nhịp điệu (Pacing): Nhịp cắt nhanh dồn dập hay chậm rãi thư thái để tạo cảm giác sang trọng?

4. 🛒 **Nghệ thuật Lồng Ghép Sản Phẩm & Nút Kêu Gọi Hành Động (CTA)**:
   - Sản phẩm xuất hiện ở giây thứ mấy? Xuất hiện như "vị cứu tinh giải quyết vấn đề" hay là giới thiệu lộ liễu?
   - Kỹ thuật điều hướng mua hàng: Kêu gọi bình luận nhận voucher, dẫn link bio, hay ghim giỏ hàng?

5. 🇻🇳 **Kịch Bản "Remix" Chuẩn Chỉnh Cho Shop Thời Trang Việt Nam**:
   - **Bảng kịch bản phân cảnh chi tiết** (Từng giây: 0-3s, 3-10s, 10-25s, 25-35s) gồm: [Hình ảnh/Góc quay] - [Lời thoại/Voiceover tiếng Việt gần gũi] - [Chữ chạy trên màn hình].
   - **Ghi chú Đạo diễn**: Hướng dẫn mẫu diễn xuất, góc đặt máy, ánh sáng phòng ngủ, chi tiết may rập đồ ngủ cần lia máy cận cảnh.
   - **Gợi ý Caption & Bộ Hashtag TikTok/Reels**: Viết sẵn 1 caption có hook mạnh và 8 hashtag chuẩn ngách để lên xu hướng.
`;

  contents.push({ text: prompt });

  const modelName = config.gemini.model || 'gemini-3.8-flash';
  const response = await client.models.generateContent({
    model: modelName,
    contents: contents,
  });

  return response.text;
}

module.exports = {
  getAiClient,
  urlToGenerativePart,
  analyzeAndGenerateReport,
  analyzeCustomPhoto,
  generateRetentionStrategy,
  generateCustomerInsight,
  spyAndAnalyzeMarketingContent,
};

