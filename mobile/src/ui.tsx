// Shared UI primitives — every screen composes these so the app reads as one
// system. See DESIGN.md for the rules.
import React from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
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
import { RiskInput, tradeRisk } from './risk';
import { Icon, IconName } from './icons';
import { asofRel, asofTier } from './format';

// Compact risk pill for a trade card: coloured dot + level (+ optional score).
export function RiskBadge({ input, showScore = true, style }: { input: RiskInput; showScore?: boolean; style?: ViewStyle }) {
  const r = tradeRisk(input);
  return (
    <View style={[rs.badge, { borderColor: r.color }, style]}>
      <View style={[rs.dot, { backgroundColor: r.color }]} />
      <Text style={[rs.txt, { color: r.color }]}>
        {r.level} risk{showScore ? ` · ${r.score}` : ''}
      </Text>
    </View>
  );
}

const rs = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, alignSelf: 'flex-start' },
  dot: { width: 7, height: 7, borderRadius: 999 },
  txt: { fontSize: 11, fontWeight: '800', letterSpacing: 0.2 },
});

// Compact dropdown picker — a small pill that opens a centered menu sheet. Used
// to collapse chip rows (scan depth, sort, filters) into a single tap-target so
// the list gets the vertical space.
export function Dropdown<T extends string | number>({
  label,
  value,
  options,
  onChange,
  style,
}: {
  label?: string;
  value: T;
  options: { key: T; label: string }[];
  onChange: (k: T) => void;
  style?: ViewStyle;
}) {
  const [open, setOpen] = React.useState(false);
  const cur = options.find((o) => o.key === value);
  return (
    <>
      <TouchableOpacity style={[s.ddBtn, style]} onPress={() => setOpen(true)} activeOpacity={0.75}>
        {label ? <Text style={s.ddLbl}>{label}</Text> : null}
        <Text style={s.ddVal} numberOfLines={1}>{cur?.label ?? String(value)}</Text>
        <Icon name="chevronDown" size={12} color={theme.muted2} />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={s.ddBackdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setOpen(false)} />
          <View style={s.ddMenu}>
            {label ? <Text style={s.ddMenuTitle}>{label}</Text> : null}
            <ScrollView bounces={false} style={{ maxHeight: 320 }}>
              {options.map((o) => {
                const on = o.key === value;
                return (
                  <TouchableOpacity
                    key={String(o.key)}
                    style={[s.ddItem, on && s.ddItemOn]}
                    onPress={() => {
                      onChange(o.key);
                      setOpen(false);
                    }}
                    activeOpacity={0.75}
                  >
                    <Text style={[s.ddItemTxt, on && s.ddItemTxtOn]}>{o.label}</Text>
                    {on ? <Icon name="check" size={15} color={theme.brand} /> : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

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
  info,
  infoTitle,
}: {
  items: { key: T; label: string }[];
  value: T;
  onChange: (k: T) => void;
  style?: ViewStyle;
  // When given, an ⓘ button sits at the end of the row (pinned, doesn't scroll)
  // and opens the popup — so the screen can drop its title/subtitle block and
  // the "about this tab" detail lives right beside the tabs.
  info?: InfoContent;
  infoTitle?: string;
}) {
  return (
    <View style={[s.segWrap, style]}>
      <View style={s.segBar}>
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
        {info ? <InfoButton title={infoTitle || ''} content={info} style={s.segInfoBtn} /> : null}
      </View>
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

export function InfoButton({ title, content, style }: { title: string; content: InfoContent; style?: ViewStyle }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <TouchableOpacity
        style={[s.infoBtn, style]}
        onPress={() => setOpen(true)}
        activeOpacity={0.7}
        accessibilityLabel={'About ' + title}
      >
        <Icon name="info" size={15} color={theme.brand} />
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

// Springy press-scale for a crisp, tactile feel on primary actions.
export function usePressScale(pressed = 0.95) {
  const scale = React.useRef(new Animated.Value(1)).current;
  const to = (v: number) => Animated.spring(scale, { toValue: v, useNativeDriver: true, speed: 40, bounciness: 6 }).start();
  return { scale, onPressIn: () => to(pressed), onPressOut: () => to(1) };
}

// Mount entrance: fade + rise. Pass `index` on list items for a gentle stagger
// so a freshly-rendered list cascades in instead of popping. The delay is capped
// so long lists don't feel sluggish, and each item only animates once on mount.
export function FadeSlideIn({
  children,
  index = 0,
  distance = 12,
  duration = 300,
  stagger = 42,
  style,
}: {
  children: React.ReactNode;
  index?: number;
  distance?: number;
  duration?: number;
  stagger?: number;
  style?: ViewStyle;
}) {
  const a = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.timing(a, {
      toValue: 1,
      duration,
      delay: Math.min(index, 9) * stagger,
      useNativeDriver: true,
    }).start();
  }, [a, index, duration, stagger]);
  const translateY = a.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] });
  return <Animated.View style={[{ opacity: a, transform: [{ translateY }] }, style]}>{children}</Animated.View>;
}

// A tappable wrapper that gives a springy press-scale (nicer than the flat
// opacity dip of TouchableOpacity) — used for list rows / cards.
export function PressableScale({
  children,
  onPress,
  style,
  pressed = 0.97,
}: {
  children: React.ReactNode;
  onPress: () => void;
  style?: ViewStyle;
  pressed?: number;
}) {
  const p = usePressScale(pressed);
  return (
    <Animated.View style={{ transform: [{ scale: p.scale }] }}>
      <Pressable onPress={onPress} onPressIn={p.onPressIn} onPressOut={p.onPressOut} style={style}>
        {children}
      </Pressable>
    </Animated.View>
  );
}

// Animated bottom-sheet: the scrim fades in and the panel springs up from below.
// The detail popups (SMC / swing / institutional) render their scrolling content
// inside this so opening a card feels like a sheet rising, not a hard cut. Tap
// the scrim to dismiss. (Exit is an immediate unmount — entrance is the polish.)
export function Sheet({
  children,
  onClose,
  maxHeight = '94%',
  maxWidth = 620,
}: {
  children: React.ReactNode;
  onClose: () => void;
  maxHeight?: number | string;
  maxWidth?: number;
}) {
  const a = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.spring(a, { toValue: 1, useNativeDriver: true, speed: 16, bounciness: 5 }).start();
  }, [a]);
  const translateY = a.interpolate({ inputRange: [0, 1], outputRange: [48, 0] });
  return (
    <View style={sh.wrap}>
      <Animated.View style={[sh.scrim, { opacity: a }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <Animated.View style={[sh.panel, { maxHeight: maxHeight as number, maxWidth, opacity: a, transform: [{ translateY }] }]}>
        {children}
      </Animated.View>
    </View>
  );
}

const sh = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'flex-end' },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000a' },
  panel: {
    backgroundColor: theme.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderColor: theme.border2,
    borderWidth: 1,
    padding: theme.sp.lg,
    alignSelf: 'center',
    width: '100%',
  },
});

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
  const p = usePressScale();
  return (
    <Animated.View style={{ transform: [{ scale: p.scale }] }}>
      <Pressable
        style={[s.btn, kind === 'ghost' && s.btnGhost, kind === 'danger' && s.btnDanger, disabled && { opacity: 0.5 }, style]}
        onPress={onPress}
        onPressIn={p.onPressIn}
        onPressOut={p.onPressOut}
        disabled={disabled}
      >
        <Text style={[s.btnTxt, kind === 'ghost' && s.btnGhostTxt, kind === 'danger' && s.btnDangerTxt]}>{label}</Text>
      </Pressable>
    </Animated.View>
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

// ── Skeletons — shaped shimmer placeholders replacing text-only loaders ──────
// A loading screen should look like the screen it becomes. Variants mirror the
// app's three loading shapes: table rows, a stat-tile grid, and a card block.
function Shimmer({ style }: { style?: ViewStyle }) {
  const a = React.useRef(new Animated.Value(0.45)).current;
  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(a, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(a, { toValue: 0.45, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [a]);
  return <Animated.View style={[sk.bone, { opacity: a }, style]} />;
}

export function Skeleton({
  variant = 'rows',
  rows = 6,
  style,
}: {
  variant?: 'rows' | 'card' | 'tiles';
  rows?: number;
  style?: ViewStyle;
}) {
  if (variant === 'card') {
    return (
      <View style={[sk.wrap, style]}>
        <Shimmer style={{ width: '45%', height: 16 }} />
        <Shimmer style={{ width: '100%', height: 64, borderRadius: theme.radius.md }} />
        <Shimmer style={{ width: '80%', height: 12 }} />
        <Shimmer style={{ width: '60%', height: 12 }} />
      </View>
    );
  }
  if (variant === 'tiles') {
    return (
      <View style={[sk.tileRow, style]}>
        {Array.from({ length: 4 }).map((_, i) => (
          <Shimmer key={i} style={{ flexGrow: 1, minWidth: 120, height: 62, borderRadius: theme.radius.md }} />
        ))}
      </View>
    );
  }
  return (
    <View style={[sk.wrap, style]}>
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={sk.row}>
          <Shimmer style={{ width: 64, height: 12 }} />
          <Shimmer style={{ flex: 1, height: 12 }} />
          <Shimmer style={{ width: 48, height: 12 }} />
        </View>
      ))}
    </View>
  );
}

