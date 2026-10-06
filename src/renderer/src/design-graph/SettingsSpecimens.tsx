import { useId, useState, type ReactNode } from "react";
import { IconChevron, IconFolder, IconSearch } from "@pierre/icons";
import { Button } from "@renderer/shared/ui/button";
import { Input } from "@renderer/shared/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@renderer/shared/ui/popover";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@renderer/shared/ui/dialog";
import "./SettingsSpecimens.css";

function Row({
  state,
  label,
  description,
  children,
}: {
  state: string;
  label: string;
  description: string;
  children: (id: string, helpId: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="settings-study-row" data-design-component="settings" data-design-state={state}>
      <div className="settings-study-copy">
        <label id={`${id}-label`} htmlFor={id}>
          {label}
        </label>
        <p id={`${id}-help`}>{description}</p>
      </div>
      <div className="settings-study-control">{children(id, `${id}-help`)}</div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-study-group">
      <h4>{title}</h4>
      {children}
    </section>
  );
}

function Choices({
  id,
  helpId,
  value,
  options,
  onChange,
}: {
  id: string;
  helpId: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <div
      className="settings-study-segments"
      role="radiogroup"
      aria-labelledby={`${id}-label`}
      aria-describedby={helpId}
    >
      {options.map((option, index) => (
        <label key={option}>
          <input
            id={index === 0 ? id : undefined}
            type="radio"
            name={id}
            value={option}
            checked={value === option}
            onChange={() => onChange(option)}
          />
          <span>{option}</span>
        </label>
      ))}
    </div>
  );
}

function FolderPicker({ id, helpId }: { id: string; helpId: string }) {
  const [value, setValue] = useState("Notes / Daily");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const folders = ["Workspace root", "Notes / Daily", "Notes / Research", "Sources / PDFs", "Tasks"];
  const visible = folders.filter((folder) => folder.toLowerCase().includes(query.toLowerCase()));
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          id={id}
          className="settings-study-field settings-study-folder"
          type="button"
          aria-labelledby={`${id}-label ${id}-value`}
          aria-describedby={helpId}
        >
          <IconFolder size={14} aria-hidden="true" />
          <span id={`${id}-value`}>{value}</span>
          <IconChevron size={12} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="settings-study-folder-menu">
        <Input
          autoFocus
          type="search"
          aria-label="Search example folders"
          placeholder="Find a folder…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="settings-study-folder-options" role="group" aria-label="Example folders">
          {visible.map((folder) => (
            <button
              type="button"
              key={folder}
              aria-pressed={value === folder}
              onClick={() => {
                setValue(folder);
                setOpen(false);
              }}
            >
              <IconFolder size={14} aria-hidden="true" />
              <span>{folder}</span>
              {value === folder && <span aria-hidden="true">✓</span>}
            </button>
          ))}
          {!visible.length && <p role="status">No matching folders. Try “Notes”.</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function RepositoryField({ id, helpId }: { id: string; helpId: string }) {
  const initial = "https://github.com/example/notes.git";
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [message, setMessage] = useState("");
  const [invalid, setInvalid] = useState(false);
  return (
    <form
      className="settings-study-form"
      onSubmit={(event) => {
        event.preventDefault();
        const valid = /^https:\/\/[^/\s]+\/\S+$/.test(draft.trim());
        setInvalid(!valid);
        if (valid) setSaved(draft.trim());
        setMessage(valid ? "Saved in this preview." : "Enter an HTTPS repository URL with a repository path.");
      }}
    >
      <Input
        id={id}
        value={draft}
        aria-describedby={`${helpId} ${id}-message`}
        aria-invalid={invalid}
        onChange={(event) => {
          setDraft(event.target.value);
          setInvalid(false);
          setMessage("");
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setDraft(saved);
            setInvalid(false);
            setMessage("");
          }
        }}
      />
      <div className="settings-study-actions">
        <Button type="submit" disabled={draft.trim() === saved}>
          Save
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={draft === saved}
          onClick={() => {
            setDraft(saved);
            setMessage("");
            setInvalid(false);
          }}
        >
          Cancel
        </Button>
      </div>
      <p id={`${id}-message`} role="status" className={invalid ? "settings-study-error" : ""}>
        {message}
      </p>
    </form>
  );
}

function ShortcutField({ id, helpId }: { id: string; helpId: string }) {
  const [recording, setRecording] = useState(false);
  const [binding, setBinding] = useState("⌘ ⇧ P");
  const [message, setMessage] = useState("");
  return (
    <div className="settings-study-form">
      <button
        id={id}
        type="button"
        className="settings-study-field settings-study-shortcut"
        aria-describedby={`${helpId} ${id}-status`}
        onClick={() => {
          setRecording(true);
          setMessage("Press a modifier and a letter or number.");
        }}
        onBlur={() => {
          setRecording(false);
          setMessage("");
        }}
        onKeyDown={(event) => {
          if (!recording || event.key === "Tab") return;
          event.preventDefault();
          if (event.key === "Escape") {
            setRecording(false);
            setMessage("Recording cancelled.");
            return;
          }
          if (!/^[a-z0-9]$/i.test(event.key) || !(event.metaKey || event.ctrlKey || event.altKey)) return;
          setBinding(
            [
              event.metaKey && "⌘",
              event.ctrlKey && "Ctrl",
              event.altKey && "Alt",
              event.shiftKey && "⇧",
              event.key.toUpperCase(),
            ]
              .filter(Boolean)
              .join(" "),
          );
          setRecording(false);
          setMessage("Shortcut updated in this preview.");
        }}
      >
        <span>{recording ? "Press shortcut…" : <kbd>{binding}</kbd>}</span>
        <span>{recording ? "Esc to cancel" : "Record"}</span>
      </button>
      <p id={`${id}-status`} role="status">
        {message}
      </p>
    </div>
  );
}

export function SettingsSpecimens() {
  const [theme, setTheme] = useState("System");
  const [placement, setPlacement] = useState("Left");
  const [controls, setControls] = useState(true);
  const [zoom, setZoom] = useState(100);
  const [spacing, setSpacing] = useState(24);
  const [mode, setMode] = useState("New tab");
  const [patterns, setPatterns] = useState(".DS_Store\nnode_modules/");
  const [savedPatterns, setSavedPatterns] = useState(patterns);
  const [patternMessage, setPatternMessage] = useState("");
  const [resetMessage, setResetMessage] = useState("");

  return (
    <div className="settings-study">
      <div className="settings-study-direction" data-design-component="settings" data-design-state="foundations">
        <span className="settings-study-kicker">Design proposal · interactive preview</span>
        <h3>Quiet structure. Clear choices.</h3>
        <p>
          One row pattern across every settings page. Labels lead, controls align, and feedback stays beside the change.
        </p>
        <div className="settings-study-tokens">
          <span>
            <b>32 px</b> control height
          </span>
          <span>
            <b>4 px</b> control radius
          </span>
          <span>
            <b>24 px</b> group spacing
          </span>
          <span>
            <b>2 px</b> keyboard focus
          </span>
        </div>
      </div>

      <div className="settings-study-preview">
        <header className="settings-study-heading">
          <div>
            <span className="settings-study-kicker">01 / In context</span>
            <h3>Appearance</h3>
            <p>Make this workspace comfortable to work in.</p>
          </div>
          <span className="settings-study-preview-label">Local preview only</span>
        </header>
        <Group title="Interface">
          <Row
            state="segmented-choice"
            label="Color theme"
            description="Use segments for two or three short, exclusive choices."
          >
            {(id, helpId) => (
              <Choices
                id={id}
                helpId={helpId}
                value={theme}
                options={["Light", "Dark", "System"]}
                onChange={setTheme}
              />
            )}
          </Row>
          <Row
            state="binary-choice"
            label="Sidebar position"
            description="Keep spatial choices visible and easy to compare."
          >
            {(id, helpId) => (
              <Choices id={id} helpId={helpId} value={placement} options={["Left", "Right"]} onChange={setPlacement} />
            )}
          </Row>
          <Row
            state="switch"
            label="Window controls"
            description="A switch applies one independent on/off preference immediately."
          >
            {(id, helpId) => (
              <div className="settings-study-switch-wrap">
                <span aria-hidden="true">{controls ? "On" : "Off"}</span>
                <input
                  className="settings-study-switch"
                  id={id}
                  type="checkbox"
                  role="switch"
                  checked={controls}
                  aria-describedby={helpId}
                  onChange={(event) => setControls(event.target.checked)}
                />
              </div>
            )}
          </Row>
          <Row
            state="number-stepper"
            label="Interface zoom"
            description="Exact values use a bounded stepper. 75–150%, in steps of 5."
          >
            {(id, helpId) => (
              <div className="settings-study-stepper">
                <button
                  type="button"
                  aria-label="Decrease interface zoom"
                  disabled={zoom <= 75}
                  onClick={() => setZoom(zoom - 5)}
                >
                  −
                </button>
                <input
                  id={id}
                  type="number"
                  min={75}
                  max={150}
                  step={5}
                  value={zoom}
                  aria-describedby={helpId}
                  onChange={(event) => {
                    const value = event.target.valueAsNumber;
                    if (Number.isFinite(value)) setZoom(Math.min(150, Math.max(75, Math.round(value / 5) * 5)));
                  }}
                />
                <span aria-hidden="true">%</span>
                <button
                  type="button"
                  aria-label="Increase interface zoom"
                  disabled={zoom >= 150}
                  onClick={() => setZoom(zoom + 5)}
                >
                  +
                </button>
              </div>
            )}
          </Row>
        </Group>
        <Group title="Reading">
          <Row state="select" label="Editor font" description="A select holds longer lists without crowding the page.">
            {(id, helpId) => (
              <select id={id} className="settings-study-field" aria-describedby={helpId} defaultValue="System font">
                <option>System font</option>
                <option>Serif</option>
                <option>Monospace</option>
              </select>
            )}
          </Row>
          <Row
            state="range"
            label="Paragraph spacing"
            description="Use a slider for a visual adjustment, with its value always visible."
          >
            {(id, helpId) => (
              <div className="settings-study-range">
                <input
                  id={id}
                  type="range"
                  min={8}
                  max={40}
                  step={4}
                  value={spacing}
                  aria-valuetext={`${spacing} pixels`}
                  aria-describedby={helpId}
                  onChange={(event) => setSpacing(Number(event.target.value))}
                />
                <output htmlFor={id}>{spacing} px</output>
              </div>
            )}
          </Row>
        </Group>
      </div>
      <div className="settings-study-preview">
        <header className="settings-study-heading">
          <div>
            <span className="settings-study-kicker">02 / Control vocabulary</span>
            <h3>Made for each kind of input</h3>
            <p>The same proportions, labels, and interaction rules in every category.</p>
          </div>
        </header>
        <Group title="Values & destinations">
          <Row
            state="text"
            label="Workspace name"
            description="Short text uses a single field. Keep a visible label, even when empty."
          >
            {(id, helpId) => (
              <Input
                id={id}
                aria-describedby={helpId}
                defaultValue="Personal notes"
                placeholder="Name your workspace"
              />
            )}
          </Row>
          <Row
            state="search"
            label="Find a setting"
            description="Search updates as you type; an empty query restores all results."
          >
            {(id, helpId) => <SettingsSearch id={id} helpId={helpId} />}
          </Row>
          <Row
            state="folder-picker"
            label="Daily notes folder"
            description="Show the path. Search within a picker; Escape closes without changing it."
          >
            {(id, helpId) => <FolderPicker id={id} helpId={helpId} />}
          </Row>
          <Row
            state="validated-text"
            label="Repository URL"
            description="Connection settings stay as a draft until Save. Escape restores the saved value."
          >
            {(id, helpId) => <RepositoryField id={id} helpId={helpId} />}
          </Row>
          <Row
            state="multiline"
            label="Ignored files"
            description="Multiline input grows vertically. Save and Cancel sit directly below the field."
          >
            {(id, helpId) => (
              <div className="settings-study-form">
                <textarea
                  id={id}
                  aria-describedby={helpId}
                  className="settings-study-field"
                  rows={3}
                  value={patterns}
                  onChange={(event) => {
                    setPatterns(event.target.value);
                    setPatternMessage("");
                  }}
                />
                <div className="settings-study-actions">
                  <Button
                    disabled={patterns === savedPatterns}
                    onClick={() => {
                      setSavedPatterns(patterns);
                      setPatternMessage("Saved in this preview.");
                    }}
                  >
                    Save
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={patterns === savedPatterns}
                    onClick={() => {
                      setPatterns(savedPatterns);
                      setPatternMessage("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
                <p role="status">{patternMessage}</p>
              </div>
            )}
          </Row>
        </Group>
        <Group title="Behavior & shortcuts">
          <Row
            state="radio-cards"
            label="Open tasks in"
            description="Use descriptive radio options when the consequences need an explanation."
          >
            {(id, helpId) => (
              <div
                className="settings-study-radio-list"
                role="radiogroup"
                aria-labelledby={`${id}-label`}
                aria-describedby={helpId}
              >
                {[
                  ["New tab", "Keep the task open while you work."],
                  ["Preview window", "Take a quick look without leaving the board."],
                ].map(([value, detail], index) => (
                  <label key={value}>
                    <input
                      id={index === 0 ? id : undefined}
                      type="radio"
                      name={id}
                      checked={mode === value}
                      onChange={() => setMode(value)}
                    />
                    <span>
                      <b>{value}</b>
                      <small>{detail}</small>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </Row>
          <Row
            state="checkbox"
            label="Include in export"
            description="Checkboxes select multiple items for an action, independently."
          >
            {(id, helpId) => (
              <div
                className="settings-study-checks"
                role="group"
                aria-labelledby={`${id}-label`}
                aria-describedby={helpId}
              >
                <label>
                  <input id={id} type="checkbox" defaultChecked /> Notes
                </label>
                <label>
                  <input type="checkbox" defaultChecked /> Attachments
                </label>
              </div>
            )}
          </Row>
          <Row
            state="shortcut"
            label="Command palette"
            description="Click to record. Escape cancels; Tab leaves the control. Conflicts belong inline."
          >
            {(id, helpId) => <ShortcutField id={id} helpId={helpId} />}
          </Row>
        </Group>
        <Group title="Availability & feedback">
          <Row
            state="disabled"
            label="Sync interval"
            description="Connect a repository to enable automatic sync. Explain unavailable controls."
          >
            {(id, helpId) => (
              <select id={id} className="settings-study-field" disabled aria-describedby={helpId}>
                <option>Every 5 minutes</option>
              </select>
            )}
          </Row>
          <Row
            state="read-only"
            label="Workspace location"
            description="Read-only values stay selectable, with the same alignment as editable fields."
          >
            {(id, helpId) => <Input id={id} readOnly value="~/Documents/Notes" aria-describedby={helpId} />}
          </Row>
          <Row
            state="feedback"
            label="Save feedback"
            description="Use text as well as color. A failed save preserves the draft and offers a retry."
          >
            {() => (
              <div className="settings-study-feedback">
                <span>◌ Saving…</span>
                <span>✓ Saved</span>
                <span className="settings-study-error">Couldn’t save. Try again.</span>
                <small>State examples</small>
              </div>
            )}
          </Row>
          <Row
            state="destructive-action"
            label="Reset appearance"
            description="Name the scope before confirming a reset. Keep destructive actions visually secondary."
          >
            {() => (
              <div className="settings-study-form">
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="outline">Reset appearance…</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Reset appearance?</DialogTitle>
                      <DialogDescription>
                        This resets the preview’s theme, sidebar position, window controls, zoom, and spacing to their
                        defaults.
                      </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                      <DialogClose asChild>
                        <Button variant="outline">Cancel</Button>
                      </DialogClose>
                      <DialogClose asChild>
                        <Button
                          onClick={() => {
                            setTheme("System");
                            setPlacement("Left");
                            setControls(true);
                            setZoom(100);
                            setSpacing(24);
                            setResetMessage("Appearance defaults restored in this preview.");
                          }}
                        >
                          Reset appearance
                        </Button>
                      </DialogClose>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                <p role="status">{resetMessage}</p>
              </div>
            )}
          </Row>
        </Group>
      </div>

      <div className="settings-study-rules" data-design-component="settings" data-design-state="interaction-contract">
        <h4>One interaction contract</h4>
        <p>
          <b>Hover</b> gently changes the control surface. <b>Pressed</b> deepens it. <b>Selected</b> stays visible
          after focus moves. <b>Keyboard focus</b> adds a separate ring.
        </p>
        <p>
          Simple preferences apply on selection. Text forms show Save and Cancel. Errors stay beside the field. Disabled
          controls always explain why. No success toast for routine changes.
        </p>
        <p>
          Tab moves between controls; arrows move through choices and values; Space toggles; Escape cancels a draft or
          closes a picker. Reduced motion removes transitions. Use the board’s theme buttons to inspect both themes.
        </p>
      </div>
    </div>
  );
}

function SettingsSearch({ id, helpId }: { id: string; helpId: string }) {
  const [query, setQuery] = useState("");
  const items = ["Color theme", "Sidebar position", "Interface zoom", "Editor font"];
  const matches = items.filter((item) => item.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="settings-study-form">
      <div className="settings-study-search">
        <IconSearch size={14} aria-hidden="true" />
        <Input
          id={id}
          type="search"
          inset="leadingIcon"
          aria-describedby={helpId}
          placeholder="Search settings…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <p role="status">
        {query ? (matches.length ? matches.join(" · ") : "No matching settings. Try “theme”.") : "4 example settings"}
      </p>
    </div>
  );
}
