/**
 * ABC software metric per function (Fitzpatrick 1997): A = assignments,
 * B = branches (calls / `new`), C = conditions. Score = sqrt(A² + B² + C²).
 * Complements cyclomatic complexity: a function with no branches but 150
 * calls (a giant registration block) scores high here and nowhere else.
 * Walks the TypeScript AST; nested functions are scored separately.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import type { AbacusConfig } from "./config.js";

export interface AbcScore { file: string; name: string; line: number; a: number; b: number; c: number; score: number; budget: number }

const assignmentOps = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.EqualsToken, ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.MinusEqualsToken, ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken, ts.SyntaxKind.PercentEqualsToken, ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken, ts.SyntaxKind.AsteriskAsteriskEqualsToken
]);
const conditionOps = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken
]);
const branchStatements = [ts.isIfStatement, ts.isConditionalExpression, ts.isCaseClause, ts.isDefaultClause, ts.isCatchClause, ts.isForStatement, ts.isForOfStatement, ts.isForInStatement, ts.isWhileStatement, ts.isDoStatement];

function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isConstructorDeclaration(node);
}

export function functionName(node: ts.FunctionLikeDeclaration): string {
  if (ts.isGetAccessorDeclaration(node)) return `get ${node.name.getText()}`;
  if (ts.isSetAccessorDeclaration(node)) return `set ${node.name.getText()}`;
  if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name) return node.name.getText();
  if (ts.isConstructorDeclaration(node)) return "constructor";
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if (ts.isPropertyAssignment(parent)) return parent.name.getText();
  if (ts.isCallExpression(parent)) return `${parent.expression.getText().split(".").pop()}(cb)`;
  return "<anonymous>";
}

function countAssignment(node: ts.Node): number {
  if (ts.isBinaryExpression(node)) return assignmentOps.has(node.operatorToken.kind) ? 1 : 0;
  if (ts.isVariableDeclaration(node)) return node.initializer ? 1 : 0;
  if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) return node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken ? 1 : 0;
  return 0;
}
function countBranch(node: ts.Node): number { return ts.isCallExpression(node) || ts.isNewExpression(node) ? 1 : 0; }
function countCondition(node: ts.Node, fn: ts.FunctionLikeDeclaration): number {
  if (ts.isBinaryExpression(node)) return conditionOps.has(node.operatorToken.kind) ? 1 : 0;
  if (ts.isPrefixUnaryExpression(node)) return node.operator === ts.SyntaxKind.ExclamationToken ? 1 : 0;
  if (branchStatements.some((test) => test(node))) return 1;
  if (ts.isPropertyAccessChain(node) && node.questionDotToken) return 1;
  if (ts.isReturnStatement(node) && node.expression && node.parent !== fn.body) return 1; // early-return branch
  return 0;
}

/** A/B/C for one function body, not descending into nested functions. */
export function measure(fn: ts.FunctionLikeDeclaration): { a: number; b: number; c: number } {
  const totals = { a: 0, b: 0, c: 0 };
  const visit = (node: ts.Node) => {
    if (node !== fn && isFunctionLike(node)) return;
    totals.a += countAssignment(node);
    totals.b += countBranch(node);
    totals.c += countCondition(node, fn);
    ts.forEachChild(node, visit);
  };
  if (fn.body) visit(fn.body); // expression-bodied arrows: the body node itself counts
  return totals;
}

export function scoreSource(file: string, text: string, config: Pick<AbacusConfig, "abc">): AbcScore[] {
  const scriptKind = file.endsWith(".jsx") ? ts.ScriptKind.JSX : file.endsWith(".tsx") ? ts.ScriptKind.TSX : /\.[cm]?js$/u.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, scriptKind);
  const scores: AbcScore[] = [];
  const visit = (node: ts.Node) => {
    if (isFunctionLike(node) && node.body) {
      const { a, b, c } = measure(node);
      const name = functionName(node);
      scores.push({ file, name, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, a, b, c, score: Math.round(Math.hypot(a, b, c)), budget: config.abc.allow[`${file} ${name}`]?.max ?? config.abc.budget });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return scores;
}

function walk(dir: string, exclude: RegExp[], out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== "node_modules" && entry.name !== "dist") walk(full, exclude, out); }
    else if (/\.(ts|tsx|mts|cts)$/u.test(entry.name) && !exclude.some((re) => re.test(full))) out.push(full);
  }
}

export function scoreProject(config: AbacusConfig, cwd = process.cwd()): { scores: AbcScore[]; files: number } {
  const exclude = config.exclude.map((re) => new RegExp(re, "u"));
  const files: string[] = [];
  for (const root of config.roots) if (fs.existsSync(path.join(cwd, root))) walk(path.join(cwd, root), exclude, files);
  const scores = files.flatMap((file) => scoreSource(path.relative(cwd, file), fs.readFileSync(file, "utf8"), config));
  scores.sort((x, y) => y.score - x.score);
  return { scores, files: files.length };
}

export function reportAbc(config: AbacusConfig, top = 10, cwd = process.cwd()): boolean {
  const { scores, files } = scoreProject(config, cwd);
  const over = scores.filter((s) => s.score > s.budget);
  console.log(`ABC scores — ${scores.length} functions in ${files} files, budget ${config.abc.budget}\n`);
  for (const s of scores.slice(0, top)) {
    const mark = s.score > s.budget ? "✗" : s.score > config.abc.budget ? "~" : " ";
    console.log(`${mark} ${String(s.score).padStart(4)}  A${String(s.a).padStart(3)} B${String(s.b).padStart(3)} C${String(s.c).padStart(3)}  ${s.file}:${s.line} ${s.name}`);
  }
  const unusedAllow = Object.keys(config.abc.allow).filter((key) => !scores.some((s) => `${s.file} ${s.name}` === key));
  for (const key of unusedAllow) console.log(`\n! allow entry no longer matches a function: "${key}" — remove it`);
  if (over.length) { console.error(`\n${over.length} function(s) over budget. Split them, or add an abc.allow entry with a reason.`); return false; }
  console.log("\nAll functions within ABC budget.");
  return true;
}
