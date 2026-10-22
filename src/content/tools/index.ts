import "server-only";
import fs from "node:fs";
import path from "node:path";
import { validateTool, type Tool } from "./types";

/*
 * Tool definitions are content, like articles: one JSON file per tool in content/tools/
 * (private repository only, never mirrored). The folder is read once per process and every
 * file is validated against the schema in ./types.ts; an invalid file throws with its name,
 * so a bad definition fails the build instead of shipping a broken page.
 */

const DIR = path.join(process.cwd(), "content", "tools");
let cache: Map<string, Tool> | null = null;

function load(): Map<string, Tool> {
  // Cached for the life of a production process; re-read on every call in development so an edited
  // definition shows up on the next refresh without restarting the dev server.
  if (cache && process.env.NODE_ENV === "production") return cache;
  const tools = new Map<string, Tool>();
  if (fs.existsSync(DIR)) {
    for (const f of fs.readdirSync(DIR).sort()) {
      if (!f.endsWith(".json") || f.startsWith(".")) continue;
      const file = path.join("content", "tools", f);
      let data: unknown;
      try {
        data = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
      } catch (e) {
        throw new Error(`${file}: not valid JSON (${(e as Error).message})`);
      }
      const tool = validateTool(data, file);
      if (`${tool.id}.json` !== f) throw new Error(`${file}: the file must be named after its id ("${tool.id}.json")`);
      tools.set(tool.id, tool);
    }
  }
  cache = tools;
  return tools;
}

export function getTool(id: string | null | undefined): Tool | null {
  return id ? (load().get(id) ?? null) : null;
}

/** Every tool, sorted by id. */
export function listTools(): Tool[] {
  return [...load().values()];
}
