# 🤖 HỆ THỐNG BOT TELEGRAM AI SPY & NGHIÊN CỨU THỊ TRƯỜNG ĐỒ NGỦ (SLEEPWEAR / LOUNGEWEAR)

Hệ thống tự động hóa toàn diện giúp doanh nghiệp thời trang đồ ngủ theo dõi đối thủ quốc tế (Shopify & Web code thuần HTML), nghiên cứu xu hướng nội dung mạng xã hội và phân tích rập may/chiến dịch quảng cáo bằng trí tuệ nhân tạo đa phương thức **Google Gemini Vision**.

> 💡 **Đặc biệt: Hệ thống được thiết kế chạy 100% MIỄN PHÍ (Free Tier)** với Cơ sở dữ liệu Cục bộ tích hợp sẵn (không bắt buộc cài đặt Supabase), API Google Gemini Free Tier và bộ cào trực tiếp qua Axios/Cheerio.

---

## 🌟 TÍNH NĂNG NỔI BẬT

1. **Quét Website Đối thủ Đa dạng (Shopify & Web Code Thuần HTML/Index)**:
   - **Shopify**: Tự động bóc tách từ các thương hiệu lớn (*Eberjey, Cozy Earth, PJ Salvage...*) qua endpoint `products.json`.
   - **Web Code Thuần (Custom HTML / Index)**: Bóc tách sản phẩm, hình ảnh, giá bán, link từ bất kỳ website thời trang nào qua **Schema.org JSON-LD**, **OpenGraph Meta Tags** hoặc cấu trúc thẻ sản phẩm HTML.
   - **Cơ chế chống trùng lặp**: Tự động hash mã `external_id` lưu vào Local DB (hoặc Supabase) để không bao giờ báo cáo lại sản phẩm cũ.

2. **Quét Xu hướng Thị trường & Ads (100% Miễn phí hoặc Apify)**:
   - **100% Free**: Tự động thu thập các xu hướng thời trang mặc nhà từ Google Fashion Trends RSS.
   - **Mở rộng (Apify Free Tier)**: Cào video TikTok theo hashtag `#sleepwear`, `#loungewear`, `#pajamasets` và Meta Ad Library (chụp ảnh banner/thumbnail video, caption, nút CTA, trang đích).

3. **Phân tích Đa phương thức bằng Gemini Vision (Free Tier)**:
   - AI trực tiếp quan sát ảnh sản phẩm thực tế để soi **thiết kế rập (pattern), form dáng, đường viền lé (piping), cúc, độ bóng/rũ của vải, bảng màu xu hướng**.
   - Mổ xẻ **concept chụp lookbook, góc máy, ánh sáng, cách người mẫu tạo dáng (posing)** từ ảnh quảng cáo đối thủ.
   - Đúc kết insight và đề xuất mẫu may, ý tưởng chụp ảnh phù hợp với khí hậu và thị hiếu tại Việt Nam.

4. **Gửi Album Ảnh Trực quan & Báo cáo Telegram**:
   - Tự động gom ảnh sản phẩm mới và ảnh quảng cáo thành các Album (`MediaGroup`) tối đa 10 ảnh gửi thẳng về Telegram.
   - Báo cáo chiến lược của AI được chia nhỏ tự động để không vượt quá giới hạn tin nhắn Telegram.

5. **Phân tích Ảnh Tức thì (Interactive Photo Vision)**:
   - Bạn chỉ cần gửi bất kỳ bức ảnh mẫu đồ ngủ nào vào khung chat Telegram, Bot sẽ phân tích chi tiết kỹ thuật may rập và bối cảnh chụp ảnh trong vài giây.

6. **Tùy chọn Lưu trữ Đa năng (Local DB hoặc Supabase)**:
   - Mặc định sử dụng **Local DB (`data/local_db.json`)** miễn phí 100%, không cần đăng ký tài khoản.
   - Hỗ trợ kết nối Supabase Cloud nếu cần đồng bộ đa thiết bị.

---

## 📁 CẤU TRÚC THƯ MỤC DỰ ÁN

```text
d:\Telegram Bot\
├── src/
│   ├── config.js              # Quản lý & kiểm tra biến môi trường
│   ├── bot.js                 # Bộ điều khiển Telegram Bot & Lập lịch Cron
│   └── services/
│       ├── supabase.js        # Quản lý dữ liệu (Hỗ trợ cả Local DB & Supabase)
│       ├── gemini.js          # Phân tích đa phương thức với Google Gemini Vision
│       ├── scrapers.js        # Bộ thu thập dữ liệu (Shopify, Web thuần HTML, Trends RSS, Apify)
│       └── sheets.js          # Ghi dữ liệu vào Google Sheets (tùy chọn)
├── data/
│   └── local_db.json          # Cơ sở dữ liệu cục bộ 100% miễn phí
├── schema.sql                 # DDL khởi tạo cơ sở dữ liệu trên Supabase (nếu dùng)
├── .env                       # Cấu hình biến môi trường
├── .env.example               # Mẫu thiết lập biến môi trường
├── index.js                   # Điểm khởi động ứng dụng
└── README.md                  # Hướng dẫn chi tiết
```

