import { countColumn, EditorState } from "@renderer/features/editor/codemirror-state";
import { syntaxTree } from "@codemirror/language";
import { Decoration, EditorView, WidgetType } from "@renderer/features/editor/codemirror-view";
import type { Range } from "@renderer/features/editor/codemirror-state";
import type { SyntaxNodeRef } from "@lezer/common";
import {
  childNode,
  createSyntaxDecorationPlugin,
  decorationSet,
  isSyntaxRangeActive,
  iterateVisibleSyntaxTree,
  visibleLineSpans,
} from "./shared/syntaxDecorationPlugin";

const TaskVisualMarkerColumns = 3;
const CheckedTaskContentDecoration = Decoration.mark({ class: "cm-task-list-content-checked" });
const TaskMarkerSyntaxDecoration = Decoration.mark({ class: "cm-formatting-task-marker" });

function animateCheckedTaskContent(view: EditorView, markerTo: number) {
  const line = view.state.doc.lineAt(Math.min(markerTo, view.state.doc.length));
  const afterTask = /^[ \t]*/.exec(view.state.doc.sliceString(markerTo, line.to))![0];
  const contentFrom = markerTo + afterTask.length;
  if (contentFrom >= line.to) return;

  const target = view.domAtPos(Math.min(contentFrom + 1, line.to)).node;
  const element = target instanceof Element ? target : target.parentElement;
  const content = element?.closest<HTMLElement>(".cm-task-list-content-checked");
  if (!content) return;

  content.classList.add("cm-task-list-content-checking");
  content.addEventListener("animationend", () => content.classList.remove("cm-task-list-content-checking"), {
    once: true,
  });
}

class BulletMarkerWidget extends WidgetType {
  toDOM() {
    const bullet = document.createElement("span");
    bullet.className = "cm-list-bullet";
    bullet.textContent = "•";
    bullet.ariaHidden = "true";
    return bullet;
  }

  eq() {
    return true;
  }
}

class TaskMarkerWidget extends WidgetType {
  constructor(
    private readonly checked: boolean,
    private readonly from: number,
    private readonly to: number,
  ) {
    super();
  }

  toDOM(view: EditorView) {
    const shell = document.createElement("span");
    shell.className = "cm-task-list-checkbox-shell";
    shell.dataset.from = String(this.from);
    shell.dataset.to = String(this.to);

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = this.checked;
    checkbox.className = "task-list-item-checkbox cm-task-list-checkbox";
    checkbox.dataset.task = this.checked ? "x" : " ";
    checkbox.ariaLabel = this.checked ? "Mark task incomplete" : "Mark task complete";

    const visual = document.createElement("span");
    visual.className = "cm-task-list-checkbox-visual";
    visual.ariaHidden = "true";
    visual.innerHTML = `
      <span class="cm-task-list-checkbox-halo"></span>
      <span class="cm-task-list-checkbox-face"></span>
      <svg class="cm-task-list-checkbox-check" viewBox="0 0 16 16" aria-hidden="true">
        <path d="m4.1 8.1 2.35 2.35 5.45-5.6" pathLength="1" />
      </svg>
    `;

    shell.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    shell.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    shell.addEventListener("click", (event) => {
      if (event.target !== checkbox) {
        event.preventDefault();
        checkbox.click();
      }
      event.stopPropagation();
    });
    shell.addEventListener("mouseleave", () => {
      if (shell.dataset.transition === "unchecking") delete shell.dataset.transition;
    });
    checkbox.addEventListener("change", () => {
      const transition = checkbox.checked ? "checking" : "unchecking";
      shell.dataset.transition = transition;
      window.setTimeout(() => {
        if (shell.dataset.transition === transition && (transition !== "unchecking" || !shell.matches(":hover"))) {
          delete shell.dataset.transition;
        }
      }, 360);

      view.dispatch({
        changes: {
          from: Number(shell.dataset.from),
          to: Number(shell.dataset.to),
          insert: checkbox.checked ? "[x]" : "[ ]",
        },
        userEvent: "input.task",
      });
      if (checkbox.checked) animateCheckedTaskContent(view, Number(shell.dataset.to));
      view.focus();
    });

    shell.append(checkbox, visual);
    return shell;
  }

  updateDOM(dom: HTMLElement) {
    if (!(dom instanceof HTMLSpanElement)) return false;

    const checkbox = dom.querySelector<HTMLInputElement>(".cm-task-list-checkbox");
    if (!checkbox) return false;

    dom.dataset.from = String(this.from);
    dom.dataset.to = String(this.to);
    checkbox.checked = this.checked;
    checkbox.dataset.task = this.checked ? "x" : " ";
    checkbox.ariaLabel = this.checked ? "Mark task incomplete" : "Mark task complete";
    return true;
  }

  eq(other: TaskMarkerWidget) {
    return this.checked === other.checked && this.from === other.from && this.to === other.to;
  }
}

function contentColumnInState(state: EditorState, node: SyntaxNodeRef) {
  const mark = childNode(node, "ListMark");
  if (!mark) return null;

  const line = state.doc.lineAt(mark.from);
  const afterMarkText = state.doc.sliceString(mark.to, line.to);
  const task = /^([ \t]*)\[[ xX]\]([ \t]*)/.exec(afterMarkText);
  if (task) {
    const contentOffset = mark.to - line.from + task[1].length + 3 + task[2].length;
    return countColumn(line.text, state.tabSize, contentOffset);
  }

  const afterMark = /^[ \t]*/.exec(afterMarkText)![0];
  return countColumn(line.text, state.tabSize, mark.to - line.from + afterMark.length);
}

