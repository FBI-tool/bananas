import tailwindcss from '@tailwindcss/vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: 'src/main/index.ts',
        },
      },
    },
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: 'src/preload/index.ts',
          cursors: 'src/preload/cursors.ts',
          call: 'src/preload/call.ts',
        },
      },
    },
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    build: {
      rollupOptions: {
        input: {
          index: 'src/renderer/index.html',
          cursors: 'src/renderer/cursors.html',
          call: 'src/renderer/call.html',
        },
      },
    },
    plugins: [
      tailwindcss(),
      svelte({
        include: /\.svelte($|\?)/,
        compilerOptions: {
          runes: true,
        },
      }),
    ],
    assetsInclude: ['**/*.mp3'],
    server: {
      fs: {
        allow: ['..', '../..'],
      },
    },
    optimizeDeps: {
      include: ['sdp-compact', 'sdp-transform', 'fflate'],
    },
  },
})
