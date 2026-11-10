# 0005. Exact decimal numbers, no floating point

**Status:** Accepted

## Context

Compliance limits sit exactly on boundaries: a maximum of 1660 mm must accept 1660 and reject 1660.001. Binary floating point cannot represent many decimal values exactly, and a measurement that is one hair over a limit must never be reported as compliant because of rounding. Regulations declare tolerances only when they say so, and the tool must not invent any.

## Decision

Limits and measurements are decimal strings parsed into a scaled `BigInt` (`src/domain/decimal.ts`) and compared as integers. Only plain decimal text is accepted: optional minus, digits without leading zeros, an optional dot and digits, at most 30 digits. Exponents, a leading plus, thousands separators, and the decimal comma are rejected with an explanatory message. Values are normalized (`1660.0` becomes `1660`) before hashing so equal values produce equal editions.

A small in-house module is used instead of a decimal library: the project needs only parse, compare, and format, and a dependency adds supply-chain surface for about a hundred lines.

## Consequences

- Boundary comparisons are exact and tested, including values floating point cannot distinguish.
- Argentine users type a decimal comma. Until locale-aware entry arrives (Phase 8), the first release rejects it with a clear message instead of guessing, because `1.658` is ambiguous between a thousands separator and a decimal point.
- Unit conversion will need rational arithmetic when it is added (Phase 15); the scaled-integer representation extends to that.
