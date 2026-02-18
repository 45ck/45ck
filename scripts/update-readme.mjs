import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const OWNER = '45ck';
const API_BASE = 'https://api.github.com';
const OVERRIDES_FILE = 'projects.overrides.json';

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function escapePipes(s) {
  return String(s || '').replace(/\|/g, '\\|');
}

function formatRepoRow(repo) {
  const name = repo.name;
  const url = repo.html_url;
  const desc = (repo.description || '').replace(/\r?\n/g, ' ').trim();
  const lang = repo.language || '';
  const stars = typeof repo.stargazers_count === 'number' ? repo.stargazers_count : 0;
  const topics = Array.isArray(repo.topics) && repo.topics.length
    ? repo.topics.slice(0, 6).map((t) => `\`${t}\``).join(' ')
    : '';

  return `| [\`${escapePipes(name)}\`](${url}) | ${escapePipes(desc)} | ${escapePipes(lang)} | ⭐ ${stars} | ${topics} |`;
}

function renderTable(repos) {
  if (!repos.length) {
    return '_No repos found._';
  }

  const header = [
    '| Repo | What it is | Lang | Stars | Topics |',
    '| --- | --- | --- | ---: | --- |',
  ];

  return [...header, ...repos.map(formatRepoRow)].join('\n');
}

