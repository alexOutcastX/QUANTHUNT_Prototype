// The app always renders through react-native-web (both the website and the
// Capacitor Android shell load the web export), so web-only escape hatches are
// safe. react-native-web ships no TS types for this entry point — declare the
// one function we use.
declare module 'react-native-web' {
  export function unstable_createElement(
    type: string,
    props?: Record<string, unknown> | null,
    ...children: unknown[]
  ): import('react').ReactElement;
}
