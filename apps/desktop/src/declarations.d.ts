/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
declare module '*.css';
declare module '*?url' {
  const assetUrl: string;
  export default assetUrl;
}