async function readOverrides(repoRoot) {
  const p = path.join(repoRoot, OVERRIDES_FILE);
  try {
    const raw = await readFile(p, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function renderLinks(overrides) {
  const links = overrides?.links || {};

  const parts = [];

  if (links.portfolio?.url) {
    const note = links.portfolio?.note ? ` (${links.portfolio.note})` : '';
    parts.push(`- 🌐 Portfolio: ${links.portfolio.url}${note}`);
  } else {
    parts.push('- 🌐 Portfolio: (coming soon)');
  }

  if (links.vibecoord?.url) {
    const label = links.vibecoord?.label || 'Vibecord';
    parts.push(`- 🧠 ${label}: ${links.vibecoord.url}`);
  }

  if (links.primaryEmail?.value) {
    const note = links.primaryEmail?.note ? ` (${links.primaryEmail.note})` : '';
    parts.push(`- ✉️ Email: ${links.primaryEmail.value}${note}`);
  }

  parts.push('- 🧾 Tip: if email spam becomes annoying, I rotate aliases and keep forms behind a honeypot.');

  return parts.join('\n');
}

function renderClosedSourceProducts(overrides) {
  const products = overrides?.closedSourceProducts;
  if (!Array.isArray(products) || products.length === 0) {
    return '_No closed-source products listed._';
  }

  const rows = [];
  rows.push('| Product | What it is | Stack | Status |');
  rows.push('| --- | --- | --- | --- |');

  for (const p of products) {
    const name = p?.name || '';
    const url = p?.url || '';
    const tagline = (p?.tagline || '').trim();
    const stack = Array.isArray(p?.stack) ? p.stack.map((s) => `\`${s}\``).join(' ') : '';
    const status = (p?.status || '').trim();

    const productCell = url ? `[${escapePipes(name)}](${url})` : escapePipes(name);
    rows.push(`| ${productCell} | ${escapePipes(tagline)} | ${stack} | ${escapePipes(status)} |`);
  }

  return rows.join('\n');
}

function renderToolbox(overrides) {
  const tb = overrides?.toolbox || {};
  const keys = Object.keys(tb);
  if (!keys.length) {
    return [
      '- 🟦 TypeScript, Node.js',
      '- ⚛️ React, Astro, Tailwind',
      '- 🗄️ Postgres, Drizzle',
      '- 🧱 Terraform, AWS',
    ].join('\n');
  }

  const rows = [];
  rows.push('| Area | Tools |');
  rows.push('| --- | --- |');
  for (const area of keys) {
    const items = Array.isArray(tb[area]) ? tb[area] : [];
    const rendered = items.map((x) => `\`${x}\``).join(' ');
    rows.push(`| ${escapePipes(area)} | ${rendered} |`);
  }
  return rows.join('\n');
}

function renderWorkingOn({ overrides, activeRepos }) {
  const featured = Array.isArray(overrides?.featured) ? overrides.featured : [];
  const featuredMap = new Map(
    featured
      .filter((f) => f && typeof f.repo === 'string' && f.repo.length > 0)
      .map((f) => [f.repo, f])
  );

  const repos = Array.isArray(activeRepos) ? activeRepos : [];

  const rows = [];
  rows.push('| Repo | What it is | Stack | Stars | Topics |');
  rows.push('| --- | --- | --- | ---: | --- |');

  for (const repo of repos) {
    const entry = featuredMap.get(repo.name);

    const url = repo.html_url;
    const stars = typeof repo.stargazers_count === 'number' ? repo.stargazers_count : 0;

    const tagline = (entry?.tagline || repo.description || '').trim();
    const highlights = Array.isArray(entry?.highlights) ? entry.highlights.filter(Boolean) : [];
    const what = [tagline, ...highlights].filter(Boolean).join(' · ');

    const stack = Array.isArray(entry?.stack) && entry.stack.length
      ? entry.stack.map((s) => `\`${s}\``).join(' ')
      : (repo.language ? `\`${repo.language}\`` : '');

    const topics = Array.isArray(repo.topics) && repo.topics.length
      ? repo.topics.slice(0, 8).map((t) => `\`${t}\``).join(' ')
      : '';

    const name = entry ? `🔥 ${repo.name}` : repo.name;

    rows.push(
      `| [\`${escapePipes(name)}\`](${url}) | ${escapePipes(what)} | ${stack} | ⭐ ${stars} | ${topics} |`
    );
  }

  if (rows.length === 2) return '_No active public repos found._';
  return rows.join('\n');
}

async function ghFetchJson(url, token) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  // Needed for topics + higher rate limits in Actions.
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub API ${res.status} for ${url}\n${text}`);
  }
  return res.json();
}

async function listAllRepos({ owner, token }) {
  const all = [];
  let page = 1;

  while (true) {
    const url = new URL(`${API_BASE}/users/${owner}/repos`);
    url.searchParams.set('per_page', '100');
    url.searchParams.set('type', 'owner');
    url.searchParams.set('sort', 'pushed');
    url.searchParams.set('page', String(page));

    const batch = await ghFetchJson(url.toString(), token);
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }

  return all;
}

function subtractMonthsUtc(d, months) {
  const copy = new Date(d.getTime());
  copy.setUTCMonth(copy.getUTCMonth() - months);
  return copy;
}

async function main() {
  const repoRoot = process.cwd();
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';

  const now = new Date();
  const cutoff = subtractMonthsUtc(now, 3);

  const overrides = await readOverrides(repoRoot);

  const repos = await listAllRepos({ owner: OWNER, token });

  // Public only (never show private in the profile README).
  const publicRepos = repos.filter((r) => r && r.private === false);

  // Sort newest push first for readability.
  publicRepos.sort((a, b) => (b.pushed_at || '').localeCompare(a.pushed_at || ''));

  const active = [];
  const inactive = [];

  for (const r of publicRepos) {
    const pushedAt = r.pushed_at ? new Date(r.pushed_at) : null;
    if (!pushedAt) {
      inactive.push(r);
      continue;
    }
    if (pushedAt >= cutoff) active.push(r);
    else inactive.push(r);
  }

  const activeTable = renderTable(active);
  const inactiveTable = [
    '<details>',
    '<summary>Show inactive repos</summary>',
    '',
    renderTable(inactive),
    '</details>',
  ].join('\n');

  const templatePath = path.join(repoRoot, 'README.template.md');
  const outPath = path.join(repoRoot, 'README.md');

  const template = await readFile(templatePath, 'utf8');
  const updatedAt = `${now.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

  const rendered = template
    .replace('{{LINKS}}', renderLinks(overrides))
    .replace('{{TOOLBOX}}', renderToolbox(overrides))
    .replace('{{CLOSED_SOURCE_PRODUCTS}}', renderClosedSourceProducts(overrides))
    .replace('{{WORKING_ON}}', renderWorkingOn({ overrides, activeRepos: active }))
    .replace('{{INACTIVE_REPOS}}', inactiveTable)
    .replace('{{UPDATED_AT}}', updatedAt);

  await writeFile(outPath, rendered, 'utf8');

  // Ensure folders exist for future additions (keeps repo tidy).
  await mkdir(path.join(repoRoot, 'assets'), { recursive: true });
  await mkdir(path.join(repoRoot, 'scripts'), { recursive: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
