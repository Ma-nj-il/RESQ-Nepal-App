import React, { lazy, Suspense } from 'react';
import { ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ErrorBoundary } from './components/ErrorBoundary';
import { resolveBackendPreview } from './services/api/backend/previewConfig';

const AppNavigator = lazy(() => import('./navigation/AppNavigator').then((module) => ({ default: module.AppNavigator })));
const BackendPreview = lazy(() => import('./components/backend/BackendPreview'));
const preview = resolveBackendPreview({
  development: __DEV__,
  enabled: process.env.EXPO_PUBLIC_BACKEND_PREVIEW,
  origin: process.env.EXPO_PUBLIC_BACKEND_ORIGIN,
  environment: process.env.EXPO_PUBLIC_BACKEND_ENVIRONMENT,
});

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <ErrorBoundary>
          <Suspense fallback={<ActivityIndicator accessibilityLabel="Loading application" />}>
            {preview.kind === 'disabled' ? <AppNavigator /> : <BackendPreview config={preview} />}
          </Suspense>
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
