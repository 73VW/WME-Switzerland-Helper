import { el, icon } from "./dom";

/**
 * One box in WME's segment edit panel, shared by every feature that has something to say
 * about the selected segment.
 *
 * DELIBERATE deviation from CLAUDE.md's "no direct DOM hacks that bypass SDK events" — the
 * same one the checker already documented, not a new one. The SDK exposes no extension
 * point for the segment edit panel. This module *narrows* the deviation: two features used
 * to prepend a container each, with their own retry schedules ([0, 250, 750] ms and
 * [0, 120, 400, 900] ms), so which box came out on top depended on which retry won and
 * could flip between one selection and the next. There is now one mount point, one retry
 * schedule, one missing-panel guard.
 *
 * Containment is unchanged: the DOM is only a mount point. Selection, data and edits still
 * go through SDK events.
 */
export interface EditPanelSlot {
  /** Stable identity. A second registration under the same id replaces the first. */
  id: string;
  /** Display order, lower first. Ties break on id, never on timing. */
  rank: number;
  /**
   * Build this slot's content, or return null when there is nothing to say: the slot then
   * leaves no trace, and the host disappears when every slot returns null.
   *
   * `siblings` lists the slots that already rendered something this pass, so a feature can
   * stay quiet about what another one is already showing without going looking for its DOM.
   */
  render: (context: { siblings: readonly string[] }) => HTMLElement | null;
}

const CONTAINER_ID = "wmech-edit-panel-host";
/** WME rebuilds the panel asynchronously after a selection; one schedule for everyone. */
const INJECT_RETRY_DELAYS_MS = [0, 120, 250, 400, 750, 900];

/**
 * The ordering rule, kept pure and separate from the mounting.
 *
 * This is the whole point of the module, and the part worth testing: the repo runs its
 * tests in Node with no document, so a rule tangled into the DOM code could not be checked.
 */
export function orderedSlots(slots: readonly EditPanelSlot[]): EditPanelSlot[] {
  const byId = new Map<string, EditPanelSlot>();
  for (const slot of slots) byId.set(slot.id, slot);
  return [...byId.values()].sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
}

const registry: EditPanelSlot[] = [];
let retryTimers: Array<ReturnType<typeof setTimeout>> = [];
let warnedMissingPanel = false;
let hostTitleText = "Switzerland";

export function registerEditPanelSlot(slot: EditPanelSlot): void {
  registry.push(slot);
}

/**
 * The header text, resolved by whichever feature registers first.
 *
 * The host holds no i18next instance: the two features keep separate ones on purpose,
 * because the checker's language is a per-feature preference. Importing either feature's
 * `t` here would quietly undo that.
 */
export function setEditPanelHostTitle(title: string): void {
  hostTitleText = title;
}

/** Rebuild the host. Safe to call on every SDK event. */
export function refreshEditPanelHost(): void {
  for (const timer of retryTimers) clearTimeout(timer);
  retryTimers = [];
  for (const delay of INJECT_RETRY_DELAYS_MS) {
    retryTimers.push(setTimeout(mount, delay));
  }
}

function mount(): void {
  const rendered: Array<{ id: string; node: HTMLElement }> = [];
  for (const slot of orderedSlots(registry)) {
    const node = slot.render({ siblings: rendered.map((entry) => entry.id) });
    if (node) rendered.push({ id: slot.id, node });
  }

  const existing = document.getElementById(CONTAINER_ID);
  if (rendered.length === 0) {
    existing?.remove();
    return;
  }

  const panel = document.querySelector("#edit-panel");
  if (!panel) {
    // Warned once: WME renaming the panel is a silent loss of the box, never a crash.
    if (!warnedMissingPanel) {
      warnedMissingPanel = true;
      console.warn(
        "[wme-ch] #edit-panel not found; the edit-panel box is unavailable in this WME version",
      );
    }
    return;
  }

  const host = existing ?? el("div", "wmech-edit-host");
  host.id = CONTAINER_ID;

  const head = el("div", "wmech-edit-host-head");
  head.append(icon("location"), el("span", "", hostTitleText));

  const children: HTMLElement[] = [head];
  for (const { node } of rendered) {
    const wrapper = el("div", "wmech-slot");
    wrapper.appendChild(node);
    children.push(wrapper);
  }
  host.replaceChildren(...children);

  if (!existing) panel.prepend(host);
}
