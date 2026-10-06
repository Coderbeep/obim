/**
 * Parses, inspects, and edits the fenced YAML frontmatter at the beginning of
 * an markdown document while preserving source ranges and newline style.
 */
import {
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  stringify,
  visit,
  type Node,
  type ParsedNode,
  type Scalar,
  type YAMLMap,
} from "yaml";

// Public model ----------------------------------------------------------------
export interface SourceRange {
  from: number;
  to: number;
}

export interface FrontmatterEnvelope {
  bodyRange: SourceRange;
  newline: "\n" | "\r\n" | "\r";
  range: SourceRange;
}

export interface FrontmatterDiagnostic {
  message: string;
  range?: SourceRange;
}

/** A supported frontmatter value decoded from YAML. */
export type FrontmatterValue =
  | { kind: "null"; value: null }
  | { kind: "string"; multiline?: boolean; value: string }
  | { kind: "number"; source: string; value: number }
  | { kind: "boolean"; value: boolean }
  | { dateOnly: boolean; kind: "date"; source: string; value: string }
  | { kind: "list"; value: readonly FrontmatterValue[] }
  | { kind: "unsupported"; reason: string };

/** One top-level property together with the ranges required for precise edits. */
export interface FrontmatterProperty {
  key: string;
  keyRange: SourceRange;
  range: SourceRange;
  value: FrontmatterValue;
  valueHasComments: boolean;
  valueRange: SourceRange;
}

/** Result of locating and parsing frontmatter in a complete document. */
export type FrontmatterResult =
  | { kind: "none" }
  | { kind: "invalid"; diagnostics: readonly FrontmatterDiagnostic[]; envelope?: FrontmatterEnvelope }
  | {
      kind: "valid";
      envelope: FrontmatterEnvelope;
      flow: boolean;
      managed: boolean;
      properties: readonly FrontmatterProperty[];
    };

/** Explicit timestamp input used when midnight must not collapse to a date-only YAML scalar. */
export type FrontmatterDatetimeInput = {
  kind: "datetime-input";
  value: Date;
};

/** Values accepted by the source-editing API. Nested objects are intentionally unsupported. */
export type FrontmatterInput =
  | null
  | string
  | number
  | boolean
  | Date
  | FrontmatterDatetimeInput
  | readonly FrontmatterInput[];

/** A requested source-level property operation. */
export type FrontmatterEdit =
  | { type: "insert" | "upsert"; key: string; value: FrontmatterInput }
  | { type: "rename"; key: string; newKey: string }
  | { type: "remove"; key: string };

/** A planned source replacement, or the reason it cannot be produced safely. */
export type FrontmatterEditResult =
  | { success: true; change: { from: number; insert: string; to: number } }
  | { success: false; error: string };

/** Complete source after applying an edit, or the planning error. */
export type FrontmatterSourceEditResult = { success: true; source: string } | { success: false; error: string };

// Frontmatter envelope detection ----------------------------------------------

type SourceLine = {
  contentEnd: number;
  end: number;
  newline: "\n" | "\r\n" | "\r" | null;
  start: number;
};

type FrontmatterEnvelopeScan =
  | { kind: "none" }
  | { kind: "unclosed"; openingRange: SourceRange }
  | { kind: "closed"; envelope: FrontmatterEnvelope };

const FRONTMATTER_FENCE_PATTERN = /^---[\t ]*$/;
const ALLOWED_YAML_TAGS = new Set([
  "tag:yaml.org,2002:null",
  "tag:yaml.org,2002:bool",
  "tag:yaml.org,2002:int",
  "tag:yaml.org,2002:float",
  "tag:yaml.org,2002:str",
  "tag:yaml.org,2002:seq",
  "tag:yaml.org,2002:map",
  "tag:yaml.org,2002:timestamp",
]);

/** Reports whether a complete line is a frontmatter opening or closing fence. */
export const isFrontmatterFence = (line: string) => FRONTMATTER_FENCE_PATTERN.test(line);

