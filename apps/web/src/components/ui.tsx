import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { clamp } from "../plan/geometry";
import { parseMetres } from "../plan/units";
import { LOCALE_NAMES, LOCALES, useI18n } from "../i18n/i18n";

/** Small building blocks shared by the screens. */

export interface NoticeMessage {
  tone: "error" | "success";
  text: string;
  details?: string[];
}

/** How long good news stays on screen. Errors stay until they are closed. */
export const NOTICE_SECONDS = 6;

/** Shows a message in the notice area, or clears it with null. One message at a time. */
export const NoticeContext = createContext<(notice: NoticeMessage | null) => void>(() => {
  // Without a provider (a component on its own in a test) messages go nowhere.
});

export function useNotice(): (notice: NoticeMessage | null) => void {
  return useContext(NoticeContext);
}

/**
 * The messages after an action, floating over the bottom of the window so nothing on the page
 * moves when one appears. Both live regions are always in the page, so screen readers hear what
 * is put in them: errors at once, good news when they are free. Good news closes on its own
 * after a few seconds, but not while the pointer or the keyboard is on it.
 */
export function NoticeArea({
  notice,
  onClose,
}: {
  notice: NoticeMessage | null;
  onClose: () => void;
}) {
  // A new message is a new box, even with the same words, so its timer starts again.
  const key = notice ? noticeKey(notice) : 0;
  return (
    <div className="notice-area">
      <div role="status" className="notice-slot">
        {notice?.tone === "success" && <NoticeBox key={key} notice={notice} onClose={onClose} />}
      </div>
      <div role="alert" className="notice-slot">
        {notice?.tone === "error" && <NoticeBox key={key} notice={notice} onClose={onClose} />}
      </div>
    </div>
  );
}

const noticeKeys = new WeakMap<NoticeMessage, number>();
let lastNoticeKey = 0;

function noticeKey(notice: NoticeMessage): number {
  let key = noticeKeys.get(notice);
  if (key === undefined) {
    key = ++lastNoticeKey;
    noticeKeys.set(notice, key);
  }
  return key;
}

function NoticeBox({ notice, onClose }: { notice: NoticeMessage; onClose: () => void }) {
  const { t } = useI18n();
  const [pointer, setPointer] = useState(false);
  const [focus, setFocus] = useState(false);
  /** Where the keyboard was before it came to the message, to go back there on closing. */
  const cameFrom = useRef<HTMLElement | null>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  const autoClose = notice.tone === "success" && !pointer && !focus;

  useEffect(() => {
    if (!autoClose) return;
    const timer = window.setTimeout(() => {
      close.current();
    }, NOTICE_SECONDS * 1000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [autoClose]);

  return (
    <div
      className={`notice notice-${notice.tone}`}
      onPointerEnter={() => {
        setPointer(true);
      }}
      onPointerLeave={() => {
        setPointer(false);
      }}
      onFocus={(event) => {
        setFocus(true);
        const from = event.relatedTarget;
        if (from instanceof HTMLElement && !event.currentTarget.contains(from)) {
          cameFrom.current = from;
        }
      }}
      onBlur={() => {
        setFocus(false);
      }}
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
      <button
        type="button"
        className="icon-button"
        onClick={() => {
          const back = cameFrom.current;
          onClose();
          if (back?.isConnected) back.focus();
          else document.querySelector<HTMLElement>("main")?.focus();
        }}
        aria-label={t.errors.dismiss}
      >
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
 * back to whatever opened it. Without `onClose`, Escape does nothing: the dialog only ends
 * through its own buttons.
 */
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose?: () => void;
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
      onClose?.();
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
        <p id={`${id}-hint`} className="visually-hidden">
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * A length, shown and typed in metres and kept in whole centimetres. A comma or a point both
 * work as the decimal mark. The arrow keys step it like a number field. What is typed shows as
 * typed; the value only changes once it is a length within the limits, and leaving the field
 * puts back the last good value.
 */
export function MetreField({
  label,
  value,
  min,
  max,
  step = 5,
  disabled = false,
  hint,
  onChange,
}: {
  label: string;
  /** Centimetres, like `min`, `max` and `step`. */
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  hint?: string;
  onChange: (value: number) => void;
}) {
  const { t, format } = useI18n();
  const id = useId();
  const [text, setText] = useState(() => format.metresField(value));
  const [focused, setFocused] = useState(false);
  const shown = focused ? text : format.metresField(value);
  const typed = parseMetres(shown);
  const invalid = focused && (typed === null || typed < min || typed > max);

  function commit(next: number) {
    setText(format.metresField(next));
    onChange(next);
  }

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        value={shown}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={
          [hint && `${id}-hint`, invalid && `${id}-error`].filter(Boolean).join(" ") || undefined
        }
        onFocus={() => {
          setText(format.metresField(value));
          setFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault();
          const base = typed ?? value;
          const direction = event.key === "ArrowUp" ? 1 : -1;
          const amount = event.shiftKey ? step * 10 : step;
          commit(clamp(Math.round(base / step) * step + direction * amount, min, max));
        }}
        onChange={(event) => {
          setText(event.target.value);
          const next = parseMetres(event.target.value);
          if (next !== null && next >= min && next <= max) onChange(next);
        }}
      />
      {hint && (
        <p id={`${id}-hint`} className="visually-hidden">
          {hint}
        </p>
      )}
      {invalid && (
        <p id={`${id}-error`} className="field-error">
          {t.errors.metres(format.meters(min), format.meters(max))}
        </p>
      )}
    </div>
  );
}

/**
 * A button's words, with a shorter version for narrow screens. Screen readers and voice control
 * always get the full words, which contain the short ones. Without `short`, narrow screens show
 * only the button's icon.
 */
export function ButtonLabel({ full, short }: { full: string; short?: string }) {
  return (
    <>
      <span className="label-full">{full}</span>
      {short && (
        <span className="label-short" aria-hidden="true">
          {short}
        </span>
      )}
    </>
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
