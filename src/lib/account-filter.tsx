import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

const STORAGE_KEY = "selectedAccount";

type AccountFilterContextType = {
  account: string | null; // null = all accounts
  setAccount: (a: string | null) => void;
};

const AccountFilterContext = createContext<AccountFilterContextType>({
  account: null,
  setAccount: () => {},
});

export function AccountFilterProvider({ children }: { children: ReactNode }) {
  const [account, setAccountState] = useState<string | null>(() => {
    try { return localStorage.getItem(STORAGE_KEY) ?? null; } catch { return null; }
  });

  function setAccount(a: string | null) {
    setAccountState(a);
    try {
      if (a) localStorage.setItem(STORAGE_KEY, a);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }

  return (
    <AccountFilterContext.Provider value={{ account, setAccount }}>
      {children}
    </AccountFilterContext.Provider>
  );
}

export function useAccountFilter() {
  return useContext(AccountFilterContext);
}

