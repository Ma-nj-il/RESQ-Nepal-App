import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

// User screens — home / booking / trip flow (default exports)
import HomeScreen from '../screens/user/HomeScreen';
import LocationSearchScreen from '../screens/user/LocationSearchScreen';
import MapPickerScreen from '../screens/user/MapPickerScreen';
import AmbulanceListScreen from '../screens/user/AmbulanceListScreen';
import AmbulanceDetailsScreen from '../screens/user/AmbulanceDetailsScreen';
import BookingConfirmationScreen from '../screens/user/BookingConfirmationScreen';
import ProcessingScreen from '../screens/user/ProcessingScreen';
import BookingStatusScreen from '../screens/user/BookingStatusScreen';
import TripTrackingScreen from '../screens/user/TripTrackingScreen';
import ArrivalScreen from '../screens/user/ArrivalScreen';
import RatingScreen from '../screens/user/RatingScreen';
import TipScreen from '../screens/user/TipScreen';
import CancelRideScreen from '../screens/user/CancelRideScreen';
import ChatScreen from '../screens/user/ChatScreen';
import CallScreen from '../screens/user/CallScreen';
import ActivityScreen from '../screens/user/ActivityScreen';
import SOSScreen from '../screens/user/SOSScreen';
import PromoListScreen from '../screens/user/PromoListScreen';
import PromoDetailScreen from '../screens/user/PromoDetailScreen';
import { FAQScreen } from '../screens/user/FAQScreen';

// User screens — account / settings (named exports)
import { AccountScreen } from '../screens/user/AccountScreen';
import { PersonalInfoScreen } from '../screens/user/PersonalInfoScreen';
import { NotificationsScreen } from '../screens/user/NotificationsScreen';
import { SecurityScreen } from '../screens/user/SecurityScreen';
import { PaymentMethodsScreen } from '../screens/user/PaymentMethodsScreen';
import { AddPaymentScreen } from '../screens/user/AddPaymentScreen';
import { AppearanceScreen } from '../screens/user/AppearanceScreen';
import { HelpScreen } from '../screens/user/HelpScreen';
import { LanguageScreen } from '../screens/user/LanguageScreen';
import { LogoutScreen } from '../screens/user/LogoutScreen';

// Additional screens
import ChangePasswordScreen from '../screens/user/ChangePasswordScreen';
import DeviceManagementScreen from '../screens/user/DeviceManagementScreen';
import TopUpScreen from '../screens/user/TopUpScreen';
import TopUpMethodScreen from '../screens/user/TopUpMethodScreen';
import TopUpSuccessScreen from '../screens/user/TopUpSuccessScreen';
import TopUpDetailsScreen from '../screens/user/TopUpDetailsScreen';
import ShareReceiptScreen from '../screens/user/ShareReceiptScreen';
import LegalScreen from '../screens/user/LegalScreen';
import MenuDrawerScreen from '../screens/user/MenuDrawerScreen';
import SavedPlacesScreen from '../screens/user/SavedPlacesScreen';
import SavedHospitalsScreen from '../screens/user/SavedHospitalsScreen';
import SettingsScreen from '../screens/user/SettingsScreen';
import AboutScreen from '../screens/user/AboutScreen';
import DriverOnboardingScreen from '../screens/user/DriverOnboardingScreen';
import CitizenshipRegistrationScreen from '../screens/user/CitizenshipRegistrationScreen';
import ApplicationStatusScreen from '../screens/user/ApplicationStatusScreen';
import DriverRegistrationScreen from '../screens/driver/DriverRegistrationScreen';
import DriverLoginScreen from '../screens/auth/DriverLoginScreen';

const Stack = createNativeStackNavigator();

const LogoutScreenWrapper = ({ navigation }: any) => (
  <LogoutScreen visible onClose={() => navigation.goBack()} />
);

export const UserNavigator = () => {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Home" component={HomeScreen} />
      <Stack.Screen name="DriverLogin" component={DriverLoginScreen} />
      <Stack.Screen name="AmbulanceList" component={AmbulanceListScreen} />
      <Stack.Screen name="LocationSearch" component={LocationSearchScreen} />
      <Stack.Screen name="MapPicker" component={MapPickerScreen} />
      <Stack.Screen name="SOS" component={SOSScreen} />
      <Stack.Screen name="AmbulanceDetails" component={AmbulanceDetailsScreen} />
      <Stack.Screen name="BookingConfirmation" component={BookingConfirmationScreen} />
      <Stack.Screen name="Processing" component={ProcessingScreen} />
      <Stack.Screen name="BookingStatus" component={BookingStatusScreen} />
      <Stack.Screen name="TripTracking" component={TripTrackingScreen} />
      <Stack.Screen name="Arrival" component={ArrivalScreen} />
      <Stack.Screen name="Rating" component={RatingScreen} />
      <Stack.Screen name="Tip" component={TipScreen} />
      <Stack.Screen name="CancelRide" component={CancelRideScreen} />
      <Stack.Screen name="Chat" component={ChatScreen} />
      <Stack.Screen name="Call" component={CallScreen} />
      <Stack.Screen name="Activity" component={ActivityScreen} />
      <Stack.Screen name="PromoList" component={PromoListScreen} />
      <Stack.Screen name="PromoDetail" component={PromoDetailScreen} />
      <Stack.Screen name="Account" component={AccountScreen} />
      <Stack.Screen name="PersonalInfo" component={PersonalInfoScreen} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} />
      <Stack.Screen name="Security" component={SecurityScreen} />
      <Stack.Screen name="ChangePassword" component={ChangePasswordScreen} />
      <Stack.Screen name="DeviceManagement" component={DeviceManagementScreen} />
      <Stack.Screen name="PaymentMethods" component={PaymentMethodsScreen} />
      <Stack.Screen name="AddPayment" component={AddPaymentScreen} />
      <Stack.Screen name="Appearance" component={AppearanceScreen} />
      <Stack.Screen name="Help" component={HelpScreen} />
      <Stack.Screen name="FAQ" component={FAQScreen} />
      <Stack.Screen name="Language" component={LanguageScreen} />
      <Stack.Screen name="Logout" component={LogoutScreenWrapper} />
      <Stack.Screen name="TopUp" component={TopUpScreen} />
      <Stack.Screen name="TopUpMethod" component={TopUpMethodScreen} />
      <Stack.Screen name="TopUpSuccess" component={TopUpSuccessScreen} />
      <Stack.Screen name="TopUpDetails" component={TopUpDetailsScreen} />
      <Stack.Screen name="ShareReceipt" component={ShareReceiptScreen} />
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
      <Stack.Screen
        name="MenuDrawer"
        component={MenuDrawerScreen}
        options={{ presentation: 'transparentModal', animation: 'none' }}
      />
      <Stack.Screen name="SavedPlaces" component={SavedPlacesScreen} />
      <Stack.Screen name="SavedHospitals" component={SavedHospitalsScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="About" component={AboutScreen} />
      <Stack.Screen name="DriverOnboarding" component={DriverOnboardingScreen} />
      <Stack.Screen name="DriverRegistration" component={DriverRegistrationScreen} />
      <Stack.Screen name="CitizenshipRegistration" component={CitizenshipRegistrationScreen} />
      <Stack.Screen name="ApplicationStatus" component={ApplicationStatusScreen} />
    </Stack.Navigator>
  );
};
