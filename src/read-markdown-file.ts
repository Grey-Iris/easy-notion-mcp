import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, resolve as pathResolve, sep, extname } from "node:path";

const MAX_FILE_BYTES = 1_048_576; // 1 MB
const ALLOWED_EXTENSIONS = new Set([".md", ".markdown"]);

export async function readMarkdownFile(
  filePath: string,
  workspaceRoot: string,
): Promise<string> {
  // 1. Absolute path check
  if (!isAbsolute(filePath)) {
    throw new Error(
      `create_page_from_file: file_path must be an absolute path, got '${filePath}'`,
    );
  }

  // 2. Resolve symlinks. realpath throws ENOENT if file doesn't exist.
  let realFilePath: string;
  let realWorkspaceRoot: string;
  try {
    realFilePath = await realpath(pathResolve(filePath));
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      throw new Error(`create_page_from_file: file not found: '${filePath}'`);
    }
    throw err;
  }
  try {
    realWorkspaceRoot = await realpath(pathResolve(workspaceRoot));
  } catch (err: any) {
    throw new Error(
      `create_page_from_file: configured workspace root does not resolve: '${workspaceRoot}'`,
    );
  }

  // 3. Separator-aware containment check
  const rootWithSep = realWorkspaceRoot.endsWith(sep)
    ? realWorkspaceRoot
    : realWorkspaceRoot + sep;
  if (
    realFilePath !== realWorkspaceRoot &&
    !realFilePath.startsWith(rootWithSep)
  ) {
    throw new Error(
      `create_page_from_file: file_path '${filePath}' resolves outside the allowed workspace root`,
    );
  }

  // 4. Extension check on RESOLVED path
  const realExt = extname(realFilePath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(realExt)) {
    throw new Error(
      `create_page_from_file: file must have .md or .markdown extension (resolved path: '${realFilePath}')`,
    );
  }

  // 5. Regular-file check + size cap
  const stats = await stat(realFilePath);
  if (!stats.isFile()) {
    throw new Error(
      `create_page_from_file: not a regular file: '${filePath}'`,
    );
  }
  if (stats.size > MAX_FILE_BYTES) {
    throw new Error(
      `create_page_from_file: file size ${stats.size} exceeds ${MAX_FILE_BYTES}-byte cap`,
    );
  }

  // 6. Strict UTF-8 decode (readFile("utf8") silently replaces bad bytes)
  const buf = await readFile(realFilePath);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch (err: any) {
    throw new Error(
      `create_page_from_file: file is not valid UTF-8: '${filePath}'`,
    );
  }
}
