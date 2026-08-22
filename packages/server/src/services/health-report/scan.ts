import fs from 'node:fs';
import path from 'node:path';

/**
 * Project Health — static repository scanner. Pure filesystem analysis of a
 * shallow-cloned repo (NO new dependencies, no network): language breakdown,
 * LOC, framework/API/database detection, tests/docs presence and a naive
 * secret scan. The AI layer (`report.ts`) merges these hard facts with the
 * model-written quality assessment.
 */

/* ── result shapes (mirror the shared HealthReport contract fields) ─────── */

export interface ApiEndpoint {
  method: string;
  path: string;
  file: string;
}

export interface DatabaseHit {
  type: string;
  evidence: string;
}

export interface StaticScan {
  files: number;
  linesOfCode: number;
  languages: { name: string; pct: number }[];
  frameworks: string[];
  apis: ApiEndpoint[];
  databases: DatabaseHit[];
  testsPresent: boolean;
  testsNote: string;
  docsPresent: boolean;
  docsNote: string;
  secretsFound: boolean;
  secretFindings: string[];
  /** Every walked file (repo-relative path + byte size) for digest sampling. */
  walkedFiles: { path: string; size: number }[];
}

/* ── walk limits ────────────────────────────────────────────────────────── */

const MAX_FILES = 4000;
const MAX_READ_BYTES = 2 * 1024 * 1024; // 2MB per file
const MAX_APIS = 100;
const MAX_SECRET_FINDINGS = 10;

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.nuxt',
  'out',
  'coverage',
  'vendor',
  '__pycache__',
  '.venv',
  'venv',
  'target',
]);

/* ── language map (extension → language) ────────────────────────────────── */

const LANGUAGES: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.mts': 'TypeScript',
  '.cts': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.py': 'Python',
  '.go': 'Go',
  '.rb': 'Ruby',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.cs': 'C#',
  '.cpp': 'C++',
  '.cc': 'C++',
  '.hpp': 'C++',
  '.c': 'C',
  '.h': 'C',
  '.rs': 'Rust',
  '.php': 'PHP',
  '.swift': 'Swift',
  '.vue': 'Vue',
  '.svelte': 'Svelte',
  '.html': 'HTML',
  '.css': 'CSS',
  '.scss': 'CSS',
  '.sass': 'CSS',
  '.less': 'CSS',
  '.sql': 'SQL',
  '.sh': 'Shell',
  '.dart': 'Dart',
  '.scala': 'Scala',
  '.lua': 'Lua',
  '.r': 'R',
};

/** Extensions we read as text (LOC + regex scans). */
const TEXT_EXTENSIONS = new Set([
  ...Object.keys(LANGUAGES),
  '.json',
  '.yml',
  '.yaml',
  '.toml',
  '.md',
  '.txt',
  '.env',
  '.cfg',
  '.ini',
  '.xml',
  '.gradle',
  '.properties',
  '.tf',
  '.prisma',
  '.graphql',
  '.mod',
]);

/* ── framework detection (dependency name → display name) ───────────────── */

const JS_FRAMEWORKS: Record<string, string> = {
  express: 'Express',
  fastify: 'Fastify',
  react: 'React',
  vue: 'Vue',
  next: 'Next.js',
  nuxt: 'Nuxt',
  '@angular/core': 'Angular',
  svelte: 'Svelte',
  '@nestjs/core': 'NestJS',
  koa: 'Koa',
  hapi: 'hapi',
  '@hapi/hapi': 'hapi',
  vite: 'Vite',
  electron: 'Electron',
  'react-native': 'React Native',
  tailwindcss: 'Tailwind CSS',
  jest: 'Jest',
  vitest: 'Vitest',
  webpack: 'webpack',
  'socket.io': 'Socket.IO',
  graphql: 'GraphQL',
  '@remix-run/react': 'Remix',
  astro: 'Astro',
};

const PY_FRAMEWORKS: Record<string, string> = {
  django: 'Django',
  flask: 'Flask',
  fastapi: 'FastAPI',
  pytest: 'pytest',
  numpy: 'NumPy',
  pandas: 'pandas',
  torch: 'PyTorch',
  tensorflow: 'TensorFlow',
  streamlit: 'Streamlit',
  celery: 'Celery',
};

