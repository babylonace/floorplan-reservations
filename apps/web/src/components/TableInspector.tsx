import { isOneSided, TABLE_SIDES, type TableSide } from "@floorplan-reservations/engine";
import { useId } from "react";
import type { Table } from "../api/types";
import { useI18n } from "../i18n/i18n";
import { isNewId } from "../plan/draft";
import { DEFAULT_TABLE_COLOR, TABLE_COLORS, tableColor } from "../plan/colors";
import { MAX_CM, MIN_SIZE_CM, normalizeRotation } from "../plan/geometry";
import { MetreField, NumberField } from "./ui";

/** The long sides of a table: where the chairs go when its seats are all around. */
function longSides(table: Table): TableSide[] {
  return table.width >= table.height ? ["top", "bottom"] : ["left", "right"];
}

/** Every detail of the selected table, as form fields. Changes go into the draft at once. */
export function TableInspector({
  table,
  editable,
  problems,
  onChange,
  onRemove,
}: {
  table: Table;
  editable: boolean;
  problems: string[];
  onChange: (patch: Partial<Table>) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const ids = useId();
  const color = tableColor(table.style);
  const labelMissing = !table.label.trim();

  return (
    <section className="panel-section" aria-labelledby={`${ids}-title`}>
      <div className="panel-heading">
        <h2 id={`${ids}-title`}>{t.tables.panelTitle(table.label.trim() || "…")}</h2>
        {isNewId(table.id) && <span className="badge">{t.tables.newBadge}</span>}
      </div>

      {problems.length > 0 && (
        <ul className="problem-list" aria-label={t.issues.title}>
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}

      <fieldset disabled={!editable} className="inspector">
        <div className="field">
          <label htmlFor={`${ids}-label`}>{t.tables.label}</label>
          <input
            id={`${ids}-label`}
            type="text"
            maxLength={20}
            value={table.label}
            aria-invalid={labelMissing || undefined}
            aria-describedby={labelMissing ? `${ids}-label-error` : undefined}
            onChange={(event) => {
              onChange({ label: event.target.value });
            }}
          />
          {labelMissing && (
            <p id={`${ids}-label-error`} className="field-error">
              {t.tables.labelRequired}
            </p>
          )}
        </div>

        <fieldset className="field">
          <legend>{t.tables.shape}</legend>
          <div className="segmented">
            {(["rect", "round"] as const).map((shape) => (
              <label key={shape}>
                <input
                  type="radio"
                  name={`${ids}-shape`}
                  value={shape}
                  checked={table.shape === shape}
                  onChange={() => {
                    onChange({ shape });
                  }}
                />
                <span>{shape === "rect" ? t.tables.rect : t.tables.round}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {table.shape === "rect" && (
          <fieldset className="field">
            <legend>{t.tables.seats}</legend>
            <div className="segmented">
              {(["around", "sides"] as const).map((mode) => (
                <label key={mode}>
                  <input
                    type="radio"
                    name={`${ids}-seats`}
                    value={mode}
                    checked={(table.seatSides === null) === (mode === "around")}
                    onChange={() => {
                      onChange({ seatSides: mode === "around" ? null : longSides(table) });
                    }}
                  />
                  <span>{mode === "around" ? t.tables.seatsAround : t.tables.seatsSides}</span>
                </label>
              ))}
            </div>
            {table.seatSides && (
              <fieldset className="side-picker" aria-describedby={`${ids}-sides-hint`}>
                <legend className="visually-hidden">{t.tables.sidesLegend}</legend>
                <span className="side-picker-table" aria-hidden="true" />
                {TABLE_SIDES.map((side) => {
                  const on = table.seatSides?.includes(side) ?? false;
                  return (
                    <label key={side} className={`side-pick side-pick-${side}`}>
                      <input
                        type="checkbox"
                        checked={on}
                        // At least one side keeps its seats; "All around" is the other choice.
                        disabled={on && table.seatSides?.length === 1}
                        onChange={(event) => {
                          const chosen = new Set(table.seatSides);
                          if (event.target.checked) chosen.add(side);
                          else chosen.delete(side);
                          onChange({ seatSides: TABLE_SIDES.filter((s) => chosen.has(s)) });
                        }}
                      />
                      <span>{t.tables.sides[side]}</span>
                    </label>
                  );
                })}
              </fieldset>
            )}
            {table.seatSides && (
              <p id={`${ids}-sides-hint`} className="field-hint">
                {isOneSided(table) ? t.tables.barHint : t.tables.sidesHint}
              </p>
            )}
          </fieldset>
        )}

        <div className="field-row">
          <NumberField
            label={t.tables.minSeats}
            value={table.minSeats}
            min={1}
            max={100}
            disabled={!editable}
            onChange={(minSeats) => {
              onChange({ minSeats });
            }}
          />
          <NumberField
            label={t.tables.maxSeats}
            value={table.maxSeats}
            min={1}
            max={100}
            disabled={!editable}
            onChange={(maxSeats) => {
              onChange({ maxSeats });
            }}
          />
        </div>

        <div className="field-row">
          <MetreField
            label={t.tables.width}
            value={table.width}
            min={MIN_SIZE_CM}
            max={MAX_CM}
            disabled={!editable}
            onChange={(width) => {
              onChange({ width });
            }}
          />
          <MetreField
            label={t.tables.height}
            value={table.height}
            min={MIN_SIZE_CM}
            max={MAX_CM}
            disabled={!editable}
            onChange={(height) => {
              onChange({ height });
            }}
          />
        </div>

        <fieldset className="field">
          <legend>{t.tables.position}</legend>
          <div className="field-row">
            <MetreField
              label={t.tables.x}
              value={table.x}
              min={-MAX_CM}
              max={MAX_CM}
              disabled={!editable}
              onChange={(x) => {
                onChange({ x });
              }}
            />
            <MetreField
              label={t.tables.y}
              value={table.y}
              min={-MAX_CM}
              max={MAX_CM}
              disabled={!editable}
              onChange={(y) => {
                onChange({ y });
              }}
            />
          </div>
        </fieldset>

        <NumberField
          label={t.tables.rotation}
          value={table.rotation}
          min={0}
          max={359}
          step={15}
          disabled={!editable}
          onChange={(rotation) => {
            onChange({ rotation: normalizeRotation(rotation) });
          }}
        />

        <fieldset className="field">
          <legend>{t.tables.color}</legend>
          <div className="swatches">
            {TABLE_COLORS.map((option) => (
              <label key={option.id} className="swatch">
                <input
                  type="radio"
                  name={`${ids}-color`}
                  value={option.hex}
                  checked={color === option.hex}
                  onChange={() => {
                    const style = { ...table.style };
                    if (option.hex === DEFAULT_TABLE_COLOR) delete style.color;
                    else style.color = option.hex;
                    onChange({ style });
                  }}
                />
                <span
                  className="swatch-chip"
                  style={{ background: option.hex }}
                  aria-hidden="true"
                />
                <span className="swatch-name">{t.tables.colors[option.id]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="field field-check">
          <input
            id={`${ids}-bookable`}
            type="checkbox"
            checked={table.bookable}
            aria-describedby={`${ids}-bookable-hint`}
            onChange={(event) => {
              onChange({ bookable: event.target.checked });
            }}
          />
          <label htmlFor={`${ids}-bookable`}>{t.tables.bookable}</label>
          <p id={`${ids}-bookable-hint`} className="field-hint">
            {t.tables.bookableHint}
          </p>
        </div>

        <button type="button" className="button button-danger-quiet" onClick={onRemove}>
          {t.tables.remove}
        </button>
      </fieldset>
    </section>
  );
}
