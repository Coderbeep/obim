import { IconPencil, IconSearch, IconTrash } from "@pierre/icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@renderer/shared/ui/button";
import { Input } from "@renderer/shared/ui/input";
import { saveKeyboardShortcuts, useKeyboardShortcuts } from "@renderer/shared/keyboardShortcuts";
import {
  SHORTCUT_COMMANDS,
  shortcutBindings,
  shortcutBindingError,
  shortcutFromEvent,
  shortcutLabel,
  type ShortcutCommandId,
  type ShortcutOverrides,
} from "@shared/keyboard-shortcuts";
import "./KeyboardShortcutSettings.css";

type Recording = { id: ShortcutCommandId; index: number | null };
export const KeyboardShortcutSettings = () => {
  const overrides = useKeyboardShortcuts();
  const [query, setQuery] = useState("");
  const [recording, setRecording] = useState<Recording | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const captureRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<string | null>(null);
  const isMac = Boolean(window.config?.isMacOS);

  const persist = useCallback(async (next: ShortcutOverrides) => {
    setSaving(true);
    setError(null);
    try {
      await saveKeyboardShortcuts(next);
      setRecording(null);
    } catch {
      setError("Could not save your shortcuts. Your previous bindings are still active. Please try again.");
    } finally {
      setSaving(false);
    }
  }, []);

  useEffect(() => {
    if (!recording) return;
    const { id, index } = recording;
    let committed = false;
    window.config.setShortcutRecording?.(true);
    captureRef.current?.focus();
    const capture = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        setRecording(null);
        setError(null);
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "Escape") {
        returnFocusRef.current = `${id}:${index ?? "unassigned"}`;
        setRecording(null);
        setError(null);
        return;
      }
      if (committed || event.isComposing || event.repeat) return;
      const nextBinding = shortcutFromEvent(event, isMac);
      if (!nextBinding) return;
      const invalid = shortcutBindingError(nextBinding);
      if (invalid) {
        setError(invalid);
        return;
      }
      const owner = SHORTCUT_COMMANDS.find(
        (command) => command.id !== id && shortcutBindings(command.id, overrides).includes(nextBinding),
      );
      if (owner) {
        setError(`Already assigned to “${owner.label}”. Remove that binding first or choose another combination.`);
        return;
      }
      const bindings = [...shortcutBindings(id, overrides)];
      if (bindings.some((value, bindingIndex) => value === nextBinding && bindingIndex !== index)) {
        setError("This command already has that shortcut.");
        return;
      }
      if (index === null) bindings.push(nextBinding);
      else bindings[index] = nextBinding;
      committed = true;
      returnFocusRef.current = `${id}:${index ?? 0}`;
      setRecording(null);
      void persist({ ...overrides, [id]: bindings });
    };
    const stop = () => {
      setRecording(null);
      setError(null);
    };
    window.addEventListener("keydown", capture, true);
    window.addEventListener("blur", stop);
    return () => {
      window.config.setShortcutRecording?.(false);
      window.removeEventListener("keydown", capture, true);
      window.removeEventListener("blur", stop);
    };
  }, [recording, isMac, overrides, persist]);

  useEffect(() => {
    if (recording || saving || !returnFocusRef.current) return;
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    document.querySelector<HTMLButtonElement>(`[data-shortcut-edit="${target}"]`)?.focus();
  }, [recording, saving, overrides]);

  const filtered = SHORTCUT_COMMANDS.filter((command) =>
    `${command.label} ${command.description} ${command.group} ${shortcutBindings(command.id, overrides)
      .map((binding) => `${binding} ${shortcutLabel(binding, isMac)}`)
      .join(" ")} ${shortcutBindings(command.id, overrides).length ? "" : "unassigned"}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  return (
    <div className="shortcut-settings">
      <div className="shortcut-settings-controls">
        <label className="shortcut-settings-search">
          <IconSearch size={18} aria-hidden="true" />
          <Input
            aria-label="Search shortcuts"
            placeholder="Search shortcuts"
            value={query}
            disabled={!!recording}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      <div className="shortcut-settings-toolbar">
        <p className="shortcut-settings-hint">Select a shortcut to edit it. Changes save automatically.</p>
        <Button
          variant="ghost"
          size="sm"
          disabled={saving || !!recording || !Object.keys(overrides).length}
          onClick={() => void persist({})}
        >
          Reset all to defaults
        </Button>
      </div>
      {error && !recording ? (
        <p className="shortcut-settings-error" role="alert">
          {error}
        </p>
      ) : null}
      {["Application", "Workspace", "Editor"].map((group) => {
        const commands = filtered.filter((command) => command.group === group);
        if (!commands.length) return null;
        return (
          <section className="shortcut-settings-group" key={group} aria-labelledby={`shortcut-group-${group}`}>
            <h3 id={`shortcut-group-${group}`}>{group}</h3>
            <div className="shortcut-settings-list">
              {commands.map((command) => {
                const bindings = shortcutBindings(command.id, overrides);
                const displayBindings: readonly (string | null)[] = bindings.length ? bindings : [null];
                return (
                  <section className="shortcut-settings-row" key={command.id} aria-label={command.label}>
                    <div className="shortcut-settings-identity">
                      <strong>{command.label}</strong>
                      <p>{command.description}</p>
                    </div>
                    <div className="shortcut-settings-bindings">
                      {displayBindings.map((binding, index) => {
                        const bindingIndex = binding === null ? null : index;
                        const isRecording = recording?.id === command.id && recording.index === bindingIndex;
                        return (
                          <div className="shortcut-settings-binding" data-recording={isRecording} key={index}>
                            <Button
                              ref={isRecording ? captureRef : undefined}
                              variant="ghost"
                              size="sm"
                              className="shortcut-settings-edit"
                              disabled={saving || (!!recording && !isRecording)}
                              data-shortcut-edit={`${command.id}:${bindingIndex ?? "unassigned"}`}
                              aria-label={
                                isRecording
                                  ? `Record shortcut for ${command.label}`
                                  : binding === null
                                    ? `Edit ${command.label} shortcut`
                                    : `Edit ${command.label} shortcut ${shortcutLabel(binding, isMac)}`
                              }
                              onClick={() => {
                                if (isRecording) return;
                                setError(null);
                                setRecording({ id: command.id, index: bindingIndex });
                              }}
                            >
                              <span className="shortcut-settings-current" aria-hidden={isRecording}>
                                {binding === null ? (
                                  <span className="shortcut-settings-unassigned">Unassigned</span>
                                ) : (
                                  <kbd>{shortcutLabel(binding, isMac)}</kbd>
                                )}
                                <IconPencil size={14} aria-hidden="true" />
                              </span>
                              <span className="shortcut-settings-prompt" aria-hidden={!isRecording}>
                                Press shortcut
                              </span>
                            </Button>
                            {binding !== null ? (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="shortcut-settings-remove"
                                disabled={saving || !!recording}
                                aria-hidden={isRecording}
                                tabIndex={isRecording ? -1 : 0}
                                aria-label={`Remove ${command.label} shortcut ${shortcutLabel(binding, isMac)}`}
                                onClick={() =>
                                  void persist({ ...overrides, [command.id]: bindings.filter((_, i) => i !== index) })
                                }
                              >
                                <IconTrash size={14} aria-hidden="true" />
                              </Button>
                            ) : null}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="shortcut-settings-cancel"
                              disabled={!isRecording}
                              aria-hidden={!isRecording}
                              tabIndex={isRecording ? 0 : -1}
                              onClick={() => {
                                returnFocusRef.current = `${command.id}:${bindingIndex ?? "unassigned"}`;
                                setRecording(null);
                                setError(null);
                              }}
                            >
                              Cancel
                            </Button>
                            {isRecording && error ? (
                              <span className="shortcut-settings-error" role="alert">
                                {error}
                              </span>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          </section>
        );
      })}
      {!filtered.length ? <p className="shortcut-settings-empty">No shortcuts match “{query}”.</p> : null}
      <p className="shortcut-settings-hint">
        Standard text editing and arrow-key navigation keep their built-in behavior.
      </p>
    </div>
  );
};
