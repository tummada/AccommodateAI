/**
 * Medical Field Filter Middleware for AccommodateAI.
 *
 * ADA 29 CFR 1630.14 requires medical information to be kept confidential.
 * This module enforces role-based access to sensitive medical fields.
 *
 * Role Matrix:
 *   super_admin — sees everything
 *   hr          — sees everything
 *   manager     — ❌ medicalInfo, ❌ aiClassification, ❌ denialReason, ❌ requestDescription
 */

import type { AcmdCase } from '@acmd/db';

/**
 * Fields that manager role must NOT see.
 * ADA 29 CFR 1630.14: medical info (medicalInfo, aiClassification, denialReason)
 * must be kept confidential. requestDescription may also contain PHI entered
 * by the employee and is therefore restricted from manager view.
 */
const MANAGER_RESTRICTED_FIELDS = ['medicalInfo', 'aiClassification', 'denialReason', 'requestDescription'] as const;

type RestrictedField = (typeof MANAGER_RESTRICTED_FIELDS)[number];

/**
 * Filter sensitive medical fields from a case object based on the caller's role.
 *
 * - Does a deep clone of caseData — never mutates the original object.
 * - super_admin and hr see all fields.
 * - manager sees all fields EXCEPT: medicalInfo, aiClassification, denialReason.
 *
 * @param role - The authenticated user's role
 * @param caseData - The case object (may contain sensitive medical data)
 * @returns A new case object with fields filtered per role
 */
export function filterMedicalFields(role: string, caseData: AcmdCase): AcmdCase {
  // Deep clone to prevent mutating original
  const cloned: AcmdCase = JSON.parse(JSON.stringify(caseData));

  if (role === 'manager') {
    for (const field of MANAGER_RESTRICTED_FIELDS) {
      // Use type assertion to allow property deletion on the cloned object
      (cloned as Record<string, unknown>)[field as string] = undefined;
      delete (cloned as Record<RestrictedField, unknown>)[field];
    }
  }

  // super_admin, hr — no filtering needed
  return cloned;
}

/**
 * Filter medical fields from an array of case objects.
 * Used by GET /cases (list) endpoint.
 *
 * @param role - The authenticated user's role
 * @param cases - Array of case objects
 * @returns New array of filtered case objects
 */
export function filterMedicalFieldsFromList(role: string, cases: AcmdCase[]): AcmdCase[] {
  return cases.map((c) => filterMedicalFields(role, c));
}
