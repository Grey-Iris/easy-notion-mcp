/**
 * PR3 live probes — disposable script that answers the five questions in the
 * PR3 plan §9.1 and the dispatch brief that SDK types and the Enhanced Markdown
 * spec page cannot answer alone. Run once, write findings to
 * `.meta/research/pr3-live-probe-findings-2026-04-28.md`, then delete or skip.
 *
 *   tsx scripts/bench/pr3-live-probes.ts
 *
 * Requires `NOTION_TOKEN` and `BENCH_ROOT_PAGE_ID` (or `E2E_ROOT_PAGE_ID`) in env.
 * Probes:
 *   1. allow_deleting_content default and rejection semantics
 *   2. +++ and ::: syntax behavior through pages.updateMarkdown
 *   3. unknown_block_ids semantics
 *   4. block-ID preservation rate on near-identical replacement
 *   5. GFM-alerts (> [!NOTE]) — callout, quote, or text?
 */

import "dotenv/config";

import { Client } from "@notionhq/client";

type ProbeResult = {
  name: string;
  status: "ok" | "error" | "skipped";
  notes: string[];
  data?: unknown;
};

const results: ProbeResult[] = [];

function logSection(label: string) {
  console.error(`\n========== ${label} ==========`);
}

async function safeUpdateMarkdown(
  client: Client,
  payload: Record<string, unknown>,
): Promise<{ ok: true; response: any } | { ok: false; error: any }> {
  try {
    const response = await (client as any).pages.updateMarkdown(payload);
    return { ok: true, response };
  } catch (error) {
    return { ok: false, error };
  }
}

async function createScratchPage(
  client: Client,
  parentPageId: string,
  title: string,
  childrenMarkdown: string,
): Promise<string> {
  const page = await (client as any).pages.create({
    parent: { page_id: parentPageId },
    properties: {
      title: { title: [{ type: "text", text: { content: title } }] },
    },
  });
  // Append initial markdown via updateMarkdown insert_content (more reliable than block-API for our purposes).
  await (client as any).pages.updateMarkdown({
    page_id: page.id,
    type: "insert_content",
    insert_content: { content: childrenMarkdown },
  });
  return page.id;
}

async function listChildren(client: Client, blockId: string): Promise<any[]> {
  const out: any[] = [];
  let cursor: string | undefined;
  do {
    const r = await client.blocks.children.list({ block_id: blockId, start_cursor: cursor, page_size: 100 });
    out.push(...r.results);
    cursor = r.has_more ? r.next_cursor ?? undefined : undefined;
  } while (cursor);
  return out;
}

async function archive(client: Client, pageId: string) {
  try {
    await (client as any).pages.update({ page_id: pageId, in_trash: true });
  } catch {
    /* best-effort cleanup */
  }
}

async function probe1AllowDeletingContent(client: Client, parentPageId: string): Promise<ProbeResult> {
  logSection("Probe 1: allow_deleting_content default + rejection semantics");
  const notes: string[] = [];
  const data: Record<string, unknown> = {};
  const pageId = await createScratchPage(
    client,
    parentPageId,
    "PR3-probe-1-allow-deleting",
    "# Original\n\nUnrelated content paragraph 1.\n\nUnrelated content paragraph 2.\n",
  );
  notes.push(`scratch page id=${pageId}`);

  try {
    // (a) flag omitted
    const a = await safeUpdateMarkdown(client, {
      page_id: pageId,
      type: "replace_content",
      replace_content: { new_str: "# Test omitted" },
    });
    data.omitted = a.ok ? { ok: true, response: a.response } : { ok: false, error: serializeError(a.error) };

    const afterOmitted = await listChildren(client, pageId);
    data.afterOmittedChildren = afterOmitted.map((b) => ({ id: b.id, type: b.type }));

    // Reset the page for next probe step.
    await (client as any).pages.updateMarkdown({
      page_id: pageId,
      type: "replace_content",
      replace_content: { new_str: "# Original\n\nReset paragraph 1.\n\nReset paragraph 2.\n", allow_deleting_content: true },
    });

    // (b) flag false
    const b = await safeUpdateMarkdown(client, {
      page_id: pageId,
      type: "replace_content",
      replace_content: { new_str: "# Test false", allow_deleting_content: false },
    });
    data.flag_false = b.ok ? { ok: true, response: b.response } : { ok: false, error: serializeError(b.error) };
    const afterFalse = await listChildren(client, pageId);
    data.afterFalseChildren = afterFalse.map((b) => ({ id: b.id, type: b.type }));

    // Reset.
    await (client as any).pages.updateMarkdown({
      page_id: pageId,
      type: "replace_content",
      replace_content: { new_str: "# Original\n\nReset paragraph 1.\n\nReset paragraph 2.\n", allow_deleting_content: true },
    });

    // (c) flag true
    const c = await safeUpdateMarkdown(client, {
      page_id: pageId,
      type: "replace_content",
      replace_content: { new_str: "# Test true", allow_deleting_content: true },
    });
    data.flag_true = c.ok ? { ok: true, response: c.response } : { ok: false, error: serializeError(c.error) };
    const afterTrue = await listChildren(client, pageId);
    data.afterTrueChildren = afterTrue.map((b) => ({ id: b.id, type: b.type }));
  } finally {
    await archive(client, pageId);
  }

  return { name: "1-allow_deleting_content", status: "ok", notes, data };
}

