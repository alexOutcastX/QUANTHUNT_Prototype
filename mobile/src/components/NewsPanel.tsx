// The news box, rebuilt as a rail.
//
// It used to be a wide card at the top of the page, which is a lot of the most
// valuable space on the screen for a list you skim. Narrow and beside the
// market data, it is readable at a glance and stops pushing everything else
// below the fold.
//
// Three tabs, because a feed alone answers only "what is happening":
//   Latest  — the live poll, as before.
//   Archive — a month of recorded headlines, searchable. RSS is a window, so
//             the server writes down what it sees; see news_history.py.
//   Saved   — headlines you kept, synced like the watchlist.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Card, EmptyState, Loading, SectionTitle } from '../ui';
import { Icon } from '../icons';
import { theme } from '../theme';
import { REFRESH, REFRESHING } from '../copy';
import { api, NewsItem } from '../api';
import {
  SavedNews,
  loadNewsmarks,
  newsId,
  newsmarksNow,
  subscribeNewsmarks,
  toggleNewsmark,
} from '../newsmarks';

type Tab = 'latest' | 'archive' | 'saved';

const TABS: { k: Tab; label: string }[] = [
  { k: 'latest', label: 'Latest' },
  { k: 'archive', label: 'Archive' },
  { k: 'saved', label: 'Saved' },
];

function when(ts?: number | null): string {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const age = Date.now() / 1000 - ts;
  // Inside a day the time is what matters; past that, the date is.
  return age < 86400
    ? d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function Row({
  item,
  saved,
  onOpen,
  onSave,
}: {
  item: NewsItem;
  saved: boolean;
  onOpen: () => void;
  onSave: () => void;
}) {
  return (
    <View style={s.row}>
      <TouchableOpacity
        style={s.rowMain}
        onPress={onOpen}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel={`Open headline: ${item.title}`}
      >
        <Text style={s.title} numberOfLines={3}>{item.title}</Text>
        <Text style={s.meta} numberOfLines={1}>
          {item.source}
          {item.ts ? ' · ' + when(item.ts) : ''}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onSave}
        activeOpacity={0.7}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityState={{ selected: saved }}
        accessibilityLabel={saved ? `Remove ${item.title} from saved` : `Save ${item.title} for later`}
      >
        <Icon
          name={saved ? 'watchFilled' : 'watch'}
          size={15}
          color={saved ? theme.brand : theme.muted}
        />
      </TouchableOpacity>
    </View>
  );
}

