export type ErrorCode = 'invalid-input' | 'not-found' | 'conflict';

/**
 * An expected, user-correctable failure. Front ends turn the code into an exit
 * status or HTTP status and show the message and details to the user.
 */
export class SpecGarageError extends Error {
  readonly code: ErrorCode;
  readonly details: readonly string[];

  constructor(code: ErrorCode, message: string, details: readonly string[] = []) {
    super(message);
    this.name = 'SpecGarageError';
    this.code = code;
    this.details = details;
  }
}
