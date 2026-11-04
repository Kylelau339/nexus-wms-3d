import type { Rng } from '../core/rng';
import type { CustomerZone, Sku, TempZone } from './types';

/**
 * Procedural product catalogue.
 *
 * Every record exists in two languages: the Traditional Chinese source used by
 * the primary locale and an English variant used when the operator switches the
 * interface. Both are generated from the same random draw, so the two catalogues
 * always describe exactly the same stock.
 */

const BRANDS: Array<[string, string]> = [
  ['華曜', 'Lumen'],
  ['拓海', 'Torrent'],
  ['朗風', 'Zephyr'],
  ['銳格', 'Apex'],
  ['沐光', 'Halcyon'],
  ['星野', 'Aster'],
  ['磐石', 'Bedrock'],
  ['雲雀', 'Lark'],
  ['尚燁', 'Radiance'],
  ['極光', 'Aurora'],
  ['鈞盛', 'Grandson'],
  ['柏睿', 'Sage'],
  ['沐辰', 'Northstar'],
  ['安珀', 'Amber'],
  ['洛書', 'Rivers'],
  ['承曜', 'Zenith'],
  ['凱崴', 'Kaiwei'],
  ['沐德', 'Virtue'],
  ['鉅洋', 'Oceanwide'],
  ['優盛', 'Prosper'],
];

interface CategorySpec {
  name: string;
  nameEn: string;
  /** Parallel noun lists: index i in `nouns` matches index i in `nounsEn`. */
  nouns: string[];
  nounsEn: string[];
  weight: number;
  temp: TempZone | 'mixed';
  priceRange: [number, number];
  weightRange: [number, number];
  volumeRange: [number, number];
}

