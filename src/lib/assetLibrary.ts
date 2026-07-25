export interface ConceptAsset {
  id: string;
  name: string;
  category: 'finance' | 'business' | 'people' | 'architecture' | 'flow' | 'icon';
  svgDataUrl: string;
  keywords: string[];
}

/**
 * Registry of rich, full-color digital vector illustrations.
 */
const ASSET_REGISTRY: Record<string, ConceptAsset> = {
  // --- CORE CONCEPTS ---
  waterfall: {
    id: 'asset:waterfall',
    name: 'Full Color Cascading Waterfall Landscape',
    category: 'flow',
    keywords: ['waterfall', 'flow', 'hub', 'distribution', 'river', 'cascade', 'landscape', 'nature'],
    svgDataUrl: createSvgDataUrl(`
      <defs>
        <linearGradient id="skyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#bae6fd" />
          <stop offset="100%" stop-color="#e0f2fe" />
        </linearGradient>
        <linearGradient id="waterfallStream" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#e0f2fe" />
          <stop offset="30%" stop-color="#38bdf8" />
          <stop offset="70%" stop-color="#0284c7" />
          <stop offset="100%" stop-color="#0369a1" />
        </linearGradient>
        <linearGradient id="lakeGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#38bdf8" />
          <stop offset="100%" stop-color="#0f766e" />
        </linearGradient>
        <linearGradient id="cliffLeft" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#334155" />
          <stop offset="100%" stop-color="#1e293b" />
        </linearGradient>
        <linearGradient id="cliffRight" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#475569" />
          <stop offset="100%" stop-color="#0f172a" />
        </linearGradient>
      </defs>
      <!-- Background Sky -->
      <rect width="100%" height="100%" fill="url(#skyGrad)"/>
      <circle cx="680" cy="90" r="45" fill="#fef08a" opacity="0.85"/>
      <!-- Background Mountain Ridges -->
      <polygon points="60 220, 220 110, 380 220" fill="#94a3b8" opacity="0.5"/>
      <polygon points="340 220, 520 80, 720 220" fill="#64748b" opacity="0.5"/>
      <!-- Left Rock Cliff -->
      <path d="M 0 420 L 0 160 L 320 180 L 290 420 Z" fill="url(#cliffLeft)"/>
      <path d="M 40 160 L 70 120 L 100 160 Z" fill="#15803d"/>
      <path d="M 120 170 L 150 130 L 180 170 Z" fill="#166534"/>
      <!-- Right Rock Cliff -->
      <path d="M 800 420 L 800 160 L 480 180 L 510 420 Z" fill="url(#cliffRight)"/>
      <path d="M 640 160 L 670 120 L 700 160 Z" fill="#15803d"/>
      <path d="M 700 170 L 730 130 L 760 170 Z" fill="#166534"/>
      <!-- Main Cascading Water Curtain -->
      <path d="M 305 175 L 495 175 L 530 360 L 270 360 Z" fill="url(#waterfallStream)"/>
      <!-- Water Highlight Stripes -->
      <line x1="340" y1="180" x2="330" y2="355" stroke="#ffffff" stroke-width="8" opacity="0.85"/>
      <line x1="390" y1="180" x2="385" y2="355" stroke="#ffffff" stroke-width="12" opacity="0.9"/>
      <line x1="440" y1="180" x2="445" y2="355" stroke="#ffffff" stroke-width="10" opacity="0.85"/>
      <line x1="470" y1="180" x2="480" y2="355" stroke="#ffffff" stroke-width="6" opacity="0.8"/>
      <!-- Foreground Emerald Lake -->
      <ellipse cx="400" cy="420" rx="420" ry="80" fill="url(#lakeGrad)"/>
      <!-- Water Foam & Splash Cloud -->
      <ellipse cx="400" cy="365" rx="140" ry="24" fill="#ffffff" opacity="0.9"/>
      <ellipse cx="400" cy="360" rx="100" ry="16" fill="#f0f9ff" opacity="0.95"/>
      <!-- Floating Mist Orbs -->
      <circle cx="310" cy="350" r="18" fill="#ffffff" opacity="0.6"/>
      <circle cx="490" cy="350" r="22" fill="#ffffff" opacity="0.6"/>
      <circle cx="400" cy="340" r="28" fill="#ffffff" opacity="0.7"/>
    `),
  },

  vault: {
    id: 'asset:vault',
    name: 'Full Color Gold & Steel Reserve Vault',
    category: 'finance',
    keywords: ['vault', 'bank', 'reserve', 'savings', 'emergency', 'fortress'],
    svgDataUrl: createSvgDataUrl(`
      <defs>
        <linearGradient id="vaultBg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#1e293b" />
          <stop offset="100%" stop-color="#0f172a" />
        </linearGradient>
        <linearGradient id="steelDoor" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#94a3b8" />
          <stop offset="100%" stop-color="#475569" />
        </linearGradient>
        <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#fef08a" />
          <stop offset="100%" stop-color="#eab308" />
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#vaultBg)"/>
      <!-- Bank Vault Body -->
      <rect x="140" y="50" width="520" height="400" rx="40" fill="url(#steelDoor)" stroke="#cbd5e1" stroke-width="8"/>
      <!-- Inner Heavy Dial -->
      <circle cx="400" cy="250" r="130" fill="#1e293b" stroke="url(#goldGrad)" stroke-width="12"/>
      <circle cx="400" cy="250" r="95" fill="url(#steelDoor)" stroke="#0284c7" stroke-width="6"/>
      <circle cx="400" cy="250" r="40" fill="url(#goldGrad)"/>
      <!-- Vault Lock Wheel Spokes -->
      <rect x="388" y="130" width="24" height="240" rx="12" fill="url(#goldGrad)"/>
      <rect x="280" y="238" width="240" height="24" rx="12" fill="url(#goldGrad)"/>
      <!-- Shield Emblem -->
      <path d="M 400 80 L 445 115 V 160 C 445 195 400 220 400 220 C 400 220 355 195 355 160 V 115 Z" fill="#10b981" stroke="#ffffff" stroke-width="4"/>
    `),
  },

  growth_chart: {
    id: 'asset:growth_chart',
    name: 'Full Color Compounding Growth Mountain',
    category: 'finance',
    keywords: ['growth_chart', 'growth', 'chart', 'compounding', 'stocks', 'roi'],
    svgDataUrl: createSvgDataUrl(`
      <defs>
        <linearGradient id="growthBg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#312e81" />
          <stop offset="100%" stop-color="#4c1d95" />
        </linearGradient>
        <linearGradient id="chartLineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#f472b6" />
          <stop offset="50%" stop-color="#c084fc" />
          <stop offset="100%" stop-color="#4ade80" />
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#growthBg)"/>
      <!-- 3D Bar Columns -->
      <rect x="180" y="300" width="60" height="100" rx="12" fill="#818cf8"/>
      <rect x="280" y="240" width="60" height="160" rx="12" fill="#a78bfa"/>
      <rect x="380" y="170" width="60" height="230" rx="12" fill="#c084fc"/>
      <rect x="480" y="100" width="60" height="300" rx="12" fill="#f472b6"/>
      <rect x="580" y="60" width="60" height="340" rx="12" fill="#4ade80"/>
      <!-- Exponential Curve -->
      <path d="M 160 330 C 320 310 480 180 610 70" stroke="url(#chartLineGrad)" stroke-width="14" stroke-linecap="round" fill="none"/>
      <circle cx="610" cy="70" r="20" fill="#4ade80" stroke="#ffffff" stroke-width="5"/>
      <text x="610" y="78" font-family="sans-serif" font-size="30" text-anchor="middle">🚀</text>
    `),
  },

  people: {
    id: 'asset:people',
    name: 'Full Color Team & Executive Group',
    category: 'people',
    keywords: ['people', 'team', 'person', 'users', 'buffer', 'skills', 'human'],
    svgDataUrl: createSvgDataUrl(`
      <rect width="100%" height="100%" fill="#f0fdf4"/>
      <circle cx="230" cy="170" r="55" fill="#38bdf8"/>
      <path d="M 140 380 C 140 280 320 280 320 380 Z" fill="#0284c7"/>
      <circle cx="570" cy="170" r="55" fill="#f472b6"/>
      <path d="M 480 380 C 480 280 660 280 660 380 Z" fill="#db2777"/>
      <circle cx="400" cy="140" r="65" fill="#10b981"/>
      <path d="M 290 380 C 290 260 510 260 510 380 Z" fill="#047857"/>
      <circle cx="400" cy="220" r="30" fill="#f59e0b"/>
      <text x="400" y="230" font-family="sans-serif" font-size="32" text-anchor="middle">⭐</text>
    `),
  },

  money: {
    id: 'asset:money',
    name: 'Full Color Cash & Income Banknote',
    category: 'finance',
    keywords: ['money', 'cash', 'dollars', 'income', 'capital', 'paycheck'],
    svgDataUrl: createSvgDataUrl(`
      <rect width="100%" height="100%" fill="#ecfdf5"/>
      <rect x="130" y="70" width="540" height="340" rx="36" fill="#10b981" stroke="#047857" stroke-width="10"/>
      <rect x="160" y="100" width="480" height="280" rx="24" fill="none" stroke="#a7f3d0" stroke-width="8" stroke-dasharray="16 10"/>
      <circle cx="400" cy="240" r="80" fill="#047857" stroke="#ffffff" stroke-width="8"/>
      <text x="400" y="270" font-family="sans-serif" font-size="85" font-weight="900" fill="#ffffff" text-anchor="middle">$</text>
      <circle cx="210" cy="150" r="28" fill="#059669"/>
      <circle cx="590" cy="150" r="28" fill="#059669"/>
      <circle cx="210" cy="330" r="28" fill="#059669"/>
      <circle cx="590" cy="330" r="28" fill="#059669"/>
    `),
  },

  building: {
    id: 'asset:building',
    name: 'Enterprise Headquarters',
    category: 'architecture',
    keywords: ['building', 'office', 'company', 'headquarters', 'corporate'],
    svgDataUrl: createSvgDataUrl(`
      <rect width="100%" height="100%" fill="#f8fafc"/>
      <rect x="240" y="80" width="320" height="380" rx="20" fill="#1e293b" stroke="#334155" stroke-width="8"/>
      <g fill="#38bdf8">
        <rect x="280" y="130" width="55" height="50" rx="8"/>
        <rect x="372" y="130" width="55" height="50" rx="8"/>
        <rect x="465" y="130" width="55" height="50" rx="8"/>
        <rect x="280" y="210" width="55" height="50" rx="8"/>
        <rect x="372" y="210" width="55" height="50" rx="8"/>
        <rect x="465" y="210" width="55" height="50" rx="8"/>
        <rect x="280" y="290" width="55" height="50" rx="8"/>
        <rect x="372" y="290" width="55" height="50" rx="8"/>
        <rect x="465" y="290" width="55" height="50" rx="8"/>
      </g>
      <rect x="350" y="370" width="100" height="90" rx="10" fill="#f1f5f9"/>
      <line x1="400" y1="370" x2="400" y2="460" stroke="#94a3b8" stroke-width="4"/>
    `),
  },

  direct_deposit_phone: {
    id: 'asset:direct_deposit_phone',
    name: 'Direct Deposit Phone Notification',
    category: 'finance',
    keywords: ['phone', 'direct deposit', 'income', 'notification', 'paycheck', '500'],
    svgDataUrl: createSvgDataUrl(`
      <rect width="100%" height="100%" fill="#eff6ff"/>
      <rect x="270" y="30" width="260" height="440" rx="36" fill="#0f172a" stroke="#334155" stroke-width="8"/>
      <rect x="290" y="60" width="220" height="380" rx="24" fill="#f8fafc"/>
      <rect x="305" y="130" width="190" height="120" rx="20" fill="#10b981"/>
      <text x="400" y="168" font-family="sans-serif" font-size="18" font-weight="bold" fill="#ffffff" text-anchor="middle">DIRECT DEPOSIT</text>
      <text x="400" y="215" font-family="sans-serif" font-size="36" font-weight="900" fill="#ffffff" text-anchor="middle">+$500.00</text>
      <circle cx="400" cy="320" r="40" fill="#fef08a"/>
      <circle cx="385" cy="310" r="5" fill="#000000"/>
      <circle cx="415" cy="310" r="5" fill="#000000"/>
      <path d="M 380 330 Q 400 350 420 330" stroke="#000000" stroke-width="5" fill="none" stroke-linecap="round"/>
    `),
  },
};

