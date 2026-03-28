import { defineConfig } from 'vite'

// GitHub Pages: CI sets VITE_BASE to /pacman-scrabble/<branch>/ per build.
// Local dev uses root (http://localhost:5173/).
const raw = process.env.VITE_BASE
const base = raw ? raw.replace(/\/?$/, '/') : '/'

export default defineConfig({
  base,
})
