import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({plugins:[react(),VitePWA({registerType:'prompt',includeAssets:['apple-touch-icon.png'],manifest:{name:'夜勤の減量ノート',short_name:'夜勤ノート',lang:'ja',description:'09:00からはじまる、あなたの1日。',theme_color:'#213b34',background_color:'#f5f5ef',display:'standalone',start_url:'./',scope:'./',icons:[{src:'icon-192.png',sizes:'192x192',type:'image/png'},{src:'icon-512.png',sizes:'512x512',type:'image/png',purpose:'any maskable'}]},workbox:{globPatterns:['**/*.{js,css,html,png,svg,webmanifest}']}})]});
