// app.config.js — replaces the old static app.json so the DEVELOPMENT build
// can get its own Android package id (com.storybloom.app.dev) instead of
// sharing com.storybloom.app with preview/production builds.
//
// Why: Android treats two APKs with the same package id + signing key as the
// SAME app — installing one overwrites the other. The dev client and a
// preview/production build used to share "com.storybloom.app", so installing
// an offline preview build silently wiped out the dev-client testing app (and
// vice versa). Giving the dev variant a distinct suffix makes it install as a
// genuinely separate app that coexists on the device permanently.
//
// eas.json's "development" build profile sets APP_VARIANT=development (see
// its "env" block) so this only kicks in for dev-client builds; preview/
// production keep the canonical "com.storybloom.app".

const IS_DEV = process.env.APP_VARIANT === 'development';

module.exports = {
  expo: {
    name: IS_DEV ? 'Storybloom Testing' : 'Storybloom',
    slug: 'Storybloom',
    owner: 'alexstorybloom',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: 'storybloom',
    userInterfaceStyle: 'automatic',
    ios: {
      icon: './assets/expo.icon',
    },
    android: {
      package: IS_DEV ? 'com.storybloom.app.dev' : 'com.storybloom.app',
      adaptiveIcon: {
        // A different icon background tint (warm yellow) so the dev build is
        // visually distinguishable from the real app at a glance on the
        // homescreen, not just by its (also different) name.
        backgroundColor: IS_DEV ? '#FFD34D' : '#E6F4FE',
        foregroundImage: './assets/images/android-icon-foreground.png',
        backgroundImage: './assets/images/android-icon-background.png',
        monochromeImage: './assets/images/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
      permissions: [
        'android.permission.RECORD_AUDIO',
        'android.permission.MODIFY_AUDIO_SETTINGS',
        'android.permission.FOREGROUND_SERVICE',
        'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
      ],
    },
    web: {
      output: 'static',
      favicon: './assets/images/favicon.png',
    },
    plugins: [
      'expo-router',
      [
        'expo-splash-screen',
        {
          backgroundColor: '#208AEF',
          image: './assets/images/splash-icon.png',
          imageWidth: 76,
        },
      ],
      'expo-sqlite',
      'expo-audio',
      'expo-sensors',
      [
        'react-native-vosk',
        {
          models: ['assets/vosk-model-small-en-us', 'assets/vosk-model-small-ru'],
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    extra: {
      router: {},
      eas: {
        projectId: 'acc5aca7-aab9-427d-bc23-bda0724eb896',
      },
    },
  },
};
