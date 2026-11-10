import { type FormEvent, useId, useRef, useState } from 'react';
import { ApiError, api } from '../api.ts';
import type { RequirementView } from '../api-types.ts';
import { FilePicker } from './FilePicker.tsx';

const VERDICTS = [
  { value: 'pass', label: 'Pass', hint: 'satisfies the requirement' },
  { value: 'fail', label: 'Fail', hint: 'a violation was found' },
  { value: 'undetermined', label: 'Cannot determine', hint: 'not enough information' },
] as const;

interface Props {
  requirement: RequirementView;
  inspectionId: string;
  language: string | null;
  onSaved: () => void;
  onCancel: () => void;
  /** Tells the card a save is in flight, so it keeps this form mounted until it finishes. */
  onBusy: (busy: boolean) => void;
}

export function RecordForm({
  requirement,
  inspectionId,
  language,
  onSaved,
  onCancel,
  onBusy,
}: Props) {
  const id = useId();
  const files = useRef<HTMLInputElement>(null);
  const check = requirement.check;
  const numeric = check.type !== 'manual';
  const unit = check.type === 'manual' ? '' : check.unit;

  const [value, setValue] = useState('');
  const [cannotMeasure, setCannotMeasure] = useState(false);
  const [verdict, setVerdict] = useState<string>('');
  // Conditions are never carried over from an earlier record: each measurement must be
  // confirmed afresh, or a stale confirmation could turn into a Compliant result.
  const [confirmed, setConfirmed] = useState<Set<string>>(() => new Set());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleCondition(key: string, checked: boolean) {
    setConfirmed((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return; // aria-disabled keeps focus on the button, so guard re-entry here
    setError(null);
    if (numeric && !cannotMeasure && value.trim() === '') {
      setError('Enter the measured value, or tick "Cannot be measured".');
      return;
    }
    if (!numeric && verdict === '') {
      setError('Choose a result.');
      return;
    }

    const data = new FormData();
    if (numeric) {
      if (cannotMeasure) data.set('verdict', 'undetermined');
      else {
        data.set('value', value.trim());
        data.set('unit', unit);
      }
    } else {
      data.set('verdict', verdict);
    }
    for (const condition of requirement.conditions) {
      if (confirmed.has(condition.key)) data.append('conditions', condition.key);
    }
    if (note.trim() !== '') data.set('note', note);
    for (const file of Array.from(files.current?.files ?? [])) data.append('files', file);

    setBusy(true);
    onBusy(true);
    try {
      await api.record(inspectionId, requirement.key, data);
      onSaved();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Something went wrong.');
      setBusy(false);
      onBusy(false);
    }
  }

  const needs = requirement.requiredEvidence.map((kind) =>
    kind === 'photo' ? 'a photo' : 'a PDF document',
  );

  return (
    <form className="record-form" onSubmit={submit} noValidate>
      {numeric ? (
        <div className="field">
          <label htmlFor={`${id}-value`}>
            Measured value <span className="unit">({unit})</span>
          </label>
          <input
            id={`${id}-value`}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            value={value}
            disabled={cannotMeasure}
            onChange={(event) => setValue(event.target.value)}
            aria-describedby={`${id}-value-hint`}
          />
          <p id={`${id}-value-hint`} className="hint">
            Use a dot as the decimal separator, for example 1658.5. The value is compared exactly
            and is not converted between units.
          </p>
          <label className="inline">
            <input
              type="checkbox"
              checked={cannotMeasure}
              onChange={(event) => setCannotMeasure(event.target.checked)}
            />
            Cannot be measured
          </label>
        </div>
      ) : (
        <fieldset className="field">
          <legend>Result</legend>
          {VERDICTS.map((option) => (
            <label key={option.value} className="inline">
              <input
                type="radio"
                name={`${id}-verdict`}
                value={option.value}
                checked={verdict === option.value}
                onChange={() => setVerdict(option.value)}
              />
              <span>
                {option.label} <span className="hint-inline">— {option.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {requirement.conditions.length > 0 && (
        <fieldset className="field">
          <legend>Conditions of the measurement</legend>
          <p className="hint">
            Confirm only what is true. Without every condition the result stays Unverifiable.
          </p>
          {requirement.conditions.map((condition) => (
            <label key={condition.key} className="inline">
              <input
                type="checkbox"
                checked={confirmed.has(condition.key)}
                onChange={(event) => toggleCondition(condition.key, event.target.checked)}
              />
              <span lang={language ?? undefined}>{condition.text}</span>
            </label>
          ))}
        </fieldset>
      )}

      <div className="field">
        <label htmlFor={`${id}-files`}>Evidence files</label>
        <FilePicker id={`${id}-files`} inputRef={files} describedBy={`${id}-files-hint`} />
        <p id={`${id}-files-hint`} className="hint">
          {needs.length > 0
            ? `Required for a result: ${needs.join(' and ')}. `
            : 'No evidence is required for this requirement. '}
          JPEG, PNG, WebP, or PDF. The application never judges a file from its contents.
        </p>
      </div>

      <div className="field">
        <label htmlFor={`${id}-note`}>Note (optional)</label>
        <textarea
          id={`${id}-note`}
          rows={2}
          maxLength={500}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          aria-describedby={`${id}-note-hint`}
        />
        <p id={`${id}-note-hint`} className="hint">
          Do not enter names or other personal data.
        </p>
      </div>

      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}

      <div className="actions">
        <button type="submit" className="primary" aria-disabled={busy}>
          {busy ? 'Recording…' : 'Record result'}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