const GO_FRAMEWORKS: Record<string, string> = {
  'github.com/gin-gonic/gin': 'Gin',
  'github.com/labstack/echo': 'Echo',
  'github.com/gofiber/fiber': 'Fiber',
  'github.com/gorilla/mux': 'Gorilla Mux',
};

/* ── database detection ─────────────────────────────────────────────────── */

const DB_DEPS: Record<string, string> = {
  pg: 'PostgreSQL',
  mysql: 'MySQL',
  mysql2: 'MySQL',
  mongoose: 'MongoDB',
  mongodb: 'MongoDB',
  prisma: 'Prisma ORM',
  '@prisma/client': 'Prisma ORM',
  sequelize: 'SQL (Sequelize ORM)',
  typeorm: 'SQL (TypeORM)',
  knex: 'SQL (Knex)',
  redis: 'Redis',
  ioredis: 'Redis',
  sqlite3: 'SQLite',
  'better-sqlite3': 'SQLite',
  psycopg2: 'PostgreSQL',
  'psycopg2-binary': 'PostgreSQL',
  asyncpg: 'PostgreSQL',
  pymongo: 'MongoDB',
  sqlalchemy: 'SQL (SQLAlchemy)',
  'flask-sqlalchemy': 'SQL (SQLAlchemy)',
  'github.com/lib/pq': 'PostgreSQL',
  'gorm.io/gorm': 'SQL (GORM)',
  'github.com/redis/go-redis': 'Redis',
  'go.mongodb.org/mongo-driver': 'MongoDB',
};

