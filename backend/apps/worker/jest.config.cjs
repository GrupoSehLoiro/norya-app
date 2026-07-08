/**
 * Jest config do worker.
 *
 * Mesma estrutura do libs/infra: ts-jest com tsconfig.base.
 * moduleNameMapper resolve @sehloro/infra e @sehloro/domain para os fontes
 * TS dos pacotes do workspace.
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
    '^@sehloro/domain$': '<rootDir>/../../libs/domain/src',
    '^@sehloro/domain/(.*)$': '<rootDir>/../../libs/domain/src/$1',
    '^@sehloro/infra$': '<rootDir>/../../libs/infra/src',
    '^@sehloro/infra/(.*)$': '<rootDir>/../../libs/infra/src/$1',
  },
  testTimeout: 30000,
};