function visualContentColumnInState(state: EditorState, node: SyntaxNodeRef) {
  const mark = childNode(node, "ListMark");
  if (!mark) return null;

  const line = state.doc.lineAt(mark.from);
  const afterMarkText = state.doc.sliceString(mark.to, line.to);
  if (/^[ \t]*\[[ xX]\][ \t]*/.test(afterMarkText)) {
    return countColumn(line.text, state.tabSize, mark.from - line.from) + TaskVisualMarkerColumns;
  }

  return contentColumnInState(state, node);
}

function addListItemLines(
  view: EditorView,
  node: SyntaxNodeRef,
  columnByLine: Map<number, number>,
  guidesByLine: Map<number, Set<string>>,
) {
  const column = visualContentColumnInState(view.state, node);
  if (column === null) return;

  const lineSpans = visibleLineSpans(view, node);
  if (lineSpans.length === 0) return;

  const mark = childNode(node, "ListMark")!;
  const markerLine = view.state.doc.lineAt(mark.from);
  const markerColumn = countColumn(markerLine.text, view.state.tabSize, mark.from - markerLine.from);
  const task = /^[ \t]*\[[ xX]\]/.test(view.state.doc.sliceString(mark.to, markerLine.to));
  const guide = task ? `calc(6px + ${markerColumn}ch + 0.49em) 0` : `calc(6px + ${markerColumn + 0.5}ch) 0`;

  for (const lines of lineSpans) {
    for (let line = lines.first; line.number <= lines.last.number; line = view.state.doc.line(line.number + 1)) {
      const continuation = line.number > markerLine.number && line.text.trim().length > 0;
      const leadingText = /^[ \t]*/.exec(line.text)![0];
      const leadingColumn = countColumn(leadingText, view.state.tabSize);
      // Only a direct continuation can be lazy for this item; nested items keep their own guide.
      let owner = continuation && leadingColumn < column
        ? syntaxTree(view.state).resolveInner(line.from + leadingText.length, 1)
        : null;
      while (owner && owner.name !== "ListItem") owner = owner.parent;
      const lazy = owner?.from === node.from && owner.to === node.to;
      const lineColumn = lazy ? leadingColumn : column;

      columnByLine.set(line.from, Math.max(columnByLine.get(line.from) ?? 0, lineColumn));
      if (line.number > markerLine.number && !lazy) {
        const guides = guidesByLine.get(line.from) ?? new Set<string>();
        guides.add(guide);
        guidesByLine.set(line.from, guides);
      }
      if (line.number === lines.last.number) break;
    }
  }
}

function listLineStyle(column: number, guides: readonly string[]) {
  const style = [`padding-left: calc(6px + ${column}ch)`, `text-indent: -${column}ch`];

  if (guides.length) {
    style.push(
      `background-image: ${guides
        .map(() => "linear-gradient(var(--cm-list-guide-color), var(--cm-list-guide-color))")
        .join(", ")}`,
      "background-repeat: no-repeat",
      `background-size: ${guides.map(() => "1px 100%").join(", ")}`,
      `background-position: ${guides.join(", ")}`,
    );
  }

  return style.join("; ");
}

export function buildListDecorations(view: EditorView) {
  const decorations: Range<Decoration>[] = [];
  const columnByLine = new Map<number, number>();
  const guidesByLine = new Map<number, Set<string>>();

  iterateVisibleSyntaxTree(view, (node) => {
    if (node.name === "ListItem") {
      addListItemLines(view, node, columnByLine, guidesByLine);

      const mark = childNode(node, "ListMark");
      if (
        mark &&
        !childNode(node, "Task") &&
        /^[-+*]$/.test(view.state.doc.sliceString(mark.from, mark.to)) &&
        /^\s/.test(view.state.doc.sliceString(mark.to, view.state.doc.lineAt(mark.to).to)) &&
        !/^\s*\[[ xX]\]/.test(view.state.doc.sliceString(mark.to, view.state.doc.lineAt(mark.to).to)) &&
        !isSyntaxRangeActive(view.state, mark.from, mark.to)
      ) {
        decorations.push(Decoration.replace({ widget: new BulletMarkerWidget() }).range(mark.from, mark.to));
      }
    }

    if (node.name === "TaskMarker") {
      const line = view.state.doc.lineAt(node.from);
      const beforeTask = view.state.doc.sliceString(line.from, node.from);
      const marker = /^(\s*(?:>\s*)*)(?:[-+*]|\d+[.)])\s+$/.exec(beforeTask);
      if (!marker) return;

      const checked = /[xX]/.test(view.state.doc.sliceString(node.from, node.to));
      const afterTask = /^[ \t]*/.exec(view.state.doc.sliceString(node.to, line.to))![0];
      if (!afterTask) return;

      const contentFrom = node.to + afterTask.length;
      const markerFrom = line.from + marker[1].length;
      if (isSyntaxRangeActive(view.state, markerFrom, node.to)) {
        decorations.push(TaskMarkerSyntaxDecoration.range(node.from, node.to));
        return;
      }

      decorations.push(
        Decoration.replace({
          widget: new TaskMarkerWidget(checked, node.from, node.to),
        }).range(markerFrom, node.to),
      );

      if (checked && contentFrom < line.to) {
        decorations.push(CheckedTaskContentDecoration.range(contentFrom, line.to));
      }
    }
  });

  for (const [lineStart, column] of [...columnByLine.entries()].sort(([a], [b]) => a - b)) {
    decorations.push(
      Decoration.line({
        class: "cm-list-line",
        attributes: { style: listLineStyle(column, [...(guidesByLine.get(lineStart) ?? [])]) },
      }).range(lineStart),
    );
  }

  return decorationSet(decorations);
}

export const ListsViewPlugin = createSyntaxDecorationPlugin(buildListDecorations);
