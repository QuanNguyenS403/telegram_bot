# 🤖 CHIEF SLEEPWEAR COMPETITIVE INTELLIGENCE AI (V2)
### Hệ thống Tình báo Cạnh tranh & Phân tích Chiến lược Đồ ngủ / Loungewear Cấp cao

Hệ thống tự động hóa toàn diện giúp các thương hiệu thời trang đồ ngủ theo dõi đối thủ (Shopify, Web thuần HTML, Meta Ads, TikTok), lọc tín hiệu chiến thắng (Winning Signals), phân tích rập may và chiến lược marketing bằng mô hình **Google Gemini 3.8 Flash Vision**, đồng thời tích hợp **Trí nhớ Dài hạn Vector (pgvector)** và **Hàng đợi Bất đồng bộ (Async Queue Worker)**.

---

## 🌟 5 ĐỘT PHÁ NÂNG CẤP MỚI (PHIÊN BẢN V2)

### 1. 🎯 Bộ Lọc "Tín Hiệu Chiến Thắng" (Winning Signal Filter Middleware)
Thay vì chuyển toàn bộ dữ liệu thô sang AI, hệ thống chấm điểm ở tầng Middleware để phân loại đâu là "mỏ vàng" cần mổ xẻ sâu:
* **Meta Ad Library**: Tự động tính số ngày quảng cáo chạy liên tục. Các mẫu chạy từ **10 ngày trở lên** hoặc có từ **3 biến thể Creative** cho cùng mã hàng được gắn nhãn `[🔥 WINNING AD]`.
* **TikTok / Reels / Instagram**: Tính chỉ số **Engagement Velocity** (tương tác/giờ) và **Tỷ lệ Lưu (Save) & Chia sẻ (Share)** trên Views/Likes. Lượt Save & Share phản ánh ý định mua hàng thật sự cao hơn Like.
* **Website Đối Thủ (Shopify & Web Thuần)**: Quét tồn kho theo từng size (S, M, L). Nếu liên tục hết size chủ đạo M/L hoặc được mở bán lại (Restock), bot tự động gắn nhãn `[🔥 MẪU BÁN CHẠY THỰC TẾ]`.

### 2. ⚡ Kiến Trúc Hàng Đợi Bất Đồng Bộ (Webhook + Queue Worker)
* **Tách rời bước cào & phân tích**: Quá trình cào dữ liệu đẩy các mục đã chấm điểm vào bảng `scraping_queue` (trạng thái `pending`).
* **Máy chủ Webhook Apify**: Tích hợp sẵn endpoint `POST /api/webhook/apify` để tự động nhận dữ liệu đối thủ từ Apify Actor khi cào xong.
* **Xử lý theo lô (Batch Worker)**: Queue Worker chạy ngầm mỗi 2 phút, lấy 3-5 bản ghi ưu tiên cao nhất (`HIGH - WINNING SIGNAL`) chuyển sang Gemini Vision phân tích. Đảm bảo bot hoạt động 24/7 mượt mà, **không bao giờ nghẽn RAM hay chạm giới hạn rate limit**.

### 3. ✂️ Chuẩn Hóa "Từ Điển Kỹ Thuật Đồ Ngủ (Sleepwear Taxonomy)"
Gemini Vision được ép soi chiếu sản phẩm qua 2 lăng kính chuyên ngành:
* **Lăng kính 1: Giải phẫu Thiết kế & Rập (Garment & Pattern Anatomy)**: Form dáng (suông rộng, chiết eo nhẹ, babydoll, kimono), kiểu cổ (pijama ve lật, cổ sen, cổ vuông, cami), chi tiết hoàn thiện đắt giá (viền lé piping 3-5mm tương phản, ren mi, nhún bèo, cúc bọc vải/ngọc trai, chun chống hằn), dự đoán chất liệu (lụa Latin, satin, đũi tơ, modal).
* **Lăng kính 2: Giải phẫu Thị giác & Concept (Visual & Art Direction)**: Bối cảnh (phòng ngủ đón nắng, luxury bath, ban công xanh mát), ánh sáng (warm cozy, bright airy, moody), chuyển động khoe độ rủ của tà áo và góc máy macro zoom cận đường kim mũi chỉ.

### 4. 🚀 Thuật Toán "1 Core Insight → Đa Góc Tiếp Cận (Multi-Angle Matrix)"
Giúp thương hiệu bán sâu 1 mã hàng số lượng lớn mà không cạn ý tưởng:
* **1 Core Insight Cố Định**: Nỗi đau hoặc khao khát sâu nhất của khách hàng mục tiêu.
* **Ma Trận 4 Góc Tiếp Cận (4 Marketing Angles)**:
  * **Angle 1 - Cảm xúc & Khí chất (Emotional/Identity)**: Yêu bản thân (self-love), giữ khí chất tiểu thư/quý cô khi ở nhà.
  * **Angle 2 - Lý tính & Công năng (Functional/Material)**: Mát mẻ, không nhăn nhúm khi giặt máy, không cọ xát ngứa ngáy khi ngủ say.
  * **Angle 3 - Bối cảnh & Tình huống (Situational)**: Lịch sự khi tiếp khách/shipper tại nhà; đi du lịch/staycation/pajama party cùng bạn bè.
  * **Angle 4 - Bằng chứng & So sánh (Proof/Comparison)**: So sánh đường viền lé, form chuẩn tôn dáng so với hàng chợ giá rẻ gia công ẩu.

### 5. 🧠 Trí Nhớ Dài Hạn & Truy Vấn Xu Hướng Bằng Vector (pgvector)
* Tích hợp **Google Gemini Embedding (768 chiều)** và **pgvector** trên Supabase (kèm bộ tính Cosine Similarity cục bộ cho Local DB).
* Tự động vector hóa toàn bộ bản phân tích đối thủ để phục vụ tìm kiếm ngữ nghĩa (Semantic Search).
* Bổ sung các lệnh tra cứu xu hướng vĩ mô: `/trend_tuan`, `/so_sanh`, `/tim_y_tuong`.

