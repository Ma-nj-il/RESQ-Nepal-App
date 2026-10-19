import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { colors, radii, shadows } from '../../constants/theme';

interface SearchRadarProps {
  /** When false the animation loops are stopped and reset. */
  active?: boolean;
  /** Diameter of the smallest radar circle in points. */
  baseSize?: number;
  /** Maximum scale applied to each expanding ring. */
  maxScale?: number;
}

const RING_COUNT = 3;
const RING_DURATION_MS = 3300;

/**
 * Decorative search-radius radar drawn over the map.
 *
 * This represents the app's search process only. It is not a GPS radius, a
 * driver location, or a claim that an ambulance has been found. The
 * animation loops are stopped whenever the screen is unfocused/unmounted.
 */
export const SearchRadar: React.FC<SearchRadarProps> = ({
  active = true,
  baseSize = 108,
  maxScale = 3.4,
}) => {
  const progress = useMemo(
    () => Array.from({ length: RING_COUNT }, () => new Animated.Value(0)),
    [],
  );
  const originPulse = useMemo(() => new Animated.Value(0), []);
  const loopsRef = useRef<Animated.CompositeAnimation[]>([]);
  const [reduceMotion, setReduceMotion] = useState(false);

  // Respect the OS "Reduce Motion" setting: the map still shows a static
  // search-origin ring, but no looping expansion is drawn.
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduceMotion(enabled);
      })
      .catch(() => {
        // Keep the default (animated) behaviour if the platform cannot answer.
      });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled) => setReduceMotion(enabled),
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    loopsRef.current.forEach((loop) => loop.stop());
    loopsRef.current = [];
    progress.forEach((value) => value.setValue(0));
    originPulse.setValue(0);

    if (!active || reduceMotion) return;

    // Stagger the rings so one is always expanding while another fades out.
    const loops = progress.map((value, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(index * (RING_DURATION_MS / RING_COUNT)),
          Animated.timing(value, {
            toValue: 1,
            duration: RING_DURATION_MS,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      ),
    );

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(originPulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(originPulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );

    loopsRef.current = [...loops, pulseLoop];
    loops.forEach((loop) => loop.start());
    pulseLoop.start();

    return () => {
      loopsRef.current.forEach((loop) => loop.stop());
      loopsRef.current = [];
      progress.forEach((value) => value.setValue(0));
      originPulse.setValue(0);
    };
  }, [active, maxScale, originPulse, progress, reduceMotion]);

  const pulseScale = originPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.12],
  });

  return (
    <View
      style={styles.container}
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {reduceMotion ? (
        <View
          style={[
            styles.ring,
            styles.staticRing,
            { width: baseSize, height: baseSize, borderRadius: baseSize / 2 },
          ]}
        />
      ) : (
        progress.map((value, index) => (
          <Animated.View
            key={index}
            style={[
              styles.ring,
              {
                width: baseSize,
                height: baseSize,
                borderRadius: baseSize / 2,
                opacity: value.interpolate({
                  inputRange: [0, 0.12, 0.75, 1],
                  outputRange: [0, 0.42, 0.2, 0],
                }),
                transform: [
                  {
                    scale: value.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.32, maxScale],
                    }),
                  },
                ],
              },
            ]}
          />
        ))
      )}

      <Animated.View style={[styles.originPulse, { transform: [{ scale: pulseScale }] }]} />
      <View style={styles.origin}>
        <Text style={styles.originIcon}>🚑</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: 'rgba(229, 57, 53, 0.05)',
  },
  staticRing: {
    opacity: 0.32,
  },
  originPulse: {
    position: 'absolute',
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: 'rgba(229, 57, 53, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(229, 57, 53, 0.35)',
  },
  origin: {
    width: 54,
    height: 54,
    borderRadius: radii.full,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.md,
  },
  originIcon: { fontSize: 24 },
});
