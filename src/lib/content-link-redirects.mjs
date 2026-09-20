/**
 * Historical Telegram text stays byte-for-byte archival, while outbound links
 * point at the successor deployment when a project moves.
 */
const redirects = new Map([
  ["https://stanleymarch.github.io/ar-experiments/", "https://stanleymarch.github.io/xr-experiments/"],
]);

export function rewriteOutboundLinks() {
  return (tree) => {
    const visit = (node) => {
      if (node?.type === "element" && node.tagName === "a" && typeof node.properties?.href === "string") {
        const replacement = redirects.get(node.properties.href);
        if (replacement) node.properties.href = replacement;
      }
      if (Array.isArray(node?.children)) node.children.forEach(visit);
    };
    visit(tree);
  };
}
