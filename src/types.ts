export interface RichText {
  type: "text";
  text: { content: string; link?: { url: string } | null };
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    strikethrough?: boolean;
    underline?: boolean;
    code?: boolean;
    color?: string;
  };
}

export type NotionBlock =
  | { type: "heading_1"; heading_1: { rich_text: RichText[]; is_toggleable?: boolean; children?: NotionBlock[] } }
  | { type: "heading_2"; heading_2: { rich_text: RichText[]; is_toggleable?: boolean; children?: NotionBlock[] } }
  | { type: "heading_3"; heading_3: { rich_text: RichText[]; is_toggleable?: boolean; children?: NotionBlock[] } }
  | { type: "paragraph"; paragraph: { rich_text: RichText[] } }
  | {
      type: "toggle";
      toggle: {
        rich_text: RichText[];
        children?: NotionBlock[];
      };
    }
  | {
      type: "bulleted_list_item";
      bulleted_list_item: { rich_text: RichText[]; children?: NotionBlock[] };
    }
  | {
      type: "numbered_list_item";
      numbered_list_item: { rich_text: RichText[]; children?: NotionBlock[] };
    }
  | { type: "quote"; quote: { rich_text: RichText[] } }
  | {
      type: "callout";
      callout: { rich_text: RichText[]; icon: { type: "emoji"; emoji: string } };
    }
  | { type: "equation"; equation: { expression: string } }
  | {
      type: "table";
      table: {
        table_width: number;
        has_column_header: boolean;
        has_row_header: boolean;
        children: NotionBlock[];
      };
    }
  | {
      type: "table_row";
      table_row: {
        cells: RichText[][];
      };
    }
  | {
      type: "column_list";
      column_list: {
        children: NotionBlock[];
      };
    }
  | {
      type: "column";
      column: {
        children: NotionBlock[];
      };
    }
  | { type: "code"; code: { rich_text: RichText[]; language: string } }
  | { type: "divider"; divider: Record<string, never> }
  | { type: "to_do"; to_do: { rich_text: RichText[]; checked: boolean } }
  | { type: "table_of_contents"; table_of_contents: Record<string, never> }
  | {
      type: "bookmark";
      bookmark: {
        url: string;
      };
    }
  | {
      type: "embed";
      embed: {
        url: string;
      };
    }
  | {
      type: "image";
      image:
        | { type: "external"; external: { url: string } }
        | { type: "file_upload"; file_upload: { id: string } };
    }
  | {
      type: "file";
      file:
        | { type: "external"; external: { url: string }; name?: string }
        | { type: "file_upload"; file_upload: { id: string }; name?: string };
    }
  | {
      type: "audio";
      audio:
        | { type: "external"; external: { url: string } }
        | { type: "file_upload"; file_upload: { id: string } };
    }
  | {
      type: "video";
      video:
        | { type: "external"; external: { url: string } }
        | { type: "file_upload"; file_upload: { id: string } };
    };
