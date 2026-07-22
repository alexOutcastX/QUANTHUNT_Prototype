// Ticker settings — choose the instruments the strip shows (Indian indices,
// global indices, currencies, commodities, individual stocks), and whether it
// scrolls or sits static. Static mode is a fixed-width row, so it hard-caps
// the instrument count; the counter and disabled chips make the limit obvious.
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Icon } from '../icons';
import { Segmented, Sheet } from '../ui';
import SymbolInput from './SymbolInput';
import {
  CATALOGUE,
  DEFAULT_TICKER,
  TickerConfig,
  TickerItem,
  TickerMode,
  loadTickerConfig,
  maxItems,
  saveTickerConfig,
} from '../tickerPrefs';
import { theme } from '../theme';

export default function TickerSettings({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg] = useState<TickerConfig | null>(null);
  const [sym, setSym] = useState('');

  useEffect(() => {
    loadTickerConfig().then(setCfg);
  }, []);

  if (!cfg) return null;
  const cap = maxItems(cfg.mode);
  const full = cfg.items.length >= cap;
  const has = (kind: string, key: string) => cfg.items.some((i) => i.kind === kind && i.key === key);

  const apply = (next: TickerConfig) => {
    setCfg(next);
    saveTickerConfig(next);
  };
  const setMode = (mode: TickerMode) =>
    apply({ mode, items: cfg.items.slice(0, maxItems(mode)) });
  const remove = (it: TickerItem) =>
    apply({ ...cfg, items: cfg.items.filter((i) => !(i.kind === it.kind && i.key === it.key)) });
  const add = (it: TickerItem) => {
    if (full || has(it.kind, it.key)) return;
    apply({ ...cfg, items: [...cfg.items, it] });
  };
  const addStock = (raw: string) => {
    const s = raw.trim().toUpperCase().replace(/^[A-Z]+:/, '');
    if (!s) return;
    add({ kind: 'stock', key: s, label: s });
    setSym('');
  };

  return (
    <Sheet onClose={onClose} maxHeight="88%">
      <ScrollView bounces={false} keyboardShouldPersistTaps="handled">
        <Text style={s.title}>Ticker settings</Text>

        <Text style={s.label}>MODE</Text>
        <Segmented
          items={[
            { key: 'scroll', label: 'Scrolling' },
            { key: 'static', label: 'Static' },
          ]}
          value={cfg.mode}
          onChange={(k) => setMode(k as TickerMode)}
        />
        <Text style={s.hint}>
          {cfg.mode === 'static'
            ? `Static shows a fixed, non-moving row — up to ${cap} instruments so everything fits.`
            : `Scrolling loops continuously — up to ${cap} instruments.`}
        </Text>

        <View style={s.rowBetween}>
          <Text style={s.label}>IN THE TICKER</Text>
          <Text style={[s.count, full && { color: theme.red }]}>{cfg.items.length}/{cap}</Text>
        </View>
        <View style={s.chipWrap}>
          {cfg.items.map((it) => (
            <TouchableOpacity key={it.kind + it.key} style={s.chipOn} onPress={() => remove(it)} activeOpacity={0.75}>
              <Text style={s.chipOnTxt}>{it.label}</Text>
              <Icon name="close" size={11} color={theme.brand} />
            </TouchableOpacity>
          ))}
          {!cfg.items.length ? <Text style={s.hint}>Nothing selected — the strip is hidden.</Text> : null}
        </View>

        {CATALOGUE.map((group) => (
          <View key={group.kind}>
            <Text style={s.label}>{group.title.toUpperCase()}</Text>
            <View style={s.chipWrap}>
              {group.options.map((o) => {
                const on = has(group.kind, o.key);
                const disabled = !on && full;
                return (
                  <TouchableOpacity
                    key={o.key}
                    style={[s.chip, on && s.chipPicked, disabled && { opacity: 0.35 }]}
                    onPress={() => (on ? remove({ kind: group.kind, key: o.key, label: o.label }) : add({ kind: group.kind, key: o.key, label: o.label }))}
                    disabled={disabled}
                    activeOpacity={0.75}
                  >
                    <Text style={[s.chipTxt, on && s.chipPickedTxt]}>{o.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ))}

        <Text style={s.label}>ADD A STOCK</Text>
        <SymbolInput
          value={sym}
          onChangeText={setSym}
          onSelect={addStock}
          onSubmit={() => addStock(sym)}
          placeholder={full ? `Ticker is full (${cap}) — remove something first` : 'Search any NSE / BSE symbol…'}
          inputStyle={s.input}
        />

        <TouchableOpacity style={s.reset} onPress={() => apply(DEFAULT_TICKER)} activeOpacity={0.75}>
          <Text style={s.resetTxt}>Reset to default indices</Text>
        </TouchableOpacity>
        <Text style={s.hint}>Changes apply immediately and sync to your account when signed in.</Text>
      </ScrollView>
    </Sheet>
  );
}

const s = StyleSheet.create({
  title: { color: theme.text, fontSize: theme.fs.xl, fontWeight: '800', marginBottom: theme.sp.sm },
  label: { color: theme.muted, fontSize: theme.fs.xs, fontWeight: '800', letterSpacing: 1, marginTop: theme.sp.lg, marginBottom: theme.sp.sm },
  hint: { color: theme.muted, fontSize: theme.fs.sm, marginTop: theme.sp.sm, lineHeight: 18 },
  rowBetween: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  count: { color: theme.muted2, fontFamily: theme.mono, fontSize: theme.fs.sm },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm },
  chip: {
    borderColor: theme.border2, borderWidth: 1, borderRadius: theme.radius.pill,
    paddingHorizontal: 12, paddingVertical: 6, backgroundColor: theme.surface2,
  },
  chipTxt: { color: theme.muted2, fontSize: theme.fs.sm },
  chipPicked: { borderColor: theme.brand, backgroundColor: theme.brandSoft },
  chipPickedTxt: { color: theme.brand, fontWeight: '700' },
  chipOn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderColor: theme.brand, borderWidth: 1, borderRadius: theme.radius.pill,
    paddingHorizontal: 12, paddingVertical: 6, backgroundColor: theme.brandSoft,
  },
  chipOnTxt: { color: theme.brand, fontSize: theme.fs.sm, fontWeight: '700' },
  input: {
    backgroundColor: theme.surface2, borderColor: theme.border2, borderWidth: 1,
    borderRadius: theme.radius.md, color: theme.text,
    paddingHorizontal: theme.sp.md, paddingVertical: 10,
    fontFamily: theme.mono, fontSize: theme.fs.md,
  },
  reset: { marginTop: theme.sp.lg, alignSelf: 'flex-start' },
  resetTxt: { color: theme.muted2, fontSize: theme.fs.sm, textDecorationLine: 'underline' },
});
