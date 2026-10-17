import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Header, EmptyState } from '../../components/ui';
import { colors, spacing, typography, radii, shadows } from '../../constants/theme';

interface FAQItem {
  id: string;
  question: string;
  answer: string;
  category: 'general' | 'account' | 'services' | 'ride';
}

const faqData: FAQItem[] = [
  {
    id: '1',
    question: 'How do I book an ambulance?',
    answer: 'To book an ambulance, go to the Home screen, enter your pickup location and destination, select the ambulance type, and tap "Book Now". You will be matched with the nearest available driver.',
    category: 'general',
  },
  {
    id: '2',
    question: 'What payment methods are accepted?',
    answer: 'We accept cash, eSewa, Khalti, PayPal, Google Pay, Apple Pay, and all major credit/debit cards (Visa, Mastercard, Amex).',
    category: 'account',
  },
  {
    id: '3',
    question: 'How can I track my ambulance?',
    answer: 'Once your booking is assigned, you can track the ambulance in real-time on the map. Go to Activity > Current Ride to see live location updates.',
    category: 'ride',
  },
  {
    id: '4',
    question: 'What types of ambulances are available?',
    answer: 'We offer Basic Life Support (BLS) and Intensive Care Unit (ICU) ambulances. ICU ambulances are equipped with advanced life support equipment and trained paramedics.',
    category: 'services',
  },
  {
    id: '5',
    question: 'How do I cancel a booking?',
    answer: 'You can cancel a booking from the Activity screen. Go to your active booking and tap "Cancel Booking". Cancellation fees may apply based on the timing.',
    category: 'ride',
  },
  {
    id: '6',
    question: 'How do I update my personal information?',
    answer: 'Go to Account > Personal Info to update your name, email, phone number, gender, and date of birth. Don\'t forget to save your changes.',
    category: 'account',
  },
  {
    id: '7',
    question: 'What is the average response time?',
    answer: 'Our average response time is 8-12 minutes in urban areas and 15-25 minutes in rural areas. We continuously work to reduce this time.',
    category: 'general',
  },
  {
    id: '8',
    question: 'How do I add a payment method?',
    answer: 'Go to Account > Payment Methods > Add New Payment. You can add cards, mobile wallets, or bank accounts. All payment information is securely encrypted.',
    category: 'account',
  },
  {
    id: '9',
    question: 'Are the drivers verified?',
    answer: 'Yes, all our drivers undergo background checks, license verification, and medical training. They are certified emergency medical technicians.',
    category: 'services',
  },
  {
    id: '10',
    question: 'How do I rate my ride?',
    answer: 'After your ride completes, you will receive a notification to rate your experience. You can also go to Activity > Past Rides and rate from there.',
    category: 'ride',
  },
  {
    id: '11',
    question: 'What areas do you cover?',
    answer: 'We currently cover Kathmandu Valley, Pokhara, Chitwan, and major highways. We are expanding to more cities soon.',
    category: 'services',
  },
  {
    id: '12',
    question: 'How can I contact support?',
    answer: 'You can reach us via the Contact Support page, email us at support@resq.com.np, or call our 24/7 helpline at 16600.',
    category: 'general',
  },
];

const categories = [
  { id: 'all', label: 'All' },
  { id: 'general', label: 'General' },
  { id: 'account', label: 'Account' },
  { id: 'services', label: 'Services' },
  { id: 'ride', label: 'Ride' },
] as const;

export const FAQScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filteredFAQs = useMemo(() => {
    return faqData.filter((faq) => {
      const matchesCategory = activeCategory === 'all' || faq.category === activeCategory;
      const matchesSearch =
        searchQuery === '' ||
        faq.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
        faq.answer.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [activeCategory, searchQuery]);

  const handleToggle = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <Header title="FAQ" showBack onBack={() => navigation.goBack()} />

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search for answers..."
          placeholderTextColor={colors.textTertiary}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {/* Category Tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabsContainer}
        contentContainerStyle={styles.tabsContent}
      >
        {categories.map((cat) => (
          <TouchableOpacity
            key={cat.id}
            style={[styles.tab, activeCategory === cat.id && styles.tabActive]}
            onPress={() => setActiveCategory(cat.id)}
          >
            <Text style={[styles.tabText, activeCategory === cat.id && styles.tabTextActive]}>
              {cat.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* FAQ List */}
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {filteredFAQs.length === 0 ? (
          <EmptyState
            icon="🔍"
            title="No results found"
            message="Try adjusting your search or category filter"
          />
        ) : (
          <View style={styles.listContainer}>
            {filteredFAQs.map((faq) => (
              <TouchableOpacity
                key={faq.id}
                style={styles.faqCard}
                activeOpacity={0.8}
                onPress={() => handleToggle(faq.id)}
              >
                <View style={styles.questionRow}>
                  <Text style={styles.questionText}>{faq.question}</Text>
                  <Text style={styles.expandIcon}>{expandedId === faq.id ? '−' : '+'}</Text>
                </View>
                {expandedId === faq.id && (
                  <Text style={styles.answerText}>{faq.answer}</Text>
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  searchContainer: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  searchInput: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 16,
    color: colors.text,
  },
  tabsContainer: { marginTop: spacing.md },
  tabsContent: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  tab: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { ...typography.bodySmall, color: colors.textSecondary, fontWeight: '600' },
  tabTextActive: { color: colors.surface },
  scrollView: { flex: 1, marginTop: spacing.md },
  listContainer: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.xxxl,
  },
  faqCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginBottom: spacing.sm,
    ...shadows.sm,
  },
  questionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  questionText: { ...typography.body, fontWeight: '600', flex: 1, marginRight: spacing.sm },
  expandIcon: { fontSize: 20, color: colors.primary, fontWeight: '700' },
  answerText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    lineHeight: 20,
  },
});
