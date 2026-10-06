import { ATLAS_REVISION_KEY } from './atlas-collection-writer.js';
import { captureAtlasState, captureAtlasHistoryState, atlasRecordJSON, diffAtlasStates, planAtlasRestore, planAtlasExactRestore, planAtlasSelectionRestore } from './atlas-history-model.js';
import { QUICK_SAVE_UNDO_KEY, QUICK_SAVE_FEEDBACK_KEY } from './quick-save-core.js';

export const ATLAS_RESTORE_RECEIPT_KEY = 'atlasRestoreReceipt';
export const ATLAS_GENERATION_KEY = 'atlasCollectionsGeneration';
export const ATLAS_ARCHIVE_PROTECTION_KEY = 'atlasArchiveProtection';
export const ATLAS_RESTORE_KEYS = [ATLAS_RESTORE_RECEIPT_KEY, ATLAS_GENERATION_KEY, ATLAS_ARCHIVE_PROTECTION_KEY,
  QUICK_SAVE_UNDO_KEY, QUICK_SAVE_FEEDBACK_KEY];
const equal = (a, b) => atlasRecordJSON(captureAtlasState(a)) === atlasRecordJSON(captureAtlasState(b));
function failure(message, code) { const error = new Error(message); error.code = code; return error; }

/** Bind recoverPending to writer.beforeChange and committed to writer.onCommitted.
 * The receipt is in the same local commit as the collections; IDB never guesses success from time or equal URLs.
 */
