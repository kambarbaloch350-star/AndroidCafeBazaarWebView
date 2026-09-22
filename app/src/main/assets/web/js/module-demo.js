/**
 * module-demo.js
 * ==============
 *
 * Tiny ES module used by the container self-test to prove that native ES
 * modules, dynamic `import()` and the `text/javascript` MIME type served by the
 * embedded HTTP server all work — a hard requirement for Vite/Webpack/Next
 * style bundles.
 */
export const name = 'module-demo';

export function describe() {
  return `esm ok · ${name} · ${new Date().toISOString().substring(0, 19)}`;
}

export default { name, describe };
