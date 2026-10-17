import React, {  useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, TextInput, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, spacing, typography, radii} from '../../constants/theme';
import {} from '../../store/bookingStore';
import {} from '../../services/database/bookings';
import {} from '../../types';

type RouteParams = {
  Chat: { bookingId: string };
};

interface ChatMessage {
  id: string;
  text: string;
  sender: 'driver' | 'user' | 'system';
  timestamp: string;
}

const QUICK_REPLIES = [
  "I'm outside",
  'Please hurry up',
  'Thank you!',
  'Where are you?',
];

const DEMO_NOTICE: ChatMessage = {
  id: 'demo-notice',
  text: '⚠️ Demo conversation — messages are not delivered. Live chat needs a realtime messaging provider, which is not part of this build.',
  sender: 'system',
  timestamp: '',
};

const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: '1',
    text: 'Hello! I am on my way to pick you up.',
    sender: 'driver',
    timestamp: '10:30 AM',
  },
  {
    id: '2',
    text: 'Great! I am waiting at the main gate.',
    sender: 'user',
    timestamp: '10:31 AM',
  },
  {
    id: '3',
    text: 'Okay, I will be there in 5 minutes.',
    sender: 'driver',
    timestamp: '10:31 AM',
  },
];

let messageCounter = 0;
const nextMessageId = () => {
  messageCounter += 1;
  return `msg-${messageCounter}-${Date.now()}`;
};

const ChatScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const route = useRoute<RouteProp<RouteParams, 'Chat'>>();
  const { bookingId } = route.params;

  const [messages, setMessages] = useState<ChatMessage[]>([DEMO_NOTICE, ...INITIAL_MESSAGES]);
  const [inputText, setInputText] = useState('');


  const flatListRef = useRef<FlatList>(null);

  const sendMessage = (text: string) => {
    if (!text.trim()) return;
    const newMessage: ChatMessage = {
      id: nextMessageId(),
      text: text.trim(),
      sender: 'user',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setMessages((prev) => [...prev, newMessage]);
    setInputText('');

    // The message is only shown locally — there is no realtime channel to
    // deliver it, so no synthetic driver reply is fabricated.
  };

  const handleCall = () => {
    navigation.navigate('Call', { bookingId, type: 'voice' });
  };

  const handleVideoCall = () => {
    navigation.navigate('Call', { bookingId, type: 'video' });
  };

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    if (item.sender === 'system') {
      return (
        <View style={styles.systemRow}>
          <Text style={styles.systemText}>{item.text}</Text>
        </View>
      );
    }

    const isDriver = item.sender === 'driver';
    return (
      <View
        style={[
          styles.messageRow,
          isDriver ? styles.messageRowLeft : styles.messageRowRight,
        ]}
      >
        <View
          style={[
            styles.messageBubble,
            isDriver ? styles.driverBubble : styles.userBubble,
          ]}
        >
          <Text
            style={[
              styles.messageText,
              isDriver ? styles.driverText : styles.userText,
            ]}
          >
            {item.text}
          </Text>
          <Text
            style={[
              styles.timestamp,
              isDriver ? styles.driverTimestamp : styles.userTimestamp,
            ]}
          >
            {item.timestamp}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Driver</Text>
          <View style={styles.onlineRow}>
            <Text style={styles.onlineText}>Demo conversation</Text>
          </View>
        </View>
        <TouchableOpacity onPress={handleCall} style={styles.headerIcon}>
          <Text style={styles.headerIconText}>📞</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleVideoCall} style={styles.headerIcon}>
          <Text style={styles.headerIconText}>📹</Text>
        </TouchableOpacity>
      </View>

      {/* Messages List */}
      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderMessage}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.messagesList}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        showsVerticalScrollIndicator={false}
      />

      {/* Quick Replies */}
      <View style={styles.quickRepliesContainer}>
        <FlatList
          horizontal
          data={QUICK_REPLIES}
          keyExtractor={(item) => item}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.quickReplies}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.quickReplyButton}
              onPress={() => sendMessage(item)}
              activeOpacity={0.7}
            >
              <Text style={styles.quickReplyText}>{item}</Text>
            </TouchableOpacity>
          )}
        />
      </View>

      {/* Input Bar */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <View style={styles.inputBar}>
          <TouchableOpacity
            style={styles.attachButton}
            onPress={() =>
              Alert.alert(
                'Attachments',
                'Sending photos or documents is not available in this build.',
              )
            }
          >
            <Text style={styles.attachIcon}>📎</Text>
          </TouchableOpacity>
          <TextInput
            style={styles.textInput}
            placeholder="Type a message..."
            placeholderTextColor={colors.textTertiary}
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={500}
          />
          <TouchableOpacity
            style={[
              styles.sendButton,
              !inputText.trim() && styles.sendButtonDisabled,
            ]}
            onPress={() => sendMessage(inputText)}
            disabled={!inputText.trim()}
            activeOpacity={0.7}
          >
            <Text style={styles.sendIcon}>➤</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: { fontSize: 24, color: colors.text },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { ...typography.h4 },
  onlineRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  onlineText: { ...typography.caption, color: colors.success },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: radii.full,
    backgroundColor: colors.input,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIconText: { fontSize: 18 },

  messagesList: { padding: spacing.md, flexGrow: 1 },
  messageRow: { marginBottom: spacing.md },
  messageRowLeft: { alignItems: 'flex-start' },
  messageRowRight: { alignItems: 'flex-end' },
  systemRow: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  systemText: {
    ...typography.caption,
    color: colors.warning,
    backgroundColor: colors.amberLight,
    borderRadius: radii.md,
    padding: spacing.md,
    textAlign: 'center',
  },
  messageBubble: {
    maxWidth: '75%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.lg,
  },
  driverBubble: {
    backgroundColor: colors.input,
    borderBottomLeftRadius: radii.xs,
  },
  userBubble: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: radii.xs,
  },
  messageText: { ...typography.bodySmall },
  driverText: { color: colors.text },
  userText: { color: colors.surface },
  timestamp: { ...typography.caption, fontSize: 10, marginTop: 4 },
  driverTimestamp: { color: colors.textTertiary },
  userTimestamp: { color: 'rgba(255,255,255,0.7)' },

  quickRepliesContainer: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: spacing.sm,
  },
  quickReplies: { paddingHorizontal: spacing.md, gap: spacing.sm },
  quickReplyButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.full,
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.border,
  },
  quickReplyText: { ...typography.caption, color: colors.text },

  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  attachButton: {
    width: 40,
    height: 40,
    borderRadius: radii.full,
    backgroundColor: colors.input,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachIcon: { fontSize: 18 },
  textInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    backgroundColor: colors.input,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 16,
    color: colors.text,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: radii.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: { backgroundColor: colors.disabled },
  sendIcon: { fontSize: 18, color: colors.surface },
});

export default ChatScreen;
