const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');
const { config } = require('../config');
const { getTaxonomyPromptSection } = require('./taxonomy');

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
 * ========================================================
 * SYSTEM PROMPT CHUẨN MỰC THEO FRAMEWORK TÌNH BÁO THỜI TRANG ĐỒ NGỦ
 * ========================================================
 */
const SYSTEM_INSTRUCTION = `
# ROLE & IDENTITY
Bạn là "Chief Fashion & Sleepwear Competitive Intelligence AI" — Hệ thống Tình báo Cạnh tranh và Phân tích Chiến lược Sản phẩm/Marketing cấp cao, chuyên biệt cho ngành Thời trang và Đồ ngủ (Sleepwear, Loungewear, Lingerie, Homewear).
Nhiệm vụ tối cao của bạn là thu thập, mổ xẻ dữ liệu đa phương thức (văn bản, số liệu tương tác, hình ảnh sản phẩm, video/ảnh quảng cáo) từ Website và Mạng xã hội của đối thủ, từ đó chuyển hóa thành các thông tin chiến lược, thiết kế rập và kịch bản hành động thực tiễn cho thương hiệu của chủ sở hữu.

# STRICT OPERATIONAL GUARDRAILS (QUY TẮC BẤT DI BẤT DỊCH)
1. KHÔNG SUY ĐOÁN VÔ CĂN CỨ (Zero Hallucination): Mọi nhận định về giá bán, chương trình khuyến mãi, chỉ số tương tác hoặc chi tiết thiết kế PHẢI dựa trên dữ liệu văn bản và hình ảnh thực tế được cung cấp trong đầu vào. Nếu thông tin bị khuất hoặc không có trong dữ liệu, bắt buộc ghi rõ: "[Không đủ dữ liệu xác thực]".
2. CẤM NHẬN XÉT CHUNG CHUNG (No Generic Fluff): Tuyệt đối cấm sử dụng các tính từ sáo rỗng, vô thưởng vô phạt như "sản phẩm rất đẹp", "content thu hút", "hình ảnh bắt mắt". Mọi đánh giá phải chỉ rõ NGUYÊN NHÂN KỸ THUẬT (Ví dụ: thay vì nói "áo đẹp", phải phân tích "form pijama suông rộng phối viền lé trắng bản 5mm ở cổ và mang-sét tay giúp tạo đường nét tương phản và che khuyết điểm bắp tay").
3. PHÂN BIỆT TÍN HIỆU THẬT VÀ NHIỄU (Signal vs. Noise): Đánh giá mức độ thành công của nội dung/sản phẩm đối thủ dựa trên bằng chứng thực tế (thời gian duy trì quảng cáo trên Meta Ad Library, tỷ lệ Share/Save/Comment hỏi giá, hoặc tình trạng hết size trên Website).
4. TƯ DUY HỌC HỎI ĐỂ VƯỢT QUA (Adapt & Outperform): Không bao giờ khuyên chủ thương hiệu sao chép y nguyên 100% của đối thủ. Luôn phải chỉ ra: (a) Điểm mạnh cần học hỏi, (b) Lỗ hổng/điểm yếu của đối thủ (trong thiết kế, góc chụp hoặc thông điệp), và (c) Phương án cải tiến tốt hơn cho thương hiệu nhà.
5. NGUYÊN TẮC "1 CORE INSIGHT - ĐA GÓC TIẾP CẬN" (One Insight, Multi-Angle Execution): Để giúp thương hiệu bán sâu 1 mã hàng với số lượng lớn mà không bị cạn ý tưởng hay chệch định vị, từ 1 Insight cốt lõi đã xác định, bạn BẮT BUỘC phải khai triển thành 4 Góc tiếp cận nội dung (Marketing Angles) khác nhau nhưng cùng phục vụ 1 Insight gốc đó.

${getTaxonomyPromptSection()}
`;

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
 * NÂNG CẤP 5: TẠO VECTOR EMBEDDING (768 CHIỀU) BẰNG GEMINI
 */
async function getEmbedding(text) {
  const client = getAiClient();
  try {
    const cleanText = (text || '').slice(0, 2048);
    const res = await client.models.embedContent({
      model: 'gemini-embedding-001',
      contents: cleanText,
      config: {
        outputDimensionality: 768
      }
    });

    if (res.embeddings && res.embeddings[0] && res.embeddings[0].values) {
      return res.embeddings[0].values;
    }
    if (res.embedding && res.embedding.values) {
      return res.embedding.values;
    }
    return null;
  } catch (err) {
    console.error('❌ Lỗi tạo vector embedding:', err.message);
    return null;
  }
}

