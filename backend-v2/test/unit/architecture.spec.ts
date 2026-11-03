import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import ts from 'typescript';

type Layer = 'domain' | 'application' | 'infrastructure' | 'presentation' | 'other';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && path.endsWith('.ts') ? [path] : [];
  });
}

function layer(path: string): Layer {
  for (const candidate of ['domain', 'application', 'infrastructure', 'presentation'] as const) {
    if (path.includes(`${sep}${candidate}${sep}`)) return candidate;
  }
  return 'other';
}

function importsIn(file: string): string[] {
  const parsed = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const imports: string[] = [];
  parsed.forEachChild((node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push(node.moduleSpecifier.text);
    }
  });
  return imports;
}

function resolveLocalImport(file: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const withoutRuntimeExtension = specifier.replace(/\.js$/, '');
  const candidate = resolve(dirname(file), `${withoutRuntimeExtension}.ts`);
  return existsSync(candidate) ? candidate : undefined;
}

describe('Clean Architecture dependency rules', () => {
  const root = resolve(process.cwd(), 'src');
  const forbiddenDomainPackages = [
    '@nestjs/',
    'typeorm',
    'ioredis',
    'kafkajs',
    'bullmq',
    'opossum',
    'pino',
  ];

  it('keeps domain and application imports pointed inward', () => {
    const violations: string[] = [];
    for (const file of sourceFiles(root)) {
      const fromLayer = layer(file);
      if (fromLayer !== 'domain' && fromLayer !== 'application') continue;

      for (const specifier of importsIn(file)) {
        if (
          fromLayer === 'domain' &&
          forbiddenDomainPackages.some((name) => specifier === name || specifier.startsWith(name))
        ) {
          violations.push(`${relative(root, file)} imports ${specifier}`);
        }
        const target = resolveLocalImport(file, specifier);
        if (target === undefined) continue;
        const targetLayer = layer(target);
        if (
          fromLayer === 'domain' &&
          ['application', 'infrastructure', 'presentation'].includes(targetLayer)
        ) {
          violations.push(`${relative(root, file)} points outward to ${relative(root, target)}`);
        }
        if (
          fromLayer === 'application' &&
          ['infrastructure', 'presentation'].includes(targetLayer)
        ) {
          violations.push(`${relative(root, file)} points outward to ${relative(root, target)}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('keeps application source independent of executable entry points and migration artifacts', () => {
    const violations = sourceFiles(root).flatMap((file) =>
      importsIn(file)
        .filter((specifier) => {
          if (specifier.includes('/apps/')) return true;
          if (!specifier.includes('/migrations/')) return false;
          return !file.endsWith(
            join('shared', 'infrastructure', 'persistence', 'migration-runner.ts'),
          );
        })
        .map((specifier) => `${relative(root, file)} imports ${specifier}`),
    );
    expect(violations).toEqual([]);
  });
});
