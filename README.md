# @melon/kdapi

K-pop Data API and Dataset Generator

## Description

A TypeScript library that scrapes K-pop idol and group information from online sources to create comprehensive JSON datasets. The package collects data for:

- Female idols
- Male idols
- Girl groups
- Boy groups
- Co-ed groups

## Installation

```bash
bun add @melon/kdapi
```

or

```bash
npm install @melon/kdapi
```

## Usage

### Running the scraper

```typescript
import { scrapeAll, saveData } from '@melon/kdapi';

// Scrape data and get results
const dataset = await scrapeAll();

// Save to JSON files
saveData(dataset);
```

### Using pre-built datasets

```typescript
import { femaleIdols, maleIdols, girlGroups, boyGroups, coedGroups } from '@melon/kdapi/data';

// Get a female idol by name
const idol = femaleIdols.find(idol => idol.name === 'Jennie');

// Get all idols from a specific group
const blackpinkMembers = femaleIdols.filter(idol => idol.group === 'BLACKPINK');

// Get a group by name
const bts = boyGroups.find(group => group.name === 'BTS');
```

## Data Structure

### Idol Interface

```typescript
interface Idol {
  id: string;           // Unique identifier
  name: string;         // Idol's name
  profileUrl: string;   // URL to the idol's profile
  imageUrl?: string;    // URL to the idol's image
  stageName?: string;   // Stage name if different from name
  birthName?: string;   // Birth name
  koreanName?: string;  // Korean name
  birthday?: string;    // Birthday
  nationality?: string; // Nationality
  height?: string;      // Height
  weight?: string;      // Weight
  bloodType?: string;   // Blood type
  mbti?: string;        // MBTI personality type
  position?: string;    // Position in group
  group?: string;       // Group affiliation
  agency?: string;      // Entertainment agency
  facts?: string[];     // Additional facts about the idol
}
```

### Group Interface

```typescript
interface Group {
  id: string;           // Unique identifier
  name: string;         // Group's name
  profileUrl: string;   // URL to the group's profile
  imageUrl?: string;    // URL to the group's image
  koreanName?: string;  // Korean name
  debutDate?: string;   // Debut date
  fandomName?: string;  // Fandom name
  agency?: string;      // Entertainment agency
  members?: string[];   // Group members
  facts?: string[];     // Additional facts about the group
}
```

## Development

### Prerequisites

- Bun or Node.js
- TypeScript

### Setup

1. Clone the repository
2. Install dependencies:

```bash
bun install
```

### Running the scraper in debug mode

```bash
bun run index.ts
```

This will scrape a limited number of entries (default: 5 per category) for testing purposes.

### Building the package

```bash
bun build
```

## License

MIT
