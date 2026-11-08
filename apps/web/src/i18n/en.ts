/**
 * English: the complete set of texts, and the fallback for anything another language leaves out.
 * Every text the editor shows lives in a file like this one, never in the components.
 */

export interface TableDescription {
  label: string;
  round: boolean;
  minSeats: number;
  maxSeats: number;
  x: string;
  y: string;
  rotation: number;
  bookable: boolean;
  problems: number;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const en = {
  app: {
    name: "Floor plan",
    loading: "Loading…",
  },
  language: {
    label: "Language",
  },
  login: {
    title: "Floor plan",
    intro: "Sign in with the account your venue gave you to arrange its rooms and tables.",
    email: "E-mail address",
    password: "Password",
    submit: "Sign in",
    submitting: "Signing in…",
    wrong: "That e-mail address and password do not match.",
    locked: "Too many attempts for this address. Wait 15 minutes and try again.",
    sessionEndedTitle: "Sign in again",
    sessionEnded:
      "Your session has ended. Sign in again to carry on: anything you had not saved is still on the plan.",
  },
  header: {
    venue: "Venue",
    signedInAs: (email: string) => `Signed in as ${email}`,
    signOut: "Sign out",
  },
  venues: {
    none: "Your account does not run any venue yet. Ask the venue's owner to give you access.",
    loadingPlan: "Loading the floor plan…",
    loadFailed: "The floor plan could not be loaded.",
    retry: "Try again",
    readOnly: "You can look at the floor plan. Only the venue's owner can change it.",
  },
  zones: {
    listLabel: "Zones",
    add: "New zone",
    none: "This venue has no zones yet. Create the first one, such as a dining room or a terrace, to start placing tables.",
    noneReadOnly: "This venue has no zones yet.",
    newTitle: "New zone",
    name: "Name",
    width: "Width (cm)",
    height: "Depth (cm)",
    sizeHint: "1 m is 100 cm. A room of 12 × 8 m is 1200 × 800 cm.",
    sortOrder: "Position in the list",
    sortOrderHint: "Zones with lower numbers come first.",
    create: "Create zone",
    creating: "Creating…",
    created: (name: string) => `Zone “${name}” created.`,
    panelTitle: "This zone",
    save: "Save zone",
    saving: "Saving…",
    saved: (name: string) => `Zone “${name}” saved.`,
    remove: "Delete zone",
    removeTitle: (name: string) => `Delete the zone “${name}”?`,
    removeBody:
      "Its tables go too. Tables that had bookings in the past are kept in the history. This cannot be undone.",
    removed: (name: string) => `Zone “${name}” deleted.`,
    tablesCount: (n: number) => plural(n, "1 table", `${String(n)} tables`),
  },
  tables: {
    addRect: "Add rectangular table",
    addRound: "Add round table",
    panelTitle: (label: string) => `Table ${label}`,
    label: "Name or number",
    labelRequired: "Give the table a name or number.",
    shape: "Shape",
    rect: "Rectangular",
    round: "Round",
    minSeats: "Fewest guests",
    maxSeats: "Most guests",
    width: "Width (cm)",
    height: "Depth (cm)",
    rotation: "Turn (degrees)",
    x: "From the left (cm)",
    y: "From the top (cm)",
    bookable: "Can be booked online",
    bookableHint: "When unticked, the table stays on the plan but guests cannot book it online.",
    color: "Colour",
    colors: {
      linen: "Linen",
      oak: "Oak",
      walnut: "Walnut",
      sage: "Sage",
      slate: "Slate",
    },
    remove: "Remove table",
    noSelection: "Pick a table on the plan to change it, or add a new one.",
    newBadge: "New, not saved yet",
  },
  plan: {
    label: (zone: string, width: string, depth: string) =>
      `Floor plan of ${zone}, ${width} wide and ${depth} deep`,
    help: "Tab moves from table to table. The arrow keys move the selected table by 5 cm, or 50 cm with Shift. R turns it 15 degrees, Shift+R the other way. Delete removes it. Escape lets go.",
    helpReadOnly: "Tab moves from table to table.",
    empty: "This zone is empty. Add the first table with the buttons above.",
    emptyReadOnly: "This zone has no tables yet.",
    /** Under the table's name on the plan, where there is little room. */
    seats: (min: number, max: number) =>
      min === max ? String(min) : `${String(min)}–${String(max)}`,
    tableName: (d: TableDescription) =>
      [
        `Table ${d.label}`,
        d.round ? "round" : "rectangular",
        d.minSeats === d.maxSeats
          ? `for ${String(d.maxSeats)}`
          : `for ${String(d.minSeats)} to ${String(d.maxSeats)}`,
        `${d.x} cm from the left and ${d.y} cm from the top`,
        d.rotation === 0 ? "" : `turned ${String(d.rotation)} degrees`,
        d.bookable ? "" : "not bookable online",
        d.problems === 0 ? "" : plural(d.problems, "1 problem", `${String(d.problems)} problems`),
      ]
        .filter(Boolean)
        .join(", "),
    toolbar: "Plan tools",
    shortcutsTitle: "Keyboard shortcuts",
    shortcuts: [
      ["Tab", "next table"],
      ["Arrows", "move 5 cm"],
      ["Shift + arrows", "move 50 cm"],
      ["R / Shift + R", "turn 15°"],
      ["Delete", "remove the table"],
      ["Escape", "let go"],
      ["Alt while dragging", "place freely, without the 5 cm grid"],
    ] as [string, string][],
  },
  issues: {
    title: "Problems in the plan",
    none: "No problems: no table sticks out of the zone or sits on another.",
    noneShort: "No problems",
    count: (n: number) => plural(n, "1 problem", `${String(n)} problems`),
    overlap: (a: string, b: string) => `Tables ${a} and ${b} overlap.`,
    outside: (a: string) => `Table ${a} sticks out of the zone.`,
    seats: (a: string) =>
      `Table ${a} has impossible guest numbers: the fewest must be 1 or more, and not above the most.`,
    show: (a: string) => `Show table ${a}`,
  },
  save: {
    unsaved: (n: number) => plural(n, "1 unsaved change", `${String(n)} unsaved changes`),
    allSaved: "All changes saved",
    needsLabels: "Every table needs a name or number before saving.",
    save: "Save changes",
    saving: "Saving…",
    discard: "Discard changes",
    saved: (n: number) => plural(n, "Change saved.", `${String(n)} changes saved.`),
    partial: (saved: number, failed: number) =>
      `${plural(saved, "1 change was saved", `${String(saved)} changes were saved`)}; ${plural(failed, "1 was not", `${String(failed)} were not`)}. They are still on the plan, so you can fix them and save again.`,
    noneSaved: (failed: number) =>
      plural(
        failed,
        "The change was not saved.",
        `None of the ${String(failed)} changes were saved.`,
      ),
    failedFor: (label: string, reason: string) => `Table ${label}: ${reason}`,
    stopped: "Saving stopped before the end. What was not sent is still on the plan.",
    discardTitle: "Discard unsaved changes?",
    discardBody: (n: number, zone: string) =>
      `${plural(n, "1 change", `${String(n)} changes`)} in “${zone}” ${plural(n, "has", "have")} not been saved. If you carry on, ${plural(n, "it is", "they are")} lost.`,
    keepEditing: "Keep editing",
    confirmDiscard: "Discard changes",
  },
  announce: {
    moved: (label: string, x: string, y: string) => `Table ${label} at ${x}, ${y} cm.`,
    rotated: (label: string, degrees: number) =>
      `Table ${label} turned ${String(degrees)} degrees.`,
    resized: (label: string, width: string, depth: string) =>
      `Table ${label} is now ${width} by ${depth} cm.`,
    removed: (label: string) => `Table ${label} removed. Save to make it final.`,
    added: (label: string) => `Table ${label} added.`,
  },
  errors: {
    network: "The server cannot be reached. Check the connection and try again.",
    signedOut: "Your session has ended. Sign in again.",
    forbidden: "Your account may not change this venue.",
    tooMany: "Too many requests in a row. Wait a moment and try again.",
    busy: "The server is very busy. Try again in a few seconds.",
    server:
      "Something failed on the server. Try again; if it keeps happening, tell whoever runs the app.",
    notFound: "It no longer exists; someone may have deleted it. The plan has been reloaded.",
    duplicateLabel: "another table in this zone already has that name.",
    duplicateZone: "There is already a zone with that name.",
    limit: "That is the most there can be: 50 zones per venue and 200 tables per zone.",
    tableHasReservations: (n: number) =>
      `it has ${plural(n, "an upcoming booking", `${String(n)} upcoming bookings`)}. Move or cancel ${plural(n, "it", "them")} first, or untick “Can be booked online”.`,
    zoneHasReservations: (n: number) =>
      `Tables in this zone have ${plural(n, "an upcoming booking", `${String(n)} upcoming bookings`)}. Move or cancel ${plural(n, "it", "them")} before deleting the zone.`,
    noRoom: (n: number) =>
      `with this change, ${plural(n, "an upcoming booking would be left", `${String(n)} upcoming bookings would be left`)} without room. Move or cancel ${plural(n, "it", "them")} first.`,
    changed: "it changed while saving. Try again.",
    planInvalid: "the plan would have problems:",
    zoneInvalid: "The zone cannot be that small, because:",
    rejected: "the server did not accept one of the values. Check the fields and try again.",
    dismiss: "Close message",
  },
  dialog: {
    cancel: "Cancel",
  },
};

export type Messages = typeof en;
