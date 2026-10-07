import { jsonObject, objectValue, arrayValue, stringValue, numberValue } from "./json-values.js";
function optionalLine(value) {
    return value === undefined ? undefined : numberValue(value);
}
export function lintReport(source) {
    const raw = jsonObject(source);
    const diagnostics = arrayValue(raw.diagnostics).map((value) => {
        const item = objectValue(value);
        const labels = arrayValue(item.labels ?? []).map((labelValue) => {
            const label = objectValue(labelValue), span = label.span === undefined ? {} : objectValue(label.span);
            return { span: { line: optionalLine(span.line) } };
        });
        return {
            code: stringValue(item.code),
            filename: stringValue(item.filename),
            severity: stringValue(item.severity),
            labels,
        };
    });
    return { diagnostics, number_of_files: numberValue(raw.number_of_files) };
}
export function deadcodeReport(source) {
    const raw = jsonObject(source);
    if (typeof raw.hasConfigLoadErrors !== "boolean")
        throw new Error("Invalid knip report");
    const findings = arrayValue(raw.findings).map((value) => {
        const item = objectValue(value);
        return {
            type: stringValue(item.type),
            file: stringValue(item.file),
            name: stringValue(item.name),
            severity: item.severity === undefined ? undefined : stringValue(item.severity),
        };
    });
    return {
        findings,
        processed: numberValue(raw.processed),
        hasConfigLoadErrors: raw.hasConfigLoadErrors,
    };
}
