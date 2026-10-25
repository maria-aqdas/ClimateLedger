// Run: node --test --experimental-strip-types lib/*.test.ts   (Node 22.6+)
import test from "node:test";
import assert from "node:assert/strict";
import { evaluateClimateRisk, type RiskInput } from "./riskEngine.ts";
import { createBlock, auditChainIntegrity, computeBlockHash, GENESIS_HASH, type LedgerBlock } from "./hashChain.ts";

const base: RiskInput = { city: "Multan", cropType: "banana", estimatedDiscolorationPct: 30, detectedLeafAreaPct: 40, relativeHumidityPct: 80, ozoneConcentration: 50, isMockData: false };
const ev = (o: Partial<RiskInput>) => evaluateClimateRisk({ ...base, ...o });

test("damage threshold boundary", () => {
  assert.equal(ev({ estimatedDiscolorationPct: 10 }).outcome, "ELIGIBLE");
  assert.equal(ev({ estimatedDiscolorationPct: 9.9 }).outcome, "NOT_ELIGIBLE");
});
test("humidity boundary, with ozone as the alternative", () => {
  assert.equal(ev({ relativeHumidityPct: 70 }).outcome, "ELIGIBLE");
  assert.equal(ev({ relativeHumidityPct: 69.9 }).outcome, "NOT_ELIGIBLE");
  assert.equal(ev({ relativeHumidityPct: 10, ozoneConcentration: 100 }).outcome, "ELIGIBLE");
  assert.equal(ev({ relativeHumidityPct: 10, ozoneConcentration: 99.9 }).outcome, "NOT_ELIGIBLE");
});
test("missing data never passes a rule", () => {
  const r = ev({ relativeHumidityPct: undefined, ozoneConcentration: 50 });
  assert.equal(r.outcome, "NOT_EVALUABLE");
  assert.equal(r.rulesEvaluated[1].status, "DATA_UNAVAILABLE");
  assert.equal(ev({ relativeHumidityPct: undefined, ozoneConcentration: undefined }).isEligibleForPayout, false);
  assert.equal(ev({ estimatedDiscolorationPct: undefined }).outcome, "NOT_EVALUABLE");
  assert.equal(ev({ relativeHumidityPct: undefined, ozoneConcentration: 120 }).outcome, "ELIGIBLE");
});
test("invalid numbers are treated as unavailable", () => {
  assert.equal(ev({ estimatedDiscolorationPct: NaN }).rulesEvaluated[0].status, "DATA_UNAVAILABLE");
  assert.equal(ev({ relativeHumidityPct: 140 }).rulesEvaluated[1].status, "DATA_UNAVAILABLE");
  assert.equal(ev({ ozoneConcentration: Infinity }).rulesEvaluated[2].status, "DATA_UNAVAILABLE");
});
test("trust score drops for mock data and low leaf area, and gates eligibility", () => {
  assert.equal(ev({}).trustScore, 100);
  assert.equal(ev({ isMockData: true }).trustScore, 80);
  assert.equal(ev({ isMockData: true, detectedLeafAreaPct: 5 }).trustScore, 55);
  assert.equal(ev({ isMockData: true, detectedLeafAreaPct: 5 }).outcome, "NOT_ELIGIBLE");
});

const mk = async (n: number) => { const c: LedgerBlock[] = []; for (let i = 0; i < n; i++) c.push(await createBlock(c, { timestamp: `2026-10-24T10:0${i}:00Z`, city: "Multan", crop: "banana", damagePct: 10 + i, evidenceHash: "e".repeat(64) })); return c; };
test("valid chain passes and uses the documented genesis hash", async () => {
  const c = await mk(3);
  assert.equal(c[0].previousHash, GENESIS_HASH);
  assert.deepEqual(await auditChainIntegrity(c), { isValid: true, brokenBlockIndex: null, invalidBlocks: [], errorMessage: null });
});
test("editing a block's data is detected at that block", async () => {
  const c = await mk(3); c[1].damagePct = 99;
  const a = await auditChainIntegrity(c);
  assert.equal(a.isValid, false); assert.equal(a.brokenBlockIndex, 1);
});
test("recomputing the edited block's hash breaks the next block's link (later blocks stay self-consistent)", async () => {
  const c = await mk(4); c[1].damagePct = 99;
  c[1].blockHash = await computeBlockHash(c[1].index, c[1].timestamp, c[1].city, c[1].crop, c[1].damagePct, c[1].evidenceHash, c[1].previousHash);
  const a = await auditChainIntegrity(c);
  assert.equal(a.brokenBlockIndex, 2); assert.deepEqual(a.invalidBlocks, [2]);
});
test("bad genesis link and malformed blocks are reported without throwing", async () => {
  const c = await mk(2); c[0].previousHash = "x";
  assert.equal((await auditChainIntegrity(c)).brokenBlockIndex, 0);
  const m = await mk(2); (m[1] as unknown as { damagePct: unknown }).damagePct = "n/a";
  assert.equal((await auditChainIntegrity(m)).isValid, false);
});
test("separator characters in values cannot collide", async () => {
  const a = await computeBlockHash(1, "t", "a|b", "c", 1, "e", "p");
  const b = await computeBlockHash(1, "t", "a", "b|c", 1, "e", "p");
  assert.notEqual(a, b);
});
