/**
 * `node --import ./test-register.mjs test-smoke.mjs` — installs the resolve hook.
 * @module test-register
 */
import { register } from 'node:module';

register('./test-hooks.mjs', import.meta.url);
