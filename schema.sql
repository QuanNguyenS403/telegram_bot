-- ========================================================
-- DATABASE SCHEMA: TELEGRAM AI SPY & MARKET RESEARCH BOT
-- Hệ quản trị cơ sở dữ liệu: Supabase (PostgreSQL) hoặc Local DB
-- ========================================================

-- 1. Bảng lưu danh sách mục tiêu theo dõi (Shopify, Web thuần HTML, Meta Ads)
CREATE TABLE IF NOT EXISTS tracked_targets (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('shopify', 'custom_web', 'meta_ads')), -- Loại mục tiêu
  name TEXT NOT NULL,                                                     -- Tên thương hiệu hoặc chiến dịch
  url TEXT NOT NULL UNIQUE,                                               -- Đường dẫn quét dữ liệu
  is_active BOOLEAN DEFAULT TRUE,                                         -- Trạng thái bật/tắt theo dõi
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tracked_targets_type_active ON tracked_targets(type, is_active);

-- 2. Bảng lưu lịch sử các sản phẩm & quảng cáo đã quét (chống trùng lặp báo cáo)
CREATE TABLE IF NOT EXISTS scraped_items (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL,                                       -- Nguồn: 'shopify', 'custom_web', 'fb_ads', 'tiktok'
  external_id TEXT NOT NULL UNIQUE,                           -- Khóa định danh duy nhất (vd: shopify_123, custom_abc, fb_ad_456)
  brand TEXT,                                                 -- Tên thương hiệu
  title TEXT,                                                 -- Tiêu đề sản phẩm hoặc nội dung trích lược
  raw_data JSONB,                                             -- Toàn bộ dữ liệu bóc tách được
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scraped_items_external_id ON scraped_items(external_id);
CREATE INDEX IF NOT EXISTS idx_scraped_items_created_at ON scraped_items(created_at DESC);

-- 3. Dữ liệu mẫu khởi tạo ban đầu (Shopify, Web thuần, Meta Ads)
INSERT INTO tracked_targets (type, name, url) VALUES
  ('shopify', 'Eberjey', 'https://eberjey.com/products.json?limit=5'),
  ('shopify', 'Cozy Earth', 'https://cozyearth.com/products.json?limit=5'),
  ('shopify', 'PJ Salvage', 'https://pjsalvage.com/products.json?limit=5'),
  ('meta_ads', 'Meta Ads: Sleepwear US', 'https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&q=sleepwear&search_type=keyword_unordered'),
  ('meta_ads', 'Meta Ads: Silk Pajamas US', 'https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&q=%22silk%20pajamas%22&search_type=keyword_exact_phrase')
ON CONFLICT (url) DO NOTHING;
