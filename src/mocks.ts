import { ripemd160, sha256 } from "bitcoinjs-lib/src/crypto";
import { ser, ValidateSPV } from "@summa-tx/bitcoin-spv-js";
import sift, { Query } from "sift";
import { bech32 } from "bech32";

import { has } from "./utils";

interface LedgerIn {
  amount: number;
  from: string;
  owner: string;
  unit: "HBD" | "HIVE";
  dest?: string;
}
interface LedgerOut {
  amount: number;
  owner: string;
  to: string;
  unit: "HBD" | "HIVE";
  dest?: string;
}
export type LedgerType = LedgerIn | LedgerOut;

export type BalanceSnapshot = {
  account: string;
  tokens: {
    HIVE: number;
    HBD: number;
  };
};

if (typeof globalThis.alert !== "undefined") {
  await import("mocha").then(({ default: Mocha }) => {
    Mocha.setup("bdd");
    mocha.timeout(0);
    setTimeout(() => Mocha.run(), 1000);
  });
  //@ts-ignore
  globalThis.beforeAll = globalThis.beforeAll || globalThis.before;
}

/**
 * The address of the {@link contract} when being executed.
 *
 * This does not get cleared when {@link reset()} is called
 *
 * @default
 * bech32.encode("vs4", bech32.toWords(new Uint8Array(32)))
 */
export let contract_id: Readonly<string> = bech32.encode(
  "vs4",
  bech32.toWords(new Uint8Array(32))
);
/**
 * Raw WebAssembly Memory
 */
export let memory: WebAssembly.Memory;
/**
 * Total gas used in current test
 */
export let IOGas = 0;
/**
 * Error thrown by contract
 */
export let error: any;
/**
 * Logs printed in current test
 */
export let logs: string[] = [];
/**
 * Environment variables available to the contract
 */
export let contractEnv: {
  "anchor.id": string;
  "anchor.block": string;
  "anchor.timestamp": number;
  "anchor.height": number;

  "msg.sender": string;
  "msg.required_auths": Array<string>;
  "tx.origin": string;

  get contract_id(): string;
} = {
  "anchor.id": "",
  "anchor.block": "",
  "anchor.timestamp": 0,
  "anchor.height": 0,

  "msg.sender": "",
  "msg.required_auths": [],
  "tx.origin": "",

  contract_id,
};
/**
 * Cache for current contract state
 */
export const stateCache = new Map<string, string>();
/**
 * @readonly
 * Temporary cache for current contract state before transaction is finalized
 * @see {@link finalizeTransaction}
 */
export const tmpState = new Map<string, string>();
/**
 * HBD & Hive balances for all addresses
 */
export const balanceSnapshots = new Map<string, BalanceSnapshot>();
/**
 * Finalized HBD & Hive transactions
 */
export let ledgerStack: LedgerType[] = [];
/**
 * @readonly
 * Temporary HBD & Hive transactions before transaction is finalized
 * @see {@link finalizeTransaction}
 */
export let ledgerStackTemp: LedgerType[] = [];
/**
 * The intents of the transaction
 */
export let intents: {
  name: string;
  args: Record<string, unknown>;
}[] = [];
/**
 * Contract instance
 */
export let contract: Awaited<
  ReturnType<VscContractTestingUtils.ContractType["instantiate"]>
>;

export function setContractId(id: string) {
  contract_id = id;
  // @ts-ignore this readonly can be ignored this type is just so consumers of the library don't modify this field directly
  contractEnv.contract_id = id;
}

async function instantiateContract<
  R,
  T extends {
    url: string;
    instantiate(
      module: WebAssembly.Module,
      imports: typeof globals
    ): Promise<R>;
  },
>(importPromise: Promise<T>): Promise<R> {
  const { instantiate, url } = await importPromise;
  return instantiate(
    await (async () => {
      try {
        return await globalThis.WebAssembly.compileStreaming(
          globalThis.fetch(url)
        );
      } catch {
        const URL = await import("url");
        return globalThis.WebAssembly.compile(
          await (
            await import("node:fs/promises")
          ).readFile(URL.fileURLToPath(url))
        );
      }
    })(),
    globals
  );
}

let importer: Promise<VscContractTestingUtils.ContractType>;

/**
 * Sets the contract module in a type safe way
 * @param importPromise an import {@link Promise} to the contract module
 *
 * @example
 * setContractImport(import('../build/debug'))
 */
export function setContractImport(
  importPromise: Promise<VscContractTestingUtils.ContractType>
) {
  importer = importPromise;
}

/**
 * Cleans up all state accessable from this module including creation of a new {@link contract} instance
 */
