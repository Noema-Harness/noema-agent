import assert from "node:assert/strict";
import test from "node:test";

import { guardContribution, isMaintainer, MAINTAINER_ONLY_PATHS } from "./collaboration.mjs";

test("a collaborator can change product code and their own change", () => {
  const result = guardContribution({
    actor: "ichika0130",
    files: [
      "apps/desktop/src/main/platform/host-platform.ts",
      "openspec/changes/dsh-macos/tasks.md",
    ],
  });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.notices, []);
});

test("a collaborator cannot change maintainer paths", () => {
  const result = guardContribution({
    actor: "ichika0130",
    files: ["apps/desktop/src/main/main.ts", "scripts/workspace.config.json", "docs/STATUS.md"],
  });
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /scripts\/workspace\.config\.json/);
  assert.match(result.errors[0], /docs\/STATUS\.md/);
  assert.doesNotMatch(result.errors[0], /apps\/desktop\/src\/main\/main\.ts/);
});

test("a maintainer is not blocked by path rules", () => {
  const result = guardContribution({ actor: "c3115644151", files: [...MAINTAINER_ONLY_PATHS] });
  assert.deepEqual(result.errors, []);
  assert.equal(result.notices.length, 1);
  assert.match(result.notices[0], /维护者/);
});

test("an empty diff is reported instead of silently passing", () => {
  const result = guardContribution({ actor: "ichika0130", files: [] });
  assert.deepEqual(result.errors, []);
  assert.match(result.notices[0], /没有检测到改动文件/);
});

test("the configured maintainers include the repository owner", () => {
  assert.equal(isMaintainer("c3115644151"), true);
  assert.equal(isMaintainer("ichika0130"), false);
});
