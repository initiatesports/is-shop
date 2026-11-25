/* 網店收單後端（Apps Script「INITIATE 網店收單」）計價部分的舊快照，只供 tools/check-shop-pricing.mjs 測試使用：
   正式後端不在此 repo；此檔為 2026-11 舊版 shopOrder 的 SHOP_EARLY_END、SHOP_CATALOG、SHOP_BUNDLES 及 shopPrice_（未經修改）。 */
var SHOP_EARLY_END = new Date('2026-12-01T23:59:59+08:00');

var SHOP_CATALOG = {
  'winter-ls-top': { name: '冬季長袖訓練服', early: 120, regular: 140, sizes: ['7XS','6XS','5XS','4XS','3XS','2XS','XS','S','M','L'] },
  'winter-jacket': { name: '冬季立領外套', early: 199, regular: 230, sizes: ['7XS','6XS','5XS','4XS','3XS','2XS','XS','S','M','L'] },
  'jogger-pants':  { name: '黑色收腿褲', early: 180, regular: 200, sizes: ['7XS','6XS','5XS','4XS','3XS','2XS','XS','S','M','L'] },
  'hoodie-2023':   { name: 'AIM HIGH JUMP HIGH 親子衛衣', early: 199, regular: 199, sizes: ['110','120','130','140','150','160','S','M','L','XL'] },
  'socks-1': { name: '運動襪・藍色雙槓', early: 39, regular: 39, sizes: ['兒童均碼','成人均碼'] },
  'socks-2': { name: '運動襪・純白大 logo', early: 39, regular: 39, sizes: ['兒童均碼','成人均碼'] },
  'socks-3': { name: '運動襪・黑色雙槓', early: 39, regular: 39, sizes: ['兒童均碼','成人均碼'] },
  'socks-4': { name: '運動襪・紅色雙槓', early: 39, regular: 39, sizes: ['兒童均碼','成人均碼'] },
  'socks-5': { name: '運動襪・AIM HIGH 左右成句', early: 39, regular: 39, sizes: ['兒童均碼','成人均碼'] }
};
var SHOP_BUNDLES = { set3: { early: 420, regular: 480 }, set2: { early: 320, regular: 370 }, setTp: { early: 260, regular: 300 } };
var SHOP_HOODIE_MULTI = 179;      // 衛衣 2 件或以上每件
var SHOP_SOCK_3 = 99;             // 襪 3 雙

function shopPrice_(items, now) {
  var early = now.getTime() <= SHOP_EARLY_END.getTime();
  var P = function (sku) { var c = SHOP_CATALOG[sku]; return early ? c.early : c.regular; };
  var B = function (k) { return early ? SHOP_BUNDLES[k].early : SHOP_BUNDLES[k].regular; };
  var n = { top: 0, jkt: 0, pnt: 0, hoodie: 0, socks: 0 };
  items.forEach(function (it) {
    if (it.sku === 'winter-ls-top') n.top += it.qty;
    else if (it.sku === 'winter-jacket') n.jkt += it.qty;
    else if (it.sku === 'jogger-pants') n.pnt += it.qty;
    else if (it.sku === 'hoodie-2023') n.hoodie += it.qty;
    else n.socks += it.qty;
  });
  // 冬季套裝：試晒所有組合，攞最平
  var best = null;
  for (var a = 0; a <= Math.min(n.top, n.jkt, n.pnt); a++)
    for (var b = 0; b <= Math.min(n.jkt - a, n.pnt - a); b++)
      for (var c = 0; c <= Math.min(n.top - a, n.pnt - a - b); c++) {
        var cost = a * B('set3') + b * B('set2') + c * B('setTp')
          + (n.top - a - c) * P('winter-ls-top') + (n.jkt - a - b) * P('winter-jacket') + (n.pnt - a - b - c) * P('jogger-pants');
        if (!best || cost < best.cost) best = { cost: cost, a: a, b: b, c: c };
      }
  var kit = best ? best.cost : 0;
  var hoodie = n.hoodie * (n.hoodie >= 2 ? SHOP_HOODIE_MULTI : P('hoodie-2023'));
  var socks = Math.floor(n.socks / 3) * SHOP_SOCK_3 + (n.socks % 3) * 39;
  var parts = [];
  if (best && best.a) parts.push('三件套×' + best.a);
  if (best && best.b) parts.push('外套＋收腿褲×' + best.b);
  if (best && best.c) parts.push('長袖＋收腿褲×' + best.c);
  return { amount: kit + hoodie + socks, early: early, bundles: parts.join('、') };
}

