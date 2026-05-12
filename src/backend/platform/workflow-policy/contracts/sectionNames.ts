import { loadMarkdownContract } from './markdownContract.js';

export const SECTION_NAMES = Object.freeze(loadMarkdownContract().sectionNames);
