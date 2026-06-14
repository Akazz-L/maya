export interface Character {
  name: string;
  traits: string[];
  dialogue_examples: string[];
}

export interface BibleData {
  characters: Character[];
  world: {
    locations: string[];
    rules: string[];
  };
  style_guide: {
    voice: string;
    avoid: string[];
  };
  timeline: string[];
}

export interface OutlineData {
  chapters: string[];
}

export const EMPTY_BIBLE: BibleData = {
  characters: [],
  world: { locations: [], rules: [] },
  style_guide: { voice: '', avoid: [] },
  timeline: [],
};

export const EMPTY_OUTLINE: OutlineData = { chapters: [] };
