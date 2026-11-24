// Runs before the window's own scripts. It exposes ONE object,
// `window.dungeon`, with exactly the calls the window is allowed to make.
// Each call is forwarded to the main process (src/ipc.js).

const { contextBridge, ipcRenderer } = require('electron');

function call(name) {
  return (...args) => ipcRenderer.invoke('dungeon:' + name, ...args);
}

contextBridge.exposeInMainWorld('dungeon', {
  getWeek: call('getWeek'),
  getToday: call('getToday'),
  getQuest: call('getQuest'),
  checkDraft: call('checkDraft'),
  checkMove: call('checkMove'),
  validateQuest: call('validateQuest'),
  validateMove: call('validateMove'),
  saveQuest: call('saveQuest'),
  deleteQuest: call('deleteQuest'),
  setChange: call('setChange'),
  removeChange: call('removeChange'),
  listBreaks: call('listBreaks'),
  saveBreak: call('saveBreak'),
  deleteBreak: call('deleteBreak'),
  getSemester: call('getSemester'),
  saveSemester: call('saveSemester'),
  startNewSemester: call('startNewSemester'),
  listDeadlines: call('listDeadlines'),
  getBounties: call('getBounties'),
  saveDeadline: call('saveDeadline'),
  setDeadlineDone: call('setDeadlineDone'),
  deleteDeadline: call('deleteDeadline'),
  getProfile: call('getProfile'),
  getLevel: call('getLevel'),
  saveHabit: call('saveHabit'),
  deleteHabit: call('deleteHabit'),
  tickHabit: call('tickHabit'),
  getSettings: call('getSettings'),
  setSettings: call('setSettings'),
  googleConnect: call('googleConnect'),
  googleDisconnect: call('googleDisconnect'),
  pushNow: call('pushNow'),
  getPushStatus: call('getPushStatus'),
  getTrayStatus: call('getTrayStatus'),
  // ---------- Treasury ----------
  pickStatements: call('pickStatements'),
  importStatements: call('importStatements'),
  getTreasury: call('getTreasury'),
  setLabel: call('setLabel'),
  setMerchantLabel: call('setMerchantLabel'),
  setAllowance: call('setAllowance'),
  setBalance: call('setBalance'),
  listImports: call('listImports'),
  deleteImport: call('deleteImport'),
  getMoneySummary: call('getMoneySummary'),
  // The main process sends 'dungeon:changed' after every change.
  onDataChanged: (callback) => ipcRenderer.on('dungeon:changed', () => callback()),
  // ...'dungeon:push-status' after every Google push, connect or disconnect.
  // Returns a function that stops listening again.
  onPushStatus: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('dungeon:push-status', listener);
    return () => ipcRenderer.removeListener('dungeon:push-status', listener);
  },
  // ...and 'dungeon:open-settings' when the "Google disconnected" notification is clicked.
  onOpenSettings: (callback) => ipcRenderer.on('dungeon:open-settings', () => callback()),
});
