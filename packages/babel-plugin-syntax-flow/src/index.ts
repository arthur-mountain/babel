import { declare } from "@babel/helper-plugin-utils";

export interface Options {
  all?: boolean;
  enums?: boolean;
}

export default declare((api, options: Options) => {
  api.assertVersion(REQUIRED_VERSION(7));

  // When enabled and plugins includes flow, all files should be parsed as if
  // the @flow pragma was provided.
  const { all, enums } = options;

  if (typeof all !== "boolean" && all !== undefined) {
    throw new Error(".all must be a boolean, or undefined");
  }

  if (typeof enums !== "boolean" && enums !== undefined) {
    throw new Error(".enums must be a boolean, or undefined");
  }

  return {
    name: "syntax-flow",

    manipulateOptions(opts, parserOpts) {
      if (!process.env.BABEL_8_BREAKING) {
        // If the file has already enabled TS, assume that this is not a
        // valid Flowtype file.
        if (
          parserOpts.plugins.some(
            p => (Array.isArray(p) ? p[0] : p) === "typescript",
          )
        ) {
          return;
        }
      }

      parserOpts.plugins.push(["flow", { all, enums }]);
    },
  };
});