const DB_CODE_PATTERNS: { re: RegExp; type: string; label: string }[] = [
  { re: /postgres(?:ql)?:\/\//i, type: 'PostgreSQL', label: 'postgres:// connection string' },
  { re: /mongodb(?:\+srv)?:\/\//i, type: 'MongoDB', label: 'mongodb:// connection string' },
  { re: /mysql:\/\//i, type: 'MySQL', label: 'mysql:// connection string' },
  { re: /redis:\/\//i, type: 'Redis', label: 'redis:// connection string' },
  { re: /\.sqlite3?\b/i, type: 'SQLite', label: '.sqlite database file reference' },
];

/* ── API endpoint detection ─────────────────────────────────────────────── */

const API_PATTERNS: { re: RegExp; method: (m: RegExpExecArray) => string; path: (m: RegExpExecArray) => string }[] = [
  {
    // express/fastify/koa-router/fastapi: app.get('/x'), router.post("/y"), @app.get("/z")
    re: /\b(?:app|router|server|api|apiRouter|routes|fastify|r)\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)['"`]/g,
    method: (m) => m[1].toUpperCase(),
    path: (m) => m[2],
  },
  {
    // Flask: @app.route('/x', methods=['POST'])
    re: /@\w+\.route\(\s*['"]([^'"]+)['"](?:[^)]*methods\s*=\s*\[([^\]]*)\])?/g,
    method: (m) => {
      const raw = m[2] ? m[2].replace(/['"\s]/g, '').split(',')[0] : 'GET';
      return (raw || 'GET').toUpperCase();
    },
    path: (m) => m[1],
  },
  {
    // NestJS-style decorators: @Get('x'), @Post()
    re: /@(Get|Post|Put|Delete|Patch)\(\s*(?:['"]([^'"]*)['"])?\s*\)/g,
    method: (m) => m[1].toUpperCase(),
    path: (m) => `/${m[2] ?? ''}`,
  },
];

/* ── secret scan ────────────────────────────────────────────────────────── */

const SECRET_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /AKIA[0-9A-Z]{16}/g, label: 'AWS access key id' },
  { re: /AIza[0-9A-Za-z_-]{35}/g, label: 'Google API key' },
  { re: /ghp_[0-9A-Za-z]{36}/g, label: 'GitHub personal access token' },
  { re: /github_pat_[0-9A-Za-z_]{20,}/g, label: 'GitHub fine-grained token' },
  { re: /xox[baprs]-[0-9A-Za-z-]{10,}/g, label: 'Slack token' },
  { re: /sk-[A-Za-z0-9_-]{20,}/g, label: 'API secret key (sk-…)' },
  { re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, label: 'private key material' },
  {
    re: /(?:api[_-]?key|apikey|secret|token|password|passwd)['"]?\s*[:=]\s*['"]([^'"]{10,})['"]/gi,
    label: 'hardcoded credential assignment',
  },
];

/** Values that are clearly placeholders, not live secrets. */
const PLACEHOLDER_RE =
  /your[_-]?|example|placeholder|changeme|change-me|xxx|<[^>]+>|\$\{|process\.env|os\.environ|dummy|sample|insert[_-]?/i;

const SECRET_EXCLUDED_FILES = new Set([
  '.env.example',
  '.env.sample',
  '.env.template',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
]);

/* ── main entry ─────────────────────────────────────────────────────────── */

export function analyzeRepoStatic(dir: string): StaticScan {
  const walked: { path: string; size: number }[] = [];
  walk(dir, '', walked);

  let linesOfCode = 0;
  const locByLanguage = new Map<string, number>();
  const frameworks = new Set<string>();
  const apis: ApiEndpoint[] = [];
  const databases = new Map<string, string>(); // type → evidence
  const secretFindings: string[] = [];

  let testsPresent = false;
  let testEvidence = '';
  let readmeLength = 0;
  let hasDocsDir = false;

  for (const f of walked) {
    const base = path.basename(f.path).toLowerCase();
    const ext = path.extname(base);

    // tests/docs presence from names alone
    if (!testsPresent && isTestPath(f.path)) {
      testsPresent = true;
      testEvidence = f.path;
    }
    if (/^(docs|doc|documentation)\//i.test(f.path)) hasDocsDir = true;

    if (!TEXT_EXTENSIONS.has(ext) && !base.startsWith('.env') && base !== 'dockerfile') {
      continue;
    }

    const content = readCapped(path.join(dir, f.path));
    if (content === null) continue;
    const lines = content.length === 0 ? 0 : content.split('\n').length;

    const lang = LANGUAGES[ext];
    if (lang) {
      linesOfCode += lines;
      locByLanguage.set(lang, (locByLanguage.get(lang) ?? 0) + lines);
    }

    if (base === 'readme.md' && !f.path.includes('/')) readmeLength = content.length;

    // manifests → frameworks + database deps
    if (base === 'package.json') {
      detectFromPackageJson(content, frameworks, databases, f.path);
    } else if (base === 'requirements.txt' || base === 'pyproject.toml' || base === 'pipfile') {
      detectFromPythonManifest(content, frameworks, databases, f.path);
    } else if (base === 'go.mod') {
      detectFromGoMod(content, frameworks, databases, f.path);
    }

    // API endpoints (source files only)
    if (lang && apis.length < MAX_APIS) {
      collectApis(content, f.path, apis);
    }

    // database connection-string patterns
    for (const p of DB_CODE_PATTERNS) {
      if (!databases.has(p.type) && p.re.test(content)) {
        databases.set(p.type, `${p.label} in ${f.path}`);
      }
    }

    // secret scan (skip templates/lockfiles and markdown docs)
    if (
      !SECRET_EXCLUDED_FILES.has(base) &&
      ext !== '.md' &&
      secretFindings.length < MAX_SECRET_FINDINGS
    ) {
      scanSecrets(content, f.path, secretFindings);
    }

    // test config files count as test evidence
    if (!testsPresent && /^(jest\.config|vitest\.config|pytest\.ini|karma\.conf)/.test(base)) {
      testsPresent = true;
      testEvidence = f.path;
    }
  }

  const languages = [...locByLanguage.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, loc]) => ({
      name,
      pct: linesOfCode > 0 ? Math.round((loc / linesOfCode) * 1000) / 10 : 0,
    }));

  const docsPresent = readmeLength > 200 || hasDocsDir;
  const docsNote = readmeLength > 0
    ? `README.md present (${readmeLength} chars)${hasDocsDir ? ' plus a docs/ directory' : ''}.`
    : hasDocsDir
      ? 'No README.md, but a docs/ directory exists.'
      : 'No README.md or docs/ directory found.';

  return {
    files: walked.length,
    linesOfCode,
    languages,
    frameworks: [...frameworks].sort(),
    apis,
    databases: [...databases.entries()].map(([type, evidence]) => ({ type, evidence })),
    testsPresent,
    testsNote: testsPresent
      ? `Test files/config detected (e.g. ${testEvidence}).`
      : 'No test directories, *.test/*.spec files, or test-runner config found.',
    docsPresent,
    docsNote,
    secretsFound: secretFindings.length > 0,
    secretFindings,
    walkedFiles: walked,
  };
}

/* ── helpers ────────────────────────────────────────────────────────────── */

function walk(root: string, rel: string, out: { path: string; size: number }[]): void {
  if (out.length >= MAX_FILES) return;
  const abs = path.join(root, rel);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= MAX_FILES) return;
    const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(root, childRel, out);
    } else if (entry.isFile()) {
      let size = 0;
      try {
        size = fs.statSync(path.join(root, childRel)).size;
      } catch {
        continue;
      }
      out.push({ path: childRel, size });
    }
  }
}

