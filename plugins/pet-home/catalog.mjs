export const furniture = [
  { id: 'sofa', name: '亚麻沙发', model: 'loungesofa', size: [2.2, 1], price: 35 },
  { id: 'table', name: '木质茶几', model: 'tablecoffee', size: [1.2, .8], price: 18 },
  { id: 'bed', name: '柔软小床', model: 'bedsingle', size: [1.3, 2], price: 30 },
  { id: 'plant', name: '落地绿植', model: 'pottedplant', size: [.7, .7], price: 12 },
  { id: 'lamp', name: '暖光落地灯', model: 'lamproundfloor', size: [.55, .55], price: 16 },
  { id: 'shelf', name: '橡木书架', model: 'bookcaseopen', size: [1.3, .65], price: 28 },
  { id: 'rug', name: '圆形地毯', model: 'ruground', size: [2.4, 2.4], price: 15, walkable: true },
  { id: 'ottoman', name: '休闲脚凳', model: 'loungesofaottoman', size: [.85, .85], price: 14 },
];

export const destinations = [
  { id: 'forest', name: '松风森林', description: '沿着林间小路，收集一枚松果。', duration: 60000, reward: 25, souvenir: '林间松果', color: '#627953' },
  { id: 'coast', name: '贝壳海岸', description: '听海浪，带回一枚贝壳。', duration: 90000, reward: 35, souvenir: '海边贝壳', color: '#779caa' },
  { id: 'hills', name: '落日山丘', description: '穿过草坡，寻找一颗圆石。', duration: 120000, reward: 45, souvenir: '山丘圆石', color: '#bc9367' },
];

export const room = { minX: -3.7, maxX: 3.7, minZ: -2.7, maxZ: 2.7 };

export function footprint(item) {
  const definition = furniture.find(entry => entry.id === item.type);
  const [width, depth] = definition.size;
  return item.rotation % 2 ? [depth, width] : [width, depth];
}

export function validPlacement(item, items) {
  const [width, depth] = footprint(item);
  if (item.x - width / 2 < room.minX || item.x + width / 2 > room.maxX || item.z - depth / 2 < room.minZ || item.z + depth / 2 > room.maxZ) return false;
  const definition = furniture.find(entry => entry.id === item.type);
  return definition.walkable || !items.some(other => {
    if (other.id === item.id || !other.placed || furniture.find(entry => entry.id === other.type).walkable) return false;
    const [otherWidth, otherDepth] = footprint(other);
    return Math.abs(item.x - other.x) < (width + otherWidth) / 2 + .12 && Math.abs(item.z - other.z) < (depth + otherDepth) / 2 + .12;
  });
}
