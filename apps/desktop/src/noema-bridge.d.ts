export interface NoemaBridge {
  appVersion: string;
}

declare global {
  interface Window {
    noema: NoemaBridge;
  }
}
