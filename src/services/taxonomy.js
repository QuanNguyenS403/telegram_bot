/**
 * ========================================================
 * NÂNG CẤP 3: TỪ ĐIỂN KỸ THUẬT ĐỒ NGỦ (SLEEPWEAR TAXONOMY)
 * Chuẩn hóa 2 lăng kính cố định cho Gemini Vision:
 * 1. Giải phẫu Thiết kế & Rập (Garment & Pattern Anatomy)
 * 2. Giải phẫu Thị giác & Concept (Visual & Art Direction)
 * ========================================================
 */

const SLEEPWEAR_TAXONOMY = {
  // LĂNG KÍNH 1: THIẾT KẾ & RẬP
  garmentAnatomy: {
    silhouettes: [
      'Suông rộng phóng khoáng (Relaxed / Oversized)',
      'Chiết eo nhẹ tôn dáng (Soft-tailored)',
      'Babydoll xòe bồng giấu bụng',
      'Set Pijama truyền thống (Áo tay ngắn/dài + Quần đùi/dài)',
      'Váy ngủ hai dây suông rủ (Slip dress / Cami dress)',
      'Áo choàng Kimono khoác ngoài (Robes) thắt nơ eo'
    ],
    collars: [
      'Cổ pijama bẻ ve lật cổ điển (Notched collar)',
      'Cổ sen lãng mạn tiểu thư (Peter Pan collar)',
      'Cổ chữ V xẻ sâu thanh mảnh quyến rũ',
      'Cổ vuông phong cách Pháp cổ điển (Square neck)',
      'Hai dây bản mảnh thanh thoát (Spaghetti straps)'
    ],
    craftsmanshipDetails: [
      'Chạy viền lé (Piping) tương phản màu bản 3mm-5mm ở ve cổ, nẹp áo và gấu tay/quần',
      'Phối ren mi cao cấp (Eyelash lace) ở viền ngực, gấu áo hoặc xẻ tà sườn',
      'Nhún bèo tầng nữ tính (Ruffles) tạo độ bồng mềm mại',
      'Cúc bọc vải cùng màu đồng điệu tinh tế hoặc cúc ngọc trai / xà cừ sang trọng',
      'Chun quần bọc vải lụa êm ái chống hằn bụng khi ngủ sâu',
      'Túi ngực may ốp có thêu logo hoặc viền lé định hình form'
    ],
    fabricsAndTextures: [
      'Lụa Satin / Lụa Latin: Bắt sáng mịn màng, mềm mướt không nhăn, độ rủ cao',
      'Đũi tơ / Đũi xước tự nhiên: Thoáng khí, mộc mạc thư thái cho khí hậu nóng ẩm',
      'Cotton Modal / Tencel: Co giãn 4 chiều mềm như da em bé, thấm hút mồ hôi vượt trội',
      'Voan tơ / Chiffon: Xuyên thấu nhẹ nhàng bay bổng lãng mạn'
    ]
  },

  // LĂNG KÍNH 2: THỊ GIÁC & ART DIRECTION
  visualDirection: {
    settings: [
      'Indoor Phòng ngủ ngập tràn ánh nắng sớm (Sunlit cozy bedroom, drap trắng tinh khôi)',
      'Phòng tắm đá cẩm thạch sang trọng thư giãn (Luxury marble bathroom / Vanity mirror)',
      'Lifestyle Ban công / Sân vườn xanh mát (Bàn trà, sách, tách cà phê thư thả cuối tuần)',
      'Studio phông nền màu Pastel / Trung tính tối giản tập trung 100% vào trang phục'
    ],
    lightingMoods: [
      'Warm Cozy: Tông màu ấm áp, tạo cảm giác thư giãn, an toàn và dễ chịu',
      'Bright Airy: Ánh sáng ban ngày tự nhiên trong trẻo, làm nổi bật chất liệu thật của vải',
      'Moody & Seductive: Ánh sáng tương phản nghệ thuật, tôn nét quyến rũ bí ẩn'
    ],
    modelPosing: [
      'Posing thư giãn đời thường: Ngồi xếp bằng đọc sách, uống trà, vươn vai chào ngày mới',
      'Chuyển động tự nhiên (Movement in motion): Xoay người, bước đi nhẹ để khoe độ bay rủ của tà áo',
      'Macro Shot: Góc máy zoom cận cảnh đường kim mũi chỉ, mặt cúc và độ bóng mịn của sợi dệt'
    ]
  }
};

/**
 * Tạo khối hướng dẫn phân tích theo Từ điển kỹ thuật đồ ngủ cho Gemini Prompt
 */
function getTaxonomyPromptSection() {
  return `
--- TỪ ĐIỂN KỸ THUẬT ĐỒ NGỦ CHUẨN MỰC (BẮT BUỘC ĐỐI CHIẾU KHI SOI ẢNH) ---
Khi quan sát hình ảnh sản phẩm hoặc creative quảng cáo, bạn PHẢI soi chiếu qua đúng 2 lăng kính chuyên ngành:

LĂNG KÍNH 1: GIẢI PHẪU THIẾT KẾ & RẬP (GARMENT & PATTERN ANATOMY):
- Form dáng: Nhận diện chính xác (Suông rộng, Chiết eo nhẹ, Babydoll, Pijama set cộc/dài, Váy ngủ 2 dây slip dress, hay Áo choàng Kimono).
- Kiểu cổ: Cổ pijama ve lật, Cổ sen tiểu thư, Cổ chữ V quyến rũ, Cổ vuông Pháp, hay Hai dây bản mảnh.
- Kỹ thuật hoàn thiện đắt giá: Chạy viền lé tương phản (piping), Phối ren mi, Nhún bèo tầng, Cúc bọc vải hay cúc ngọc trai, Chun quần bọc vải chống hằn.
- Chất liệu & Bề mặt vải: Phân tích dựa trên độ bắt sáng và nếp rủ (Lụa Satin bóng mịn, Lụa Latin mềm mướt, Đũi tơ mộc mạc, Cotton Modal co giãn thấm hút, hay Voan tơ xuyên thấu).

LĂNG KÍNH 2: GIẢI PHẪU THỊ GIÁC & ART DIRECTION (VISUAL & ART DIRECTION):
- Bối cảnh (Setting): Indoor giường ngủ đón nắng, Phòng tắm sang trọng, Ban công sân vườn thư giãn, hay Studio tối giản.
- Tâm trạng ánh sáng (Lighting Mood): Warm cozy ấm áp, Bright airy trong trẻo, hay Moody quyến rũ.
- Ngôn ngữ cơ thể (Posing): Đời thường thư thái (đọc sách, uống trà), Chuyển động khoe độ rủ của tà vải, hay Góc cận macro tôn đường may.
-----------------------------------------------------------------------
`;
}

module.exports = {
  SLEEPWEAR_TAXONOMY,
  getTaxonomyPromptSection,
};
