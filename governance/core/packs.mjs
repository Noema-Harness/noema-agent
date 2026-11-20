// 治理内核：规则包里的门引用。
// 规则包只是提示层，检查项必须绑定真实登记的门：这里只负责取出 gate:<id> 并校验。
// 本模块不写死任何项目词汇，门 id 列表由适配层注入。

/** 取规则包正文里出现的 gate id（去重、保持顺序）。 */
export function gateIds(packText) {
  const seen = [];
  for (const match of String(packText).matchAll(/gate:([a-z0-9-]+)/gu)) {
    if (!seen.includes(match[1])) seen.push(match[1]);
  }
  return seen;
}

/** 规则包引用了未登记的门时返回缺失列表；空数组表示通过。 */
export function missingGates(packText, knownIds) {
  const known = new Set(knownIds);
  return gateIds(packText).filter((id) => !known.has(id));
}
