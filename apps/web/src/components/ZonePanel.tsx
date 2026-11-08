import { useId, useState, type SubmitEvent } from "react";
import type { Zone, ZoneFields } from "../api/types";
import { useI18n } from "../i18n/i18n";
import { MAX_CM } from "../plan/geometry";
import { MetreField, NumberField } from "./ui";

/** The fields of a zone. Used to create one and to change the one on screen. */
export function ZoneForm({
  initial,
  submitLabel,
  busyLabel,
  busy,
  disabled = false,
  onSubmit,
  onCancel,
  cancelLabel,
}: {
  initial: ZoneFields;
  submitLabel: string;
  busyLabel: string;
  busy: boolean;
  disabled?: boolean;
  onSubmit: (fields: ZoneFields) => void;
  onCancel?: () => void;
  cancelLabel?: string;
}) {
  const { t } = useI18n();
  const ids = useId();
  const [fields, setFields] = useState(initial);
  const nameMissing = !fields.name.trim();
  const changed =
    fields.name.trim() !== initial.name ||
    fields.width !== initial.width ||
    fields.height !== initial.height ||
    fields.sortOrder !== initial.sortOrder;

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (nameMissing) return;
    onSubmit({ ...fields, name: fields.name.trim() });
  }

  return (
    <form onSubmit={submit} className="zone-form">
      <fieldset disabled={disabled}>
        <div className="field">
          <label htmlFor={`${ids}-name`}>{t.zones.name}</label>
          <input
            id={`${ids}-name`}
            type="text"
            maxLength={60}
            required
            data-autofocus
            value={fields.name}
            onChange={(event) => {
              setFields({ ...fields, name: event.target.value });
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
              setFields({ ...fields, width });
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
              setFields({ ...fields, height });
            }}
          />
        </div>
        <NumberField
          label={t.zones.sortOrder}
          hint={t.zones.sortOrderHint}
          value={fields.sortOrder}
          min={-10_000}
          max={10_000}
          disabled={disabled}
          onChange={(sortOrder) => {
            setFields({ ...fields, sortOrder });
          }}
        />
        <div className="form-actions">
          {onCancel && (
            <button type="button" className="button" onClick={onCancel}>
              {cancelLabel}
            </button>
          )}
          <button
            type="submit"
            className="button button-primary"
            disabled={busy || nameMissing || (!onCancel && !changed)}
          >
            {busy ? busyLabel : submitLabel}
          </button>
        </div>
      </fieldset>
    </form>
  );
}

/** The zone on screen: its size and name, and deleting it. */
export function ZonePanel({
  zone,
  tableCount,
  editable,
  busy,
  onSave,
  onDelete,
}: {
  zone: Zone;
  tableCount: number;
  editable: boolean;
  busy: boolean;
  onSave: (fields: ZoneFields) => void;
  onDelete: () => void;
}) {
  const { t, format } = useI18n();
  const ids = useId();
  return (
    <section className="panel-section" aria-labelledby={`${ids}-title`}>
      <div className="panel-heading">
        <h2 id={`${ids}-title`}>{t.zones.panelTitle}</h2>
        <span className="panel-meta">
          <span>
            {format.meters(zone.width)} × {format.meters(zone.height)}
          </span>
          <span>{t.zones.tablesCount(tableCount)}</span>
        </span>
      </div>
      {editable && (
        <>
          <ZoneForm
            // A new form when the stored zone changes, so it starts from what was saved.
            key={`${zone.id}:${zone.name}:${String(zone.width)}:${String(zone.height)}:${String(zone.sortOrder)}`}
            initial={{
              name: zone.name,
              width: zone.width,
              height: zone.height,
              sortOrder: zone.sortOrder,
            }}
            submitLabel={t.zones.save}
            busyLabel={t.zones.saving}
            busy={busy}
            onSubmit={onSave}
          />
          <button type="button" className="button button-danger-quiet" onClick={onDelete}>
            {t.zones.remove}
          </button>
        </>
      )}
    </section>
  );
}
