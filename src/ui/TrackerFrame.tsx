import type { ReactNode } from "react";

/**
 * The handheld spider tracker the menus are dressed as: a sky-blue case with a
 * status strip, a navy map screen and a keypad below it.
 *
 * Every full-screen overlay (title, loading, error) renders through this, so
 * the three screens read as the same device in different states rather than as
 * three dialogs. The camera dot is pure chrome.
 */

interface TrackerFrameProps {
  /** Alarm livery for the error screen. */
  alarm?: boolean;
  /** The keypad under the screen. */
  deck?: ReactNode;
  children: ReactNode;
}

export function TrackerFrame({
  alarm = false,
  deck,
  children,
}: TrackerFrameProps) {
  return (
    <div className={`tracker${alarm ? " tracker--alarm" : ""}`}>
      <div className="tracker__bar">
        <span className="tracker__cam" />
      </div>

      <div className="tracker__screen">
        <div className="tracker__view">{children}</div>
      </div>

      {deck && <div className="tracker__deck">{deck}</div>}
    </div>
  );
}
