import { Platform } from 'react-native';
import { requireNativeModule } from 'expo';
import * as ExpoSpeech from 'expo-speech';

type EventSubscription = { remove: () => void };
type NativeSpeechEvent = {
  id?: string;
  message?: string;
  charIndex?: number;
  charLength?: number;
};

type NativeSpeechModule = {
  addListener: (
    eventName: 'speechStarted' | 'speechBoundary' | 'speechDone' | 'speechStopped' | 'speechError' | 'speechServiceLost',
    listener: (event: NativeSpeechEvent) => void,
  ) => EventSubscription;
  speak: (text: string, rate: number, utteranceId: string) => Promise<void>;
  stop: () => Promise<void>;
};

type SpeechCallbacks = {
  utteranceId: string;
  rate: number;
  onBoundary?: (event: { charIndex: number; charLength: number }) => void;
  onDone: () => void;
  onStopped: () => void;
  onError: (error?: Error) => void;
  onServiceLost?: (error?: Error) => void;
};

let nativeModule: NativeSpeechModule | null | undefined;
const subscriptions = new Map<string, EventSubscription[]>();

const getNativeModule = () => {
  if (Platform.OS !== 'android') return null;
  if (nativeModule !== undefined) return nativeModule;
  try {
    nativeModule = requireNativeModule<NativeSpeechModule>('BussyReaderSpeech');
  } catch {
    nativeModule = null;
  }
  return nativeModule;
};

const removeSubscriptions = (utteranceId: string) => {
  subscriptions.get(utteranceId)?.forEach((subscription) => subscription.remove());
  subscriptions.delete(utteranceId);
};

export const speak = (text: string, callbacks: SpeechCallbacks) => {
  const reportBoundary = (event: { charIndex?: number; charLength?: number }) => {
    const charIndex = event.charIndex;
    const charLength = event.charLength;
    if (
      !callbacks.onBoundary
      || typeof charIndex !== 'number'
      || !Number.isFinite(charIndex)
      || typeof charLength !== 'number'
      || !Number.isFinite(charLength)
      || charIndex < 0
      || charLength < 0
    ) {
      return;
    }

    const safeCharIndex = Math.min(text.length, Math.floor(charIndex));
    const safeCharLength = Math.min(text.length - safeCharIndex, Math.floor(charLength));
    callbacks.onBoundary({ charIndex: safeCharIndex, charLength: safeCharLength });
  };

  const native = getNativeModule();
  if (!native) {
    ExpoSpeech.speak(text, {
      rate: callbacks.rate,
      pitch: 1.0,
      useApplicationAudioSession: true,
      onDone: callbacks.onDone,
      onStopped: callbacks.onStopped,
      onError: callbacks.onError,
      onBoundary: callbacks.onBoundary ? reportBoundary : undefined,
    });
    return;
  }

  const { utteranceId } = callbacks;
  let terminalEventReceived = false;
  const listen = (
    eventName: 'speechDone' | 'speechStopped' | 'speechError' | 'speechServiceLost',
    handler: (event: NativeSpeechEvent) => void,
  ) => native.addListener(eventName, (event) => {
    if (event.id !== utteranceId || terminalEventReceived) return;
    terminalEventReceived = true;
    removeSubscriptions(utteranceId);
    handler(event);
  });
  const utteranceSubscriptions = [
    ...(callbacks.onBoundary
      ? [native.addListener('speechBoundary', (event) => {
        if (event.id !== utteranceId || terminalEventReceived) return;
        reportBoundary(event);
      })]
      : []),
    listen('speechDone', () => callbacks.onDone()),
    listen('speechStopped', () => callbacks.onStopped()),
    listen('speechError', (event) => callbacks.onError(new Error(event.message ?? 'Speech could not continue.'))),
    listen('speechServiceLost', (event) => callbacks.onServiceLost?.(new Error(event.message ?? 'Android speech service stopped unexpectedly.'))),
  ];
  subscriptions.set(utteranceId, utteranceSubscriptions);
  void Promise.resolve().then(() => native.speak(text, callbacks.rate, utteranceId)).catch((error) => {
    if (terminalEventReceived) return;
    terminalEventReceived = true;
    removeSubscriptions(utteranceId);
    callbacks.onError(error instanceof Error ? error : new Error('Speech could not start.'));
  });
};

export const stop = () => {
  subscriptions.forEach((_, utteranceId) => removeSubscriptions(utteranceId));
  const native = getNativeModule();
  if (native) {
    void native.stop();
  } else {
    ExpoSpeech.stop();
  }
};

export const usesNativeBackgroundSpeech = () => Boolean(getNativeModule());