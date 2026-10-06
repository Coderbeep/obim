import { IconFileText, IconPlus, IconTag, IconX } from "@pierre/icons";
import { useMemo, useState, type ReactNode } from "react";
import { Badge } from "@renderer/shared/ui/badge";
import { Button } from "@renderer/shared/ui/button";
import { Input } from "@renderer/shared/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@renderer/shared/ui/popover";
import { normalizeTags } from "@renderer/shared/tags";
import {
  frontmatterValueToText,
  getFrontmatterProperty,
  getFrontmatterStringList,
  parseFrontmatter,
  planFrontmatterEdit,
  type FrontmatterInput,
} from "@shared/frontmatter";
import { TAGS_FIELD_KEY } from "@shared/note-type-templates";
import { EditorView } from "../codemirror-view";
import "./DocumentProperties.css";

export function updateNoteProperty(source: string, key: string, value: FrontmatterInput): string | null {
  const element = document.querySelector<HTMLElement>(".pane-card-active .cm-editor");
  const view = element ? EditorView.findFromDOM(element) : null;
  if (!view || view.state.readOnly) return "Open the note in an editable pane to change its properties.";
  if (view.state.doc.toString() !== source) return "The note has changed. Please try again.";
  const edit = planFrontmatterEdit(source, { type: "upsert", key, value });
  if (!edit.success) return edit.error;
  view.dispatch({ changes: edit.change });
  return null;
}

function PropertyRow({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="note-property-row">
      <dt>
        {icon}
        <span>{label}</span>
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

export function DocumentProperties({ text }: { text: string }) {
  const properties = useMemo(() => parseFrontmatter(text), [text]);
  const tagValue = getFrontmatterProperty(properties, TAGS_FIELD_KEY)?.value;
  const tags =
    getFrontmatterStringList(properties, TAGS_FIELD_KEY) ?? (tagValue?.kind === "string" ? [tagValue.value] : []);
  const statusValue = getFrontmatterProperty(properties, "status")?.value;
  const status = statusValue?.kind === "string" ? statusValue.value : "";
  const canEditTags =
    !tagValue || tagValue.kind === "string" || getFrontmatterStringList(properties, TAGS_FIELD_KEY) !== undefined;
  const canEditStatus = !statusValue || statusValue.kind === "string";
  const [tagOpen, setTagOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = (key: string, value: FrontmatterInput) => {
    const result = updateNoteProperty(text, key, value);
    setError(result);
    return result === null;
  };
  return (
    <div className="note-properties">
      <dl>
        {properties.kind === "valid" &&
          properties.properties.map((property) => {
            if (property.key === TAGS_FIELD_KEY && canEditTags)
              return (
                <PropertyRow key={property.key} icon={<IconTag size={15} />} label={property.key}>
                  <div className="note-property-tags">
                    {tags.map((tag, index) => (
                      <Badge key={index} variant="category" className="note-property-tag" title={tag}>
                        <span>{tag}</span>
                        <button
                          type="button"
                          aria-label={`Remove tag ${tag}`}
                          onClick={() =>
                            save(
                              TAGS_FIELD_KEY,
                              tags.filter((value) => value !== tag),
                            )
                          }
                        >
                          <IconX size={12} />
                        </button>
                      </Badge>
                    ))}
                    {!tags.length && (
                      <span className="text-muted-foreground">{canEditTags ? "No tags" : "Custom YAML value"}</span>
                    )}
                    <Popover
                      open={tagOpen}
                      onOpenChange={(open) => {
                        setTagOpen(open);
                        setDraft("");
                        setError(null);
                      }}
                    >
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          size="xsm"
                          className="note-property-add"
                          aria-label="Add tag"
                          disabled={!canEditTags}
                        >
                          <IconPlus size={14} />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent align="end" className="w-60 p-3">
                        <form
                          className="space-y-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            if (draft.trim() && save(TAGS_FIELD_KEY, normalizeTags([...tags, draft])))
                              setTagOpen(false);
                          }}
                        >
                          <label htmlFor="note-property-tag-input" className="text-ui-body font-semibold">
                            Add tag
                          </label>
                          <Input
                            id="note-property-tag-input"
                            value={draft}
                            onChange={(event) => setDraft(event.target.value)}
                            placeholder="Tag name"
                          />
                          <Button type="submit" variant="secondary" disabled={!draft.trim()}>
                            Add tag
                          </Button>
                          {error && (
                            <p role="alert" className="text-ui-meta text-destructive">
                              {error}
                            </p>
                          )}
                        </form>
                      </PopoverContent>
                    </Popover>
                  </div>
                </PropertyRow>
              );
            if (property.key === "status" && canEditStatus)
              return (
                <PropertyRow key={property.key} icon={<IconFileText size={15} />} label={property.key}>
                  <Popover
                    open={statusOpen}
                    onOpenChange={(open) => {
                      setStatusOpen(open);
                      setDraft(status);
                      setError(null);
                    }}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        variant="ghost"
                        size="xsm"
                        className="note-property-status"
                        disabled={!canEditStatus}
                        aria-label="Edit note status"
                      >
                        {canEditStatus ? status || "Empty" : "Custom YAML value"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-60 p-3">
                      <form
                        className="space-y-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          if (save("status", draft.trim())) setStatusOpen(false);
                        }}
                      >
                        <label htmlFor="note-property-status-input" className="text-ui-body font-semibold">
                          Note status
                        </label>
                        <Input
                          id="note-property-status-input"
                          value={draft}
                          onChange={(event) => setDraft(event.target.value)}
                          placeholder="Status"
                        />
                        <Button type="submit" variant="secondary">
                          Save
                        </Button>
                        {error && (
                          <p role="alert" className="text-ui-meta text-destructive">
                            {error}
                          </p>
                        )}
                      </form>
                    </PopoverContent>
                  </Popover>
                </PropertyRow>
              );
            return (
              <PropertyRow key={property.key} icon={<IconFileText size={15} />} label={property.key}>
                {property.value.kind === "list" ? (
                  <div className="note-property-tags">
                    {property.value.value.map((value, index) => (
                      <Badge key={index} variant="compact" title={frontmatterValueToText(value)}>
                        {frontmatterValueToText(value) || "null"}
                      </Badge>
                    ))}
                  </div>
                ) : property.value.kind === "unsupported" ? (
                  <span className="whitespace-pre-wrap">
                    {text.slice(property.valueRange.from, property.valueRange.to)}
                  </span>
                ) : (
                  <span className="whitespace-pre-wrap">
                    {frontmatterValueToText(property.value) || (property.value.kind === "null" ? "null" : "Empty")}
                  </span>
                )}
              </PropertyRow>
            );
          })}
      </dl>
      {(properties.kind === "none" || (properties.kind === "valid" && !properties.properties.length)) && (
        <p className="text-ui-body text-muted-foreground">No frontmatter properties in this note.</p>
      )}
      {properties.kind === "invalid" && (
        <p className="text-ui-meta text-muted-foreground">Fix the note’s frontmatter to edit properties.</p>
      )}
      {error && !tagOpen && !statusOpen && (
        <p role="alert" className="text-ui-meta text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