export async function reset() {
  memory = new WebAssembly.Memory({
    initial: 10,
    maximum: 128,
  });
  IOGas = 0;
  error = undefined;
  logs = [];
  contractEnv = {
    "anchor.id": "",
    "anchor.block": "",
    "anchor.timestamp": 0,
    "anchor.height": 0,

    "msg.sender": "",
    "msg.required_auths": [],
    "tx.origin": "",

    contract_id,
  };
  stateCache.clear();
  tmpState.clear();
  ledgerStack = [];
  ledgerStackTemp = [];
  balanceSnapshots.clear();
  contract = await instantiateContract(importer);
}

export function finalizeTransaction() {
  for (let [key, value] of tmpState.entries()) {
    stateCache.set(key, value);
  }
  tmpState.clear();

  ledgerStack.push(...ledgerStackTemp);
  ledgerStackTemp = [];
}

function getBalanceSnapshot(account: string): BalanceSnapshot {
  if (balanceSnapshots.has(account)) {
    const balance = balanceSnapshots.get(account)!;
    const combinedLedger = [...ledgerStack, ...ledgerStackTemp];
    const hbdBal = combinedLedger
      .filter(e => e.amount && e.unit === "HBD")
      .map(e => e.amount)
      .reduce((acc, cur) => acc + cur, balance.tokens["HBD"]);
    const hiveBal = combinedLedger
      .filter(e => e.amount && e.unit === "HIVE")
      .map(e => e.amount)
      .reduce((acc, cur) => acc + cur, balance.tokens["HIVE"]);

    return {
      account: account,
      tokens: {
        HIVE: hiveBal,
        HBD: hbdBal,
      },
    };
  } else {
    const balanceSnapshot: BalanceSnapshot = {
      account: account,
      tokens: {
        HIVE: 0,
        HBD: 0,
      },
    };
    balanceSnapshots.set(account, balanceSnapshot);
    return balanceSnapshot;
  }
}

function applyLedgerOp(op: LedgerType) {
  ledgerStackTemp.push(op);
}

function verifyIntent(
  name: string,
  conditions?: Record<string, Query<string | number>>
): boolean {
  intentsLoop: for (let intent of intents) {
    if (intent.name !== name) {
      continue;
    }

    for (let conditionName in conditions) {
      const filterData = conditions[conditionName];
      const filter = sift(filterData);

      if (!filter(intent.args[conditionName])) {
        continue intentsLoop;
      }
    }
    return true;
  }
  return false;
}

/**
 * Contract System calls
 */
const contractCalls = {
  "crypto.sha256": (
    value:
      | WithImplicitCoercion<string>
      | { [Symbol.toPrimitive](hint: "string"): string }
  ) => {
    return sha256(Buffer.from(value, "hex")).toString("hex");
  },
  "crypto.ripemd160": (
    value:
      | WithImplicitCoercion<string>
      | { [Symbol.toPrimitive](hint: "string"): string }
  ) => {
    return ripemd160(Buffer.from(value, "hex")).toString("hex");
  },
  "bitcoin.validateSPVProof"(value: string) {
    try {
      return ValidateSPV.validateProof(ser.deserializeSPVProof(value));
    } catch (e) {
      console.warn("bitcoin.validateSPVProof threw an error:", e);
      return false;
    }
  },
  "hive.getbalance": (value: string) => {
    const args: {
      account: string;
      tag?: string;
    } = JSON.parse(value);
    const snapshot = getBalanceSnapshot(
      `${args.account}${args.tag ? "#" + args.tag.replace("#", "") : ""}`
    );

    return {
      result: snapshot.tokens,
    };
  },
  //Pulls token balance from user transction
  "hive.draw": (value: string) => {
    const args: {
      from: string;
      amount: number;
      asset: "HIVE" | "HBD";
    } = JSON.parse(value);
    const snapshot = getBalanceSnapshot(args.from);

    //Total amount drawn from ledgerStack during this execution
    const totalAmountDrawn = Math.abs(
      ledgerStackTemp
        .filter(
          sift({
            owner: args.from,
            to: contract_id,
            unit: args.asset,
          })
        )
        .reduce((acc: any, cur: { amount: any }) => acc + cur.amount, 0)
    );

    const allowedByIntent = verifyIntent("hive.allow_transfer", {
      token: {
        $eq: args.asset.toLowerCase(),
      },
      limit: {
        $gte: args.amount + totalAmountDrawn,
      },
    });

    if (!allowedByIntent) {
      return {
        result: "MISSING_INTENT_HEADER",
      };
    }

    if (snapshot.tokens[args.asset] >= args.amount) {
      applyLedgerOp({
        owner: args.from,
        to: contract_id,
        amount: -args.amount,
        unit: args.asset,
      });
      applyLedgerOp({
        from: args.from,
        owner: contract_id,
        amount: args.amount,
        unit: args.asset,
      });
      return {
        result: "SUCCESS",
      };
    } else {
      return {
        result: "INSUFFICIENT_FUNDS",
      };
    }
  },
  //Transfer tokens owned by contract to another user or
  "hive.transfer": (value: string) => {
    const args: {
      dest: string;
      amount: number;
      asset: "HIVE" | "HBD";
    } = JSON.parse(value);
    const snapshot = getBalanceSnapshot(contract_id);
    if (snapshot.tokens[args.asset] >= args.amount) {
      applyLedgerOp({
        owner: contract_id,
        to: args.dest,
        amount: -args.amount,
        unit: args.asset,
      });
      applyLedgerOp({
        owner: args.dest,
        from: contract_id,
        amount: args.amount,
        unit: args.asset,
      });

      return {
        result: "SUCCESS",
      };
    } else {
      return {
        result: "INSUFFICIENT_FUNDS",
      };
    }
  },
  //Triggers withdrawal of tokens owned by contract
  "hive.withdraw": (value: string) => {
    const args: {
      dest: string;
      amount: number;
      asset: "HIVE" | "HBD";
    } = JSON.parse(value);
    const snapshot = getBalanceSnapshot(contract_id);

    if (snapshot.tokens[args.asset] >= args.amount) {
      applyLedgerOp({
        owner: contract_id,
        to: "#withdraw",
        amount: -args.amount,
        unit: args.asset,
        dest: args.dest,
      });
      return {
        result: "SUCCESS",
      };
    } else {
      return {
        result: "INSUFFICIENT_FUNDS",
      };
    }
  },
};

