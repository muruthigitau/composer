/// <reference types="vite/client" />

interface VSCodeApi {
  postMessage(message: any): void;
  getState(): any;
  setState(state: any): void;
}

declare global {
  interface Window {
    acquireVsCodeApi: () => VSCodeApi;
  }
}

declare function acquireVsCodeApi(): VSCodeApi;