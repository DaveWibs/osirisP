// Shared OSINT news scoring used by the live /api/news route and the
// database-backed persisted mode so both produce the same item shape.

export const RISK_KEYWORDS = ['war', 'missile', 'strike', 'attack', 'crisis', 'tension', 'military', 'conflict', 'defense', 'clash', 'nuclear', 'invasion', 'bomb', 'drone', 'weapon', 'sanctions', 'ceasefire', 'escalation', 'killed', 'destroyed', 'operation', 'casualty', 'frontline', 'threat'];

export const KEYWORD_COORDS: Record<string, [number, number]> = {
  'ukraine': [49.487, 31.272], 'kyiv': [50.450, 30.523], 'russia': [61.524, 105.318],
  'moscow': [55.755, 37.617], 'israel': [31.046, 34.851], 'gaza': [31.416, 34.333],
  'iran': [32.427, 53.688], 'lebanon': [33.854, 35.862], 'syria': [34.802, 38.996],
  'yemen': [15.552, 48.516], 'china': [35.861, 104.195], 'taiwan': [23.697, 120.960],
  'united states': [38.907, -77.036], 'europe': [48.800, 2.300], 'middle east': [31.500, 34.800],
};

export function scoreRisk(text: string): number {
  const lower = text.toLowerCase();
  let score = 1;
  for (const kw of RISK_KEYWORDS) {
    if (lower.includes(kw)) score += 2;
  }
  return Math.min(10, score);
}

export function findCoords(text: string): [number, number] | null {
  const lower = text.toLowerCase();
  for (const [keyword, coords] of Object.entries(KEYWORD_COORDS)) {
    if (lower.includes(keyword)) return coords;
  }
  return null;
}
