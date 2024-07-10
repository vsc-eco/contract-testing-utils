import { describe, expect, it } from "vitest";
import { contract_id, contractEnv, setContractId } from "../src/mocks";

describe("contract_id", () => {
  it("should update contractEnv.contract_id when changed", () => {
    expect(contract_id).toStrictEqual(contractEnv.contract_id);
    expect(contract_id).not.toStrictEqual("test");
    setContractId("test");
    expect(contract_id).toStrictEqual(contractEnv.contract_id);
    expect(contract_id).toStrictEqual("test");
  });
});
