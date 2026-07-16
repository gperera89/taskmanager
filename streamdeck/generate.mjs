// Generates the 15 Stream Deck key images (288×288 PNG) for the Cura profile,
// in the app's paper theme, reusing the exact Material Symbols glyph paths from
// the app's components. Run from this folder: node generate.mjs (uses client/'s sharp).
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(HERE, "../client/package.json"));
const sharp = require("sharp");

const OUT = HERE;
mkdirSync(OUT, { recursive: true });

// Cura light palette (globals.css)
const SURFACE = "#efe9dc";
const BORDER = "#d3c9b3";
const INK = "#2a2622";
const INK_MUTED = "#8a8069";
const ACCENT = "#17399b";

// Glyphs copied from the app (all viewBox 0 -960 960 960)
const GLYPHS = {
  myday:
    "M480-360q50 0 85-35t35-85q0-50-35-85t-85-35q-50 0-85 35t-35 85q0 50 35 85t85 35Zm0 80q-83 0-141.5-58.5T280-480q0-83 58.5-141.5T480-680q83 0 141.5 58.5T680-480q0 83-58.5 141.5T480-360ZM200-440H40v-80h160v80Zm720 0H760v-80h160v80ZM440-760v-160h80v160h-80Zm0 720v-160h80v160h-80ZM256-650l-101-97 57-59 96 100-52 56Zm492 496-97-101 53-55 101 97-57 59Zm-98-550 97-101 59 57-100 96-56-52ZM154-212l101-97 55 53-97 101-59-57Zm326-268Z",
  add: "M440-440H200v-80h240v-240h80v240h240v80H520v240h-80v-240Z",
  search:
    "M784-120 532-372q-30 24-69 38t-83 14q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l252 252-56 56ZM380-400q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400Z",
  history:
    "M480-120q-138 0-240.5-91.5T122-440h82q14 104 92.5 172T480-200q117 0 198.5-81.5T760-480q0-117-81.5-198.5T480-760q-69 0-129 32t-101 88h110v80H120v-240h80v94q51-64 124.5-99T480-840q75 0 140.5 28.5t114 77q48.5 48.5 77 114T840-480q0 75-28.5 140.5t-77 114q-48.5 48.5-114 77T480-120Zm112-192L440-464v-216h80v184l128 128-56 56Z",
  checklist:
    "M222-200 80-342l56-56 85 85 170-170 56 57-225 226Zm0-320L80-662l56-56 85 85 170-170 56 57-225 226Zm298 240v-80h360v80H520Zm0-320v-80h360v80H520Z",
  settings:
    "m370-80-16-128q-13-5-24.5-12T307-235l-119 50L78-375l103-78q-1-7-1-13.5v-27q0-6.5 1-13.5L78-585l110-190 119 50q11-8 23-15t24-12l16-128h220l16 128q13 5 24.5 12t22.5 15l119-50 110 190-103 78q1 7 1 13.5v27q0 6.5-2 13.5l103 78-110 190-118-50q-11 8-23 15t-24 12L590-80H370Zm70-80h79l14-106q31-8 57.5-23.5T639-327l99 41 39-68-86-65q5-14 7-29.5t2-31.5q0-16-2-31.5t-7-29.5l86-65-39-68-99 42q-22-23-48.5-38.5T533-694l-13-106h-79l-14 106q-31 8-57.5 23.5T321-633l-99-41-39 68 86 64q-5 15-7 30t-2 32q0 16 2 31t7 30l-86 65 39 68 99-42q22 23 48.5 38.5T427-266l13 106Zm42-180q58 0 99-41t41-99q0-58-41-99t-99-41q-59 0-99.5 41T342-480q0 58 40.5 99t99.5 41Zm-2-140Z",
  home: "M240-200h120v-240h240v240h120v-360L480-740 240-560v360Zm-80 80v-480l320-240 320 240v480H520v-240h-80v240H160Zm320-350Z",
  all: "M680-600h80v-80h-80v80Zm0 160h80v-80h-80v80Zm0 160h80v-80h-80v80Zm0 160v-80h160v-560H480v56l-80-58v-78h520v720H680Zm-640 0v-400l280-200 280 200v400H360v-200h-80v200H40Zm80-80h80v-200h240v200h80v-280L320-622 120-480v280Zm560-360ZM440-200v-200H200v200-200h240v200Z",
  work: "M160-120q-33 0-56.5-23.5T80-200v-440q0-33 23.5-56.5T160-720h160v-80q0-33 23.5-56.5T400-880h160q33 0 56.5 23.5T640-800v80h160q33 0 56.5 23.5T880-640v440q0 33-23.5 56.5T800-120H160Zm0-80h640v-440H160v440Zm240-520h160v-80H400v80ZM160-200v-440 440Z",
  close:
    "m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z",
};

