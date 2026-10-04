import path from "node:path";
/** Knip's supported reporter API exposes actual processed-file counts. */
const reporter = ({ report, issues, counters, cwd, hasConfigLoadErrors }) => {
    const findings = Object.entries(issues).flatMap(([type, files]) => {
        if (!report[type])
            return [];
        return Object.values(files).flatMap((items) => Object.values(items)).map((item) => ({
            type, file: path.relative(cwd, item.filePath), name: item.symbol,
            line: item.line, severity: item.severity,
        }));
    });
    console.log(JSON.stringify({ findings, processed: counters.processed, hasConfigLoadErrors }));
};
export default reporter;
