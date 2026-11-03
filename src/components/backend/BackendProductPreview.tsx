import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import type { NativeBackendRuntime } from '../../services/api/backend/nativeRuntime';
import type { Ticket, message } from '../../services/api/backend/requester';
import { BackendError } from '../../services/api/backend/errors';
import { formatNprMinor } from '../../services/api/backend/decoders';
import { useBackendCommand } from './useBackendCommand';

type Page = Awaited<ReturnType<NativeBackendRuntime['api']['tickets']>>['data'];
type Receipt = Awaited<ReturnType<NativeBackendRuntime['api']['receipt']>>['data'];

export function BackendProductPreview({ runtime }: { runtime: NativeBackendRuntime }) {
  const [tickets, setTickets] = useState<Page | null>(null);
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<{ items: ReturnType<typeof message>[]; nextAfterId: string | null } | null>(null);
  const [category, setCategory] = useState<Ticket['category']>('SERVICE');
  const [draft, setDraft] = useState('');
  const [tripId, setTripId] = useState('');
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [readBusy, setReadBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const reading = useRef(false);
  const command = useBackendCommand(runtime.commands.product);
  const disabled = command.busy || command.unresolved || readBusy;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const read = async (work: () => Promise<void>) => {
    if (reading.current) return;
    reading.current = true;
    setReadBusy(true);
    setError(null);
    try { await work(); } catch (failure) {
      if (mounted.current) setError(failure instanceof BackendError ? failure.message : 'Unable to load server data.');
    } finally { reading.current = false; if (mounted.current) setReadBusy(false); }
  };
  const loadTickets = (afterId?: string) => read(async () => {
    const { data } = await runtime.api.tickets(afterId);
    if (mounted.current) setTickets(data);
  });
  const loadTicket = (id: string, afterId?: string) => read(async () => {
    const [ticket, messages] = await Promise.all([runtime.api.ticket(id), runtime.api.messages(id, afterId)]);
    if (mounted.current) { setSelected(ticket.data); setMessages(messages.data); }
  });
  return <View style={{ gap: 12 }}>
    <Text accessibilityRole="header">Support</Text>
    {error && <Text accessibilityRole="alert">{error}</Text>}
    {command.notice && <Text accessibilityRole="alert">{command.notice}</Text>}
    {command.unresolved && <Button title="Retry same request" disabled={command.busy} onPress={() => { void command.retry(); }} />}
    <Button title="Load support tickets" disabled={readBusy} onPress={() => { void loadTickets(); }} />
    {tickets?.items.length === 0 && <Text>No tickets on this page.</Text>}
    {tickets?.items.map((ticket) => <Button key={ticket.id} title={`${ticket.category}: ${ticket.status}`} disabled={disabled}
      onPress={() => { setMessages(null); setDraft(''); void loadTicket(ticket.id); }} />)}
    {tickets?.nextAfterId && <Button title="Next tickets" disabled={readBusy} onPress={() => { void loadTickets(tickets.nextAfterId!); }} />}
    {selected && <View style={{ gap: 8 }}>
      <Text>Ticket {selected.id}: {selected.status} (version {selected.version})</Text>
      {messages?.items.map((item) => <Text key={item.id}>{item.createdAt}: {item.message}</Text>)}
      {messages?.nextAfterId && <Button title="Next messages" disabled={readBusy}
        onPress={() => { void loadTicket(selected.id, messages.nextAfterId!); }} />}
      <Button title="Refresh ticket" disabled={readBusy} onPress={() => { void loadTicket(selected.id); }} />
      <Button title="New ticket" disabled={disabled} onPress={() => { setSelected(null); setMessages(null); setDraft(''); }} />
    </View>}
    {!selected && <View style={{ gap: 8 }}>{(['SERVICE', 'BILLING', 'ACCOUNT', 'OTHER'] as const).map((value) =>
      <Button key={value} title={`${category === value ? 'Selected: ' : ''}${value}`} variant="outline" disabled={disabled} onPress={() => setCategory(value)} />)}</View>}
    <Input label={selected ? 'Reply' : 'Support message'} accessibilityLabel={selected ? 'Reply' : 'Support message'}
      value={draft} onChangeText={setDraft} multiline maxLength={4000} editable={!disabled} />
    <Button title={selected ? 'Send reply' : 'Create support ticket'} disabled={disabled || !draft.trim() || selected?.status === 'RESOLVED'}
      onPress={() => {
        if (selected) command.submit('reply', { id: selected.id, message: draft }, ({ data }) => { setDraft(''); setSelected((current) => current && ({ ...current, version: data.version }));
          setMessages(null); }, selected.version);
        else command.submit('createTicket', { category, message: draft },
          ({ data }) => { setSelected(data); setMessages(null); setDraft(''); });
      }} />
    <Text accessibilityRole="header">Cash receipt and rating</Text>
    <Input label="Completed trip ID" accessibilityLabel="Completed trip ID" value={tripId} editable={!disabled}
      autoCapitalize="none" onChangeText={(value) => { setTripId(value); setReceipt(null); }} />
    <Button title="Load receipt" disabled={disabled || !tripId.trim()} onPress={() => { void read(async () => {
      const { data } = await runtime.api.receipt(tripId.trim());
      if (mounted.current) setReceipt(data);
    }); }} />
    {receipt && <View style={{ gap: 8 }}>
      <Text>{formatNprMinor(receipt.fare.amountMinor)} — cash {receipt.collectionStatus}</Text>
      <Text>{receipt.fareProvenance}. Completed: {receipt.completedAt}</Text>
      <Text>Choose a rating (one immutable rating per completed trip).</Text>
      {[1, 2, 3, 4, 5].map((score) => <Button key={score} title={`Rate ${score} of 5`} disabled={disabled} onPress={() => {
        command.submit('rateTrip', { id: receipt.tripId, score }, () => setReceipt(null), receipt.version);
      }} />)}
    </View>}
  </View>;
}
