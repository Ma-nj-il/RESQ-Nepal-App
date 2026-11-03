import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import ts from 'typescript';

/** Validate complete static SQL against the migrated schema, including parameter inference.
 * Interpolated queries still require their operation-specific integration scenarios.
 */
export function staticPostgresQueries(root: string): readonly { label: string; sql: string }[] {
  const queries: { label: string; sql: string }[] = [];
  function directory(path: string): void {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) directory(file);
      else if (entry.isFile() && file.endsWith('.ts')) {
        const source = ts.createSourceFile(
          file,
          readFileSync(file, 'utf8'),
          ts.ScriptTarget.Latest,
          true,
        );
        function visit(node: ts.Node): void {
          if (
            (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
            ts.isCallExpression(node.parent) &&
            node.parent.arguments.includes(node) &&
            /^(SELECT|INSERT|UPDATE|DELETE)\s/i.test(node.text.trim())
          ) {
            const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
            queries.push({ label: `${relative(root, file)}:${String(line)}`, sql: node.text });
          }
          ts.forEachChild(node, visit);
        }
        visit(source);
      }
    }
  }
  directory(root);
  return queries;
}
