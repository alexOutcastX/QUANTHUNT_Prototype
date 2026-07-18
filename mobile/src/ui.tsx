// Shared UI primitives — every screen composes these so the app reads as one
// system. See DESIGN.md for the rules.
import React from 'react';
import {
  ActivityIndicator,
  Modal,
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

// Structured "about this tab" content shown in the info popup. Keeps the long
// explanatory copy out of the screen header (just an ⓘ button) and gives every
// tab the same layout: overview → labelled sections (strategies, how to trade
// safely, …) → a red disclaimer box at the very end.
export type InfoSection = { heading: string; text?: string; bullets?: string[] };
export type InfoContent = {
  about?: string;
  sections?: InfoSection[];
  disclaimer?: string;
};

// The popup itself. The header (title + close button) lives OUTSIDE the
// ScrollView so the ✕ stays pinned while the body scrolls — you can read all
// the content and still dismiss without scrolling back to the top.
function InfoModal({
  open,
  onClose,
  title,
  content,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  content: InfoContent;
}) {
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.modalBackdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <View style={s.modalCard}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle} numberOfLines={1}>{title}</Text>
            <TouchableOpacity
              style={s.modalClose}
              onPress={onClose}
              activeOpacity={0.7}
              accessibilityLabel="Close"
            >
              <Text style={s.modalCloseGlyph}>×</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={s.modalBody} contentContainerStyle={s.modalBodyInner}>
            {content.about ? <Text style={s.modalPara}>{content.about}</Text> : null}
            {(content.sections || []).map((sec, i) => (
              <View key={i} style={s.modalSection}>
                <Text style={s.modalHeading}>{sec.heading}</Text>
                {sec.text ? <Text style={s.modalPara}>{sec.text}</Text> : null}
                {(sec.bullets || []).map((b, j) => (
                  <View key={j} style={s.modalBulletRow}>
                    <Text style={s.modalBulletDot}>•</Text>
                    <Text style={s.modalBulletTxt}>{b}</Text>
                  </View>
                ))}
              </View>
            ))}
            {content.disclaimer ? (
              <View style={s.modalDisclaimer}>
                <Text style={s.modalDisclaimerLabel}>DISCLAIMER</Text>
                <Text style={s.modalDisclaimerTxt}>{content.disclaimer}</Text>
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function InfoButton({ title, content }: { title: string; content: InfoContent }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <TouchableOpacity
        style={s.infoBtn}
        onPress={() => setOpen(true)}
        activeOpacity={0.7}
        accessibilityLabel={'About ' + title}
      >
        <Text style={s.infoGlyph}>ⓘ</Text>
      </TouchableOpacity>
      <InfoModal open={open} onClose={() => setOpen(false)} title={title} content={content} />
    </>
  );
}

// On desktop the action row sits inline beside the title; on a phone the title
// (and its sub-line) would get squeezed and wrap, so the actions drop below it.
// `info`, when given, renders an ⓘ button next to the title that opens a popup
// with the tab's full details (so the header can stay a one-liner).
export function ScreenTitle({
  title,
  sub,
  right,
  info,
}: {
  title: string;
  sub?: string;
  right?: React.ReactNode;
  info?: InfoContent;
}) {
  const { isDesktop } = useResponsive();
  const heading = (
    <View style={s.titleLine}>
      <Text style={s.title}>{title}</Text>
      {info ? <InfoButton title={title} content={info} /> : null}
    </View>
  );
  if (!isDesktop && right) {
    return (
      <View style={s.titleCol}>
        {heading}
        {sub ? <Text style={s.sub}>{sub}</Text> : null}
        <View style={s.titleActions}>{right}</View>
      </View>
    );
  }
  return (
    <View style={s.titleRow}>
      <View style={{ flex: 1 }}>
        {heading}
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
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm },
  title: { color: theme.text, fontSize: theme.fs.xxl, fontWeight: '800', letterSpacing: -0.4 },
  sub: { color: theme.muted, fontSize: theme.fs.sm + 1, marginTop: 4, lineHeight: 18 },

  // ⓘ button beside a screen title — subtle, brand-tinted, taps open the popup.
  infoBtn: {
    width: 26,
    height: 26,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.brandSoft,
    borderColor: theme.brand,
    borderWidth: 1,
  },
  infoGlyph: { color: theme.brand, fontSize: 15, fontWeight: '700', lineHeight: 18 },

  // Info popup. Backdrop dims the app; card is height-capped so the body scrolls
  // under a pinned header.
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.sp.lg,
  },
  modalCard: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '86%',
    backgroundColor: theme.surface,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    overflow: 'hidden',
    ...theme.shadow.card,
  },
  // Pinned header — sits above the ScrollView so ✕ never scrolls away.
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.sp.md,
    paddingLeft: theme.sp.lg,
    paddingRight: theme.sp.sm,
    paddingVertical: theme.sp.md,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
    backgroundColor: theme.surface,
  },
  modalTitle: { flex: 1, color: theme.text, fontSize: theme.fs.lg + 1, fontWeight: '800', letterSpacing: -0.3 },
  modalClose: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
  },
  modalCloseGlyph: { color: theme.muted2, fontSize: 22, lineHeight: 24, fontWeight: '600' },
  modalBody: { flexGrow: 0 },
  modalBodyInner: { padding: theme.sp.lg, gap: theme.sp.md },
  modalPara: { color: theme.muted2, fontSize: theme.fs.md, lineHeight: 21 },
  modalSection: { gap: theme.sp.xs },
  modalHeading: {
    color: theme.muted,
    fontSize: theme.fs.xs + 1,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  modalBulletRow: { flexDirection: 'row', gap: theme.sp.sm, alignItems: 'flex-start' },
  modalBulletDot: { color: theme.brand, fontSize: theme.fs.md, lineHeight: 21 },
  modalBulletTxt: { flex: 1, color: theme.muted2, fontSize: theme.fs.md, lineHeight: 21 },
  // Red disclaimer box, always last.
  modalDisclaimer: {
    marginTop: theme.sp.sm,
    borderColor: theme.red,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: theme.sp.md,
    backgroundColor: 'rgba(221,44,88,0.08)',
  },
  modalDisclaimerLabel: { color: theme.red, fontSize: theme.fs.xs + 1, fontWeight: '800', letterSpacing: 1.2, marginBottom: 4 },
  modalDisclaimerTxt: { color: theme.red, fontSize: theme.fs.sm + 1, lineHeight: 19 },
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
