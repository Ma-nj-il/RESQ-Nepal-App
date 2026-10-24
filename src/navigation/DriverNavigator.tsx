import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import DriverHomeScreen from '../screens/driver/DriverHomeScreen';
import DriverRequestsScreen from '../screens/driver/DriverRequestsScreen';
import DriverEarningsScreen from '../screens/driver/DriverEarningsScreen';
import DriverProfileScreen from '../screens/driver/DriverProfileScreen';
import DriverRegistrationScreen from '../screens/driver/DriverRegistrationScreen';
import VehicleManagementScreen from '../screens/driver/VehicleManagementScreen';
import DriverTripScreen from '../screens/driver/DriverTripScreen';
import DriverSettingsScreen from '../screens/driver/DriverSettingsScreen';
import DriverDrawerScreen from '../screens/driver/DriverDrawerScreen';
import ApplicationStatusScreen from '../screens/user/ApplicationStatusScreen';
import CitizenshipRegistrationScreen from '../screens/user/CitizenshipRegistrationScreen';

// Shared screens re-used in driver mode
import { HelpScreen } from '../screens/user/HelpScreen';
import { FAQScreen } from '../screens/user/FAQScreen';
import { LanguageScreen } from '../screens/user/LanguageScreen';

const Stack = createNativeStackNavigator();

export const DriverNavigator = () => {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="DriverHome" component={DriverHomeScreen} />
      <Stack.Screen name="DriverRequests" component={DriverRequestsScreen} />
      <Stack.Screen name="DriverEarnings" component={DriverEarningsScreen} />
      <Stack.Screen name="DriverProfile" component={DriverProfileScreen} />
      <Stack.Screen name="DriverRegistration" component={DriverRegistrationScreen} />
      <Stack.Screen name="VehicleManagement" component={VehicleManagementScreen} />
      <Stack.Screen name="DriverTrip" component={DriverTripScreen} />
      <Stack.Screen name="DriverSettings" component={DriverSettingsScreen} />
      <Stack.Screen
        name="DriverDrawer"
        component={DriverDrawerScreen}
        options={{ presentation: 'transparentModal', animation: 'none' }}
      />
      <Stack.Screen name="Help" component={HelpScreen} />
      <Stack.Screen name="FAQ" component={FAQScreen} />
      <Stack.Screen name="Language" component={LanguageScreen} />
      <Stack.Screen name="ApplicationStatus" component={ApplicationStatusScreen} />
      <Stack.Screen name="CitizenshipRegistration" component={CitizenshipRegistrationScreen} />
    </Stack.Navigator>
  );
};
