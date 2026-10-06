import { IconPlus, IconTag, IconWarningOctogonFill } from "@pierre/icons";

import { frontmatterValueToText, type FrontmatterProperty } from "@shared/frontmatter";
import { TAGS_FIELD_KEY, TASK_NOTE_FIELD_KEYS } from "@shared/note-type-templates";

/** Summarizes tags while collapsed and labels the property panel while expanded. */
export const NoteDetailsSummary = ({
  expanded,
  id,
  properties,
  warnings,
}: {
  expanded: boolean;
  id: string;
  properties: readonly FrontmatterProperty[];
  warnings: readonly string[];
}) => {
  const tagsProperty = properties.find((property) => property.key === TAGS_FIELD_KEY);
  const tags = tagsProperty?.value.kind === "list" ? tagsProperty.value.value.map(frontmatterValueToText) : null;
  const tagsInvalid = Boolean(tagsProperty && tags === null);
  const visibleTags = tags?.slice(0, 2) ?? [];
  const hiddenTagCount = Math.max(0, (tags?.length ?? 0) - visibleTags.length);
  const fieldCount = properties.length;
  const fieldNames = properties.map((property) => property.key);
  const statusProperty = properties.find(
    (property) => property.key === "status" || property.key === TASK_NOTE_FIELD_KEYS.status,
  );
  const status = statusProperty?.value.kind === "string" ? statusProperty.value.value : null;
  const empty = properties.length === 0;
  const warning = warnings.length ? (
    <span className="note-details-summary-warning" title={warnings.join("\n")}>
      <IconWarningOctogonFill aria-hidden="true" />
      <span>{warnings[0]}</span>
      {warnings.length > 1 ? <span className="note-details-summary-warning-count">+{warnings.length - 1}</span> : null}
    </span>
  ) : null;

  if (expanded && !empty) {
    return (
      <span id={id} className="note-details-summary note-details-summary-expanded">
        <span>Details</span>
        <span className="note-details-summary-count">{properties.length}</span>
        {warning}
      </span>
    );
  }

  if (empty) {
    return (
      <span id={id} className="note-details-summary">
        <span className="note-details-summary-add">
          {!expanded ? <IconPlus aria-hidden="true" /> : null}
          {expanded ? "Hide details" : "Add details"}
        </span>
      </span>
    );
  }

  return (
    <span id={id} className="note-details-summary">
      {warning}
      {visibleTags.length > 0 || (tagsInvalid && !warnings.length) ? (
        <span className="note-details-summary-segment note-details-summary-tags">
          <IconTag aria-hidden="true" className="note-details-summary-icon" />
          {visibleTags.length > 0 ? (
            visibleTags.map((tag, index) => (
              <span key={`${tag}-${index}`} className="note-details-summary-tag" title={tag}>
                <span>{tag}</span>
              </span>
            ))
          ) : (
            <span className="note-details-summary-invalid">Invalid tags</span>
          )}
          {hiddenTagCount > 0 ? (
            <span
              className="note-details-summary-tag-overflow"
              title={`${hiddenTagCount} more ${hiddenTagCount === 1 ? "tag" : "tags"}`}
            >
              +{hiddenTagCount}
            </span>
          ) : null}
        </span>
      ) : null}
      {status ? <span className="note-details-summary-status" title={status}>{status}</span> : null}
      <span className="note-details-summary-fields" title={fieldNames.join(", ")}>
        {fieldCount} {fieldCount === 1 ? "field" : "fields"}
      </span>
    </span>
  );
};