/**
 * ========================================================
 * PHÂN TÍCH CHUYÊN SÂU 1 ITEM TRONG HÀNG ĐỢI (QUEUE WORKER)
 * Áp dụng đúng 4 Bước phân tích & Định dạng báo cáo bắt buộc
 * ========================================================
 */
async function analyzeSingleItemDeepDive(item) {
  const client = getAiClient();
  const contents = [];

  // Tải ảnh đại diện (nếu có)
  if (item.imageUrl && item.imageUrl.startsWith('http')) {
    const imagePart = await urlToGenerativePart(item.imageUrl, `${item.brand} - ${item.title}`);
    if (imagePart) contents.push(...imagePart);
  }

  const promptText = `
${SYSTEM_INSTRUCTION}

Dưới đây là dữ liệu thực tế về sản phẩm/quảng cáo của đối thủ:
- Tên thương hiệu: ${item.brand || 'Đối thủ cạnh tranh'}
- Nguồn dữ liệu: ${item.sourceType || item.source || 'Website'}
- Tiêu đề sản phẩm/chiến dịch: ${item.title || 'N/A'}
- Giá bán / Offer: ${item.price || item.offer || '[Không đủ dữ liệu xác thực]'}
- Link xem gốc: ${item.productUrl || item.linkUrl || item.url || 'N/A'}
- Đánh giá tín hiệu chiến thắng:
  + Mức độ ưu tiên: [${item.priority || 'LOW'}]
  + Điểm tín hiệu: ${item.winningScore || 0}/100
  + Lý do phát hiện: ${item.signalReason || 'Chưa có ghi nhận đặc biệt'}
- Dữ liệu chi tiết đính kèm:
${JSON.stringify(item.raw_data || item, null, 2).slice(0, 1500)}

BẠN BẮT BUỘC PHẢI XUẤT BÁO CÁO THEO ĐÚNG CẤU TRÚC SAU:

==================================================
📊 BÁO CÁO TÌNH BÁO ĐỐI THỦ: ${item.brand || 'ĐỐI THỦ'}
📍 Nguồn kênh: [${item.sourceType || item.source || 'Website'}] | 🎯 Mức độ ưu tiên: [${item.priority || 'LOW'}]
==================================================

1. TỔNG QUAN TÍN HIỆU (SIGNAL SUMMARY)
- Sản phẩm / Chiến dịch: ${item.title || 'Mã sản phẩm đối thủ'}
- Giá bán & Offer ghi nhận: ${item.price || '[Không đủ dữ liệu xác thực]'}
- Bằng chứng hiệu quả: ${item.signalReason || 'Dữ liệu cào định kỳ'}

2. GIẢI PHẪU SẢN PHẨM & THỊ GIÁC (VISION ANALYSIS)
- Cấu trúc Rập & Kiểu dáng: [Soi form, cổ pijama ve lật/cổ sen/cami, tay, độ che khuyết điểm]
- Chất liệu & Màu sắc dự đoán: [Soi độ rủ, độ bắt sáng: lụa Latin, đũi tơ, modal...]
- Chi tiết hoàn thiện đắt giá: [Viền lé piping tương phản, phối ren mi, cúc bọc vải...]
- Concept & Góc chụp (Art Direction): [Bối cảnh giường ngủ drap trắng/luxury bath, ánh sáng warm cozy/bright airy, posing của mẫu]

3. GIẢI MÃ PHỄU MARKETING CỦA ĐỐI THỦ
- Hook chủ đạo: [Câu mở đầu hoặc visual hook 3s đầu]
- Điểm chạm tâm lý (Pain-point / Desire): [Nỗi đau hoặc khao khát đối thủ đang đánh trúng]
- Lỗ hổng của đối thủ (Weakness/Gap): [Điểm đối thủ làm chưa tới về ảnh, form dáng hoặc thông điệp]

4. KẾ HOẠCH HÀNH ĐỘNG CHO THƯƠNG HIỆU CỦA BẠN (ACTIONABLE STRATEGY)
- 💡 Gợi ý cải tiến Sản phẩm / Concept chụp: [1-2 hành động cụ thể để làm tốt hơn đối thủ]
- 🎯 CORE INSIGHT CỐ ĐỊNH (Dùng để bán sâu 1 mã hàng): "[Phát biểu 1 câu Insight cốt lõi sắc bén]"
- 🚀 MA TRẬN 4 GÓC TIẾP CẬN (Mở rộng nội dung từ Core Insight trên):
  + [Angle 1 - Cảm xúc & Khí chất]: [Ý tưởng kịch bản/hình ảnh & câu Hook mẫu]
  + [Angle 2 - Chất liệu & Trải nghiệm]: [Ý tưởng kịch bản/hình ảnh & câu Hook mẫu]
  + [Angle 3 - Bối cảnh & Tình huống]: [Ý tưởng kịch bản/hình ảnh & câu Hook mẫu]
  + [Angle 4 - Bằng chứng & Giải quyết rào cản]: [Ý tưởng kịch bản/hình ảnh & câu Hook mẫu]
`;

  contents.push({ text: promptText });

  const modelName = config.gemini.model || 'gemini-3.8-flash';
  const response = await client.models.generateContent({
    model: modelName,
    contents: contents,
  });

  const fullReport = response.text;

  // Bóc tách Core Insight để lưu vào Vector Memory
  const insightMatch = fullReport.match(/🎯 CORE INSIGHT CỐ ĐỊNH[^:]*:\s*["“]([^"”\n]+)["”]/i);
  const coreInsight = insightMatch ? insightMatch[1].trim() : 'Nhu cầu tự thưởng bản thân và tìm kiếm giấc ngủ êm ái, thoáng mát';

  return {
    fullReport,
    coreInsight,
  };
}

/**
 * ========================================================
 * BÁO CÁO TỔNG THỂ HÀNG NGÀY (DAILY CONSOLIDATED REPORT)
 * ========================================================
 */
async function analyzeAndGenerateReport(webData, socialData, metaAdsData) {
  const client = getAiClient();
  const contents = [];

  // Lấy tối đa 3 ảnh mẫu từ website
  const sampleProducts = (webData || []).filter(i => i.imageUrl && i.imageUrl.startsWith('http')).slice(0, 3);
  for (const prod of sampleProducts) {
    const p = await urlToGenerativePart(prod.imageUrl, `${prod.brand} - ${prod.title}`);
    if (p) contents.push(...p);
  }

  // Lấy tối đa 2 ảnh từ ads
  const sampleAds = (metaAdsData || []).filter(a => a.imageUrl && a.imageUrl.startsWith('http')).slice(0, 2);
  for (const ad of sampleAds) {
    const a = await urlToGenerativePart(ad.imageUrl, `Meta Ad: ${ad.brand}`);
    if (a) contents.push(...a);
  }

  const promptText = `
${SYSTEM_INSTRUCTION}

Dưới đây là các dữ liệu quét thị trường và đối thủ mới nhất:
- Sản phẩm mới trên Website đối thủ:
${JSON.stringify(webData, null, 2).slice(0, 2000)}

- Xu hướng Mạng xã hội:
${JSON.stringify(socialData, null, 2).slice(0, 1500)}

- Chiến dịch Meta Ads:
${JSON.stringify(metaAdsData, null, 2).slice(0, 2000)}

Hãy xuất bản báo cáo chiến lược tổng hợp theo đúng MANDATORY OUTPUT FORMAT đã được quy định, bao gồm phân tích rập may chi tiết, phân tích nghệ thuật thị giác, chỉ ra lỗ hổng của đối thủ, và xây dựng MA TRẬN 4 GÓC TIẾP CẬN từ 1 CORE INSIGHT CỐ ĐỊNH để đội ngũ Marketing và Sản xuất triển khai ngay tuần này.
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
 * ========================================================
 * PHÂN TÍCH ẢNH LẺ THEO SLEEPWEAR TAXONOMY & MULTI-ANGLE
 * ========================================================
 */
async function analyzeCustomPhoto(fileUrl, customPrompt) {
  const client = getAiClient();
  const imageParts = await urlToGenerativePart(fileUrl, 'Ảnh đồ ngủ do người dùng gửi');
  if (!imageParts) {
    throw new Error('Không thể tải hoặc xử lý ảnh gửi lên.');
  }

  const prompt = `
${SYSTEM_INSTRUCTION}

Người dùng vừa gửi một bức ảnh mẫu đồ ngủ cần phân tích chuyên sâu.
${customPrompt ? `Ghi chú đính kèm từ người dùng: "${customPrompt}"\n` : ''}

Hãy bóc tách bức ảnh này theo đúng MANDATORY OUTPUT FORMAT:
1. TỔNG QUAN TÍN HIỆU: Đánh giá chất lượng và tiềm năng thị trường của mẫu.
2. GIẢI PHẪU SẢN PHẨM & THỊ GIÁC:
   - Cấu trúc Rập: Kiểu dáng, cổ pijama ve lật/cổ sen/vuông/cami, form suông hay chiết eo, độ dài tay và quần.
   - Bề mặt vải & Chất liệu: Lụa Latin, Satin, Đũi tơ hay Cotton Modal?
   - Chi tiết đắt giá: Chạy viền lé piping, phối ren mi, cúc bọc vải, chun quần chống hằn.
   - Concept & Art Direction: Bối cảnh, ánh sáng, cách tạo dáng người mẫu.
3. GIẢI MÃ PHỄU MARKETING & LỖ HỔNG: Điểm chạm tâm lý và lỗ hổng cần khắc phục.
4. KẾ HOẠCH HÀNH ĐỘNG:
   - Gợi ý may rập và concept chụp tại Việt Nam.
   - 1 CORE INSIGHT CỐ ĐỊNH.
   - MA TRẬN 4 GÓC TIẾP CẬN (Angle 1: Cảm xúc & Khí chất, Angle 2: Chất liệu & Trải nghiệm, Angle 3: Bối cảnh & Tình huống, Angle 4: Bằng chứng & So sánh).
`;

  const modelName = config.gemini.model || 'gemini-3.8-flash';
  const response = await client.models.generateContent({
    model: modelName,
    contents: [...imageParts, { text: prompt }],
  });

  return response.text;
}

/**
 * ========================================================
 * SPY MARKETING CONTENT & VIDEO TIKTOK / REELS / ADS
 * ========================================================
 */
async function spyAndAnalyzeMarketingContent(socialData, customInstructions = '') {
  const client = getAiClient();
  const contents = [];

  if (socialData.thumbnailUrl && socialData.thumbnailUrl.startsWith('http')) {
    const imageParts = await urlToGenerativePart(
      socialData.thumbnailUrl,
      `Thumbnail/Ảnh bài đăng đối thủ trên ${socialData.platform}`
    );
    if (imageParts) contents.push(...imageParts);
  }

  const prompt = `
${SYSTEM_INSTRUCTION}

Dữ liệu bài đăng/video đối thủ cần Spy:
- Nền tảng: ${socialData.platform || 'Mạng xã hội'}
- Tiêu đề: ${socialData.title || 'N/A'}
- Tác giả / Kênh: ${socialData.author || 'N/A'}
- Link gốc: ${socialData.url || 'N/A'}
- Nội dung Text / Caption: ${socialData.text || socialData.rawInput || 'Không có text'}
${customInstructions ? `- Yêu cầu thêm: "${customInstructions}"\n` : ''}

Hãy giải phẫu kịch bản và xuất báo cáo chuẩn xác theo đúng cấu trúc:
1. TỔNG QUAN TÍN HIỆU: Đánh giá độ lan tỏa và công thức triệu view.
2. GIẢI PHẪU THỊ GIÁC & VIDEO ANATOMY: Visual Hook 3s đầu, góc quay, bối cảnh phòng ngủ/lifestyle, chuyển động khoe chất vải.
3. GIẢI MÃ PHỄU MARKETING: Verbal hook, điểm chạm cảm xúc, lỗ hổng của đối thủ.
4. KẾ HOẠCH HÀNH ĐỘNG:
   - Kịch bản Remix từng giây (0-3s, 3-10s, 10-25s, 25-35s) chuẩn Việt Nam.
   - 🎯 1 CORE INSIGHT CỐ ĐỊNH.
   - 🚀 MA TRẬN 4 GÓC TIẾP CẬN (Cảm xúc, Chất liệu, Bối cảnh, Bằng chứng) để sản xuất chuỗi 10 video tiếp theo.
`;

  contents.push({ text: prompt });

  const modelName = config.gemini.model || 'gemini-3.8-flash';
  const response = await client.models.generateContent({
    model: modelName,
    contents: contents,
  });

  return response.text;
}

/**
 * ========================================================
 * NÂNG CẤP 5: TỔNG HỢP XU HƯỚNG TUẦN TỪ TRÍ NHỚ DÀI HẠN
 * ========================================================
 */
async function summarizeWeeklyTrends(analyses) {
  const client = getAiClient();
  if (!analyses || analyses.length === 0) {
    return 'Chưa có đủ dữ liệu lịch sử phân tích trong 7–14 ngày qua để tổng hợp bức tranh toàn cảnh.';
  }

  const prompt = `
${SYSTEM_INSTRUCTION}

Dưới đây là tóm tắt danh sách các sản phẩm và chiến dịch của các đối thủ lớn đã được ghi nhận trong 7-14 ngày qua:
${JSON.stringify(analyses, null, 2).slice(0, 4000)}

Dựa trên dữ liệu thực tế trên, hãy lập Báo Cáo Tổng Hợp Xu Hướng Toàn Cảnh (Macro Trend Report) ngành Đồ ngủ:
1. 📈 **DỊCH CHUYỂN THIẾT KẾ & RẬP**: Các đối thủ đang chuyển hướng sang form dáng, kiểu cổ nào (VD: pijama ve lật sang cổ sen, set dài sang set đùi)?
2. 🎨 **BẢNG MÀU & CHẤT LIỆU CHỦ ĐẠO**: Chất liệu và tông màu nào đang chiếm sóng nhiều nhất?
3. 📸 **XU HƯỚNG CONCEPT CHỤP ẢNH & VISUAL**: Bối cảnh và phong cách chụp ảnh nào đang mang lại chuyển đổi cao nhất?
4. 🧠 **CORE INSIGHTS & THÔNG ĐIỆP ĐANG THẮNG LỚN**: Thông điệp nào đang thu hút nhiều tương tác và ra đơn nhất?
5. 🚀 **ĐỀ XUẤT HÀNH ĐỘNG TUẦN TỚI**: 3 việc cụ thể thương hiệu nhà nên triển khai ngay để đón đầu xu hướng.
`;

  const modelName = config.gemini.model || 'gemini-3.8-flash';
  const response = await client.models.generateContent({
    model: modelName,
    contents: [{ text: prompt }],
  });

  return response.text;
}

/**
 * TƯ VẤN RETENTION & LOYALTY
 */
async function generateRetentionStrategy(topic) {
  const client = getAiClient();
  const prompt = `
${SYSTEM_INSTRUCTION}

Chủ đề: "${topic}"
Hãy lập Bản thiết kế Chiến lược Thu hút & Kéo chân Khách hàng (Customer Acquisition & Retention Blueprint):
1. 🏆 Hệ thống Hội viên (Pajama VIP Club - 3 hạng thẻ).
2. 🎟️ Ma trận Voucher Kéo Chân Khách Hàng (Voucher Ladder).
3. 🎀 Nghệ thuật Quà tặng GWP & Trải nghiệm Đập Hộp (Unboxing Experience).
4. 📲 Kịch bản Chăm sóc Khách hàng Tự động (Zalo ZNS / SMS Flow).
5. 🎯 1 CORE INSIGHT CỐ ĐỊNH & MA TRẬN 4 GÓC TIẾP CẬN VOUCHER.
`;

  const modelName = config.gemini.model || 'gemini-3.8-flash';
  const response = await client.models.generateContent({
    model: modelName,
    contents: [{ text: prompt }],
  });

  return response.text;
}

/**
 * BÓC TÁCH CUSTOMER INSIGHT
 */
async function generateCustomerInsight(topic) {
  const client = getAiClient();
  const prompt = `
${SYSTEM_INSTRUCTION}

Chủ đề: "${topic}"
Hãy lập Báo cáo Phân tích Chân dung & Insight Khách hàng chuyên sâu:
1. 🎯 3 Chân dung Khách hàng Điển hình (Customer Personas).
2. 💡 Động cơ Mua hàng Cốt lõi (Hidden Buying Triggers).
3. ⚠️ Rào cản Mua hàng & Nỗi sợ (Fears & Objections).
4. 🎯 1 CORE INSIGHT CỐ ĐỊNH & MA TRẬN 4 GÓC TIẾP CẬN NỘI DUNG.
`;

  const modelName = config.gemini.model || 'gemini-3.8-flash';
  const response = await client.models.generateContent({
    model: modelName,
    contents: [{ text: prompt }],
  });

  return response.text;
}

module.exports = {
  getAiClient,
  getEmbedding,
  analyzeSingleItemDeepDive,
  analyzeAndGenerateReport,
  analyzeCustomPhoto,
  spyAndAnalyzeMarketingContent,
  summarizeWeeklyTrends,
  generateRetentionStrategy,
  generateCustomerInsight,
};
