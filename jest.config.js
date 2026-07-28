module.exports = {
  transform: {'^.+\\.ts?$': 'ts-jest'},
  testEnvironment: 'node',
  // NB: the `(test|spec)` group used to be optional, which made EVERY .ts file under
  // tests/ a test file — including helpers like setup-env.ts, which then fail as suites
  // containing no tests.
  testRegex: '/tests/.*\\.(test|spec)\\.(ts|tsx)$',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  setupFiles: ['<rootDir>/tests/setup-env.ts']
}
