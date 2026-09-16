/* ===== طبقة الهوية (Brand) — نظام منيو ون =====
   ملف brand.json واحد لكل مطعم: الاسم، الشعار (ملفات الصور)، الألوان.
   نسخة مخصصة لكل عميل = brand.json + صور مختلفة تُحزم وقت البناء. */
const fs = require('fs');
const path = require('path');

const BRAND_PATH = process.env.BRAND_PATH || path.join(__dirname, '..', 'brand.json');

let raw;
try {
  raw = JSON.parse(fs.readFileSync(BRAND_PATH, 'utf8'));
} catch (e) {
  console.error(`تعذر قراءة ملف الهوية (${BRAND_PATH}):`, e.message);
  raw = {};
}

const colors = raw.colors || {};

const brand = {
  slug: raw.slug || 'menuone',
  nameAr: raw.name_ar || 'المنيو',
  nameEn: raw.name_en || 'Menu',
  productAr: raw.product_ar || 'منيو ون',
  systemName: raw.system_name || 'نظام منيو ون الذكي',
  colors: {
    accent: colors.accent || '#f97316',
    accentDeep: colors.accent_deep || colors.accent || '#ea580c',
    glow: colors.glow || 'rgba(249, 115, 22, 0.45)',
    brandText: colors.brand_text || colors.accent || '#c2571a',
  },
  demoMenu: raw.demo_menu !== false,
  cookieName: `${(raw.slug || 'menuone')}.sid`,
  path: BRAND_PATH,
};

const TOKENS = {
  NAME_AR: brand.nameAr,
  NAME_EN: brand.nameEn,
  PRODUCT_AR: brand.productAr,
  SYSTEM_NAME: brand.systemName,
  SLUG: brand.slug,
  ACCENT: brand.colors.accent,
  ACCENT_DEEP: brand.colors.accentDeep,
  GLOW: brand.colors.glow,
  BRAND_TEXT: brand.colors.brandText,
};

function applyTokens(str) {
  return str.replace(/\{\{([A-Z_]+)\}\}/g, (m, key) =>
    Object.prototype.hasOwnProperty.call(TOKENS, key) ? String(TOKENS[key]) : m
  );
}

module.exports = { brand, applyTokens, TOKENS };
