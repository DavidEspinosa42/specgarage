import { type RefObject, useState } from 'react';

interface Props {
  id: string;
  inputRef: RefObject<HTMLInputElement | null>;
  describedBy?: string;
}

/**
 * A file chooser whose visible text is always English. The native control's
 * wording ("Choose files", "No file chosen") follows the browser's own language
 * and cannot be changed, so the real input stays in the page, focusable and
 * labelled for assistive technology, while this component draws the button and
 * the status text.
 */
export function FilePicker({ id, inputRef, describedBy }: Props) {
  const [count, setCount] = useState(0);
  const status =
    count === 0 ? 'No files chosen' : count === 1 ? '1 file chosen' : `${count} files chosen`;

  return (
    <span className="file-picker">
      <input
        id={id}
        ref={inputRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,application/pdf"
        aria-describedby={describedBy}
        onChange={(event) => setCount(event.target.files?.length ?? 0)}
      />
      <label htmlFor={id} className="file-button">
        Choose files
      </label>
      <span className="file-status">{status}</span>
    </span>
  );
}
