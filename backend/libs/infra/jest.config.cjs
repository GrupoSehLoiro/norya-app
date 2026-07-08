/**
 * Jest config do pacote @sehloro/infra.
 *
 * Usa ts-jest em modo CommonJS (casa com `module: commonjs` do
 * tsconfig.base.json). `moduleNameMapper` resolve o alias
 * `@sehloro/domain` para o fonte TS durante testes — sem esse mapping
 * o jest tentaria resolver via node_modules e não encontraria (o
 * pacote do workspace não tem build publicado).
 */
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/../../tsconfig.base.json',
      },
    ],
  },
  moduleFileExtensions: ['js', 'json', 'ts'],
  moduleNameMapper: {
    '^@sehloro/domain$': '<rootDir>/../domain/src',
    '^@sehloro/domain/(.*)$': '<rootDir>/../domain/src/$1',
    '^@sehloro/infra$': '<rootDir>/src',
    '^@sehloro/infra/(.*)$': '<rootDir>/src/$1',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/index.ts',
    '!src/**/*.module.ts',
  ],
  coverageDirectory: 'coverage',
  // mongodb-memory-server demora para baixar o binário na primeira rodada.
  testTimeout: 60000,
};
