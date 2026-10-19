// Node ESM resolver hook: try the literal specifier first, then common
// TypeScript extensions for relative imports. This mirrors Metro/TypeScript
// resolution for the pure utility modules exercised by unit tests.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (
      error?.code === 'ERR_MODULE_NOT_FOUND' &&
      (specifier.startsWith('./') || specifier.startsWith('../'))
    ) {
      for (const suffix of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
        try {
          return await nextResolve(specifier + suffix, context);
        } catch {
          // Try the next candidate.
        }
      }
    }
    throw error;
  }
}