/** Read at most MAX_READ_BYTES of a file as UTF-8; null on failure/binary. */
function readCapped(absPath: string): string | null {
  try {
    const fd = fs.openSync(absPath, 'r');
    try {
      const stat = fs.fstatSync(fd);
      const len = Math.min(stat.size, MAX_READ_BYTES);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, 0);
      if (buf.includes(0)) return null; // binary
      return buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

function isTestPath(relPath: string): boolean {
  return (
    /(^|\/)(tests?|__tests__|spec|e2e|cypress)\//i.test(relPath) ||
    /\.(test|spec)\.[a-z]+$/i.test(relPath) ||
    /(^|\/)test_[^/]+\.py$/i.test(relPath)
  );
}

function detectFromPackageJson(
  content: string,
  frameworks: Set<string>,
  databases: Map<string, string>,
  file: string,
): void {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return;
  }
  if (typeof json !== 'object' || json === null) return;
  const pkg = json as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const dep of Object.keys(deps)) {
    const fw = JS_FRAMEWORKS[dep];
    if (fw) frameworks.add(fw);
    const db = DB_DEPS[dep];
    if (db && !databases.has(db)) {
      databases.set(db, `"${dep}" dependency in ${file}`);
    }
  }
}

function detectFromPythonManifest(
  content: string,
  frameworks: Set<string>,
  databases: Map<string, string>,
  file: string,
): void {
  const lower = content.toLowerCase();
  for (const [dep, fw] of Object.entries(PY_FRAMEWORKS)) {
    if (new RegExp(`(^|["'\\s])${dep}(\\b|[=<>~\\[])`, 'm').test(lower)) frameworks.add(fw);
  }
  for (const [dep, db] of Object.entries(DB_DEPS)) {
    if (dep.includes('/') || dep.includes('@')) continue; // js/go-only keys
    if (new RegExp(`(^|["'\\s])${dep}(\\b|[=<>~\\[])`, 'm').test(lower) && !databases.has(db)) {
      databases.set(db, `"${dep}" requirement in ${file}`);
    }
  }
}

function detectFromGoMod(
  content: string,
  frameworks: Set<string>,
  databases: Map<string, string>,
  file: string,
): void {
  for (const [mod, fw] of Object.entries(GO_FRAMEWORKS)) {
    if (content.includes(mod)) frameworks.add(fw);
  }
  for (const [mod, db] of Object.entries(DB_DEPS)) {
    if (!mod.includes('/')) continue; // go modules only
    if (content.includes(mod) && !databases.has(db)) {
      databases.set(db, `"${mod}" module in ${file}`);
    }
  }
}

function collectApis(content: string, file: string, out: ApiEndpoint[]): void {
  for (const pattern of API_PATTERNS) {
    pattern.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.re.exec(content)) !== null && out.length < MAX_APIS) {
      const endpoint = { method: pattern.method(m), path: pattern.path(m), file };
      if (!out.some((e) => e.method === endpoint.method && e.path === endpoint.path)) {
        out.push(endpoint);
      }
    }
  }
}

function scanSecrets(content: string, file: string, out: string[]): void {
  for (const { re, label } of SECRET_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null && out.length < MAX_SECRET_FINDINGS) {
      const value = m[1] ?? m[0];
      if (PLACEHOLDER_RE.test(m[0])) continue;
      const redacted = value.length > 6 ? `${value.slice(0, 4)}…(redacted)` : '(redacted)';
      const finding = `${label} in ${file}: ${redacted}`;
      if (!out.includes(finding)) out.push(finding);
    }
  }
}
