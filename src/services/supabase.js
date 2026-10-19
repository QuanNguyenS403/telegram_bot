const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { config } = require('../config');

let supabase = null;
const localDbPath = path.resolve(__dirname, '../../data/local_db.json');

// Khởi tạo Supabase client nếu đã cấu hình
if (config.supabase.url && config.supabase.key) {
  try {
    supabase = createClient(config.supabase.url, config.supabase.key);
    console.log('⚡ Đã kết nối Supabase Cloud Database.');
  } catch (err) {
    console.error('❌ Lỗi khởi tạo Supabase client:', err.message);
  }
} else {
  console.log('💡 Chưa cấu hình Supabase. Hệ thống đang sử dụng Local DB (data/local_db.json) miễn phí 100%.');
}

/**
 * ==========================================
 * TRÌNH ĐIỀU KHIỂN CƠ SỞ DỮ LIỆU CỤC BỘ (LOCAL JSON DB)
 * Hoàn toàn miễn phí, không cần đăng ký tài khoản
 * ==========================================
 */
function getLocalData() {
  try {
    const dir = path.dirname(localDbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(localDbPath)) {
      const initial = {
        tracked_targets: [
          {
            id: 1,
            type: 'shopify',
            name: 'Eberjey',
            url: 'https://eberjey.com/products.json?limit=5',
            is_active: true,
            created_at: new Date().toISOString()
          },
          {
            id: 2,
            type: 'shopify',
            name: 'Cozy Earth',
            url: 'https://cozyearth.com/products.json?limit=5',
            is_active: true,
            created_at: new Date().toISOString()
          },
          {
            id: 3,
            type: 'shopify',
            name: 'PJ Salvage',
            url: 'https://pjsalvage.com/products.json?limit=5',
            is_active: true,
            created_at: new Date().toISOString()
          },
          {
            id: 4,
            type: 'meta_ads',
            name: 'Meta Ads: Sleepwear US',
            url: 'https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&q=sleepwear&search_type=keyword_unordered',
            is_active: true,
            created_at: new Date().toISOString()
          },
          {
            id: 5,
            type: 'meta_ads',
            name: 'Meta Ads: Silk Pajamas US',
            url: 'https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&q=%22silk%20pajamas%22&search_type=keyword_exact_phrase',
            is_active: true,
            created_at: new Date().toISOString()
          }
        ],
        scraped_items: []
      };
      fs.writeFileSync(localDbPath, JSON.stringify(initial, null, 2), 'utf-8');
      return initial;
    }
    const raw = fs.readFileSync(localDbPath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('❌ Lỗi đọc Local DB:', err.message);
    return { tracked_targets: [], scraped_items: [] };
  }
}

function saveLocalData(data) {
  try {
    fs.writeFileSync(localDbPath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('❌ Lỗi ghi Local DB:', err.message);
  }
}

/**
 * Lấy danh sách mục tiêu đang hoạt động theo loại ('shopify' | 'custom_web' | 'meta_ads')
 */
async function getActiveTargets(type) {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('tracked_targets')
        .select('*')
        .eq('type', type)
        .eq('is_active', true);

      if (!error && data) return data;
    } catch (err) {
      console.warn(`⚠️ Supabase gặp lỗi, chuyển sang Local DB: ${err.message}`);
    }
  }

  // Fallback sang Local DB
  const local = getLocalData();
  return (local.tracked_targets || []).filter(item => item.type === type && item.is_active);
}

/**
 * Lấy toàn bộ mục tiêu theo dõi trong database
 */
async function getAllTargets() {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('tracked_targets')
        .select('*')
        .order('id', { ascending: true });

      if (!error && data) return data;
    } catch (err) {
      console.warn(`⚠️ Supabase gặp lỗi, chuyển sang Local DB: ${err.message}`);
    }
  }

  const local = getLocalData();
  return local.tracked_targets || [];
}

/**
 * Thêm mục tiêu mới ('shopify' | 'custom_web' | 'meta_ads')
 */
async function addTarget(type, name, url) {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('tracked_targets')
        .insert({ type, name, url })
        .select();

      if (!error && data) return data;
    } catch (err) {
      console.warn(`⚠️ Thêm vào Supabase không thành công (${err.message}), lưu vào Local DB...`);
    }
  }

  const local = getLocalData();
  const existing = (local.tracked_targets || []).find(item => item.url === url);
  if (existing) {
    throw new Error(`Đường dẫn này đã tồn tại trong danh sách theo dõi (ID: ${existing.id}).`);
  }

  const maxId = (local.tracked_targets || []).reduce((max, item) => (item.id > max ? item.id : max), 0);
  const newItem = {
    id: maxId + 1,
    type,
    name,
    url,
    is_active: true,
    created_at: new Date().toISOString()
  };

  local.tracked_targets.push(newItem);
  saveLocalData(local);
  return [newItem];
}

/**
 * Xóa mục tiêu theo ID
 */
async function removeTarget(id) {
  const targetId = parseInt(id, 10);
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('tracked_targets')
        .delete()
        .eq('id', targetId)
        .select();

      if (!error && data && data.length > 0) return data;
    } catch (err) {
      console.warn(`⚠️ Xóa trên Supabase không thành công, kiểm tra Local DB...`);
    }
  }

  const local = getLocalData();
  const index = (local.tracked_targets || []).findIndex(item => item.id === targetId);
  if (index === -1) return [];

  const removed = local.tracked_targets.splice(index, 1);
  saveLocalData(local);
  return removed;
}

/**
 * Kiểm tra xem một item đã được quét trước đó hay chưa
 */
async function isItemScraped(externalId) {
  if (supabase) {
    try {
      const { data } = await supabase
        .from('scraped_items')
        .select('id')
        .eq('external_id', externalId)
        .single();

      if (data) return true;
    } catch (err) {
      // Bỏ qua lỗi single() không tìm thấy
    }
  }

  const local = getLocalData();
  return (local.scraped_items || []).some(item => item.external_id === externalId);
}

/**
 * Lưu item mới quét được để chống trùng lặp báo cáo
 */
async function saveScrapedItem(source, externalId, brand, title, rawData) {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('scraped_items')
        .insert({
          source,
          external_id: externalId,
          brand,
          title: title ? title.slice(0, 200) : null,
          raw_data: rawData
        });

      if (!error) return data;
    } catch (err) {
      // Fallback
    }
  }

  const local = getLocalData();
  local.scraped_items = local.scraped_items || [];
  
  // Tránh phình to DB: giữ lại tối đa 2000 items gần nhất
  if (local.scraped_items.length > 2000) {
    local.scraped_items = local.scraped_items.slice(-1500);
  }

  local.scraped_items.push({
    source,
    external_id: externalId,
    brand,
    title: title ? title.slice(0, 200) : null,
    raw_data: rawData,
    created_at: new Date().toISOString()
  });

  saveLocalData(local);
  return true;
}

module.exports = {
  supabase,
  getActiveTargets,
  getAllTargets,
  addTarget,
  removeTarget,
  isItemScraped,
  saveScrapedItem,
};
