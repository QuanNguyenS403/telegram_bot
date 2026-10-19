-- ========================================================
-- DATABASE SCHEMA: TELEGRAM AI SPY & MARKET RESEARCH BOT (V2)
-- Hệ quản trị cơ sở dữ liệu: Supabase (PostgreSQL) hoặc Local DB
-- Hỗ trợ: Async Queue Worker & Long-Term Vector Memory (pgvector)
-- ========================================================

-- 0. KÍCH HOẠT EXTENSION PGVECTOR TRÊN SUPABASE (Trí nhớ dài hạn)
CREATE EXTENSION IF NOT EXISTS vector;

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

-- 3. NÂNG CẤP 2: BẢNG HÀNG ĐỢI BẤT ĐỒNG BỘ (SCRAPING_QUEUE)
-- Tách rời bước cào (Scraping) và bước phân tích AI (Batch Worker)
CREATE TABLE IF NOT EXISTS scraping_queue (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL,                                       -- 'shopify', 'custom_web', 'meta_ads', 'tiktok', 'social'
  external_id TEXT NOT NULL UNIQUE,                           -- Khóa định danh duy nhất
  brand TEXT,                                                 -- Tên thương hiệu đối thủ
  title TEXT,                                                 -- Tiêu đề sản phẩm / quảng cáo
  winning_score INT DEFAULT 0,                                -- Điểm chấm tín hiệu chiến thắng (0-100)
  priority TEXT DEFAULT 'LOW' CHECK (priority IN ('HIGH', 'MEDIUM', 'LOW')), -- Phân loại ưu tiên
  signal_reason TEXT,                                         -- Lý do: "Chạy Ads 14 ngày", "Hết size M/L", "Lưu/Share cao"
  raw_data JSONB NOT NULL,                                    -- Dữ liệu chi tiết đính kèm ảnh
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts INT DEFAULT 0,                                     -- Số lần thử lại nếu gặp sự cố
  error_message TEXT,                                         -- Ghi chú lỗi nếu thất bại
  analysis_result TEXT,                                       -- Kết quả phân tích Gemini AI
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scraping_queue_status_prio ON scraping_queue(status, winning_score DESC, created_at ASC);

-- 4. NÂNG CẤP 5: TRÍ NHỚ DÀI HẠN & VECTO HÓA (ANALYSIS_EMBEDDINGS)
-- Lưu trữ bản giải phẫu kèm vector embedding (768 chiều từ Gemini) để truy vấn xu hướng
CREATE TABLE IF NOT EXISTS analysis_embeddings (
  id SERIAL PRIMARY KEY,
  queue_id INT REFERENCES scraping_queue(id) ON DELETE SET NULL,
  source TEXT NOT NULL,                                       -- Nguồn gốc
  brand TEXT NOT NULL,                                        -- Thương hiệu đối thủ
  title TEXT NOT NULL,                                        -- Tên sản phẩm / bài quảng cáo
  winning_score INT DEFAULT 0,                                -- Điểm tín hiệu chiến thắng
  priority TEXT DEFAULT 'LOW',
  core_insight TEXT,                                          -- 1 Core Insight cốt lõi (bán sâu 1 mã hàng)
  angles JSONB,                                               -- 4 Marketing Angles (Cảm xúc, Công năng, Tình huống, Bằng chứng)
  full_analysis TEXT NOT NULL,                                -- Toàn bộ báo cáo định dạng chuẩn
  embedding vector(768),                                      -- Vector 768 chiều (Gemini Embedding)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analysis_embeddings_brand ON analysis_embeddings(brand);
CREATE INDEX IF NOT EXISTS idx_analysis_embeddings_created ON analysis_embeddings(created_at DESC);

-- Hàm truy vấn tìm kiếm tương đồng vector (Cosine Similarity)
CREATE OR REPLACE FUNCTION match_analyses (
  query_embedding vector(768),
  match_threshold float DEFAULT 0.5,
  match_count int DEFAULT 5
)
RETURNS TABLE (
  id int,
  brand text,
  title text,
  priority text,
  winning_score int,
  core_insight text,
  angles jsonb,
  full_analysis text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    analysis_embeddings.id,
    analysis_embeddings.brand,
    analysis_embeddings.title,
    analysis_embeddings.priority,
    analysis_embeddings.winning_score,
    analysis_embeddings.core_insight,
    analysis_embeddings.angles,
    analysis_embeddings.full_analysis,
    1 - (analysis_embeddings.embedding <=> query_embedding) AS similarity
  FROM analysis_embeddings
  WHERE 1 - (analysis_embeddings.embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;

-- 5. Dữ liệu mẫu khởi tạo ban đầu (Shopify, Web thuần, Meta Ads)
INSERT INTO tracked_targets (type, name, url) VALUES
  ('shopify', 'Eberjey', 'https://eberjey.com/products.json?limit=5'),
  ('shopify', 'Cozy Earth', 'https://cozyearth.com/products.json?limit=5'),
  ('shopify', 'PJ Salvage', 'https://pjsalvage.com/products.json?limit=5'),
  ('meta_ads', 'Meta Ads: Sleepwear US', 'https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&q=sleepwear&search_type=keyword_unordered'),
  ('meta_ads', 'Meta Ads: Silk Pajamas US', 'https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&q=%22silk%20pajamas%22&search_type=keyword_exact_phrase')
ON CONFLICT (url) DO NOTHING;
