import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme';

export default function Placeholder({
  title,
  note,
}: {
  title: string;
  note?: string;
}) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.note}>{note ?? 'Porting from the web app — coming soon.'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 8,
  },
  title: { color: theme.text, fontSize: 18, fontWeight: '700' },
  note: { color: theme.muted, fontFamily: theme.mono, fontSize: 12, textAlign: 'center' },
});
