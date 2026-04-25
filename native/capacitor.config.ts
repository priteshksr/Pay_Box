import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'in.paybox.app',
  appName: 'PayBox',
  webDir: 'www',
  // Uncomment to point the native shell at a live dev server instead
  // of the bundled www/ folder. Useful for hot reload while developing.
  // server: {
  //   url: 'http://192.168.1.10:8765',
  //   cleartext: true,
  // },
  android: {
    // Required so Service Workers / localStorage work as expected.
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: true,
  },
  ios: {
    contentInset: 'always',
    limitsNavigationsToAppBoundDomains: false,
    scheme: 'PayBox',
    preferredContentMode: 'mobile',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: '#2b43ec',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: false,
    },
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#2b43ec',
      overlaysWebView: false,
    },
    Preferences: {
      group: 'PayBoxGroup',
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    Camera: {
      saveToGallery: false,
    },
  },
};

export default config;
