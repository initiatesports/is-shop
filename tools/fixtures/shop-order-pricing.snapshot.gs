/* 網店收單後端現行計價（2026-11-25 由 Apps Script 編輯器第 9 版複製；只含計價部分） */
var SHOP_EARLY_END = new Date('2026-12-01T23:59:59+08:00');
var KIDS_ADULT = ['7XS','6XS','5XS','4XS','3XS','2XS','XS','S','M','L'];
var SOCK_SIZES = ['兒童均碼','成人均碼'];
var SHOP_CATALOG = {
  'winter-ls-top': { name: '冬季長袖訓練服', early: 120, regular: 140, sizes: KIDS_ADULT },
  'winter-jacket': { name: '冬季立領外套', early: 199, regular: 230, sizes: KIDS_ADULT },
  'jogger-pants':  { name: '黑色訓練長褲', early: 180, regular: 200, sizes: KIDS_ADULT },
  'hoodie-2023':   { name: 'AIM HIGH JUMP HIGH 親子衛衣', early: 199, regular: 199, sizes: ['110','120','130','140','150','S','M','L','XL','2XL','3XL'] },
  'socks-1': { name: '運動襪・藍色雙槓', early: 39, regular: 39, sizes: SOCK_SIZES },
  'socks-2': { name: '運動襪・純白大標誌', early: 39, regular: 39, sizes: SOCK_SIZES },
  'socks-3': { name: '運動襪・黑色雙槓', early: 39, regular: 39, sizes: SOCK_SIZES },
  'socks-4': { name: '運動襪・紅色雙槓', early: 39, regular: 39, sizes: SOCK_SIZES },
  'gear-beadrope': { name: '專業硬珠拍子繩（兒童款）', early: 100, regular: 100, sizes: ['紫×白'] },
  'gear-beadrope-adult': { name: '專業硬珠拍子繩（成人款）', early: 100, regular: 100, sizes: ['紫×白'] },
  'gear-canvasbag': { name: '帆布跳繩袋', early: 20, regular: 20, sizes: ['米白','深藍'] },
  'gear-speedrope': { name: '速度膠繩', early: 80, regular: 80, sizes: ['白柄・白芯'] },
  'gear-speedcord': { name: '速度膠繩替換繩芯', early: 30, regular: 30, sizes: ['白','藍'] },
  'gear-wirerope': { name: '鋼絲速度繩', early: 100, regular: 100, sizes: ['粉紅'] },
  'gear-wirecord': { name: '鋼絲速度繩替換繩芯', early: 30, regular: 30, sizes: ['標準'] },
  'gear-pickleset': { name: '匹克球拍套裝', early: 120, regular: 120, sizes: ['標準'] }
};
var SHOP_BUNDLES = { set3: { early: 420, regular: 480 }, set2: { early: 320, regular: 370 }, setTp: { early: 260, regular: 300 } };
var SHOP_HOODIE_MULTI = 179, SHOP_SOCK_3 = 99;
function shopPrice_(items, now) {
  var early = now.getTime() <= SHOP_EARLY_END.getTime();
  var P = function (sku) { var c = SHOP_CATALOG[sku]; return early ? c.early : c.regular; };
  var B = function (k) { return early ? SHOP_BUNDLES[k].early : SHOP_BUNDLES[k].regular; };
  var n = { top: 0, jkt: 0, pnt: 0, hoodie: 0, socks: 0, bag: 0, gear: 0 };
  items.forEach(function (it) {
    if (it.sku === 'winter-ls-top') n.top += it.qty;
    else if (it.sku === 'winter-jacket') n.jkt += it.qty;
    else if (it.sku === 'jogger-pants') n.pnt += it.qty;
    else if (it.sku === 'hoodie-2023') n.hoodie += it.qty;
    else if (it.sku.indexOf('socks-') === 0) n.socks += it.qty;
    else if (it.sku === 'gear-canvasbag') n.bag += it.qty;
    else n.gear += it.qty * P(it.sku);
  });
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
  if (best && best.b) parts.push('外套＋訓練長褲×' + best.b);
  if (best && best.c) parts.push('長袖＋訓練長褲×' + best.c);
  var bags = Math.floor(n.bag / 3) * 50 + (n.bag % 3) * P('gear-canvasbag');
  return { amount: kit + hoodie + socks + bags + n.gear, early: early, bundles: parts.join('、') };
}
