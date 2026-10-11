"use client";

import { createContext, useContext, type ReactNode } from "react";
import { AccountPrefetch } from "./account-prefetch";

interface AccountShellValue {
  /** The store's name from site settings — shown on the member card, never hard-coded (each brand has its own). */
  storeName: string;
}

const AccountShellContext = createContext<AccountShellValue>({ storeName: "" });

export function AccountShellProvider({ storeName, children }: AccountShellValue & { children: ReactNode }) {
  return (
    <AccountShellContext.Provider value={{ storeName }}>
      <AccountPrefetch />
      {children}
    </AccountShellContext.Provider>
  );
}

export function useAccountShell() {
  return useContext(AccountShellContext);
}
