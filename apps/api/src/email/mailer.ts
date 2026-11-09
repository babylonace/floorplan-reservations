import nodemailer from "nodemailer";

/** Something that sends one e-mail, or says why it could not. */
export interface Mailer {
  /** "smtp" really sends; "log" only writes to the log (no SMTP server configured). */
  readonly kind: "smtp" | "log";
  send(message: { to: string; subject: string; text: string }): Promise<void>;
}

export interface SmtpSettings {
  host: string;
  port: number;
  /** true for a connection that is encrypted from the start (usually port 465). */
  secure: boolean;
  user: string | undefined;
  password: string | undefined;
  /** The sender, such as "Sample Bistro <bookings@example.com>". */
  from: string;
}

/**
 * An address shortened for the log, so the log never holds a guest's full address:
 * "maria.lopez@example.com" becomes "m***@example.com".
 */
export function maskEmail(address: string): string {
  const at = address.lastIndexOf("@");
  if (at <= 0) return "***";
  return `${address.slice(0, 1)}***${address.slice(at)}`;
}

interface Log {
  info: (details: object, message: string) => void;
}

/** Without an SMTP server (on a laptop, in CI) messages are only written to the log. */
export function logMailer(log: Log): Mailer {
  return {
    kind: "log",
    send: (message) => {
      // The address is masked and the text, which holds the guest's details, is left out.
      log.info(
        { to: maskEmail(message.to), subject: message.subject },
        "E-mail not sent: no SMTP server is configured",
      );
      return Promise.resolve();
    },
  };
}

export function smtpMailer(settings: SmtpSettings): Mailer {
  const transport = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    // With a password on a connection that starts plain, insist on STARTTLS: never send the
    // password, or guests' details, unencrypted.
    requireTLS: !settings.secure && settings.user !== undefined,
    // Short waits, so a mail server that hangs only delays the next try.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    ...(settings.user === undefined
      ? {}
      : { auth: { user: settings.user, pass: settings.password ?? "" } }),
  });
  return {
    kind: "smtp",
    send: async (message) => {
      await transport.sendMail({ from: settings.from, ...message });
    },
  };
}
