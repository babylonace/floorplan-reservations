import { isOneSided, type PlanIssue } from "@floorplan-reservations/engine";
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { ApiError } from "../api/client";
import { useApi } from "../api/context";
import type { FloorPlan, PlanZone, Table, ZoneFields } from "../api/types";
import { describeError, describeIssue, isSignedOut } from "../errors";
import { useI18n } from "../i18n/i18n";
import {
  addTable,
  assumeSaved,
  draftFromZone,
  draftIssues,
  newTableId,
  pendingChanges,
  rebase,
  removeTable,
  updateTable,
  type Change,
  type Draft,
} from "../plan/draft";
import { findFreeSpot, nextInLine, nextLabel } from "../plan/geometry";
import { saveChanges } from "../plan/save";
import { PlanCanvas } from "./PlanCanvas";
import { TableInspector } from "./TableInspector";
import { ButtonLabel, ConfirmDialog, useNotice, type NoticeMessage } from "./ui";
import { ZonePanel } from "./ZonePanel";

export interface EditorProps {
  slug: string;
  zone: PlanZone;
  editable: boolean;
  /** Loads the plan again and returns it; null when that failed (the caller says why). */
  reload: () => Promise<FloorPlan | null>;
  onDirtyChange: (changes: number) => void;
  onSessionLost: () => void;
  onZoneDeleted: (name: string) => void;
}

/** Height over width of the zone, for the plan's height on narrow screens. */
function planRatio(zone: { width: number; height: number }): number {
  const ratio = zone.height / zone.width;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 0.75;
}

/** Stands for the plan itself in `focusNext`. */
const CANVAS = "canvas";

const NEW_TABLE = {
  rect: { shape: "rect", width: 120, height: 80, minSeats: 2, maxSeats: 4, seatSides: null },
  round: { shape: "round", width: 90, height: 90, minSeats: 2, maxSeats: 4, seatSides: null },
  // A section of bar: two stools along one long side.
  bar: { shape: "rect", width: 120, height: 50, minSeats: 1, maxSeats: 2, seatSides: ["bottom"] },
} as const satisfies Record<
  string,
  Pick<Table, "shape" | "width" | "height" | "minSeats" | "maxSeats" | "seatSides">
>;

