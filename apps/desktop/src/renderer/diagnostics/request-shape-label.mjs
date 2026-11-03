const formatter = new Intl.NumberFormat('zh-CN');

function measurement(value, unit) {
  return Number.isSafeInteger(value) && value >= 0
    ? `${formatter.format(value)} ${unit}`
    : `不可用 ${unit}`;
}

/** @param {{requestCharacters:number|null,toolDefinitionCharacters:number|null,messageCount:number|null,toolCount:number|null}} usage */
export function formatRequestShapeLabel(usage) {
  return [
    `请求 JSON ${measurement(usage.requestCharacters, '字符')}`,
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
