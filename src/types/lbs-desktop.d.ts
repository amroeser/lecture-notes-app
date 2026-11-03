import type { LbsDesktopBridge } from '../../electron/src/bridge-types';

declare global {
  interface Window {
    /** Present only inside the Electron desktop app (see electron/src/preload.ts). */
    lbsDesktop?: LbsDesktopBridge;
  }
}

export {};
