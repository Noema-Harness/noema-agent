/** Keep model-internal analysis out of durable, member-visible group messages. */
export function projectGroupPublicText(value: unknown) {
  if (typeof value !== 'string') throw new Error('公开消息必须是文本。');
  const tags = [...value.matchAll(/<\/?analysis\s*>/giu)];
  if (!tags.length) return value;

  const blocks = [];
  let open = null;
  for (const tag of tags) {
    if (/^<analysis\s*>$/iu.test(tag[0])) {
      if (open) throw new Error('公开消息包含无法安全识别的内部推演标记。');
      open = tag;
    } else {
      if (!open) throw new Error('公开消息中的内部推演边界不完整，未发送。');
      blocks.push([open, tag]);
      open = null;
    }
  }
  if (open) throw new Error('公开消息中的内部推演边界不完整，未发送。');

  let publicText = value;
  for (let index = blocks.length - 1; index >= 0; index--) {
    const [startTag, endTag] = blocks[index];
    publicText =
      publicText.slice(0, startTag.index) +
      publicText.slice(endTag.index + endTag[0].length);
  }

  const summaries = [...publicText.matchAll(/<\/?summary\s*>/giu)];
  if (!summaries.length) return publicText.trim();
  if (
    summaries.length !== 2 ||
    !/^<summary\s*>$/iu.test(summaries[0][0]) ||
    !/^<\/summary\s*>$/iu.test(summaries[1][0])
  ) {
    throw new Error('公开摘要边界不完整，未发送。');
  }
  return publicText
    .slice(summaries[0].index + summaries[0][0].length, summaries[1].index)
    .trim();
}

/** A legacy malformed record must fail closed when rendered or read. */
export function visibleProjectGroupText(value: unknown) {
  try {
    return projectGroupPublicText(value);
  } catch {
    return '这条消息因内容边界不完整而隐藏。';
  }
}
