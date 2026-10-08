import assert from "node:assert/strict";
import test from "node:test";
import { RECALL_QUERIES } from "../../src/server/recall-queries";

test("accepted playbook rule queries use the owner-scoped increasing-version recursive guard", () => {
  for (const key of ["available", "search", "rule"] as const) {
    const sql = RECALL_QUERIES[key];
    assert.ok(sql.includes("WITH RECURSIVE descendants"), `${key} is missing the recursive descendants guard`);
    assert.ok(sql.includes("n.user_id=r.user_id"), `${key} descendants are not owner-scoped`);
    assert.ok(sql.includes("n.version>parent.version"), `${key} descendants do not require increasing versions`);
    assert.ok(sql.includes("status='active' AND user_decision='accepted'"), `${key} does not gate on accepted active descendants`);
  }
  assert.ok(!RECALL_QUERIES.rule.includes("newer.previous_rule_id=r.id"), "rule still uses the direct-child-only filter");
});
