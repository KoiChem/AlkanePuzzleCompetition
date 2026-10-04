import type { PersistenceDatabase } from "./db";

export type CleanupExpiredInput = { readonly nowMs: number; readonly limit: number };

export async function cleanupExpired(
  database: PersistenceDatabase,
  input: CleanupExpiredInput,
): Promise<{ readonly deletedRooms: number; readonly deletedSiteSettingReceipts: number }> {
  if (!Number.isInteger(input.limit) || input.limit <= 0) throw new TypeError("cleanup limit must be a positive integer");
  const { results: expiredRooms } = await database.prepare(`
    SELECT id FROM rooms WHERE expires_at_ms <= ? ORDER BY expires_at_ms, id LIMIT ?
  `).bind(input.nowMs, input.limit).all<{ id: string }>();
  const { results: expiredSiteSettingReceipts } = await database.prepare(`
    SELECT teacher_id, request_id FROM site_setting_receipts
    WHERE expires_at_ms <= ? ORDER BY expires_at_ms, teacher_id, request_id LIMIT ?
  `).bind(input.nowMs, input.limit).all<{ teacher_id: string; request_id: string }>();
  if (!expiredRooms.length && !expiredSiteSettingReceipts.length) {
    return { deletedRooms: 0, deletedSiteSettingReceipts: 0 };
  }
  const roomStatements = expiredRooms.map(({ id }) => database.prepare(
    "DELETE FROM rooms WHERE id = ? AND expires_at_ms <= ?",
  ).bind(id, input.nowMs));
  const siteSettingReceiptStatements = expiredSiteSettingReceipts.map(({ teacher_id: teacherId, request_id: requestId }) =>
    database.prepare(`
      DELETE FROM site_setting_receipts
      WHERE teacher_id = ? AND request_id = ? AND expires_at_ms <= ?
    `).bind(teacherId, requestId, input.nowMs));
  const deleted = await database.batch([...roomStatements, ...siteSettingReceiptStatements]);
  return {
    deletedRooms: deleted.slice(0, roomStatements.length)
      .reduce((sum, result) => sum + Number(result.meta.changes ?? 0), 0),
    deletedSiteSettingReceipts: deleted.slice(roomStatements.length)
      .reduce((sum, result) => sum + Number(result.meta.changes ?? 0), 0),
  };
}
