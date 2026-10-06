import { useAtomValue } from "jotai";
import { workspaceTransitionAtom } from "@renderer/store/workspaceTransitionStore";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@renderer/shared/ui/dialog";
import { Button } from "@renderer/shared/ui/button";

export const WorkspaceTransitionStatus = () => {
  const transition = useAtomValue(workspaceTransitionAtom);
  return (
    <Dialog open={Boolean(transition)}>
      <DialogContent
        className="max-w-sm [&>button]:hidden"
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          transition?.cancel();
        }}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogTitle>{transition?.label}</DialogTitle>
        <DialogDescription role="status">
          {transition?.phase === "preparing"
            ? "Finishing pending operations and saving your edits. Editing will resume when this operation finishes."
            : "Finishing the workspace operation. If a folder chooser is open, you can cancel there."}
        </DialogDescription>
        {transition?.phase === "preparing" ? <Button onClick={transition.cancel}>Cancel</Button> : null}
      </DialogContent>
    </Dialog>
  );
};
