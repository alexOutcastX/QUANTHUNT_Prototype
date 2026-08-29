// The Desk's own landing page.
//
// Desk opened onto the Watchlist, which is one of its twelve destinations and
// not an overview of any of them. A section that is a bar of tabs and nothing
// else asks you to choose before it has told you anything.
//
// So this is the answer to "what is going on around my positions": what the
// market is doing this week (holidays), what is coming for the companies in it
// (the corporate-action calendar), how any of the numbers are arrived at
// (methodology, foldable in place), and who is talking (community). Notices
// from the team sit under all of it, because an announcement is something you
// read once and then scroll past — not something to lead with.
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Card, EmptyState, Fold, Loading, ScreenTitle, SectionTitle } from '../ui';
import { Icon } from '../icons';
import { theme } from '../theme';
import { useResponsive } from '../responsive';
import { navigate, openStock } from '../navIntent';
import { CalendarAction, HolidaysResp, api } from '../api';
import { SECTIONS as METHOD_SECTIONS } from './MethodologyScreen';
import AnnouncementsScreen from './AnnouncementsScreen';
import { Overview, loadIdentity, overview } from '../chat';

// The kinds the card can show, in the order they are offered. The server
// reports the same set as `covers`; this is the fallback if an old response
// arrives without it.
const KINDS = ['All', 'Dividend', 'Bonus', 'Split', 'Rights', 'Buyback', 'IPO', 'Other'] as const;
type Kind = (typeof KINDS)[number];

// What "nothing here" means, per kind. NSE publishes ex-dates only a few weeks
// out, so an empty Bonus filter is a fact about the next month, not a fault.
const NONE_HINT: Record<string, string> = {
  Dividend: 'No dividends have gone to an ex-date in this window yet.',
  Bonus: 'No bonus issues announced with an ex-date in this window.',
  Split: 'No stock splits announced with an ex-date in this window.',
  Rights: 'No rights issues announced with an ex-date in this window.',
  Buyback: 'No buybacks announced with an ex-date in this window.',
  IPO: 'No public issues open or opening in this window.',
  Other: 'No demergers, schemes or other actions in this window.',
};

