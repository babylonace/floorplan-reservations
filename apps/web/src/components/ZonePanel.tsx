import { useId, useState, type SubmitEvent } from "react";
import type { Zone, ZoneFields } from "../api/types";
import { useI18n } from "../i18n/i18n";
import { MAX_CM } from "../plan/geometry";
import { MetreField } from "./ui";

/** A zone's name and size. Shared by the new-zone dialog and the panel of the zone on screen. */
function ZoneFieldInputs({
  fields,
  disabled = false,
  autofocus = false,
  onChange,
}: {
  fields: ZoneFields;
  disabled?: boolean;
  autofocus?: boolean;
  onChange: (fields: ZoneFields) => void;
}) {
  const { t } = useI18n();
  const ids = useId();
  return (
    <>
      <div className="field">
        <label htmlFor={`${ids}-name`}>{t.zones.name}</label>
        <input
          id={`${ids}-name`}
          type="text"
          maxLength={60}
          required
          data-autofocus={autofocus || undefined}
          disabled={disabled}
          value={fields.name}
          onChange={(event) => {
            onChange({ ...fields, name: event.target.value });
          }}
        />
      </div>
      <div className="field-row">
        <MetreField
          label={t.zones.width}
          hint={t.zones.sizeHint}
          step={10}
          value={fields.width}
          min={1}
          max={MAX_CM}
          disabled={disabled}
          onChange={(width) => {
            onChange({ ...fields, width });
          }}
        />
        <MetreField
          label={t.zones.height}
          hint={t.zones.sizeHint}
          step={10}
          value={fields.height}
          min={1}
          max={MAX_CM}
          disabled={disabled}
          onChange={(height) => {
            onChange({ ...fields, height });
          }}
        />
      </div>
    </>
  );
}

/** The fields of a new zone, in the dialog that creates it. */
export function ZoneForm({
  initial,
  submitLabel,
  busyLabel,
  busy,
  onSubmit,
  onCancel,
  cancelLabel,
}: {
  initial: ZoneFields;
  submitLabel: string;
  busyLabel: string;
  busy: boolean;
  onSubmit: (fields: ZoneFields) => void;
  onCancel: () => void;
  cancelLabel: string;
}) {
  const [fields, setFields] = useState(initial);
  const nameMissing = !fields.name.trim();

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (nameMissing) return;
    onSubmit({ ...fields, name: fields.name.trim() });
  }

  return (
    <form onSubmit={submit} className="zone-form">
      <ZoneFieldInputs fields={fields} autofocus onChange={setFields} />
      <div className="modal-actions">
        <button type="button" className="button" onClick={onCancel}>
          {cancelLabel}
        </button>
        <button type="submit" className="button button-primary" disabled={busy || nameMissing}>
          {busy ? busyLabel : submitLabel}
        </button>
      </div>
    </form>
  );
}

/**
 * The zone on screen: its size and name. Changes wait for the editor's Save, with the tables.
 * Enter in a field saves too.
 */
export function ZonePanel({
  zone,
  fields,
  tableCount,
  editable,
  disabled,
  onChange,
  onSubmit,
}: {
  zone: Zone;
  fields: ZoneFields;
  tableCount: number;
  editable: boolean;
  disabled: boolean;
  onChange: (fields: ZoneFields) => void;
  onSubmit: () => void;
}) {
  const { t, format } = useI18n();
  const ids = useId();
  return (
    <section className="panel-section" aria-labelledby={`${ids}-title`}>
      <div className="panel-heading">
        <h2 id={`${ids}-title`}>{t.zones.panelTitle}</h2>
        <span className="panel-meta">
          {!editable && (
            <span>
              {format.meters(zone.width)} × {format.meters(zone.height)}
            </span>
          )}
          <span>{t.zones.tablesCount(tableCount)}</span>
        </span>
      </div>
      {editable && (
        <form
          className="zone-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <ZoneFieldInputs fields={fields} disabled={disabled} onChange={onChange} />
          {/* Enter in a field submits the form; the visible Save is below the panel. */}
          <button type="submit" hidden disabled={disabled} />
        </form>
      )}
    </section>
  );
}
