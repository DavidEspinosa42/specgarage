import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from './api.ts';
import type { ChecklistView, InspectionSummary, Status } from './api-types.ts';
import { RequirementCard } from './components/RequirementCard.tsx';
import { StatusBadge } from './components/StatusBadge.tsx';
import { formatTime, OUTSTANDING, STATUS_LABELS } from './format.ts';

const ALWAYS_SHOWN: readonly Status[] = ['pending', 'compliant', 'non-compliant', 'unverifiable'];
const NOTICE =
  'Internal preparation assessment. This is not an official inspection, homologation, or certification.';

function readHash(): string | null {
  return /^#\/inspection\/([0-9a-fA-F-]+)$/.exec(window.location.hash)?.[1] ?? null;
}

function messageOf(failure: unknown): string {
  return failure instanceof ApiError ? failure.message : 'Something went wrong.';
}

export function App() {
  const [inspections, setInspections] = useState<InspectionSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(readHash);
  const [checklist, setChecklist] = useState<ChecklistView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outstandingOnly, setOutstandingOnly] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  // Every checklist request takes a number; only the newest response may update the screen,
  // so slow or out-of-order replies can never overwrite newer data.
  const latestRequest = useRef(0);
  // The inspection currently on screen, so a late reply for another one is ignored.
  const shownId = useRef<string | null>(null);

  const loadInspections = useCallback(() => {
    setError(null);
    api
      .inspections()
      .then(setInspections)
      .catch((failure) => setError(messageOf(failure)));
  }, []);

  useEffect(loadInspections, [loadInspections]);

  useEffect(() => {
    const onHashChange = () => {
      // Other hashes (such as in-page anchors) must not reset the selection.
      const id = readHash();
      if (id !== null) setSelected(id);
      // Going back to the bare URL means "no inspection requested", so show the newest again.
      else if (window.location.hash === '') setSelected(null);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Resolve the requested inspection. With no request the newest is shown; a request that
  // matches nothing, or more than one inspection, is reported instead of silently redirected.
  const matches =
    inspections === null || selected === null
      ? []
      : inspections.filter((item) => item.id.startsWith(selected));
  let resolved: InspectionSummary | null = null;
  let selectionProblem: string | null = null;
  if (inspections !== null && inspections.length > 0) {
    if (selected === null) resolved = inspections[0] ?? null;
    else if (matches.length === 1) resolved = matches[0] ?? null;
    else {
      selectionProblem =
        matches.length === 0
          ? `No inspection matches “${selected}”.`
          : `“${selected}” matches more than one inspection; use more characters.`;
    }
  }
  const resolvedId = resolved?.id ?? null;
  shownId.current = resolvedId;

  const loadChecklist = useCallback((id: string) => {
    const request = ++latestRequest.current;
    setChecklist(null);
    setError(null);
    api
      .checklist(id)
      .then((view) => {
        if (latestRequest.current === request) setChecklist(view);
      })
      .catch((failure) => {
        if (latestRequest.current === request) setError(messageOf(failure));
      });
  }, []);

  useEffect(() => {
    if (resolvedId !== null) loadChecklist(resolvedId);
  }, [resolvedId, loadChecklist]);

  const refresh = useCallback(
    async (message: string) => {
      // A save that finishes after the user switched inspection must not disturb the new one.
      if (resolvedId === null || shownId.current !== resolvedId) return;
      const request = ++latestRequest.current;
      try {
        const view = await api.checklist(resolvedId);
        if (latestRequest.current !== request) return;
        setChecklist(view);
        setAnnouncement(message);
      } catch (failure) {
        if (latestRequest.current === request) setError(messageOf(failure));
      }
    },
    [resolvedId],
  );

  function openNewest() {
    setSelected(null);
    window.history.replaceState(null, '', window.location.pathname);
  }

  function retry() {
    loadInspections();
    if (resolvedId !== null) loadChecklist(resolvedId);
  }

  function choose(id: string) {
    window.location.hash = `#/inspection/${id}`;
  }

  return (
    <>
      <button
        type="button"
        className="skip-link"
        onClick={() => {
          // Move focus without touching the URL hash, which holds the selected inspection.
          document.getElementById('main')?.focus();
        }}
      >
        Skip to the checklist
      </button>
      <header className="app-header">
        <h1>SpecGarage</h1>
        {inspections !== null && inspections.length > 0 && (
          <div className="picker">
            <label htmlFor="inspection-select">Inspection</label>
            <select
              id="inspection-select"
              value={resolvedId ?? ''}
              onChange={(event) => choose(event.target.value)}
            >
              {resolvedId === null && (
                <option value="" disabled>
                  Choose an inspection
                </option>
              )}
              {inspections.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.vehicleCode} · {item.eventName} · {item.categoryCode} {item.season}
                </option>
              ))}
            </select>
          </div>
        )}
      </header>

      <main id="main" tabIndex={-1}>
        <p className="notice" role="note">
          {checklist?.notice ?? NOTICE}
        </p>

        {error !== null && (
          <div role="alert" className="error-panel">
            <p>{error}</p>
            <button type="button" onClick={retry}>
              Try again
            </button>
          </div>
        )}

        {selectionProblem !== null && (
          <div role="alert" className="error-panel">
            <p>{selectionProblem}</p>
            <button type="button" onClick={openNewest}>
              Open the newest inspection
            </button>
          </div>
        )}

        {error === null && inspections === null && <p>Loading…</p>}

        {error === null && inspections !== null && inspections.length === 0 && (
          <section className="empty">
            <h2>No inspections yet</h2>
            <p>
              Create one from the command line, then reload this page. To try the application with
              fictional data:
            </p>
            <pre>
              <code>pnpm specgarage seed demo</code>
            </pre>
          </section>
        )}

        {error === null && resolvedId !== null && checklist === null && <p>Loading checklist…</p>}

        {checklist !== null && checklist.inspection.id === resolvedId && (
          <Checklist
            checklist={checklist}
            outstandingOnly={outstandingOnly}
            onOutstandingOnly={setOutstandingOnly}
            onChanged={refresh}
          />
        )}
      </main>

      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>
    </>
  );
}

