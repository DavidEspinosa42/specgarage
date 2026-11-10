import { fileURLToPath } from 'node:url';
import { type ParseArgsOptionsConfig, parseArgs } from 'node:util';
import { type Config, loadConfig } from '../config.ts';
import { SpecGarageError } from '../domain/errors.ts';
import { startServer } from '../server/start.ts';
import { createContext, type ServiceContext } from '../service/context.ts';
import { importEdition, listEditions } from '../service/editions.ts';
import {
  addVehicle,
  listInspections,
  listVehicles,
  startInspection,
} from '../service/inspections.ts';
import { openStorage } from '../storage/open.ts';
import { loadRulepackFile } from '../storage/rulepack-file.ts';
import { webAssetsExist } from '../storage/web-assets.ts';

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: Readonly<Record<string, string | undefined>>;
  /** Resolves when the user asks a long-running command such as `serve` to stop. */
  shutdown?: Promise<void>;
}

const EXIT_OK = 0;
const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;
const EXIT_INTERNAL = 70;

const DEMO_RULEPACK = fileURLToPath(
  new URL('../../examples/demo-cup/rulepack.json', import.meta.url),
);

const WEB_ROOT = fileURLToPath(new URL('../../dist/web', import.meta.url));

const USAGE = `SpecGarage - offline preparation checklists for single-make racing categories.

Usage: specgarage <command> [options]

Commands:
  db migrate                      Create or upgrade the database
  rulepack validate <file>        Check a rulepack file without importing it
  rulepack import <file>          Import a rulepack as an immutable edition
  rulepack list                   List imported editions
  vehicle add <code>              Register a vehicle by internal code
  vehicle list                    List vehicles
  inspection start                Start an inspection (see options below)
  inspection list                 List inspections
  seed demo                       Import the fictional demo category and start a demo inspection
  serve [--port <n>]              Start the local web interface on 127.0.0.1

Options:
  --data-dir <dir>                Data directory (default: SPECGARAGE_DATA_DIR or ./data)
  --help                          Show this help

inspection start options:
  --edition <ref>                 CATEGORY/season/edition, or at least 8 characters of an edition id
  --vehicle <code>                Vehicle code
  --event <key>                   Event key from the rulepack
  --station <label>               Observer station label, for example Bay-2 (never a person's name)

Results are internal assessments, not official inspections or certification.
`;

/**
 * Imports the bundled demo. Editions are immutable, so a data directory created by an
 * earlier version of the demo (whose documents have since been corrected) conflicts
 * with the same edition label; say how to recover instead of only reporting the conflict.
 */
function importDemo(ctx: ServiceContext) {
  try {
    return importEdition(ctx, loadRulepackFile(DEMO_RULEPACK));
  } catch (error) {
    if (error instanceof SpecGarageError && error.code === 'conflict') {
      throw new SpecGarageError('conflict', error.message, [
        'This data directory probably holds an earlier version of the demo.',
        'Use a new --data-dir (or remove the old one), then run "seed demo" again.',
      ]);
    }
    throw error;
  }
}

class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

function formatTable(header: string[], rows: string[][]): string {
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => (row[column] ?? '').length)),
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, column) => cell.padEnd(widths[column] ?? 0))
      .join('  ')
      .trimEnd();
  return [line(header), line(widths.map((width) => '-'.repeat(width))), ...rows.map(line)].join(
    '\n',
  );
}

interface ParsedArguments {
  values: Record<string, string | boolean | undefined>;
  positionals: string[];
}

/**
 * Parses options and positional arguments. Positionals beyond the allowed
 * count are rejected, so a mistyped argument can never be silently ignored
 * while the command goes on to write to the default data directory.
 */
