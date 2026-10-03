import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.engadapochu.app',
  appName: 'Engada Pochu',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    SpeechRecognition: {
      timeout: 0,
    },
  },
};

export default config;
