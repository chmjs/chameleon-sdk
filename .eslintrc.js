module.exports = {
  root: true,
  env: {
    browser: true,
    jest: true,
  },
  extends: 'airbnb-base',
  rules: {
    'arrow-parens': ['error', 'as-needed', { 'requireForBlockBody': true }],
    'import/extensions': ['error', 'always', {
      'js': 'never',
    }],
    'import/no-extraneous-dependencies': 'off',
    'no-debugger': process.env.NODE_ENV === 'production' ? 2 : 0,
    'no-console': process.env.NODE_ENV === 'production' ? 'error' : 'off',
    'no-underscore-dangle': ['error', {
      allow: ['_schema', '_options', '_reactions', '_id'],
    }],
    'no-param-reassign': ['error', {
      props: true,
      ignorePropertyModificationsFor: ['state'],
    }],
  }
}
