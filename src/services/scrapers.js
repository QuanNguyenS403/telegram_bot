const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');
const { config } = require('../config');
const { getActiveTargets, isItemScraped, saveScrapedItem } = require('./supabase');

/**
 * Tạo mã hash duy nhất cho sản phẩm
 */
function hashString(str) {
  return crypto.createHash('md5').update(str || '').digest('hex').slice(0, 16);
}

/**
 * Chuẩn hóa URL tuyệt đối
 */
function resolveUrl(relativeUrl, baseUrl) {
  if (!relativeUrl) return null;
  try {
    return new URL(relativeUrl, baseUrl).href;
  } catch (e) {
    return relativeUrl.startsWith('http') ? relativeUrl : null;
  }
}

/**
 * ==========================================
 * BƯỚC A1: QUÉT WEBSITE ĐỐI THỦ (SHOPIFY)
 * ==========================================
 */
async function scrapeWebsites() {
  const newProducts = [];
  const sites = await getActiveTargets('shopify');

  if (!sites || sites.length === 0) {
    return [];
  }

  for (const site of sites) {
    try {
      console.log(`🔍 [Shopify] Đang quét: ${site.name} (${site.url})...`);
      const response = await axios.get(site.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        timeout: 12000
      });

      const products = response.data?.products || [];
      const baseDomain = site.url.split('/products.json')[0];

      for (const item of products) {
        const externalId = `shopify_${item.id}`;
        const alreadyScraped = await isItemScraped(externalId);

        if (!alreadyScraped) {
          const cleanItem = {
            brand: site.name,
            sourceType: 'shopify',
            title: item.title,
            type: item.product_type || 'N/A',
            tags: item.tags || [],
            variants: item.variants || [],
            price: item.variants?.[0]?.price || 'N/A',
            description: item.body_html ? item.body_html.replace(/<[^>]*>?/gm, '').slice(0, 300) : '',
            imageUrl: item.images?.[0]?.src || null,
            productUrl: item.handle ? `${baseDomain}/products/${item.handle}` : baseDomain,
            createdAt: item.created_at,
            updatedAt: item.updated_at
          };

          newProducts.push(cleanItem);
          await saveScrapedItem('shopify', externalId, site.name, item.title, cleanItem);
        }
      }
    } catch (error) {
      console.error(`❌ [Shopify] Lỗi khi quét website ${site.name}:`, error.message);
    }
  }

  return newProducts;
}

/**
 * ==========================================
 * BƯỚC A2: QUÉT WEBSITE CODE THUẦN / KHÔNG QUA SHOPIFY (CUSTOM WEB / HTML)
 * Hỗ trợ bóc tách qua JSON-LD Schema, OpenGraph và cấu trúc HTML index thuần
 * ==========================================
 */