// key: filename + what's drawn. kind "digit" draws a large serif numeral,
// kind "glyph" draws an icon with a small keycap badge showing the key to press.
const KEYS = [
  { file: "1-tasks", kind: "digit", char: "1", label: "Tasks" },
  { file: "2-projects", kind: "digit", char: "2", label: "Projects" },
  { file: "3-routines", kind: "digit", char: "3", label: "Routines" },
  { file: "4-habits", kind: "digit", char: "4", label: "Habits" },
  { file: "5-calendar", kind: "digit", char: "5", label: "Calendar" },
  { file: "d-my-day", kind: "glyph", glyph: "myday", char: "D", label: "My Day" },
  { file: "n-new", kind: "glyph", glyph: "add", char: "N", label: "New" },
  { file: "slash-search", kind: "glyph", glyph: "search", char: "/", label: "Search" },
  { file: "s-settings", kind: "glyph", glyph: "settings", char: "S", label: "Settings" },
  { file: "l-logbook", kind: "glyph", glyph: "history", char: "L", label: "Logbook" },
  { file: "r-review", kind: "glyph", glyph: "checklist", char: "R", label: "Review" },
  { file: "h-home-mode", kind: "glyph", glyph: "home", char: "H", label: "Home" },
  { file: "a-all-mode", kind: "glyph", glyph: "all", char: "A", label: "All" },
  { file: "w-work-mode", kind: "glyph", glyph: "work", char: "W", label: "Work" },
  { file: "esc-close", kind: "glyph", glyph: "close", char: "esc", label: "Close" },
];

const SERIF = "Georgia, 'Times New Roman', serif";

function svgFor(k) {
  const badge =
    k.kind === "glyph"
      ? `<rect x="18" y="18" width="${k.char.length > 1 ? 74 : 50}" height="50" rx="12"
           fill="none" stroke="${BORDER}" stroke-width="3"/>
         <text x="${18 + (k.char.length > 1 ? 37 : 25)}" y="53" text-anchor="middle"
           font-family="${SERIF}" font-size="${k.char.length > 1 ? 26 : 30}"
           fill="${INK_MUTED}">${k.char}</text>`
      : "";

  const art =
    k.kind === "digit"
      ? `<text x="144" y="172" text-anchor="middle" font-family="${SERIF}"
           font-size="150" fill="${ACCENT}">${k.char}</text>`
      : // Material Symbols paths use viewBox 0 -960 960 960; scale to ~118px, centered.
        `<g transform="translate(85, 55) scale(0.1229)">
           <g transform="translate(0, 960)">
             <path d="${GLYPHS[k.glyph]}" fill="${ACCENT}"/>
           </g>
         </g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="288" height="288">
    <rect width="288" height="288" fill="${SURFACE}"/>
    <rect x="7" y="7" width="274" height="274" rx="30" fill="none" stroke="${BORDER}" stroke-width="3"/>
    ${badge}
    ${art}
    <line x1="72" y1="205" x2="216" y2="205" stroke="${BORDER}" stroke-width="2"/>
    <text x="144" y="248" text-anchor="middle" font-family="${SERIF}" font-size="36"
      fill="${INK}">${k.label}</text>
  </svg>`;
}

for (const k of KEYS) {
  await sharp(Buffer.from(svgFor(k))).png().toFile(`${OUT}/${k.file}.png`);
  console.log(`wrote ${k.file}.png`);
}
