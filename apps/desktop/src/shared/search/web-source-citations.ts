const CITATION_MARKER = /\[\[(S\d{1,2})(?:\|([^\]\r\n]{1,240}))?\]\]/gu;

export function linkWebSourceCitations(content: unknown, sources: unknown) {
  if (typeof content !== 'string' || !Array.isArray(sources)) return content;

  const sourceByCitationId = new Map();
  for (const source of sources) {
    if (typeof source?.citationId !== 'string') continue;
    try {
      const url = new URL(source.url);
      if (url.protocol === 'https:' || url.protocol === 'http:') {
        sourceByCitationId.set(source.citationId, { source, url: url.href });
      }
    } catch {
      // Invalid persisted data cannot become a clickable citation.
    }
  }

  return content.replace(CITATION_MARKER, (marker, citationId, quote) => {
    const entry = sourceByCitationId.get(citationId);
    if (!entry) return marker;
    if (quote !== undefined) {
      if (!entry.source.excerpt?.includes(quote)) return marker;
      const title = `匹配的页面原文（不等于结论已核实）：${quote.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"').replace(/\s+/gu, ' ')}`;
      return `[${citationId}](<${entry.url}> "${title}")`;
    }
    return `[${citationId}](<${entry.url}>)`;
  });
}
