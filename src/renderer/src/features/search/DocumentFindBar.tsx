import type { Ref } from "react";

export function DocumentFindBar({
  inputRef,
  query,
  onQueryChange,
  resultLabel,
  canNavigate,
  onPrevious,
  onNext,
  onClose,
  disabled = false,
}: {
  inputRef: Ref<HTMLInputElement>;
  query: string;
  onQueryChange: (query: string) => void;
  resultLabel: string;
  canNavigate: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
  disabled?: boolean;
}) {
  const expanded = query.length > 0;
  return (
    <div className="document-find-bar pdf-document-find" role="search">
      <div className="document-find-input-row">
        <span className="document-find-icon document-find-icon-search" aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          disabled={disabled}
          aria-label="Search PDF"
          placeholder="Search document"
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (event.shiftKey) onPrevious();
              else onNext();
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              onClose();
            }
          }}
        />
        <button type="button" onClick={onClose} aria-label="Close search">
          <span className="document-find-icon document-find-icon-close" aria-hidden="true" />
        </button>
      </div>
      <div className="document-find-results" data-expanded={expanded} inert={!expanded} aria-hidden={!expanded}>
        <div className="document-find-results-clip">
          <div className="document-find-results-row">
            <button type="button" disabled={!canNavigate} onClick={onPrevious} aria-label="Previous search result">
              <span className="document-find-icon document-find-icon-up" aria-hidden="true" />
            </button>
            <button type="button" disabled={!canNavigate} onClick={onNext} aria-label="Next search result">
              <span className="document-find-icon document-find-icon-down" aria-hidden="true" />
            </button>
            <span role="status" aria-label="Search results">
              {expanded ? resultLabel : ""}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
