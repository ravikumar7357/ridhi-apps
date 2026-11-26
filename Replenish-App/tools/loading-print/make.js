// Makes public/loading-print.svg, the ERP's loading picture (approved by Ravi, 26 Nov 2026): a Jaipur wooden block
// coming straight down five times on one spot, printing a floral spray in five colours, over and over.
//   node tools/loading-print/make.js
const fs = require('fs');
const path = require('path');

const BLUE = '#1556d6', RED = '#ea2a22', MUSTARD = '#ffb300', GREEN = '#1f9e4b', BROWN = '#5b2a14';   // bright inks, Ravi 26 Nov
// Printing order: each press lays one colour; the brown outline goes last, on top, as in Bagru printing.
const INKS = [BLUE, RED, MUSTARD, GREEN, BROWN];
const LIFT = 232;                       // how far the block rises above the cloth
const MID = { x: 460, y: 392 };         // where the print sits on screen
const CARVE = 15, THICK = 62;           // height of the carved face, and of the whole block

// A point on the tilted table (u along the cloth, v across it, h up) as screen coordinates.
// Seen from the front with the cloth turned, like Ravi's reference picture (26 Nov).
const at = (u, v, h = 0) => [MID.x + .87 * u - .5 * v, MID.y + .30 * u + .52 * v - h];
const pts = list => list.map(p => p.map(n => n.toFixed(1)).join(' ')).join(' L');
const shape = list => `M${pts(list)} Z`;
const flat = `matrix(.87 .30 -.5 .52 ${MID.x} ${MID.y})`;

/* ---- the block: old dark sheesham cut as an eight-petal flower, carved on top, with a turned
        mushroom knob from the same piece of wood (Ravi's photos, 26 Nov) ---- */
// A fixed wobble so the worn edge looks hand-cut but is the same every time.
const wobble = t => 2.2 * Math.sin(5 * t + 1) + 1.4 * Math.sin(13 * t + 2) + .8 * Math.sin(29 * t);
const ring = (r, lobes = 0, worn = 0, n = 96) => Array.from({ length: n }, (_, i) => {
  const t = (2 * Math.PI * i) / n, rr = r + lobes * Math.cos(8 * t) + worn * wobble(t);
  return [rr * Math.cos(t), rr * Math.sin(t)];
});
const OUTLINE = ring(114, 14, 1);

// The walls of a shape standing on the table, back ones first, each lighter the more it faces front.
function walls(outline, low, high, colour) {
  return outline.map(([u1, v1], i) => {
    const [u2, v2] = outline[(i + 1) % outline.length];
    const len = Math.hypot(u2 - u1, v2 - v1), nu = (v2 - v1) / len, nv = (u1 - u2) / len;
    if (.5 * nu + .87 * nv <= 0) return null;   // only walls facing the viewer
    const fill = colour(Math.max(0, .5 * nu + .87 * nv), i);
    const top = typeof high === 'function' ? high(i) : high;
    const d = shape([at(u1, v1, low), at(u2, v2, low), at(u2, v2, top), at(u1, v1, top)]);
    return { depth: .5 * (u1 + u2) + .87 * (v1 + v2), path: fill ? `<path d="${d}" fill="${fill}" stroke="${fill}" stroke-width="1"/>` : `<path d="${d}"/>` };
  }).filter(Boolean).sort((p, q) => p.depth - q.depth).map(w => w.path).join('');
}
// Old wood: darker, with some planks of the side a shade lighter or darker.
const wood = (front, i = 0) => `hsl(20 40% ${Math.round(11 + 14 * front + 2.5 * Math.sin(i * 1.7))}%)`;
const face = (outline, h) => shape(outline.map(([u, v]) => at(u, v, h)));
const onTable = h => `matrix(.87 .30 -.5 .52 ${MID.x} ${MID.y - h})`;
const topFace = face(OUTLINE, THICK);

