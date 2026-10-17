import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { colors, spacing, typography, radii, shadows } from '../../constants/theme';
import { Input} from '../../components/ui';
import { locationService } from '../../services/location/locationService';

const HomeScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const [locationText, setLocationText] = useState('');
  const [isSearching, setIsSearching] = useState(true);
  const [currentAddress, setCurrentAddress] = useState('');

  useEffect(() => {
    const fetchLocation = async () => {
      try {
        const hasPermission = await locationService.requestPermission();
        if (hasPermission) {
          const loc = await locationService.getCurrentLocation();
          if (loc) {
            const address = await locationService.reverseGeocode(loc.lat, loc.lng);
            setCurrentAddress(address);
          }
        }
      } catch {
        // Location is optional — the user can type an address below.
      } finally {
        setIsSearching(false);
      }
    };
    fetchLocation();
  }, []);

  const handleLocationSubmit = () => {
    if (locationText.trim()) {
      navigation.navigate('AmbulanceList', { pickupAddress: locationText.trim() });
    }
  };

  const handleSavedPlace = () => {
    navigation.navigate('LocationSearch', { mode: 'pickup' });
  };

  const handleMenuPress = () => {
    Alert.alert('Menu', 'A navigation menu is not part of this build. Use the buttons on this screen and the bottom bar to move around.');
  };

  const handleSafetyPress = () => {
    Alert.alert('Safety', 'A safety toolkit is not available in this build yet.');
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Map Placeholder */}
      <View style={styles.mapContainer}>
        <View style={styles.mapBackground}>
          {/* Grid lines to simulate map */}
          <View style={styles.mapGrid}>
            {Array.from({ length: 8 }).map((_, i) => (
              <View key={`h-${i}`} style={[styles.gridLine, { top: `${(i + 1) * 12.5}%` }]} />
            ))}
            {Array.from({ length: 6 }).map((_, i) => (
              <View key={`v-${i}`} style={[styles.gridLineVertical, { left: `${(i + 1) * 16.66}%` }]} />
            ))}
          </View>

          {/* Center Pin */}
          <View style={styles.pinContainer}>
            <Text style={styles.pinIcon}>📍</Text>
            <View style={styles.pinPulse} />
          </View>

          {/* Searching indicator */}
          {isSearching && (
            <View style={styles.searchingBadge}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.searchingText}>Searching your location...</Text>
            </View>
          )}
        </View>

        {/* Top Bar Overlay */}
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.menuButton} onPress={handleMenuPress}>
            <Text style={styles.menuIcon}>☰</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.safetyButton} onPress={handleSafetyPress}>
            <Text style={styles.safetyIcon}>🛡️</Text>
            <Text style={styles.safetyText}>Safety</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Bottom Sheet Card */}
      <View style={styles.bottomSheet}>
        <View style={styles.handleBar} />
        <ScrollView showsVerticalScrollIndicator={false}>
          <Text style={styles.heading}>Let&apos;s travel together!</Text>
          <Text style={styles.subheading}>Book an ambulance in seconds</Text>

          {/* Location Input */}
          <View style={styles.inputContainer}>
            <Text style={styles.inputIcon}>📍</Text>
            <Input
              placeholder="Enter location"
              value={locationText}
              onChangeText={setLocationText}
              onSubmitEditing={handleLocationSubmit}
              returnKeyType="search"
            />
          </View>

          {/* Saved Places */}
          <TouchableOpacity style={styles.savedPlaceCard} onPress={handleSavedPlace}>
            <View style={styles.savedPlaceIcon}>
              <Text style={styles.savedPlaceEmoji}>🏠</Text>
            </View>
            <View style={styles.savedPlaceContent}>
              <Text style={styles.savedPlaceTitle}>Choose a saved place</Text>
              <Text style={styles.savedPlaceSubtitle}>Home, Work, and more</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>

          {/* Current Location */}
          {currentAddress ? (
            <TouchableOpacity
              style={styles.currentLocationCard}
              onPress={() => setLocationText(currentAddress)}
            >
              <Text style={styles.currentLocationIcon}>📍</Text>
              <Text style={styles.currentLocationText} numberOfLines={1}>
                {currentAddress}
              </Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      </View>

      {/* Bottom Navigation */}
      <View style={styles.bottomNav}>
        <TouchableOpacity style={styles.navItem}>
          <Text style={[styles.navIcon, styles.navIconActive]}>🏠</Text>
          <Text style={[styles.navLabel, styles.navLabelActive]}>Home</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.navItem}
          onPress={() => navigation.navigate('AmbulanceList')}
        >
          <Text style={styles.navIcon}>🚑</Text>
          <Text style={styles.navLabel}>Ambulances</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.navItem}
          onPress={() => navigation.navigate('Activity')}
        >
          <Text style={styles.navIcon}>📋</Text>
          <Text style={styles.navLabel}>Activity</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.navItem}
          onPress={() => navigation.navigate('Account')}
        >
          <Text style={styles.navIcon}>👤</Text>
          <Text style={styles.navLabel}>Account</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
  mapBackground: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#E8E4DE',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mapGrid: {
    ...StyleSheet.absoluteFill,
  },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  gridLineVertical: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  pinContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinIcon: {
    fontSize: 48,
  },
  pinPulse: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(229, 57, 53, 0.15)',
    top: -6,
  },
  searchingBadge: {
    position: 'absolute',
    bottom: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.full,
    gap: spacing.sm,
    ...shadows.md,
  },
  searchingText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  topBar: {
    position: 'absolute',
    top: spacing.lg,
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  menuButton: {
    width: 44,
    height: 44,
    borderRadius: radii.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.md,
  },
  menuIcon: {
    fontSize: 20,
    color: colors.text,
  },
  safetyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.full,
    gap: spacing.xs,
    ...shadows.md,
  },
  safetyIcon: {
    fontSize: 16,
  },
  safetyText: {
    ...typography.bodySmall,
    fontWeight: '600',
    color: colors.text,
  },
  bottomSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    maxHeight: 320,
    ...shadows.lg,
  },
  handleBar: {
    width: 40,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  heading: {
    ...typography.h2,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  subheading: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  inputIcon: {
    fontSize: 18,
    marginRight: spacing.sm,
    zIndex: 1,
  },
  savedPlaceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.input,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  savedPlaceIcon: {
    width: 40,
    height: 40,
    borderRadius: radii.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  savedPlaceEmoji: {
    fontSize: 20,
  },
  savedPlaceContent: {
    flex: 1,
  },
  savedPlaceTitle: {
    ...typography.body,
    fontWeight: '600',
    color: colors.text,
  },
  savedPlaceSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  chevron: {
    fontSize: 24,
    color: colors.textTertiary,
  },
  currentLocationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.greenLight,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  currentLocationIcon: {
    fontSize: 16,
  },
  currentLocationText: {
    ...typography.bodySmall,
    color: colors.text,
    flex: 1,
  },
  bottomNav: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: spacing.sm,
    paddingBottom: spacing.md,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xs,
  },
  navIcon: {
    fontSize: 22,
    marginBottom: 2,
  },
  navIconActive: {
    opacity: 1,
  },
  navLabel: {
    ...typography.caption,
    color: colors.textTertiary,
  },
  navLabelActive: {
    color: colors.primary,
    fontWeight: '600',
  },
});

export default HomeScreen;
