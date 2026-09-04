import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Served from a GitHub Pages project path, not a domain root. Anything that
  // builds an asset URL by hand has to go through `import.meta.env.BASE_URL`.
  base: '/spiderman-in-gang-nam/',
  plugins: [react()],
})
