import { ripemd160, sha256 } from "bitcoinjs-lib/src/crypto";

import { has } from "./utils";

if (typeof globalThis.alert !== "undefined") {
  await import("mocha").then(Mocha => {
    Mocha.setup("bdd");
    mocha.timeout(0);
    setTimeout(() => Mocha.run(), 1000);
  });
}

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
} = {
  "anchor.id": "",
  "anchor.block": "",
  "anchor.timestamp": 0,
  "anchor.height": 0,

  "msg.sender": "",
  "msg.required_auths": [],
  "tx.origin": "",
};
/**
 * Cache for current contract state
 */
export const stateCache = new Map();
/**
 * Contract instance
 */
export let contract: Awaited<
  ReturnType<VscContractTestingUtils.ContractType["instantiate"]>
>;

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
        return globalThis.WebAssembly.compile(
          await (
            await import("node:fs/promises")
          ).readFile(url.slice("file://".length))
        );
      }
    })(),
    globals
  );
}

let importer: Promise<VscContractTestingUtils.ContractType>;

export function setContractImport(
  importPromise: Promise<VscContractTestingUtils.ContractType>
) {
  importer = importPromise;
}

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
  };
  stateCache.clear();
  contract = await instantiateContract(importer);
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
