/** Input progress is deliberately independent from correctness. */
export function answerHasContent(value: unknown): boolean {
 if (typeof value === 'string') { try {return answerHasContent(JSON.parse(value));} catch {return value.trim().length > 0;} }
 if (!value || typeof value !== 'object') return false;
 if ('grid' in value) {
  const grid = (value as {grid?: unknown}).grid;
  return Array.isArray(grid) && grid.some(row => Array.isArray(row) && row.some(cell => cell != null));
 }
 if ('tokens' in value) {
  const tokens = (value as {tokens?: unknown}).tokens;
  return Array.isArray(tokens) && tokens.some(token => typeof token === 'string' && token.trim().length > 0);
 }
 return false;
}