interface ChecklistProps {
  checklist: ChecklistView;
  outstandingOnly: boolean;
  onOutstandingOnly: (value: boolean) => void;
  onChanged: (message: string) => Promise<void>;
}

function Checklist({ checklist, outstandingOnly, onOutstandingOnly, onChanged }: ChecklistProps) {
  const { inspection, edition, documents, systems, counts } = checklist;
  const language = edition.language;
  const shownStatuses = (Object.keys(counts) as Status[]).filter(
    (status) => ALWAYS_SHOWN.includes(status) || counts[status] > 0,
  );

  const visible = systems
    .map((system) => ({
      ...system,
      requirements: system.requirements.filter(
        (requirement) => !outstandingOnly || OUTSTANDING.includes(requirement.status),
      ),
    }))
    .filter((system) => system.requirements.length > 0);

  return (
    <>
      <section aria-labelledby="inspection-heading" className="overview">
        <h2 id="inspection-heading">
          Vehicle {inspection.vehicleCode} · {inspection.eventName}
        </h2>
        <p className="meta">
          {inspection.eventDate} · station {inspection.stationLabel} ·{' '}
          <span lang={language ?? undefined}>{edition.categoryName}</span> {edition.season}, edition{' '}
          {edition.edition} · started {formatTime(inspection.startedAt)}
        </p>

        <ul className="counts" aria-label="Results summary">
          {shownStatuses.map((status) => (
            <li key={status}>
              <StatusBadge status={status} />
              <span className="count">
                {counts[status]}
                <span className="sr-only"> {STATUS_LABELS[status]} requirements</span>
              </span>
            </li>
          ))}
        </ul>

        <label className="inline filter">
          <input
            type="checkbox"
            checked={outstandingOnly}
            onChange={(event) => onOutstandingOnly(event.target.checked)}
          />
          Show outstanding only (Pending, Non-Compliant, Unverifiable)
        </label>

        <details className="documents">
          <summary>Regulation documents applied ({documents.length})</summary>
          <ul>
            {documents.map((document) => (
              <li key={document.key}>
                <strong lang={language ?? undefined}>{document.title}</strong> — {document.type}
                {document.edition !== null && `, ${document.edition}`}
                {document.effectiveFrom !== null &&
                  `, valid ${document.effectiveFrom} to ${document.effectiveTo ?? 'further notice'}`}
                {document.sha256 !== null ? (
                  <span className="hint-inline"> · file hash {document.sha256.slice(0, 12)}…</span>
                ) : (
                  <span className="hint-inline"> · no stored copy</span>
                )}
              </li>
            ))}
          </ul>
        </details>
      </section>

      {visible.length === 0 && (
        <p className="empty">Nothing is outstanding. Every requirement has a recorded result.</p>
      )}

      {visible.map((system) => (
        <section key={system.key} className="system" aria-labelledby={`system-${system.key}`}>
          <h2 id={`system-${system.key}`} lang={language ?? undefined}>
            {system.name}
          </h2>
          <div className="cards">
            {system.requirements.map((requirement) => (
              <RequirementCard
                key={requirement.key}
                requirement={requirement}
                inspectionId={inspection.id}
                language={language}
                onChanged={onChanged}
              />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