/** One zone being edited: the plan, the toolbar, and the panel beside them. */
export function Editor({
  slug,
  zone,
  editable,
  reload,
  onDirtyChange,
  onSessionLost,
  onZoneDeleted,
}: EditorProps) {
  const { t } = useI18n();
  const client = useApi();
  const [draft, setDraft] = useState<Draft>(() => draftFromZone(zone));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const showNotice = useNotice();
  // A save can finish after the person moved to another zone; its message must not show there.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const setNotice = (notice: NoticeMessage | null) => {
    if (mounted.current) showNotice(notice);
  };
  const [announcement, setAnnouncement] = useState("");
  const [confirming, setConfirming] = useState<"discard" | "deleteZone" | null>(null);
  const tableElements = useRef(new Map<string, SVGGElement>());
  /** A table to give keyboard focus to once it is on screen, such as one just added. */
  const focusNext = useRef<string | null>(null);

  const changes = useMemo(() => pendingChanges(draft), [draft]);
  const issues = useMemo(() => draftIssues(draft, zone), [draft, zone]);
  const canEdit = editable && !busy;
  const labelsMissing = draft.tables.some((table) => !table.label.trim());
  const selected = draft.tables.find((table) => table.id === selectedId) ?? null;

  useEffect(() => {
    onDirtyChange(changes.length);
  }, [changes.length, onDirtyChange]);

  // Keyboard focus follows tables that were just added, so arrows move them straight away.
  useEffect(() => {
    const id = focusNext.current;
    if (!id) return;
    focusNext.current = null;
    if (id === CANVAS) document.querySelector<SVGSVGElement>("[data-plan-canvas]")?.focus();
    else tableElements.current.get(id)?.focus();
  });

  const labelOf = (id: string) =>
    draft.tables.find((table) => table.id === id)?.label ?? draft.saved.get(id)?.label ?? id;

  function problemsOf(id: string): string[] {
    return issues
      .filter(
        (issue) => issue.tableId === id || (issue.code === "overlap" && issue.otherTableId === id),
      )
      .map((issue) => describeIssue(t, issue, labelOf));
  }

  function failWith(error: unknown, text: string, details: string[] = []) {
    if (isSignedOut(error)) {
      onSessionLost();
      return;
    }
    setNotice({ tone: "error", text, details });
  }

  function add(kind: keyof typeof NEW_TABLE) {
    const all = [...draft.tables, ...draft.saved.values()];
    // With a bar section selected, the new one carries on the bar, in line and the same size.
    const after = kind === "bar" && selected && isOneSided(selected) ? selected : null;
    const inLine = after && nextInLine(after, zone, [...draft.tables]);
    const base = after && inLine ? after : { ...NEW_TABLE[kind], rotation: 0, style: {} };
    const table: Table = {
      id: newTableId(),
      zoneId: zone.id,
      label: kind === "bar" ? nextLabel(all, t.tables.barPrefix) : nextLabel(all),
      shape: base.shape,
      width: base.width,
      height: base.height,
      minSeats: base.minSeats,
      maxSeats: base.maxSeats,
      seatSides: base.seatSides ? [...base.seatSides] : null,
      rotation: base.rotation,
      style: { ...base.style },
      // Stools stick out further than chairs, so a new bar keeps more room around it.
      ...(inLine ??
        findFreeSpot(zone, [...draft.tables], base.width, base.height, kind === "bar" ? 55 : 20)),
      bookable: true,
    };
    setDraft((current) => addTable(current, table));
    setSelectedId(table.id);
    focusNext.current = table.id;
    setAnnouncement(
      after && inLine
        ? t.announce.addedInLine(table.label, after.label)
        : t.announce.added(table.label),
    );
  }

  function change(id: string, patch: Partial<Table>) {
    setDraft((current) => updateTable(current, id, patch));
  }

  function remove(id: string) {
    const label = labelOf(id);
    // Keyboard focus moves on to the next table (or the plan), not to the top of the page.
    const index = draft.tables.findIndex((table) => table.id === id);
    const next = draft.tables[index + 1] ?? draft.tables[index - 1];
    setDraft((current) => removeTable(current, id));
    setSelectedId(next?.id ?? null);
    focusNext.current = next?.id ?? CANVAS;
    setAnnouncement(t.announce.removed(label));
  }

  /** The issues the API sent with a 422, as sentences. A table being created is called "new". */
  function issueLines(issuesFromApi: PlanIssue[], change: Change): string[] {
    return issuesFromApi.map((issue) =>
      describeIssue(t, issue, (id) => (id === "new" ? change.label : labelOf(id))),
    );
  }

  async function save() {
    setBusy(true);
    setNotice(null);
    const sent = changes;
    const result = await saveChanges(client, slug, zone.id, sent);
    const keep = new Set<string>();
    for (const failure of result.failures) {
      // A table that cannot be removed goes back on the plan; anything else waits for a fix.
      const putBack =
        failure.change.kind === "delete" && failure.error.code === "upcoming_reservations";
      if (!putBack) keep.add(failure.change.id);
    }
    for (const unsent of result.unsent) keep.add(unsent.id);

    const plan = await reload();
    const notSaved = new Set([
      ...result.failures.map((failure) => failure.change.id),
      ...result.unsent.map((change) => change.id),
    ]);
    // If the plan could not be read again, work from what the API answered, so saved changes
    // are never sent twice.
    const fresh = plan
      ? plan.zones.find((candidate) => candidate.id === zone.id)
      : assumeSaved(draft, zone, notSaved, result.created);
    if (fresh) {
      setDraft((current) => rebase(current, fresh, keep));
      setSelectedId((current) => (current ? (result.created.get(current)?.id ?? current) : null));
    }
    setBusy(false);

    if (result.failures.length === 0 && result.unsent.length === 0) {
      // The notice is a status message, so screen readers hear it without a second announcement.
      setNotice({ tone: "success", text: t.save.saved(result.saved) });
      return;
    }
    const details = result.failures.flatMap((failure) => {
      const context = failure.change.kind === "delete" ? "tableDelete" : "table";
      const line = t.save.failedFor(failure.change.label, describeError(t, failure.error, context));
      return [line, ...issueLines(failure.error.issues, failure.change)];
    });
    const failed = result.failures.length + result.unsent.length;
    const text =
      result.unsent.length > 0
        ? t.save.stopped
        : result.saved > 0
          ? t.save.partial(result.saved, failed)
          : t.save.noneSaved(failed);
    failWith(result.failures.find((failure) => isSignedOut(failure.error))?.error, text, details);
  }

  function discard() {
    setDraft(draftFromZone(zone));
    setSelectedId(null);
    setConfirming(null);
    setNotice(null);
  }

  async function saveZone(fields: ZoneFields) {
    setBusy(true);
    setNotice(null);
    try {
      const updated = await client.updateZone(slug, zone.id, fields);
      await reload();
      setNotice({ tone: "success", text: t.zones.saved(updated.name) });
    } catch (error) {
      const lines =
        error instanceof ApiError
          ? error.issues.map((issue) => describeIssue(t, issue, labelOf))
          : [];
      failWith(error, describeError(t, error, "zone"), lines);
    } finally {
      setBusy(false);
    }
  }

  async function deleteZone() {
    setConfirming(null);
    setBusy(true);
    setNotice(null);
    try {
      await client.deleteZone(slug, zone.id);
      onZoneDeleted(zone.name);
    } catch (error) {
      failWith(error, describeError(t, error, "zoneDelete"));
      setBusy(false);
    }
  }

  return (
    <div className="editor">
      <div className="toolbar" role="toolbar" aria-label={t.plan.toolbar}>
        {editable && (
          <div className="toolbar-group">
            <button
              type="button"
              className="button tool-button"
              disabled={!canEdit}
              onClick={() => {
                add("rect");
              }}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                <rect x="1.5" y="6" width="11" height="8" rx="1.5" />
                <path d="M16 6v6M13 9h6" />
              </svg>
              <ButtonLabel full={t.tables.addRect} short={t.tables.addRectShort} />
            </button>
            <button
              type="button"
              className="button tool-button"
              disabled={!canEdit}
              onClick={() => {
                add("round");
              }}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                <circle cx="7" cy="10" r="5.5" />
                <path d="M16 6v6M13 9h6" />
              </svg>
              <ButtonLabel full={t.tables.addRound} short={t.tables.addRoundShort} />
            </button>
            <button
              type="button"
              className="button tool-button"
              disabled={!canEdit}
              onClick={() => {
                add("bar");
              }}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                <rect x="1.5" y="5" width="11" height="5" rx="1" />
                <circle cx="4.5" cy="13.5" r="1.5" />
                <circle cx="9.5" cy="13.5" r="1.5" />
                <path d="M16 6v6M13 9h6" />
              </svg>
              <ButtonLabel full={t.tables.addBar} short={t.tables.addBarShort} />
            </button>
          </div>
        )}
        <div className="toolbar-group toolbar-end">
          <span
            className={issues.length > 0 ? "status-chip status-problem" : "status-chip status-ok"}
          >
            {issues.length > 0 ? t.issues.count(issues.length) : t.issues.noneShort}
          </span>
          {editable && (
            <>
              <span className="save-state" aria-live="polite">
                {labelsMissing
                  ? t.save.needsLabels
                  : changes.length > 0
                    ? t.save.unsaved(changes.length)
                    : t.save.allSaved}
              </span>
              <span className="save-actions">
                <button
                  type="button"
                  className="button"
                  disabled={!canEdit || changes.length === 0}
                  onClick={() => {
                    setConfirming("discard");
                  }}
                >
                  <ButtonLabel full={t.save.discard} short={t.save.discardShort} />
                </button>
                <button
                  type="button"
                  className="button button-primary"
                  disabled={!canEdit || changes.length === 0 || labelsMissing}
                  onClick={() => void save()}
                >
                  {busy ? (
                    t.save.saving
                  ) : (
                    <ButtonLabel full={t.save.save} short={t.save.saveShort} />
                  )}
                </button>
              </span>
            </>
          )}
        </div>
      </div>

      <div className="editor-body">
        <div
          className="canvas-wrap"
          // On narrow screens the plan is as tall as the zone's shape needs, not a fixed share.
          style={{ "--plan-ratio": String(planRatio(zone)) } as CSSProperties}
        >
          <PlanCanvas
            zone={zone}
            tables={draft.tables}
            issues={issues}
            selectedId={selectedId}
            editable={canEdit}
            onSelect={setSelectedId}
            onChange={change}
            onRemove={remove}
            onAnnounce={setAnnouncement}
            tools={<ShortcutsButton />}
            tableRef={(id, element) => {
              if (element) tableElements.current.set(id, element);
              else tableElements.current.delete(id);
            }}
          />
          {draft.tables.length === 0 && (
            <p className="canvas-empty">{editable ? t.plan.empty : t.plan.emptyReadOnly}</p>
          )}
        </div>

        <aside className="side-panel" aria-label={t.zones.panelTitle}>
          {selected ? (
            <TableInspector
              key={selected.id}
              table={selected}
              editable={canEdit}
              problems={problemsOf(selected.id)}
              onChange={(patch) => {
                change(selected.id, patch);
              }}
              onRemove={() => {
                remove(selected.id);
              }}
            />
          ) : (
            <ZonePanel
              zone={zone}
              tableCount={draft.tables.length}
              editable={editable}
              busy={busy}
              onSave={(fields) => void saveZone(fields)}
              onDelete={() => {
                setConfirming("deleteZone");
              }}
            />
          )}

          {issues.length > 0 && (
            <section className="panel-section" aria-labelledby="issues-title">
              <h2 id="issues-title">{t.issues.title}</h2>
              <ul className="issue-list">
                {issues.map((issue, index) => (
                  <li key={index}>
                    <button
                      type="button"
                      className="link-button"
                      aria-label={`${describeIssue(t, issue, labelOf)} ${t.issues.show(labelOf(issue.tableId))}`}
                      onClick={() => {
                        setSelectedId(issue.tableId);
                        tableElements.current.get(issue.tableId)?.focus();
                      }}
                    >
                      {describeIssue(t, issue, labelOf)}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>

      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>

      {confirming === "discard" && (
        <ConfirmDialog
          title={t.save.discardTitle}
          body={t.save.discardBody(changes.length, zone.name)}
          confirm={t.save.confirmDiscard}
          cancel={t.save.keepEditing}
          danger
          onConfirm={discard}
          onCancel={() => {
            setConfirming(null);
          }}
        />
      )}
      {confirming === "deleteZone" && (
        <ConfirmDialog
          title={t.zones.removeTitle(zone.name)}
          body={t.zones.removeBody}
          confirm={t.zones.remove}
          cancel={t.dialog.cancel}
          danger
          onConfirm={() => void deleteZone()}
          onCancel={() => {
            setConfirming(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * The keyboard shortcuts, behind a "?" button so they take no room until wanted. It opens on
 * a click or a tap (not on hover, which touch screens do not have) and closes with Escape, the
 * button again, or a click outside.
 */
function ShortcutsButton() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    // Both listen before anything else on the page: a table stops its own pointer events, and
    // Escape must not also let go of the selected table.
    function outside(event: globalThis.PointerEvent) {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      button.current?.focus();
    }
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);

  return (
    <div className="shortcuts" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="button shortcuts-button"
        aria-label={t.plan.shortcutsTitle}
        title={t.plan.shortcutsTitle}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setOpen(!open);
        }}
      >
        <span aria-hidden="true">?</span>
      </button>
      <div id={id} className="shortcuts-popover" hidden={!open}>
        <h2>{t.plan.shortcutsTitle}</h2>
        <dl>
          {t.plan.shortcuts.map(([keys, action]) => (
            <div key={keys}>
              <dt>
                <kbd>{keys}</kbd>
              </dt>
              <dd>{action}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
