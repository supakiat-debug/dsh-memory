/**
 * ESM resolve hook for the smoke test: maps the harness peer dependency
 * `@deepseek-ai/dsh-tools` onto the local stub. `@deepseek-ai/schemastery`
 * resolves normally (it is a real dependency).
 * @module test-hooks
 */
const STUB = new URL('./test-stubs/dsh-tools.mjs', import.meta.url).href;

/**
 * Redirect the stubbed specifier, defer everything else.
 * @param {string} specifier - requested module specifier.
 * @param {any} context - resolver context.
 * @param {Function} next - next resolver in the chain.
 */
export async function resolve(specifier, context, next) {
  if (specifier === '@deepseek-ai/dsh-tools') return { url: STUB, shortCircuit: true, format: 'module' };
  return next(specifier, context);
}
