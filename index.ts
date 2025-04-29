import type { Idol, Group, DataSet } from '@/types';
import * as path from 'node:path';
import * as fs from 'node:fs';

// Dataset paths
const DATA_DIR = path.join(__dirname, 'data');
const DATASET_PATH = path.join(DATA_DIR, 'dataset.json');

// Load and parse dataset
function loadDataset(): DataSet {
    try {
        const rawData = fs.readFileSync(DATASET_PATH, 'utf-8');
        return JSON.parse(rawData) as DataSet;
    } catch (error) {
        throw new Error('Dataset not found. Run `kdapi scrape` to generate the dataset first.');
    }
}

// Dataset access functions
export function getFemaleIdols(): Idol[] {
    return loadDataset().femaleIdols;
}

export function getMaleIdols(): Idol[] {
    return loadDataset().maleIdols;
}

export function getGirlGroups(): Group[] {
    return loadDataset().girlGroups;
}

export function getBoyGroups(): Group[] {
    return loadDataset().boyGroups;
}

export function getCoedGroups(): Group[] {
    return loadDataset().coedGroups;
}

// Search functions
export function searchIdols(query: string): Idol[] {
    const dataset = loadDataset();
    const allIdols = [...dataset.femaleIdols, ...dataset.maleIdols];
    const normalizedQuery = query.toLowerCase();

    return allIdols.filter(idol => 
        idol.name.toLowerCase().includes(normalizedQuery) ||
        idol.stageName?.toLowerCase().includes(normalizedQuery) ||
        idol.koreanName?.toLowerCase().includes(normalizedQuery) ||
        idol.nicknames?.some(nick => nick.toLowerCase().includes(normalizedQuery)) ||
        idol.groups?.some(g => g.groupName.toLowerCase().includes(normalizedQuery))
    );
}

export function searchGroups(query: string): Group[] {
    const dataset = loadDataset();
    const allGroups = [...dataset.girlGroups, ...dataset.boyGroups, ...dataset.coedGroups];
    const normalizedQuery = query.toLowerCase();

    return allGroups.filter(group => 
        group.name.toLowerCase().includes(normalizedQuery) ||
        group.koreanName?.toLowerCase().includes(normalizedQuery) ||
        group.fandom?.name.toLowerCase().includes(normalizedQuery) ||
        group.memberHistory.currentMembers.some(m => 
            m.name.toLowerCase().includes(normalizedQuery)
        )
    );
}

// Export types
export type { Idol, Group, DataSet } from '@/types';