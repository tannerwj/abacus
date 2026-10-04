module.exports = {
  forbidden: [
    { name: 'domain-no-infrastructure', severity: 'error', from: { path: '^src/domain/' }, to: { path: '^src/infrastructure/' } },
    { name: 'browser-no-server', severity: 'error', from: { path: '^src/browser/' }, to: { path: '^src/server/' } },
    { name: 'public-entry-only', severity: 'error', from: { path: '^src/consumer/' }, to: { path: '^src/internal/' } },
    { name: 'production-no-tests', severity: 'error', from: { path: '^src/' }, to: { path: '^test/' } },
  ],
  options: { doNotFollow: { path: 'node_modules' }, exclude: { path: 'node_modules' }, tsConfig: { fileName: 'tsconfig.json' } },
};
