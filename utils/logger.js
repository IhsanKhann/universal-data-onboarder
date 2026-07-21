/**
 * Minimal structured logger for the universal data onboarder.
 *
 * Wraps console with a consistent prefix and structured log-object support.
 * Can be replaced with any Logger implementation that matches this interface.
 *
 * @typedef {Object} Logger
 * @property {(msg: string, meta?: object) => void} info
 * @property {(msg: string, meta?: object) => void} warn
 * @property {(msg: string, meta?: object) => void} error
 * @property {(msg: string, meta?: object) => void} debug
 */

const PREFIX = "[onboarder]";

function log(level, msg, meta) {
  const line = meta != null ? `${PREFIX} ${msg} ${JSON.stringify(meta)}` : `${PREFIX} ${msg}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/** @type {Logger} */
const logger = {
  info:  (msg, meta) => log("info", msg, meta),
  warn:  (msg, meta) => log("warn", msg, meta),
  error: (msg, meta) => log("error", msg, meta),
  debug: (msg, meta) => log("debug", msg, meta),
};

export default logger;
