import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Avatar } from '../../components/ui';
import { colors, spacing, typography, radii, shadows } from '../../constants/theme';
import { bookingsService } from '../../services/database/bookings';
import { driversService } from '../../services/database/drivers';
import { profilesService } from '../../services/database/profiles';
import { isSupabaseConfigured } from '../../services/database/client';

type RouteParams = {
  Call: { bookingId: string; type: 'voice' | 'video' };
};

const CallScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const route = useRoute<RouteProp<RouteParams, 'Call'>>();
  const { bookingId, type } = route.params;

  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaker, setIsSpeaker] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(type === 'video');
  const [driverName, setDriverName] = useState('Driver');
  const [driverPhone, setDriverPhone] = useState<string | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setCallDuration((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Load the real driver's name and phone number when available — never an
  // invented person.
  useEffect(() => {
    (async () => {
      try {
        const booking = await bookingsService.getById(bookingId);
        if (!booking?.driver_id) return;
        const driver = await driversService.getById(booking.driver_id);
        if (!driver) return;
        const profile = await profilesService.getById(driver.user_id);
        if (profile?.full_name && profile.full_name.trim()) setDriverName(profile.full_name);
        if (profile?.phone) setDriverPhone(profile.phone);
      } catch {
        // Keep the generic label.
      }
    })();
  }, [bookingId]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleEndCall = () => {
    navigation.goBack();
  };

  const handlePhoneCall = () => {
    if (driverPhone) {
      Linking.openURL(`tel:${driverPhone}`).catch(() => {});
    }
  };

  const toggleMute = () => setIsMuted((prev) => !prev);
  const toggleSpeaker = () => setIsSpeaker((prev) => !prev);
  const toggleVideo = () => setIsVideoEnabled((prev) => !prev);

  return (
    <SafeAreaView style={styles.container}>
      {/* Video Preview (local) */}
      {isVideoEnabled && (
        <View style={styles.localVideoPreview}>
          <Text style={styles.localVideoText}>You</Text>
        </View>
      )}

      {/* Main Content */}
      <View style={styles.content}>
        {/* Driver Avatar */}
        <View style={styles.avatarContainer}>
          <Avatar name={driverName} size="xl" />
        </View>

        {/* Driver Name */}
        <Text style={styles.driverName}>{driverName}</Text>

        {/* Call Duration / Status */}
        <Text style={styles.callStatus}>
          {callDuration === 0 ? 'Calling...' : formatDuration(callDuration)}
        </Text>
        <Text style={styles.demoNote}>
          {isSupabaseConfigured
            ? 'Demo call screen — no in-app voice or video call is placed in this build.'
            : 'Sample mode — no call is placed.'}
        </Text>

        {/* Real phone dialing via the OS dialer, when the driver's number is on file */}
        {driverPhone && (
          <TouchableOpacity style={styles.phoneCallButton} onPress={handlePhoneCall} activeOpacity={0.7}>
            <Text style={styles.phoneCallText}>📞 Call on phone</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Control Buttons */}
      <View style={styles.controlsContainer}>
        <View style={styles.controlsRow}>
          {/* Mute */}
          <TouchableOpacity
            style={[styles.controlButton, isMuted && styles.controlButtonActive]}
            onPress={toggleMute}
            activeOpacity={0.7}
          >
            <Text style={styles.controlIcon}>{isMuted ? '🔇' : '🎤'}</Text>
            <Text style={styles.controlLabel}>{isMuted ? 'Unmute' : 'Mute'}</Text>
          </TouchableOpacity>

          {/* Speaker */}
          <TouchableOpacity
            style={[styles.controlButton, isSpeaker && styles.controlButtonActive]}
            onPress={toggleSpeaker}
            activeOpacity={0.7}
          >
            <Text style={styles.controlIcon}>🔊</Text>
            <Text style={styles.controlLabel}>Speaker</Text>
          </TouchableOpacity>

          {/* Video Toggle */}
          <TouchableOpacity
            style={[styles.controlButton, isVideoEnabled && styles.controlButtonActive]}
            onPress={toggleVideo}
            activeOpacity={0.7}
          >
            <Text style={styles.controlIcon}>{isVideoEnabled ? '📹' : '📷'}</Text>
            <Text style={styles.controlLabel}>{isVideoEnabled ? 'Video On' : 'Video Off'}</Text>
          </TouchableOpacity>
        </View>

        {/* End Call Button */}
        <TouchableOpacity
          style={styles.endCallButton}
          onPress={handleEndCall}
          activeOpacity={0.7}
        >
          <Text style={styles.endCallIcon}>📞</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1A1A2E',
  },

  localVideoPreview: {
    position: 'absolute',
    top: spacing.xxl,
    right: spacing.lg,
    width: 100,
    height: 140,
    borderRadius: radii.md,
    backgroundColor: '#2D2D44',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    ...shadows.lg,
  },
  localVideoText: { ...typography.caption, color: colors.textTertiary },

  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
  },
  avatarContainer: { marginBottom: spacing.xl },
  driverName: { ...typography.h1, color: colors.surface, marginBottom: spacing.sm },
  callStatus: { ...typography.body, color: colors.textTertiary },
  demoNote: {
    ...typography.caption,
    color: colors.textTertiary,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 16,
  },
  phoneCallButton: {
    marginTop: spacing.xl,
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radii.full,
  },
  phoneCallText: { ...typography.body, color: colors.surface, fontWeight: '600' },

  controlsContainer: {
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.xxxl,
    paddingTop: spacing.xl,
  },
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: spacing.xxl,
  },
  controlButton: {
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.lg,
    minWidth: 80,
  },
  controlButtonActive: {
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  controlIcon: { fontSize: 28 },
  controlLabel: { ...typography.caption, color: colors.surface },

  endCallButton: {
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.error,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.md,
  },
  endCallIcon: { fontSize: 28, color: colors.surface, transform: [{ rotate: '135deg' }] },
});

export default CallScreen;
