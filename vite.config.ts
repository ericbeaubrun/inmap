import { defineConfig } from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

// HTTPS (certificat auto-signé) + exposition sur le réseau local :
// les capteurs du téléphone ne sont accessibles qu'en contexte sécurisé.
// `npm run dev:http` : HTTP simple, suffisant pour le mode démo sur ordinateur.
export default defineConfig(({ mode }) => ({
  plugins: mode === 'http' ? [] : [basicSsl()],
  server: { host: true },
}))
