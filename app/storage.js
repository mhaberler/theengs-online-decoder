'use strict';

// @capacitor/preferences-backed store for web/sensorble-custom.js: iOS may
// evict WebView localStorage, and installed decoders must survive offline.

import { Preferences } from '@capacitor/preferences';

export const preferencesStorage = {
  get: async (key) => (await Preferences.get({ key })).value,
  set: async (key, value) => { await Preferences.set({ key, value }); },
};