// Ink that has crept up the sides from years of dipping: an uneven band above the carved edge.
const inkCreep = i => CARVE + 4 + Math.max(0, 9 * Math.sin(i * .55) + 6 * Math.sin(i * 1.9));
// Cracks and knocks on the sides.
const cracks = [[-60, 96, 26, 50], [40, 104, 30, 56], [100, 30, 20, 44], [-20, 118, 38, 58]].map(([u, v, h1, h2]) =>
  `<path d="M${pts([at(u, v, h1), at(u + 3, v, (h1 + h2) / 2 + 3), at(u - 2, v, h2)])}" fill="none" stroke="#120804" stroke-width="1.6" opacity=".8"/>`).join('');

// The top carving: the same ornate motif as the print, cut in relief: a dark groove, then a worn highlight.
const carving = colour => `<g color="${colour}" fill="${colour}">${blueLayer}${redLayer}${brownLayer}</g>`;

// Turned mushroom knob: a flared foot, a narrow neck, and a wide domed cap, all one piece.
const KNOB = [
  { r: 32, from: 0, to: 6 }, { r: 20, from: 6, to: 44 }, { r: 28, from: 44, to: 48 },
  { r: 48, from: 48, to: 70 },
];
const knob = KNOB.map(({ r, from, to }) =>
  walls(ring(r, 0, .4), THICK + from - 1, THICK + to, wood) +
  `<path d="${face(ring(r, 0, .4), THICK + to)}" fill="${to === 70 ? 'url(#knobTop)' : wood(.3)}"/>`).join('') +
  `<path d="${face(ring(48, 0, .4), THICK + 48)}" fill="none" stroke="#120804" stroke-width="2" opacity=".6"/>
   <path d="${face(ring(28), THICK + 70)}" fill="none" stroke="#a5704c" stroke-width="2" stroke-opacity=".45"/>
   <ellipse cx="${at(-14, -14, THICK + 70)[0]}" cy="${at(-14, -14, THICK + 70)[1]}" rx="12" ry="5" fill="#fff" opacity=".14"/>`;

const blockSvg = () => `
<g id="block" stroke-linejoin="round">
  <g class="inked">${walls(OUTLINE, 0, CARVE, () => '')}</g>
  <g filter="url(#wood)">${walls(OUTLINE, CARVE, THICK, wood)}</g>
  <g class="inked" opacity=".75">${walls(OUTLINE, CARVE - 1, inkCreep, () => '')}</g>
  ${walls(OUTLINE, CARVE, CARVE + 2, () => '#120804')}
  ${cracks}
  <path d="${topFace}" fill="url(#top)" filter="url(#wood)"/>
  <g clip-path="url(#onTop)">
    <g transform="${onTable(THICK)}">
      <g transform="translate(1.5 2.5) scale(.86)" opacity=".95">${carving('#140904')}</g>
      <g transform="scale(.86)" opacity=".55">${carving('#a8714b')}</g>
    </g>
  </g>
  <path d="${topFace}" fill="none" stroke="#7a4a2e" stroke-width="2.5" stroke-dasharray="14 3 6 4"/>
  ${knob}
</g>`;

/* ---- the print: the block's mandala, one group for each colour, turned a quarter on the cloth ---- */
const around = (n, draw, offset = 0) =>
  Array.from({ length: n }, (_, i) => `<g transform="rotate(${offset + (360 / n) * i})">${draw}</g>`).join('');
// The print, after Ravi's Bagru fabric photo (26 Nov): a free-flowing spray, not a medallion. A lotus fan,
// a round flower and a scalloped flower on winding stems, with a tulip bud, leaves and seed dots.
const mirrored = draw => `${draw}<g transform="scale(-1 1)">${draw}</g>`;
const LOTUS = 'translate(-38 26) rotate(-14)', ROUND = 'translate(56 -50)', CLOUD = 'translate(58 60)', TULIP = 'translate(-76 -74) rotate(-28)';
const FAN = [-68, -34, 0, 34, 68];
const PETAL = 'M0 -10 C-19 -26 -17 -56 0 -74 C17 -56 19 -26 0 -10 Z';
const TULIP_BUD = 'M0 0 C-15 -6 -17 -27 -11 -36 L-4 -25 L0 -38 L4 -25 L11 -36 C17 -27 15 -6 0 0 Z';
const LEAF = 'M0 0 C6 -9 18 -11 27 -6 C18 1 8 4 0 0 Z';
const LEAVES = [[-6, 74, 30], [18, 82, -10], [-12, -30, -50], [16, -48, 10], [-70, -30, -100], [-82, 70, 160], [92, 4, 60], [-100, 20, 200], [24, -96, -30]];
const STEMS = ['M-42 42 C-30 82 18 92 40 74', 'M-28 -12 C-10 -42 14 -52 36 -52', 'M-58 -4 C-80 -26 -84 -48 -78 -72',
  'M-46 44 C-66 70 -84 78 -98 66', 'M72 -30 C98 0 98 30 78 46', 'M-52 8 C-80 14 -96 24 -104 34', 'M40 -64 C30 -84 18 -96 2 -104', 'M74 -66 C84 -78 90 -86 92 -94', 'M-60 62 C-50 52 -46 48 -44 44'];
