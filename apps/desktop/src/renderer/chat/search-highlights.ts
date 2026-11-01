const highlightName = 'noema-current-chat-search';

type HighlightApi = {
  CSS?: {
    highlights?: {
      set(name: string, highlight: object): void;
      delete(name: string): boolean;
    };
  };
  Highlight?: new (...ranges: Range[]) => object;
};

export function highlightMessageMatches(
  root: HTMLElement,
  query: string,
): () => void {
  const api = globalThis as unknown as HighlightApi;
  const registry = api.CSS?.highlights;
  const Highlight = api.Highlight;
  const term = query.trim();
  if (!registry || !Highlight || !term) return () => {};

  registry.delete(highlightName);
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const matcher = new RegExp(escaped, 'giu');
  let node = walker.nextNode();

  while (node) {
    const text = node.textContent ?? '';
    matcher.lastIndex = 0;
    for (const match of text.matchAll(matcher)) {
      if (match.index === undefined || match[0].length === 0) continue;
      const range = document.createRange();
      range.setStart(node, match.index);
      range.setEnd(node, match.index + match[0].length);
      ranges.push(range);
    }
    node = walker.nextNode();
  }

  if (ranges.length) registry.set(highlightName, new Highlight(...ranges));
  return () => registry.delete(highlightName);
}
