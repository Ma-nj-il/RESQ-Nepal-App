import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import SplashScreen from '../screens/auth/SplashScreen';
import OnboardingScreen from '../screens/auth/OnboardingScreen';
import WelcomeScreen from '../screens/auth/WelcomeScreen';
import PhoneRegistrationScreen from '../screens/auth/PhoneRegistrationScreen';
import OTPScreen from '../screens/auth/OTPScreen';
import PersonalInfoScreen from '../screens/auth/PersonalInfoScreen';
import LoginScreen from '../screens/auth/LoginScreen';
import LocationPermissionScreen from '../screens/auth/LocationPermissionScreen';
import LegalScreen from '../screens/user/LegalScreen';
import ApplicationStatusScreen from '../screens/user/ApplicationStatusScreen';
import CitizenshipRegistrationScreen from '../screens/user/CitizenshipRegistrationScreen';
import DriverRegistrationScreen from '../screens/driver/DriverRegistrationScreen';

const Stack = createNativeStackNavigator();

export const AuthNavigator = () => {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Splash" component={SplashScreen} />
      <Stack.Screen name="Onboarding" component={OnboardingScreen} />
      <Stack.Screen name="Welcome" component={WelcomeScreen} />
      <Stack.Screen name="PhoneRegistration" component={PhoneRegistrationScreen} />
      <Stack.Screen name="OTP" component={OTPScreen} />
      <Stack.Screen name="PersonalInfo" component={PersonalInfoScreen} />
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="LocationPermission" component={LocationPermissionScreen} />
      <Stack.Screen name="ApplicationStatus" component={ApplicationStatusScreen} />
      <Stack.Screen name="CitizenshipRegistration" component={CitizenshipRegistrationScreen} />
      <Stack.Screen name="DriverRegistration" component={DriverRegistrationScreen} />
      <Stack.Screen
        name="PrivacyPolicy"
        component={LegalScreen}
        initialParams={{ kind: 'privacy' }}
      />
      <Stack.Screen
        name="TermsOfService"
        component={LegalScreen}
        initialParams={{ kind: 'terms' }}
      />
    </Stack.Navigator>
  );
};
