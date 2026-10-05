// Module hooks for the rules tests: the app's own .ts/.tsx modules run in
// Node, transpiled with the project's TypeScript, with Vite-style
// extensionless imports resolved. src/firebase/client.ts (the production
// Firebase config) is never loaded: every import of it gets client-stub.mjs,
// which talks to the emulator only.
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
const CLIENT = path.join(SRC, 'firebase', 'client.ts');
const STUB = new URL('./client-stub.mjs', import.meta.url).href;
const TS_FILE = /\.tsx?$/;

function isFile(p) {
  return existsSync(p) && statSync(p).isFile();
}

export async function resolve(specifier, context, next) {
  const parent = context.parentURL?.startsWith('file:') ? fileURLToPath(context.parentURL) : null;
  if (specifier.startsWith('.') && parent) {
    const base = path.resolve(path.dirname(parent), specifier);
    const hit = [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')].find(isFile);
    if (hit === CLIENT) return { url: STUB, shortCircuit: true };
    if (hit && TS_FILE.test(hit)) return { url: pathToFileURL(hit).href, shortCircuit: true };
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.startsWith('file:') && TS_FILE.test(url)) {
    const file = fileURLToPath(url);
    if (file === CLIENT) throw new Error('rules tests must never load the production client');
    const { outputText } = ts.transpileModule(await readFile(file, 'utf8'), {
      fileName: file,
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        verbatimModuleSyntax: true,
      },
    });
    return { format: 'module', source: outputText, shortCircuit: true };
  }
  return next(url, context);
}
