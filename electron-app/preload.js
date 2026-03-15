const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onIncident: (callback) => ipcRenderer.on('incident', (_event, data) => callback(data)),
  onIncidentsInit: (callback) => ipcRenderer.on('incidents:init', (_event, data) => callback(data)),
  onModelStatus: (callback) => ipcRenderer.on('model:status', (_event, data) => callback(data)),
  fetchIncidents: () => ipcRenderer.invoke('incidents:fetch'),
  notifyIncident: (incident) => ipcRenderer.invoke('incident:notify', incident),
  rendererReady: () => ipcRenderer.send('renderer-ready'),
  // Auth methods
  authSignup: (credentials) => ipcRenderer.invoke('auth:signup', credentials),
  authSignin: (credentials) => ipcRenderer.invoke('auth:signin', credentials),
  authSignout: () => ipcRenderer.invoke('auth:signout'),
  authGetUser: () => ipcRenderer.invoke('auth:getUser'),
  syncTrigger: () => ipcRenderer.invoke('sync:trigger'),
  // Linking methods
  getPendingLinks: () => ipcRenderer.invoke('links:getPending'),
  acceptLink: (linkId) => ipcRenderer.invoke('links:accept', linkId),
  rejectLink: (linkId) => ipcRenderer.invoke('links:reject', linkId),
});


