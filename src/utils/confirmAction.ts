import { Alert, Platform } from 'react-native';

interface ConfirmActionOptions {
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export const confirmAction = (
  title: string,
  message: string,
  onConfirm: () => void | Promise<void>,
  options: ConfirmActionOptions = {},
): void => {
  if (Platform.OS === 'web') {
    const confirm = (globalThis as typeof globalThis & { confirm?: (text: string) => boolean }).confirm;
    if (confirm?.(`${title}\n\n${message}`)) {
      void Promise.resolve(onConfirm()).catch(() => undefined);
    }
    return;
  }

  Alert.alert(title, message, [
    { text: options.cancelLabel || 'Cancel', style: 'cancel' },
    {
      text: options.confirmLabel || 'Confirm',
      style: options.destructive ? 'destructive' : 'default',
      onPress: () => void Promise.resolve(onConfirm()).catch(() => undefined),
    },
  ]);
};
