/**
 * Zero-dependency TS resolve hook: lets bare `node --experimental-strip-types`
 * resolve the engine's extensionless relative imports (./leash-engine) by
 * retrying with .ts. Registered via --import, no packages needed.
 */
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (err?.code === "ERR_MODULE_NOT_FOUND" && (specifier.startsWith("./") || specifier.startsWith("../"))) {
      return await next(`${specifier}.ts`, context);
    }
    throw err;
  }
}
