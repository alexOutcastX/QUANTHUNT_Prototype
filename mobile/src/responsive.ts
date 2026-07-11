import { useWindowDimensions } from 'react-native';

// Breakpoints. Phones and tablets (portrait) get the native mobile layout
// (bottom tabs); laptops/desktops and large/landscape tablets get the desktop
// layout (left sidebar). 1024 is the standard "lg" cutoff.
export const DESKTOP_MIN = 1024;
export const TABLET_MIN = 600;

export type Responsive = {
  width: number;
  height: number;
  isPhone: boolean;
  isTablet: boolean;
  isDesktop: boolean;
};

export function useResponsive(): Responsive {
  const { width, height } = useWindowDimensions();
  return {
    width,
    height,
    isPhone: width < TABLET_MIN,
    isTablet: width >= TABLET_MIN && width < DESKTOP_MIN,
    isDesktop: width >= DESKTOP_MIN,
  };
}
