// 治理接口的动词表（M14）：名称、参数、落点、门。
// 这里是纯描述 + 路由校验；执行落在 scripts/interface.mjs（适配层）。

export const VERBS = {
  record: {
    kinds: ["round", "pending", "settle", "acceptance", "field"],
    params: ["--entry", "--from", "--text", "--conclusion", "--changes"],
    landing: "条目文件（由命令整条校验后写入）",
    gates: ["docs:check", "decision:advance"],
  },
  move: {
    kinds: [],
    params: [
      "--entry",
      "--stage",
      "--approval",
      "--decision",
      "--reason",
      "--design",
      "--new-batch",
      "--restore",
      "--from",
    ],
    landing: "条目文件（阶段与事件行）",
    gates: ["plan:check", "milestone:check", "docs:check"],
  },
  check: {
    kinds: ["stage", "acceptance", "transition", "net"],
    params: ["--entry", "--write", "--check"],
    landing: "只读（打印规则包 / 验收页 / 过渡文档状态）",
    gates: [],
  },
  audit: {
    kinds: [],
    params: ["--accept"],
    landing: "governance/rules-baseline.json（规则/门/命令计数）",
    gates: ["governance:test"],
  },
};

/**
 * 把 argv 解析成 {verb, kind, rest} 或 {error}。未知动词/未知对象都返回 error，
 * 让适配层统一报错，避免每个入口各自猜。
 */
export function route(argv) {
  const [verb, kind, ...rest] = argv;
  if (!verb) return { error: `缺少动词；可用 ${Object.keys(VERBS).join(" / ")}` };
  const entry = VERBS[verb];
  if (!entry) return { error: `未知动词「${verb}」；可用 ${Object.keys(VERBS).join(" / ")}` };
  if (verb === "audit") return { verb, kind: null, rest: [kind, ...rest].filter(Boolean) };
  if (!entry.kinds.length) return { verb, kind: null, rest: [kind, ...rest].filter(Boolean) };
  if (!kind) return { error: `${verb} 缺少对象；可用 ${entry.kinds.join(" / ")}` };
  if (!entry.kinds.includes(kind)) {
    return { error: `${verb} 不认识「${kind}」；可用 ${entry.kinds.join(" / ")}` };
  }
  return { verb, kind, rest };
}

export function describe(verb) {
  const entry = VERBS[verb];
  if (!entry) return null;
  return { ...entry, name: verb };
}
