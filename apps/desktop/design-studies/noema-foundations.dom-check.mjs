// UI logic check, not a browser rendering/aesthetic check.
// Install once: npm install --prefix .tmp/study-checks --ignore-scripts happy-dom@21.0.4
// Run from repository root: node apps/desktop/design-studies/noema-foundations.dom-check.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const { Window } = await import(
  new URL("../../../.tmp/study-checks/node_modules/happy-dom/lib/index.js", import.meta.url)
);
const html = readFileSync(new URL("./noema-continuity-structures.html", import.meta.url), "utf8");
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const win = new Window({ url: "http://127.0.0.1:3924/" });
const errors = [];
win.console.error = (...items) => errors.push(items.join(" "));
win.addEventListener("error", (event) => errors.push(event.message));
const timers = [];
win.setTimeout = (fn, ms) => {
  timers.push({ fn, ms });
  return timers.length;
};
win.clearTimeout = () => {};
win.ResizeObserver = class {
  observe() {}
  disconnect() {}
};
win.document.write(
  html.replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").replace(/<style>[\s\S]*?<\/style>/g, ""),
);
win.eval('"use strict";\n' + scripts.join("\n"));
const doc = win.document;
const query = (selector) => {
  const node = doc.querySelector(selector);
  assert.ok(node, `missing ${selector}`);
  return node;
};
const click = async (selector) => {
  query(selector).click();
  await Promise.resolve();
};
const input = (selector, value) => {
  const node = query(selector);
  node.value = value;
  node.dispatchEvent(new win.Event("input", { bubbles: true }));
};
const submit = (selector) =>
  query(selector).dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
let checks = 0;
function check(name, fn) {
  fn();
  checks++;
  console.log(`OK ${name}`);
}

check("C remains selected; one settings entry", () => {
  assert.equal(query('[data-layout="c"]').getAttribute("aria-pressed"), "true");
  assert.equal(doc.querySelectorAll('[data-action="settings"]').length, 1);
});
check("empty draft cannot send", () => assert.equal(query(".composer .send").disabled, true));
input(".index-search input", "不存在的成员");
check("sidebar has honest no-match state", () => assert.equal(query(".index-empty").hidden, false));
input(".index-search input", "新闻");
check("sidebar filter retains matching member only", () => {
  assert.equal(query('.index [data-member="research"]').hidden, false);
  assert.equal(query('.index [data-member="designer"]').hidden, true);
});
input(".index-search input", "");
input(".composer textarea", "第一条演示");
submit(".composer");
check("sending starts a stoppable reply", () => assert.ok(query('[data-action="stop-reply"]')));
input(".composer textarea", "第二条排队");
submit(".composer");
check("busy input becomes a queue item, not a delivered user message", () => {
  assert.equal(doc.querySelectorAll(".queue-row").length, 1);
  assert.equal(
    [...doc.querySelectorAll(".message.user")].filter((n) => n.textContent.includes("第二条排队"))
      .length,
    0,
  );
});
input(".composer textarea", "保留已有草稿");
await click('[data-action="withdraw-queued"]');
check("withdrawing merges with existing draft", () =>
  assert.equal(query(".composer textarea").value, "保留已有草稿\n\n第二条排队"),
);
await click('[data-action="stop-reply"]');
check("stop preserves the original message and removes active stop control", () => {
  assert.ok(doc.querySelector('[data-action="retry-reply"]'));
  assert.equal(doc.querySelector('[data-action="stop-reply"]'), null);
});
await click('[data-action="find-messages"]');
input("#message-search", "第一条");
check("message search only indexes current conversation", () =>
  assert.ok(query("#search-results").textContent.includes("第一条演示")),
);
await click('[data-action="close-dialog"]');
await click('.message.assistant [data-action="quote-message"]');
check("quoting keeps the unsent draft", () => {
  assert.equal(query(".composer textarea").value, "保留已有草稿\n\n第二条排队");
  assert.ok(query(".draft-quote"));
});
await click('.index [data-action="member-main"][data-member="research"]');
check("private member draft is isolated", () =>
  assert.equal(query(".session-content .composer textarea").value, ""),
);
await click('.index [data-action="home"]');
check("returning restores main draft", () =>
  assert.equal(query(".chat .composer textarea").value, "保留已有草稿\n\n第二条排队"),
);
await click('[data-action="settings"]');
query("#model-choice").value = "reasoning";
submit('[data-form="settings"]');
check("model is stored for future turns", () =>
  assert.equal(JSON.parse(win.localStorage.getItem("noema-structure-study-v3")).model, "reasoning"),
);

