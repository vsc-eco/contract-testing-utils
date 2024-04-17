declare namespace VscContractTestingUtils {
  export type ContractType = {
    url: string;
    instantiate(module: WebAssembly.Module, imports: any): Promise<unknown>;
    // @ts-ignore
  } & Contract;
}