const CATEGORIES: CategorySpec[] = [
  {
    name: '3C電子',
    nameEn: 'Consumer Electronics',
    nouns: ['行動電源', '藍牙耳機', 'USB-C線材', '機械鍵盤', '無線充電板', '電源座', '觸控筆', 'USB集線器', '螢幕支架', '降噪耳機'],
    nounsEn: ['Power Bank', 'Bluetooth Earbuds', 'USB-C Cable', 'Mechanical Keyboard', 'Wireless Charging Pad', 'Power Adapter', 'Stylus Pen', 'USB Hub', 'Monitor Arm', 'Noise-Cancelling Headphones'],
    weight: 22,
    temp: 'ambient',
    priceRange: [180, 4800],
    weightRange: [0.12, 1.6],
    volumeRange: [0.0008, 0.008],
  },
  {
    name: '家用電器',
    nameEn: 'Home Appliances',
    nouns: ['變頻除濕機', '空氣清淨器', 'IH電鍋', '手持吸塵器', '電熱水壺', '循環扇', '烤箱', '除濕衣架', '掃地機器人', '果汁機'],
    nounsEn: ['Inverter Dehumidifier', 'Air Purifier', 'IH Rice Cooker', 'Handheld Vacuum', 'Electric Kettle', 'Air Circulator', 'Oven', 'Dehumidifier Hanger', 'Robot Vacuum', 'Juice Maker'],
    weight: 12,
    temp: 'ambient',
    priceRange: [690, 26000],
    weightRange: [1.2, 16],
    volumeRange: [0.008, 0.09],
  },
  {
    name: '生鮮食品',
    nameEn: 'Fresh Food',
    nouns: ['有機蔬菜箱', '冷凍雞胸肉', '鮮乳製品', '海鮮組合', '冷藏便當', '冷凍餃子', '鮮果禮盒', '即食湯包', '低溫奶酪', '冷凍蝦仁'],
    nounsEn: ['Organic Vegetable Box', 'Frozen Chicken Breast', 'Fresh Dairy Set', 'Seafood Platter', 'Chilled Bento', 'Frozen Dumplings', 'Fresh Fruit Gift Box', 'Instant Soup Dumplings', 'Low-Temperature Cheese', 'Frozen Shrimp'],
    weight: 18,
    temp: 'mixed',
    priceRange: [90, 1600],
    weightRange: [0.4, 12],
    volumeRange: [0.002, 0.04],
  },
  {
    name: '服飾配件',
    nameEn: 'Apparel & Accessories',
    nouns: ['機能外套', '純棉T恤', '帆布鞋', '真皮腰帶', '羊毛圍巾', '運動背包', '針織洋裝', '防潑水長褲', '太陽眼鏡', '棒球帽'],
    nounsEn: ['Functional Jacket', 'Cotton T-Shirt', 'Canvas Shoes', 'Leather Belt', 'Wool Scarf', 'Sports Backpack', 'Knit Dress', 'Water-Repellent Trousers', 'Sunglasses', 'Baseball Cap'],
    weight: 14,
    temp: 'ambient',
    priceRange: [220, 4800],
    weightRange: [0.15, 3.2],
    volumeRange: [0.001, 0.02],
  },
  {
    name: '化妝保養',
    nameEn: 'Beauty & Personal Care',
    nouns: ['保濕精華', '防曬乳', '洗髮精', '護膚面膜', '香水', '身體乳', '去角質凝膠', '髮膜', '眼部精華', '潔面乳'],
    nounsEn: ['Moisturising Serum', 'Sunscreen Lotion', 'Shampoo', 'Facial Mask', 'Perfume', 'Body Lotion', 'Exfoliating Gel', 'Hair Mask', 'Eye Serum', 'Facial Cleanser'],
    weight: 10,
    temp: 'ambient',
    priceRange: [160, 3600],
    weightRange: [0.08, 1.1],
    volumeRange: [0.0004, 0.005],
  },
  {
    name: '醫療耗材',
    nameEn: 'Medical Supplies',
    nouns: ['無菌敷料', '血糖試片', '醫用口罩', '隱形眼鏡', '護理紗布', '助聽器電池', '霧化器', '血壓計', '彈力繃帶', '消毒酒精'],
    nounsEn: ['Sterile Dressing', 'Glucose Test Strip', 'Medical Mask', 'Contact Lens', 'Gauze Pad', 'Hearing Aid Battery', 'Nebulizer', 'Blood Pressure Monitor', 'Elastic Bandage', 'Disinfecting Alcohol'],
    weight: 8,
    temp: 'ambient',
    priceRange: [120, 4200],
    weightRange: [0.05, 2.4],
    volumeRange: [0.0003, 0.012],
  },
  {
    name: '建材五金',
    nameEn: 'Building & Hardware',
    nouns: ['不鏽鋼扳手', '防水塗料', 'LED燈泡', '電線捲', '工具組', 'PVC管件', '防滑地磚', '門鎖組', '砂紙', '螺絲套件'],
    nounsEn: ['Stainless Wrench', 'Waterproof Paint', 'LED Bulb', 'Cable Reel', 'Tool Set', 'PVC Fitting', 'Anti-Slip Tile', 'Door Lock Set', 'Sandpaper', 'Screw Kit'],
    weight: 7,
    temp: 'ambient',
    priceRange: [80, 3200],
    weightRange: [0.3, 22],
    volumeRange: [0.002, 0.07],
  },
  {
    name: '汽機車零件',
    nameEn: 'Auto & Motorcycle Parts',
    nouns: ['機油濾芯', '煞車皮', '雨刷組', '輪胎', '蓄電池', '冷卻液', '火花塞', '空氣濾網', '車燈總成', '底盤套件'],
    nounsEn: ['Oil Filter', 'Brake Pad', 'Wiper Set', 'Tyre', 'Battery', 'Coolant', 'Spark Plug', 'Air Filter', 'Headlight Assembly', 'Chassis Kit'],
    weight: 5,
    temp: 'ambient',
    priceRange: [200, 12000],
    weightRange: [0.3, 26],
    volumeRange: [0.001, 0.1],
  },
  {
    name: '書籍文具',
    nameEn: 'Books & Stationery',
    nouns: ['精裝書', '筆記本', '鋼筆組', '辦公椅', '收納櫃', '白板', '文具組', '列印紙', '相框', '檯燈'],
    nounsEn: ['Hardcover Book', 'Notebook', 'Pen Set', 'Office Chair', 'Storage Cabinet', 'Whiteboard', 'Stationery Set', 'Printer Paper', 'Photo Frame', 'Desk Lamp'],
    weight: 3,
    temp: 'ambient',
    priceRange: [60, 5200],
    weightRange: [0.1, 14],
    volumeRange: [0.0006, 0.08],
  },
  {
    name: '寵物用品',
    nameEn: 'Pet Supplies',
    nouns: ['成犬飼料', '貓砂', '寵物推車', '耐咬玩具', '貓爬架', '自動餵食器', '洗毛精', '外出胸背帶', '飲水機', '寵物床墊'],
    nounsEn: ['Adult Dog Food', 'Cat Litter', 'Pet Stroller', 'Chew Toy', 'Cat Tree', 'Auto Feeder', 'Pet Shampoo', 'Outdoor Harness', 'Water Fountain', 'Pet Mattress'],
    weight: 3,
    temp: 'ambient',
    priceRange: [110, 5600],
    weightRange: [0.2, 15],
    volumeRange: [0.001, 0.06],
  },
];

