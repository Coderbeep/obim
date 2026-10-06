import assert from "node:assert/strict";

import { IconCalendar, IconFlag, IconTag } from "@pierre/icons";
import { describe, test } from "vitest";

import {
  fieldTypes,
  fieldTypeLabel,
  initialFieldValue,
} from "../src/renderer/src/features/editor/note-details/fields/fieldTypes";
import { getFieldOptions } from "../src/renderer/src/features/editor/note-details/fields/fieldOptions";
import {
  predefinedField,
  predefinedFields,
} from "../src/renderer/src/features/editor/note-details/fields/predefinedFields";
import { filterValueSuggestions } from "../src/renderer/src/features/editor/note-details/valueSuggestions";
import { deriveExactNoteType } from "../src/renderer/src/features/editor/extensions/noteType";
import { parseFrontmatter } from "../src/shared/frontmatter";
import type { SupportedFrontmatterFieldType } from "../src/shared/frontmatter-fields";

const properties = (body: string) => {
  const parsed = parseFrontmatter(`---\n${body}\n---\n`);
  assert.equal(parsed.kind, "valid");
  return parsed.kind === "valid" ? parsed.properties : [];
};

const workspaceField = (key: string, type: SupportedFrontmatterFieldType) => ({ key, type });

describe("exact note type", () => {
  test("recognizes only the exact Task value and falls back to Note for every other value", () => {
    assert.deepEqual(deriveExactNoteType([]), { kind: "note" });
    for (const body of ["type: task", "type: task # keep", "type: |-\n  task"]) {
      assert.equal(deriveExactNoteType(properties(body)).kind, "task", body);
    }

    for (const body of [
      "Type: task",
      "type: note",
      "type: journal",
      "type: Task",
      "type: journal # keep",
      "type: [journal]",
      "type: 1",
    ]) {
      assert.equal(deriveExactNoteType(properties(body)).kind, "note", body);
    }
    assert.equal(deriveExactNoteType(properties("type: clipped-note")).kind, "note");
  });
});

describe("field creation policy", () => {
  test("uses a closed definition record for supported semantic types", () => {
    assert.deepEqual(Object.keys(fieldTypes).sort(), ["boolean", "date", "datetime", "list", "number", "text"]);
    assert.deepEqual(
      Object.fromEntries(Object.entries(fieldTypes).map(([key, definition]) => [key, definition.label])),
      {
        text: "Text",
        number: "Number",
        boolean: "Checkbox",
        list: "List",
        date: "Date",
        datetime: "Date & time",
      },
    );
    assert.deepEqual((["text", "number", "boolean", "list", "date", "datetime"] as const).map(fieldTypeLabel), [
      "Text",
      "Number",
      "Checkbox",
      "List",
      "Date",
      "Date & time",
    ]);
    assert.equal(initialFieldValue("text"), "");
    assert.equal(initialFieldValue("number"), 0);
    assert.equal(initialFieldValue("boolean"), false);
    assert.deepEqual(initialFieldValue("list"), []);
    assert.equal(
      (initialFieldValue("date", new Date("2026-08-03T15:00:00.000Z")) as Date).toISOString(),
      "2026-08-03T00:00:00.000Z",
    );
    assert.equal(
      (initialFieldValue("datetime", new Date("2026-08-03T15:00:00.000Z")) as Date).toISOString(),
      "2026-08-03T15:00:00.000Z",
    );
  });

  test("keeps predefined field behavior exact", () => {
    assert.deepEqual(predefinedFields.tags, {
      requiredType: "list",
      hiddenFromDetails: false,
      icon: IconTag,
    });
    assert.deepEqual(predefinedFields["task-due"], {
      requiredType: "date",
      hiddenFromDetails: false,
      icon: IconCalendar,
    });
    assert.equal(predefinedFields["task-priority"].requiredType, "text");
    assert.equal(predefinedFields["task-priority"].icon, IconFlag);
    assert.deepEqual(predefinedFields["task-priority"].allowedTextValues, ["high", "medium", "low"]);
    assert.equal(predefinedFields["task-priority"].normalizeTextValue(" High "), "high");
    const taskProject = predefinedFields["task-project"];
    assert.equal(taskProject.requiredType, "text");
    assert.equal(taskProject.hiddenFromDetails, false);
    assert.equal("icon" in taskProject, false);
    assert.equal(taskProject.normalizeTextValue("  Research  "), "Research");
    assert.equal(taskProject.removeWhenTextValue?.("Inbox"), false);
    assert.deepEqual(predefinedFields.type, {
      requiredType: null,
      hiddenFromDetails: true,
    });
    assert.equal(predefinedField("Tags"), null);
  });
});

describe("field options", () => {
  const workspaceFields = [workspaceField("author", "text"), workspaceField("project", "text")];

  test("merges visible workspace and built-in fields while excluding occupied names", () => {
    const options = getFieldOptions({
      properties: properties("author: Ada"),
      workspaceFields,
    });

    assert.deepEqual(
      options.map(({ key, type }) => [key, type]),
      [
        ["project", "text"],
        ["tags", "list"],
        ["task-due", "date"],
        ["task-priority", "text"],
        ["task-project", "text"],
      ],
    );
  });

  test("keeps the renamed field available and enforces built-in types", () => {
    const options = getFieldOptions({
      currentKey: "author",
      properties: properties("author: Ada"),
      workspaceFields: [
        workspaceField("author", "list"),
        workspaceField("tags", "text"),
        workspaceField("task-project", "list"),
        workspaceField("type", "text"),
      ],
    });

    assert.deepEqual(
      options.map(({ key, type }) => [key, type]),
      [
        ["author", "list"],
        ["tags", "list"],
        ["task-project", "text"],
        ["task-due", "date"],
        ["task-priority", "text"],
      ],
    );
  });
});

describe("value suggestion policy", () => {
  test("filters query text, excludes existing values, and detects exact matches", () => {
    assert.deepEqual(
      filterValueSuggestions({
        suggestions: ["Ada", "Grace", "Research"],
        query: "ra",
      }),
      { visibleSuggestions: ["Grace"], exactMatch: false },
    );
    assert.deepEqual(
      filterValueSuggestions({
        suggestions: ["Ada", "Grace", "Research"],
        excluded: ["grace"],
        query: "Grace",
      }),
      { visibleSuggestions: [], exactMatch: true },
    );
    assert.deepEqual(
      filterValueSuggestions({
        suggestions: ["Ada", "Grace"],
        query: "  ada ",
      }),
      { visibleSuggestions: ["Ada"], exactMatch: true },
    );
    assert.equal(filterValueSuggestions({ suggestions: [], query: "New" }).exactMatch, false);
  });
});
