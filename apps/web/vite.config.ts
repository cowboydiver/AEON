import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// GitHub Pages serves project sites under /<repo>/. The deploy workflow sets
// VITE_BASE to that subpath; local dev and preview default to root.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  worker: {
    format: 'es',
  },
});