/**
 * Resolves an asset by concept key or keyword alias.
 */
export function getAsset(conceptOrName: string): ConceptAsset {
  const cleanKey = conceptOrName
    .toLowerCase()
    .replace(/^asset:/, '')
    .replace(/^asset\s*\d*:\s*/i, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .trim();

  // 1. Direct exact match
  if (ASSET_REGISTRY[cleanKey]) {
    return ASSET_REGISTRY[cleanKey];
  }

  // 2. Normalize key aliases
  if (cleanKey.includes('vault') || cleanKey.includes('fortress') || cleanKey.includes('reserve')) return ASSET_REGISTRY['vault'];
  if (cleanKey.includes('growth') || cleanKey.includes('chart') || cleanKey.includes('compounding')) return ASSET_REGISTRY['growth_chart'];
  if (cleanKey.includes('people') || cleanKey.includes('team') || cleanKey.includes('skill') || cleanKey.includes('buffer')) return ASSET_REGISTRY['people'];
  if (cleanKey.includes('money') || cleanKey.includes('income') || cleanKey.includes('cash') || cleanKey.includes('capital')) return ASSET_REGISTRY['money'];
  if (cleanKey.includes('waterfall') || cleanKey.includes('flow') || cleanKey.includes('river')) return ASSET_REGISTRY['waterfall'];
  if (cleanKey.includes('building') || cleanKey.includes('office') || cleanKey.includes('company')) return ASSET_REGISTRY['building'];
  if (cleanKey.includes('phone') || cleanKey.includes('deposit')) return ASSET_REGISTRY['direct_deposit_phone'];

  // 3. Keyword match search
  for (const asset of Object.values(ASSET_REGISTRY)) {
    if (asset.keywords.some((kw) => cleanKey.includes(kw) || kw.includes(cleanKey))) {
      return asset;
    }
  }

  // 4. Fallback rich vector generator for custom concept names
  return {
    id: `asset:${cleanKey}`,
    name: conceptOrName,
    category: 'icon',
    keywords: [cleanKey],
    svgDataUrl: createCustomConceptSvg(conceptOrName),
  };
}

export function listAvailableAssets(): ConceptAsset[] {
  return Object.values(ASSET_REGISTRY);
}

function createSvgDataUrl(svgInner: string): string {
  const fullSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500">${svgInner}</svg>`;
  const base64 =
    typeof window !== 'undefined'
      ? btoa(unescape(encodeURIComponent(fullSvg)))
      : Buffer.from(fullSvg).toString('base64');
  return `data:image/svg+xml;base64,${base64}`;
}

/**
 * Dynamically generates a high-fidelity vector badge SVG with multi-color HSL gradients & 3D styling.
 */
function createCustomConceptSvg(conceptName: string): string {
  const label = conceptName.replace(/[-_]/g, ' ').toUpperCase();
  const gradients = [
    { start: '#2563eb', end: '#3b82f6', icon: '⚡' },
    { start: '#059669', end: '#10b981', icon: '📈' },
    { start: '#7c3aed', end: '#a855f7', icon: '🔮' },
    { start: '#d97706', end: '#f59e0b', icon: '🎯' },
    { start: '#db2777', end: '#ec4899', icon: '💎' },
    { start: '#0284c7', end: '#06b6d4', icon: '🌊' },
  ];
  const hash = conceptName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const theme = gradients[hash % gradients.length];

  const svgInner = `
    <defs>
      <linearGradient id="badgeGrad_${hash}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${theme.start}" />
        <stop offset="100%" stop-color="${theme.end}" />
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="none"/>
    <rect x="140" y="80" width="520" height="340" rx="36" fill="url(#badgeGrad_${hash})" stroke="#ffffff" stroke-width="6"/>
    <circle cx="400" cy="210" r="65" fill="#ffffff" opacity="0.95"/>
    <text x="400" y="232" font-family="sans-serif" font-size="55" text-anchor="middle">${theme.icon}</text>
    <text x="400" y="345" font-family="sans-serif" font-size="32" font-weight="900" fill="#ffffff" text-anchor="middle">${label}</text>
  `;

  return createSvgDataUrl(svgInner);
}
