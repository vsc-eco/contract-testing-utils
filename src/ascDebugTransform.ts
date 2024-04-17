// @ts-ignore
import { Transform } from "assemblyscript/transform";

class DebugTransform extends Transform {
  constructor() {
    super();

    const cleanup = async (code: number) => {
      const fs = await import("fs/promises");

      try {
        const {
          targets: {
            debug: { outFile },
          },
        } = JSON.parse(
          await fs.readFile("./asconfig.json", {
            encoding: "utf8",
          })
        );

        const jsFile = outFile.replace(".wasm", ".js");
        const codeToAdd = `\nexport const url = import.meta.url.replace(".js", ".wasm");`;
        await fs.appendFile(jsFile, codeToAdd);

        const dtsFile = outFile.replace(".wasm", ".d.ts");
        const typesToAdd = `\nexport declare const url: string;`;
        await fs.appendFile(dtsFile, typesToAdd);
      } catch {}

      process.exit(code);
    };

    process.on("SIGINT", () => cleanup(0));
    process.on("SIGTERM", () => cleanup(0));
    process.on("beforeExit", cleanup);
  }
}
export default DebugTransform;
