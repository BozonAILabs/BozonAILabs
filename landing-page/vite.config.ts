import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  define: { 'import.meta.env.VITE_DEPLOYMENT_ENV': JSON.stringify(process.env.VERCEL_ENV ?? 'development') },
  build: { rollupOptions: { input: {
    main: resolve(import.meta.dirname, 'index.html'),
    converter: resolve(import.meta.dirname, 'tools/bank-statement-converter.html'),
    callback: resolve(import.meta.dirname, 'auth/callback.html'),
  } } },
  server: {
    proxy: {},
  },
  plugins: [
    {
      name: 'clean-urls',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          const url = req.url ?? ''
          const pathname = url.split('?')[0]
          if (pathname !== '/' && !pathname.includes('.') && !pathname.startsWith('/@') && !pathname.startsWith('/src') && !pathname.startsWith('/node_modules')) {
            req.url = `${pathname}.html${url.includes('?') ? '?' + url.split('?')[1] : ''}`
          }
          next()
        })
      },
    },
  ],
})
