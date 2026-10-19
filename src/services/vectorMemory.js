const { supabase } = require('./supabase');
const { getEmbedding } = require('./gemini');
const fs = require('fs');
const path = require('path');

const localDbPath = path.resolve(__dirname, '../../data/local_db.json');

/**
 * Đọc dữ liệu local DB an toàn
 */
function getLocalDb() {
  try {
    if (!fs.existsSync(localDbPath)) {
      return { tracked_targets: [], scraped_items: [], scraping_queue: [], analysis_embeddings: [] };
    }
    const data = JSON.parse(fs.readFileSync(localDbPath, 'utf-8'));
    data.analysis_embeddings = data.analysis_embeddings || [];
    data.scraping_queue = data.scraping_queue || [];
    return data;
  } catch (err) {
    return { tracked_targets: [], scraped_items: [], scraping_queue: [], analysis_embeddings: [] };
  }
}

function saveLocalDb(data) {
  try {
    fs.writeFileSync(localDbPath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('❌ Lỗi ghi Local DB Vector:', err.message);
  }
}

/**
 * Tính Cosine Similarity giữa 2 vector float array
 */
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dotProduct / denominator;
}

/**
 * Lưu trữ bản phân tích và vector embedding vào Supabase (pgvector) hoặc Local DB
 */
async function saveAnalysisEmbedding({
  queue_id = null,
  source = 'website',
  brand,
  title,
  winning_score = 0,
  priority = 'LOW',
  core_insight = '',
  angles = null,
  full_analysis
}) {
  // Tạo vector embedding 768 chiều từ Gemini
  const textToEmbed = `${brand} - ${title}. Insight: ${core_insight}. Chi tiết: ${full_analysis.slice(0, 1500)}`;
  const embedding = await getEmbedding(textToEmbed);

  const record = {
    queue_id,
    source,
    brand: brand || 'Đối thủ',
    title: title || 'Mẫu đồ ngủ',
    winning_score,
    priority,
    core_insight,
    angles,
    full_analysis,
    created_at: new Date().toISOString()
  };

  // 1. Lưu vào Supabase pgvector nếu có
  if (supabase && embedding) {
    try {
      const { data, error } = await supabase
        .from('analysis_embeddings')
        .insert({
          ...record,
          embedding
        })
        .select();

      if (!error && data) {
        console.log(`🧠 [Vector Memory] Đã lưu embedding vào Supabase pgvector cho: ${brand} - ${title}`);
        return data[0];
      }
    } catch (err) {
      console.warn(`⚠️ Lưu vector vào Supabase thất bại (${err.message}), lưu vào Local DB...`);
    }
  }

  // 2. Fallback sang Local DB
  const local = getLocalDb();
  local.analysis_embeddings.push({
    id: local.analysis_embeddings.length + 1,
    ...record,
    embedding // Mảng float 768 chiều
  });

  // Giới hạn 500 bản ghi gần nhất trong Local DB để nhẹ máy
  if (local.analysis_embeddings.length > 500) {
    local.analysis_embeddings = local.analysis_embeddings.slice(-400);
  }

  saveLocalDb(local);
  console.log(`🧠 [Vector Memory] Đã lưu embedding vào Local DB cho: ${brand} - ${title}`);
  return record;
}

/**
 * Tìm kiếm tương đồng ngữ nghĩa (Semantic Search) qua Vector
 */
async function searchSimilarAnalyses(queryText, limit = 5, matchThreshold = 0.4) {
  const queryEmbedding = await getEmbedding(queryText);
  if (!queryEmbedding) {
    return [];
  }

  // 1. Thử gọi RPC match_analyses trên Supabase
  if (supabase) {
    try {
      const { data, error } = await supabase.rpc('match_analyses', {
        query_embedding: queryEmbedding,
        match_threshold: matchThreshold,
        match_count: limit
      });

      if (!error && Array.isArray(data) && data.length > 0) {
        return data;
      }
    } catch (err) {
      // Fallback
    }
  }

  // 2. Fallback sang Local DB tính Cosine Similarity trực tiếp
  const local = getLocalDb();
  const scored = [];

  for (const item of local.analysis_embeddings || []) {
    if (item.embedding && Array.isArray(item.embedding)) {
      const sim = cosineSimilarity(queryEmbedding, item.embedding);
      if (sim >= matchThreshold) {
        scored.push({
          id: item.id,
          brand: item.brand,
          title: item.title,
          priority: item.priority,
          winning_score: item.winning_score,
          core_insight: item.core_insight,
          angles: item.angles,
          full_analysis: item.full_analysis,
          similarity: Math.round(sim * 100) / 100
        });
      }
    }
  }

  return scored.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
}

/**
 * Lấy danh sách các phân tích trong N ngày qua (cho lệnh /trend_tuan)
 */
async function getRecentAnalyses(days = 14, limit = 25) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('analysis_embeddings')
        .select('id, brand, title, winning_score, priority, core_insight, created_at, full_analysis')
        .gte('created_at', cutoff)
        .order('winning_score', { ascending: false })
        .limit(limit);

      if (!error && data && data.length > 0) return data;
    } catch (err) {
      // Fallback
    }
  }

  const local = getLocalDb();
  return (local.analysis_embeddings || [])
    .filter(item => item.created_at >= cutoff)
    .sort((a, b) => (b.winning_score || 0) - (a.winning_score || 0))
    .slice(0, limit);
}

/**
 * Lấy lịch sử phân tích của 1 thương hiệu đối thủ cụ thể (cho lệnh /so_sanh)
 */
async function getAnalysesByBrand(brandName, limit = 10) {
  const query = brandName.trim().toLowerCase();

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('analysis_embeddings')
        .select('id, brand, title, winning_score, priority, core_insight, created_at, full_analysis')
        .ilike('brand', `%${query}%`)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (!error && data && data.length > 0) return data;
    } catch (err) {
      // Fallback
    }
  }

  const local = getLocalDb();
  return (local.analysis_embeddings || [])
    .filter(item => (item.brand || '').toLowerCase().includes(query))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, limit);
}

module.exports = {
  saveAnalysisEmbedding,
  searchSimilarAnalyses,
  getRecentAnalyses,
  getAnalysesByBrand,
};
