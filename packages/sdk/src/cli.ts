#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { createClient } from './client.js';
import { tailFile, tailStream, type TailHandle } from './tailer.js';

/**
 * `oncall-tail` CLI (SPEC §3, §7.6; FR-02) — zero-code log shipping.
 *
 *   npx oncall-tail --file ./app.log --service checkout-api --key <ingest_api_key>
 *   my-app | npx oncall-tail --service checkout-api --key <ingest_api_key>   # stdin
 *
 * Flags:
 *   --file, -f <path>      tail a file (omit to read stdin)
 *   --service, -s <name>   service name stamped on events (required)
 *   --key, -k <key>        ingest API key (or env ONCALL_API_KEY)
 *   --url, -u <url>        ingest URL (default env ONCALL_INGEST_URL or localhost)
 *   --from-start           read the whole file first (default: only new lines)
 *   --batch <n>            events per POST (default 50)
 *   --interval <ms>        flush cadence (default 2000)
 *   --help, -h             show this help
 */

interface Args {
  file?: string;
  service?: string;
  key?: string;
  url?: string;
  fromStart: boolean;
  batch?: number;
  interval?: number;
  help: boolean;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { fromStart: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--file':
      case '-f':
        args.file = next();
        break;
      case '--service':
      case '-s':
        args.service = next();
        break;
      case '--key':
      case '-k':
        args.key = next();
        break;
      case '--url':
      case '-u':
        args.url = next();
        break;
      case '--from-start':
        args.fromStart = true;
        break;
      case '--batch':
        args.batch = Number(next());
        break;
      case '--interval':
        args.interval = Number(next());
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        // ignore unknown tokens (keeps the CLI forgiving)
        break;
    }
  }
  return args;
}

const HELP = `oncall-tail — ship a log file or stdout to OnCall AI (no code changes)

Usage:
  oncall-tail --file ./app.log --service <name> --key <ingest_api_key> [--url <ingest_url>]
  <your-app> | oncall-tail --service <name> --key <ingest_api_key>

Options:
  -f, --file <path>     file to tail (omit to read stdin)
  -s, --service <name>  service name (required)
  -k, --key <key>       ingest API key (env: ONCALL_API_KEY)
  -u, --url <url>       ingest URL (env: ONCALL_INGEST_URL; default http://localhost:3001/api/v1/ingest)
      --from-start      read the file from the beginning
      --batch <n>       events per request (default 50)
      --interval <ms>   flush interval (default 2000)
  -h, --help            show this help
`;

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }

  const service = args.service;
  const key = args.key ?? process.env.ONCALL_API_KEY;
  const url = args.url ?? process.env.ONCALL_INGEST_URL;

  if (!service) {
    process.stderr.write('oncall-tail: --service is required\n\n' + HELP);
    return 2;
  }
  if (!key) {
    process.stderr.write(
      'oncall-tail: --key (or ONCALL_API_KEY) is required\n\n' + HELP,
    );
    return 2;
  }

  const client = createClient({
    apiKey: key,
    service,
    ingestUrl: url,
    batchSize: args.batch,
    flushIntervalMs: args.interval,
    onError: (err) =>
      process.stderr.write(`oncall-tail: ship error: ${String(err)}\n`),
  });

  let handle: TailHandle;
  if (args.file) {
    process.stderr.write(
      `oncall-tail: tailing ${args.file} → ${url ?? 'default ingest'} as "${service}"\n`,
    );
    handle = tailFile(args.file, {
      client,
      service,
      fromStart: args.fromStart,
    });
  } else {
    process.stderr.write(
      `oncall-tail: reading stdin → ${url ?? 'default ingest'} as "${service}"\n`,
    );
    handle = tailStream(process.stdin, { client, service });
  }

  const shutdown = async () => {
    handle.stop();
    await client.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
  // stdin EOF ends a piped run cleanly.
  if (!args.file) process.stdin.on('end', () => void shutdown());

  return 0;
}

// Run when invoked directly (not when imported by tests).
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  void main().then((code) => {
    if (code !== 0) process.exit(code);
  });
}
