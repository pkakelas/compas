import react from '@vitejs/plugin-react';

export default /**
 * @type {import('vite').UserConfig}
 */
({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    reportCompressedSize: false,
  },
  plugins: [
    react({
      // The design files have no import/export and rely on a global `React`
      // (set in entries/globals.js). The classic runtime compiles JSX to
      // `React.createElement`, so no jsx-runtime import is injected into these
      // script-style files.
      jsxRuntime: 'classic',
    }),
  ],
});
