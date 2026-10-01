import { allEntries, hiddenEntryIds, type AnyEntry } from "./content";
import { buildGraph, type SiteGraph } from "./graph";

const cache = new Map<string, Promise<SiteGraph>>();

async function load(includeLife: boolean, hidden: Set<string>): Promise<SiteGraph> {
  const entries = await allEntries();
  return buildGraph(entries, { includeLife, hiddenIds: hidden });
}


export function getSiteGraph(includeLife = false) {
  // A life publication's own page shows a neighbourhood that includes the life
  // channel; every other consumer gets the curated corpus graph. Both drop
  // relations bound for hidden entries instead of throwing on them.
  const key = includeLife ? "with-life" : "curated";
  let graph = cache.get(key);
  if (!graph) {
    graph = (async () => {
      const hidden = await hiddenEntryIds();
      return load(includeLife, hidden);
    })();
    cache.set(key, graph);
  }
  return graph;
}