// The same change handler used by picker, drop and paste. No browser upload is involved.
const picker = query('input[data-file-scope="core"]');
Object.defineProperty(picker, "files", {
  value: [new win.File(["abc"], "note.txt", { type: "text/plain" })],
  configurable: true,
});
picker.dispatchEvent(new win.Event("change", { bubbles: true }));
check("accepted file appears in the original composer", () =>
  assert.ok(query(".composer-files").textContent.includes("note.txt")),
);
const bad = query('input[data-file-scope="core"]');
Object.defineProperty(bad, "files", {
  value: [new win.File(["bad"], "program.exe", { type: "application/octet-stream" })],
  configurable: true,
});
bad.dispatchEvent(new win.Event("change", { bubbles: true }));
check("unsupported attachment is explicit and blocks sending", () => {
  assert.ok(query(".attachment-chip.problem").textContent.includes("不支持"));
  assert.equal(query(".composer .send").disabled, true);
});
await click('.attachment-chip.problem [data-action="remove-attachment"]');
check("removing invalid attachment restores send eligibility", () =>
  assert.equal(query(".composer .send").disabled, false),
);

await click('[data-scene="execution"]');
check("delegated execution starts at authorization", () => {
  assert.ok(query('.chat [data-action="work-allow-once"]'));
  assert.equal(doc.querySelector('[data-action="simulate-work-step"]'), null);
});
await click('.chat [data-action="work-deny"]');
check("denied request cannot execute", () =>
  assert.ok(query(".work-request").textContent.includes("已拒绝")),
);
await click('.chat [data-action="work-reapply"]');
await click('.chat [data-action="work-allow-project"]');
await click('[data-action="simulate-work-step"]');
await click('[data-action="simulate-work-failure"]');
check("write interruption asks for reconciliation, not blind retry", () =>
  assert.ok(query('[data-action="work-resume"]').textContent.includes("核对")),
);
await click('[data-action="work-resume"]');
await click('[data-action="simulate-write-applied"]');
await click('[data-action="simulate-work-step"]');
check("reconciled execution completes with prior steps retained", () =>
  assert.ok(query(".work-request").textContent.includes("执行完成")),
);
await click('[data-action="settings"]');
input("#partner-name", "尚未保存的名字");
await click('[data-action="work-revoke"]');
check("revoked project grant is no longer presented as active", () =>
  assert.equal(doc.querySelector('[data-action="work-revoke"]'), null),
);

check("settings remain open after permission revocation", () =>
  assert.equal(query("#dialog").open, true),
);
check("unsaved settings are preserved", () =>
  assert.equal(query("#partner-name").value, "尚未保存的名字"),
);
await click('[data-action="close-dialog"]');
await click('[data-scene="review"]');
input("#review-feedback", "保留主聊中的评审");
await click('.index [data-action="open-project"]');
await click('[data-action="locate-review"]');
check("project reminder returns to original review with its draft intact", () =>
  assert.equal(query("#review-feedback").value, "保留主聊中的评审"),
);
submit('[data-form="review"]');
check("feedback submission does not directly resume the project", () =>
  assert.ok(query('[data-action="simulate-handoff"]')),
);
await click('[data-action="simulate-handoff"]');
await click('.index [data-action="open-project"]');
check("Noema handoff updates project state", () =>
  assert.ok(query(".workspace").textContent.includes("正在按你的反馈调整")),
);
check("no script errors", () => assert.deepEqual(errors, []));
console.log(`${checks} UI logic checks passed; no real browser rendering verified.`);
await win.happyDOM.abort();
win.close();
