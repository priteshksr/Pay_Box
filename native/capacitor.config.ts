import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'in.paybox.app',
  appName: 'PayBox',
  webDir: 'www',
  android: {
    // Required so Service Workers / localStorage work as expected.
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
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
    // @capacitor-community/background-geolocation — declares the
    // foreground notification copy shown on Android while a worker is
    // clocked in. Plugin params used at runtime (distanceFilter,
    // requestPermissions, etc.) are passed via BG.addWatcher() in the
    // tracker module — these are just the defaults the OS surfaces.
    BackgroundGeolocation: {
      backgroundTitle: 'PayBox',
      backgroundMessage: 'Sharing your work location until you punch out',
    },
  },
};

export default config;