async function scrapeCustomWebsites() {
  const newProducts = [];
  const sites = await getActiveTargets('custom_web');

  if (!sites || sites.length === 0) {
    return [];
  }

  for (const site of sites) {
    try {
      console.log(`🌐 [Web Thuần] Đang bóc tách HTML từ: ${site.name} (${site.url})...`);
      const response = await axios.get(site.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
        },
        timeout: 15000
      });

      const $ = cheerio.load(response.data);
      const extractedItems = [];

      // CHIẾN LƯỢC 1: Tìm cấu trúc JSON-LD (Schema.org Product / ItemList)
      $('script[type="application/ld+json"]').each((_, elem) => {
        try {
          const raw = $(elem).html();
          if (!raw) return;
          const json = JSON.parse(raw);

          // Trường hợp 1: Đối tượng đơn Product
          if (json['@type'] === 'Product') {
            const img = Array.isArray(json.image) ? json.image[0] : (json.image?.url || json.image);
            extractedItems.push({
              title: json.name,
              price: json.offers?.price || json.offers?.[0]?.price || 'N/A',
              imageUrl: resolveUrl(img, site.url),
              productUrl: resolveUrl(json.url, site.url) || site.url,
              description: (json.description || '').slice(0, 300)
            });
          }

          // Trường hợp 2: Danh sách ItemList
          if (json['@type'] === 'ItemList' && Array.isArray(json.itemListElement)) {
            for (const elemItem of json.itemListElement) {
              const p = elemItem.item || elemItem;
              if (p.name || p.title) {
                const img = Array.isArray(p.image) ? p.image[0] : (p.image?.url || p.image);
                extractedItems.push({
                  title: p.name || p.title,
                  price: p.offers?.price || 'N/A',
                  imageUrl: resolveUrl(img, site.url),
                  productUrl: resolveUrl(p.url, site.url) || site.url,
                  description: (p.description || '').slice(0, 300)
                });
              }
            }
          }

          // Trường hợp 3: @graph chứa mảng sản phẩm
          if (Array.isArray(json['@graph'])) {
            json['@graph'].forEach(node => {
              if (node['@type'] === 'Product') {
                const img = Array.isArray(node.image) ? node.image[0] : (node.image?.url || node.image);
                extractedItems.push({
                  title: node.name,
                  price: node.offers?.price || 'N/A',
                  imageUrl: resolveUrl(img, site.url),
                  productUrl: resolveUrl(node.url, site.url) || site.url,
                  description: (node.description || '').slice(0, 300)
                });
              }
            });
          }
        } catch (e) {
          // Bỏ qua khối JSON-LD lỗi cú pháp
        }
      });

      // CHIẾN LƯỢC 2: Nếu chưa tìm thấy qua JSON-LD, quét cấu trúc thẻ sản phẩm HTML
      if (extractedItems.length === 0) {
        const productSelectors = [
          '.product-card', '.product-item', '.product', 'article.product',
          '.productCard', '.productItem', '.item-product', '.product_card',
          '[data-product-id]', '.col-product', '.woocommerce-loop-product',
          '.grid-item', '.item', 'article'
        ];

        let matchedSelector = null;
        for (const sel of productSelectors) {
          if ($(sel).length >= 2) {
            matchedSelector = sel;
            break;
          }
        }

        if (matchedSelector) {
          $(matchedSelector).slice(0, 12).each((_, card) => {
            const cardEl = $(card);
            
            // Tìm tiêu đề
            const title = cardEl.find('h1, h2, h3, h4, .title, .product-title, .name, [class*="title"], [class*="name"]').first().text().trim() ||
                          cardEl.find('img').first().attr('alt') || '';

            // Tìm giá
            const price = cardEl.find('.price, [class*="price"], .amount, [class*="amount"]').first().text().trim() || 'N/A';

            // Tìm ảnh (ưu tiên src, data-src, data-lazy-src)
            const rawImg = cardEl.find('img').attr('data-src') ||
                           cardEl.find('img').attr('data-lazy-src') ||
                           cardEl.find('img').attr('data-original') ||
                           cardEl.find('img').attr('src');
            const imageUrl = resolveUrl(rawImg, site.url);

            // Tìm đường link
            const rawLink = cardEl.find('a').attr('href');
            const productUrl = resolveUrl(rawLink, site.url) || site.url;

            if (title && (imageUrl || productUrl)) {
              extractedItems.push({
                title: title.replace(/\s+/g, ' ').slice(0, 120),
                price: price.replace(/\s+/g, ' ').slice(0, 40),
                imageUrl,
                productUrl,
                description: ''
              });
            }
          });
        }
      }

      // CHIẾN LƯỢC 3: Nếu là trang giới thiệu / landing page đơn lẻ (Index thuần)
      if (extractedItems.length === 0) {
        const ogTitle = $('meta[property="og:title"]').attr('content') || $('title').text().trim();
        const ogImage = resolveUrl(
          $('meta[property="og:image"]').attr('content') ||
          $('meta[name="twitter:image"]').attr('content') ||
          $('img').first().attr('src'),
          site.url
        );
        const ogDesc = $('meta[property="og:description"]').attr('content') ||
                       $('meta[name="description"]').attr('content') || '';
        const price = $('meta[property="product:price:amount"]').attr('content') || 'N/A';

        if (ogTitle) {
          extractedItems.push({
            title: ogTitle.replace(/\s+/g, ' ').slice(0, 120),
            price,
            imageUrl: ogImage,
            productUrl: site.url,
            description: ogDesc.slice(0, 300)
          });
        }
      }

      // Lọc trùng lặp và lưu vào DB
      for (const item of extractedItems) {
        if (!item.title) continue;
        const externalId = `custom_${hashString(site.name + '_' + (item.productUrl || item.title))}`;
        const alreadyScraped = await isItemScraped(externalId);

        if (!alreadyScraped) {
          const cleanItem = {
            brand: site.name,
            sourceType: 'custom_web',
            title: item.title,
            type: 'Custom HTML',
            tags: ['custom_web', 'index'],
            price: item.price || 'N/A',
            description: item.description || '',
            imageUrl: item.imageUrl,
            productUrl: item.productUrl
          };

          newProducts.push(cleanItem);
          await saveScrapedItem('custom_web', externalId, site.name, item.title, cleanItem);
        }
      }
    } catch (error) {
      console.error(`❌ [Web Thuần] Lỗi khi quét website ${site.name}:`, error.message);
    }
  }

  return newProducts;
}

