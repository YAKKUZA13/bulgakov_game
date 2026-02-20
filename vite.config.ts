import { defineConfig } from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

// Dev HTTPS so getUserMedia works on phones over LAN.
export default defineConfig({
  base: './',
  plugins: [basicSsl()],
  server: {
    https: true,
    host: true, // listen on 0.0.0.0
    port: 5173,
    strictPort: true,
  },
})