const HAZARDS: Array<[string, string] | null> = [
  ['易燃', 'Flammable'],
  ['腐蝕', 'Corrosive'],
  ['氧化性', 'Oxidiser'],
  ['壓縮氣體', 'Compressed Gas'],
  ['易制毒', 'Toxic'],
  null,
  null,
  null,
  null,
  null,
];

/** Product edition suffixes — index i in `VARIANTS` matches index i in `VARIANTS_EN`. */
const VARIANTS = ['標準版', '專業版', '旗艦版', '輕量版', '加強版', '二代', 'plus', 'II'];
const VARIANTS_EN = ['Standard', 'Pro', 'Flagship', 'Lite', 'Reinforced', 'Gen 2', 'Plus', 'II'];

export function buildCatalog(rng: Rng, count = 1400): Sku[] {
  const skus: Sku[] = [];
  const weights = CATEGORIES.map((c) => c.weight);

  for (let i = 0; i < count; i++) {
    const cat = rng.weighted(CATEGORIES, weights);
    const brand = rng.pick(BRANDS);
    const noun = rng.pick(cat.nouns);
    const tempZone: TempZone =
      cat.temp === 'mixed' ? (rng.chance(0.55) ? 'chilled' : 'frozen') : cat.temp;

    const abcRoll = rng.next();
    const abcClass: 'A' | 'B' | 'C' = abcRoll < 0.2 ? 'A' : abcRoll < 0.5 ? 'B' : 'C';

    // The random draw order below is part of the reproducibility contract:
    // changing it changes every SKU id → name mapping for a given seed.
    const variant = rng.pick(VARIANTS);
    const id = `SKU-${String(i + 1).padStart(5, '0')}`;
    const name = `${brand[0]} ${noun} ${variant}`;
    const nameEn = `${brand[1]} ${cat.nounsEn[cat.nouns.indexOf(noun)]} ${
      VARIANTS_EN[VARIANTS.indexOf(variant)]
    }`;
    const barcode = `471${String(rng.int(1000000, 9999999))}`;
    const unitWeight = Number(rng.float(cat.weightRange[0], cat.weightRange[1]).toFixed(3));
    const unitVolume = Number(rng.float(cat.volumeRange[0], cat.volumeRange[1]).toFixed(5));
    const unitPrice = Math.round(rng.float(cat.priceRange[0], cat.priceRange[1]));
    const hazard = rng.pick(HAZARDS);

    skus.push({
      id,
      name,
      nameEn,
      category: cat.name,
      categoryEn: cat.nameEn,
      barcode,
      unitWeight,
      unitVolume,
      unitPrice,
      tempZone,
      hazardClass: hazard ? hazard[0] : null,
      hazardClassEn: hazard ? hazard[1] : null,
      abcClass,
    });
  }
  return skus;
}

