/**
 * Bare YouTube URLs in authored Markdown are video versions rather than prose.
 * Render them as a lazy, privacy-enhanced player without rewriting the source
 * text — embedded or contextual links remain ordinary links.
 */
function youtubeId(href) {
  try {
    const url = new URL(href);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtu.be") return url.pathname.split("/").filter(Boolean)[0] ?? null;
    if (host !== "youtube.com" && host !== "m.youtube.com") return null;
    if (url.pathname === "/watch") return url.searchParams.get("v");
    const [kind, id] = url.pathname.split("/").filter(Boolean);
    return ["embed", "shorts", "live"].includes(kind) ? id ?? null : null;
  } catch {
    return null;
  }
}

function standaloneYoutubeLink(node) {
  if (node?.type !== "element" || node.tagName !== "p" || node.children?.length !== 1) return null;
  const [link] = node.children;
  if (link?.type !== "element" || link.tagName !== "a" || typeof link.properties?.href !== "string") return null;
  const id = youtubeId(link.properties.href);
  return id && /^[\w-]{11}$/.test(id) ? { id, href: link.properties.href } : null;
}

export function embedStandaloneYouTube() {
  return (tree) => {
    const visit = (node) => {
      if (!Array.isArray(node?.children)) return;
      node.children.forEach((child) => {
        const video = standaloneYoutubeLink(child);
        if (video) {
          child.tagName = "div";
          child.properties = { className: ["video-embed"] };
          child.children = [
            {
              type: "element",
              tagName: "iframe",
              properties: {
                src: `https://www.youtube-nocookie.com/embed/${video.id}`,
                title: "Видео с YouTube",
                loading: "lazy",
                allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
                referrerPolicy: "strict-origin-when-cross-origin",
                allowFullScreen: true,
              },
              children: [],
            },
            {
              type: "element",
              tagName: "a",
              properties: { href: video.href },
              children: [{ type: "text", value: "Открыть на YouTube" }],
            },
          ];
          return;
        }
        visit(child);
      });
    };
    visit(tree);
  };
}