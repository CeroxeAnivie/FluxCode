import { readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { API } from 'typescript/unstable/sync';
import {
  isCallExpression,
  isIdentifier,
  isNoSubstitutionTemplateLiteral,
  isStringLiteral,
  type Node,
} from 'typescript/unstable/ast';
import { it, expect } from 'vitest';
import { english } from './en';
import { errorMessage, redactDiagnostic } from '../domain/errors';
it('every literal UI translation key has an English translation', () => {
  const directory = resolve('src');
  const missing: string[] = [];
  const api = new API();
  const snapshot = api.updateSnapshot({ openProjects: [resolve('tsconfig.json')] });
  try {
    const project = snapshot.getProjects()[0];
    if (!project) throw new Error('TypeScript project was not loaded');
    const scan = (path: string) => {
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        const file = join(path, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'generated') scan(file);
          continue;
        }
        if (
          !entry.isFile() ||
          !/\.tsx?$/.test(entry.name) ||
          /\.(?:test|spec|d)\.tsx?$/.test(entry.name)
        ) {
          continue;
        }
        const source = project.program.getSourceFile(file);
        if (!source) throw new Error(`TypeScript source was not loaded: ${file}`);
        const visit = (node: Node) => {
          if (
            isCallExpression(node) &&
            isIdentifier(node.expression) &&
            node.expression.text === 't' &&
            node.arguments.length === 1 &&
            (isStringLiteral(node.arguments[0]) ||
              isNoSubstitutionTemplateLiteral(node.arguments[0]))
          ) {
            const key = node.arguments[0].text;
            if (!Object.hasOwn(english, key)) {
              const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
              missing.push(`${relative(directory, file)}:${line}: ${key}`);
            }
          }
          node.forEachChild(visit);
        };
        visit(source);
      }
    };
    scan(directory);
  } finally {
    snapshot.dispose();
    api.close();
  }
  expect(missing).toEqual([]);
});
it('unexpected technical errors use the selected language and diagnostics redact credentials', () => {
  expect(errorMessage('引擎异常（fixture）', 'en')).not.toMatch(/[\u3400-\u9fff]/);
  expect(errorMessage('Unexpected fixture exception', 'zh-CN')).toContain('操作未完成');
  expect(redactDiagnostic('Authorization: Bearer sk-fixture-secret')).not.toContain(
    'fixture-secret',
  );
});

it('redacts credentials in JSON fields, authorization schemes and URL parameters', () => {
  const diagnostic =
    'Authorization: Basic dGVzdA== {"api_key":"fixture-token"} https://example.test/?access_token=query-secret&safe=1';
  const copied = redactDiagnostic(diagnostic);
  for (const secret of ['dGVzdA==', 'fixture-token', 'query-secret']) {
    expect(copied).not.toContain(secret);
  }
  expect(copied).toContain('safe=1');
});