const readSourceLine = (source: string, start: number): SourceLine => {
  let contentEnd = start;
  while (contentEnd < source.length && source[contentEnd] !== "\n" && source[contentEnd] !== "\r") {
    contentEnd += 1;
  }

  if (contentEnd === source.length) return { start, contentEnd, end: contentEnd, newline: null };
  if (source[contentEnd] === "\r" && source[contentEnd + 1] === "\n") {
    return { start, contentEnd, end: contentEnd + 2, newline: "\r\n" };
  }
  const newline = source[contentEnd] as "\n" | "\r";
  return { start, contentEnd, end: contentEnd + 1, newline };
};

/**
 * Locates a frontmatter envelope only when its opening fence is the first line.
 */
const scanFrontmatterEnvelope = (source: string): FrontmatterEnvelopeScan => {
  const opening = readSourceLine(source, 0);
  if (!FRONTMATTER_FENCE_PATTERN.test(source.slice(opening.start, opening.contentEnd))) return { kind: "none" };

  const openingRange = { from: 0, to: opening.end };
  if (!opening.newline) return { kind: "unclosed", openingRange };

  let lineStart = opening.end;
  while (lineStart <= source.length) {
    const line = readSourceLine(source, lineStart);
    if (FRONTMATTER_FENCE_PATTERN.test(source.slice(line.start, line.contentEnd))) {
      return {
        kind: "closed",
        envelope: {
          range: { from: 0, to: line.end },
          bodyRange: { from: opening.end, to: line.start },
          newline: opening.newline,
        },
      };
    }
    if (!line.newline) break;
    lineStart = line.end;
  }

  return { kind: "unclosed", openingRange };
};

/** Returns the complete closed frontmatter envelope without parsing its YAML body. */
export const locateFrontmatter = (source: string): FrontmatterEnvelope | null => {
  const scan = scanFrontmatterEnvelope(source);
  return scan.kind === "closed" ? scan.envelope : null;
};

// YAML validation and decoding ------------------------------------------------

const toSourceRange = (range: readonly number[] | null | undefined, offset: number): SourceRange => ({
  from: offset + (range?.[0] ?? 0),
  to: offset + (range?.[1] ?? range?.[0] ?? 0),
});

const toDiagnosticRange = (position: readonly number[] | undefined, offset: number): SourceRange | undefined =>
  position ? { from: offset + position[0], to: offset + (position[1] ?? position[0]) } : undefined;

/** Finds valid YAML syntax that the structured editor cannot round-trip safely. */
const unsupportedNodeReason = (node: Node | null): string | null => {
  let reason: string | null = null;
  visit(node, {
    Alias() {
      reason = "YAML aliases are not editable as note details.";
      return visit.BREAK;
    },
    Node(_key, current) {
      if (isMap(current)) {
        reason = "Nested YAML objects are not editable as note details.";
        return visit.BREAK;
      }
      if (current.anchor) {
        reason = "YAML anchors are not editable as note details.";
        return visit.BREAK;
      }
      if (current.tag && !ALLOWED_YAML_TAGS.has(current.tag)) {
        reason = `YAML tag ${current.tag} is not editable as a note detail.`;
        return visit.BREAK;
      }
      return undefined;
    },
  });
  return reason;
};

