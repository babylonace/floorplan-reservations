import { useCallback, useEffect, useState } from "react";
import { useApi } from "../api/context";
import type { Account } from "../api/types";
import { isSignedOut } from "../errors";
import { useI18n } from "../i18n/i18n";
import { LoginScreen, SignInForm } from "./LoginScreen";
import { Modal } from "./ui";
import { Workspace } from "./Workspace";

type Session =
  | { state: "checking" }
  | { state: "signedOut"; reason?: "unreachable" }
  /** `expired`: the session ended while the editor was open; it stays open behind a sign-in. */
  | { state: "signedIn"; account: Account; expired: boolean };

export function App() {
  const { t } = useI18n();
  const client = useApi();
  const [session, setSession] = useState<Session>({ state: "checking" });

  useEffect(() => {
    let current = true;
    client.me().then(
      (account) => {
        if (current) setSession({ state: "signedIn", account, expired: false });
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
    setSession((current) =>
      current.state === "signedIn" ? { ...current, expired: true } : current,
    );
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
        notice={session.reason === "unreachable" ? t.errors.network : undefined}
        onSignedIn={(account) => {
          setSession({ state: "signedIn", account, expired: false });
        }}
      />
    );
  }
  const signedIn = session;
  return (
    <>
      <div className="app-root" inert={signedIn.expired}>
        <Workspace
          // Another account starts afresh; the same one keeps whatever was not saved.
          key={signedIn.account.email}
          account={signedIn.account}
          onSignedOut={() => {
            setSession({ state: "signedOut" });
          }}
          onSessionLost={onSessionLost}
        />
      </div>
      {signedIn.expired && (
        <Modal
          title={t.login.sessionEndedTitle}
          onClose={() => {
            setSession({ state: "signedOut" });
          }}
        >
          <SignInForm
            intro={t.login.sessionEnded}
            onSignedIn={(account) => {
              setSession({ state: "signedIn", account, expired: false });
            }}
          />
        </Modal>
      )}
    </>
  );
}
