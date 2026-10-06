import { useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { IconCalendar, IconGear, IconPlus, IconSearch } from "@pierre/icons";
import { Badge } from "@renderer/shared/ui/badge";
import { Button } from "@renderer/shared/ui/button";
import { IconButton } from "@renderer/shared/ui/IconButton";
import { SegmentedControl } from "@renderer/shared/ui/segmented-control";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@renderer/shared/ui/dialog";
import { NoteDetailsSummary } from "@renderer/features/editor/note-details/NoteDetailsSummary";
import { TaskBoardTaskEditor } from "@renderer/features/task-board/TaskBoardTaskEditor";
import { createDraftTaskState } from "@renderer/features/task-board/taskBoardModel";
import { type DraftTaskState } from "@renderer/features/task-board/taskBoardModel";
import { parseFrontmatter } from "@shared/frontmatter";
import "../styles/index.css";

import "./component-craft.css";

const parsed = parseFrontmatter("---\ntags: [research, interface, reading]\nstatus: Draft\nproject: Obim\n---\n");
const properties = parsed.kind === "valid" ? parsed.properties : [];
function PreviousPass({ number }: { number: string }) {
  switch (number) {
    case "01":
      return (
        <div className="before-segments">
          <span>Active</span>
          <span>Completed</span>
          <span>Cancelled</span>
        </div>
      );
    case "02":
      return (
        <div className="craft-row">
          <span className="before-chip">research</span>
          <span className="before-chip">14-09-2026</span>
          <span className="before-chip">Due today</span>
          <span className="before-chip">Unavailable</span>
        </div>
      );
    case "03":
      return (
        <div className="before-summary">
          research · interface +1 <span>Draft</span>
          <span>3 fields</span>
        </div>
      );
    case "04":
      return (
        <div className="craft-row before-icons">
          <IconSearch size={16} />
          <span>
            <IconGear size={16} />
          </span>
          <IconPlus size={16} />
        </div>
      );
    case "05":
      return (
        <div className="before-composer">
          <div>Compare the methods sections</div>
          <div className="before-metadata">
            <span>Tags⌄</span>
            <span>DD-MM-YYYY</span>
            <span className="before-wide">⚑ High ·  ⚑ Medium ·  ⚑ Low ·  None</span>
            <span className="before-wide">Research⌄</span>
          </div>
          <footer>
            Cancel <span>Add task ↵</span>
          </footer>
        </div>
      );
    case "06":
      return (
        <div className="before-sources">
          {["Attention and working memory", "Making sense of research notes", "Tools for reflective practice"].map(
            (title, i) => (
              <div key={title}>
                <strong>{title}</strong>
                <small>Sample source · {2026 - i}</small>
                <span>{i + 2} notes</span>
              </div>
            ),
          )}
        </div>
      );
    default:
      return (
        <div className="before-detail">
          <strong>Compare the methods sections</strong>
          <p>Research · example task</p>
          <hr />
          <p>Compare the sampling strategy, assumptions, and limitations in both papers.</p>
        </div>
      );
  }
}
function Specimen({
  number,
  title,
  description,
  children,
}: {
  number: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="craft-specimen">
      <header>
        <span>{number}</span>
        <h2>{title}</h2>
        <p>{description}</p>
      </header>
      <div className="craft-comparison">
        <div className="craft-before">
          <div className="craft-state-label">BEFORE · PREVIOUS PASS</div>
          <PreviousPass number={number} />
        </div>
        <div className="craft-sample">
          <div className="craft-state-label">AFTER · UPDATED COMPONENT</div>
          {children}
        </div>
      </div>
    </section>
  );
}
function Preview() {
  const [theme, setTheme] = useState("light");
  const [view, setView] = useState("active");
  const [pinned, setPinned] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<DraftTaskState | null>({
    ...createDraftTaskState("Research"),
    taskName: "Compare the methods sections",
  });
  const [created, setCreated] = useState("");
  const [filter, setFilter] = useState(true);
  return (
    <main className="craft-page">
      <header className="craft-heading">
        <div>
          <span className="craft-kicker">OBIM / COMPONENT STUDIES</span>
          <h1>A visible component redesign.</h1>
          <p>
            Before / after. The right side uses the updated app components; left-side examples recreate the previous
            pass.
          </p>
        </div>
        <SegmentedControl
          role="radiogroup"
          aria-label="Appearance"
          value={theme}
          onValueChange={(next) => {
            setTheme(next);
            document.documentElement.classList.toggle("dark", next === "dark");
          }}
          items={[
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </header>
      <div className="craft-grid">
        <Specimen
          number="01"
          title="Segmented controls"
          description="Rectangular tabs → pill selector with an explicit checkmark and larger hit areas."
        >
          <SegmentedControl
            role="radiogroup"
            aria-label="Task status"
            value={view}
            onValueChange={setView}
            items={[
              { value: "active", label: "Active" },
              { value: "completed", label: "Completed" },
              { value: "cancelled", label: "Cancelled", disabled: true },
            ]}
          />
          <p className="craft-caption" role="status">
            {view === "active" ? "Active tasks selected" : "Completed tasks selected"} · disabled option at right
          </p>
        </Specimen>
        <Specimen
          number="02"
          title="Metadata chips"
          description="Pills → compact rounded rectangles. Metadata reads as fields, rather than a collection of buttons."
        >
          <div className="craft-row">
            <Badge variant="category">research</Badge>
            <Badge variant="compact">
              <IconCalendar />
              14-09-2026
            </Badge>
            <Badge variant="warning">Due today</Badge>
            <Badge variant="disabled">Unavailable</Badge>
          </div>
          <div className="craft-row">
            <Badge asChild variant={filter ? "selected" : "interactive"}>
              <button type="button" aria-pressed={filter} onClick={() => setFilter(!filter)}>
                Reading {filter ? "×" : "+"}
              </button>
            </Badge>
            <span className="craft-caption">Toggle filter</span>
          </div>
        </Specimen>
        <Specimen
          number="03"
          title="Property summary"
          description="Inline text → individually contained tags and a distinct status field. Click to expand."
        >
          <div className="editor-comp craft-note">
            <button
              className="craft-summary"
              aria-expanded={expanded}
              aria-controls="craft-properties"
              onClick={() => setExpanded(!expanded)}
            >
              <NoteDetailsSummary id="craft-summary-label" expanded={expanded} properties={properties} warnings={[]} />
              <span aria-hidden="true">{expanded ? "−" : "+"}</span>
            </button>
            {expanded && (
              <dl id="craft-properties">
                <dt>Tags</dt>
                <dd>research, interface, reading</dd>
                <dt>Status</dt>
                <dd>Draft</dd>
                <dt>Project</dt>
                <dd>Obim</dd>
              </dl>
            )}
          </div>
        </Specimen>
        <Specimen
          number="04"
          title="Icon buttons"
          description="Bare glyphs → contained buttons. Selected controls get an accent boundary and clear pressed state."
        >
          <div className="craft-row">
            <IconButton icon={IconSearch} label="Search example" onClick={() => setPinned(false)} />
            <IconButton
              icon={IconGear}
              label="Toggle settings selection"
              aria-pressed={pinned}
              onClick={() => setPinned(!pinned)}
            />
            <IconButton icon={IconPlus} label="Unavailable action" disabled />
            <span className="craft-caption">Default / toggle / disabled</span>
          </div>
        </Specimen>
        <Specimen
          number="05"
          title="Quick task entry"
          description="Inset form → edge-to-edge composer. A larger title surface sits above a full-width metadata footer."
        >
          {draft ? (
            <TaskBoardTaskEditor
                showProjectChooser
              draft={draft}
              setDraft={setDraft}
              projects={[
                { name: "Research", colorId: "blue" },
                { name: "Writing", colorId: "green" },
              ]}
              loadTags={async () => ["research", "reading", "interface"]}
              onSubmit={async (task) => {
                setCreated(task.taskName);
                return true;
              }}
            />
          ) : (
            <div className="craft-created">
              <p role="status">{created ? `Preview task created: ${created}` : "Task entry closed"}</p>
              <Button
                variant="outline"
                onClick={() => {
                  setCreated("");
                  setDraft(createDraftTaskState("Research"));
                }}
              >
                New example task
              </Button>
            </div>
          )}
          <span className="craft-caption">Preview only · no workspace files are written</span>
        </Specimen>
        <Specimen
          number="06"
          title="Contextual detail"
          description="A quiet header, one separator, and shadow reserved for the floating surface."
        >
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">Open detail example</Button>
            </DialogTrigger>
            <DialogContent className="task-note-detail-window craft-detail" aria-describedby="craft-detail-description">
              <header>
                <DialogTitle>Compare the methods sections</DialogTitle>
                <DialogDescription id="craft-detail-description">Research · example task</DialogDescription>
              </header>
              <div className="craft-detail-body">
                <div className="craft-row">
                  <Badge variant="category">reading</Badge>
                  <Badge variant="warning">Due today</Badge>
                </div>
                <p>Compare the sampling strategy, assumptions, and limitations in both papers.</p>
                <label>
                  <input type="checkbox" /> Review the first paper
                </label>
                <label>
                  <input type="checkbox" /> Capture the differences
                </label>
              </div>
            </DialogContent>
          </Dialog>
        </Specimen>
      </div>
      <footer className="craft-footnote">
        Use Tab to inspect focus states. Hover and press controls to compare feedback. Sample content throughout.
      </footer>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
