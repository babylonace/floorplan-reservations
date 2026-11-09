import type { PlanZone, ServiceReservation } from "../api/types";
import { useI18n } from "../i18n/i18n";

/**
 * The zone as a plain drawing for the day's service: which tables are taken at one moment.
 * Nothing moves and nothing is clicked here; the list next to it is where things happen.
 */
export function ServicePlan({
  zone,
  takenBy,
  highlighted,
  time,
}: {
  zone: PlanZone;
  /** Table id → the booking that holds it at `time`. */
  takenBy: ReadonlyMap<string, ServiceReservation>;
  /** Tables of the booking picked in the list. */
  highlighted: ReadonlySet<string>;
  /** The moment shown, as words ("20:00"). */
  time: string;
}) {
  const { t } = useI18n();
  const margin = Math.max(zone.width, zone.height) * 0.04;
  const taken = zone.tables.filter((table) => takenBy.has(table.id));

  return (
    <figure className="service-plan">
      <svg
        className="service-plan-svg"
        viewBox={`${String(-margin)} ${String(-margin)} ${String(zone.width + 2 * margin)} ${String(zone.height + 2 * margin)}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={t.service.planLabel(zone.name, time)}
      >
        <rect className="service-floor" x={0} y={0} width={zone.width} height={zone.height} />
        {zone.tables.map((table) => {
          const isTaken = takenBy.has(table.id);
          const isHighlighted = highlighted.has(table.id);
          const className = [
            "service-table",
            isTaken ? "is-taken" : "is-free",
            isHighlighted ? "is-highlighted" : "",
          ].join(" ");
          const size = Math.min(table.width, table.height);
          return (
            <g
              key={table.id}
              className={className}
              transform={`translate(${String(table.x)} ${String(table.y)})`}
            >
              <g transform={`rotate(${String(table.rotation)})`}>
                {table.shape === "round" ? (
                  <ellipse rx={table.width / 2} ry={table.height / 2} />
                ) : (
                  <rect
                    x={-table.width / 2}
                    y={-table.height / 2}
                    width={table.width}
                    height={table.height}
                    rx={4}
                  />
                )}
              </g>
              <text
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={Math.min(40, Math.max(16, size * 0.4))}
              >
                {table.label}
              </text>
            </g>
          );
        })}
      </svg>
      {/* The drawing as words, for screen readers. */}
      <figcaption className="visually-hidden">
        <ul>
          {taken.map((table) => (
            <li key={table.id}>
              {t.service.tableTaken(table.label, takenBy.get(table.id)?.guestName ?? "")}
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
