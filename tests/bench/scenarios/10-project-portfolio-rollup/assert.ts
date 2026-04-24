import type { AssertContext, AssertResult } from "../../harness/types.ts";

export async function assert(ctx: AssertContext): Promise<AssertResult> {
  const blocks = [];
  let cursor: string | undefined;

  do {
    const response = await ctx.notion.blocks.children.list({
      block_id: ctx.scenarioParentId,
      start_cursor: cursor,
    });
    blocks.push(...response.results);
    cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
  } while (cursor);

  const dbBlocks = blocks.filter((block: any) => block.type === "child_database");

  let tasksDbId: string | undefined;
  for (const block of dbBlocks) {
    const database = await ctx.notion.databases.retrieve({ database_id: (block as any).id });
    const title = (database as any).title?.map((item: any) => item.plain_text).join("") ?? "";
    if (title.includes("Tasks")) {
      tasksDbId = (block as any).id;
      break;
    }
  }

  if (!tasksDbId) {
    return { passed: false, message: "Tasks database not found under scenario parent" };
  }

  const queryResponse = await ctx.notion.databases.query({ database_id: tasksDbId });
  const tasksWithRelation = queryResponse.results.filter((row: any) => {
    const projectProp = Object.values(row.properties).find((property: any) => property.type === "relation") as any;
    return projectProp && Array.isArray(projectProp.relation) && projectProp.relation.length > 0;
  });

  if (tasksWithRelation.length === 0) {
    return { passed: false, message: "No tasks have relation links to projects" };
  }

  return {
    passed: true,
    message: `${tasksWithRelation.length} tasks have project relation links`,
  };
}
