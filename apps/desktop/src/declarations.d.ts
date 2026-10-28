/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
interface ImportMetaEnv {
  readonly DEV: boolean;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
declare module '*.css';
declare module '*?url' {
  const assetUrl: string;
  export default assetUrl;
}