const ROUND2 = 'translate(-74 76) scale(.7)', TULIP2 = 'translate(94 -96) rotate(30) scale(.85)';
const at2 = (t, draw) => `<g transform="${t}">${draw}</g>`;

// Blue: the outlines of the flowers, the lotus petals and the round flower.
const blueLayer = `
  <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
    ${at2(LOTUS, '<path d="M-24 0 A24 24 0 0 1 24 0 Z" stroke-width="3"/>')}
    ${at2(CLOUD, around(6, '<circle cy="-22" r="16" stroke-width="3"/>') + '<circle r="15" stroke-width="2.4" stroke-dasharray="0.1 6"/>')}
    ${[TULIP, TULIP2].map(t => at2(t, `<path d="${TULIP_BUD}" stroke-width="3"/><path d="M0 -2 V-30" stroke-width="2"/>`)).join('')}
  </g>
  ${at2(LOTUS, FAN.map(a => `<path d="${PETAL}" transform="rotate(${a})"/>`).join(''))}
  ${[ROUND, ROUND2].map(t => at2(t, around(8, '<path d="M0 -12 C-12 -14 -16 -30 0 -36 C16 -30 12 -14 0 -12 Z"/>') + '<circle r="11"/>')).join('')}
  ${at2(LOTUS, FAN.map(a => `<path d="M0 -16 C-6 -36 -5 -54 0 -66" transform="rotate(${a})" fill="none" stroke="#f8f1e2" stroke-width="2.2" stroke-linecap="round"/>`).join(''))}`;

