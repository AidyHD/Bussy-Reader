import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import SettingsScreen from '../index';
import { BUY_ME_A_COFFEE_URL } from '@/constants/Support';

jest.mock('expo-web-browser', () => ({
  openBrowserAsync: jest.fn(),
}));

jest.mock('expo-router', () => ({
  router: {
    back: jest.fn(),
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    background: '#0C0D0C',
    foreground: '#F1EEE8',
    card: '#171917',
    primary: '#FF7D68',
    primaryForeground: '#1B0D0A',
    mutedForeground: '#979891',
    accent: '#2B2521',
    border: '#2A2D29',
  }),
}));

jest.mock('@/context/LibraryContext', () => ({
  useLibrary: () => ({
    settings: { theme: 'pitch', fontSize: 18, lineSpacing: 1.65, margin: 24, keepAwake: true },
    setSettings: jest.fn(),
  }),
}));

jest.mock('@expo/vector-icons', () => ({
  Feather: ({ name }: { name: string }) => {
    const React = require('react');
    const { Text } = require('react-native');
    return React.createElement(Text, null, name);
  },
}));

describe('SettingsScreen support card', () => {
  const openBrowserAsync = WebBrowser.openBrowserAsync as jest.MockedFunction<typeof WebBrowser.openBrowserAsync>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('opens the Ko-fi page in the in-app browser', async () => {
    openBrowserAsync.mockResolvedValue({ type: 'opened' } as unknown as Awaited<ReturnType<typeof WebBrowser.openBrowserAsync>>);
    const { getByLabelText } = render(<SettingsScreen />);

    fireEvent.press(getByLabelText('Support Cheeky Reader'));

    await waitFor(() => {
      expect(openBrowserAsync).toHaveBeenCalledWith(BUY_ME_A_COFFEE_URL);
    });
  });

  it('falls back to the native URL handler when the in-app browser fails', async () => {
    openBrowserAsync.mockRejectedValue(new Error('browser unavailable'));
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const { getByLabelText } = render(<SettingsScreen />);

    fireEvent.press(getByLabelText('Support Cheeky Reader'));

    await waitFor(() => {
      expect(openURL).toHaveBeenCalledWith(BUY_ME_A_COFFEE_URL);
    });
    openURL.mockRestore();
  });

  it('keeps Settings mounted when both browser handoffs fail', async () => {
    openBrowserAsync.mockRejectedValue(new Error('browser unavailable'));
    const openURL = jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no browser available'));
    const { getByLabelText, getByText } = render(<SettingsScreen />);

    fireEvent.press(getByLabelText('Support Cheeky Reader'));

    await waitFor(() => {
      expect(openURL).toHaveBeenCalledWith(BUY_ME_A_COFFEE_URL);
    });
    expect(getByText('Settings')).toBeTruthy();
    openURL.mockRestore();
  });
});