export default function NewsPanel({
  items,
  busy,
  onRefresh,
  onOpen,
}: {
  items: NewsItem[] | null;
  busy: boolean;
  onRefresh: () => void;
  onOpen: (n: NewsItem) => void;
}) {
  const [tab, setTab] = useState<Tab>('latest');
  const [, force] = useState(0);
  const [archive, setArchive] = useState<NewsItem[] | null>(null);
  const [reach, setReach] = useState<number | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    loadNewsmarks().then(() => force((n) => n + 1)).catch(() => {});
    return subscribeNewsmarks(() => force((n) => n + 1));
  }, []);

  const loadArchive = useCallback((search: string) => {
    setArchive(null);
    api
      .newsHistory({ days: 30, q: search, limit: 120 })
      .then((d) => {
        setArchive(d.items || []);
        setReach(d.oldest ?? null);
      })
      .catch(() => setArchive([]));
  }, []);

  useEffect(() => {
    if (tab !== 'archive') return undefined;
    // Debounced: typing in the box should not be one request per keystroke.
    const t = setTimeout(() => loadArchive(q.trim()), q ? 350 : 0);
    return () => clearTimeout(t);
  }, [tab, q, loadArchive]);

  const saved: SavedNews[] = newsmarksNow() || [];
  const savedIds = useMemo(() => new Set(saved.map((x) => x.id)), [saved]);

  // A saved item carries no guaranteed source (some feeds ship none), so it is
  // widened to the row's shape rather than the API's.
  const rows: NewsItem[] | null =
    tab === 'latest'
      ? items
      : tab === 'archive'
        ? archive
        : saved.map((x) => ({ ...x, source: x.source || 'Saved' }));

  const empty =
    tab === 'latest'
      ? { title: 'No headlines right now', hint: 'Refresh to re-scrape ET Markets, Moneycontrol and Livemint.' }
      : tab === 'archive'
        ? q
          ? { title: 'Nothing matches', hint: `No recorded headline mentions “${q}”.` }
          : {
              title: 'The archive is still filling',
              hint: 'Feeds carry only a few hours, so history is recorded as it goes past — it starts from the first poll, not from a month ago.',
            }
        : { title: 'Nothing saved yet', hint: 'Tap the ☆ on a headline to keep it here. Saved news syncs with your account.' };

  return (
    <Card style={s.card}>
      <View style={s.head}>
        <SectionTitle>News</SectionTitle>
        <TouchableOpacity
          onPress={tab === 'archive' ? () => loadArchive(q.trim()) : onRefresh}
          disabled={busy}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Refresh the headlines"
        >
          <Text style={s.refresh}>{busy ? REFRESHING : REFRESH}</Text>
        </TouchableOpacity>
      </View>

      <View style={s.tabs}>
        {TABS.map((t) => {
          const on = t.k === tab;
          return (
            <TouchableOpacity
              key={t.k}
              style={[s.tab, on && s.tabOn]}
              onPress={() => setTab(t.k)}
              activeOpacity={0.75}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={t.label}
            >
              <Text style={[s.tabTxt, on && s.tabTxtOn]}>{t.label}</Text>
              {t.k === 'saved' && saved.length ? (
                <Text style={[s.count, on && s.tabTxtOn]}>{saved.length}</Text>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>

      {tab === 'archive' ? (
        <TextInput
          style={s.search}
          value={q}
          onChangeText={setQ}
          placeholder="Search a month of headlines…"
          placeholderTextColor={theme.muted}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Search recorded headlines"
        />
      ) : null}

      {rows == null ? (
        <Loading />
      ) : rows.length ? (
        <ScrollView style={s.list} nestedScrollEnabled showsVerticalScrollIndicator>
          {rows.map((n, i) => (
            <Row
              key={(n.link || '') + i}
              item={n}
              saved={savedIds.has(newsId(n.link))}
              onOpen={() => onOpen(n)}
              onSave={() => {
                toggleNewsmark(n).catch(() => {});
              }}
            />
          ))}
        </ScrollView>
      ) : (
        <EmptyState title={empty.title} hint={empty.hint} />
      )}

      {tab === 'archive' && reach ? (
        <Text style={s.reach}>
          Recorded back to {new Date(reach * 1000).toLocaleDateString('en-IN', {
            day: 'numeric', month: 'short',
          })}
        </Text>
      ) : null}
    </Card>
  );
}

const s = StyleSheet.create({
  card: { marginBottom: theme.sp.md },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  refresh: { color: theme.brand, fontSize: theme.fs.xs, fontWeight: '700' },
  tabs: { flexDirection: 'row', gap: 4, marginBottom: theme.sp.sm },
  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: theme.radius.pill, backgroundColor: theme.surface2,
    borderWidth: 1, borderColor: theme.border,
  },
  tabOn: { backgroundColor: theme.brandSoft, borderColor: theme.brand },
  tabTxt: { color: theme.muted2, fontSize: theme.fs.xs, fontWeight: '700' },
  tabTxtOn: { color: theme.brand },
  count: { color: theme.muted, fontSize: theme.fs.xs, fontFamily: theme.mono },
  search: {
    backgroundColor: theme.surface2, borderColor: theme.border2, borderWidth: 1,
    borderRadius: theme.radius.sm, color: theme.text, fontSize: theme.fs.sm,
    paddingHorizontal: 10, paddingVertical: 6, marginBottom: theme.sp.sm,
  },
  list: { maxHeight: 360 },
  row: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    paddingVertical: 8, borderTopWidth: 1, borderTopColor: theme.border,
  },
  rowMain: { flex: 1 },
  title: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '600', lineHeight: 18 },
  meta: { color: theme.muted, fontSize: theme.fs.xs, fontFamily: theme.mono, marginTop: 2 },
  reach: { color: theme.muted, fontSize: theme.fs.xs, marginTop: 6, textAlign: 'right' },
});
