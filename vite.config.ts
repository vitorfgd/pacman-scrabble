import { defineConfig } from 'vite'

// GitHub Pages project site: https://<user>.github.io/<repo>/
// For multi-branch deploy (e.g. /v3/, /v4/), CI sets GITHUB_PAGES_BASE=/pacman-scrabble/v3/
export default defineConfig({
  base: process.env.GITHUB_PAGES_BASE ?? '/pacman-scrabble/',
})
