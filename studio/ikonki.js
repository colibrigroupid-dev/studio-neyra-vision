// №52 · Единая рука: viewBox="0 0 20 20", fill="none", stroke="currentColor",
// stroke-width="1.5", stroke-linecap="round", stroke-linejoin="round".
// Каждое значение — только d одного <path>, включая отдельные подпути.
export const svgPaths = {
  overview: 'M4 3h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM12 3h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM4 11h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1zM12 11h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z',
  map: 'M3.5 3h13A1.5 1.5 0 0 1 18 4.5v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 2 15.5v-11A1.5 1.5 0 0 1 3.5 3zM2 8h16M2 12h16M7.5 3v14M12.5 3v14',
  script: 'M6.5 2h5L16 6.5v10a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 5 16.5v-13A1.5 1.5 0 0 1 6.5 2zM11.5 2v4.5H16M8 10h5M8 13h5M8 16h3',
  breakdown: 'M7 4V3a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-1M4 6h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM3 10h11M6 13h5M6 15.5h3',
  heroes: 'M10 9.5a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5zM3.5 17v-1a6.5 5 0 0 1 13 0v1',
  locations: 'M10 18s5-5.4 5-9a5 5 0 0 0-10 0c0 3.6 5 9 5 9zM10 10.5a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5z',
  world: 'M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM3 13l4-5 4 5 2-2 4 3M12.5 7a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  storyboard: 'M3 4h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM7.5 4v12M12.5 4v12M2 8h16',
  animatic: 'M3.5 5.5h13A1.5 1.5 0 0 1 18 7v6a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 2 13V7a1.5 1.5 0 0 1 1.5-1.5zM8 8l4 2-4 2z',
  shots: 'M2.5 8h15v8.5A1.5 1.5 0 0 1 16 18H4a1.5 1.5 0 0 1-1.5-1.5V8zM2.5 8l-.6-3 14.7-3 .6 3-14.7 3zM6 4.2l2 2.6M11 3.2l2 2.6M2.5 11.5h15',
  continuity: 'M16.5 6A7.5 7.5 0 1 0 17.5 10M13 5.5h4V2M6.5 10l2.5 2.5 4.5-4.5',
  sound: 'M3 8v4M6.5 5v10M10 2.5v15M13.5 5v10M17 8v4',
  edit: 'M5.5 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM5.5 17a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM7.5 7l9 10M7.5 13l9-10',
  post: 'M3 5h14M3 10h14M3 15h14M7 3v4M13 8v4M8 13v4',
  plan: 'M4.5 3h11A1.5 1.5 0 0 1 17 4.5v11a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 15.5v-11A1.5 1.5 0 0 1 4.5 3zM6 7l1 1 2-2M11 7h3M6 12l1 1 2-2M11 12h3',
  journal: 'M5.5 3h10A1.5 1.5 0 0 1 17 4.5v11a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 4 15.5v-11A1.5 1.5 0 0 1 5.5 3zM7 3v14M2.5 6H5M2.5 10H5M2.5 14H5M10 7h4M10 10h4M10 13h2',
  team: 'M10 8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM5.5 17v-1.5a4.5 4.5 0 0 1 9 0V17M4 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM2 16v-1a3.5 3.5 0 0 1 2-3M16 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 16v-1a3.5 3.5 0 0 0-2-3',
  globe: 'M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM2 10h16M10 2c-4 4-4 12 0 16M10 2c4 4 4 12 0 16',
  tokeny: 'M9 3a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM13 17.5a6.5 6.5 0 0 0 4.5-10M9 6.5l2.5 3L9 12.5l-2.5-3z',
  plus: 'M10 3v14M3 10h14',
  close: 'M4 4l12 12M16 4 4 16',
  check: 'M3.5 10l4.5 4.5 8.5-9',
  arrow: 'M3 10h14M11.5 4.5 17 10l-5.5 5.5',
  back: 'M17 10H3M8.5 4.5 3 10l5.5 5.5',
  download: 'M10 2.5V12M6 8l4 4 4-4M3 13.5V16a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 17 16v-2.5',
  upload: 'M10 12V2.5M6 6.5l4-4 4 4M3 13.5V16a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 17 16v-2.5',
  save: 'M4.5 3H14l3 3v9.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 15.5v-11A1.5 1.5 0 0 1 4.5 3zM6 3v5h7V3M6 17v-5h8v5',
  pause: 'M6.5 4v12M13.5 4v12',
  play: 'M6 3.5 16 10 6 16.5z',
  mic: 'M10 12a2.5 2.5 0 0 0 2.5-2.5v-5a2.5 2.5 0 0 0-5 0v5A2.5 2.5 0 0 0 10 12zM5 9.5a5 5 0 0 0 10 0M10 14.5V18M7.5 18h5',
  send: 'M2.5 3.5 18 10 2.5 16.5 5 10 2.5 3.5zM5 10h13',
  search: 'M8.5 14a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM12.5 12.5 17 17',
  lock: 'M5 8h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM7 8V5a3 3 0 0 1 6 0v3M10 11.5v2',
  unlock: 'M5 8h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM7 8V5a3 3 0 0 1 6 0M10 11.5v2',
  refresh: 'M17 7a7 7 0 0 0-12-2M3 3v4h4M3 13a7 7 0 0 0 12 2M17 17v-4h-4',
  'edit-pen': 'M12.5 3.5a2.12 2.12 0 0 1 3 3L7 15l-4 1 1-4 8.5-8.5zM11 5l3 3M10 17h7',
  trash: 'M3 5h14M7 5V3h6v2M5 5l.75 11a1 1 0 0 0 1 1h6.5a1 1 0 0 0 1-1L15 5M8 8.5v5M12 8.5v5',
  link: 'M8 7l2-2a3.54 3.54 0 0 1 5 5l-2 2M12 13l-2 2a3.54 3.54 0 0 1-5-5l2-2M7.5 12.5l5-5',
  copy: 'M7 6V3.5A1.5 1.5 0 0 1 8.5 2h7A1.5 1.5 0 0 1 17 3.5v9a1.5 1.5 0 0 1-1.5 1.5H13M4.5 6h7A1.5 1.5 0 0 1 13 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 16.5v-9A1.5 1.5 0 0 1 4.5 6z',
  calendar: 'M4.5 4h11A1.5 1.5 0 0 1 17 5.5v10a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 15.5v-10A1.5 1.5 0 0 1 4.5 4zM6.5 2v4M13.5 2v4M3 8h14M7 11h.01M10 11h.01M13 11h.01M7 14h.01M10 14h.01',
  clock: 'M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM10 5v5l3 2',
  star: 'M10 2.5l2.3 4.7 5.2.8-3.75 3.65.9 5.2L10 14.4l-4.65 2.45.9-5.2L2.5 8l5.2-.8z',
  warning: 'M8.7 3.5a1.5 1.5 0 0 1 2.6 0l6.5 11.25a1.5 1.5 0 0 1-1.3 2.25h-13a1.5 1.5 0 0 1-1.3-2.25L8.7 3.5zM10 7v4M10 14h.01',
  info: 'M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM10 6h.01M9 9h1v5M9 14h2'
};

