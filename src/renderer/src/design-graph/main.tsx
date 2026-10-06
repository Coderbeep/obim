import ReactDOM from "react-dom/client";

import { FileGlyphSprite } from "../shared/icons/FileGlyphs";
import "../styles/index.css";
import DesignGraph from "./DesignGraph";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <>
    <FileGlyphSprite />
    <DesignGraph />
  </>,
);
