import { describe, expect, it } from "vitest";
import { countBlockingImportRows, filterImportConflicts, isImportRowBlocking } from "./import-resolution";

const row = (rowId: string, resolutionStatus: string, blocksCommit = false) => ({ rowId, resolutionStatus, blocksCommit });

describe("classificação de staging", () => {
  it("info e warning não transformam linha pronta em bloqueio", () => expect(isImportRowBlocking(row("1", "ready_unchanged"))).toBe(false));
  it("pending_decision e blocked_invalid bloqueiam", () => { expect(isImportRowBlocking(row("1", "pending_decision"))).toBe(true); expect(isImportRowBlocking(row("2", "blocked_invalid"))).toBe(true); });
  it("conta linhas únicas e não a quantidade de issues", () => expect(countBlockingImportRows([row("1", "pending_decision"), row("1", "pending_decision"), row("2", "ready_create")])).toBe(1));
  it("filtro de conflitos exclui unchanged", () => expect(filterImportConflicts([row("1", "ready_unchanged"), row("2", "blocked_invalid")], true).map((item) => item.rowId)).toEqual(["2"]));
});
