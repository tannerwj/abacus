import { objectValue } from "./json-values.js";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { parse as parseToml } from "smol-toml";

function object(value: unknown, label: string): Record<string, unknown> {
  return objectValue(value, `${label} must be an object`);
}
function text(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a nonempty string`);
}
function validateTomlExtension(value: unknown): void {
  const table = object(value, "native TOML.extend");
  if ("path" in table) throw new Error("native TOML external extend.path is unsupported; use a self-contained bundled config");
  if (Object.keys(table).some((key) => !["useDefault", "disabledRules"].includes(key))) throw new Error("native TOML.extend has unsupported fields");
  if (table.useDefault !== undefined && typeof table.useDefault !== "boolean") throw new Error("native TOML.extend.useDefault must be boolean");
  if (table.disabledRules !== undefined && (!Array.isArray(table.disabledRules) || !table.disabledRules.every((item) => typeof item === "string" && item.trim()))) throw new Error("native TOML.extend.disabledRules must be a string list");
}

export function relativeFile(value: unknown, label: string): asserts value is string {
  text(value, label);
  if (path.isAbsolute(value) || value.includes("\\") || value.split("/").some((part) => !part || part === "." || part === "..") || /^[a-z]+:/iu.test(value)) {
    throw new Error(`${label} must be a bundled relative file path without traversal`);
  }
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
export function bundledFile(root: string, relative: string): string {
  relativeFile(relative, "native file");
  const segments = relative.split("/");
  for (let i = 1; i <= segments.length; i++) {
    if (fs.lstatSync(path.join(root, ...segments.slice(0, i))).isSymbolicLink()) throw new Error(`native config symlinks are unsupported: ${relative}`);
  }
  const actual = fs.realpathSync(path.resolve(root, relative));
  if (!inside(root, actual) || !fs.statSync(actual).isFile()) throw new Error(`native config is not a bundled regular file: ${relative}`);
  return actual;
}
function nativeLiteral(node: ts.Node): boolean {
    if (ts.isParenthesizedExpression(node)) return nativeLiteral(node.expression);
    if (ts.isArrayLiteralExpression(node)) return node.elements.every(nativeLiteral);
    if (ts.isObjectLiteralExpression(node)) return node.properties.every((item) => ts.isPropertyAssignment(item) && !ts.isComputedPropertyName(item.name) && nativeLiteral(item.initializer));
    if (ts.isPrefixUnaryExpression(node)) return [ts.SyntaxKind.MinusToken, ts.SyntaxKind.PlusToken].includes(node.operator) && ts.isNumericLiteral(node.operand);
    return ts.isStringLiteral(node) || ts.isNumericLiteral(node) || ts.isRegularExpressionLiteral(node) || node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword || node.kind === ts.SyntaxKind.NullKeyword;
}

/** Pinned JavaScript configs are data-only module.exports literals, never executable imports. */
function staticNativeJs(source: string, file: string): ts.Expression {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const diagnostics: unknown = Reflect.get(ast, "parseDiagnostics");
  if (!Array.isArray(diagnostics) || diagnostics.length) throw new Error("pinned JavaScript native config contains syntax errors");
  const statements = ast.statements.filter((statement) => !(ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression) && statement.expression.text === "use strict"));
  const statement = statements[0];
  if (statements.length !== 1 || !statement || !ts.isExpressionStatement(statement) || !ts.isBinaryExpression(statement.expression)) throw new Error("pinned JavaScript native config must be a data-only module.exports literal");
  const assignment = statement.expression;
  if (assignment.operatorToken.kind !== ts.SyntaxKind.EqualsToken || assignment.left.getText(ast) !== "module.exports" || !nativeLiteral(assignment.right)) throw new Error("pinned JavaScript native config must be data-only; executable/external references are unsupported");
  return assignment.right;
}
/** Extract already-validated static data for the same reference walk used by JSON, without eval. */
function nativeLiteralValue(node: ts.Node): unknown {
  if (ts.isParenthesizedExpression(node)) return nativeLiteralValue(node.expression);
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(nativeLiteralValue);
  if (ts.isObjectLiteralExpression(node)) return Object.fromEntries(node.properties.map((property) => {
    if (!ts.isPropertyAssignment(property)) throw new Error("unsupported native property");
    const name = property.name;
    const key = ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) ? name.text : name.getText();
    return [key, nativeLiteralValue(property.initializer)];
  }));
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand)) return node.operator === ts.SyntaxKind.MinusToken ? -Number(node.operand.text) : Number(node.operand.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  // Regex values are native data, not config-file references. Null remains null.
  return null;
}

/** No config code executes here. Only declared bundled data files form the closure. */
export function validateNativeClosure(root: string, files: string[]): void {
  const declared = new Set(files.map((file) => bundledFile(root, file)));
  const reference = (file: string, ref: unknown): void => {
    text(ref, "native config reference");
    if (!ref.startsWith("./")) throw new Error("native config references must refer to declared bundled relative files");
    const target = fs.realpathSync(path.resolve(path.dirname(file), ref));
    if (!inside(root, target) || !declared.has(target)) throw new Error(`native config reference is outside the declared digest closure: ${ref}`);
  };
  const visitJson = (file: string, value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { for (const entry of value) visitJson(file, entry); return; }
    for (const [key, entry] of Object.entries(value)) {
      if (key === "jsPlugins" && (Array.isArray(entry) ? entry.length > 0 : entry !== undefined && entry !== null)) throw new Error("pinned native jsPlugins are unsupported; executable plugins are outside the digest closure");
      if (key === "extends") for (const ref of Array.isArray(entry) ? entry : [entry]) reference(file, ref);
      else if (key === "$ref" && typeof entry === "string" && !entry.startsWith("#")) reference(file, entry.split("#")[0]);
      else if (["tsConfig", "webpackConfig", "babelConfig"].includes(key) && entry && typeof entry === "object" && "fileName" in entry) {
        reference(file, entry.fileName);
        throw new Error("shared native resolution-file inputs are unsupported; use an inspectable repository-local config");
      }
      else visitJson(file, entry);
    }
  };
  for (const file of declared) {
    const source = fs.readFileSync(file, "utf8"), extension = path.extname(file);
    if ([".js", ".cjs"].includes(extension)) visitJson(file, nativeLiteralValue(staticNativeJs(source, file)));
    else if (extension === ".json" || extension === ".jsonc") {
      const parsed = ts.parseConfigFileTextToJson(file, source);
      if (parsed.error) throw new Error(`native config is not valid JSON/JSONC: ${file}`);
      visitJson(file, object(parsed.config, "native JSON config"));
    } else if (extension === ".toml") {
      // Parse all TOML spellings, including dotted/quoted keys and inline tables.
      const config = object(parseToml(source), "native TOML config");
      const extensionConfig = config.extend;
      if (extensionConfig !== undefined) validateTomlExtension(extensionConfig);
    } else throw new Error(`unsupported native config format in pinned pack: ${extension}`);
  }
}
