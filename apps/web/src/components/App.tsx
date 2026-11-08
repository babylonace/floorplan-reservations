import { useCallback, useEffect, useState } from "react";
import { useApi } from "../api/context";
import type { Account } from "../api/types";
import { isSignedOut } from "../errors";
import { useI18n } from "../i18n/i18n";
import { LoginScreen } from "./LoginScreen";
import { Workspace } from "./Workspace";

type Session =
  | { state: "checking" }
  | { state: "signedOut"; reason?: "expired" | "unreachable" }
  | { state: "signedIn"; account: Account };

export function App() {
  const { t } = useI18n();
  const client = useApi();
  const [session, setSession] = useState<Session>({ state: "checking" });

  useEffect(() => {
    let current = true;
    client.me().then(
      (account) => {
        if (current) setSession({ state: "signedIn", account });
      },
      (error: unknown) => {
        if (current) {
          setSession(
            isSignedOut(error)
              ? { state: "signedOut" }
              : { state: "signedOut", reason: "unreachable" },
          );
        }
      },
    );
    return () => {
      current = false;
    };
  }, [client]);

  const onSessionLost = useCallback(() => {
    setSession({ state: "signedOut", reason: "expired" });
  }, []);

  if (session.state === "checking") {
    return (
      <p className="splash" role="status">
        {t.app.loading}
      </p>
    );
  }
  if (session.state === "signedOut") {
    return (
      <LoginScreen
        notice={
          session.reason === "expired"
            ? t.login.sessionEnded
            : session.reason === "unreachable"
              ? t.errors.network
              : undefined
        }
        onSignedIn={(account) => {
          setSession({ state: "signedIn", account });
        }}
      />
    );
  }
  return (
    <Workspace
      account={session.account}
      onSignedOut={() => {
        setSession({ state: "signedOut" });
      }}
      onSessionLost={onSessionLost}
    />
  );
}
