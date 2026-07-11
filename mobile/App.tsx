import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api } from './src/api';
import ChartScreen from './src/screens/ChartScreen';
import Placeholder from './src/screens/Placeholder';
import ScreenerScreen from './src/screens/ScreenerScreen';
import { theme } from './src/theme';

const Tab = createBottomTabNavigator();

function AnalysisScreen() {
  return (
    <Placeholder
      title="Analysis"
      note="Upside-probability model (Monte Carlo + historical) and backtesting — porting next."
    />
  );
}
function WatchlistScreen() {
  return <Placeholder title="Watchlist" note="Your saved symbols — coming soon." />;
}

function HeaderTitle() {
  const [version, setVersion] = useState<string>('');
  useEffect(() => {
    api
      .version()
      .then((v) => setVersion(v.version))
      .catch(() => {});
  }, []);
  return (
    <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700' }}>
      Taur<Text style={{ color: theme.accent }}>Eye</Text>
      {version ? <Text style={{ color: theme.muted, fontSize: 12 }}>{'  v' + version}</Text> : null}
    </Text>
  );
}

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: theme.bg,
    card: theme.surface,
    text: theme.text,
    border: theme.border,
    primary: theme.accent,
  },
};

function icon(emoji: string) {
  const TabIcon = ({ color }: { color: string }) => (
    <Text style={{ color, fontSize: 16 }}>{emoji}</Text>
  );
  return TabIcon;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <NavigationContainer theme={navTheme}>
        <Tab.Navigator
          screenOptions={{
            headerTitle: () => <HeaderTitle />,
            headerStyle: { backgroundColor: theme.surface },
            headerTintColor: theme.text,
            tabBarStyle: { backgroundColor: theme.surface, borderTopColor: theme.border },
            tabBarActiveTintColor: theme.accent,
            tabBarInactiveTintColor: theme.muted,
          }}
        >
          <Tab.Screen name="Screener" component={ScreenerScreen} options={{ tabBarIcon: icon('#') }} />
          <Tab.Screen name="Chart" component={ChartScreen} options={{ tabBarIcon: icon('~') }} />
          <Tab.Screen name="Analysis" component={AnalysisScreen} options={{ tabBarIcon: icon('%') }} />
          <Tab.Screen name="Watchlist" component={WatchlistScreen} options={{ tabBarIcon: icon('*') }} />
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