---

## 📁 CẤU TRÚC THƯ MỤC DỰ ÁN

```text
d:\Telegram Bot\
├── src/
│   ├── config.js              # Quản lý & kiểm tra biến môi trường
│   ├── bot.js                 # Bộ điều khiển Telegram Bot & Lệnh tương tác V2
│   └── services/
│       ├── signals.js         # [MỚI] Bộ lọc Tín hiệu Chiến thắng (Winning Signal Filter)
│       ├── taxonomy.js        # [MỚI] Từ điển Kỹ thuật Đồ ngủ (Sleepwear Taxonomy)
│       ├── queue.js           # [MỚI] Hàng đợi Bất đồng bộ & Máy chủ Webhook Apify
│       ├── vectorMemory.js    # [MỚI] Trí nhớ Dài hạn & Tìm kiếm tương đồng Vector
│       ├── gemini.js          # Phân tích Gemini 3.8 Flash & Ma trận 4 Góc tiếp cận
│       ├── scrapers.js        # Bộ thu thập dữ liệu (Shopify, Web thuần HTML, Trends RSS, Apify)
│       ├── supabase.js        # Quản lý dữ liệu Supabase & Local DB
│       └── sheets.js          # Ghi dữ liệu vào Google Sheets (tùy chọn)
├── data/
│   └── local_db.json          # Cơ sở dữ liệu cục bộ 100% miễn phí (Hỗ trợ Queue & Vector)
├── schema.sql                 # DDL khởi tạo cơ sở dữ liệu Supabase (pgvector & queue)
├── .env                       # Cấu hình biến môi trường
├── .env.example               # Mẫu thiết lập biến môi trường
├── index.js                   # Điểm khởi động ứng dụng
└── README.md                  # Hướng dẫn chi tiết
```

---

## 📱 BẢNG LỆNH ĐIỀU KHIỂN TELEGRAM (V2)

| Lệnh | Ý nghĩa | Ví dụ |
| :--- | :--- | :--- |
| **`/trend_tuan`** | **[MỚI]** Tổng hợp bức tranh xu hướng 7-14 ngày qua từ Trí nhớ Dài hạn Vector (Dịch chuyển rập may, bảng màu, concept chụp) | `/trend_tuan` |
| **`/so_sanh`** | **[MỚI]** So sánh chiến lược, mức giá và phong cách của 1 đối thủ cụ thể với thị trường chung | `/so_sanh Eberjey` |
| **`/tim_y_tuong`** | **[MỚI]** Tìm kiếm tương đồng vector (Semantic Search) để lấy ngay Core Insight & Ma trận 4 Góc tiếp cận cho mã hàng | `/tim_y_tuong Pijama lụa cổ sen viền ren` |
| **`/queue`** | **[MỚI]** Kiểm tra số lượng mục Pending, Processing, Completed và Winning Signals trong Hàng đợi Bất đồng bộ | `/queue` |
| `/scan` | Kích hoạt quét thị trường, chấm điểm tín hiệu chiến thắng và đưa vào hàng đợi | `/scan` |
| `/list_brands` | Xem danh sách thương hiệu & chiến dịch đang theo dõi | `/list_brands` |
| `/add_brand` | Thêm website đối thủ (Tự nhận diện Shopify hoặc Web thuần HTML) | `/add_brand Lunya \| https://lunya.co` |
| `/add_site` | Thêm trực tiếp website code thuần HTML / Index | `/add_site Pijama VN \| https://dongu.vn` |
| `/add_ad` | Thêm đường dẫn quét Meta Ad Library | `/add_ad Pijama Lụa \| https://facebook.com/ads/...` |
| `/spy` | Mổ xẻ 3s Hook, Visual Hook, Mạch giữ chân & Kịch bản Remix TikTok/Reels | `/spy https://vt.tiktok.com/...` |
| `/retention` | Tư vấn chiến lược Membership Pajama VIP Club, Ma trận Voucher & Quà tặng GWP | `/retention Pijama lụa cao cấp` |
| `/insight` | Bóc tách Chân dung khách hàng & Động lực mua hàng cốt lõi | `/insight Đồ ngủ mặc nhà sang trọng` |
| 🔗 *Dán link MXH* | Dán link video TikTok/Reels/Shorts vào chat, bot tự động Spy ngay lập tức | `https://vt.tiktok.com/...` |
| 📸 *Gửi ảnh mẫu* | Gửi ảnh mẫu đồ ngủ (AI soi rập & bối cảnh) HOẶC ảnh chụp quảng cáo kèm chữ `/spy` | Gửi ảnh trực tiếp vào chat |

---

## 🛠️ KHỞI CHẠY HỆ THỐNG LIÊN TỤC 24/7

### Chạy nền chuyên nghiệp với PM2
```bash
npm install -g pm2
pm2 start index.js --name "sleepwear-bot"
pm2 save
```
* Xem trạng thái tiến trình: `pm2 status`
* Xem nhật ký hoạt động: `pm2 logs sleepwear-bot`
* Khởi động lại khi cập nhật code: `pm2 restart sleepwear-bot --update-env`

### Endpoint Webhook Apify
Khi cấu hình webhook trên Apify Console, bạn có thể trỏ về:
```http
POST http://<IP_HOẶC_DOMAIN_CỦA_BẠN>:3000/api/webhook/apify
Content-Type: application/json
```
Bot sẽ tự động tiếp nhận dữ liệu cào, chấm điểm tín hiệu và phân tích tuần tự.
