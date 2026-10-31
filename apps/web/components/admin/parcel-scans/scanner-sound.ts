"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The scanner's sounds — one per outcome, so an operator who isn't looking at the screen still knows what happened:
 * scan     — one short high beep: the code was recognised
 * duplicate — two mid beeps: already scanned / already done
 * unknown  — one low buzz: not one of our codes
 * invalid  — three low beeps: recognised, but this parcel can't be used here (cancelled, wrong store, wrong item…)
 * success  — a rising pair: the operation was saved by the server
 * failed   — a falling pair: the operation was refused or didn't reach the server
 * Phones also vibrate. The on/off choice is remembered on this device (it is a station preference, not shared).
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

  const setEnabled = useCallback((on: boolean) => {
    setEnabledState(on);
    try {
      localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
    } catch {
      // Not remembered — still applies to this page.
    }
  }, []);

  const play = useCallback((tone: ScannerTone) => {
    const pattern = PATTERNS[tone];
    if (enabledRef.current) {
      try {
        ctx.current ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        const ac = ctx.current;
        let t = ac.currentTime;
        for (const [freq, dur] of pattern.beeps) {
          const osc = ac.createOscillator();
          const gain = ac.createGain();
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.18, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
          osc.connect(gain).connect(ac.destination);
          osc.start(t);
          osc.stop(t + dur);
          t += dur + 0.06;
        }
      } catch {
        // No audio (autoplay policy before the first interaction): colour and text still say it.
      }
    }
    navigator.vibrate?.(pattern.vibrate);
  }, []);

  return { play, enabled, setEnabled };
}
