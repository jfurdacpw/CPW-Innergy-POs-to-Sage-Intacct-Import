/**
 * The sub-entities a Sage call may target. Split out of lib/sage.ts (which is
 * `server-only`) so the browser can render the same picker the server validates
 * against — two pages offer that picker and both used to hardcode the list.
 *
 * "" is the top level (all entities, which the query service returns when
 * `includePrivate` is true). Scoping happens through the `X-IA-API-Param-Entity`
 * header — see lib/sage.ts.
 */
export const SAGE_ENTITY_OPTIONS = ["", "10", "20", "30"] as const;

export type SageEntity = (typeof SAGE_ENTITY_OPTIONS)[number];

/** Same list, labelled for a <select>. */
export const SAGE_ENTITY_CHOICES: { value: string; label: string }[] = [
  { value: "", label: "Top level (all entities)" },
  { value: "10", label: "10" },
  { value: "20", label: "20" },
  { value: "30", label: "30" },
];
