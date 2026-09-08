jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
}));

jest.mock('expo-speech', () => ({
  speak: jest.fn(),
  stop: jest.fn(),
}));

jest.mock('expo', () => ({
  requireNativeModule: jest.fn(),
}));

import { requireNativeModule } from 'expo';
import * as ExpoSpeech from 'expo-speech';
import { speak, stop } from './index';

const mockRequireNativeModule = requireNativeModule as jest.Mock;
const mockExpoSpeak = ExpoSpeech.speak as jest.Mock;
const mockExpoStop = ExpoSpeech.stop as jest.Mock;

describe('Android background speech adapter', () => {
  const listeners = new Map<string, (event: { id?: string; message?: string; charIndex?: number; charLength?: number }) => void>();
  const remove = jest.fn();
  const nativeSpeech = {
    addListener: jest.fn((eventName: string, listener: (event: { id?: string; message?: string }) => void) => {
      listeners.set(eventName, listener);
      return { remove };
    }),
    speak: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    listeners.clear();
    mockRequireNativeModule.mockReturnValue(nativeSpeech);
  });

  it('sends Android speech to the foreground-service module and chains matching completion events', async () => {
    const onDone = jest.fn();
    const onStopped = jest.fn();
    const onError = jest.fn();

    speak('A local page', {
      utteranceId: 'page-1',
      rate: 1.05,
      onDone,
      onStopped,
      onError,
    });
    await Promise.resolve();

    expect(nativeSpeech.speak).toHaveBeenCalledWith('A local page', 1.05, 'page-1');
    listeners.get('speechDone')?.({ id: 'other-page' });
    expect(onDone).not.toHaveBeenCalled();

    listeners.get('speechDone')?.({ id: 'page-1' });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalled();
    expect(mockExpoSpeak).not.toHaveBeenCalled();
  });

  it('reports safe native boundary progress and ignores stale or invalid boundaries', async () => {
    const onBoundary = jest.fn();
    const onDone = jest.fn();

    speak('A local page', {
      utteranceId: 'page-boundary',
      rate: 1,
      onBoundary,
      onDone,
      onStopped: jest.fn(),
      onError: jest.fn(),
    });
    await Promise.resolve();

    listeners.get('speechBoundary')?.({ id: 'other-page', charIndex: 1, charLength: 2 });
    listeners.get('speechBoundary')?.({ id: 'page-boundary', charIndex: 4.8, charLength: 99 });
    listeners.get('speechBoundary')?.({ id: 'page-boundary', charIndex: -1, charLength: 2 });
    expect(onBoundary).toHaveBeenCalledWith({ charIndex: 4, charLength: 8 });

    listeners.get('speechDone')?.({ id: 'page-boundary' });
    listeners.get('speechBoundary')?.({ id: 'page-boundary', charIndex: 2, charLength: 1 });
    expect(onBoundary).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('stops the native foreground service and removes event listeners', () => {
    speak('A local page', {
      utteranceId: 'page-2',
      rate: 1,
      onDone: jest.fn(),
      onStopped: jest.fn(),
      onError: jest.fn(),
    });

    stop();

    expect(nativeSpeech.stop).toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
    expect(mockExpoStop).not.toHaveBeenCalled();
  });

  it('reports a native service loss once and ignores stale completion events', async () => {
    const onDone = jest.fn();
    const onServiceLost = jest.fn();

    speak('A local page', {
      utteranceId: 'page-3',
      rate: 1,
      onDone,
      onStopped: jest.fn(),
      onError: jest.fn(),
      onServiceLost,
    });
    await Promise.resolve();

    listeners.get('speechServiceLost')?.({ id: 'page-3', message: 'Service was recreated.' });
    listeners.get('speechDone')?.({ id: 'page-3' });

    expect(onServiceLost).toHaveBeenCalledTimes(1);
    expect(onServiceLost.mock.calls[0][0]).toEqual(new Error('Service was recreated.'));
    expect(onDone).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
  });
});
