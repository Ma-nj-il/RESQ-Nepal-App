import React from 'react';
import { Text, TextProps, StyleSheet } from 'react-native';
import { fontFamily } from '../../constants/theme';

export const AppText: React.FC<TextProps> = ({ style, ...props }) => (
  <Text {...props} style={[styles.text, style]} />
);

const styles = StyleSheet.create({
  text: { fontFamily },
});
