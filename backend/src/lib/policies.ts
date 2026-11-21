/**
 * The static registry of non-document policies that can be acknowledged through PolicyAcknowledgement.
 * A document's policy key is never registered here — it is derived from the document itself (see
 * documentPolicyKey below) because each document already carries its own "text" (the uploaded file) and
 * its own version (a new upload is a new documentId, so version is always 1).
 *
 * Bumping a policy's `version` here (a code change, i.e. a deploy) is what forces re-acknowledgement:
 * every employee's acknowledgement row for the old version stops counting, with no data migration needed.
 */

export const ACTIVITY_MONITORING_POLICY_KEY = "activity-monitoring";

export const ACTIVITY_MONITORING_POLICY_VERSION = 1;
export const ACTIVITY_MONITORING_POLICY_TEXT =
  "While you are signed in during office hours, this portal notes whether your mouse or keyboard were used " +
  "in each minute — never which key, where you clicked, or what was on screen. It only runs in this browser " +
  "tab and only after you agree below. HR and your Line Manager can see how much of your tracked time was " +
  "active; only HR can see your day-by-day detail, and every time they do that is recorded in the audit log. " +
  "This is not used to judge the quality of your work, and never feeds appraisals, pay or disciplinary " +
  "decisions automatically. You can stop it at any time by closing this tab.";

export const POLICY_REGISTRY = {
  [ACTIVITY_MONITORING_POLICY_KEY]: { version: ACTIVITY_MONITORING_POLICY_VERSION, text: ACTIVITY_MONITORING_POLICY_TEXT },
} as const;

export type RegisteredPolicyKey = keyof typeof POLICY_REGISTRY;

export const isRegisteredPolicyKey = (key: string): key is RegisteredPolicyKey => key in POLICY_REGISTRY;

const DOCUMENT_POLICY_PREFIX = "document:";

export const documentPolicyKey = (documentId: number) => `${DOCUMENT_POLICY_PREFIX}${documentId}`;

/** The documentId encoded in a "document:<id>" policy key, or null if the key is not shaped like one. */
export function documentIdFromPolicyKey(policyKey: string): number | null {
  if (!policyKey.startsWith(DOCUMENT_POLICY_PREFIX)) return null;
  const id = Number(policyKey.slice(DOCUMENT_POLICY_PREFIX.length));
  return Number.isInteger(id) && id > 0 ? id : null;
}