/** "31 Aug" from an ISO date, or the raw value if it is not one. */
function shortDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]}`;
}

function daysAway(iso?: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso + 'T00:00:00Z').getTime();
  if (Number.isNaN(d)) return null;
  const today = new Date();
  const t = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((d - t) / 86400000);
}

/** A colour per action type, so the list is scannable without reading it. */
const KIND_TONE: Record<string, string> = {
  IPO: theme.accent,
  Dividend: theme.green,
  Bonus: theme.brand,
  Split: theme.brand,
  Rights: '#b7791f',
  Buyback: theme.brand,
  Other: theme.muted,
};

/** The second line of the date column: how long until this matters.
 *
 * An IPO is filed under the day its book OPENS, which for a live issue is in
 * the past — "in -2d" is not a thing to tell anyone. What matters about a book
 * that is already open is when it shuts, so that is what it counts down to.
 */
function whenLabel(a: CalendarAction): string | null {
  const away = daysAway(a.date);
  if (away != null && away < 0) {
    const shuts = daysAway(a.close_date);
    if (shuts == null || shuts < 0) return 'open';
    return shuts === 0 ? 'closes today' : shuts === 1 ? 'closes tomorrow' : `closes in ${shuts}d`;
  }
  if (away == null) return null;
  return away === 0 ? 'today' : away === 1 ? 'tomorrow' : `in ${away}d`;
}

function ActionRow({ a }: { a: CalendarAction }) {
  const when = whenLabel(a);
  return (
    <TouchableOpacity
      style={s.row}
      onPress={() => openStock(a.symbol)}
      activeOpacity={0.7}
      accessibilityRole="link"
      accessibilityLabel={
        `${a.symbol}, ${a.subject}, ${a.kind === 'IPO' ? 'opens' : 'ex-date'} ${shortDate(a.date)}`
      }
    >
      <View style={s.dateCol}>
        <Text style={s.date}>{shortDate(a.date)}</Text>
        {when ? <Text style={s.away}>{when}</Text> : null}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.sym} numberOfLines={1}>{a.symbol}</Text>
        <Text style={s.subject} numberOfLines={1}>{a.subject}</Text>
      </View>
      <Text style={[s.kind, { color: KIND_TONE[a.kind] || theme.muted }]}>{a.kind}</Text>
    </TouchableOpacity>
  );
}

function CorporateCalendar() {
  const [items, setItems] = useState<CalendarAction[] | null>(null);
  const [covers, setCovers] = useState<string[] | null>(null);
  const [kind, setKind] = useState<Kind>('All');
  const [all, setAll] = useState(false);

  useEffect(() => {
    api.corpCalendar(30)
      .then((d) => { setItems(d.items || []); setCovers(d.covers || null); })
      .catch(() => setItems([]));
  }, []);

  // Every kind the calendar covers, whether or not this window contains one.
  //
  // These chips used to be filtered down to the kinds actually present, on the
  // reasoning that a chip returning nothing is noise. It reads as a missing
  // feature instead: in a quiet month the row said "All · Dividend · Split"
  // and there was no way to tell whether bonus issues were absent or simply
  // not covered. A chip reading "Bonus 0" answers the question.
  const offered = useMemo<Kind[]>(() => {
    const cov = covers && covers.length ? covers : null;
    return KINDS.filter((k) => k === 'All' || !cov || (cov as string[]).includes(k));
  }, [covers]);

  const count = (k: Kind) =>
    k === 'All' ? (items || []).length : (items || []).filter((i) => i.kind === k).length;

  const shown = useMemo(() => {
    const f = (items || []).filter((i) => kind === 'All' || i.kind === kind);
    return all ? f : f.slice(0, 8);
  }, [items, kind, all]);

  const total = (items || []).filter((i) => kind === 'All' || i.kind === kind).length;

  return (
    <Card style={s.card}>
      <View style={s.head}>
        <SectionTitle>Corporate calendar</SectionTitle>
        <Text style={s.headNote}>next 30 days · NSE</Text>
      </View>
      {items == null ? (
        <Loading />
      ) : items.length === 0 ? (
        <EmptyState
          title="No actions listed"
          hint="NSE has published nothing for the next 30 days, or the feed is briefly unreachable."
        />
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
            {offered.map((k) => {
              const on = k === kind;
              const n = count(k);
              return (
                <TouchableOpacity
                  key={k}
                  style={[s.chip, on && s.chipOn, !n && !on && s.chipEmpty]}
                  onPress={() => { setKind(k); setAll(false); }}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${k}, ${n} action${n === 1 ? '' : 's'}`}
                >
                  <Text style={[s.chipTxt, on && s.chipTxtOn, !n && !on && s.chipTxtEmpty]}>{k}</Text>
                  <Text style={[s.chipN, on && s.chipTxtOn, !n && !on && s.chipTxtEmpty]}>{n}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          {shown.length === 0 ? (
            <EmptyState
              title={`No ${kind.toLowerCase()} actions`}
              hint={NONE_HINT[kind] || 'Nothing of this kind in the next 30 days.'}
            />
          ) : (
            shown.map((a, i) => <ActionRow key={a.symbol + (a.date || '') + i} a={a} />)
          )}
          {total > shown.length ? (
            <TouchableOpacity onPress={() => setAll(true)} activeOpacity={0.7} accessibilityRole="button">
              <Text style={s.more}>Show all {total} ›</Text>
            </TouchableOpacity>
          ) : null}
        </>
      )}
    </Card>
  );
}

