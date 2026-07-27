import { useRef } from "react";

/* eslint-disable react-hooks/refs -- This is the whole point of the hook: the
   latest handler bag is captured in a ref DURING render (not in an effect) so the
   stable wrappers stay correct even for render-time callers such as
   kanbanTaskMenuItems, and the stable mirror is lazily built once via the
   useRef(null) init pattern. An effect-based update would leave render-time
   callers one render stale. Mirrors the react-hooks/refs disable the kanban
   controller hooks already use. */

type HandlerBag = Record<string, (...args: any[]) => any>;

/**
 * Returns a stable-identity mirror of a bag of handler functions.
 *
 * Every wrapper keeps the same identity for the lifetime of the component, but
 * always invokes the *latest* closure. Passing the returned handlers as props
 * lets a `memo()` child bail out of re-renders when its data is unchanged
 * (e.g. during a background-poll setState in a large parent) without the stale
 * closures or dependency-array churn a hand-written `useCallback` would risk.
 *
 * The latest handlers are captured synchronously during render (not in an
 * effect) so the wrappers are correct for BOTH usages we have:
 *   - event handlers (onClick/onSubmit), invoked after commit; and
 *   - functions invoked during a child's render (e.g. `kanbanTaskMenuItems`,
 *     which builds menu items while the memo'd panel renders). An effect-based
 *     ref update would leave those one render stale on the render where a prop
 *     actually changes.
 *
 * The key set is fixed on first render from the initial bag; callers must pass
 * the same keys every render (all real handlers, never conditionally omitted).
 */
export function useStableHandlers<T extends HandlerBag>(handlers: T): T {
  const latestRef = useRef<T>(handlers);
  latestRef.current = handlers;

  const stableRef = useRef<T | null>(null);
  if (stableRef.current === null) {
    const stable: HandlerBag = {};
    for (const key of Object.keys(handlers)) {
      stable[key] = (...args: any[]) => latestRef.current[key](...args);
    }
    stableRef.current = stable as T;
  }
  return stableRef.current;
}
