const formatter = new Intl.NumberFormat('zh-CN');

function measurement(value, unit) {
  return Number.isSafeInteger(value) && value >= 0
    ? `${formatter.format(value)} ${unit}`
    : `不可用 ${unit}`;
}

function tokenCount(value) {
  return Number.isSafeInteger(value) && value >= 0
    ? formatter.format(value)
    : '未知';
}

/** @param {{usageReceived:boolean,inputTokens:number|null,outputTokens:number|null,reasoningTokens?:number|null}} usage */
export function formatTokenUsageLabel(usage) {
  const reasoningLabel =
    usage.reasoningTokens === null || usage.reasoningTokens === undefined
      ? ''
      : ` · 推理 ${tokenCount(usage.reasoningTokens)}`;
  if (usage.inputTokens === null && usage.outputTokens === null) {
    if (!usage.usageReceived) return '用量未返回';
    return `输入 未知 · 输出 未知${reasoningLabel}`;
  }
  return `输入 ${tokenCount(usage.inputTokens)} · 输出 ${tokenCount(usage.outputTokens)}${reasoningLabel}`;
}

/** @param {{inputTokens:number|null,cachedInputTokens:number|null,cacheMissTokens:number|null,cacheWriteTokens?:number|null}} usage */
export function formatCacheBreakdownLabel(usage) {
  if (
    usage.cachedInputTokens === null &&
    usage.cacheMissTokens === null &&
    (usage.cacheWriteTokens === null || usage.cacheWriteTokens === undefined)
  ) {
    return usage.inputTokens === null ? null : '缓存分解 未知';
  }
  return `缓存命中 ${tokenCount(usage.cachedInputTokens)} · 未命中 ${tokenCount(usage.cacheMissTokens)} · 写入 ${tokenCount(usage.cacheWriteTokens)}`;
}

/** @param {{requestCharacters:number|null,toolDefinitionCharacters:number|null,messageCount:number|null,toolCount:number|null}} usage */
export function formatRequestShapeLabel(usage) {
  return [
    `消息数组 JSON ${measurement(usage.requestCharacters, '字符')}`,
    `工具定义 ${measurement(usage.toolDefinitionCharacters, '字符')}`,
    `${measurement(usage.messageCount, '条消息')}`,
    `${measurement(usage.toolCount, '个工具')}`,
  ].join(' · ');
}

const MESSAGE_ROLE_LABELS = [
  ['system', '系统'],
  ['developer', '开发者'],
  ['user', '用户'],
  ['assistant', '助手'],
  ['tool', '工具结果'],
  ['other', '其他'],
];

/** @param {Record<string, number>|null} roleCharacters */
export function formatMessageRoleCharactersLabel(roleCharacters) {
  if (!roleCharacters) return '消息对象 JSON 字符数不可用';
  return `消息对象 JSON 字符数（${MESSAGE_ROLE_LABELS.map(
    ([role, label]) => `${label} ${measurement(roleCharacters[role], '字符')}`,
  ).join(' · ')}）`;
}
