import { createTaskSpecimenActions } from "./taskSpecimenActions";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles/index.css";

import { TaskBoardTask } from "../features/task-board/TaskBoardTask";
import { TaskTagSelector } from "../features/task-board/TaskBoardTaskEditor";
const success = async () => true;
const tags = ["research", "interface", "reading", "performance", "A longer tag name that should remain readable"];
const Preview = () => {
  const [selected, setSelected] = useState(["research", "reading", "interface"]);
  return (
    <main className="min-h-screen bg-[var(--surface-1)] p-8 text-foreground">
      <h1 className="mb-6 text-xl font-semibold">Task tags</h1>
      <div className="w-[320px]">
        <TaskBoardTask
          item={{
            id: "preview",
            filename: "Review the task board",
            path: "/preview/Task.md",
            relativePath: "Task.md",
            isDirectory: false,
            mimeType: "text/markdown",
            title: "Review the task board",
            preview: "Make the interface easier to scan and use.",
            status: "open",
            metadataIssues: [],
            tags,
          }}
          projects={[]}
          taskActions={createTaskSpecimenActions({
            loadTags: async () => tags,
            cancelTask: success,
            completeTask: success,
            deleteTask: success,
            moveTask: success,
            openTask: () => {},
            reopenTask: success,
            updateTask: success,
          })}
        />
        <h2 className="mb-2 mt-8 text-ui-control text-muted-foreground">Choose tags</h2>
        <TaskTagSelector selected={selected} options={tags} onChange={setSelected} />
      </div>
    </main>
  );
};
createRoot(document.getElementById("root")!).render(<Preview />);