const sk = StyleSheet.create({
  wrap: { gap: theme.sp.md, paddingVertical: theme.sp.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.md },
  tileRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm },
  bone: { backgroundColor: theme.surface3, borderRadius: 4, height: 12 },
});

// ── Data-freshness chip — every price surface says when it's from ────────────
export function AsOfChip({ ts, source, style }: { ts?: number | null; source?: string; style?: ViewStyle }) {
  const tier = asofTier(ts ?? null);
  const color = tier === 'fresh' ? theme.muted : tier === 'stale' ? '#b7791f' : theme.red;
  return (
    <View style={[ac.chip, style]}>
      <Icon name="clock" size={11} color={color} />
      <Text style={[ac.txt, { color }]}>
        {asofRel(ts ?? null)}
        {source ? ` · ${source}` : ''}
      </Text>
    </View>
  );
}

const ac = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  txt: { fontFamily: theme.mono, fontSize: theme.fs.xs },
});

// ── Error state with agency: what failed, and a way forward ──────────────────
export function ErrorState({
  title,
  detail,
  onRetry,
}: {
  title: string;
  detail?: string;
  onRetry?: () => void;
}) {
  return (
    <View style={es.wrap}>
      <Icon name="warning" size={22} color={theme.red} />
      <Text style={es.title}>{title}</Text>
      {detail ? <Text style={es.detail}>{detail}</Text> : null}
      {onRetry ? (
        <TouchableOpacity style={es.retry} onPress={onRetry} activeOpacity={0.8}>
          <Icon name="refresh" size={14} color={theme.text} />
          <Text style={es.retryTxt}>Retry</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const es = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: 28, paddingHorizontal: 24, gap: 8 },
  title: { color: theme.text, fontSize: theme.fs.md, fontWeight: '700', textAlign: 'center' },
  detail: { color: theme.muted, fontSize: theme.fs.sm, textAlign: 'center', lineHeight: 18 },
  retry: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4,
    borderColor: theme.border2, borderWidth: 1, borderRadius: theme.radius.md,
    paddingHorizontal: theme.sp.lg, paddingVertical: theme.sp.sm,
  },
  retryTxt: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '700' },
});

