import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.folvy.pos',
  appName: 'Folvy',
  webDir: 'dist',
  plugins: {
    // OTA (Capa 2, 31/07): el control de CUÁNDO aplicar lo lleva UpdateGate
    // (ventana segura + inactividad), no el auto-update propio de Capgo contra
    // su nube. autoUpdate:false = Capgo NUNCA descarga/aplica por su cuenta;
    // solo responde a download()/set() que llama appUpdate.ts explícitamente.
    CapacitorUpdater: {
      autoUpdate: false,
    },
  },
};

export default config;
