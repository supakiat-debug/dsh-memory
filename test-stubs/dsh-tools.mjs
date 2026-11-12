/**
 * Minimal stand-in for `@deepseek-ai/dsh-tools` used only by the smoke test.
 * The real package is provided by the harness at runtime (peer dependency);
 * the plugin only needs `defineTool` to hand the definition back.
 * @module test-stubs/dsh-tools
 */

/**
 * Identity stand-in for the harness tool definer.
 * @template {{ name: string }} T
 * @param {T} definition - a tool definition.
 * @returns {T} the same definition.
 */
export function defineTool(definition) {
  return definition;
}

export default { defineTool };