export function createAtlasRestorer({ database, writer, storage, clock = Date.now, key = () => crypto.randomUUID() }) {
  async function readLocal() {
    const data = await storage.get(['folders', 'deferred', ATLAS_REVISION_KEY, ATLAS_RESTORE_RECEIPT_KEY]);
    return { state: captureAtlasState(data), revision: data[ATLAS_REVISION_KEY]?.id || null,
      receipt: data[ATLAS_RESTORE_RECEIPT_KEY] || null };
  }
  async function finish(operation, local) {
    if (!local.receipt || local.receipt.id !== operation.id || local.receipt.revision !== operation.commitRevision) {
      throw failure('The restore receipt is unavailable. Saved links were left unchanged. Retry history recovery.', 'RECOVERY_CONFLICT');
    }
    // Local already committed. Switch the guard before recording anything else; both states are durable here.
    await database.putOperation({ id: operation.id, phase: 'recovering' }, { protect: true });
    await database.append(captureAtlasHistoryState(operation.target), { kind: operation.kind, operationId: operation.id, boundary: true, wallTime: operation.createdAt });
    if (!equal(local.state, operation.target)) {
      await database.append(captureAtlasHistoryState(local.state), { kind: 'recovered-changes', wallTime: clock() });
    }
    await database.putOperation({ id: operation.id, phase: 'committed', committedAt: local.receipt.at }, { protect: true });
    return { id: operation.id, committed: true, revision: operation.commitRevision };
  }
  async function recoverPending() {
    const pending = await database.pending();
    if (!pending) return null;
    const local = await readLocal();
    if (local.receipt?.id === pending.id) return await finish(pending, local);
    // No receipt means the atomic local restore never committed. Do not replay its target.
    // Later ordinary edits are preserved too; this preparation never replaces the old guaranteed Undo.
    await database.putOperation({ id: pending.id, phase: 'abandoned' });
    return { id: pending.id, committed: false };
  }
  async function committed(event) {
    if (!event.operationId) return false;
    const operation = await database.operation(event.operationId);
    if (!operation) throw failure('The protected restore point is unavailable. Retry history recovery.', 'RECOVERY_CONFLICT');
    await finish(operation, await readLocal()); return true;
  }
  async function historical(request) {
    if (request.pointOperation) {
      const status = await database.status();
      if (status.lastRestore?.id !== request.pointOperation) throw failure('This protected return point was replaced. Choose the current return point.', 'POINT_GONE');
      return (await database.operation(request.pointOperation)).before;
    }
    const moment = await database.seek(request.time);
    if (!moment.time || moment.gap) throw failure('No Atlas snapshot was recorded at this moment. Choose a recorded moment.', 'MOMENT_GONE');
    return moment.state;
  }
  async function preview(request) {
    return await writer.inspect(async ({ collections, revision }) => {
      const past = await historical(request);
      const plan = request.selection
        ? planAtlasSelectionRestore(collections, past, request.selection, request.choices)
        : planAtlasRestore(collections, past);
      return { ...plan, revision, currentFolders: collections.folders.map(folder => ({ id: folder.id, name: folder.name })) };
    });
  }
  async function apply(request, kind, getTarget) {
    if (!Object.hasOwn(request, 'expectedRevision')) throw failure('Review the restore before confirming it.', 'CONFIRM_REQUIRED');
    const id = request.id || key();
    if (typeof id !== 'string' || !id || id.length > 160) throw failure('This restore request is invalid.', 'INVALID_REQUEST');
    // Safe retry after response loss. An abandoned preparation cannot be started again.
    const previous = await writer.inspect(() => database.operation(id));
    if (previous) {
      if (previous.phase === 'committed') return { id, changed: true, alreadyCommitted: true, recoveryPending: false };
      throw failure('This restore did not commit. Review the current Atlas and start a new restore.', 'OPERATION_USED');
    }
    let prepared;
    const result = await writer.mutate(async (collections, stored) => {
      const plan = await getTarget(collections);
      if (plan.status !== 'ready') throw failure('Resolve every selected folder and link before restoring.', 'CHOICES_REQUIRED');
      const before = captureAtlasState(collections), target = captureAtlasState(plan.target);
      if (!Object.keys(diffAtlasStates(before, target)).length) return { update: {}, result: { unchanged: true } };
      const at = clock();
      const protection = Object.fromEntries(target.deferred.filter(link => link.completed).flatMap(link => {
        const previous = stored[ATLAS_ARCHIVE_PROTECTION_KEY]?.[link.id];
        return previous?.completedAt === (link.completedAt || null) ? [[link.id, previous]] : [];
      }));
      prepared = { id, kind, createdAt: at, undoOf: request.undoOf || null };
      return { update: { folders: target.folders, deferred: target.deferred,
        [ATLAS_GENERATION_KEY]: id, [QUICK_SAVE_UNDO_KEY]: null, [QUICK_SAVE_FEEDBACK_KEY]: null,
        [ATLAS_ARCHIVE_PROTECTION_KEY]: protection,
        // Revision is assigned by the writer; prepare below fills the exact receipt before local.set.
        [ATLAS_RESTORE_RECEIPT_KEY]: { id, at } }, result: plan.changes };
    }, {
      expectedRevision: request.expectedRevision, kind, operationId: id,
      prepare: async event => {
        prepared = { ...prepared, phase: 'prepared', sourceRevision: event.revision,
          commitRevision: event.stamp.id, before: event.before, target: event.after };
        await database.append(captureAtlasHistoryState(event.before), { kind: 'before-restore', boundary: true, wallTime: prepared.createdAt });
        await database.putOperation(prepared);
      },
      receiptKey: ATLAS_RESTORE_RECEIPT_KEY,
    });
    return { id, changed: result.changed, changes: result.result, revision: result.revision, recoveryPending: result.historyError };
  }
  async function restore(request) {
    return await apply(request, 'restore', async collections => {
      const past = await historical(request);
      return request.selection
        ? planAtlasSelectionRestore(collections, past, request.selection, request.choices)
        : planAtlasRestore(collections, past);
    });
  }
  async function undoPreview(id) {
    return await writer.inspect(async ({ collections, revision }) => {
      const status = await database.status(), operation = status.lastRestore;
      if (operation?.undoOf === id) return { alreadyUndone: true };
      if (!operation || operation.id !== id || operation.phase !== 'committed') throw failure('This Undo was replaced. Choose the current return point in Time machine.', 'UNDO_GONE');
      const protectedPoint = await database.operation(id);
      return { ...planAtlasExactRestore(collections, protectedPoint.before), revision, changedSinceRestore: revision !== operation.commitRevision };
    });
  }
  async function undo(request) {
    const preview = await undoPreview(request.operationId);
    if (preview.alreadyUndone) return { changed: false, alreadyUndone: true };
    if (preview.changedSinceRestore && !request.confirmChanged) throw failure('Atlas changed after the restore. Review these changes before Undo. Your current Atlas will be protected too.', 'UNDO_CHANGED');
    if (!Object.hasOwn(request, 'expectedRevision')) throw failure('Review Undo before confirming it.', 'CONFIRM_REQUIRED');
    return await apply({ ...request, undoOf: request.operationId }, 'undo-restore', async collections => {
      const status = await database.status();
      if (status.lastRestore?.id !== request.operationId) throw failure('This Undo was replaced. Review the current return point.', 'UNDO_GONE');
      const operation = await database.operation(request.operationId);
      return planAtlasExactRestore(collections, operation.before);
    });
  }
  // Only the queue hook calls recoverPending directly; public recovery must wait for any in-flight local commit.
  return { preview, restore, undoPreview, undo, recover: () => writer.exclusive(recoverPending), recoverPending, committed };
}
