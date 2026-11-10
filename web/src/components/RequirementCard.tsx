import { type FormEvent, useId, useRef, useState } from 'react';
import { ApiError, api, blobUrl } from '../api.ts';
import type { EvidenceView, RequirementView } from '../api-types.ts';
import { formatBytes, formatTime, shortHash } from '../format.ts';
import { HistoryList } from './HistoryList.tsx';
import { RecordForm } from './RecordForm.tsx';
import { StatusBadge } from './StatusBadge.tsx';

interface Props {
  requirement: RequirementView;
  inspectionId: string;
  language: string | null;
  /** Reloads the checklist, then announces the message to assistive technology. */
  onChanged: (message: string) => Promise<void>;
}

function EvidenceItem({ item }: { item: EvidenceView }) {
  const url = blobUrl(item.sha256);
  if (item.kind === 'photo') {
    return (
      <li>
        <a href={url} target="_blank" rel="noopener noreferrer">
          <img
            src={url}
            alt={`Evidence recorded ${formatTime(item.recordedAt)}`}
            width={72}
            height={72}
            loading="lazy"
          />
        </a>
        <span className="hint-inline">
          {formatBytes(item.byteSize)} · {shortHash(item.sha256)}
        </span>
      </li>
    );
  }
  return (
    <li>
      <a href={url} target="_blank" rel="noopener noreferrer">
        PDF document
      </a>{' '}
      <span className="hint-inline">
        {formatBytes(item.byteSize)} · {shortHash(item.sha256)}
      </span>
    </li>
  );
}

function describeCurrent(requirement: RequirementView): string | null {
  const current = requirement.current;
  if (current === null) return null;
  if (current.value !== null) return `${current.value} ${current.unit ?? ''}`.trim();
  if (current.verdict === 'pass') return 'Pass';
  if (current.verdict === 'fail') return 'Fail';
  return 'Cannot determine';
}

export function RequirementCard({ requirement, inspectionId, language, onChanged }: Props) {
  const headingId = useId();
  const attachFiles = useRef<HTMLInputElement>(null);
  const [panel, setPanel] = useState<'record' | 'history' | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);
  // True while an observation is being saved; the form stays mounted so its result is shown.
  const [recording, setRecording] = useState(false);
  const lang = language ?? undefined;
  const current = requirement.current;

  async function attach(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (attaching) return;
    const chosen = Array.from(attachFiles.current?.files ?? []);
    if (chosen.length === 0) {
      setAttachError('Choose at least one file.');
      return;
    }
    if (current === null) return;
    const data = new FormData();
    // Bind the upload to the record shown on screen, so it can never attach to a newer one.
    data.set('observationId', String(current.id));
    for (const file of chosen) data.append('files', file);
    setAttaching(true);
    setAttachError(null);
    try {
      await api.attach(inspectionId, requirement.key, data);
      if (attachFiles.current) attachFiles.current.value = '';
      await onChanged(`Evidence attached to “${requirement.title}”.`);
    } catch (failure) {
      setAttachError(failure instanceof ApiError ? failure.message : 'Something went wrong.');
    } finally {
      setAttaching(false);
    }
  }

  return (
    <article className="card" aria-labelledby={headingId}>
      <div className="card-head">
        <h3 id={headingId} lang={lang}>
          {requirement.title}
        </h3>
        <StatusBadge status={requirement.status} />
      </div>

      <p className="limit">
        <span className="label">Requirement:</span>{' '}
        <span lang={lang}>{requirement.checkSummary}</span>
      </p>
      {requirement.description !== null && (
        <p className="description" lang={lang}>
          {requirement.description}
        </p>
      )}

      <ul className="sources" aria-label="Regulatory sources">
        {requirement.sources.map((source) => (
          <li key={`${source.documentKey}-${source.article}-${source.page}`}>
            {source.fileSha256 !== null ? (
              <a
                href={blobUrl(source.fileSha256, source.page)}
                target="_blank"
                rel="noopener noreferrer"
                lang={lang}
              >
                {source.documentTitle}
              </a>
            ) : (
              <span lang={lang}>{source.documentTitle}</span>
            )}
            , article {source.article}, page {source.page}
            {source.fileSha256 === null && <span className="hint-inline"> (no stored copy)</span>}
          </li>
        ))}
      </ul>

      {requirement.reasons.length > 0 && requirement.status !== 'pending' && (
        <ul className="reasons" aria-label="Why this result">
          {requirement.reasons.map((reason) => (
            <li key={`${reason.code}-${reason.detail ?? ''}`}>{reason.message}</li>
          ))}
        </ul>
      )}

      {current !== null && (
        <div className="observation">
          <p>
            <span className="label">Recorded:</span> <strong>{describeCurrent(requirement)}</strong>{' '}
            <span className="hint-inline">{formatTime(current.recordedAt)}</span>
          </p>
          {current.note !== null && <p className="note">{current.note}</p>}
          {current.evidence.length > 0 && (
            <ul className="evidence" aria-label="Evidence">
              {current.evidence.map((item) => (
                <EvidenceItem key={item.id} item={item} />
              ))}
            </ul>
          )}
          <form
            // Keyed by the observation so files chosen for one record are discarded, never carried
            // over to a newer record by "Record again".
            key={current.id}
            className="attach"
            onSubmit={attach}
          >
            <label htmlFor={`${headingId}-attach`}>Add evidence to this record</label>
            <input
              id={`${headingId}-attach`}
              ref={attachFiles}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,application/pdf"
            />
            <button type="submit" aria-disabled={attaching}>
              {attaching ? 'Attaching…' : 'Attach'}
            </button>
            {attachError !== null && (
              <p role="alert" className="error">
                {attachError}
              </p>
            )}
          </form>
        </div>
      )}

      <div className="actions">
        <button
          type="button"
          className={panel === 'record' ? '' : 'primary'}
          aria-expanded={panel === 'record'}
          aria-disabled={recording}
          onClick={() => {
            if (!recording) setPanel(panel === 'record' ? null : 'record');
          }}
        >
          {current === null ? 'Record result' : 'Record again'}
        </button>
        {requirement.observationCount > 0 && (
          <button
            type="button"
            aria-expanded={panel === 'history'}
            aria-disabled={recording}
            onClick={() => {
              if (!recording) setPanel(panel === 'history' ? null : 'history');
            }}
          >
            History ({requirement.observationCount})
          </button>
        )}
      </div>

      {panel === 'record' && (
        <RecordForm
          requirement={requirement}
          inspectionId={inspectionId}
          language={language}
          onCancel={() => setPanel(null)}
          onBusy={setRecording}
          onSaved={() => {
            setRecording(false);
            setPanel(null);
            void onChanged(`Recorded “${requirement.title}”.`);
          }}
        />
      )}
      {panel === 'history' && (
        <HistoryList
          // A new observation, evidence file, or result changes the signature, which reloads the list.
          key={`${requirement.observationCount}-${current?.evidence.length ?? 0}-${requirement.status}`}
          inspectionId={inspectionId}
          requirementKey={requirement.key}
        />
      )}
    </article>
  );
}
