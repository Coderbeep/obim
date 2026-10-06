import assert from "node:assert/strict";
import { test } from "vitest";
import { completedGitSyncOutcome, sanitizeGitSyncError } from "../src/main/git-sync-outcome";

test("remote diagnostics never retain synthetic URL credentials, tokens, or bearer secrets", () => {
  const sanitized = sanitizeGitSyncError(
    "Authentication failed https://alice:supersecret@host.invalid/private?token=querysecret token=inline-secret Bearer auth-secret password='password-secret'",
  );
  for (const secret of ["alice", "supersecret", "querysecret", "inline-secret", "auth-secret", "password-secret"])
    assert.equal(sanitized.includes(secret), false);
  assert.match(sanitized, /Authentication failed/);
});

test("a clean local commit and failed upload remain distinct until a successful retry", () => {
  const failed = completedGitSyncOutcome({
    before: { localRevision: "a".repeat(40), uncommittedChanges: true },
    after: { localRevision: "b".repeat(40), uncommittedChanges: false },
    source: "scheduled",
    workspacePath: "/notes-A",
    startedAt: 1,
    error: "push authentication failed",
    localCommitCreated: true,
  });
  assert.equal(failed.phase, "failed");
  assert.equal(failed.localCommitCreated, true);
  assert.equal(failed.uncommittedChanges, false);
  assert.equal(failed.uploadedRevision, undefined);
  assert.equal(failed.failureCount, 1);
  const success = completedGitSyncOutcome({
    previous: failed,
    before: { localRevision: "b".repeat(40), uncommittedChanges: false },
    after: { localRevision: "b".repeat(40), uncommittedChanges: true },
    source: "manual",
    workspacePath: "/notes-A",
    startedAt: 2,
    uploadedRevision: "b".repeat(40),
  });
  assert.equal(success.phase, "succeeded");
  assert.equal(success.error, undefined);
  assert.equal(success.failureCount, 0);
  assert.equal(success.uploadedRevision, "b".repeat(40));
  assert.equal(success.uncommittedChanges, true);
});

test("an external HEAD change does not claim the sync created a local commit or uploaded that revision", () => {
  const result = completedGitSyncOutcome({
    before: { localRevision: "a".repeat(40), uncommittedChanges: false },
    after: { localRevision: "b".repeat(40), uncommittedChanges: false },
    source: "manual",
    workspacePath: "/notes",
    startedAt: 1,
    uploadedRevision: "a".repeat(40),
  });
  assert.equal(result.localCommitCreated, false);
  assert.notEqual(result.localRevision, result.uploadedRevision);
});