function parse(
  args: string[],
  options: ParseArgsOptionsConfig,
  allowedPositionals = 0,
): ParsedArguments {
  let parsed: ParsedArguments;
  try {
    const { values, positionals } = parseArgs({
      args,
      options: { 'data-dir': { type: 'string' }, ...options },
      allowPositionals: true,
      strict: true,
    });
    parsed = { values, positionals };
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  const extra = parsed.positionals[allowedPositionals];
  if (extra !== undefined) throw new UsageError(`Unexpected argument "${extra}".`);
  return parsed;
}

function exactlyOne(positionals: string[], what: string): string {
  const [first, ...extra] = positionals;
  if (first === undefined || extra.length > 0)
    throw new UsageError(`Expected exactly one ${what}.`);
  return first;
}

function openContext(config: Config, dataDirOverride: unknown) {
  if (typeof dataDirOverride === 'string' && dataDirOverride.trim() === '') {
    // An empty value usually means an unset shell variable; never fall back to the working directory.
    throw new UsageError('--data-dir must not be empty.');
  }
  const dataDir = typeof dataDirOverride === 'string' ? dataDirOverride : config.dataDir;
  const storage = openStorage(dataDir);
  const ctx: ServiceContext = createContext({ store: storage.store, blobs: storage.blobs });
  return { storage, ctx };
}

/** Runs one CLI invocation and returns the process exit status. */
export async function runCli(args: string[], io: CliIo): Promise<number> {
  const out = (text: string) => io.stdout(`${text}\n`);

  try {
    const [group] = args;
    if (group === undefined || group === '--help' || group === '-h' || group === 'help') {
      io.stdout(USAGE);
      return EXIT_OK;
    }
    if (args.includes('--help')) {
      io.stdout(USAGE);
      return EXIT_OK;
    }

    const config = loadConfig(io.env);
    // Every command is "<group> <action>" except `serve`, which stands alone.
    const standalone = group === 'serve';
    const rest = args.slice(standalone ? 1 : 2);
    const command = standalone ? group : `${group} ${args[1] ?? ''}`.trim();

    switch (command) {
      case 'rulepack validate': {
        const { positionals } = parse(rest, {}, 1);
        const file = exactlyOne(positionals, 'rulepack file');
        const { rulepack, documentFiles } = loadRulepackFile(file);
        out(
          `Valid: ${rulepack.category.code} ${rulepack.season} ${rulepack.edition} - ` +
            `${rulepack.documents.length} documents (${documentFiles.size} with files), ` +
            `${rulepack.systems.length} systems, ${rulepack.events.length} events, ` +
            `${rulepack.requirements.length} requirements.`,
        );
        return EXIT_OK;
      }

      case 'db migrate': {
        const { values } = parse(rest, {});
        const { storage } = openContext(config, values['data-dir']);
        try {
          out(`Database ready in ${storage.dataDir}`);
        } finally {
          storage.close();
        }
        return EXIT_OK;
      }

      case 'rulepack import': {
        const { positionals, values } = parse(rest, {}, 1);
        const file = exactlyOne(positionals, 'rulepack file');
        const { storage, ctx } = openContext(config, values['data-dir']);
        try {
          const outcome = importEdition(ctx, loadRulepackFile(file));
          const verb = outcome.status === 'imported' ? 'Imported' : 'Already imported (unchanged)';
          out(`${verb}: ${outcome.categoryCode} ${outcome.season} ${outcome.edition}`);
          out(`  id: ${outcome.id}`);
          out(`  documents stored: ${outcome.documentsStored}`);
        } finally {
          storage.close();
        }
        return EXIT_OK;
      }

      case 'rulepack list': {
        const { values } = parse(rest, {});
        const { storage, ctx } = openContext(config, values['data-dir']);
        try {
          const editions = listEditions(ctx);
          if (editions.length === 0) out('No editions imported yet.');
          else {
            out(
              formatTable(
                ['CATEGORY', 'SEASON', 'EDITION', 'ID', 'IMPORTED'],
                editions.map((edition) => [
                  edition.categoryCode,
                  edition.season,
                  edition.edition,
                  edition.id.slice(0, 12),
                  edition.importedAt,
                ]),
              ),
            );
          }
        } finally {
          storage.close();
        }
        return EXIT_OK;
      }

      case 'vehicle add': {
        const { positionals, values } = parse(rest, {}, 1);
        const code = exactlyOne(positionals, 'vehicle code');
        const { storage, ctx } = openContext(config, values['data-dir']);
        try {
          out(`Added vehicle ${addVehicle(ctx, code).code}`);
        } finally {
          storage.close();
        }
        return EXIT_OK;
      }

      case 'vehicle list': {
        const { values } = parse(rest, {});
        const { storage, ctx } = openContext(config, values['data-dir']);
        try {
          const vehicles = listVehicles(ctx);
          if (vehicles.length === 0) out('No vehicles registered yet.');
          else
            out(
              formatTable(
                ['CODE', 'ADDED'],
                vehicles.map((v) => [v.code, v.createdAt]),
              ),
            );
        } finally {
          storage.close();
        }
        return EXIT_OK;
      }

      case 'inspection start': {
        const { values, positionals } = parse(rest, {
          edition: { type: 'string' },
          vehicle: { type: 'string' },
          event: { type: 'string' },
          station: { type: 'string' },
        });
        if (positionals.length > 0) throw new UsageError('Unexpected extra arguments.');
        const missing = ['edition', 'vehicle', 'event', 'station'].filter(
          (name) => typeof values[name] !== 'string',
        );
        if (missing.length > 0) {
          throw new UsageError(
            `Missing required option(s): ${missing.map((m) => `--${m}`).join(', ')}.`,
          );
        }
        const { storage, ctx } = openContext(config, values['data-dir']);
        try {
          const inspection = startInspection(ctx, {
            edition: String(values.edition),
            vehicleCode: String(values.vehicle),
            eventKey: String(values.event),
            stationLabel: String(values.station),
          });
          out(`Started inspection ${inspection.id}`);
        } finally {
          storage.close();
        }
        return EXIT_OK;
      }

      case 'inspection list': {
        const { values } = parse(rest, {});
        const { storage, ctx } = openContext(config, values['data-dir']);
        try {
          const inspections = listInspections(ctx);
          if (inspections.length === 0) out('No inspections yet.');
          else {
            out(
              formatTable(
                ['ID', 'VEHICLE', 'EVENT', 'EDITION', 'STARTED'],
                inspections.map((i) => [
                  i.id,
                  i.vehicleCode,
                  i.eventName,
                  `${i.categoryCode} ${i.season} ${i.edition}`,
                  i.startedAt,
                ]),
              ),
            );
          }
        } finally {
          storage.close();
        }
        return EXIT_OK;
      }

      case 'serve': {
        const { values } = parse(rest, { port: { type: 'string' } });
        let port = config.port;
        if (typeof values.port === 'string') {
          // Port 0 asks the system for a free port, which is handy for scripts and tests.
          if (!/^[0-9]{1,5}$/.test(values.port) || Number(values.port) > 65535) {
            throw new UsageError('--port must be a whole number from 0 to 65535.');
          }
          port = Number(values.port);
        }
        if (io.shutdown === undefined) throw new Error('serve needs a shutdown signal.');
        const { storage, ctx } = openContext(config, values['data-dir']);
        try {
          const server = await startServer({
            ctx,
            maxUploadBytes: config.maxUploadBytes,
            webRoot: WEB_ROOT,
            port,
          });
          out(`SpecGarage is running at ${server.url}`);
          if (!webAssetsExist(WEB_ROOT)) {
            out('The web interface has not been built yet; run "pnpm build" first.');
          }
          out('Press Ctrl+C to stop.');
          await io.shutdown;
          await server.close();
          out('Stopped.');
        } finally {
          storage.close();
        }
        return EXIT_OK;
      }

      case 'seed demo': {
        const { values } = parse(rest, {});
        const { storage, ctx } = openContext(config, values['data-dir']);
        try {
          const outcome = importDemo(ctx);
          out(
            `${outcome.status === 'imported' ? 'Imported' : 'Already imported'}: ${outcome.categoryCode} ${outcome.season} ${outcome.edition}`,
          );
          if (ctx.store.getVehicle('DEMO-01') === undefined) {
            addVehicle(ctx, 'DEMO-01');
            out('Added vehicle DEMO-01');
          }
          const existing = ctx.store
            .listInspections()
            .find(
              (inspection) =>
                inspection.editionId === outcome.id &&
                inspection.vehicleCode === 'DEMO-01' &&
                inspection.eventKey === 'round-1',
            );
          const inspection =
            existing ??
            startInspection(ctx, {
              edition: outcome.id,
              vehicleCode: 'DEMO-01',
              eventKey: 'round-1',
              stationLabel: 'Bay-1',
            });
          out(
            `${existing === undefined ? 'Started' : 'Existing'} demo inspection ${inspection.id}`,
          );
          // The server must read the same data directory this command wrote to.
          const override =
            typeof values['data-dir'] === 'string' ? ` --data-dir "${values['data-dir']}"` : '';
          out(
            `Open it at http://127.0.0.1:${config.port}/#/inspection/${inspection.id} after running "pnpm build" once and then "pnpm start${override}".`,
          );
        } finally {
          storage.close();
        }
        return EXIT_OK;
      }

      default:
        throw new UsageError(`Unknown command "${command}".`);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`Error: ${error.message}\n\nRun "specgarage --help" for usage.\n`);
      return EXIT_USAGE;
    }
    if (error instanceof SpecGarageError) {
      io.stderr(`Error: ${error.message}\n`);
      for (const detail of error.details) io.stderr(`  - ${detail}\n`);
      return EXIT_FAILURE;
    }
    io.stderr(`Unexpected error: ${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT_INTERNAL;
  }
}
