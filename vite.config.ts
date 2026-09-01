import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite-plus'

export default defineConfig({
  plugins: [
    svelte({
      include: /\.svelte($|\?)/,
      compilerOptions: {
        runes: true,
      },
    }),
  ],
  fmt: {
    singleQuote: true,
    semi: false,
    printWidth: 100,
  },
  lint: {
    ignorePatterns: ['out/**', 'dist/**', 'build/**', 'src/i18n/**', '**/*.d.ts'],
    options: {
      typeAware: false,
      typeCheck: false,
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    server: {
      deps: {
        inline: ['sdp-compact', 'sdp-transform', 'fflate'],
      },
    },
  },
})
