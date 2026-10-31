import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  applyAreaDictionary,
  districtBoxes,
  DomainError,
  forgetAreaNames,
  type OsmElement,
  placeAreas,
  placesQuery,
  recordAudit,
  saveDistrictStreets,
  saveOsmAreas,
  streetsQuery,
} from '@shiplynow/db';
import { ErrorReporter } from '../common/error-reporter';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

/** Asks OpenStreetMap's Overpass service; a boundary so tests can answer without the internet. */
export abstract class Overpass {
  abstract query(query: string): Promise<OsmElement[]>;
}

@Injectable()
export class HttpOverpass extends Overpass {
  constructor(private readonly config: ConfigService<Env, true>) {
    super();
  }

  async query(query: string) {
    const res = await fetch(this.config.get('OVERPASS_URL', { infer: true }), {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': 'ShiplyNow/1.0 (area map import)',
      },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(300_000),
    });
    if (!res.ok) throw new Error(`overpass answered ${res.status}`);
    const body = (await res.json()) as { elements?: OsmElement[] };
    return body.elements ?? [];
  }
}

export type ImportKind = 'places' | 'streets';

export interface ImportStatus {
  kind: ImportKind | null;
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  /** Districts done out of all, for streets */
  done: number;
  total: number;
  found: number;
  saved: number;
  failed: string[];
  error: string | null;
}

const idle: ImportStatus = {
  kind: null,
  running: false,
  startedAt: null,
  finishedAt: null,
  done: 0,
  total: 0,
  found: 0,
  saved: 0,
  failed: [],
  error: null,
};

/**
 * Fills the area map from OpenStreetMap, run by admin from /admin/addresses:
 *   places  → neighbourhoods and compounds of Greater Cairo (one large request)
 *   streets → named streets, one district at a time with a pause between (Overpass is a
 *             free shared service and asks for gentle use)
 * It runs in the background inside the API; admin's page shows its progress. Running it again
 * updates the same areas (they are keyed by their OpenStreetMap id), so it is safe to repeat.
 */
@Injectable()
export class GeoImportService implements OnApplicationBootstrap {
  private readonly log = new Logger('GeoImport');
  private state: ImportStatus = { ...idle };
  /** Wait between two district requests, in milliseconds. */
  pauseMs = 3_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly overpass: Overpass,
    private readonly reporter: ErrorReporter,
  ) {}

  /** Keeps the names people use for places (AREA_DICTIONARY) on their districts after deploys. */
  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test') return;
    void applyAreaDictionary(this.prisma)
      .then((r) => {
        if (r.updated) {
          forgetAreaNames();
          this.log.log(`Area names added to ${r.updated} districts`);
        }
      })
      .catch((error: unknown) => void this.reporter.report('geo_dictionary', error));
  }

  status(): ImportStatus {
    return { ...this.state, failed: [...this.state.failed] };
  }

  /** Starts an import; answers at once with the status, the work goes on in the background. */
  start(kind: ImportKind, actorUserId: string) {
    if (this.state.running) throw new DomainError('import_running', 409);
    this.state = { ...idle, kind, running: true, startedAt: new Date().toISOString() };
    const work = kind === 'places' ? this.places() : this.streets();
    void work
      .catch((error: unknown) => {
        this.state.error = (error as Error).message;
        void this.reporter.report('geo_import', error);
      })
      .finally(async () => {
        this.state.running = false;
        this.state.finishedAt = new Date().toISOString();
        this.log.log(
          `${kind}: ${this.state.saved} areas saved, ${this.state.failed.length} failed`,
        );
        await recordAudit(this.prisma, {
          actorUserId,
          action: 'geo_area.import',
          entityType: 'geo_area',
          entityId: kind,
          after: {
            found: this.state.found,
            saved: this.state.saved,
            failed: this.state.failed,
            error: this.state.error,
          },
        }).catch(() => undefined);
      });
    return this.status();
  }

  /** Resolves when the running import ends (tests). */
  async idle() {
    while (this.state.running) await new Promise((r) => setTimeout(r, 20));
  }

  private async places() {
    this.state.total = 1;
    const areas = placeAreas(await this.overpass.query(placesQuery()));
    const result = await saveOsmAreas(this.prisma, areas);
    this.state.found = result.found;
    this.state.saved = result.saved;
    this.state.done = 1;
  }

  private async streets() {
    const districts = await districtBoxes(this.prisma);
    this.state.total = districts.length;
    for (const [i, d] of districts.entries()) {
      if (i > 0) await new Promise((r) => setTimeout(r, this.pauseMs));
      try {
        const elements = await this.overpass.query(streetsQuery([d.s, d.w, d.n, d.e]));
        const result = await saveDistrictStreets(this.prisma, d, elements);
        this.state.found += result.found;
        this.state.saved += result.saved;
      } catch (error) {
        // One district failing (Overpass busy) does not stop the others; run it again later.
        this.state.failed.push(d.nameEn);
        this.log.warn(`streets of ${d.nameEn}: ${(error as Error).message}`);
      }
      this.state.done = i + 1;
    }
  }
}
