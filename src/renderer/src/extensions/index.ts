import { BlockQuoteExtension } from "./BlockQuoteExtension";
import { CodeBlockExtension } from "./CodeBlockExtension";
import { EmphasisExtension } from "./EmphasisExtension";
import { FrontmatterExtension } from "./FrontmatterExtension";
import { HeadingExtension } from "./HeadingExtension";
import { HorizontalRuleExtension } from "./HorizontalRuleExtension";
import { ImageExtension } from "./ImageExtension";
import { ListsExtension } from "./ListsExtension";
import { MathBlockExtension } from "./MathExpression";
import { TableExtension } from "./TableExtension";
import { MarkdocTableExtension } from "./TableMarkdocExtension";

export const DefaultExtensions = [
    BlockQuoteExtension,
    CodeBlockExtension,
    EmphasisExtension,
    ImageExtension,
    FrontmatterExtension,
    HeadingExtension,
    HorizontalRuleExtension,
    ListsExtension,
    TableExtension,
    MarkdocTableExtension,
    MathBlockExtension,
]
