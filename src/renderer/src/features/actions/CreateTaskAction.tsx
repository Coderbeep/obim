import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@renderer/shared/ui/dialog";
import { Button } from "@renderer/shared/ui/button";
import { TaskBoardTaskEditor } from "@renderer/features/task-board/TaskBoardTaskEditor";
import { createDraftTaskState } from "@renderer/features/task-board/taskBoardModel";
import { useTaskBoard } from "@renderer/features/task-board/useTaskBoard";
import { useTaskEditorDraft } from "@renderer/features/task-board/TaskBoardTaskEditor";

export const CreateTaskAction = ({ onClose }: { onClose: () => void }) => {
  const board = useTaskBoard();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [draft, setDraft] = useTaskEditorDraft();
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    setDraft(createDraftTaskState());
  }, [setDraft]);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="w-[min(30rem,calc(100vw-2rem))] gap-3 p-4" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
        </DialogHeader>
        {board.layoutError ? (
          <div role="alert" className="space-y-2 text-ui-control">
            <p>{board.layoutError}</p>
            <Button variant="outline" onClick={() => void board.revealLayoutFile()}>
              Reveal configuration file
            </Button>
            <Button variant="outline" onClick={() => void board.refresh()}>
              Reload layout
            </Button>
          </div>
        ) : null}
        {board.hasLoaded && draft ? (
          <TaskBoardTaskEditor
            draft={draft}
            showProjectChooser
            loadTags={board.taskActions.loadTags}
            projects={board.projects}
            onSubmit={async (input) => {
              setSaveError(null);
              try {
                const success = await board.taskActions.createTask(input);
                if (!success) setSaveError("Could not create the task. Your draft is still here; try again.");
                return success;
              } catch {
                setSaveError("Could not create the task. Your draft is still here; try again.");
                return false;
              }
            }}
            setDraft={(update) => {
              setDraft(update);
              if (update === null) onClose();
            }}
          />
        ) : board.error ? (
          <div className="space-y-2">
            <p role="alert" className="text-ui-control text-destructive">
              {board.error}
            </p>
            <Button variant="outline" onClick={() => void board.refresh()}>
              Try again
            </Button>
          </div>
        ) : (
          <p role="status" className="text-ui-control text-muted-foreground">
            Loading tasks…
          </p>
        )}
        {saveError ? (
          <p role="alert" className="text-ui-meta text-destructive">
            {saveError}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
};
