import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { colors} from '../../constants/theme';

interface AvatarProps {
  name: string;
  uri?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export const Avatar: React.FC<AvatarProps> = ({ name, uri, size = 'md' }) => {
  const sizeMap = { sm: 32, md: 48, lg: 64, xl: 96 };
  const s = sizeMap[size];
  const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

  if (uri) {
    return <Image source={{ uri }} style={{ width: s, height: s, borderRadius: s / 2 }} />;
  }
  return (
    <View style={[styles.container, { width: s, height: s, borderRadius: s / 2 }]}>
      <Text style={[styles.text, { fontSize: s / 3 }]}>{initials}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  text: { color: colors.surface, fontWeight: '700' },
});
