"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { Check, Copy, Download, ShieldCheck } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { describeApiError } from "@/lib/api-client";
import { disableTwoStep, enableTwoStep, startTwoStepSetup } from "@/lib/auth";

/** "JBSWY3DPEHPK3PXP" → "JBSW Y3DP EHPK 3PXP": easier to type into an app by hand. */
const groupKey = (key: string) => key.replace(/(.{4})/g, "$1 ").trim();

/**
 * Account › 2-step sign-in (admin audit phase 2): turn on a code from an authenticator app after the password — scan,
 * confirm with one code, keep the recovery codes — or turn it off with a current code. One dialog, three moments.
 */
export function TwoStepDialog({ open, onClose, enabled }: { open: boolean; onClose: () => void; enabled: boolean }) {
  const queryClient = useQueryClient();
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const refreshAdmin = () => queryClient.invalidateQueries({ queryKey: ["current-admin"] });

  const start = useMutation({ mutationFn: startTwoStepSetup, onSuccess: setSetup, onError: (e) => toast.error(describeApiError(e, "Couldn't start the setup")) });
  const confirm = useMutation({
    mutationFn: () => enableTwoStep(code),
    onSuccess: (r) => {
      setRecovery(r.recoveryCodes);
      setCode("");
      void refreshAdmin();
    },
    onError: (e) => toast.error(describeApiError(e, "That code didn't match")),
  });
  const turnOff = useMutation({
    mutationFn: () => disableTwoStep(code),
    onSuccess: () => {
      toast.success("2-step sign-in is off");
      void refreshAdmin();
      close();
    },
    onError: (e) => toast.error(describeApiError(e, "That code didn't match")),
  });

  function close() {
    setSetup(null);
    setRecovery(null);
    setCode("");
    setCopied(false);
    onClose();
  }

  function downloadCodes() {
    const blob = new Blob([`Store Console recovery codes — each works once\n\n${recovery!.join("\n")}\n`], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "store-console-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const codeInput = (
    <div>
      <Label htmlFor="two-step-setup-code">6-digit code from the app</Label>
      <Input
        id="two-step-setup-code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="123 456"
        maxLength={7}
        className="max-w-48 text-center text-lg tracking-[0.3em] tabular-nums"
      />
    </div>
  );
  const ready = code.replace(/\s/g, "").length >= 6;

  // 3 — done: the recovery codes, shown once.
  if (recovery) {
    return (
      <Modal open={open} onClose={close} title="Save your recovery codes" widthClassName="max-w-md" footer={<Button onClick={close}>I&rsquo;ve saved them</Button>}>
        <div className="space-y-4" data-testid="two-step-recovery">
          <p className="flex items-start gap-2 text-sm text-fg-muted">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success-600" aria-hidden />
            2-step sign-in is on. If you lose your phone, each of these codes signs you in once. They won&rsquo;t be shown again.
          </p>
          <ul className="grid grid-cols-2 gap-2 rounded-xl bg-surface-muted p-4 font-mono text-sm tabular-nums text-fg">
            {recovery.map((c) => <li key={c}>{c}</li>)}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(recovery.join("\n"));
                setCopied(true);
              }}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? "Copied" : "Copy"}
            </Button>
            <Button size="sm" variant="outline" onClick={downloadCodes}><Download className="h-4 w-4" /> Download</Button>
          </div>
        </div>
      </Modal>
    );
  }

  // On already: turning it off needs a current code.
  if (enabled) {
    return (
      <Modal
        open={open}
        onClose={close}
        title="2-step sign-in is on"
        description="Signing in asks for a code from your authenticator app after the password."
        widthClassName="max-w-md"
        footer={<Button variant="outline" disabled={!ready} loading={turnOff.isPending} onClick={() => turnOff.mutate()}>Turn off</Button>}
      >
        <div className="space-y-3">
          <p className="text-sm text-fg-muted">To turn it off, type the current code from your app (or a recovery code).</p>
          {codeInput}
        </div>
      </Modal>
    );
  }

  // 1 — not started; 2 — scan and confirm.
  return (
    <Modal
      open={open}
      onClose={close}
      title="Turn on 2-step sign-in"
      description="After your password, sign-in asks for a code from an app on your phone — so a leaked password alone can't open the console."
      widthClassName="max-w-md"
      footer={
        setup ? (
          <Button disabled={!ready} loading={confirm.isPending} onClick={() => confirm.mutate()}>Turn on</Button>
        ) : (
          <Button loading={start.isPending} onClick={() => start.mutate()}>Set up</Button>
        )
      }
    >
      {setup ? (
        <div className="space-y-4" data-testid="two-step-setup">
          <p className="text-sm text-fg-muted">Open Google Authenticator, Microsoft Authenticator or a password manager, add an account and scan this:</p>
          <div className="flex justify-center rounded-xl bg-white p-4">
            <QRCodeSVG value={setup.otpauthUrl} size={176} marginSize={0} aria-label="QR code for your authenticator app" />
          </div>
          <p className="text-xs text-fg-muted">
            Can&rsquo;t scan? Enter this key instead: <span className="font-mono text-fg">{groupKey(setup.secret)}</span>
          </p>
          {codeInput}
        </div>
      ) : (
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-fg-muted">
          <li>You&rsquo;ll need an authenticator app on your phone.</li>
          <li>You get 8 recovery codes for a lost phone — keep them somewhere safe.</li>
          <li>Another owner can reset it for you if you lose both.</li>
        </ul>
      )}
    </Modal>
  );
}
