import { useEffect, useState } from 'react';
import { ApiError, api } from '../api.ts';
import type { HistoryEntry } from '../api-types.ts';
import { formatTime, STATUS_LABELS } from '../format.ts';

function describe(entry: HistoryEntry): string {
  const { value, unit, verdict } = entry.observation;
  if (value !== null) return `${value} ${unit ?? ''}`.trim();
  if (verdict === 'undetermined') return 'Cannot determine';
  return verdict === 'pass' ? 'Pass' : 'Fail';
}

export function HistoryList({
  inspectionId,
  requirementKey,
}: {
  inspectionId: string;
  requirementKey: string;
}) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .history(inspectionId, requirementKey)
      .then((response) => {
        if (!cancelled) setEntries(response.entries);
      })
      .catch((failure) => {
        if (!cancelled)
          setError(failure instanceof ApiError ? failure.message : 'Could not load the history.');
      });
    return () => {
      cancelled = true;
    };
  }, [inspectionId, requirementKey]);

  if (error !== null)
    return (
      <p role="alert" className="error">
        {error}
      </p>
    );
  if (entries === null) return <p className="hint">Loading history…</p>;
  if (entries.length === 0)
    return <p className="hint">Nothing has been recorded for this requirement.</p>;

  return (
    <ol className="history">
      {entries.map((entry) => (
        <li key={entry.observation.id}>
          <p>
            <strong>{describe(entry)}</strong>{' '}
            <span className="hint-inline">recorded {formatTime(entry.observation.recordedAt)}</span>
          </p>
          {entry.observation.note !== null && <p className="note">{entry.observation.note}</p>}
          <p className="hint">
            {entry.observation.confirmedConditions.length} condition(s) confirmed ·{' '}
            {entry.evidence.length} evidence file(s)
          </p>
          <ul className="history-results">
            {entry.results.map((result) => (
              <li key={result.evaluatedAt + result.status}>
                {formatTime(result.evaluatedAt)}: {STATUS_LABELS[result.status]}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
