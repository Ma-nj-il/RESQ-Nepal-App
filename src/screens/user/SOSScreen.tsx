import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { colors, spacing, typography } from '../../constants/theme';
import { Button, Card, Input } from '../../components/ui';
import { locationService } from '../../services/location/locationService';
import { sosService } from '../../services/sos/sosService';
import {
  emergencyContactsService,
  isValidPhone,
  MAX_EMERGENCY_CONTACTS,
  EmergencyContact,
} from '../../services/contacts/emergencyContactsService';
import { SOS_SMS_RECIPIENT, SOS_TAPS_REQUIRED, SOS_TAP_WINDOW_MS } from '../../constants/sos';
import { SosEvent } from '../../types';

type Phase = 'idle' | 'locating' | 'queued';

const formatCoords = (event: SosEvent) =>
  event.lat !== null && event.lng !== null
    ? `${event.lat.toFixed(5)}, ${event.lng.toFixed(5)}`
    : 'Location unavailable';

const formatTime = (iso: string) => new Date(iso).toLocaleString('en-US', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const deliveryLabel: Record<SosEvent['delivery_status'], string> = {
  queued: 'Queued on this device',
  sms_opened: 'SMS app opened',
  cancelled: 'Cancelled before sending',
};

/**
 * Dedicated emergency screen.
 *
 * Structure: three deliberate taps arm the alert, the device location is
 * recorded, and the event is stored in a local queue. Nothing is sent
 * automatically and nothing is sent anywhere by RESQ Nepal itself — if an
 * emergency SMS number is configured, the user can open the native SMS app
 * with a prefilled message; the app then states honestly that it cannot
 * confirm delivery.
 */
const SOSScreen: React.FC = () => {
  const navigation = useNavigation<any>();

  const [taps, setTaps] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [currentEvent, setCurrentEvent] = useState<SosEvent | null>(null);
  const [events, setEvents] = useState<SosEvent[]>([]);
  const [smsOpened, setSmsOpened] = useState(false);

  // Trusted contacts — stored on the device only.
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [contactFormOpen, setContactFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactRelation, setContactRelation] = useState('');
  const [contactError, setContactError] = useState<string | null>(null);

  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapRef = useRef<number>(0);

  useEffect(() => {
    let active = true;
    (async () => {
      const queue = await sosService.getQueue();
      if (active) setEvents(queue);
      const savedContacts = await emergencyContactsService.getAll();
      if (active) setContacts(savedContacts);
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, []);

  const armAndMaybeActivate = useCallback(async () => {
    const now = Date.now();
    // If the previous tap is older than the window, start the count over.
    const nextTaps = now - lastTapRef.current > SOS_TAP_WINDOW_MS ? 1 : taps + 1;
    lastTapRef.current = now;

    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);

    if (nextTaps < SOS_TAPS_REQUIRED) {
      setTaps(nextTaps);
      // Auto-reset the progress if the user stops tapping.
      resetTimerRef.current = setTimeout(() => setTaps(0), SOS_TAP_WINDOW_MS);
      return;
    }

    setTaps(0);
    setPhase('locating');
    setSmsOpened(false);

    let lat: number | null = null;
    let lng: number | null = null;
    try {
      const hasPermission = await locationService.requestPermission();
      if (hasPermission) {
        const loc = await locationService.getCurrentLocation();
        if (loc) {
          lat = loc.lat;
          lng = loc.lng;
        }
      }
    } catch {
      // Location stays unavailable — the alert records that honestly.
    }

    const event: SosEvent = {
      id: `sos-${Date.now()}`,
      created_at: new Date().toISOString(),
      lat,
      lng,
      location_status: lat !== null && lng !== null ? 'acquired' : 'unavailable',
      delivery_status: 'queued',
      sms_recipient: SOS_SMS_RECIPIENT || null,
    };

    await sosService.addEvent(event);
    const queue = await sosService.getQueue();
    setEvents(queue);
    setCurrentEvent(event);
    setPhase('queued');
  }, [taps]);

  const openSmsComposer = useCallback(
    async (recipient: string) => {
      if (!currentEvent) return;
      const locationLine =
        currentEvent.lat !== null && currentEvent.lng !== null
          ? `My location: https://maps.google.com/?q=${currentEvent.lat},${currentEvent.lng}`
          : 'My location could not be determined.';
      const body = `RESQ Nepal SOS — I need emergency help. ${locationLine}`;
      const url = `sms:${recipient}?body=${encodeURIComponent(body)}`;

      try {
        const supported = await Linking.canOpenURL(`sms:${recipient}`);
        if (!supported) {
          Alert.alert(
            'SMS unavailable',
            'This device cannot open an SMS composer. Use your phone app to send the alert manually.',
          );
          return;
        }
        await Linking.openURL(url);
        // The app cannot confirm delivery — only the messaging app can.
        await sosService.updateDeliveryStatus(currentEvent.id, 'sms_opened');
        const queue = await sosService.getQueue();
        setEvents(queue);
        setCurrentEvent({ ...currentEvent, delivery_status: 'sms_opened' });
        setSmsOpened(true);
      } catch {
        Alert.alert('Could not open SMS', 'Open your messaging app and send the alert manually.');
      }
    },
    [currentEvent],
  );

  const openAddContact = useCallback(() => {
    setEditingId(null);
    setContactName('');
    setContactPhone('');
    setContactRelation('');
    setContactError(null);
    setContactFormOpen(true);
  }, []);

  const openEditContact = useCallback((contact: EmergencyContact) => {
    setEditingId(contact.id);
    setContactName(contact.name);
    setContactPhone(contact.phone);
    setContactRelation(contact.relationship ?? '');
    setContactError(null);
    setContactFormOpen(true);
  }, []);

  const handleSaveContact = useCallback(async () => {
    const name = contactName.trim();
    const phone = contactPhone.trim();
    if (!name) {
      setContactError('Enter a name for this contact.');
      return;
    }
    if (!isValidPhone(phone)) {
      setContactError('Enter a valid phone number (7–15 digits).');
      return;
    }
    const payload = {
      name,
      phone,
      relationship: contactRelation.trim() || undefined,
    };
    const next = editingId
      ? await emergencyContactsService.update(editingId, payload)
      : await emergencyContactsService.add(payload);
    setContacts(next);
    setContactFormOpen(false);
    setEditingId(null);
  }, [contactName, contactPhone, contactRelation, editingId]);

  const handleDeleteContact = useCallback((contact: EmergencyContact) => {
    Alert.alert('Remove contact?', `Remove ${contact.name} from your trusted contacts?`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setContacts(await emergencyContactsService.remove(contact.id));
        },
      },
    ]);
  }, []);

  const handleReset = useCallback(() => {
    setPhase('idle');
    setCurrentEvent(null);
    setSmsOpened(false);
    setTaps(0);
  }, []);

  const handleClearQueue = useCallback(() => {
    Alert.alert('Clear saved alerts?', 'This removes the local SOS history from this device.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          await sosService.clear();
          setEvents([]);
          setCurrentEvent(null);
          setPhase('idle');
        },
      },
    ]);
  }, []);

  const progressText =
    phase === 'idle'
      ? taps === 0
        ? `Tap ${SOS_TAPS_REQUIRED} times to arm the alert`
        : `${taps} of ${SOS_TAPS_REQUIRED} taps — keep tapping`
      : null;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Emergency SOS</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Trusted contacts */}
        <Card elevation="sm" style={styles.contactsCard}>
          <View style={styles.contactsHeader}>
            <Text style={styles.eventTitle}>Trusted contacts</Text>
            {contacts.length < MAX_EMERGENCY_CONTACTS && !contactFormOpen && (
              <TouchableOpacity
                onPress={openAddContact}
                accessibilityRole="button"
                accessibilityLabel="Add trusted contact"
              >
                <Text style={styles.clearText}>+ Add</Text>
              </TouchableOpacity>
            )}
          </View>
          <Text style={styles.contactsIntro}>
            Saved on this phone only. Used to prefill the SOS message — nothing is sent
            automatically.
          </Text>

          {contactFormOpen ? (
            <View>
              <Input
                label="Name *"
                placeholder="e.g. Aama"
                value={contactName}
                onChangeText={setContactName}
              />
              <Input
                label="Phone *"
                placeholder="+977-98XXXXXXXX"
                keyboardType="phone-pad"
                value={contactPhone}
                onChangeText={setContactPhone}
              />
              <Input
                label="Relationship (optional)"
                placeholder="e.g. Mother"
                value={contactRelation}
                onChangeText={setContactRelation}
              />
              {contactError ? <Text style={styles.contactError}>{contactError}</Text> : null}
              <View style={styles.contactFormActions}>
                <Button
                  title={editingId ? 'Save changes' : 'Save contact'}
                  size="sm"
                  onPress={() => void handleSaveContact()}
                  style={styles.contactFormButton}
                />
                <Button
                  title="Cancel"
                  variant="ghost"
                  size="sm"
                  onPress={() => {
                    setContactFormOpen(false);
                    setEditingId(null);
                  }}
                  style={styles.contactFormButton}
                />
              </View>
            </View>
          ) : contacts.length === 0 ? (
            <Text style={styles.contactsEmpty}>
              No trusted contacts yet. Add a family member or a friend who should receive your
              alert.
            </Text>
          ) : (
            contacts.map((contact) => (
              <View key={contact.id} style={styles.contactRow}>
                <View style={styles.contactInfo}>
                  <Text style={styles.contactName}>
                    {contact.name}
                    {contact.relationship ? ` · ${contact.relationship}` : ''}
                  </Text>
                  <Text style={styles.contactPhone}>{contact.phone}</Text>
                </View>
                <TouchableOpacity
                  onPress={() => openEditContact(contact)}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${contact.name}`}
                >
                  <Text style={styles.contactAction}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleDeleteContact(contact)}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${contact.name}`}
                >
                  <Text style={[styles.contactAction, styles.contactRemove]}>Remove</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </Card>

        {/* Arm button */}
        <View style={styles.armArea}>
          <TouchableOpacity
            style={[styles.armButton, phase === 'queued' && styles.armButtonDone]}
            onPress={() => {
              if (phase === 'idle') void armAndMaybeActivate();
            }}
            disabled={phase !== 'idle'}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={`Emergency SOS button. ${progressText || 'Alert armed'}`}
          >
            {phase === 'locating' ? (
              <ActivityIndicator size="large" color={colors.surface} />
            ) : (
              <>
                <Text style={styles.armButtonText}>{phase === 'queued' ? 'ALERT ARMED' : 'SOS'}</Text>
                <Text style={styles.armButtonSub}>
                  {phase === 'queued' ? 'Queued on this device' : `${SOS_TAPS_REQUIRED} taps`}
                </Text>
              </>
            )}
          </TouchableOpacity>

          {/* Tap progress dots */}
          {phase === 'idle' && (
            <View style={styles.progressRow}>
              {Array.from({ length: SOS_TAPS_REQUIRED }).map((_, index) => (
                <View key={index} style={[styles.progressDot, index < taps && styles.progressDotFilled]} />
              ))}
            </View>
          )}
          {progressText && phase === 'idle' && <Text style={styles.progressText}>{progressText}</Text>}
          {phase === 'locating' && <Text style={styles.progressText}>Recording your location…</Text>}
        </View>

        {/* Current event */}
        {currentEvent && phase === 'queued' && (
          <Card elevation="md" style={styles.eventCard}>
            <Text style={styles.eventTitle}>What happens now</Text>
            <View style={styles.eventRow}>
              <Text style={styles.eventLabel}>Time</Text>
              <Text style={styles.eventValue}>{formatTime(currentEvent.created_at)}</Text>
            </View>
            <View style={styles.eventRow}>
              <Text style={styles.eventLabel}>Location</Text>
              <Text style={styles.eventValue}>{formatCoords(currentEvent)}</Text>
            </View>
            <View style={styles.eventRow}>
              <Text style={styles.eventLabel}>Status</Text>
              <Text style={styles.eventValue}>{deliveryLabel[currentEvent.delivery_status]}</Text>
            </View>

            <View style={styles.divider} />

            {contacts.length > 0 || SOS_SMS_RECIPIENT ? (
              <>
                {contacts.slice(0, 3).map((contact) => (
                  <Button
                    key={contact.id}
                    title={smsOpened ? `Re-open SMS to ${contact.name}` : `Message ${contact.name}`}
                    onPress={() => void openSmsComposer(contact.phone)}
                    fullWidth
                    style={styles.smsButton}
                  />
                ))}
                {SOS_SMS_RECIPIENT ? (
                  <Button
                    title={
                      smsOpened
                        ? 'Re-open SMS to your saved number'
                        : `Message your saved SOS number (${SOS_SMS_RECIPIENT})`
                    }
                    onPress={() => void openSmsComposer(SOS_SMS_RECIPIENT)}
                    fullWidth
                    style={styles.smsButton}
                  />
                ) : null}
                <Text style={styles.helperText}>
                  {smsOpened
                    ? 'The SMS app was opened with a prefilled message. RESQ Nepal cannot confirm whether it was delivered — check your messaging app.'
                    : 'Opens your messaging app with a prefilled alert for the contact you choose. Nothing is sent until you press send in that app.'}
                </Text>
              </>
            ) : (
              <Text style={styles.helperText}>
                No trusted contact or emergency SMS number is configured, so the alert stays on this
                device. Add a trusted contact above so you can send them your alert.
              </Text>
            )}

            <Button title="Start over" onPress={handleReset} variant="outline" fullWidth style={styles.secondaryAction} />
          </Card>
        )}

        {/* Honest disclaimer */}
        <Card elevation="sm" style={styles.noteCard}>
          <Text style={styles.noteText}>
            RESQ Nepal records this alert on your device and, if configured, helps you open an SMS.
            It does not dispatch an ambulance by itself. For a life-threatening emergency, also
            call your local emergency number directly.
          </Text>
        </Card>

        {/* Local alert history */}
        {events.length > 0 && (
          <Card elevation="sm" style={styles.historyCard}>
            <View style={styles.historyHeader}>
              <Text style={styles.eventTitle}>Saved alerts on this device</Text>
              <TouchableOpacity onPress={handleClearQueue} accessibilityRole="button">
                <Text style={styles.clearText}>Clear</Text>
              </TouchableOpacity>
            </View>
            {events.slice(0, 5).map((event) => (
              <View key={event.id} style={styles.historyRow}>
                <View style={styles.historyDot} />
                <View style={styles.historyInfo}>
                  <Text style={styles.historyTime}>{formatTime(event.created_at)}</Text>
                  <Text style={styles.historyMeta}>
                    {deliveryLabel[event.delivery_status]} · {formatCoords(event)}
                  </Text>
                </View>
              </View>
            ))}
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  backArrow: { fontSize: 24, color: colors.text },
  headerTitle: { ...typography.h3, flex: 1, textAlign: 'center' },
  headerSpacer: { width: 44 },

  content: { padding: spacing.lg, paddingBottom: spacing.xxxl, alignItems: 'stretch' },

  contactsCard: { marginBottom: spacing.lg },
  contactsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  contactsIntro: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  contactsEmpty: { ...typography.bodySmall, color: colors.textSecondary, marginTop: spacing.md },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  contactInfo: { flex: 1 },
  contactName: { ...typography.bodySmall, fontWeight: '600', color: colors.text },
  contactPhone: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  contactAction: { ...typography.bodySmall, color: colors.primary, fontWeight: '700' },
  contactRemove: { color: colors.error },
  contactError: { ...typography.bodySmall, color: colors.error, marginBottom: spacing.sm },
  contactFormActions: { flexDirection: 'row', gap: spacing.sm },
  contactFormButton: { flex: 1 },
  smsButton: { marginBottom: spacing.sm },

  armArea: { alignItems: 'center', marginVertical: spacing.xl },
  armButton: {
    width: 190,
    height: 190,
    borderRadius: 95,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 8,
    borderColor: 'rgba(229, 57, 69, 0.25)',
  },
  armButtonDone: { backgroundColor: colors.primaryDark },
  armButtonText: { fontSize: 40, fontWeight: '800', color: colors.surface, letterSpacing: 2 },
  armButtonSub: { ...typography.caption, color: 'rgba(255,255,255,0.9)', marginTop: spacing.xs },
  progressRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  progressDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.disabled,
  },
  progressDotFilled: { backgroundColor: colors.primaryDark },
  progressText: { ...typography.bodySmall, color: colors.textSecondary, marginTop: spacing.md, textAlign: 'center' },

  eventCard: { marginBottom: spacing.lg },
  eventTitle: { ...typography.h4, marginBottom: spacing.md },
  eventRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm, gap: spacing.md },
  eventLabel: { ...typography.bodySmall, color: colors.textSecondary },
  eventValue: { ...typography.bodySmall, fontWeight: '600', flex: 1, textAlign: 'right' },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.md },
  helperText: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm, lineHeight: 17 },
  secondaryAction: { marginTop: spacing.md },

  noteCard: { marginBottom: spacing.lg, backgroundColor: colors.amberLight },
  noteText: { ...typography.bodySmall, color: colors.warning, lineHeight: 20 },

  historyCard: { marginBottom: spacing.lg },
  historyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  clearText: { ...typography.bodySmall, color: colors.primary, fontWeight: '700' },
  historyRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, gap: spacing.md },
  historyDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primaryDark },
  historyInfo: { flex: 1 },
  historyTime: { ...typography.bodySmall, fontWeight: '600' },
  historyMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
});

export default SOSScreen;
