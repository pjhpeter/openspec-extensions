const HEADING_RE = /^\s{0,3}#{1,6}\s+(.+?)\s*$/;
const NUMBERED_TITLE_RE = /^\s*\d+\.\s+(.+?)\s*$/;
const BOLD_TITLE_RE = /^\s*\*\*(.+?)\*\*\s*$/;

export type SectionAliasMap = Record<string, Set<string>>;

export function normalizeMarkdownLabel(value: string): string {
  let normalized = value.replace(/[`*_#]+/g, "").trim();
  normalized = normalized.replace(/^[:\uFF1A\-\u2013\u2014|]+|[:\uFF1A\-\u2013\u2014|]+$/g, "");
  normalized = normalized.replace(/\s+/g, " ");
  return normalized.toLowerCase();
}

export function lineTitleCandidate(line: string): string | null {
  const patterns = [HEADING_RE, NUMBERED_TITLE_RE, BOLD_TITLE_RE];
  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return null;
}

export function matchMarkdownSection(line: string, aliasMap: SectionAliasMap): [string, string] | null {
  const rawTitle = lineTitleCandidate(line);
  if (rawTitle === null) {
    return null;
  }

  const candidates: Array<[string, string]> = [[rawTitle, ""]];
  const separators = [":", "\uFF1A", " - ", " \u2013 ", " \u2014 ", " | "];
  for (const separator of separators) {
    if (!rawTitle.includes(separator)) {
      continue;
    }
    const [left, right] = rawTitle.split(separator, 2);
    candidates.push([left.trim(), right.trim()]);
  }

  for (const [title, inlineBody] of candidates) {
    const normalized = normalizeMarkdownLabel(title);
    for (const [canonical, aliases] of Object.entries(aliasMap)) {
      if (aliases.has(normalized)) {
        return [canonical, inlineBody];
      }
    }
  }
  return null;
}

export function extractMarkdownSections(text: string, aliasMap: SectionAliasMap): Record<string, string[]> {
  const sections: Record<string, string[]> = {};
  let currentSection: string | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const matched = matchMarkdownSection(rawLine, aliasMap);
    if (matched) {
      const [section, inlineBody] = matched;
      currentSection = section;
      if (!sections[currentSection]) {
        sections[currentSection] = [];
      }
      if (inlineBody) {
        sections[currentSection].push(inlineBody);
      }
      continue;
    }

    if (currentSection !== null && HEADING_RE.test(rawLine)) {
      currentSection = null;
      continue;
    }

    if (currentSection !== null) {
      sections[currentSection] ??= [];
      sections[currentSection].push(rawLine.replace(/\s+$/g, ""));
    }
  }

  return sections;
}
