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
  /** How many sides have seats; null when they go all around. */
  seatedSides: number | null;
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
    skipToPlan: "Skip to the plan",
  },
  venues: {
    none: "Your account does not run any venue yet. Ask the venue's owner to give you access.",
    loadingPlan: "Loading the floor plan…",
    loadFailed: "The floor plan could not be loaded.",
    retry: "Try again",
    readOnly: "View only: the venue's owner makes the changes.",
  },
  zones: {
    listLabel: "Zones",
    add: "New zone",
    none: "No zones yet. Create the first one.",
    noneReadOnly: "This venue has no zones yet.",
    newTitle: "New zone",
    name: "Name",
    width: "Width (m)",
    height: "Depth (m)",
    sizeHint: "In metres; decimals are fine, such as 4.5.",
    create: "Create zone",
    creating: "Creating…",
    created: (name: string) => `Zone “${name}” created.`,
    panelTitle: "This zone",
    remove: "Delete zone",
    removeTitle: (name: string) => `Delete the zone “${name}”?`,
    removeBody:
      "Its tables go too. Tables that had bookings in the past are kept in the history. This cannot be undone.",
    removed: (name: string) => `Zone “${name}” deleted.`,
    tablesCount: (n: number) => plural(n, "1 table", `${String(n)} tables`),
  },
  tables: {
    addTitle: "Add table +",
    addRect: "Add rectangular table",
    addRound: "Add round table",
    /** On narrow screens, next to the shape; the full name above is what screen readers hear. */
    addRectShort: "Rectangular",
    addRoundShort: "Round",
    addBar: "Add bar section",
    addBarShort: "Bar",
    /** Bar sections are named B1, B2… */
    barPrefix: "B",
    panelTitle: (label: string) => `Table ${label}`,
    label: "Name or number",
    labelRequired: "Give the table a name or number.",
    shape: "Shape",
    rect: "Rectangular",
    round: "Round",
    guests: "Guests",
    minSeats: "Fewest",
    maxSeats: "Most",
    width: "Width (m)",
    height: "Depth (m)",
    rotation: "Turn (degrees)",
    position: "Position (m)",
    x: "From the left",
    y: "From the top",
    seats: "Seats",
    seatsAround: "All around",
    seatsSides: "Chosen sides",
    sides: { top: "Top", right: "Right", bottom: "Bottom", left: "Left" },
    sidesLegend: "Sides with seats",
    sidesHint:
      "Sides of the table before it is turned. Tables are never joined along a side with seats.",
    barHint: "Bar section: a group takes several sections next to each other, in a line.",
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
    newBadge: "New",
  },
  plan: {
    label: (zone: string, width: string, depth: string) =>
      `Floor plan of ${zone}, ${width} wide and ${depth} deep`,
    help: "Tab moves from table to table. The arrow keys move the selected table by 5 cm, or 50 cm with Shift. R turns it 15 degrees, Shift+R the other way. Delete removes it. Escape lets go. Plus and minus zoom the plan in and out; 0 shows all of it.",
    helpReadOnly:
      "Tab moves from table to table. Plus and minus zoom the plan in and out; 0 shows all of it.",
    empty: "Empty zone. Add a table with the buttons above.",
    emptyReadOnly: "This zone has no tables yet.",
    /** Under the table's name on the plan, where there is little room. */
    seats: (max: number) => String(max),
    tableName: (d: TableDescription) =>
      [
        `Table ${d.label}`,
        d.round ? "round" : "rectangular",
        `for ${String(d.maxSeats)}`,
        `${d.x} from the left and ${d.y} from the top`,
        d.rotation === 0 ? "" : `turned ${String(d.rotation)} degrees`,
        d.seatedSides === null
          ? ""
          : d.seatedSides === 1
            ? "seats on one side"
            : `seats on ${String(d.seatedSides)} sides`,
        d.bookable ? "" : "not bookable online",
        d.problems === 0 ? "" : plural(d.problems, "1 problem", `${String(d.problems)} problems`),
      ]
        .filter(Boolean)
        .join(", "),
    toolbar: "Plan tools",
    zoom: "Zoom",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    zoomFit: "Show the whole plan",
    shortcutsTitle: "Keyboard shortcuts",
    viewShortcuts: [
      ["Tab", "next table"],
      ["+ / −", "zoom in or out"],
      ["0", "show the whole plan"],
      ["Ctrl + wheel", "zoom where the pointer is"],
      ["Drag the floor", "move around, zoomed in"],
    ] as [string, string][],
    shortcuts: [
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
    needsName: "The zone needs a name before saving.",
    save: "Save changes",
    saveShort: "Save",
    saving: "Saving…",
    discard: "Discard changes",
    discardShort: "Discard",
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
    moved: (label: string, x: string, y: string) => `Table ${label} at ${x}, ${y}.`,
    rotated: (label: string, degrees: number) =>
      `Table ${label} turned ${String(degrees)} degrees.`,
    resized: (label: string, width: string, depth: string) =>
      `Table ${label} is now ${width} by ${depth}.`,
    removed: (label: string) => `Table ${label} removed. Save to make it final.`,
    added: (label: string) => `Table ${label} added.`,
    zoom: (percent: number) => `Zoom ${String(percent)}%.`,
    addedInLine: (label: string, after: string) => `Bar section ${label} added after ${after}.`,
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
    metres: (min: string, max: string) => `Between ${min} and ${max}.`,
  },
  dialog: {
    cancel: "Cancel",
  },
};

export type Messages = typeof en;
