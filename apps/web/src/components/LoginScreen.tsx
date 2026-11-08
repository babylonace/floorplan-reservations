import { useId, useState, type ReactNode, type SubmitEvent } from "react";
import { ApiError } from "../api/client";
import { useApi } from "../api/context";
import type { Account } from "../api/types";
import { useI18n } from "../i18n/i18n";
import { LanguageSwitch } from "./ui";

export function LoginScreen({
  notice,
  onSignedIn,
}: {
  notice?: string | undefined;
  onSignedIn: (account: Account) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="login">
      <div className="login-art" aria-hidden="true">
        <LoginDrawing />
      </div>
      <main className="login-panel">
        <div className="login-top">
          <LanguageSwitch />
        </div>
        <SignInForm
          className="login-form"
          title={<h1>{t.login.title}</h1>}
          intro={t.login.intro}
          notice={notice}
          onSignedIn={onSignedIn}
        />
      </main>
    </div>
  );
}

/**
 * E-mail and password. Used on the sign-in page, and in a dialog over the editor when a session
 * ends, so unsaved changes survive signing in again.
 */
export function SignInForm({
  className,
  title,
  intro,
  notice,
  onSignedIn,
}: {
  className?: string;
  title?: ReactNode;
  intro?: string;
  notice?: string | undefined;
  onSignedIn: (account: Account) => void;
}) {
  const { t } = useI18n();
  const client = useApi();
  const ids = useId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await client.login(email.trim(), password));
    } catch (thrown) {
      const status = thrown instanceof ApiError ? thrown.status : 0;
      setError(
        status === 401
          ? t.login.wrong
          : status === 429
            ? t.login.locked
            : status === 503
              ? t.errors.busy
              : status === 0
                ? t.errors.network
                : t.errors.server,
      );
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={className} onSubmit={(event) => void submit(event)} noValidate>
      {title}
      {intro && <p className="login-intro">{intro}</p>}
      {notice && !error && (
        <p className="inline-notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="inline-error" role="alert" id={`${ids}-error`}>
          {error}
        </p>
      )}
      <div className="field">
        <label htmlFor={`${ids}-email`}>{t.login.email}</label>
        <input
          id={`${ids}-email`}
          data-autofocus
          type="email"
          autoComplete="username"
          required
          value={email}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${ids}-error` : undefined}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
      </div>
      <div className="field">
        <label htmlFor={`${ids}-password`}>{t.login.password}</label>
        <input
          id={`${ids}-password`}
          type="password"
          autoComplete="current-password"
          required
          value={password}
          aria-invalid={error ? true : undefined}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
        />
      </div>
      <button
        type="submit"
        className="button button-primary button-wide"
        disabled={busy || !email.trim() || !password}
      >
        {busy ? t.login.submitting : t.login.submit}
      </button>
    </form>
  );
}

/** A small floor plan drawn on the cutting mat: the one picture in the app. */
function LoginDrawing() {
  return (
    <svg viewBox="0 0 400 300" className="login-drawing" focusable="false">
      <rect x="28" y="28" width="344" height="244" className="ld-shadow" />
      <rect x="22" y="22" width="344" height="244" className="ld-floor" />
      <rect x="22" y="22" width="344" height="244" className="ld-walls" />
      <g className="ld-table ld-oak">
        <rect x="52" y="52" width="58" height="40" rx="4" />
        <rect x="124" y="52" width="58" height="40" rx="4" />
      </g>
      <g className="ld-table ld-walnut">
        <rect x="236" y="150" width="96" height="48" rx="4" transform="rotate(90 284 174)" />
      </g>
      <g className="ld-table ld-linen">
        <circle cx="170" cy="190" r="32" />
        <circle cx="80" cy="200" r="24" />
      </g>
      <g className="ld-hatch">
        <rect x="236" y="48" width="70" height="44" rx="4" />
        <rect x="282" y="70" width="60" height="40" rx="4" />
      </g>
      <path d="M22 286 H366 M22 280 v12 M366 280 v12" className="ld-dimension" />
    </svg>
  );
}
