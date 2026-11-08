import type { PlanIssue } from "@floorplan-reservations/engine";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { useApi } from "../api/context";
import type { FloorPlan, PlanZone, Table, ZoneFields } from "../api/types";
import { describeError, describeIssue, isSignedOut } from "../errors";
import { useI18n } from "../i18n/i18n";
import {
  addTable,
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
import { findFreeSpot, nextLabel } from "../plan/geometry";
import { saveChanges } from "../plan/save";
import { PlanCanvas } from "./PlanCanvas";
import { TableInspector } from "./TableInspector";
import { ConfirmDialog, Notice, type NoticeMessage } from "./ui";
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

const NEW_TABLE = {
  rect: { width: 120, height: 80, minSeats: 2, maxSeats: 4 },
  round: { width: 90, height: 90, minSeats: 2, maxSeats: 4 },
} as const;

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
  const [notice, setNotice] = useState<NoticeMessage | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [confirming, setConfirming] = useState<"discard" | "deleteZone" | null>(null);
  const tableElements = useRef(new Map<string, SVGGElement>());
  /** A table to give keyboard focus to once it is on screen, such as one just added. */
  const focusNext = useRef<string | null>(null);

  const changes = useMemo(() => pendingChanges(draft), [draft]);
  const issues = useMemo(() => draftIssues(draft, zone), [draft, zone]);
  const canEdit = editable && !busy;
  const selected = draft.tables.find((table) => table.id === selectedId) ?? null;

  useEffect(() => {
    onDirtyChange(changes.length);
  }, [changes.length, onDirtyChange]);

  // Keyboard focus follows tables that were just added, so arrows move them straight away.
  useEffect(() => {
    const id = focusNext.current;
    if (!id) return;
    focusNext.current = null;
    tableElements.current.get(id)?.focus();
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

  function add(shape: "rect" | "round") {
    const size = NEW_TABLE[shape];
    const spot = findFreeSpot(zone, [...draft.tables], size.width, size.height);
    const table: Table = {
      id: newTableId(),
      zoneId: zone.id,
      label: nextLabel([...draft.tables, ...draft.saved.values()]),
      shape,
      ...size,
      ...spot,
      rotation: 0,
      style: {},
      bookable: true,
    };
    setDraft((current) => addTable(current, table));
    setSelectedId(table.id);
    focusNext.current = table.id;
    setAnnouncement(t.announce.added(table.label));
  }

  function change(id: string, patch: Partial<Table>) {
    setDraft((current) => updateTable(current, id, patch));
  }

  function remove(id: string) {
    const label = labelOf(id);
    setDraft((current) => removeTable(current, id));
    setSelectedId(null);
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
    const fresh = plan?.zones.find((candidate) => candidate.id === zone.id);
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
                <rect x="3" y="5" width="14" height="10" rx="1.5" />
              </svg>
              {t.tables.addRect}
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
                <circle cx="10" cy="10" r="7" />
              </svg>
              {t.tables.addRound}
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
                {changes.length > 0 ? t.save.unsaved(changes.length) : t.save.allSaved}
              </span>
              <button
                type="button"
                className="button"
                disabled={!canEdit || changes.length === 0}
                onClick={() => {
                  setConfirming("discard");
                }}
              >
                {t.save.discard}
              </button>
              <button
                type="button"
                className="button button-primary"
                disabled={!canEdit || changes.length === 0}
                onClick={() => void save()}
              >
                {busy ? t.save.saving : t.save.save}
              </button>
            </>
          )}
        </div>
      </div>

      {notice && (
        <Notice
          notice={notice}
          onClose={() => {
            setNotice(null);
          }}
        />
      )}

      <div className="editor-body">
        <div className="canvas-wrap">
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

          <section className="panel-section" aria-labelledby="issues-title">
            <h2 id="issues-title">{t.issues.title}</h2>
            {issues.length === 0 ? (
              <p className="panel-hint">{t.issues.none}</p>
            ) : (
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
            )}
          </section>

          <details className="panel-section shortcuts">
            <summary>{t.plan.shortcutsTitle}</summary>
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
          </details>
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