/**
 * ==========================================
 * BƯỚC B: QUÉT XU HƯỚNG MẠNG XÃ HỘI & THỊ TRƯỜNG
 * 100% Free: Nếu có APIFY_TOKEN thì cào TikTok; Nếu không có, tự động chuyển sang Google News/Trends RSS hoàn toàn MIỄN PHÍ
 * ==========================================
 */
async function scrapeSocialTrends() {
  // Nếu có Apify Token (có $5 credit miễn phí hàng tháng)
  if (config.apify.token) {
    try {
      console.log('🔍 Đang quét xu hướng đồ ngủ trên TikTok qua Apify (Free Tier)...');
      const response = await axios.post(
        `https://api.apify.com/v2/acts/clockworks~free-tiktok-scraper/run-sync-get-dataset-items?token=${config.apify.token}`,
        {
          hashtags: ['sleepwear', 'loungewear', 'pajamasets'],
          resultsPerPage: 5
        },
        { timeout: 90000 }
      );

      const items = response.data || [];
      return items.map(video => ({
        author: video.authorMeta?.name || 'TikTok Creator',
        text: video.text || '',
        views: video.playCount || 0,
        likes: video.diggCount || 0,
        url: video.webVideoUrl || ''
      }));
    } catch (error) {
      console.warn('⚠️ Lỗi quét Apify TikTok, tự động chuyển sang nguồn Trends RSS miễn phí:', error.message);
    }
  }

  // NGUỒN DỰ PHÒNG HOÀN TOÀN MIỄN PHÍ 100%: Google Trends & Fashion News RSS
  try {
    console.log('📰 Đang thu thập xu hướng thời trang mặc nhà từ Google Fashion Trends RSS (100% Miễn phí)...');
    const rssUrl = 'https://news.google.com/rss/search?q=sleepwear+OR+loungewear+fashion+trend&hl=en-US&gl=US&ceid=US:en';
    const response = await axios.get(rssUrl, {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });

    const $ = cheerio.load(response.data, { xmlMode: true });
    const trendItems = [];

    $('item').slice(0, 6).each((_, el) => {
      const title = $(el).find('title').text().trim();
      const link = $(el).find('link').text().trim();
      const source = $(el).find('source').text().trim() || 'Thời trang Quốc tế';

      if (title) {
        trendItems.push({
          author: source,
          text: title,
          views: 'Xu hướng nổi bật',
          likes: 'Cao',
          url: link
        });
      }
    });

    return trendItems;
  } catch (err) {
    console.error('❌ Lỗi thu thập xu hướng RSS:', err.message);
    return [];
  }
}

