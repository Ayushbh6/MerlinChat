import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;

          if (
            id.includes('react-syntax-highlighter')
            || id.includes('/refractor/')
            || id.includes('/prismjs/')
          ) {
            return 'syntax-highlighter';
          }
          if (id.includes('react-markdown') || id.includes('remark-gfm')) return 'markdown';
          if (id.includes('/lucide-react/')) return 'icons';
          if (id.includes('/@radix-ui/')) return 'radix';
          if (id.includes('react-router') || id.includes('@remix-run')) return 'router';
          if (
            id.includes('/react/')
            || id.includes('/react-dom/')
            || id.includes('/scheduler/')
          ) {
            return 'react-core';
          }
          return undefined;
        },
      },
    },
  },
})
