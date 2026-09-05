import { defineConfig } from 'vite'
import { resolve } from 'node:path'

// Supabase's Vercel integration currently publishes NEXT_PUBLIC_ names. Expose
// only these three public values to Vite; never expose all environment variables.
const publicSupabase = Object.fromEntries(
  ['URL', 'PUBLISHABLE_KEY', 'ANON_KEY'].flatMap((name) => {
    const value = process.env[`VITE_SUPABASE_${name}`] ?? process.env[`NEXT_PUBLIC_SUPABASE_${name}`];
    return value ? [[`import.meta.env.VITE_SUPABASE_${name}`, JSON.stringify(value)]] : [];
  }),
);
export default defineConfig({
  define: { ...publicSupabase, 'import.meta.env.VITE_DEPLOYMENT_ENV': JSON.stringify(process.env.VERCEL_ENV ?? 'development') },
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
