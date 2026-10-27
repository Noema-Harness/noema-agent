const CITATION_MARKER = /\[\[(S\d{1,2})\]\]/gu;

export function linkWebSourceCitations(content, sources) {
  if (typeof content !== 'string' || !Array.isArray(sources)) return content;

  const sourceUrls = new Map();
  for (const source of sources) {
    if (typeof source?.citationId !== 'string') continue;
    try {
      const url = new URL(source.url);
      if (url.protocol === 'https:' || url.protocol === 'http:') {
        sourceUrls.set(source.citationId, url.href);
      }
    } catch {
      // Invalid persisted data cannot become a clickable citation.
    }
  }

  return content.replace(CITATION_MARKER, (marker, citationId) => {
    const url = sourceUrls.get(citationId);
    return url ? `[${citationId}](<${url}>)` : marker;
  });
}
