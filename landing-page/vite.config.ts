import { defineConfig } from 'vite'

export default defineConfig({
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
