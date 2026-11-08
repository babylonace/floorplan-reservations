import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useApi } from "../api/context";
import type { Account, FloorPlan, ZoneFields } from "../api/types";
import { describeError, isSignedOut } from "../errors";
import { useI18n } from "../i18n/i18n";
import { Editor } from "./Editor";
import { ConfirmDialog, LanguageSwitch, Modal, Notice, type NoticeMessage } from "./ui";
import { ZoneForm } from "./ZonePanel";

/** Signed in: pick a venue and a zone, then edit it. */
export function Workspace({
  account,
  onSignedOut,
  onSessionLost,
}: {
  account: Account;
  onSignedOut: () => void;
  onSessionLost: () => void;
}) {
  const { t } = useI18n();
  const client = useApi();
  const ids = useId();
  const [slug, setSlug] = useState<string | null>(account.venues[0]?.slug ?? null);
  const [plan, setPlan] = useState<FloorPlan | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(0);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [creatingZone, setCreatingZone] = useState(false);
  const [zoneError, setZoneError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<NoticeMessage | null>(null);

  const venue = account.venues.find((candidate) => candidate.slug === slug) ?? null;
  const editable = venue?.role === "owner";
  const zones = plan?.venue.slug === slug ? plan.zones : [];
  const zone = zones.find((candidate) => candidate.id === zoneId) ?? zones[0] ?? null;

  // The venue on screen, for answers that arrive after the person switched to another one.
  const shownSlug = useRef(slug);
  useEffect(() => {
    shownSlug.current = slug;
  }, [slug]);

  const load = useCallback(
    async (target: string): Promise<FloorPlan | null> => {
      try {
        const next = await client.floorPlan(target);
        if (shownSlug.current !== target) return null;
        setPlan(next);
        setLoadError(null);
        return next;
      } catch (error) {
        if (isSignedOut(error)) onSessionLost();
        else setLoadError(error);
        return null;
      }
    },
    [client, onSessionLost],
  );

  useEffect(() => {
    if (!slug) return;
    let current = true;
    client.floorPlan(slug).then(
      (next) => {
        if (!current) return;
        setPlan(next);
        setLoadError(null);
      },
      (error: unknown) => {
        if (!current) return;
        if (isSignedOut(error)) onSessionLost();
        else setLoadError(error);
      },
    );
    return () => {
      current = false;
    };
  }, [slug, client, onSessionLost]);

  // The browser asks before the tab is closed with changes that are not saved.
  useEffect(() => {
    if (dirty === 0) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
    };
  }, [dirty]);

  /** Runs `action` at once, or after the person agrees to lose unsaved changes. */
  function guarded(action: () => void) {
    if (dirty > 0) setPendingAction(() => action);
    else action();
  }

  async function signOut() {
    try {
      await client.logout();
      onSignedOut();
    } catch (error) {
      if (isSignedOut(error)) onSignedOut();
      else setNotice({ tone: "error", text: describeError(t, error, "load") });
    }
  }

  async function createZone(fields: ZoneFields) {
    if (!slug) return;
    setBusy(true);
    setZoneError(null);
    try {
      const created = await client.createZone(slug, fields);
      await load(slug);
      setZoneId(created.id);
      setDirty(0);
      setCreatingZone(false);
      setNotice({ tone: "success", text: t.zones.created(created.name) });
    } catch (error) {
      if (isSignedOut(error)) onSessionLost();
      else setZoneError(describeError(t, error, "zone"));
    } finally {
      setBusy(false);
    }
  }

  const reload = useCallback(() => (slug ? load(slug) : Promise.resolve(null)), [slug, load]);

  return (
    <div className="workspace">
      <header className="app-header">
        <div className="brand">
          <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false" className="brand-mark">
            <rect x="3" y="3" width="26" height="26" rx="3" className="bm-floor" />
            <circle cx="11" cy="11" r="4" className="bm-oak" />
            <rect x="16" y="16" width="9" height="9" rx="1.5" className="bm-walnut" />
          </svg>
          <span className="brand-name">{t.app.name}</span>
        </div>

        {account.venues.length > 1 ? (
          <div className="venue-picker">
            <label htmlFor={`${ids}-venue`}>{t.header.venue}</label>
            <select
              id={`${ids}-venue`}
              value={slug ?? ""}
              onChange={(event) => {
                const next = event.target.value;
                guarded(() => {
                  setDirty(0);
                  setPlan(null);
                  setZoneId(null);
                  setSlug(next);
                });
              }}
            >
              {account.venues.map((option) => (
                <option key={option.slug} value={option.slug}>
                  {option.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          venue && <span className="venue-name">{venue.name}</span>
        )}

        <div className="header-end">
          <LanguageSwitch />
          <span className="account" title={t.header.signedInAs(account.email)}>
            {account.email}
          </span>
          <button
            type="button"
            className="button button-quiet"
            onClick={() => {
              guarded(() => void signOut());
            }}
          >
            {t.header.signOut}
          </button>
        </div>
      </header>

      {!venue ? (
        <main className="empty-state">
          <p>{t.venues.none}</p>
        </main>
      ) : (
        <main className="workspace-main" id="main" tabIndex={-1}>
          <nav className="zone-bar" aria-label={t.zones.listLabel}>
            <ul>
              {zones.map((candidate) => (
                <li key={candidate.id}>
                  <button
                    type="button"
                    className="zone-tab"
                    aria-current={candidate.id === zone?.id ? "true" : undefined}
                    onClick={() => {
                      if (candidate.id === zone?.id) return;
                      guarded(() => {
                        setDirty(0);
                        setZoneId(candidate.id);
                      });
                    }}
                  >
                    {candidate.name}
                  </button>
                </li>
              ))}
            </ul>
            {editable && (
              <button
                type="button"
                className="button button-quiet zone-add"
                onClick={() => {
                  guarded(() => {
                    setZoneError(null);
                    setCreatingZone(true);
                  });
                }}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                  <path d="M8 3v10M3 8h10" />
                </svg>
                {t.zones.add}
              </button>
            )}
          </nav>

          {!editable && (
            <p className="read-only-note" role="note">
              {t.venues.readOnly}
            </p>
          )}

          {notice && (
            <Notice
              notice={notice}
              onClose={() => {
                setNotice(null);
              }}
            />
          )}

          {loadError !== null && !plan ? (
            <div className="empty-state" role="alert">
              <p>
                {t.venues.loadFailed} {describeError(t, loadError, "load")}
              </p>
              <button
                type="button"
                className="button"
                onClick={() => {
                  if (slug) void load(slug);
                }}
              >
                {t.venues.retry}
              </button>
            </div>
          ) : !plan || plan.venue.slug !== slug ? (
            <p className="empty-state" role="status">
              {t.venues.loadingPlan}
            </p>
          ) : zone ? (
            <Editor
              key={`${plan.venue.slug}:${zone.id}`}
              slug={plan.venue.slug}
              zone={zone}
              editable={editable}
              reload={reload}
              onDirtyChange={setDirty}
              onSessionLost={onSessionLost}
              onZoneDeleted={(name) => {
                setDirty(0);
                setZoneId(null);
                setNotice({ tone: "success", text: t.zones.removed(name) });
                void reload();
              }}
            />
          ) : (
            <div className="empty-state">
              <p>{editable ? t.zones.none : t.zones.noneReadOnly}</p>
            </div>
          )}
        </main>
      )}

      {creatingZone && (
        <Modal
          title={t.zones.newTitle}
          onClose={() => {
            setCreatingZone(false);
          }}
        >
          {zoneError && (
            <p className="inline-error" role="alert">
              {zoneError}
            </p>
          )}
          <ZoneForm
            initial={{
              name: "",
              width: 1000,
              height: 800,
              sortOrder: Math.max(-1, ...zones.map((candidate) => candidate.sortOrder)) + 1,
            }}
            submitLabel={t.zones.create}
            busyLabel={t.zones.creating}
            busy={busy}
            onSubmit={(fields) => void createZone(fields)}
            onCancel={() => {
              setCreatingZone(false);
            }}
            cancelLabel={t.dialog.cancel}
          />
        </Modal>
      )}

      {pendingAction && zone && (
        <ConfirmDialog
          title={t.save.discardTitle}
          body={t.save.discardBody(dirty, zone.name)}
          confirm={t.save.confirmDiscard}
          cancel={t.save.keepEditing}
          danger
          onConfirm={() => {
            const action = pendingAction;
            setPendingAction(null);
            action();
          }}
          onCancel={() => {
            setPendingAction(null);
          }}
        />
      )}
    </div>
  );
}
