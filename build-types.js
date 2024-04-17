const { Generator } = require("npm-dts");

console.log("Generating index.d.ts");
const generating = new Generator(
  {
    entry: "src/index.ts",
    output: "dist/index.d.ts",
  },
  false,
  true
)
  .generate()
  .then(() => console.log("Finished generating index.d.ts"))
  .catch(e => {
    for (const out of e.output || []) {
      if (out) {
        console.log(out.toString("utf-8"));
      }
    }
  });
