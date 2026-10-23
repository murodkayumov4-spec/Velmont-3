// Силуэты вещей, пока у товара нет загруженного фото.
const SHAPES = {
  tee: {
    d: 'M62 30 L90 22 Q100 38 110 22 L138 30 L182 74 L160 100 L142 86 L142 214 L58 214 L58 86 L40 100 L18 74 Z',
    x: '<path d="M90 22 Q100 40 110 22"/>',
  },
  polo: {
    d: 'M62 30 L88 22 L100 44 L112 22 L138 30 L182 74 L160 100 L142 86 L142 214 L58 214 L58 86 L40 100 L18 74 Z',
    x: '<path d="M88 22 L100 44 L112 22 M100 44 V84"/><circle cx="100" cy="58" r="1.6"/><circle cx="100" cy="72" r="1.6"/>',
  },
  hoodie: {
    d: 'M64 34 Q100 4 136 34 L184 78 L172 206 L146 202 L142 90 L142 220 L58 220 L58 90 L54 202 L28 206 L16 78 Z',
    x: '<path d="M70 38 Q100 62 130 38 M100 62 V96 M82 160 H118 L112 190 H88 Z"/>',
  },
  jacket: {
    d: 'M62 28 L88 20 L100 46 L112 20 L138 28 L184 70 L170 206 L146 202 L142 84 L142 222 L58 222 L58 84 L54 202 L30 206 L16 70 Z',
    x: '<path d="M88 20 L100 130 L112 20 M100 130 V222 M66 170 H88 M112 170 H134"/>',
  },
  coat: {
    d: 'M64 22 L88 14 L100 44 L112 14 L136 22 L186 70 L174 228 L150 224 L146 86 L146 240 L54 240 L54 86 L50 224 L26 228 L14 70 Z',
    x: '<path d="M88 14 L100 140 L112 14 M100 140 V240 M54 150 H146 M70 190 H90 M110 190 H130"/>',
  },
  pants: {
    d: 'M58 18 H142 L154 226 H108 L100 96 L92 226 H46 Z',
    x: '<path d="M58 32 H142 M100 32 V96 M64 32 V52 M136 32 V52"/>',
  },
  shoe: {
    d: 'M14 132 Q14 104 52 102 L88 98 Q108 122 144 126 Q188 130 188 158 V172 H14 Z',
    x: '<path d="M62 106 Q82 126 112 122 M30 150 Q80 140 120 150"/>',
    sole: 'M14 160 H188 V176 Q188 180 182 180 H20 Q14 180 14 176 Z',
  },
  sneaker: {
    d: 'M14 134 Q14 106 44 104 L82 100 Q100 120 130 124 Q188 128 188 156 V166 H14 Z',
    x: '<path d="M82 100 L92 112 M96 108 L106 120 M110 114 L120 124 M14 150 H188"/>',
    sole: 'M12 158 H190 V176 Q190 182 184 182 H18 Q12 182 12 176 Z',
  },
};
export function garment(shape, color) {
  const s = SHAPES[shape] || SHAPES.tee;
  const c = /^#[0-9a-f]{6}$/i.test(color) ? color : '#b7a48d';
  const shoe = !!s.sole;
  return `<svg class="garment" viewBox="0 0 200 240" role="img" aria-hidden="true">` +
    `<path d="${s.d}" fill="${c}"/><path d="${s.d}" fill="url(#gShade)"/>` +
    (shoe ? `<path d="${s.sole}" fill="#15120f"/>` : '') +
    `<g fill="none" stroke="rgba(0,0,0,.32)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${s.x}</g></svg>`;
}
export const SHAPE_OPTIONS = [
  ['tee', 'Футболка'], ['polo', 'Поло'], ['hoodie', 'Худи'], ['jacket', 'Пиджак / куртка'],
  ['coat', 'Пальто'], ['pants', 'Брюки'], ['shoe', 'Туфли / лоферы'], ['sneaker', 'Кеды'],
];
