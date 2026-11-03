import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import type { NativeBackendRuntime } from '../../services/api/backend/nativeRuntime';
import type { booking, trip, fareQuote, tracking, timeline, QuoteInput } from '../../services/api/backend/dispatch';
import { formatNprMinor } from '../../services/api/backend/decoders';
import { BackendError } from '../../services/api/backend/errors';
import { useBackendCommand } from './useBackendCommand';

const initialForm = {
  serviceCategory: '', pickupLatitude: '', pickupLongitude: '', destinationLatitude: '', destinationLongitude: '',
  pickupGeographicUnitId: '', patientName: '', pickupContactName: '', pickupContactPhone: '',
};
const labels: Record<keyof typeof initialForm, string> = {
  serviceCategory: 'Service category code', pickupLatitude: 'Pickup latitude', pickupLongitude: 'Pickup longitude',
  destinationLatitude: 'Destination latitude', destinationLongitude: 'Destination longitude',
  pickupGeographicUnitId: 'Pickup geography ID', patientName: 'Patient name',
  pickupContactName: 'Pickup contact name', pickupContactPhone: 'Pickup contact phone',
};

export function BackendDispatchPreview({ runtime }: { runtime: NativeBackendRuntime }) {
  const [bookings, setBookings] = useState<ReturnType<typeof booking>[]>([]);
  const [trips, setTrips] = useState<ReturnType<typeof trip>[]>([]);
  const [bookingCursor, setBookingCursor] = useState<string | null>(null);
  const [tripCursor, setTripCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReturnType<typeof booking> | null>(null);
  const [events, setEvents] = useState<ReturnType<typeof timeline>[]>([]);
  const [location, setLocation] = useState<ReturnType<typeof tracking> | null>(null);
  const [trackingObservedAt, setTrackingObservedAt] = useState<number | null>(null);
  const [form, setForm] = useState(initialForm);
  const [quote, setQuote] = useState<ReturnType<typeof fareQuote> | null>(null);
  const [urgency, setUrgency] = useState<'ROUTINE' | 'URGENT' | 'EMERGENCY'>('ROUTINE');
  const [consent, setConsent] = useState(false);
  const [locationConsent, setLocationConsent] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);
  const reading = useRef(false);
  const command = useBackendCommand(runtime.generateId);
  const disabled = busy || command.unresolved;
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const read = async (work: () => Promise<void>) => {
    if (reading.current) return;
    reading.current = true;
    setBusy(true);
    setError(null);
    try { await work(); } catch (failure) {
      if (active.current) setError(failure instanceof BackendError ? failure.message : 'Unable to load dispatch data.');
    } finally { reading.current = false; if (active.current) setBusy(false); }
  };
  const routeInput = (): QuoteInput => {
    const coordinates = ['pickupLatitude', 'pickupLongitude', 'destinationLatitude', 'destinationLongitude'] as const;
    if (coordinates.some((key) => !form[key].trim() || !Number.isFinite(Number(form[key])))) {
      throw new BackendError({ code: 'CLIENT.COORDINATES_REQUIRED', message: 'Enter valid pickup and destination coordinates.' });
    }
    return { serviceCategory: form.serviceCategory, pickupLatitude: Number(form.pickupLatitude), pickupLongitude: Number(form.pickupLongitude),
      destinationLatitude: Number(form.destinationLatitude), destinationLongitude: Number(form.destinationLongitude) };
  };
  return <View style={{ gap: 12 }}>
    <Text accessibilityRole="header">Booking and trip acceptance</Text>
    {error && <Text accessibilityRole="alert">{error}</Text>}
    {command.notice && <Text accessibilityRole="alert">{command.notice}</Text>}
    {command.unresolved && <Button title="Retry dispatch request" disabled={command.busy} onPress={() => { void command.retry(); }} />}
    <Button title="Refresh bookings and trips" disabled={busy} onPress={() => { void read(async () => {
      const [bookings, trips] = await Promise.all([runtime.dispatch.bookings(), runtime.dispatch.trips()]);
      if (active.current) { setBookings(bookings.data.items); setTrips(trips.data.items); setLocation(null);
        setBookingCursor(bookings.data.nextCursor); setTripCursor(trips.data.nextCursor); }
    }); }} />
    {bookings.map((item) => <Button key={item.id} title={`${item.bookingReference}: ${item.status}`} disabled={disabled}
      onPress={() => { void read(async () => {
        const [booking, history] = await Promise.all([runtime.dispatch.booking(item.id), runtime.dispatch.timeline(item.id)]);
        if (active.current) { setSelected(booking.data); setEvents(history.data.items); }
      }); }} />)}
    {bookingCursor && <Button title="Next bookings" disabled={busy} onPress={() => { void read(async () => {
      const { data } = await runtime.dispatch.bookings(bookingCursor);
      if (active.current) { setBookings(data.items); setBookingCursor(data.nextCursor); }
    }); }} />}
    {selected && <View style={{ gap: 8 }}>
      <Text>{selected.bookingReference}: {selected.status} (version {selected.version})</Text>
      {events.map((item) => <Text key={item.id}>{item.occurredAt}: {item.aggregateType} {item.toStatus}</Text>)}
      <Input label="Cancellation reason" accessibilityLabel="Cancellation reason" maxLength={1024} value={reason} onChangeText={setReason} editable={!disabled} />
      <Button title="Request booking cancellation" disabled={disabled || reason.trim().length < 3}
        onPress={() => command.submit({ id: selected.id, reasonCode: 'REQUESTER_REQUESTED', reason },
          (value, identity) => runtime.dispatch.cancelBooking(value.id, { reasonCode: value.reasonCode, reason: value.reason }, {
            idempotencyKey: identity.idempotencyKey, expectedVersion: identity.expectedVersion!,
          }), ({ data }) => { setSelected(data); setEvents([]); setBookings((items) => items.map((item) => item.id === data.id ? data : item)); }, selected.version)} />
    </View>}
    {trips.map((item) => <View key={item.id} style={{ gap: 8 }}>
      <Text>Trip {item.id}: {item.status}</Text>
      {item.finalFare && <Text>{formatNprMinor(item.finalFare.amountMinor)} ({item.finalFare.provenance})</Text>}
      <Button title="Fetch tracking snapshot" disabled={busy} onPress={() => { setLocation(null); void read(async () => {
        const { data } = await runtime.dispatch.tracking(item.id);
        if (active.current) { setLocation(data); setTrackingObservedAt(Date.now()); }
      }); }} />
    </View>)}
    {tripCursor && <Button title="Next trips" disabled={busy} onPress={() => { void read(async () => {
      const { data } = await runtime.dispatch.trips(tripCursor);
      if (active.current) { setTrips(data.items); setTripCursor(data.nextCursor); setLocation(null); }
    }); }} />}
    {location && <View>
      <Text>Trip {location.tripId}: server freshness {location.freshness} when fetched at {new Date(trackingObservedAt!).toISOString()}.</Text>
      {'position' in location && <Text>Captured {location.capturedAt}; quality {location.quality}; {location.position.latitude}, {location.position.longitude}.</Text>}
      <Text>This is a snapshot. Refresh to check the current position; an old snapshot is not live tracking.</Text>
    </View>}
    <Text accessibilityRole="header">Create test booking</Text>
    {(Object.keys(form) as (keyof typeof form)[]).map((key) => <Input key={key} label={labels[key]} accessibilityLabel={labels[key]}
      value={form[key]} editable={!disabled} autoCapitalize="none" onChangeText={(value) => {
        setForm((current) => ({ ...current, [key]: value })); setQuote(null);
      }} />)}
    {(['ROUTINE', 'URGENT', 'EMERGENCY'] as const).map((value) => <Button key={value} title={`${urgency === value ? 'Selected: ' : ''}${value}`}
      variant="outline" disabled={disabled} onPress={() => setUrgency(value)} />)}
    <Button title={`Emergency transport consent: ${consent ? 'Yes' : 'No'}`} disabled={disabled} variant="outline" onPress={() => setConsent(!consent)} />
    <Button title={`Location sharing consent: ${locationConsent ? 'Yes' : 'No'}`} disabled={disabled} variant="outline" onPress={() => setLocationConsent(!locationConsent)} />
    <Button title="Check coverage and get quote" disabled={disabled} onPress={() => { setQuote(null); void read(async () => {
      const input = routeInput();
      const coverage = await runtime.dispatch.coverage({ serviceCategory: input.serviceCategory, pickupLatitude: input.pickupLatitude, pickupLongitude: input.pickupLongitude });
      if (!coverage.data.covered) throw new BackendError({ code: 'CLIENT.NOT_COVERED', message: 'The pickup is not covered.' });
      const { data } = await runtime.dispatch.quote(input);
      if (active.current) setQuote(data);
    }); }} />
    {quote && <View style={{ gap: 8 }}>
      <Text>{formatNprMinor(quote.fare.amountMinor)}; {quote.route.quality}; expires {quote.expiresAt}</Text>
      <Button title="Confirm booking" disabled={disabled || !consent || !locationConsent} onPress={() => {
        if (Date.parse(quote.expiresAt) <= Date.now()) { setQuote(null); setError('Quote expired. Request a new quote.'); return; }
        command.submit({ ...routeInput(), fareQuoteId: quote.id, pickupGeographicUnitId: form.pickupGeographicUnitId,
          patientName: form.patientName, pickupContactName: form.pickupContactName, pickupContactPhone: form.pickupContactPhone,
          urgency, emergencyTransportConsent: consent, locationSharingConsent: locationConsent },
        (value, identity) => runtime.dispatch.createBooking(value, identity.idempotencyKey), ({ data }) => {
          setSelected(data); setEvents([]); setQuote(null); setForm(initialForm); setConsent(false); setLocationConsent(false);
        });
      }} />
    </View>}
  </View>;
}