function MarketDates() {
  const [h, setH] = useState<HolidaysResp | null>(null);
  useEffect(() => {
    api.holidays().then(setH).catch(() => setH(null));
  }, []);
  const upcoming = useMemo(() => {
    if (!h) return [];
    const today = new Date().toISOString().slice(0, 10);
    return (h.holidays || []).filter((x) => x.date >= today).slice(0, 5);
  }, [h]);
  return (
    <Card style={s.card}>
      <View style={s.head}>
        <SectionTitle>Market days</SectionTitle>
        <TouchableOpacity
          onPress={() => navigate('desk', { sub: 'holidays' })}
          activeOpacity={0.7}
          accessibilityRole="link"
          accessibilityLabel="Open the full holiday calendar"
        >
          <Text style={s.link}>Full calendar ›</Text>
        </TouchableOpacity>
      </View>
      {!h ? (
        <Loading />
      ) : (
        <>
          <View style={s.statusRow}>
            <View style={[s.dot, { backgroundColor: h.open ? theme.green : theme.red }]} />
            <Text style={s.status}>{h.open ? 'Market open' : 'Market closed'}</Text>
            <Text style={s.statusIst}>{h.now_ist} IST</Text>
          </View>
          {upcoming.length ? (
            upcoming.map((d) => {
              const away = daysAway(d.date);
              return (
                <View key={d.date} style={s.holRow}>
                  <Text style={s.holDate}>{shortDate(d.date)}</Text>
                  <Text style={s.holName} numberOfLines={1}>{d.name}</Text>
                  <Text style={s.holAway}>{away != null ? (away === 0 ? 'today' : `${away}d`) : d.day}</Text>
                </View>
              );
            })
          ) : (
            <Text style={s.none}>No further holidays published this year.</Text>
          )}
          {/* The calendar is indicative until NSE circulars confirm it, and
              saying so is cheaper than being wrong about a trading day. */}
          <Text style={s.foot}>Indicative — verify against NSE circulars.</Text>
        </>
      )}
    </Card>
  );
}

