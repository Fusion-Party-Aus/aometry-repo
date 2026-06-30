/**
 * Stub of the host bot's `@/utilities/Logger` module, for CI typechecking only.
 */
const Logger = {
  info: (...args: unknown[]): void => console.log(...args),
  warn: (...args: unknown[]): void => console.warn(...args),
  error: (...args: unknown[]): void => console.error(...args),
  debug: (...args: unknown[]): void => console.debug(...args),
};

export default Logger;
