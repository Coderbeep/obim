import { IconSortDown, IconSortUp } from "@pierre/icons";
import { useAtom } from "jotai";

import { explorerSortAtom } from "@renderer/store/explorerSortStore";
import { IconButton } from "@renderer/shared/ui/IconButton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@renderer/shared/ui/dropdown-menu";

export const ExplorerSortMenu = () => {
  const [preference, setPreference] = useAtom(explorerSortAtom);
  const byLabel = preference.by === "type" ? "Type, then name" : "Name";
  const directionLabel = preference.direction === "ascending" ? "A to Z" : "Z to A";

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <IconButton
          className="file-explorer-toolbar-action"
          icon={preference.direction === "ascending" ? IconSortDown : IconSortUp}
          label="Sort files"
          title={`Sort files: ${byLabel}, ${directionLabel}`}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="file-explorer-sort-menu">
        <DropdownMenuLabel>Sort by</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          aria-label="Sort by"
          value={preference.by}
          onValueChange={(by) => {
            if (by === "name" || by === "type") setPreference((current) => ({ ...current, by }));
          }}
        >
          <DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="type">Type, then name</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Order</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          aria-label="Sort order"
          value={preference.direction}
          onValueChange={(direction) => {
            if (direction === "ascending" || direction === "descending") {
              setPreference((current) => ({ ...current, direction }));
            }
          }}
        >
          <DropdownMenuRadioItem value="ascending">A to Z</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="descending">Z to A</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
