// Shared UI primitives — every screen composes these so the app reads as one
// system. See DESIGN.md for the rules.
import React from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextStyle,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { theme } from './theme';
import { useResponsive } from './responsive';

export function Card({ children, style, flat }: { children: React.ReactNode; style?: ViewStyle; flat?: boolean }) {
  return <View style={[s.card, !flat && theme.shadow.soft, style]}>{children}</View>;
}

// Horizontally-scrollable segmented control — one clean row of pills, the active
// one carries the brand tint. Replaces the old hamburger dropdown / wrapping
// toggle so every sub-navigation reads the same and never wraps.
export function Segmented<T extends string>({
  items,
  value,
  onChange,
  style,
}: {
  items: { key: T; label: string }[];
  value: T;
  onChange: (k: T) => void;
  style?: ViewStyle;
}) {
  return (
    <View style={[s.segWrap, style]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.segScroll}
        contentContainerStyle={s.segRow}
      >
        {items.map((it) => {
          const on = it.key === value;
          return (
            <TouchableOpacity
              key={it.key}
              style={[s.seg, on && s.segOn]}
              onPress={() => onChange(it.key)}
              activeOpacity={0.8}
            >
              <Text style={[s.segTxt, on && s.segTxtOn]}>{it.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

// On desktop the action row sits inline beside the title; on a phone the title
// (and its sub-line) would get squeezed and wrap, so the actions drop below it.
export function ScreenTitle({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  const { isDesktop } = useResponsive();
  if (!isDesktop && right) {
    return (
      <View style={s.titleCol}>
        <Text style={s.title}>{title}</Text>
        {sub ? <Text style={s.sub}>{sub}</Text> : null}
        <View style={s.titleActions}>{right}</View>
      </View>
    );
  }
  return (
    <View style={s.titleRow}>
      <View style={{ flex: 1 }}>
        <Text style={s.title}>{title}</Text>
        {sub ? <Text style={s.sub}>{sub}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={s.section}>{children}</Text>;
}

export function Btn({
  label,
  onPress,
  kind = 'primary',
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  style?: ViewStyle;
}) {
  return (
    <TouchableOpacity
      style={[s.btn, kind === 'ghost' && s.btnGhost, kind === 'danger' && s.btnDanger, disabled && { opacity: 0.5 }, style]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.75}
    >
      <Text style={[s.btnTxt, kind === 'ghost' && s.btnGhostTxt, kind === 'danger' && s.btnDangerTxt]}>{label}</Text>
    </TouchableOpacity>
  );
}

export function ChipBtn({
  label,
  on,
  onPress,
  style,
}: {
  label: string;
  on?: boolean;
  onPress: () => void;
  style?: ViewStyle;
}) {
  return (
    <TouchableOpacity style={[s.chip, on && s.chipOn, style]} onPress={onPress} activeOpacity={0.75}>
      <Text style={[s.chipTxt, on && s.chipTxtOn]}>{label}</Text>
    </TouchableOpacity>
  );
}

export function StatTile({
  label,
  value,
  sub,
  color,
  mono = true,
  style,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  mono?: boolean;
  style?: ViewStyle;
}) {
  return (
    <View style={[s.tile, style]}>
      <Text style={s.tileLabel}>{label}</Text>
      <Text style={[s.tileValue, mono && { fontFamily: theme.mono }, color ? { color } : null]} numberOfLines={1}>
        {value}
      </Text>
      {sub ? <Text style={[s.tileSub, color ? { color } : null]}>{sub}</Text> : null}
    </View>
  );
}

export function EmptyState({ icon = '◇', title, hint }: { icon?: string; title: string; hint?: string }) {
  return (
    <View style={s.empty}>
      <Text style={s.emptyIcon}>{icon}</Text>
      <Text style={s.emptyTitle}>{title}</Text>
      {hint ? <Text style={s.emptyHint}>{hint}</Text> : null}
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={s.loading}>
      <ActivityIndicator color={theme.muted2} />
      {label ? <Text style={s.loadingTxt}>{label}</Text> : null}
    </View>
  );
}

export const dataText: TextStyle = { fontFamily: theme.mono, color: theme.text, fontSize: theme.fs.sm };

const s = StyleSheet.create({
  card: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    padding: theme.sp.lg,
  },
  segWrap: { paddingBottom: theme.sp.sm },
  segScroll: { flexGrow: 0 },
  segRow: { flexDirection: 'row', gap: theme.sp.sm, paddingHorizontal: theme.sp.lg, alignItems: 'center' },
  seg: {
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.surface2,
    borderColor: theme.border,
    borderWidth: 1,
  },
  segOn: { backgroundColor: theme.brandSoft, borderColor: theme.brand },
  segTxt: { color: theme.muted2, fontSize: theme.fs.sm + 1, fontWeight: '600', letterSpacing: 0.2 },
  segTxtOn: { color: theme.brand, fontWeight: '800' },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: theme.sp.lg,
    paddingTop: theme.sp.lg,
    paddingBottom: theme.sp.md,
    gap: theme.sp.md,
  },
  titleCol: {
    paddingHorizontal: theme.sp.lg,
    paddingTop: theme.sp.lg,
    paddingBottom: theme.sp.md,
    gap: theme.sp.sm,
  },
  titleActions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm, marginTop: 2 },
  title: { color: theme.text, fontSize: theme.fs.xxl, fontWeight: '800', letterSpacing: -0.4 },
  sub: { color: theme.muted, fontSize: theme.fs.sm + 1, marginTop: 4, lineHeight: 18 },
  section: {
    color: theme.muted,
    fontSize: theme.fs.xs + 1,
    fontWeight: '800',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: theme.sp.sm,
    marginTop: theme.sp.lg,
  },
  btn: {
    backgroundColor: theme.accent,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.sp.lg,
    paddingVertical: 11,
    alignItems: 'center',
  },
  btnTxt: { color: theme.onAccent, fontSize: theme.fs.sm + 1, fontWeight: '700', letterSpacing: 0.3 },
  btnGhost: { backgroundColor: 'transparent', borderColor: theme.border2, borderWidth: 1 },
  btnGhostTxt: { color: theme.muted2 },
  btnDanger: { backgroundColor: 'transparent', borderColor: theme.red, borderWidth: 1 },
  btnDangerTxt: { color: theme.red },
  chip: {
    backgroundColor: theme.surface2,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  chipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipTxt: { color: theme.muted2, fontSize: theme.fs.sm },
  chipTxtOn: { color: theme.onAccent, fontWeight: '700' },
  tile: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.sp.lg,
    paddingVertical: theme.sp.md,
    minWidth: 128,
    flexGrow: 1,
  },
  tileLabel: { color: theme.muted, fontSize: theme.fs.xs + 1, letterSpacing: 0.6, textTransform: 'uppercase' },
  tileValue: { color: theme.text, fontSize: theme.fs.lg + 1, fontWeight: '700', marginTop: 5 },
  tileSub: { color: theme.muted2, fontSize: theme.fs.sm, marginTop: 2, fontFamily: theme.mono },
  empty: { alignItems: 'center', paddingVertical: 44, paddingHorizontal: 30, gap: 6 },
  emptyIcon: { color: theme.muted, fontSize: 30 },
  emptyTitle: { color: theme.muted2, fontSize: theme.fs.md, fontWeight: '600' },
  emptyHint: { color: theme.muted, fontSize: theme.fs.sm, textAlign: 'center', lineHeight: 18 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingTxt: { color: theme.muted, fontSize: theme.fs.sm },
});