// Пустые состояния декоративные; смысл и действие задаёт текст рядом с SVG.
// Линия #6f6f6f, один акцент #e8c27a; никаких фильтров и градиентов.
export const illustrations = {
  breakdown: `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="140" viewBox="0 0 240 140" fill="none" stroke="#6f6f6f" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="28" y="49" width="54" height="66" rx="6"/><rect x="93" y="31" width="54" height="84" rx="6"/><rect x="158" y="49" width="54" height="66" rx="6"/>
    <rect x="36" y="57" width="38" height="21.375" rx="2"/><rect x="101" y="39" width="38" height="21.375" rx="2"/><rect x="166" y="57" width="38" height="21.375" rx="2"/>
    <path d="M36 90h30M36 99h20M101 73h30M101 82h24M101 91h28M166 90h30M166 99h20M28 123h184"/>
    <path d="M101 103h18" stroke="#e8c27a"/>
  </svg>`,
  heroes: `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="140" viewBox="0 0 240 140" fill="none" stroke="#6f6f6f" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="51" y="21" width="104" height="102" rx="8"/><circle cx="103" cy="52" r="18"/><path d="M71 108v-4a32 27 0 0 1 64 0v4M75 114h56M174 77V65a8 8 0 0 1 16 0v12"/>
    <path d="M170 77h24a3 3 0 0 1 3 3v20a3 3 0 0 1-3 3h-24a3 3 0 0 1-3-3V80a3 3 0 0 1 3-3zM182 87v7" stroke="#e8c27a"/>
  </svg>`,
  locations: `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="140" viewBox="0 0 240 140" fill="none" stroke="#6f6f6f" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="40" y="25" width="160" height="90" rx="6"/><path d="m53 88 29-35 26 30 19-20 33 30h27M53 99h134M91 115c13-10 35-11 44-21M40 123h160"/>
    <path d="M168 64s8-8.5 8-14a8 8 0 0 0-16 0c0 5.5 8 14 8 14zM168 53a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" stroke="#e8c27a"/>
  </svg>`,
  storyboard: `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="140" viewBox="0 0 240 140" fill="none" stroke="#6f6f6f" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="12" y="50" width="64" height="36" rx="4"/><rect x="88" y="50" width="64" height="36" rx="4"/><rect x="164" y="50" width="64" height="36" rx="4"/>
    <path d="m20 77 13-16 16 16 9-9 10 9M96 78l15-13 10 10 8-7 15 10M172 77h48M184 77V65h17v12M12 98h64M88 98h64M164 98h64M80 68h4M156 68h4"/>
    <circle cx="135" cy="61" r="3" stroke="#e8c27a"/>
  </svg>`,
  map: `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="140" viewBox="0 0 240 140" fill="none" stroke="#6f6f6f" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="56" y="28" width="128" height="84" rx="6"/><path d="M88 28v84M120 28v84M152 28v84M56 56h128M56 84h128M66 42h12M130 42h12M162 70h12M98 98h12M56 123h128"/>
    <path d="m97 69 5 5 10-10" stroke="#e8c27a"/>
  </svg>`,
  team: `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="140" viewBox="0 0 240 140" fill="none" stroke="#6f6f6f" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="120" cy="51" r="15"/><circle cx="68" cy="64" r="11"/><circle cx="172" cy="64" r="11"/>
    <path d="M94 112v-9a26 24 0 0 1 52 0v9M48 112v-10a20 19 0 0 1 37-10M192 112v-10a20 19 0 0 0-37-10M48 120h144"/>
    <circle cx="133" cy="39" r="3" fill="#e8c27a" stroke="#e8c27a"/>
  </svg>`,
  post: `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="140" viewBox="0 0 240 140" fill="none" stroke="#6f6f6f" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="28" y="40" width="184" height="58" rx="5"/><rect x="40" y="57" width="44" height="24.75" rx="2"/><rect x="98" y="57" width="44" height="24.75" rx="2"/><rect x="156" y="57" width="44" height="24.75" rx="2"/>
    <path d="M40 47h6M58 47h6M76 47h6M94 47h6M112 47h6M130 47h6M148 47h6M166 47h6M184 47h6M40 91h6M58 91h6M76 91h6M94 91h6M112 91h6M130 91h6M148 91h6M166 91h6M184 91h6M40 116h160M40 112v8M84 112v8M142 112v8M200 112v8"/>
    <path d="M116 26h8l-4 6zM120 32v78" stroke="#e8c27a"/>
  </svg>`,
  tokeny: `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="140" viewBox="0 0 240 140" fill="none" stroke="#6f6f6f" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="91" cy="68" r="32"/><circle cx="91" cy="68" r="24"/><rect x="140" y="38" width="52" height="65" rx="6"/><path d="M151 53h30M151 67h21M151 81h27M151 93h14M48 118h144"/>
    <path d="m91 56 10 12-10 12-10-12z" stroke="#e8c27a"/>
  </svg>`
};
