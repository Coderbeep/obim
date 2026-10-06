import { createTaskSpecimenActions } from "./taskSpecimenActions";
import { createRoot } from "react-dom/client";

import "../styles/index.css";

import { AppDndProvider } from "../shared/dnd/AppDndProvider";
import { TaskBoardColumn } from "../features/task-board/TaskBoard";
import { deriveTaskBoardWorkflowColumns } from "../features/task-board/taskBoardModel";
import { type TaskBoardTask } from "../features/task-board/taskBoardModel";
import { useTaskBoardDnd } from "../features/task-board/useTaskBoard";

const project = "Research";
const projects = [{ name: project, colorId: "blue" }];
const task: TaskBoardTask = {
  id: "sample",
  title: "Sample task",
  filename: "Sample task.md",
  relativePath: "Sample task.md",
  path: "/fixture/Sample task.md",
  mimeType: "text/markdown",
  isDirectory: false,
  status: "open",
  metadataIssues: [],
  project,
  stage: "doing",
};
const success = async () => true;
const columns = deriveTaskBoardWorkflowColumns([task], project);

const Preview = () => {
  const dnd = useTaskBoardDnd({ tasks: [task], moveTask: success });
  return (
    <div className="flex h-screen flex-col gap-3 bg-[var(--surface-1)] p-4">
      <span className="text-ui-control">Isolated workflow layout fixture — no workspace writes</span>
      <div className="task-board-canvas min-h-0 w-full flex-1 overflow-auto">
        <div className="task-board-columns flex min-h-full min-w-full w-max items-stretch">
          {columns.map((column) => (
            <div key={column.stage} className="task-board-column-slot box-border flex min-h-0 flex-col self-stretch">
              <TaskBoardColumn
                column={column}
                project={project}
                projects={projects}
                dnd={dnd}
                addTask={success}
                onOpenManageProjects={() => undefined}
                taskCardProps={{
                  taskActions: createTaskSpecimenActions({
                    loadTags: async () => [],
                    completeTask: success,
                    cancelTask: success,
                    deleteTask: success,
                    moveTask: success,
                    openTask: () => undefined,
                    reopenTask: success,
                    updateTask: success,
                  }),
                  isMoving: false,
                }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

createRoot(document.getElementById("root")!).render(
  <AppDndProvider>
    <Preview />
  </AppDndProvider>,
);
