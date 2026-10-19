/**
 * ========================================================
 * NÂNG CẤP 1: BỘ LỌC TÍN HIỆU CHIẾN THẮNG (WINNING SIGNAL FILTER)
 * Tầng Middleware lọc và chấm điểm dữ liệu thô trước khi chuyển tới AI
 * ========================================================
 */

/**
 * Chấm điểm và phân loại mục tiêu dựa trên tín hiệu thực chiến
 * @param {Object} item Dữ liệu thô của 1 sản phẩm / bài đăng / quảng cáo
 * @param {string} sourceType 'meta_ads' | 'social' | 'shopify' | 'custom_web'
 * @returns {Object} { winningScore: number, priority: 'HIGH'|'MEDIUM'|'LOW', signalReason: string, badge: string, isWinning: boolean }
 */
function evaluateWinningSignal(item, sourceType) {
  let score = 20; // Điểm cơ bản
  const reasons = [];
  let isWinning = false;

  // ==========================================
  // 1. ĐỐI VỚI META AD LIBRARY (FACEBOOK / INSTAGRAM ADS)
  // ==========================================
  if (sourceType === 'meta_ads') {
    // A. Tính số ngày quảng cáo đã chạy liên tục
    let daysRunning = 0;
    if (item.startDate) {
      const start = new Date(item.startDate);
      const now = new Date();
      if (!isNaN(start.getTime())) {
        daysRunning = Math.max(0, Math.floor((now - start) / (1000 * 60 * 60 * 24)));
      }
    } else if (item.daysRunning) {
      daysRunning = parseInt(item.daysRunning, 10) || 0;
    }

    if (daysRunning >= 10) {
      score += 45;
      reasons.push(`Quảng cáo duy trì ${daysRunning} ngày liên tục (Đang vít ngân sách mạnh)`);
      isWinning = true;
    } else if (daysRunning >= 5) {
      score += 25;
      reasons.push(`Đã chạy ${daysRunning} ngày (Đang có tín hiệu tốt)`);
    }

    // B. Số lượng biến thể Creative (hình ảnh / video / copy)
    const variantsCount = item.variantsCount || (Array.isArray(item.variants) ? item.variants.length : 1);
    if (variantsCount >= 3) {
      score += 35;
      reasons.push(`Có ${variantsCount} biến thể Creative cho cùng một mã sản phẩm`);
      isWinning = true;
    }

    // C. Kiểm tra trạng thái hoạt động
    if (item.isActive || item.status === 'Active') {
      score += 10;
    }
  }

  // ==========================================
  // 2. ĐỐI VỚI MẠNG XÃ HỘI (TIKTOK / REELS / SHORTS / INSTAGRAM)
  // ==========================================
  else if (sourceType === 'social' || sourceType === 'tiktok') {
    const views = parseInt(item.views || item.viewCount || 0, 10);
    const likes = parseInt(item.likes || item.diggCount || item.likeCount || 0, 10);
    const shares = parseInt(item.shares || item.shareCount || 0, 10);
    const saves = parseInt(item.saves || item.collectCount || item.saveCount || 0, 10);
    const comments = parseInt(item.comments || item.commentCount || 0, 10);

    // Tính số giờ từ lúc đăng
    let hoursSincePosted = 24;
    if (item.createdAt || item.publishedAt) {
      const pub = new Date(item.createdAt || item.publishedAt);
      if (!isNaN(pub.getTime())) {
        hoursSincePosted = Math.max(1, Math.floor((new Date() - pub) / (1000 * 60 * 60)));
      }
    }

    // A. Engagement Velocity: Tốc độ tương tác trên giờ
    const totalInteractions = likes + shares * 2 + saves * 3 + comments * 2;
    const velocity = Math.round(totalInteractions / hoursSincePosted);

    // B. Intent Ratio: Tỷ lệ Lưu (Save) & Chia sẻ (Share) trên Views hoặc Likes
    const baseline = views > 0 ? views : Math.max(likes, 100);
    const shareSaveRatio = ((shares + saves) / baseline) * 100;

    if (shareSaveRatio >= 5 || (saves >= 200 && shares >= 100)) {
      score += 45;
      reasons.push(`Tỷ lệ Save/Share đạt ${shareSaveRatio.toFixed(1)}% (${saves} lưu, ${shares} chia sẻ - phản ánh ý định mua hàng thật sự cao)`);
      isWinning = true;
    } else if (shareSaveRatio >= 2 || saves >= 100) {
      score += 25;
      reasons.push(`Lượt lưu và chia sẻ tích cực (${saves} lưu, ${shares} share)`);
    }

    if (velocity >= 150) {
      score += 35;
      reasons.push(`Tốc độ tương tác bùng nổ (~${velocity} tương tác/giờ)`);
      isWinning = true;
    } else if (velocity >= 50) {
      score += 15;
      reasons.push(`Tương tác ổn định (~${velocity} tương tác/giờ)`);
    }
  }

  // ==========================================
  // 3. ĐỐI VỚI WEBSITE ĐỐI THỦ (SHOPIFY & WEB THUẦN)
  // ==========================================
  else if (sourceType === 'shopify' || sourceType === 'custom_web') {
    const titleLower = (item.title || '').toLowerCase();
    const tagsLower = Array.isArray(item.tags) ? item.tags.join(' ').toLowerCase() : (item.tags || '').toLowerCase();
    const variants = Array.isArray(item.variants) ? item.variants : [];

    // A. Kiểm tra tồn kho theo từng Size (S, M, L)
    // Đặc thù thời trang Việt Nam / Nữ: Size M & L là size phổ thông bán chạy nhất
    let sizeMOutOfStock = false;
    let sizeLOutOfStock = false;
    let anySizeOutOfStock = false;

    if (variants.length > 0) {
      variants.forEach(v => {
        const varTitle = (v.title || '').toUpperCase();
        const isAvailable = v.available !== false && (v.inventory_quantity === undefined || v.inventory_quantity > 0);

        if (!isAvailable) {
          anySizeOutOfStock = true;
          if (varTitle.includes('M')) sizeMOutOfStock = true;
          if (varTitle.includes('L')) sizeLOutOfStock = true;
        }
      });
    }

    if (sizeMOutOfStock && sizeLOutOfStock) {
      score += 50;
      reasons.push(`Cháy hàng liên tục cả 2 size chủ đạo M và L trên web`);
      isWinning = true;
    } else if (sizeMOutOfStock || sizeLOutOfStock) {
      score += 35;
      reasons.push(`Đã cháy hàng size ${sizeMOutOfStock ? 'M' : 'L'} (size bán chạy nhất)`);
      isWinning = true;
    } else if (anySizeOutOfStock) {
      score += 20;
      reasons.push(`Có size lẻ đã hết hàng`);
    }

    // B. Kiểm tra nhãn Best-Seller / Bán chạy / Xu hướng
    const isBestSeller = tagsLower.includes('best-seller') ||
      tagsLower.includes('bestseller') ||
      tagsLower.includes('bán chạy') ||
      titleLower.includes('best seller') ||
      (item.collections && item.collections.toLowerCase().includes('best'));

    if (isBestSeller) {
      score += 30;
      reasons.push(`Được xếp vào danh mục Best-Seller của thương hiệu`);
      isWinning = true;
    }

    // C. Kiểm tra trạng thái Restock (Mở bán lại)
    if (tagsLower.includes('restock') || titleLower.includes('restock') || item.isRestocked) {
      score += 35;
      reasons.push(`Sản phẩm được Restock (Mở bán lại sau khi cháy hàng)`);
      isWinning = true;
    }
  }

  // Giới hạn điểm từ 0 đến 100
  const finalScore = Math.min(100, Math.max(0, score));

  // Phân loại mức độ ưu tiên
  let priority = 'LOW';
  let badge = '💤 [ROUTINE - BÌNH THƯỜNG]';

  if (finalScore >= 70 || isWinning) {
    priority = 'HIGH';
    badge = sourceType === 'shopify' || sourceType === 'custom_web'
      ? '🔥 [MẪU BÁN CHẠY THỰC TẾ]'
      : '🔥 [HIGH - WINNING SIGNAL]';
  } else if (finalScore >= 45) {
    priority = 'MEDIUM';
    badge = '🧪 [MEDIUM - TESTING]';
  }

  const signalReason = reasons.length > 0 
    ? reasons.join(' • ') 
    : 'Dữ liệu thông thường, chưa ghi nhận đột phá';

  return {
    winningScore: finalScore,
    priority,
    signalReason,
    badge,
    isWinning: priority === 'HIGH'
  };
}

/**
 * Áp dụng bộ lọc và sắp xếp danh sách item theo mức độ "Mỏ vàng"
 */
function scoreAndFilterItems(items, sourceType) {
  if (!Array.isArray(items)) return [];

  return items.map(item => {
    const evalResult = evaluateWinningSignal(item, sourceType);
    return {
      ...item,
      winningScore: evalResult.winningScore,
      priority: evalResult.priority,
      signalReason: evalResult.signalReason,
      badge: evalResult.badge,
      isWinning: evalResult.isWinning,
    };
  }).sort((a, b) => b.winningScore - a.winningScore);
}

module.exports = {
  evaluateWinningSignal,
  scoreAndFilterItems,
};
