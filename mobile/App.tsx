import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api } from './src/api';
import { AnalysisHome, ChartsHome, MoreScreen } from './src/screens/Hosts';
import ScreenerScreen from './src/screens/ScreenerScreen';
import UniverseScreen from './src/screens/UniverseScreen';
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

function icon(glyph: string) {
  const TabIcon = ({ color }: { color: string }) => (
    <Text style={{ color, fontSize: 15, fontWeight: '700' }}>{glyph}</Text>
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
            tabBarLabelStyle: { fontSize: 10 },
          }}
        >
          <Tab.Screen name="Screener" component={ScreenerScreen} options={{ tabBarIcon: icon('#') }} />
          <Tab.Screen name="Universe" component={UniverseScreen} options={{ tabBarIcon: icon('◈') }} />
          <Tab.Screen name="Analysis" component={AnalysisHome} options={{ tabBarIcon: icon('%') }} />
          <Tab.Screen name="Charts" component={ChartsHome} options={{ tabBarIcon: icon('~') }} />
          <Tab.Screen name="More" component={MoreScreen} options={{ tabBarIcon: icon('•••') }} />
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
