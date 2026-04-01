export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Type must be one of these
    'type-enum': [
      2,
      'always',
      [
        'feat', // New feature
        'fix', // Bug fix
        'docs', // Documentation only
        'style', // Formatting, no code change
        'refactor', // Code change that neither fixes a bug nor adds a feature
        'perf', // Performance improvement
        'test', // Adding or updating tests
        'build', // Build system or external dependencies
        'ci', // CI configuration
        'chore', // Other changes that don't modify src or test
        'revert', // Reverts a previous commit
      ],
    ],
    // Subject (description) rules
    'subject-case': [2, 'never', ['sentence-case', 'start-case', 'pascal-case', 'upper-case']],
    'subject-empty': [2, 'never'],
    'subject-max-length': [2, 'always', 100],
    // Type rules
    'type-case': [2, 'always', 'lower-case'],
    'type-empty': [2, 'never'],
    // Header max length
    'header-max-length': [2, 'always', 120],
  },
  helpUrl:
    '\n💡 Commit message must follow: <type>: <description>\n\n   Examples:\n     feat: add user authentication\n     fix: resolve login redirect loop\n     chore: update dependencies\n     docs: add API reference for agents\n\n   Allowed types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert\n\n   More info: https://www.conventionalcommits.org',
};