---

## 🛠️ HƯỚNG DẪN CẤU HÌNH NHANH (100% MIỄN PHÍ)

Chỉ cần 2 thông tin miễn phí sau là bot có thể chạy ngay lập tức:

### BƯỚC 1: Lấy Token Bot Telegram (Miễn phí)
1. Mở Telegram, tìm bot `@BotFather`.
2. Gõ `/newbot`, làm theo hướng dẫn để đặt tên và username bot.
3. Sao chép chuỗi **HTTP API Token** điền vào `TELEGRAM_BOT_TOKEN` trong `.env`.
4. Chat bất kỳ câu nào với bot mới tạo, sau đó gõ `/id` (hoặc dùng `@userinfobot`) để lấy Chat ID của bạn điền vào `TELEGRAM_CHAT_ID`.

### BƯỚC 2: Lấy API Key Google Gemini (Miễn phí 100%)
1. Truy cập [Google AI Studio](https://aistudio.google.com/).
2. Nhấn **Get API Key** và tạo một khóa mới (hoàn toàn miễn phí, không cần thẻ tín dụng).
3. Sao chép khóa vào biến `GEMINI_API_KEY` trong file `.env`.
4. Mặc định `GEMINI_MODEL=gemini-3.8-flash` được hưởng hạn ngạch Free Tier cực lớn (15 yêu cầu/phút, 1.500 yêu cầu/ngày).

> Các biến `SUPABASE_URL`, `APIFY_TOKEN`, `GOOGLE_SHEET_ID` là **tùy chọn**. Nếu để trống, bot vẫn hoạt động đầy đủ với Local DB và các bộ cào miễn phí.

---

## 🚀 KHỞI CHẠY BOT

### Chạy trực tiếp (Development / Kiểm tra)
```bash
npm start
```

### Chạy nền liên tục 24/7 (Khuyên dùng với PM2)
```bash
npm install -g pm2
pm2 start index.js --name "sleepwear-spy-bot"
pm2 save
pm2 startup
```

---

## 📱 DANH SÁCH LỆNH ĐIỀU KHIỂN TRÊN TELEGRAM

| Lệnh | Ý nghĩa | Ví dụ |
| :--- | :--- | :--- |
| `/scan` | Kích hoạt quét toàn bộ các nguồn (Shopify, Web thuần, Trends) và xuất báo cáo AI ngay | `/scan` |
| `/list_brands` | Xem toàn bộ danh sách thương hiệu (Shopify & Web thuần) đang theo dõi | `/list_brands` |
| `/add_brand` | Thêm website đối thủ (Bot tự nhận diện là Shopify hay Web thuần HTML) | `/add_brand Lunya \| https://lunya.co` |
| `/add_site` | Thêm trực tiếp website code thuần HTML / Index không qua Shopify | `/add_site Pijama VN \| https://dongucaocap.vn/san-pham` |
| `/add_ad` | Thêm link tìm kiếm Meta Ad Library vào danh sách quét | `/add_ad Pijama Lụa \| https://www.facebook.com/ads/library/...` |
| `/spy` | **(HOT)** Phẫu thuật công thức Triệu View, 3s Hook, Mạch giữ chân & Kịch bản Remix từ link/text đối thủ | `/spy https://vt.tiktok.com/...` |
| `/retention` | Tư vấn chiến lược Membership, Voucher ma trận, Quà tặng GWP & Kéo chân khách hàng | `/retention Pijama lụa cao cấp` |
| `/insight` | Mổ xẻ Chân dung khách hàng, Động lực mua hàng ngầm hiểu & Đập tan nỗi sợ | `/insight Đồ ngủ mặc nhà cho mẹ bỉm` |
| `/remove_brand` | Xóa một mục tiêu theo dõi theo mã ID | `/remove_brand 4` |
| `/id` | Lấy mã Chat ID Telegram của bạn | `/id` |
| `/help` | Xem hướng dẫn sử dụng bot | `/help` |
| 🔗 *Dán link MXH* | Chỉ cần dán link TikTok, Reels, Shorts, Meta Ads vào chat, bot tự động Spy ngay | `https://vt.tiktok.com/...` |
| 📸 *Gửi ảnh bất kỳ* | Gửi 1 ảnh đồ ngủ (soi rập & voucher) HOẶC ảnh chụp màn hình bài post đối thủ kèm chữ `/spy` | Gửi ảnh kèm chữ `/spy` |


