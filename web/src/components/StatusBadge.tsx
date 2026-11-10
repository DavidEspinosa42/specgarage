import type { Status } from '../api-types.ts';
import { STATUS_LABELS, STATUS_SYMBOLS } from '../format.ts';

/** Status as text plus a symbol and color, so it never relies on color alone. */
export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`badge badge-${status}`}>
      <span aria-hidden="true" className="badge-symbol">
        {STATUS_SYMBOLS[status]}
      </span>
      {STATUS_LABELS[status]}
    </span>
  );
}
