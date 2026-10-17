import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, spacing, typography } from '../../constants/theme';
import { ONBOARDING_SEEN_KEY } from '../../constants/storage';
import { Button } from '../../components/ui';



interface OnboardingScreenProps {
  navigation: any;
}

const slides = [
  {
    id: 1,
    icon: '🚑',
    title: 'RESQ Nepal - Your hassle-free ambulance booking solution',
    description: 'Book an ambulance in seconds with just a few taps. No more waiting in emergency situations.',
  },
  {
    id: 2,
    icon: '🗺️',
    title: 'Find nearby ambulances tailored to your needs',
    description: 'Locate the closest available ambulances based on your real-time location and requirements.',
  },
  {
    id: 3,
    icon: '🛡️',
    title: 'Enjoy a seamless emergency transport experience',
    description: 'Track your ambulance in real-time and reach the hospital safely with professional drivers.',
  },
];

const OnboardingScreen: React.FC<OnboardingScreenProps> = ({ navigation }) => {
  const [currentSlide, setCurrentSlide] = useState(0);

  const markSeenAndContinue = () => {
    // Remember that onboarding was completed so later launches (and logouts)
    // go straight to the Welcome/Sign-in screen.
    AsyncStorage.setItem(ONBOARDING_SEEN_KEY, '1').catch(() => {});
    navigation.replace('Welcome');
  };

  const handleContinue = () => {
    if (currentSlide < slides.length - 1) {
      setCurrentSlide(currentSlide + 1);
    }
  };

  const handleSkip = () => {
    markSeenAndContinue();
  };

  const handleGetStarted = () => {
    markSeenAndContinue();
  };

  const isLastSlide = currentSlide === slides.length - 1;

  return (
    <SafeAreaView style={styles.container}>
      {/* Skip Button */}
      <View style={styles.skipContainer}>
        {!isLastSlide && (
          <TouchableOpacity onPress={handleSkip} style={styles.skipButton}>
            <Text style={styles.skipText}>Skip</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Slide Content */}
      <View style={styles.slideContent}>
        <Text style={styles.icon}>{slides[currentSlide].icon}</Text>
        <Text style={styles.title}>{slides[currentSlide].title}</Text>
        <Text style={styles.description}>{slides[currentSlide].description}</Text>
      </View>

      {/* Dot Indicators */}
      <View style={styles.dotsContainer}>
        {slides.map((_, index) => (
          <View
            key={index}
            style={[styles.dot, index === currentSlide && styles.activeDot]}
          />
        ))}
      </View>

      {/* Action Button */}
      <View style={styles.footer}>
        {isLastSlide ? (
          <Button title="Let's Get Started" onPress={handleGetStarted} fullWidth size="lg" />
        ) : (
          <Button title="Continue" onPress={handleContinue} fullWidth size="lg" />
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primary,
  },
  skipContainer: {
    alignItems: 'flex-end',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
  },
  skipButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  skipText: {
    ...typography.body,
    color: 'rgba(255,255,255,0.8)',
    fontWeight: '500',
  },
  slideContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
  },
  icon: {
    fontSize: 80,
    marginBottom: spacing.xxl,
  },
  title: {
    ...typography.h2,
    color: colors.surface,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  description: {
    ...typography.body,
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
    lineHeight: 24,
  },
  dotsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  activeDot: {
    backgroundColor: colors.surface,
    width: 24,
  },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
  },
});

export default OnboardingScreen;
