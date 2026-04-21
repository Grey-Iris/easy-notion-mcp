export type ArchiveErrorClass =
  | "already_archived"
  | "archived_ancestor"
  | "not_found"
  | "unexpected";

export interface ClassifiedArchiveError {
  class: ArchiveErrorClass;
  raw: string;
  id: string;
}

const ARCHIVED_ANCESTOR_SUBSTRING = "Can't edit page on block with an archived ancestor";
const ALREADY_ARCHIVED_SUBSTRING = "Can't edit block that is archived";
const NOT_FOUND_SUBSTRING = "Could not find page with ID";

export function classifyArchiveError(
  id: string,
  rawError: string,
): ClassifiedArchiveError {
  let cls: ArchiveErrorClass = "unexpected";

  if (rawError.includes(ARCHIVED_ANCESTOR_SUBSTRING)) {
    cls = "archived_ancestor";
  } else if (rawError.includes(ALREADY_ARCHIVED_SUBSTRING)) {
    cls = "already_archived";
  } else if (rawError.includes(NOT_FOUND_SUBSTRING)) {
    cls = "not_found";
  }

  return {
    class: cls,
    id,
    raw: rawError,
  };
}

export function isToleratedArchiveClass(cls: ArchiveErrorClass): boolean {
  return cls !== "unexpected";
}
