import { canLinkToSections, SECTION_LINK_FILENAME_MESSAGE } from "@shared/section-links";
import { IconArrowUpRight, IconChevron, IconFileText, IconImage, IconLink } from "@pierre/icons";
import { useEffect, useRef, useState } from "react";
import { useFileOpen } from "@renderer/features/files/fileActions";
import { Button } from "@renderer/shared/ui/button";
import { focusActiveEditorLine } from "./DocumentOutline";
import { EditorView } from "../codemirror-view";
import { navigateToHeading } from "../headingNavigation";
import type { MarkdownLink } from "./documentInfo";

function WebsiteThumbnail({ url, label }: { url: string; label: string }) {
  const [image, setImage] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "failed" | "loaded">("idle");
  const pending = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (pending.current) void window.api.cancelWebsitePreview(pending.current);
      pending.current = null;
    },
    [url],
  );
  const load = async () => {
    if (pending.current) return;
    const requestId = crypto.randomUUID();
    pending.current = requestId;
    setStatus("loading");
    try {
      const preview = await window.api.getWebsitePreview(url, { userInitiated: true, requestId });
      if (pending.current !== requestId) return;
      const safeImage = preview?.imageDataUrl;
      if (
        safeImage &&
        /^data:image\/(?:png|jpeg|webp|gif|x-icon|vnd\.microsoft\.icon);base64,[a-zA-Z0-9+/=]+$/.test(safeImage)
      ) {
        setImage(safeImage);
        setStatus("loaded");
      } else setStatus("failed");
    } catch {
      if (pending.current === requestId) setStatus("failed");
    } finally {
      if (pending.current === requestId) pending.current = null;
    }
  };
  return (
    <button
      type="button"
      aria-label={`${status === "failed" ? "Retry" : "Load"} preview for ${label}`}
      title={status === "failed" ? "Preview unavailable. Click to retry." : "Load preview (contacts this website)"}
      disabled={status === "loading" || status === "loaded"}
      className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-control)] bg-[var(--surface-2)] text-muted-foreground focus-visible:ring-1 focus-visible:ring-[var(--focus-ring)]"
      onClick={() => void load()}
    >
      {image ? (
        <img
          src={image}
          alt=""
          className="size-8 object-cover"
          onError={() => {
            setImage(null);
            setStatus("failed");
          }}
        />
      ) : (
        <IconLink size={18} />
      )}
    </button>
  );
}

export function NoteLinks({ links, sourcePath }: { links: readonly MarkdownLink[]; sourcePath: string }) {
  const { openLinkedFile } = useFileOpen();
  const [error, setError] = useState<string | null>(null);
  const open = async (link: MarkdownLink) => {
    setError(null);
    const destination = link.destination.startsWith("//") ? `https:${link.destination}` : link.destination;
    try {
      if (/^(https?:|mailto:|tel:)/i.test(destination)) {
        const result = await window.api.openExternalLink(destination);
        if (!result.success) setError("Could not open this link.");
      } else if (/^[a-z][a-z\d+.-]*:/i.test(destination)) {
        setError("This link type cannot be opened from the sidebar.");
      } else if (destination.startsWith("#")) {
        if (!canLinkToSections(sourcePath)) {
          setError(SECTION_LINK_FILENAME_MESSAGE);
          return;
        }
        const element = document.querySelector<HTMLElement>(".pane-card-active .cm-editor");
        const view = element ? EditorView.findFromDOM(element) : null;
        if (!view || !navigateToHeading(view, destination)) setError("Section not found in this note.");
      } else {
        await openLinkedFile(destination, sourcePath);
      }
    } catch {
      setError("Could not open this link.");
    }
  };
  return links.length ? (
    <>
      <ol className="space-y-0.5">
        {links.map((link) => {
          const url = link.destination.startsWith("//") ? `https:${link.destination}` : link.destination;
          const hasWebsiteThumbnail = link.kind === "external" && /^https?:\/\//i.test(url);
          return (
            <li
              key={`${sourcePath}:${link.line}:${link.destination}:${link.text}`}
              className="flex min-w-0 items-center gap-1"
            >
              {hasWebsiteThumbnail && (
                <WebsiteThumbnail key={url} url={url} label={link.text || link.destination} />
              )}
              <button
                type="button"
                className={`grid min-w-0 flex-1 gap-x-2 rounded-md px-1.5 py-1 text-left hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--focus-ring)] ${hasWebsiteThumbnail ? "grid-cols-1" : "grid-cols-[2rem_minmax(0,1fr)]"}`}
                title={`${link.destination} (line ${link.line})`}
                onClick={() => focusActiveEditorLine(link.line)}
              >
                {!hasWebsiteThumbnail && (
                  <span className="row-span-2 flex size-8 items-center justify-center self-center overflow-hidden rounded-[var(--radius-control)] bg-[var(--surface-2)] text-muted-foreground">
                    {link.kind === "image" ? (
                      <IconImage size={18} />
                    ) : link.kind === "note" ? (
                      <IconFileText size={18} />
                    ) : (
                      <IconLink size={18} />
                    )}
                  </span>
                )}
                <span className="min-w-0 truncate text-ui-body text-foreground">{link.text || link.destination}</span>
                <span className="min-w-0 truncate text-ui-meta text-muted-foreground">{link.destination}</span>
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="shrink-0"
                aria-label={`Open ${link.text || link.destination}`}
                title={`Open ${link.destination}`}
                onClick={() => void open(link)}
              >
                {/^[a-z][a-z\d+.-]*:/i.test(url) ? (
                  <IconArrowUpRight size={16} />
                ) : (
                  <IconChevron size={16} className="-rotate-90" />
                )}
              </Button>
            </li>
          );
        })}
      </ol>
      {error && (
        <p role="alert" className="px-1.5 text-ui-meta text-destructive">
          {error}
        </p>
      )}
    </>
  ) : (
    <div className="px-1.5 text-ui-body text-muted-foreground">No links in this note</div>
  );
}
