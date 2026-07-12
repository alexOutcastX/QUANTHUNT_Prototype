import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { UniverseSymbol, api } from '../api';
import { theme } from '../theme';

// Module-level cache — the universe list is fetched at most once per app
// session and shared by every SymbolInput. Loaded lazily on first focus; on
// failure the promise is cleared (so a later focus can retry) and the input
// behaves as a plain TextInput with autocomplete silently off.
let universePromise: Promise<UniverseSymbol[]> | null = null;
function loadUniverse(): Promise<UniverseSymbol[]> {
  if (!universePromise) {
    universePromise = api
      .universe()
      .then((r) => (Array.isArray(r.symbols) ? r.symbols : []))
      .catch(() => {
        universePromise = null;
        return [] as UniverseSymbol[];
      });
  }
  return universePromise;
}

const MAX_SUGGESTIONS = 8;

type Props = {
  value: string;
  onChangeText: (t: string) => void;
  onSelect?: (symbol: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  inputStyle?: any;
  containerStyle?: any;
};

// Symbol input with a terminal-style autocomplete dropdown fed by /universe.
export default function SymbolInput({
  value,
  onChangeText,
  onSelect,
  onSubmit,
  placeholder,
  inputStyle,
  containerStyle,
}: Props) {
  const [symbols, setSymbols] = useState<UniverseSymbol[] | null>(null);
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (blurTimer.current) clearTimeout(blurTimer.current);
    };
  }, []);

  const handleFocus = () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    setOpen(true);
    if (!symbols) {
      loadUniverse().then((list) => {
        if (mounted.current) setSymbols(list);
      });
    }
  };

  // Delay closing on blur so a press on a suggestion row lands first.
  const handleBlur = () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    blurTimer.current = setTimeout(() => {
      if (mounted.current) setOpen(false);
    }, 150);
  };

  const handleChange = (t: string) => {
    setOpen(true);
    onChangeText(t);
  };

  const pick = (symbol: string) => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    onChangeText(symbol);
    onSelect?.(symbol);
    setOpen(false);
    Keyboard.dismiss();
  };

  const suggestions = useMemo(() => {
    if (!open || !symbols || !symbols.length) return [];
    // Ignore an exchange prefix ("NSE:RELI") so matching still works.
    const q = value.trim().toUpperCase().replace(/^[A-Z]+:/, '');
    if (q.length < 1) return [];
    const prefix: UniverseSymbol[] = [];
    const substr: UniverseSymbol[] = [];
    const byName: UniverseSymbol[] = [];
    for (const s of symbols) {
      const sym = (s.symbol || '').toUpperCase();
      if (!sym || sym === q) continue; // exclude exact current value
      if (sym.startsWith(q)) {
        prefix.push(s);
        if (prefix.length >= MAX_SUGGESTIONS) break;
      } else if (substr.length + byName.length < MAX_SUGGESTIONS) {
        if (sym.includes(q)) substr.push(s);
        else if ((s.name || '').toUpperCase().includes(q)) byName.push(s);
      }
    }
    return [...prefix, ...substr, ...byName].slice(0, MAX_SUGGESTIONS);
  }, [open, symbols, value]);

  return (
    <View style={[styles.container, containerStyle]}>
      <TextInput
        style={inputStyle}
        value={value}
        onChangeText={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onSubmitEditing={onSubmit}
        placeholder={placeholder}
        placeholderTextColor={theme.muted}
        autoCapitalize="characters"
        autoCorrect={false}
        returnKeyType="go"
      />
      {suggestions.length > 0 ? (
        <View style={styles.dropdown}>
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll}>
            {suggestions.map((s, i) => (
              <TouchableOpacity
                key={`${s.symbol}-${s.exchange}-${i}`}
                style={styles.row}
                onPress={() => pick(s.symbol)}
              >
                <Text style={styles.rowSym}>{s.symbol}</Text>
                <Text style={styles.rowName} numberOfLines={1}>
                  {s.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'relative', zIndex: 50 },
  dropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    zIndex: 50,
    elevation: 8,
    backgroundColor: theme.surface,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: 6,
    maxHeight: 260,
    overflow: 'hidden',
  },
  scroll: { maxHeight: 258 },
  row: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
  },
  rowSym: { color: theme.text, fontFamily: theme.mono, fontWeight: '700', fontSize: 12 },
  rowName: { color: theme.muted, fontSize: 10, marginTop: 2 },
});
