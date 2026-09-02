import ts from "typescript";
import type { AbacusConfig } from "./config.js";
export interface AbcScore {
    file: string;
    name: string;
    line: number;
    a: number;
    b: number;
    c: number;
    score: number;
    budget: number;
}
export declare function functionName(node: ts.FunctionLikeDeclaration): string;
/** A/B/C for one function body, not descending into nested functions. */
export declare function measure(fn: ts.FunctionLikeDeclaration): {
    a: number;
    b: number;
    c: number;
};
export declare function scoreSource(file: string, text: string, config: Pick<AbacusConfig, "abc">): AbcScore[];
export declare function scoreProject(config: AbacusConfig, cwd?: string): {
    scores: AbcScore[];
    files: number;
};
export declare function reportAbc(config: AbacusConfig, top?: number, cwd?: string): boolean;
