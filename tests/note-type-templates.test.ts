import assert from "node:assert/strict";

import { describe, test } from "vitest";

import {
  TASK_NOTE_FIELD_KEYS,
  TASK_NOTE_PRIORITIES,
  TASK_NOTE_STAGES,
  TASK_NOTE_STATUSES,
  TASK_NOTE_TEMPLATE,
  instantiateTaskNoteFrontmatter,
  taskNoteFieldTemplate,
} from "../src/shared/note-type-templates";

describe("Task note template", () => {
  test("lists every canonical field exactly once", () => {
    const keys = TASK_NOTE_TEMPLATE.fields.map(({ key }) => key);

    assert.deepEqual(keys, Object.values(TASK_NOTE_FIELD_KEYS));
    assert.equal(new Set(keys).size, keys.length);
    for (const field of TASK_NOTE_TEMPLATE.fields) {
      assert.equal(taskNoteFieldTemplate(field.key), field);
    }
    assert.equal(taskNoteFieldTemplate("unknown"), undefined);
  });

  test("keeps workflow value sets on the fields that own them", () => {
    assert.deepEqual(taskNoteFieldTemplate(TASK_NOTE_FIELD_KEYS.stage)?.allowedValues, TASK_NOTE_STAGES);
    assert.deepEqual(taskNoteFieldTemplate(TASK_NOTE_FIELD_KEYS.status)?.allowedValues, TASK_NOTE_STATUSES);
    assert.deepEqual(taskNoteFieldTemplate(TASK_NOTE_FIELD_KEYS.priority)?.allowedValues, TASK_NOTE_PRIORITIES);
  });

  test("materializes the one required creation sequence", () => {
    const fields = instantiateTaskNoteFrontmatter({ today: "2026-09-25" });

    assert.deepEqual(
      fields.map(({ key }) => key),
      [TASK_NOTE_FIELD_KEYS.type, TASK_NOTE_FIELD_KEYS.status, TASK_NOTE_FIELD_KEYS.created],
    );
    assert.equal(fields[0]?.value, "task");
    assert.equal(fields[1]?.value, "open");
    assert.equal((fields[2]?.value as Date).toISOString(), "2026-09-25T00:00:00.000Z");
    assert.throws(() => instantiateTaskNoteFrontmatter({ today: "25-09-2026" }), /YYYY-MM-DD/);
  });
});