/**
 * ==========================================
 * BƯỚC B2: QUÉT THƯ VIỆN QUẢNG CÁO META AD LIBRARY
 * Sử dụng Apify nếu đã cấu hình APIFY_TOKEN
 * ==========================================
 */
async function scrapeMetaAds() {
  if (!config.apify.token) {
    console.log('ℹ️ [Miễn phí] APIFY_TOKEN chưa cấu hình, bỏ qua quét Meta Ads tự động.');
    return [];
  }

  const adTargets = await getActiveTargets('meta_ads');
  if (!adTargets || adTargets.length === 0) {
    return [];
  }

  const startUrls = adTargets.map(item => ({ url: item.url }));
  const newAds = [];

  try {
    console.log(`🔍 Đang quét ${startUrls.length} chiến dịch trên Meta Ad Library qua Apify...`);
    const response = await axios.post(
      `https://api.apify.com/v2/acts/apify~facebook-ads-scraper/run-sync-get-dataset-items?token=${config.apify.token}`,
      {
        startUrls: startUrls,
        resultsLimit: 10,
        activeStatus: 'active'
      },
      { timeout: 120000 }
    );

    const ads = response.data || [];

    for (const ad of ads) {
      const adArchiveId = ad.adArchiveID || ad.id;
      if (!adArchiveId) continue;

      const externalId = `fb_ad_${adArchiveId}`;
      const alreadyScraped = await isItemScraped(externalId);

      if (!alreadyScraped) {
        const firstImage =
          ad.snapshot?.images?.[0]?.original_image_url ||
          ad.snapshot?.images?.[0]?.resized_image_url ||
          ad.snapshot?.videos?.[0]?.video_preview_image_url ||
          ad.snapshot?.cards?.[0]?.original_image_url ||
          null;

        const body = ad.snapshot?.body?.text || 'Không có caption';
        const rawStartDate = ad.startDateFormatted || ad.startDate || ad.ad_delivery_start_time || null;
        let daysRunning = 0;
        if (rawStartDate) {
          const start = new Date(rawStartDate);
          if (!isNaN(start.getTime())) {
            daysRunning = Math.max(0, Math.floor((new Date() - start) / (1000 * 60 * 60 * 24)));
          }
        }
        const variantsCount = (ad.snapshot?.cards?.length || 0) + (ad.snapshot?.videos?.length || 0) + (ad.snapshot?.images?.length || 1);

        const cleanAd = {
          brand: ad.pageName || 'Unknown Brand',
          title: `Meta Ad (${ad.pageName || 'Đối thủ'}) - ${body.slice(0, 50)}...`,
          adId: adArchiveId,
          startDate: rawStartDate || 'N/A',
          daysRunning: daysRunning,
          variantsCount: variantsCount,
          platforms: ad.publisherPlatform || ['facebook', 'instagram'],
          bodyText: body.slice(0, 400),
          ctaText: ad.snapshot?.cta_text || 'N/A',
          linkUrl: ad.snapshot?.link_url || '',
          mediaType: ad.snapshot?.videos?.length > 0 ? 'Video' : 'Image/Carousel',
          imageUrl: firstImage
        };

        newAds.push(cleanAd);
        await saveScrapedItem('fb_ads', externalId, cleanAd.brand, cleanAd.bodyText.slice(0, 80), cleanAd);
      }
    }
  } catch (error) {
    console.error('❌ Lỗi khi quét Meta Ad Library:', error.response?.data || error.message);
  }

  return newAds;
}

