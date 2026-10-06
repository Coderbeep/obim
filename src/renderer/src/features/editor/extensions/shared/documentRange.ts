export interface DocumentRange {
  from: number;
  to: number;
}

export function rangesIntersect(first: DocumentRange, second: DocumentRange) {
  return first.from <= second.to && first.to >= second.from;
}

export function rangeContains(outer: DocumentRange, inner: DocumentRange) {
  return inner.from >= outer.from && inner.to <= outer.to;
}
