export type AppendResponseFixtureMode =
  | "realistic-capped"
  | "synthetic-overreturn"
  | "synthetic-invariant-violation";

export type AppendResponseFixtureRow = {
  id: string;
  type: string;
  [key: string]: unknown;
};

type AppendResponseFixtureOptions = {
  mode: AppendResponseFixtureMode;
  children: Array<Record<string, any>>;
  createdIds?: string[];
  trailingRows?: AppendResponseFixtureRow[];
  returnedRows?: AppendResponseFixtureRow[];
};

export const APPEND_RESPONSE_FIXTURE_CURSOR = "append-response-fixture-cursor";

function fresh<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createdRows(
  children: Array<Record<string, any>>,
  createdIds: string[],
): AppendResponseFixtureRow[] {
  if (createdIds.length !== children.length) {
    throw new Error("append response fixture requires one created id per sent child");
  }
  if (new Set(createdIds).size !== createdIds.length) {
    throw new Error("append response fixture created ids must be unique per call");
  }

  return children.map((child, index) => ({
    id: createdIds[index],
    type: child.type,
    [child.type]: fresh(child[child.type]),
  }));
}

export function appendResponseFixture({
  mode,
  children,
  createdIds = [],
  trailingRows = [],
  returnedRows = [],
}: AppendResponseFixtureOptions) {
  if (mode === "synthetic-invariant-violation") {
    return {
      results: fresh(returnedRows),
      has_more: false,
      next_cursor: null,
    };
  }

  const candidates = [
    ...createdRows(children, createdIds),
    ...fresh(trailingRows),
  ];

  if (mode === "synthetic-overreturn") {
    return {
      results: fresh(candidates),
      has_more: false,
      next_cursor: null,
    };
  }

  const truncated = candidates.length > 100;
  return {
    results: fresh(candidates.slice(0, 100)),
    has_more: truncated,
    next_cursor: truncated ? APPEND_RESPONSE_FIXTURE_CURSOR : null,
  };
}
