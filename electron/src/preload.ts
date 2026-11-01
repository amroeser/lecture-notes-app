import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type LbsDesktopBridge } from './bridge-types';

// Narrow bridge: fixed channels only, no generic invoke, no Node APIs in the page.
const bridge: LbsDesktopBridge = {
  isDesktop: true,
  getAppInfo: () => ipcRenderer.invoke(IPC.appInfo),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  saveSettings: (patch) => ipcRenderer.invoke(IPC.saveSettings, patch),
  testConnection: (target) => ipcRenderer.invoke(IPC.testConnection, target),
  getCliStatus: () => ipcRenderer.invoke(IPC.cliStatus),
};

contextBridge.exposeInMainWorld('lbsDesktop', bridge);
