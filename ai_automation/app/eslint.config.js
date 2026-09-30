import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
    js.configs.recommended,
    ...tseslint.configs.strict,
    {
        rules: {
            semi: ['error', 'never'],
            indent: ['error', 4, { SwitchCase: 1 }],
            quotes: ['error', 'single', { avoidEscape: true }],
            'comma-dangle': ['error', 'always-multiline'],
            'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
            '@typescript-eslint/no-explicit-any': 'error',
        },
    },
    {
        ignores: ['dist/**', 'node_modules/**', 'public/**'],
    },
)
