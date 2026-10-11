import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://www.amazingindex.com',
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      include: ['@supabase/supabase-js', 'lucide'],
    },
  },
  build: {
    format: 'directory',
  },
});