export const CATEGORY_NAMES = CATEGORIES.map((c) => c.name);

export function buildCustomerZones(rng: Rng): CustomerZone[] {
  const specs: Array<[string, string, number, number, number]> = [
    ['台北市 · 中正區', 'Taipei · Zhongzheng', 18, 2.5, 0.3],
    ['新北市 · 板橋區', 'New Taipei · Banqiao', 26, 4.0, 0.18],
    ['桃園市 · 龜山區', 'Taoyuan · Guishan', 38, 6.5, 0.15],
    ['台中市 · 北屯區', 'Taichung · Beitun', 152, 12.0, 0.14],
    ['台南市 · 永康區', 'Tainan · Yongkang', 268, 16.0, 0.1],
    ['高雄市 · 楠梓區', 'Kaohsiung · Nanzi', 312, 19.0, 0.08],
    ['外銷 · 香港', 'Export · Hong Kong', 1250, 30.0, 0.03],
    ['外銷 · 新加坡', 'Export · Singapore', 2450, 38.0, 0.02],
  ];
  return specs.map(([name, nameEn, distanceKm, x, share], i) => ({
    id: `CZ-${String(i + 1).padStart(2, '0')}`,
    name,
    nameEn,
    x,
    z: 0,
    distanceKm,
    share: share * rng.float(0.9, 1.1),
  }));
}

/** Suppliers that ship goods into the DC. */
export const SUPPLIERS: Array<{ name: string; nameEn: string }> = [
  { name: '朝陽工業', nameEn: 'Chaoyang Industrial' },
  { name: '隆昌食品', nameEn: 'Longchang Foods' },
  { name: '新海電子供應', nameEn: 'Xinhai Electronics' },
  { name: '銀泰日化', nameEn: 'Yintai Personal Care' },
  { name: '北歐家居', nameEn: 'Nordic Home' },
  { name: '大昌醫療', nameEn: 'Dachang Medical' },
  { name: '宏達五金', nameEn: 'Hongda Hardware' },
  { name: '極光車業', nameEn: 'Aurora Motors' },
  { name: '金石文化', nameEn: 'Jinshi Culture' },
  { name: '愛寵生技', nameEn: 'Aichong Biotech' },
  { name: '豐收農產', nameEn: 'Fengshou Produce' },
  { name: '星光紡織', nameEn: 'Starlight Textile' },
];

/** Carriers that take goods out of the DC. */
export const CARRIERS: Array<{ code: string; name: string; nameEn: string; speedFactor: number }> = [
  { code: 'SJL', name: '順捷物流', nameEn: 'Shunjie Logistics', speedFactor: 1.0 },
  { code: 'TLX', name: '台聯貨運', nameEn: 'Tailian Freight', speedFactor: 0.96 },
  { code: 'KEX', name: '快捷宅配', nameEn: 'Kuaijie Express', speedFactor: 1.08 },
  { code: 'CTY', name: '城配三方', nameEn: 'City Parcel 3PL', speedFactor: 1.02 },
];

/** Retail and marketplace customers that place the orders. */
export const CUSTOMERS: Array<{ name: string; nameEn: string }> = [
  { name: '家樂福量販', nameEn: 'Carrefour Wholesale' },
  { name: '大潤發', nameEn: 'RT-Mart' },
  { name: '好市多物流', nameEn: 'Costco Logistics' },
  { name: 'momo購物', nameEn: 'momo Shopping' },
  { name: '蝦皮商家', nameEn: 'Shopee Sellers' },
  { name: '全家超商', nameEn: 'FamilyMart' },
  { name: '7-11物流', nameEn: '7-Eleven Logistics' },
  { name: '亞馬遜FBA', nameEn: 'Amazon FBA' },
  { name: 'Costco', nameEn: 'Costco' },
  { name: '燦坤流通', nameEn: 'Tung Chun Mart' },
  { name: 'MUJI', nameEn: 'MUJI' },
  { name: '家樂福汐止', nameEn: 'Carrefour Xizhi' },
];