const validCalendarDate = (source: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(source);
  if (!match || match[1] === "0000") return false;
  const date = new Date(`${source}T00:00:00.000Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === source;
};

const validIsoDatetime = (source: string) => {
  const match =
    /^(\d{4}-\d{2}-\d{2})[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:[Zz]|([+-])(\d{2})(?::?(\d{2}))?)?$/.exec(
      source,
    );
  if (!match || !validCalendarDate(match[1])) return false;
  const [, , hours, minutes, seconds = "0", , offsetHours = "0", offsetMinutes = "0"] = match;
  return (
    Number(hours) < 24 &&
    Number(minutes) < 60 &&
    Number(seconds) < 60 &&
    Number(offsetHours) < 24 &&
    Number(offsetMinutes) < 60
  );
};

/** Decodes a YAML scalar while retaining authored number and date text. */
const decodeScalarValue = (node: Scalar): FrontmatterValue => {
  if (node.value === null) return { kind: "null", value: null };
  if (node.value instanceof Date) {
    const source = node.source ?? node.value.toISOString();
    const dateOnly = validCalendarDate(source);
    if (!dateOnly && !validIsoDatetime(source)) {
      return { kind: "unsupported", reason: "This timestamp is not a valid ISO date or date-time." };
    }
    return {
      kind: "date",
      value: dateOnly ? source : node.value.toISOString(),
      dateOnly,
      source,
    };
  }
  if (typeof node.value === "boolean") return { kind: "boolean", value: node.value };
  if (typeof node.value === "number") {
    if (!Number.isFinite(node.value) || (Number.isInteger(node.value) && !Number.isSafeInteger(node.value))) {
      return { kind: "unsupported", reason: "This number cannot be edited without losing precision." };
    }
    return { kind: "number", source: node.source ?? String(node.value), value: node.value };
  }
  const value = String(node.value);
  const multiline =
    /[\r\n]/.test(value) ||
    node.source?.includes("\n") ||
    node.type === "BLOCK_FOLDED" ||
    node.type === "BLOCK_LITERAL";
  return { kind: "string", value, ...(multiline ? { multiline: true } : {}) };
};

/** Decodes YAML while retaining unsupported values for source-only frontmatter. */
const decodeFrontmatterValue = (node: ParsedNode | null): FrontmatterValue => {
  if (!node) return { kind: "null", value: null };
  const unsupported = unsupportedNodeReason(node);
  if (unsupported) return { kind: "unsupported", reason: unsupported };
  if (isScalar(node)) return decodeScalarValue(node);
  if (isSeq(node)) return { kind: "list", value: node.items.map((item) => decodeFrontmatterValue(item)) };
  return { kind: "unsupported", reason: "This YAML value is not editable as a note detail." };
};

/** True when the structured editor can read and write the value without changing its meaning. */
export const isManagedFrontmatterValue = (value: FrontmatterValue): boolean => {
  if (value.kind === "string") return !value.multiline;
  if (value.kind === "number" || value.kind === "boolean" || value.kind === "date") return true;
  if (value.kind === "list") return value.value.every((item) => item.kind === "string" && !item.multiline);
  return false;
};

/** Detects comments attached anywhere within a property value. */
const nodeHasComments = (node: ParsedNode | null): boolean => {
  let found = false;
  visit(node, {
    Node(_key, current) {
      if (!current.comment && !current.commentBefore) return;
      found = true;
      return visit.BREAK;
    },
  });
  return found;
};

const findLineStart = (source: string, position: number) => {
  let start = position;
  while (start > 0 && source[start - 1] !== "\n" && source[start - 1] !== "\r") start -= 1;
  return start;
};

const includeFollowingLineBreak = (source: string, position: number) => {
  if (source[position] === "\r" && source[position + 1] === "\n") return position + 2;
  if (source[position] === "\r" || source[position] === "\n") return position + 1;
  return position;
};

/** Converts a validated top-level YAML mapping into editable properties and source ranges. */
const parseFrontmatterProperties = (map: YAMLMap, body: string, offset: number): FrontmatterProperty[] =>
  map.items.map((pair) => {
    const keyNode = pair.key as Scalar;
    const valueNode = pair.value as ParsedNode | null;
    const key = String(keyNode.value);
    const keyRange = toSourceRange(keyNode.range, offset);
    const valueRange = toSourceRange(valueNode?.range ?? [keyNode.range?.[1] ?? 0, keyNode.range?.[1] ?? 0], offset);
    const relativeStart = findLineStart(body, keyNode.range?.[0] ?? 0);
    const nodeEnd = valueNode?.range?.[2] ?? keyNode.range?.[2] ?? keyNode.range?.[1] ?? relativeStart;
    const relativeEnd = includeFollowingLineBreak(body, nodeEnd);

    return {
      key,
      value: decodeFrontmatterValue(valueNode),
      valueHasComments: nodeHasComments(valueNode),
      keyRange,
      valueRange,
      range: { from: offset + relativeStart, to: offset + relativeEnd },
    };
  });

const parseYamlDocument = (body: string) =>
  parseDocument(body, {
    customTags: ["timestamp"],
    strict: true,
    uniqueKeys: true,
  });

const parseYamlDocumentWithTokens = (body: string) =>
  parseDocument(body, {
    customTags: ["timestamp"],
    keepSourceTokens: true,
    strict: true,
    uniqueKeys: true,
  });

// Public parsing and inspection -----------------------------------------------

/**
 * Locates and parses document frontmatter, returning `none`, `invalid`, or a
 * validated top-level property mapping with precise source ranges.
 */
export const parseFrontmatter = (source: string): FrontmatterResult => {
  const scan = scanFrontmatterEnvelope(source);
  if (scan.kind === "none") return { kind: "none" };
  if (scan.kind === "unclosed") {
    return {
      kind: "invalid",
      diagnostics: [{ message: "Frontmatter is missing its closing --- fence.", range: scan.openingRange }],
    };
  }

  const { envelope } = scan;
  const body = source.slice(envelope.bodyRange.from, envelope.bodyRange.to);
  const document = parseYamlDocument(body);
  const diagnostics: FrontmatterDiagnostic[] = document.errors.map((error) => ({
    message: error.message.split("\n", 1)[0],
    range: toDiagnosticRange(error.pos, envelope.bodyRange.from),
  }));

  if (document.contents && !isMap(document.contents)) {
    diagnostics.push({
      message: "Frontmatter must be a top-level mapping of property names to values.",
      range: toSourceRange(document.contents.range, envelope.bodyRange.from),
    });
  }

  if (isMap(document.contents)) {
    document.contents.items.forEach((pair) => {
      if (!isScalar(pair.key) || typeof pair.key.value !== "string") {
        diagnostics.push({
          message: "Frontmatter property names must be strings.",
          range: toSourceRange((pair.key as Node | null)?.range, envelope.bodyRange.from),
        });
      }
    });
  }

  if (diagnostics.length > 0) return { kind: "invalid", envelope, diagnostics };
  const properties = isMap(document.contents)
    ? parseFrontmatterProperties(document.contents, body, envelope.bodyRange.from)
    : [];
  return {
    kind: "valid",
    envelope,
    flow: isMap(document.contents) ? Boolean(document.contents.flow) : false,
    managed: properties.every(
      (property) =>
        isManagedFrontmatterValue(property.value) && !(property.value.kind === "list" && property.valueHasComments),
    ),
    properties,
  };
};

/** Finds an exactly named property in valid frontmatter. */
export const getFrontmatterProperty = (frontmatter: FrontmatterResult, key: string) =>
  frontmatter.kind === "valid" ? frontmatter.properties.find((property) => property.key === key) : undefined;

/** Returns a property only when its complete value is a list of strings. */
export const getFrontmatterStringList = (frontmatter: FrontmatterResult, key: string) => {
  const value = getFrontmatterProperty(frontmatter, key)?.value;
  if (value?.kind !== "list") return undefined;
  const strings = value.value.filter(
    (item): item is Extract<FrontmatterValue, { kind: "string" }> => item.kind === "string",
  );
  return strings.length === value.value.length ? strings.map((item) => item.value) : undefined;
};

/** Produces the compact human-readable text shown for a parsed value. */
export const frontmatterValueToText = (value: FrontmatterValue): string => {
  if (value.kind === "unsupported") return "Unsupported YAML";
  if (value.kind === "null") return "";
  if (value.kind === "date") return value.dateOnly ? value.value.slice(0, 10) : value.source;
  if (value.kind === "number") return value.source;
  if (value.kind === "list") return `${value.value.length} ${value.value.length === 1 ? "item" : "items"}`;
  return String(value.value);
};

// Source editing ---------------------------------------------------------------

const serializePropertyKey = (key: string) => stringify(key, { customTags: ["timestamp"] }).trimEnd();
const isDatetimeInput = (value: FrontmatterInput): value is FrontmatterDatetimeInput =>
  typeof value === "object" && value !== null && "kind" in value && value.kind === "datetime-input";

const serializeFrontmatterInput = (value: FrontmatterInput) => {
  if (isDatetimeInput(value)) {
    return value.value
      .toISOString()
      .replace(/\.000Z$/, "")
      .replace(/Z$/, "");
  }
  return stringify(value, {
    collectionStyle: "flow",
    customTags: ["timestamp"],
    // Values are embedded after an already-serialized `key: `. Allowing the
    // YAML package to wrap them would put the continuation at column zero and
    // turn long scalar values, such as PDF paths, into implicit map keys.
    lineWidth: 0,
  }).trimEnd();
};

const isValidPropertyKey = (key: string) => Boolean(key) && !/[\r\n]/.test(key);

const flowMapToken = (source: string, parsed: Extract<FrontmatterResult, { kind: "valid" }>) => {
  const body = source.slice(parsed.envelope.bodyRange.from, parsed.envelope.bodyRange.to);
  const contents = parseYamlDocumentWithTokens(body).contents;
  const token = isMap(contents) ? contents.srcToken : undefined;
  return token?.type === "flow-collection" ? token : null;
};

const planFlowPropertyRemoval = (
  source: string,
  parsed: Extract<FrontmatterResult, { kind: "valid" }>,
  property: FrontmatterProperty,
): FrontmatterEditResult => {
  const token = flowMapToken(source, parsed);
  const index = parsed.properties.indexOf(property);
  const item = token?.items[index];
  const closing = token?.end.find(({ type }) => type === "flow-map-end");
  if (!token || !item || !closing) return { success: false, error: "Could not safely edit flow-style frontmatter." };

  const offset = parsed.envelope.bodyRange.from;
  const start = item.start[0]?.offset ?? property.keyRange.from - offset;
  if (index === 0 && token.items.length > 1) {
    const separator = token.items[1].start.find(({ type }) => type === "comma");
    if (!separator) return { success: false, error: "Could not safely edit flow-style frontmatter." };
    return {
      success: true,
      change: {
        from: offset + start,
        to: offset + separator.offset + separator.source.length,
        insert: "",
      },
    };
  }

  const next = token.items[index + 1]?.start[0]?.offset;
  const end =
    next ?? (property.valueHasComments ? closing.offset : property.valueRange.to - parsed.envelope.bodyRange.from);
  return {
    success: true,
    change: {
      from: offset + start,
      to: offset + end,
      insert: "",
    },
  };
};

const planFlowPropertyInsert = (
  source: string,
  parsed: Extract<FrontmatterResult, { kind: "valid" }>,
  key: string,
  serialized: string,
): FrontmatterEditResult => {
  const token = flowMapToken(source, parsed);
  const closing = token?.end.find(({ type }) => type === "flow-map-end");
  if (!token || !closing) return { success: false, error: "Could not safely edit flow-style frontmatter." };

  let position = parsed.envelope.bodyRange.from + closing.offset;
  const trailingSeparator =
    token.items.length > parsed.properties.length && token.items.at(-1)?.start.some(({ type }) => type === "comma");
  const last = parsed.properties.at(-1);
  if (
    last &&
    !trailingSeparator &&
    !last.valueHasComments &&
    !/[\r\n]/.test(source.slice(last.valueRange.to, position))
  ) {
    while (position > last.valueRange.to && /[\t ]/.test(source[position - 1])) position -= 1;
  }
  const separator = trailingSeparator
    ? /\s/.test(source[position - 1] ?? "")
      ? ""
      : " "
    : parsed.properties.length
      ? ", "
      : "";
  return {
    success: true,
    change: {
      from: position,
      to: position,
      insert: `${separator}${serializePropertyKey(key)}: ${serialized}`,
    },
  };
};

/**
 * Plans one minimal source replacement without mutating the document. Existing
 * formatting outside the affected key or value is preserved.
 */
export const planFrontmatterEdit = (source: string, edit: FrontmatterEdit): FrontmatterEditResult => {
  const key = edit.type === "insert" ? edit.key.trim() : edit.key;
  if (edit.type === "insert" && !isValidPropertyKey(key))
    return { success: false, error: "Property names cannot be empty or contain newlines." };

  const parsed = parseFrontmatter(source);
  if (parsed.kind === "invalid")
    return { success: false, error: parsed.diagnostics[0]?.message ?? "Invalid frontmatter." };

  if (parsed.kind === "none") {
    if (edit.type !== "upsert" && edit.type !== "insert") {
      return { success: false, error: `Property “${key}” does not exist.` };
    }
    const newKey = edit.key.trim();
    if (!isValidPropertyKey(newKey)) {
      return { success: false, error: "Property names cannot be empty or contain newlines." };
    }
    const newline = source.match(/\r\n|\r|\n/)?.[0] ?? "\n";
    const blankLine = source.length > 0 ? newline : "";
    const insert = `---${newline}${serializePropertyKey(newKey)}: ${serializeFrontmatterInput(
      edit.value,
    )}${newline}---${newline}${blankLine}`;
    return { success: true, change: { from: 0, to: 0, insert } };
  }

  const property = getFrontmatterProperty(parsed, key);
  if (edit.type === "insert" && property) {
    return { success: false, error: `Property “${key}” already exists.` };
  }
  if (edit.type === "rename") {
    const newKey = edit.newKey.trim();
    if (!isValidPropertyKey(newKey)) {
      return { success: false, error: "Property names cannot be empty or contain newlines." };
    }
    if (!property) return { success: false, error: `Property “${key}” does not exist.` };
    if (newKey !== key && getFrontmatterProperty(parsed, newKey))
      return { success: false, error: `Property “${newKey}” already exists.` };
    return {
      success: true,
      change: {
        from: property.keyRange.from,
        to: property.keyRange.to,
        insert: serializePropertyKey(newKey),
      },
    };
  }

  if (edit.type === "remove") {
    if (!property) return { success: false, error: `Property “${key}” does not exist.` };
    if (parsed.flow) return planFlowPropertyRemoval(source, parsed, property);
    return { success: true, change: { from: property.range.from, to: property.range.to, insert: "" } };
  }

  const serialized = serializeFrontmatterInput(edit.value);
  if (property) {
    const { valueRange } = property;
    const isEmptyValue = valueRange.from === valueRange.to;
    const originalValue = source.slice(valueRange.from, valueRange.to);
    const trailingLineBreak = originalValue.match(/(?:\r\n|\r|\n)$/)?.[0] ?? "";
    return {
      success: true,
      change: {
        from: valueRange.from,
        to: valueRange.to,
        insert: `${isEmptyValue ? " " : ""}${serialized}${trailingLineBreak}`,
      },
    };
  }

  const newKey = edit.key.trim();
  if (!isValidPropertyKey(newKey)) {
    return { success: false, error: "Property names cannot be empty or contain newlines." };
  }
  if (newKey !== key && getFrontmatterProperty(parsed, newKey)) {
    return { success: false, error: `Property “${newKey}” already exists.` };
  }
  if (parsed.flow) return planFlowPropertyInsert(source, parsed, newKey, serialized);
  return {
    success: true,
    change: {
      from: parsed.envelope.bodyRange.to,
      to: parsed.envelope.bodyRange.to,
      insert: `${serializePropertyKey(newKey)}: ${serialized}${parsed.envelope.newline}`,
    },
  };
};

/** Applies a successfully planned frontmatter replacement to complete document source. */
export const editFrontmatterSource = (source: string, edit: FrontmatterEdit): FrontmatterSourceEditResult => {
  const result = planFrontmatterEdit(source, edit);
  if (!result.success) return result;
  return {
    success: true,
    source: source.slice(0, result.change.from) + result.change.insert + source.slice(result.change.to),
  };
};
