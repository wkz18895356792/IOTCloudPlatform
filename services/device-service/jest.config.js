module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  roots: ['<rootDir>/test'],
  collectCoverageFrom: [
    'src/service/ota.service.ts',
    'src/controller/firmware.controller.ts',
    'src/subscriber/device-message.subscriber.ts',
    '!src/**/*.d.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  testTimeout: 30000,
  moduleNameMapper: {
    '^@baby-monitor/(.*)$': '<rootDir>/../../common/$1/src',
  },
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.spec.json',
    },
  },
};
