import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

const USERNAME = 'Dmgar';
const TOKEN = process.env.GITHUB_TOKEN || '';

const LANGUAGE_COLORS = {
  Python: '#38BDF8',
  TypeScript: '#3178C6',
  'Jupyter / R&D': '#F97316',
  'CSS / Styling': '#A855F7',
  JavaScript: '#FACC15',
  'Shell & DevOps': '#10B981',
};

function fetchJson(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const headers = {
      'User-Agent': 'Dmgar-Metrics-Generator',
      Accept: 'application/vnd.github+json',
      ...extraHeaders,
    };
    if (TOKEN) {
      headers.Authorization = `Bearer ${TOKEN}`;
    }

    https
      .get(url, { headers }, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(body || '{}'));
            } catch (err) {
              reject(err);
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode} for ${url}: ${body.slice(0, 200)}`));
          }
        });
      })
      .on('error', reject);
  });
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function main() {
  console.log(`Fetching GitHub telemetry for @${USERNAME}...`);

  const user = await fetchJson(`https://api.github.com/users/${USERNAME}`);
  const repos = await fetchJson(`https://api.github.com/users/${USERNAME}/repos?per_page=100&sort=updated`);

  let totalCommits = 255;
  try {
    const commitSearch = await fetchJson(
      `https://api.github.com/search/commits?q=author:${USERNAME}`,
      { Accept: 'application/vnd.github.cloak-preview+json' }
    );
    if (typeof commitSearch.total_count === 'number' && commitSearch.total_count > 0) {
      totalCommits = commitSearch.total_count;
    }
  } catch (err) {
    console.warn('Commit search fallback used:', err.message);
  }

  const rawLangBytes = {};
  let pureCodeBytes = 0;

  for (const repo of repos) {
    if (repo.fork) continue;
    const langs = await fetchJson(repo.languages_url);
    for (const [lang, bytes] of Object.entries(langs)) {
      rawLangBytes[lang] = (rawLangBytes[lang] || 0) + bytes;
      if (lang !== 'Jupyter Notebook') {
        pureCodeBytes += bytes;
      } else {
        // Weight Jupyter Notebook at 4.5% to strip embedded base64 plot inflation
        pureCodeBytes += Math.round(bytes * 0.045);
      }
    }
  }

  const normalizedBuckets = {
    Python: rawLangBytes.Python || 0,
    'Jupyter / R&D': Math.round((rawLangBytes['Jupyter Notebook'] || 0) * 0.045),
    TypeScript: rawLangBytes.TypeScript || 0,
    'CSS / Styling': (rawLangBytes.CSS || 0) + (rawLangBytes.HTML || 0),
    JavaScript: rawLangBytes.JavaScript || 0,
    'Shell & DevOps':
      (rawLangBytes.Shell || 0) +
      (rawLangBytes.PowerShell || 0) +
      (rawLangBytes.Dockerfile || 0),
  };

  const totalWeighted = Object.values(normalizedBuckets).reduce((acc, v) => acc + v, 0) || 1;

  const sortedLangs = Object.entries(normalizedBuckets)
    .filter(([, bytes]) => bytes > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([name, bytes]) => ({
      name,
      bytes,
      pct: (bytes / totalWeighted) * 100,
      color: LANGUAGE_COLORS[name] || '#64748B',
    }));

  // Build stacked progress bar segments (total width = 404px)
  const barWidth = 404;
  let currentX = 0;
  const stackedSegments = sortedLangs.map((lang, idx) => {
    const w =
      idx === sortedLangs.length - 1
        ? Math.max(4, barWidth - currentX)
        : Math.max(4, Math.round((lang.pct / 100) * barWidth));
    const seg = { ...lang, x: currentX, width: w };
    currentX += w;
    return seg;
  });

  const codeMegabytes = (pureCodeBytes / (1024 * 1024)).toFixed(1);
  const publicRepos = user.public_repos || repos.length;
  const updatedDate = new Date().toISOString().slice(0, 10);

  const langRowsSvg = sortedLangs
    .slice(0, 6)
    .map((lang, idx) => {
      const y = 96 + idx * 22;
      const fillWidth = Math.max(6, Math.round((lang.pct / 50) * 165));
      return `
    <g transform="translate(466, ${y})">
      <circle cx="6" cy="-4" r="4.5" fill="${lang.color}" />
      <text x="18" y="0" class="font-sans" font-size="11.5" font-weight="600" fill="#E2E8F0">${escapeXml(lang.name)}</text>
      <rect x="148" y="-9" width="175" height="7" rx="3.5" fill="#1E293B" />
      <rect x="148" y="-9" width="${Math.min(175, fillWidth)}" height="7" rx="3.5" fill="${lang.color}" />
      <text x="404" y="0" text-anchor="end" class="font-mono" font-size="11" font-weight="700" fill="#94A3B8">${lang.pct.toFixed(1)}%</text>
    </g>`;
    })
    .join('');

  const stackedBarSvg = stackedSegments
    .map(
      (seg) =>
        `<rect x="${seg.x}" y="0" width="${seg.width}" height="10" fill="${seg.color}" />`
    )
    .join('\n      ');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 245" width="100%" height="100%" role="img" aria-label="GitHub Engineering Telemetry &amp; Language Distribution for Dariem García">
  <defs>
    <linearGradient id="cardBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0B0F17" />
      <stop offset="100%" stop-color="#0D1117" />
    </linearGradient>
    <clipPath id="barClip">
      <rect x="0" y="0" width="404" height="10" rx="5" />
    </clipPath>
    <style>
      .font-sans {
        font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif;
      }
      .font-mono {
        font-family: 'Fira Code', 'JetBrains Mono', 'Cascadia Code', Consolas, monospace;
      }
    </style>
  </defs>

  <!-- Outer Container -->
  <rect width="900" height="245" rx="12" fill="url(#cardBg)" stroke="#21262D" stroke-width="1.5" />

  <!-- Vertical Divider -->
  <line x1="442" y1="20" x2="442" y2="225" stroke="#1E293B" stroke-width="1.2" />

  <!-- ================= LEFT PANEL: ENGINEERING TELEMETRY ================= -->
  <text x="26" y="32" class="font-mono" font-size="12" font-weight="700" fill="#38BDF8" letter-spacing="0.6">
    GITHUB ENGINEERING TELEMETRY // @DMGAR
  </text>
  <text x="26" y="50" class="font-sans" font-size="11.5" fill="#94A3B8">
    Quantitative modeling, full-stack repositories &amp; open-source activity
  </text>

  <!-- KPI Grid (2x2) -->
  <!-- KPI 1: Commits -->
  <g transform="translate(26, 66)">
    <rect width="190" height="58" rx="8" fill="#161B22" stroke="#1E293B" stroke-width="1.2" />
    <text x="14" y="21" class="font-mono" font-size="10" font-weight="600" fill="#64748B">AUTHORED COMMITS</text>
    <text x="14" y="45" class="font-mono" font-size="22" font-weight="800" fill="#38BDF8">${totalCommits}+</text>
    <text x="176" y="44" text-anchor="end" class="font-mono" font-size="9.5" fill="#22C55E">ACTIVE</text>
  </g>

  <!-- KPI 2: Public and Collab Repos -->
  <g transform="translate(228, 66)">
    <rect width="190" height="58" rx="8" fill="#161B22" stroke="#1E293B" stroke-width="1.2" />
    <text x="14" y="21" class="font-mono" font-size="10" font-weight="600" fill="#64748B">PUBLIC &amp; COLLAB REPOS</text>
    <text x="14" y="45" class="font-mono" font-size="22" font-weight="800" fill="#F8FAFC">${publicRepos} <tspan font-size="12" font-weight="600" fill="#94A3B8">+ 3 Collab</tspan></text>
  </g>

  <!-- KPI 3: Project Fénix Status -->
  <g transform="translate(26, 134)">
    <rect width="190" height="58" rx="8" fill="#161B22" stroke="#1E293B" stroke-width="1.2" />
    <text x="14" y="21" class="font-mono" font-size="10" font-weight="600" fill="#64748B">PROJECT FÉNIX REBORN</text>
    <text x="14" y="45" class="font-mono" font-size="22" font-weight="800" fill="#F97316">4 / 5</text>
    <text x="176" y="44" text-anchor="end" class="font-mono" font-size="10" font-weight="700" fill="#FB923C">80% DONE</text>
  </g>

  <!-- KPI 4: Pure Code Volume -->
  <g transform="translate(228, 134)">
    <rect width="190" height="58" rx="8" fill="#161B22" stroke="#1E293B" stroke-width="1.2" />
    <text x="14" y="21" class="font-mono" font-size="10" font-weight="600" fill="#64748B">VERIFIED SOURCE CODE</text>
    <text x="14" y="45" class="font-mono" font-size="22" font-weight="800" fill="#A855F7">${codeMegabytes} MB</text>
    <text x="176" y="44" text-anchor="end" class="font-mono" font-size="9.5" fill="#C084FC">PY · TS · SQL</text>
  </g>

  <!-- Footer Status Readout -->
  <text x="26" y="217" class="font-mono" font-size="10" fill="#64748B">
    FOCUS: <tspan fill="#94A3B8">Econometrics · Graph Optimization · Full-Stack Data Apps</tspan>
  </text>

  <!-- ================= RIGHT PANEL: TOP LANGUAGES ================= -->
  <text x="466" y="32" class="font-mono" font-size="12" font-weight="700" fill="#38BDF8" letter-spacing="0.6">
    CODEBASE LANGUAGE DISTRIBUTION
  </text>
  <text x="870" y="32" text-anchor="end" class="font-mono" font-size="9.5" fill="#64748B">
    SYNCED ${updatedDate}
  </text>

  <!-- Stacked Multi-Language Bar -->
  <g transform="translate(466, 48)" clip-path="url(#barClip)">
    ${stackedBarSvg}
  </g>

  <!-- Language Breakdown Rows -->
  ${langRowsSvg}
</svg>
`;

  const outPath = path.resolve('assets', 'github-metrics.svg');
  fs.writeFileSync(outPath, svg, 'utf8');
  console.log(`Successfully wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
