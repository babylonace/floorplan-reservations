import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { LOCALE_NAMES, LOCALES, useI18n } from "../i18n/i18n";

/** Small building blocks shared by the screens. */

export interface NoticeMessage {
  tone: "error" | "success";
  text: string;
  details?: string[];
}

/** A message above the plan. Errors are announced at once; good news waits its turn. */
export function Notice({ notice, onClose }: { notice: NoticeMessage; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <div
      className={`notice notice-${notice.tone}`}
      role={notice.tone === "error" ? "alert" : "status"}
    >
      <div className="notice-body">
        <p>{notice.text}</p>
        {notice.details && notice.details.length > 0 && (
          <ul>
            {notice.details.map((detail, index) => (
              <li key={index}>{detail}</li>
            ))}
          </ul>
        )}
      </div>
      <button type="button" className="icon-button" onClick={onClose} aria-label={t.errors.dismiss}>
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </button>
    </div>
  );
}

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * A dialog that keeps the keyboard inside it while open, closes with Escape and gives focus
 * back to whatever opened it.
 */
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first =
      box.current?.querySelector<HTMLElement>("[data-autofocus]") ??
      box.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => {
      if (opener?.isConnected && !opener.matches(":disabled")) opener.focus();
      else document.querySelector<HTMLElement>("main")?.focus();
    };
  }, []);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !box.current) return;
    const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="modal-backdrop">
      <div
        ref={box}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** Asks before something that cannot be undone. */
export function ConfirmDialog({
  title,
  body,
  confirm,
  cancel,
  danger = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirm: string;
  cancel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p>{body}</p>
      <div className="modal-actions">
        <button type="button" className="button" onClick={onCancel} data-autofocus>
          {cancel}
        </button>
        <button
          type="button"
          className={danger ? "button button-danger" : "button button-primary"}
          onClick={onConfirm}
        >
          {confirm}
        </button>
      </div>
    </Modal>
  );
}

/**
 * A whole-number field. What is typed shows as typed; the value only changes once it is a whole
 * number within the limits, and leaving the field puts back the last good value.
 */
export function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  disabled = false,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  hint?: string;
  onChange: (value: number) => void;
}) {
  const id = useId();
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  const shown = focused ? text : String(value);

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={step}
        value={shown}
        disabled={disabled}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onFocus={() => {
          setText(String(value));
          setFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
        }}
        onChange={(event) => {
          setText(event.target.value);
          const next = Number(event.target.value);
          if (
            event.target.value.trim() !== "" &&
            Number.isInteger(next) &&
            next >= min &&
            next <= max
          ) {
            onChange(next);
          }
        }}
      />
      {hint && (
        <p id={`${id}-hint`} className="field-hint">
          {hint}
        </p>
      )}
    </div>
  );
}

export function LanguageSwitch() {
  const { t, locale, setLocale } = useI18n();
  return (
    <div className="language-switch" role="group" aria-label={t.language.label}>
      {LOCALES.map((code) => (
        <button
          key={code}
          type="button"
          lang={code}
          aria-pressed={code === locale}
          onClick={() => {
            setLocale(code);
          }}
        >
          {LOCALE_NAMES[code]}
        </button>
      ))}
    </div>
  );
}
