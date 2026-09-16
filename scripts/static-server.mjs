import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = join(process.cwd(), "dist");
const types = { ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".css":"text/css; charset=utf-8", ".json":"application/json; charset=utf-8", ".svg":"image/svg+xml" };
createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    let target = normalize(join(root, pathname));
    if (!target.startsWith(root)) throw new Error("Invalid path");
    const info = await stat(target).catch(() => undefined);
    if (info?.isDirectory() || pathname.endsWith("/")) target = join(target, "index.html");
    const body = await readFile(target);
    response.writeHead(200, { "Content-Type": types[extname(target)] ?? "application/octet-stream" }); response.end(body);
  } catch { response.writeHead(404); response.end("Not found"); }
}).listen(4321, "127.0.0.1", () => console.log("Static preview: http://127.0.0.1:4321"));
