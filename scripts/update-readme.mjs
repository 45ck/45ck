import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const OWNER = '45ck';
const API_BASE = 'https://api.github.com';

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function formatRepoRow(repo) {
  const name = repo.name;
  const url = repo.html_url;
  const desc = (repo.description || '').replace(/\r?\n/g, ' ').trim();
  const lang = repo.language || '';
  const stars = typeof repo.stargazers_count === 'number' ? repo.stargazers_count : 0;
  const pushed = repo.pushed_at ? isoDate(new Date(repo.pushed_at)) : '';
  const topics = Array.isArray(repo.topics) && repo.topics.length
    ? repo.topics.slice(0, 6).map((t) => `\`${t}\``).join(' ')
    : '';

  return `| [\`${name}\`](${url}) | ${desc} | ${lang} | ⭐ ${stars} | ${pushed} | ${topics} |`;
}

function renderTable(repos) {
  if (!repos.length) {
    return '_No repos found._';
  }

  const header = [
    '| Repo | What it is | Lang | Stars | Last push | Topics |',
    '| --- | --- | --- | ---: | --- | --- |',
  ];

  return [...header, ...repos.map(formatRepoRow)].join('\n');
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
    .replace('{{ACTIVE_REPOS}}', activeTable)
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

