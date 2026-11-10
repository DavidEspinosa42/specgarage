import { SpecGarageError } from '../domain/errors.ts';
import { assertStationLabel, assertVehicleCode } from '../domain/identifiers.ts';
import type { InspectionRecord, VehicleRecord } from '../storage/store.ts';
import type { ServiceContext } from './context.ts';
import { loadEditionRulepack, resolveEdition } from './editions.ts';

export function addVehicle(ctx: ServiceContext, code: string): VehicleRecord {
  assertVehicleCode(code);
  if (ctx.store.getVehicle(code) !== undefined) {
    throw new SpecGarageError('conflict', `Vehicle "${code}" already exists.`);
  }
  const vehicle = { code, createdAt: ctx.now() };
  ctx.store.insertVehicle(vehicle);
  return vehicle;
}

export function listVehicles(ctx: ServiceContext): VehicleRecord[] {
  return ctx.store.listVehicles();
}

export interface StartInspectionInput {
  /** `CATEGORY/season/edition` or a hash prefix of at least 8 characters. */
  edition: string;
  vehicleCode: string;
  eventKey: string;
  stationLabel: string;
}

/** Starts an inspection of one vehicle at one event, pinned to one edition. */
export function startInspection(
  ctx: ServiceContext,
  input: StartInspectionInput,
): InspectionRecord {
  assertStationLabel(input.stationLabel);
  const edition = resolveEdition(ctx, input.edition);
  if (ctx.store.getVehicle(input.vehicleCode) === undefined) {
    throw new SpecGarageError(
      'not-found',
      `Vehicle "${input.vehicleCode}" does not exist. Add it first.`,
    );
  }
  const rulepack = loadEditionRulepack(edition);
  if (!rulepack.events.some((event) => event.key === input.eventKey)) {
    throw new SpecGarageError(
      'not-found',
      `Event "${input.eventKey}" is not in this edition. Available: ${rulepack.events.map((event) => event.key).join(', ')}.`,
    );
  }
  const inspection: InspectionRecord = {
    id: ctx.newId(),
    editionId: edition.id,
    vehicleCode: input.vehicleCode,
    eventKey: input.eventKey,
    stationLabel: input.stationLabel,
    startedAt: ctx.now(),
  };
  ctx.store.insertInspection(inspection);
  return inspection;
}

export interface InspectionSummary {
  id: string;
  vehicleCode: string;
  eventKey: string;
  eventName: string;
  categoryCode: string;
  categoryName: string;
  season: string;
  edition: string;
  startedAt: string;
}

export function listInspections(ctx: ServiceContext): InspectionSummary[] {
  return ctx.store.listInspections().map((inspection) => {
    const edition = ctx.store.getEdition(inspection.editionId);
    if (edition === undefined) throw new Error(`Inspection ${inspection.id} has no edition.`);
    const event = loadEditionRulepack(edition).events.find(
      (item) => item.key === inspection.eventKey,
    );
    return {
      id: inspection.id,
      vehicleCode: inspection.vehicleCode,
      eventKey: inspection.eventKey,
      eventName: event?.name ?? inspection.eventKey,
      categoryCode: edition.categoryCode,
      categoryName: edition.categoryName,
      season: edition.season,
      edition: edition.edition,
      startedAt: inspection.startedAt,
    };
  });
}

/** Finds an inspection by its full id or an unambiguous prefix of at least 6 characters. */
export function resolveInspection(ctx: ServiceContext, reference: string): InspectionRecord {
  if (!/^[0-9a-f-]{6,36}$/.test(reference)) {
    throw new SpecGarageError(
      'invalid-input',
      'Refer to an inspection by at least 6 characters of its id.',
    );
  }
  const matches = ctx.store.findInspectionsByPrefix(reference);
  const [only] = matches;
  if (only === undefined)
    throw new SpecGarageError('not-found', `No inspection matches "${reference}".`);
  if (matches.length > 1) {
    throw new SpecGarageError(
      'invalid-input',
      `"${reference}" matches more than one inspection; use more characters.`,
    );
  }
  return only;
}