// Red: the lotus heart and vein marks, the scalloped flower, the tulip and the round flower's centre.
const redLayer =
  at2(LOTUS, '<path d="M-20 0 A20 20 0 0 1 20 0 Z"/>' + FAN.map(a => `<path d="M0 -26 C-4 -38 -3 -50 0 -58 C3 -50 4 -38 0 -26 Z" transform="rotate(${a})"/>`).join('')) +
  at2(CLOUD, around(6, '<circle cy="-22" r="13"/>') + '<circle r="20"/>') +
  [TULIP, TULIP2].map(t => at2(t, `<path d="${TULIP_BUD}" transform="scale(.82)"/>`)).join('') +
  [ROUND, ROUND2].map(t => at2(t, around(8, '<circle cy="-26" r="3.2"/>') + '<circle r="6"/>')).join('') +
  [[-4, -84], [96, -86], [-104, -8], [10, 108], [96, 100], [-60, 96]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.4"/>`).join('');

// Yellow: the flower centres, the dots round the lotus and in each round petal.
// Green: the leaves.
const greenLayer = LEAVES.map(([x, y, r]) => `<path d="${LEAF}" transform="translate(${x} ${y}) rotate(${r})"/>`).join('');
// Brown: the winding stems and the leaf edges and veins, printed last so they sit on top.
const brownLayer = `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
  ${STEMS.map(d => `<path d="${d}" stroke-width="3.4"/>`).join('')}
  ${LEAVES.map(([x, y, r]) => `<g transform="translate(${x} ${y}) rotate(${r})"><path d="${LEAF}" stroke-width="2.2"/><path d="M2 0 C10 -4 18 -5 24 -6" stroke-width="1.4"/></g>`).join('')}
</g>`;
const mustardLayer =
  at2(LOTUS, FAN.map(a => `<circle cy="-78" r="3.2" transform="rotate(${a})"/>`).join('') + '<circle cy="-6" r="5"/>') +
  [ROUND, ROUND2].map(t => at2(t, '<circle r="3"/>' + around(8, '<circle cy="-16" r="2.4"/>', 22.5))).join('') +
  at2(CLOUD, '<circle r="7"/>') +
  [[30, 0], [-6, 100], [100, -50], [-96, -40], [84, 92], [-24, -100]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3"/>`).join('');

// The second cloth: a long bordered runner lying under the printed square.
const runner = `
<g transform="${flat}"><g transform="translate(120 -10) rotate(-14)">
  <rect x="-150" y="-260" width="300" height="520" fill="#f3ead8" filter="url(#weave)"/>
  ${[-1, 1].map(side => `<g transform="scale(${side} 1)">
    <path d="M132 -260 V260" stroke="${BLUE}" stroke-width="7"/>
    <path d="M120 -260 V260" stroke="${BLUE}" stroke-width="5" stroke-dasharray="0.1 11" stroke-linecap="round"/>
    <path d="M104 -260 ${Array.from({ length: 13 }, (_, i) => `Q${i % 2 ? 92 : 116} ${-240 + i * 40} 104 ${-220 + i * 40}`).join(' ')}" fill="none" stroke="${MUSTARD}" stroke-width="4"/>
    ${Array.from({ length: 13 }, (_, i) => `<circle cx="${i % 2 ? 96 : 112}" cy="${-240 + i * 40}" r="4.5" fill="${BLUE}"/>`).join('')}
    <path d="M86 -260 V260" stroke="${BLUE}" stroke-width="3"/>
  </g>`).join('')}
</g></g>`;

const butis = [[-145, -78], [-145, 62], [145, -78], [145, 62]].map(([u, v]) =>
  `<g transform="translate(${u} ${v})"><circle r="4"/><circle cy="-11" r="3"/><circle cy="11" r="3"/><circle cx="-11" r="3"/><circle cx="11" r="3"/></g>`).join('');
const cloth = [at(-185, -138), at(185, -138), at(185, 138), at(-185, 138)];
const hem = [cloth[2], cloth[3], [cloth[3][0], cloth[3][1] + 4], [cloth[2][0], cloth[2][1] + 4]];
const side = [cloth[1], cloth[2], [cloth[2][0], cloth[2][1] + 4], [cloth[1][0], cloth[1][1] + 4]];

/* ---- timing: five straight presses, one colour each, then the cloth is cleared and it starts again ---- */
const press = [10, 27, 44, 61, 78];
const frames = (up, down) => `0% { ${up} } ` +
  press.map(p => `${p - 3}%, ${p + 2}% { ${down} } ${p + 10}% { ${up} }`).join(' ') + ` 100% { ${up} }`;
const show = (n, p) => `@keyframes show${n} { 0% { opacity: 0; } ${p}%, 95% { opacity: 1; } 99%, 100% { opacity: 0; } }`;
const inkSteps = INKS.map((c, i) => `${i ? press[i - 1] + 6 : 0}% { fill: ${c}; stroke: ${c}; }`).join(' ');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="212 -12 588 600" width="588" height="600" role="img" aria-label="Loading">
<!-- Loading picture: the block goes straight down five times, printing blue, red, yellow, green and
     brown into one floral print, then it starts again. Made by make-reload.js. -->
<style>
  svg { --run: 8s; }
  .print { mix-blend-mode: multiply; }
  .print { opacity: 0; animation: var(--run) step-end infinite; }
  #block { animation: stamp var(--run) ease-in-out infinite; }
  #shadow { animation: shade var(--run) ease-in-out infinite; }
  .inked { animation: ink var(--run) step-end infinite; }
  ${press.map((_, i) => `#print${i + 1} { animation-name: show${i + 1}; }`).join('\n  ')}
  @keyframes stamp { ${frames(`transform: translateY(-${LIFT}px);`, 'transform: translateY(0);')} }
  @keyframes shade { ${frames('opacity: 0;', 'opacity: .4;')} }
  @keyframes ink { ${inkSteps} }
  ${press.map((p, i) => show(i + 1, p)).join('\n  ')}
  @media (prefers-reduced-motion: reduce) { #block, #shadow, .inked { animation: none; } .print { animation: none; opacity: 1; } #block { transform: translateY(-${LIFT}px); } }
</style>
<defs>
  <radialGradient id="blue" cx=".35" cy=".28" r=".85"><stop offset="0" stop-color="#8fabc9"/><stop offset=".55" stop-color="#55749b"/><stop offset="1" stop-color="#314a6d"/></radialGradient>
  <linearGradient id="top" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6b4129"/><stop offset=".55" stop-color="#4f2d1b"/><stop offset="1" stop-color="#361d10"/></linearGradient>
  <radialGradient id="knobTop" cx=".38" cy=".3" r=".8"><stop offset="0" stop-color="#83533a"/><stop offset="1" stop-color="#3f2314"/></radialGradient>
  <linearGradient id="cloth" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fbf5e8"/><stop offset="1" stop-color="#e8dcc4"/></linearGradient>
  <clipPath id="onTop"><path d="${topFace}"/></clipPath>
  <filter id="soft" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="9"/></filter>
  <!-- Real block-printed ink: rough edges, patchy coverage where the block met the cloth unevenly, and tiny
       specks where ink did not take. -->
  <filter id="ink-grain" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency=".75" numOctaves="2" seed="4" result="fine"/>
    <feDisplacementMap in="SourceGraphic" in2="fine" scale="2.6" xChannelSelector="R" yChannelSelector="G" result="rough"/>
    <feTurbulence type="fractalNoise" baseFrequency=".06" numOctaves="3" seed="9" result="blot"/>
    <feColorMatrix in="blot" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  .7 0 0 0 .62" result="patchy"/>
    <feTurbulence type="fractalNoise" baseFrequency="1.3" numOctaves="1" seed="2" result="dust"/>
    <feColorMatrix in="dust" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 5 0 0 -.9" result="specks"/>
    <feComposite in="patchy" in2="specks" operator="in" result="cover"/>
    <feComposite in="rough" in2="cover" operator="in"/>
  </filter>
  <!-- Cotton weave on the cloths. -->
  <filter id="weave" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="1.2 .3" numOctaves="2" seed="2" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 .42  0 0 0 0 .35  0 0 0 0 .26  -.7 0 0 0 .38" result="threads"/>
    <feComposite in="threads" in2="SourceGraphic" operator="atop"/>
  </filter>
  <!-- Wood fibre on the block. -->
  <filter id="wood" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency=".5 .03" numOctaves="3" seed="6" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 .05  0 0 0 0 .02  0 0 0 0 0  -1.2 0 0 0 .62" result="fibre"/>
    <feComposite in="fibre" in2="SourceGraphic" operator="atop"/>
  </filter>
</defs>


${runner}
<path d="${shape(cloth.map(([x, y]) => [x, y + 20]))}" fill="#3b2a20" opacity=".25" filter="url(#soft)"/>
<path d="${shape(hem)}" fill="#c3b193"/><path d="${shape(side)}" fill="#ad9b7e"/>
<path d="${shape(cloth)}" fill="url(#cloth)" filter="url(#weave)"/>
<g transform="${flat}">
  <path d="M-176 -129 H176 V129 H-176 Z" fill="none" stroke="#6f86a3" stroke-width="3"/>
  <path d="M-169 -122 H169 V122 H-169 Z" fill="none" stroke="#8a6f63" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="0.1 10"/>
  <g fill="#8a6f63" opacity=".45">${butis}</g>
  <g filter="url(#ink-grain)">
    <g id="print3" class="print" fill="${MUSTARD}">${mustardLayer}</g>
    <g id="print4" class="print" fill="${GREEN}">${greenLayer}</g>
    <g id="print2" class="print" fill="${RED}">${redLayer}</g>
    <g id="print1" class="print" fill="${BLUE}" color="${BLUE}">${blueLayer}</g>
    <g id="print5" class="print" color="${BROWN}">${brownLayer}</g>
  </g>
</g>
<path id="shadow" d="${shape(OUTLINE.map(([u, v]) => at(u, v)))}" fill="#3b2a20" filter="url(#soft)"/>
${blockSvg()}
</svg>
`;

fs.writeFileSync(path.join(__dirname, '..', '..', 'public', 'loading-print.svg'), svg);