const globals = {
  env: {
    get memory() {
      return memory;
    },
    abort(msg: any, file: any, line: any, colm: any) {
      error = {
        msg, //: insta.exports.__getString(msg),
        file, //: insta.exports.__getString(file),
        line,
        colm,
      };
    },
    //Prevent AS loader from allowing any non-deterministic data in.
    //TODO: Load in VRF seed for use in contract
    seed: () => {
      return 0;
    },
  },
  //Same here
  Date: {},
  Math: {},
  sdk: {
    revert() {
      ledgerStackTemp = [];
      tmpState.clear();
    },
    console: {
      get log() {
        return globals.sdk["console.log"];
      },
      get logNumber() {
        return globals.sdk["console.logNumber"];
      },
      get logBool() {
        return globals.sdk["console.logBool"];
      },
    },
    "console.log": (keyPtr: string) => {
      const logMsg = keyPtr; // (insta as any).exports.__getString(keyPtr);
      logs.push(logMsg);
      console.log(logMsg);
      IOGas = IOGas + logMsg.length;
    },
    "console.logNumber": (val: number) => {
      logs.push(val.toString());
      console.log(val);
    },
    "console.logBool": (val: boolean) => {
      logs.push(Boolean(val).toString());
      console.log(val);
    },
    db: {
      get setObject() {
        return globals.sdk["db.setObject"];
      },
      get getObject() {
        return globals.sdk["db.getObject"];
      },
      get delObject() {
        return globals.sdk["db.delObject"];
      },
    },
    "db.setObject": (keyPtr: string, valPtr: string) => {
      const key = keyPtr; //(insta as any).exports.__getString(keyPtr);
      const val = valPtr; //(insta as any).exports.__getString(valPtr);

      IOGas = IOGas + key.length + val.length;

      stateCache.set(key, val);
      return 1;
    },
    "db.getObject": (keyPtr: string) => {
      const key = keyPtr; //(insta as any).exports.__getString(keyPtr);
      const value = stateCache.get(key) ?? null;

      const val = JSON.stringify(value);

      IOGas = IOGas + val.length; // Total serialized length of gas

      return value ?? "null"; //insta.exports.__newString(val);
    },
    "db.delObject": (keyPtr: string) => {
      const key = keyPtr; //(insta as any).exports.__getString(keyPtr);
      stateCache.delete(key);
    },
    system: {
      get getEnv() {
        return globals.sdk["system.getEnv"];
      },
      get call() {
        return globals.sdk["system.call"];
      },
    },
    "system.call": (callPtr: string, valPtr: string) => {
      const callArg = callPtr; //insta.exports.__getString(callPtr);
      const valArg = JSON.parse(valPtr); //insta.exports.__getString(valPtr));
      let resultData: string;
      if (has(contractCalls, callArg)) {
        resultData = JSON.stringify({
          result: contractCalls[callArg](valArg.arg0),
        });
      } else {
        resultData = JSON.stringify({
          err: "INVALID_CALL",
        });
      }

      return resultData; //insta.exports.__newString(resultData);
    },
    "system.getEnv": (envPtr: string) => {
      const envArg = envPtr; //insta.exports.__getString(envPtr);

      if (!has(contractEnv, envArg)) {
        throw new Error(
          `key not in contract environment: ${envArg}\nexpecting one of: ${Object.keys(contractEnv).join(", ")}`
        );
      }
      return typeof contractEnv[envArg] === "string"
        ? contractEnv[envArg]
        : JSON.stringify(contractEnv[envArg]); //insta.exports.__newString(contractEnv[envArg]);
    },
  },
};
