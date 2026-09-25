import { approvalModel, selectApproval } from './approval-model.ts'
import { ApprovalPreview, NativeApprovalDetail } from './approval-components.tsx'
import { api } from './transport.ts'
import { safeUrl, rawDetails } from './validation.ts'
import { validScope, validStatus, phaseLabel } from './grant-model.ts'
import { Scope } from './grant-components.tsx'
import { GrantCard } from './grant-card.tsx'
import {
  fieldValueModel,
  validFieldStatus,
  fieldResult,
  fieldPhase,
  fieldPhaseLabel,
} from './field-model.ts'
import { FieldChangeCard } from './field-card.tsx'
import {
  READ_TOOLS,
  readWarnings,
  readCardModel,
  itemFieldModel,
  projectItemModel,
} from './read-models.ts'
import { ReadCard } from './read-components.tsx'
import { apply } from './registration.ts'
// Preserve the complete historical factory return surface for the loader and tests.
export default {
  inject: ['slots'],
  approvalModel,
  selectApproval,
  ApprovalPreview,
  NativeApprovalDetail,
  api,
  safeUrl,
  validScope,
  validStatus,
  rawDetails,
  phaseLabel,
  Scope,
  GrantCard,
  fieldValueModel,
  validFieldStatus,
  fieldResult,
  fieldPhase,
  fieldPhaseLabel,
  FieldChangeCard,
  READ_TOOLS,
  readWarnings,
  readCardModel,
  itemFieldModel,
  projectItemModel,
  ReadCard,
  apply,
}
