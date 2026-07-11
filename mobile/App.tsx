import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api } from './src/api';
import AnalysisScreen from './src/screens/AnalysisScreen';
import CalculatorScreen from './src/screens/CalculatorScreen';
import ChartScreen from './src/screens/ChartScreen';
import PortfolioScreen from './src/screens/PortfolioScreen';
import ScreenerScreen from './src/screens/ScreenerScreen';
import TradingViewScreen from './src/screens/TradingViewScreen';
import WatchlistScreen from './src/screens/WatchlistScreen';
import { theme } from './src/theme';

const Tab = createBottomTabNavigator();

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
            tabBarLabelStyle: { fontSize: 9 },
            tabBarItemStyle: { paddingHorizontal: 0 },
          }}
        >
          <Tab.Screen name="Screener" component={ScreenerScreen} options={{ tabBarIcon: icon('#') }} />
          <Tab.Screen name="Chart" component={ChartScreen} options={{ tabBarIcon: icon('~') }} />
          <Tab.Screen name="Analysis" component={AnalysisScreen} options={{ tabBarIcon: icon('%') }} />
          <Tab.Screen name="TradingView" component={TradingViewScreen} options={{ tabBarIcon: icon('TV'), title: 'TView' }} />
          <Tab.Screen name="Portfolio" component={PortfolioScreen} options={{ tabBarIcon: icon('Pf') }} />
          <Tab.Screen name="Watchlist" component={WatchlistScreen} options={{ tabBarIcon: icon('*'), title: 'Watch' }} />
          <Tab.Screen name="Calculator" component={CalculatorScreen} options={{ tabBarIcon: icon('='), title: 'Calc' }} />
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