// ── SlidingTabs — top-tab bar with an animated underline ─────────────────────
// The terminal-grade replacement for pill Segmented on primary sub-navigation:
// tabs sit on a hairline, the active indicator slides between them (base
// tempo), and content is expected to cross-fade behind it.
export function SlidingTabs<T extends string>({
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
  const [metrics, setMetrics] = React.useState<Record<string, { x: number; w: number }>>({});
  const x = React.useRef(new Animated.Value(0)).current;
  const w = React.useRef(new Animated.Value(0)).current;
  const m = metrics[value];
  React.useEffect(() => {
    if (!m) return;
    Animated.parallel([
      Animated.timing(x, { toValue: m.x, duration: theme.motion.base, useNativeDriver: false }),
      Animated.timing(w, { toValue: m.w, duration: theme.motion.base, useNativeDriver: false }),
    ]).start();
  }, [m, x, w]);
  return (
    <View style={[st.wrap, style]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.row}>
        {items.map((it) => {
          const on = it.key === value;
          return (
            <TouchableOpacity
              key={it.key}
              style={st.tab}
              onPress={() => onChange(it.key)}
              activeOpacity={0.75}
              onLayout={(e) => {
                const { x: lx, width } = e.nativeEvent.layout;
                setMetrics((p) => ({ ...p, [it.key]: { x: lx, w: width } }));
              }}
            >
              <Text style={[st.txt, on && st.txtOn]}>{it.label}</Text>
            </TouchableOpacity>
          );
        })}
        <Animated.View style={[st.indicator, { left: x, width: w }]} />
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { borderBottomColor: theme.border, borderBottomWidth: 1 },
  row: { flexDirection: 'row', paddingHorizontal: theme.sp.md, position: 'relative' },
  tab: { paddingHorizontal: theme.sp.md, paddingVertical: theme.sp.md - 2 },
  txt: { color: theme.muted, fontSize: theme.fs.sm + 1, fontWeight: '600', letterSpacing: 0.2 },
  txtOn: { color: theme.text, fontWeight: '800' },
  indicator: { position: 'absolute', bottom: 0, height: 2, borderRadius: 1, backgroundColor: theme.brand },
});

// ── IconChip — THE action-row unit (replaces per-screen emoji buttons) ───────
// Every card / popup action row composes these so watch/alert/chart/export look
// and behave identically everywhere.
export function IconChip({
  icon,
  label,
  onPress,
  color,
  on,
  disabled,
  style,
}: {
  icon: IconName;
  label?: string;
  onPress: () => void;
  color?: string;
  on?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const c = color || (on ? theme.brand : theme.muted2);
  return (
    <TouchableOpacity
      style={[ic.chip, on && ic.chipOn, disabled && { opacity: 0.5 }, style]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.75}
      accessibilityLabel={label || icon}
    >
      <Icon name={icon} size={14} color={c} />
      {label ? <Text style={[ic.txt, { color: c }]}>{label}</Text> : null}
    </TouchableOpacity>
  );
}

const ic = StyleSheet.create({
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderColor: theme.border2, borderWidth: 1, borderRadius: theme.radius.sm + 2,
    paddingHorizontal: theme.sp.md, paddingVertical: theme.sp.sm,
    backgroundColor: theme.surface2,
  },
  chipOn: { borderColor: theme.brand, backgroundColor: theme.brandSoft },
  txt: { fontSize: theme.fs.sm, fontWeight: '700' },
});

const s = StyleSheet.create({
  card: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    padding: theme.sp.lg,
  },
  // Dropdown picker
  ddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.sp.xs,
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.pill,
    paddingLeft: theme.sp.md,
    paddingRight: theme.sp.sm + 2,
    paddingVertical: 7,
  },
  ddLbl: { color: theme.muted, fontSize: theme.fs.xs + 1, fontWeight: '700', letterSpacing: 0.3 },
  ddVal: { color: theme.text, fontSize: theme.fs.sm + 1, fontWeight: '700' },
  ddCaret: { color: theme.muted2, fontSize: theme.fs.xs + 1 },
  ddBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: theme.sp.xl },
  ddMenu: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: theme.surface,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    padding: theme.sp.sm,
    ...theme.shadow.card,
  },
  ddMenuTitle: {
    color: theme.muted,
    fontSize: theme.fs.xs + 1,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    paddingHorizontal: theme.sp.md,
    paddingTop: theme.sp.sm,
    paddingBottom: theme.sp.xs,
  },
  ddItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.sp.md,
    paddingVertical: theme.sp.md,
    borderRadius: theme.radius.md,
  },
  ddItemOn: { backgroundColor: theme.brandSoft },
  ddItemTxt: { color: theme.muted2, fontSize: theme.fs.md, fontWeight: '600' },
  ddItemTxtOn: { color: theme.brand, fontWeight: '800' },
  ddCheck: { color: theme.brand, fontSize: theme.fs.md, fontWeight: '800' },
  segWrap: { paddingBottom: theme.sp.sm },
  segBar: { flexDirection: 'row', alignItems: 'center' },
  segScroll: { flexGrow: 0, flexShrink: 1 },
  segRow: { flexDirection: 'row', gap: theme.sp.sm, paddingHorizontal: theme.sp.lg, alignItems: 'center' },
  // ⓘ pinned at the row's right edge; small gap from the last pill.
  segInfoBtn: { marginRight: theme.sp.lg, marginLeft: theme.sp.xs },
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
