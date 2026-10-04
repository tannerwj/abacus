import { type AdapterResult } from "./evidence.js";
export type ConsumerMode = "node16-esm" | "node16-cjs" | "bundler";
export interface PackageValidationOptions {
    /** Explicit support contract. ESM-only packages need not promise CommonJS. */
    modes?: ConsumerMode[];
    publintLevel?: "suggestion" | "warning" | "error";
    attwProfile?: "strict" | "node16" | "esm-only";
}
/** Package publication checks against one real, scripts-disabled npm tarball. */
export declare function runPackageValidation(cwd?: string, options?: PackageValidationOptions): AdapterResult;
