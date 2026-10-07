export declare function lintReport(source: string): {
    diagnostics: {
        code: string;
        filename: string;
        severity: string;
        labels: {
            span: {
                line: number | undefined;
            };
        }[];
    }[];
    number_of_files: number;
};
export declare function deadcodeReport(source: string): {
    findings: {
        type: string;
        file: string;
        name: string;
        severity: string | undefined;
    }[];
    processed: number;
    hasConfigLoadErrors: boolean;
};