async function probe2CustomSyntax(client: Client, parentPageId: string): Promise<ProbeResult> {
  logSection("Probe 2: custom GFM-extension syntax (+++ toggle, ::: columns)");
  const notes: string[] = [];
  const data: Record<string, unknown> = {};
  const pageId = await createScratchPage(client, parentPageId, "PR3-probe-2-custom-syntax", "Probe init paragraph.\n");
  notes.push(`scratch page id=${pageId}`);

  try {
    // Send +++ toggle and ::: columns directly through pages.updateMarkdown.
    const toggleSyntax = "+++ Toggle title\nbody line 1\n+++\n";
    const columnSyntax = "::: columns\n::: column\nLeft column body.\n:::\n::: column\nRight column body.\n:::\n:::\n";
    const calloutSyntax = "> [!NOTE]\n> Note callout body.\n";
    const equationSyntax = "$$E=mc^2$$\n";
    const tocSyntax = "[toc]\n";
    const bookmarkSyntax = "https://example.com/probe-2-bookmark\n";

    const combined = [
      "# Probe 2 header",
      "",
      "Plain paragraph that should land as paragraph.",
      "",
      toggleSyntax,
      "",
      columnSyntax,
      "",
      calloutSyntax,
      "",
      equationSyntax,
      "",
      tocSyntax,
      "",
      bookmarkSyntax,
    ].join("\n");

    const r = await safeUpdateMarkdown(client, {
      page_id: pageId,
      type: "replace_content",
      replace_content: { new_str: combined, allow_deleting_content: true },
    });
    data.replaceResult = r.ok ? { ok: true, response: r.response } : { ok: false, error: serializeError(r.error) };

    const after = await listChildren(client, pageId);
    data.afterChildren = after.map((b) => ({ id: b.id, type: b.type, snippet: snippetForBlock(b) }));
    notes.push(`landed block types: ${after.map((b) => b.type).join(", ")}`);
  } finally {
    await archive(client, pageId);
  }

  return { name: "2-custom_syntax", status: "ok", notes, data };
}

async function probe3UnknownBlockIds(client: Client, parentPageId: string): Promise<ProbeResult> {
  logSection("Probe 3: unknown_block_ids semantics");
  const notes: string[] = [];
  const data: Record<string, unknown> = {};
  const pageId = await createScratchPage(
    client,
    parentPageId,
    "PR3-probe-3-unknown-blocks",
    [
      "# H1 title",
      "",
      "Paragraph A original.",
      "",
      "Paragraph B original.",
      "",
      "Paragraph C original.",
      "",
      "## H2 sub",
      "",
      "Paragraph D original.",
    ].join("\n"),
  );
  notes.push(`scratch page id=${pageId}`);

  try {
    const before = await listChildren(client, pageId);
    data.beforeBlocks = before.map((b) => ({ id: b.id, type: b.type, snippet: snippetForBlock(b) }));

    // Replace with mostly-identical content, edit one paragraph.
    const replacement = [
      "# H1 title",
      "",
      "Paragraph A original.",
      "",
      "Paragraph B EDITED ONCE.",
      "",
      "Paragraph C original.",
      "",
      "## H2 sub",
      "",
      "Paragraph D original.",
    ].join("\n");

    const r = await safeUpdateMarkdown(client, {
      page_id: pageId,
      type: "replace_content",
      replace_content: { new_str: replacement, allow_deleting_content: true },
    });
    data.replaceResult = r.ok ? { ok: true, response: r.response } : { ok: false, error: serializeError(r.error) };

    const after = await listChildren(client, pageId);
    data.afterBlocks = after.map((b) => ({ id: b.id, type: b.type, snippet: snippetForBlock(b) }));

    // Compute ID survival rate.
    const beforeIds = new Set(before.map((b) => b.id));
    const survivors = after.filter((b) => beforeIds.has(b.id));
    data.idSurvival = {
      before_count: before.length,
      after_count: after.length,
      surviving_ids: survivors.map((b) => b.id),
      survived: survivors.length,
    };
    notes.push(`${survivors.length}/${before.length} block IDs survived after one-paragraph edit`);
  } finally {
    await archive(client, pageId);
  }

  return { name: "3-unknown_block_ids", status: "ok", notes, data };
}

