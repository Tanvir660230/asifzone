"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The scanner's sounds — one per outcome, so an operator who isn't looking at the screen still knows what happened:
 * scan      — one short high beep: the code was recognised
 * duplicate — two mid beeps: already scanned / already done
 * unknown   — one low buzz: not one of our codes
 * invalid   — three low beeps: recognised, but this parcel can't be used here (cancelled, wrong store, wrong item…)
 * success   — a rising pair: the operation was saved by the server
 * failed    — a falling pair: the operation was refused or didn't reach the server
 *
 * iOS Safari suspends AudioContext until resumed inside a user gesture: call `unlock()` on button taps (e.g. opening
 * the camera or toggling sound) so subsequent async scan results always beep cleanly on iPhone.
 */
export type ScannerTone = "scan" | "duplicate" | "unknown" | "invalid" | "success" | "failed";

const PATTERNS: Record<ScannerTone, { beeps: Array<[number, number]>; vibrate: number | number[] }> = {
  scan: { beeps: [[1046, 0.09]], vibrate: 40 },
  duplicate: { beeps: [[660, 0.08], [660, 0.08]], vibrate: [40, 60, 40] },
  unknown: { beeps: [[220, 0.28]], vibrate: 220 },
  invalid: { beeps: [[300, 0.09], [300, 0.09], [300, 0.09]], vibrate: [80, 50, 80, 50, 80] },
  success: { beeps: [[784, 0.08], [1175, 0.12]], vibrate: [30, 40, 60] },
  failed: { beeps: [[523, 0.1], [262, 0.22]], vibrate: [120, 60, 200] },
};

const STORAGE_KEY = "scanner-sound";

function getAudioContext(ref: React.MutableRefObject<AudioContext | null>): AudioContext | null {
  try {
    if (!ref.current) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ref.current = new Ctor();
    }
    return ref.current;
  } catch {
    return null;
  }
}

export function useScannerSound() {
  const ctx = useRef<AudioContext | null>(null);
  const [enabled, setEnabledState] = useState(true);
  useEffect(() => {
    try {
      setEnabledState(localStorage.getItem(STORAGE_KEY) !== "off");
    } catch {
      // Storage blocked: sound stays on for this page.
    }
  }, []);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  /** Call synchronously inside a user tap/click so iPhone Safari unlocks Web Audio for async scan results. */
  const unlock = useCallback(() => {
    const ac = getAudioContext(ctx);
    if (ac && ac.state === "suspended") {
      void ac.resume().catch(() => {});
    }
  }, []);

  const setEnabled = useCallback(
    (on: boolean) => {
      setEnabledState(on);
      if (on) unlock();
      try {
        localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
      } catch {
        // Not remembered — still applies to this page.
      }
    },
    [unlock],
  );

  const play = useCallback((tone: ScannerTone) => {
    const pattern = PATTERNS[tone];
    if (enabledRef.current) {
      const ac = getAudioContext(ctx);
      if (ac) {
        const trigger = () => {
          try {
            let t = ac.currentTime;
            for (const [freq, dur] of pattern.beeps) {
              const osc = ac.createOscillator();
              const gain = ac.createGain();
              osc.frequency.value = freq;
              gain.gain.setValueAtTime(0.2, t);
              gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
              osc.connect(gain).connect(ac.destination);
              osc.start(t);
              osc.stop(t + dur);
              t += dur + 0.06;
            }
          } catch {
            // Audio unavailable: visual banner and haptics still signal the outcome.
          }
        };
        if (ac.state === "suspended") {
          void ac.resume().then(trigger).catch(() => {});
        } else {
          trigger();
        }
      }
    }
    navigator.vibrate?.(pattern.vibrate);
  }, []);

  return { play, unlock, enabled, setEnabled };
}

const VOICE_STORAGE_KEY = "scanner-voice";

/**
 * Optional spoken feedback (Web Speech API) so fast packers / warehouse operators hear the scan outcome
 * ("Added", "Duplicate", "Cancelled, do not ship") without looking up at the screen. Off by default; cancels any
 * in-progress utterance before speaking the latest one so rapid scans never queue up a backlog.
 */
export function useScannerVoice() {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabledState] = useState(false);

  useEffect(() => {
    const ok = typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
    setSupported(ok);
    if (!ok) return;
    try {
      setEnabledState(localStorage.getItem(VOICE_STORAGE_KEY) === "on");
    } catch {
      // Storage blocked: stays off until toggled.
    }
    return () => {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore cleanup errors.
      }
    };
  }, []);

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const supportedRef = useRef(supported);
  supportedRef.current = supported;

  const speak = useCallback((phrase: string) => {
    if (!enabledRef.current || !supportedRef.current) return;
    const text = phrase.trim();
    if (!text) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "en-US";
      utterance.rate = 1.15;
      window.speechSynthesis.speak(utterance);
    } catch {
      // Speech unavailable — beeps and visual banner still work.
    }
  }, []);

  const setEnabled = useCallback((on: boolean) => {
    setEnabledState(on);
    try {
      localStorage.setItem(VOICE_STORAGE_KEY, on ? "on" : "off");
    } catch {
      // Not remembered — still applies to this page.
    }
    if (!on) {
      try {
        window.speechSynthesis?.cancel();
      } catch {
        // Ignore.
      }
    } else if (supportedRef.current) {
      try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance("Voice on");
        u.lang = "en-US";
        u.rate = 1.15;
        window.speechSynthesis.speak(u);
      } catch {
        // Ignore.
      }
    }
  }, []);

  return { speak, enabled, setEnabled, supported };
}
