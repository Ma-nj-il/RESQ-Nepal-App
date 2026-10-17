import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { colors, spacing, typography } from '../../constants/theme';

type LegalKind = 'privacy' | 'terms';

/**
 * Draft legal content that describes what this build of the app actually
 * does. Clearly marked as a draft — RESQ Nepal must finalise it before any
 * public release.
 */
const CONTENT: Record<LegalKind, { title: string; intro: string; sections: { heading: string; body: string }[] }> = {
  privacy: {
    title: 'Privacy Policy',
    intro:
      'Draft — this document describes what the RESQ Nepal app stores today. It will be reviewed and finalised before public release.',
    sections: [
      {
        heading: 'What we store',
        body: 'When you create an account we store your phone number and, if you provide it, your name, email address, gender and date of birth. Bookings store the pickup and destination you enter, the patient name and phone number you provide, the category of ambulance and a fare estimate.',
      },
      {
        heading: 'Where it is stored',
        body: 'Data is stored in a Supabase-hosted database. Row-level security restricts access so that you can only read your own profile, bookings and related records; drivers see only the bookings needed to do their job.',
      },
      {
        heading: 'What we do not store',
        body: 'This build does not store card or wallet details, does not upload identity documents, and does not track your location beyond the addresses you type or the current location you explicitly request.',
      },
      {
        heading: 'Your requests',
        body: 'From Account & Security you can request account deactivation or deletion. Requests are recorded in the app database for the RESQ Nepal team to action.',
      },
    ],
  },
  terms: {
    title: 'Terms of Service',
    intro:
      'Draft — these terms summarise how this build of the RESQ Nepal app behaves. They will be reviewed and finalised before public release.',
    sections: [
      {
        heading: 'Service scope',
        body: 'RESQ Nepal is an ambulance booking app currently in development. It connects passengers with ambulance drivers and operators; it is not itself an emergency service. In a real emergency, also contact local emergency numbers.',
      },
      {
        heading: 'Demo payments',
        body: 'Wallets, top-ups and payment screens in this build are demonstrative. No money is collected, transferred or stored, and fares shown are estimates.',
      },
      {
        heading: 'Driver applications',
        body: 'Driver accounts are reviewed by an administrator before they can accept bookings. Submitting an application does not guarantee approval.',
      },
      {
        heading: 'Acceptable use',
        body: 'Do not submit false bookings or misuse driver information. Accounts or bookings that violate these terms may be removed.',
      },
    ],
  },
};

const LegalScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const kind: LegalKind = route.params?.kind === 'terms' ? 'terms' : 'privacy';
  const content = CONTENT[kind];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{content.title}</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>{content.intro}</Text>
        {content.sections.map((section) => (
          <View key={section.heading} style={styles.section}>
            <Text style={styles.sectionHeading}>{section.heading}</Text>
            <Text style={styles.sectionBody}>{section.body}</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 24, color: colors.text },
  headerTitle: { ...typography.h3 },
  content: { padding: spacing.lg, paddingTop: 0 },
  intro: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: spacing.lg,
  },
  section: { marginBottom: spacing.lg },
  sectionHeading: { ...typography.h4, marginBottom: spacing.xs },
  sectionBody: { ...typography.body, color: colors.textSecondary, lineHeight: 22 },
});

export default LegalScreen;
