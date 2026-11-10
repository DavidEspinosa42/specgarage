import { SpecGarageError } from './errors.ts';

/**
 * Vehicles and observer stations carry no personal data: a vehicle is an
 * internal code and an observer is a station label such as "Bay-2".
 */
const VEHICLE_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const STATION_LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,31}$/;

export function assertVehicleCode(value: string): void {
  if (!VEHICLE_CODE_PATTERN.test(value)) {
    throw new SpecGarageError(
      'invalid-input',
      'A vehicle code must start with a letter or digit and use only letters, digits, ".", "_" or "-" (maximum 32 characters).',
    );
  }
}

export function assertStationLabel(value: string): void {
  if (!STATION_LABEL_PATTERN.test(value)) {
    throw new SpecGarageError(
      'invalid-input',
      'A station label must start with a letter or digit and use only letters, digits, spaces, ".", "_" or "-" (maximum 32 characters). Do not enter a person’s name.',
    );
  }
}