function Community() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [known, setKnown] = useState<boolean | null>(null);
  useEffect(() => {
    loadIdentity()
      .then((u) => {
        setKnown(!!u);
        if (u) overview(u.user_id).then(setOv).catch(() => setOv(null));
      })
      .catch(() => setKnown(false));
  }, []);
  const rooms = (ov?.rooms || []).slice(0, 3);
  return (
    <Card style={s.card}>
      <View style={s.head}>
        <SectionTitle>Community</SectionTitle>
        {ov?.online ? <Text style={s.headNote}>{ov.online} online</Text> : null}
      </View>
      {known === null ? (
        <Loading />
      ) : !known ? (
        <EmptyState
          title="Pick a handle to join"
          hint="A global room, topic channels and direct messages. No account needed — just a name."
          action={{ label: 'Open community', onPress: () => navigate('desk', { sub: 'community' }) }}
        />
      ) : rooms.length ? (
        <>
          {rooms.map((r) => (
            <TouchableOpacity
              key={r.conv}
              style={s.roomRow}
              onPress={() => navigate('desk', { sub: 'community' })}
              activeOpacity={0.7}
              accessibilityRole="link"
              accessibilityLabel={`Open ${r.name}`}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.roomName} numberOfLines={1}>{r.name}</Text>
                {r.last ? (
                  <Text style={s.roomLast} numberOfLines={1}>
                    {r.last.handle}: {r.last.text}
                  </Text>
                ) : (
                  <Text style={s.roomLast}>No messages yet</Text>
                )}
              </View>
              {r.unread ? <Text style={s.unread}>{r.unread}</Text> : null}
              <Icon name="chevronRight" size={14} color={theme.muted} />
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            onPress={() => navigate('desk', { sub: 'community' })}
            activeOpacity={0.7}
            accessibilityRole="link"
          >
            <Text style={s.more}>Open community ›</Text>
          </TouchableOpacity>
        </>
      ) : (
        <EmptyState title="No rooms yet" hint="The global room appears once the community feed is reachable." />
      )}
    </Card>
  );
}

export default function DeskHome() {
  const { width } = useResponsive();
  const wide = width >= 1100;
  return (
    // Same shape as every other Desk screen: the title row sits outside the
    // scroller and supplies its own padding, and the scroller pads only its
    // sides. Inside the scroller the page carried the title row's padding on
    // top of the container's, which set the heading down from the top by
    // twice what the other pages use.
    <View style={s.container}>
      <ScreenTitle
        title="Desk"
        sub="Your positions, your research, and the calendar around them"
      />
      <ScrollView contentContainerStyle={s.content}>
        <View style={[s.page, wide && s.pageWide]}>
          <View style={s.mainCol}>
            <CorporateCalendar />
            {/* Expandable in place: the method is what an institution reads
                before it trusts a number, and sending them to another page to
                read it is how it goes unread. Collapsed by default — it is
                reference, not news. */}
            <Card style={s.card}>
              <Fold
                title="Methodology"
                summary="How every score in the app is computed — the published rules"
                open={false}
                persistKey="desk.methodology"
                flat
              >
                {METHOD_SECTIONS.map((sec) => (
                  <View key={sec.title} style={s.methodSec}>
                    <Text style={s.methodTitle}>{sec.title}</Text>
                    <Text style={s.methodBody}>{sec.body}</Text>
                  </View>
                ))}
              </Fold>
            </Card>
          </View>

          <View style={[s.rail, wide && s.railWide]}>
            <MarketDates />
            <Community />
          </View>
        </View>

        {/* Below everything: notices are read once, not led with. */}
        <View style={s.announce}>
          <SectionTitle>Announcements from the Dev</SectionTitle>
          <AnnouncementsScreen embedded />
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  // No maxWidth and no centring: capped at 1480 and centred, the page grew
  // margins on a wide monitor that no other page in the app has, so the Desk
  // home was the one screen that did not start at the left edge.
  content: { paddingHorizontal: theme.sp.lg, paddingBottom: theme.sp.xl },
  page: { flexDirection: 'column' },
  pageWide: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.sp.lg },
  mainCol: { flex: 1, minWidth: 0 },
  rail: { width: '100%' },
  railWide: { width: 340, flexGrow: 0, flexShrink: 0 },
  card: { marginBottom: theme.sp.md },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headNote: { color: theme.muted, fontSize: theme.fs.xs, fontFamily: theme.mono },
  link: { color: theme.brand, fontSize: theme.fs.xs, fontWeight: '700' },

  chips: { flexDirection: 'row', gap: 6, paddingVertical: 8 },
  // A kind with nothing in it is still worth showing — dimmed, so the row
  // still reads at a glance as "these are the ones that have something".
  chipEmpty: { opacity: 0.5 },
  chipTxtEmpty: { color: theme.muted },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface2,
    borderRadius: theme.radius.pill, paddingHorizontal: 10, paddingVertical: 4,
  },
  chipOn: { backgroundColor: theme.brandSoft, borderColor: theme.brand },
  chipTxt: { color: theme.muted2, fontSize: theme.fs.xs, fontWeight: '700' },
  chipTxtOn: { color: theme.brand },
  chipN: { color: theme.muted, fontSize: theme.fs.xs, fontFamily: theme.mono },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 8, borderTopWidth: 1, borderTopColor: theme.border,
  },
  dateCol: { width: 62 },
  date: { color: theme.text, fontSize: theme.fs.sm, fontFamily: theme.mono, fontWeight: '700' },
  away: { color: theme.muted, fontSize: 9, fontFamily: theme.mono },
  sym: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '700' },
  subject: { color: theme.muted, fontSize: theme.fs.xs },
  kind: { fontSize: theme.fs.xs, fontWeight: '700' },
  more: { color: theme.brand, fontSize: theme.fs.xs, fontWeight: '700', marginTop: 8 },

  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  dot: { width: 8, height: 8, borderRadius: 999 },
  status: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '700' },
  statusIst: { color: theme.muted, fontSize: theme.fs.xs, fontFamily: theme.mono },
  holRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 6, borderTopWidth: 1, borderTopColor: theme.border,
  },
  holDate: { color: theme.text, fontSize: theme.fs.xs, fontFamily: theme.mono, width: 52 },
  holName: { color: theme.muted2, fontSize: theme.fs.xs, flex: 1 },
  holAway: { color: theme.muted, fontSize: theme.fs.xs, fontFamily: theme.mono },
  none: { color: theme.muted, fontSize: theme.fs.xs, paddingVertical: 6 },
  foot: { color: theme.muted, fontSize: 9, marginTop: 8 },

  roomRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 8, borderTopWidth: 1, borderTopColor: theme.border,
  },
  roomName: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '600' },
  roomLast: { color: theme.muted, fontSize: theme.fs.xs },
  unread: {
    color: theme.onAccent, backgroundColor: theme.brand, fontSize: 10, fontWeight: '800',
    borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden',
  },

  methodSec: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: theme.border },
  methodTitle: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '700', marginBottom: 3 },
  methodBody: { color: theme.muted2, fontSize: theme.fs.xs, lineHeight: 18 },

  announce: { marginTop: theme.sp.lg },
});
