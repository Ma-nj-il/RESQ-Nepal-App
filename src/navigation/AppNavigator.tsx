import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuthStore } from '../store/authStore';
import { authService } from '../services/auth/authService';
import { AuthNavigator } from './AuthNavigator';
import { UserNavigator } from './UserNavigator';
import { DriverNavigator } from './DriverNavigator';

const Stack = createNativeStackNavigator();

export const AppNavigator = () => {
  const { isAuthenticated, mode } = useAuthStore();

  // If Supabase ends the session (expired/revoked refresh token, sign-out from
  // another surface), clear local auth so protected screens cannot stay open.
  // The callback only carries the user id; no tokens or profile data are logged.
  useEffect(() => {
    const subscription = authService.onAuthStateChange((event) => {
      // INITIAL_SESSION is null for local/demo sessions even when the user is
      // signed in; only an actual Supabase sign-out should clear local auth.
      if (event === 'SIGNED_OUT') useAuthStore.getState().logout();
    });
    return () => subscription.unsubscribe();
  }, []);

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!isAuthenticated ? (
          <Stack.Screen name="Auth" component={AuthNavigator} />
        ) : mode === 'driver' ? (
          <Stack.Screen name="Driver" component={DriverNavigator} />
        ) : (
          <Stack.Screen name="User" component={UserNavigator} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
};