async function probe4BlockIdPreservation(client: Client, parentPageId: string): Promise<ProbeResult> {
  logSection("Probe 4: block ID preservation rate (10 blocks, one-char edit)");
  const notes: string[] = [];
  const data: Record<string, unknown> = {};

  const tenBlocks = Array.from({ length: 10 }, (_, i) => `Paragraph number ${i + 1} content here.`).join("\n\n");
  const pageId = await createScratchPage(client, parentPageId, "PR3-probe-4-id-preservation", tenBlocks);
  notes.push(`scratch page id=${pageId}`);

  try {
    const before = await listChildren(client, pageId);
    data.beforeIds = before.map((b) => b.id);

    // Same 10 blocks but paragraph 5 has one extra letter.
    const edited = Array.from({ length: 10 }, (_, i) => {
      const base = `Paragraph number ${i + 1} content here.`;
      return i === 4 ? base.replace("content", "contentX") : base;
    }).join("\n\n");

    const r = await safeUpdateMarkdown(client, {
      page_id: pageId,
      type: "replace_content",
      replace_content: { new_str: edited, allow_deleting_content: true },
    });
    data.replaceResult = r.ok ? { ok: true, response: r.response } : { ok: false, error: serializeError(r.error) };

    const after = await listChildren(client, pageId);
    data.afterIds = after.map((b) => b.id);
    const beforeIds = new Set(before.map((b) => b.id));
    const survivors = after.filter((b) => beforeIds.has(b.id));
    data.survivors = survivors.map((b) => b.id);
    data.survival = `${survivors.length}/${before.length}`;
    notes.push(`${survivors.length}/${before.length} block IDs survived a one-char edit`);
  } finally {
    await archive(client, pageId);
  }

  return { name: "4-block_id_preservation", status: "ok", notes, data };
}

async function probe5GfmAlerts(client: Client, parentPageId: string): Promise<ProbeResult> {
  logSection("Probe 5: GFM-alerts (> [!NOTE])");
  const notes: string[] = [];
  const data: Record<string, unknown> = {};

  const pageId = await createScratchPage(client, parentPageId, "PR3-probe-5-gfm-alerts", "Init.\n");
  notes.push(`scratch page id=${pageId}`);

  try {
    const note = [
      "> [!NOTE]",
      "> Note body alert text.",
      "",
      "> [!TIP]",
      "> Tip body alert text.",
      "",
      "> [!WARNING]",
      "> Warning body.",
      "",
      "> Plain quote line",
    ].join("\n");

    const r = await safeUpdateMarkdown(client, {
      page_id: pageId,
      type: "replace_content",
      replace_content: { new_str: note, allow_deleting_content: true },
    });
    data.replaceResult = r.ok ? { ok: true, response: r.response } : { ok: false, error: serializeError(r.error) };

    const after = await listChildren(client, pageId);
    data.afterBlocks = after.map((b) => ({ id: b.id, type: b.type, snippet: snippetForBlock(b) }));
    notes.push(`landed types: ${after.map((b) => b.type).join(", ")}`);
  } finally {
    await archive(client, pageId);
  }

  return { name: "5-gfm_alerts", status: "ok", notes, data };
}

function snippetForBlock(block: any): string {
  const richText = block?.[block.type]?.rich_text;
  if (Array.isArray(richText)) {
    return richText.map((t: any) => t?.plain_text ?? "").join("").slice(0, 80);
  }
  if (block.type === "callout") {
    const rt = block.callout?.rich_text;
    return Array.isArray(rt) ? rt.map((t: any) => t?.plain_text ?? "").join("").slice(0, 80) : "";
  }
  return "";
}

function serializeError(error: any) {
  return {
    name: error?.name ?? "UnknownError",
    code: error?.code,
    status: error?.status,
    message: error?.message,
    body: error?.body,
  };
}

async function main() {
  const token = process.env.NOTION_TOKEN;
  const parentPageId = process.env.BENCH_ROOT_PAGE_ID ?? process.env.E2E_ROOT_PAGE_ID;
  if (!token) throw new Error("NOTION_TOKEN required");
  if (!parentPageId) throw new Error("BENCH_ROOT_PAGE_ID or E2E_ROOT_PAGE_ID required");

  const client = new Client({ auth: token, notionVersion: "2025-09-03" });

  results.push(await probe1AllowDeletingContent(client, parentPageId));
  results.push(await probe2CustomSyntax(client, parentPageId));
  results.push(await probe3UnknownBlockIds(client, parentPageId));
  results.push(await probe4BlockIdPreservation(client, parentPageId));
  results.push(await probe5GfmAlerts(client, parentPageId));

  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