/**
 * ==========================================
 * BƯỚC E: BÓC TÁCH NỘI DUNG TỪ ĐƯỜNG LINK MẠNG XÃ HỘI (SPY ENGINE)
 * Hỗ trợ TikTok, YouTube Shorts, Meta Ads, Facebook, Instagram, Pinterest hoặc Text trực tiếp
 * ==========================================
 */
async function fetchSocialPostMetadata(input) {
  if (!input || typeof input !== 'string') {
    return { platform: 'Unknown', title: '', text: '', thumbnailUrl: null };
  }

  const trimmed = input.trim();
  const urlMatch = trimmed.match(/https?:\/\/[^\s]+/i);

  if (!urlMatch) {
    return {
      platform: 'Văn bản / Kịch bản trực tiếp',
      title: trimmed.slice(0, 80),
      text: trimmed,
      thumbnailUrl: null,
      rawInput: trimmed
    };
  }

  const url = urlMatch[0];

  // 1. TikTok oEmbed (100% Miễn phí, không cần token)
  if (/tiktok\.com/i.test(url)) {
    try {
      const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
      const res = await axios.get(oembedUrl, {
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      });
      return {
        platform: 'TikTok Video',
        title: res.data?.title || 'TikTok Video',
        author: res.data?.author_name || 'N/A',
        text: res.data?.title || '',
        thumbnailUrl: res.data?.thumbnail_url || null,
        url,
        rawInput: trimmed
      };
    } catch (e) {
      console.warn('⚠️ Lỗi gọi TikTok oEmbed, fallback sang bóc tách web:', e.message);
    }
  }

  // 2. YouTube Shorts / Video oEmbed (100% Miễn phí)
  if (/youtube\.com|youtu\.be/i.test(url)) {
    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
      const res = await axios.get(oembedUrl, {
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      });
      return {
        platform: /shorts/i.test(url) ? 'YouTube Shorts' : 'YouTube Video',
        title: res.data?.title || 'YouTube Video',
        author: res.data?.author_name || 'N/A',
        text: res.data?.title || '',
        thumbnailUrl: res.data?.thumbnail_url || null,
        url,
        rawInput: trimmed
      };
    } catch (e) {
      console.warn('⚠️ Lỗi gọi YouTube oEmbed:', e.message);
    }
  }

  // 3. Facebook, Instagram, Meta Ads, Pinterest hoặc Web chung qua OpenGraph
  try {
    const res = await axios.get(url, {
      timeout: 12000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
      }
    });

    const $ = cheerio.load(res.data);
    const ogTitle = $('meta[property="og:title"]').attr('content') || $('title').text().trim() || 'Bài đăng mạng xã hội';
    const ogDesc = $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || '';
    const ogImage = $('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content') || null;

    let platform = 'Mạng xã hội / Web';
    if (/facebook\.com|fb\.watch/i.test(url)) platform = 'Facebook Post / Video';
    if (/instagram\.com/i.test(url)) platform = 'Instagram Reel / Post';
    if (/pinterest\.com/i.test(url)) platform = 'Pinterest Pin';
    if (/facebook\.com\/ads\/library/i.test(url)) platform = 'Meta Ad Library';

    return {
      platform,
      title: ogTitle.slice(0, 150),
      text: (ogTitle + '\n' + ogDesc).trim(),
      thumbnailUrl: ogImage,
      url,
      rawInput: trimmed
    };
  } catch (err) {
    let platform = 'Liên kết Mạng xã hội';
    if (/facebook\.com/i.test(url)) platform = 'Facebook';
    if (/instagram\.com/i.test(url)) platform = 'Instagram';
    if (/tiktok\.com/i.test(url)) platform = 'TikTok';

    return {
      platform,
      title: `Nội dung từ ${platform}`,
      text: trimmed,
      thumbnailUrl: null,
      url,
      rawInput: trimmed
    };
  }
}

module.exports = {
  scrapeWebsites,
  scrapeCustomWebsites,
  scrapeSocialTrends,
  scrapeMetaAds,
  fetchSocialPostMetadata,
};

