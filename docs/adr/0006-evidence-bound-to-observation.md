# 0006. Evidence is bound to the observation it was prepared for

**Status:** Accepted

## Context

A result is only Compliant or Non-Compliant when the required evidence is attached to the current observation. The first design attached an upload to "the current observation" at the moment the server processed it. That has a race: if a requirement is recorded again while an upload is in flight, files meant for the earlier measurement attach to the newer one and can make its result look supported. Browser-side fixes (disabling buttons, clearing inputs) reduce the chance but cannot remove it, since the server cannot tell which record the person was looking at.

## Decision

The evidence endpoint requires the `observationId` the files were prepared for. If that is not the requirement's current observation, the request is refused with a conflict before any file is stored. The web interface sends the id of the record on screen and discards chosen files whenever the record changes. The service function requires the id as well, so no caller can skip the check.

## Consequences

- The evidence-gating invariant holds regardless of timing or client behavior.
- A person whose page is out of date gets a clear conflict message and reloads, instead of a silently wrong result.
- Clients must read `current.id` from the checklist before attaching evidence; command-line users of the API do the same (see [api.md](../api.md)).
- Recording an observation together with its files in one request is unaffected: they are created in a single transaction.
