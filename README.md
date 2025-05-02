# @melon/kdapi

K-pop Data API and Dataset Generator

## Description

A TypeScript library that scrapes K-pop idol and group information from online sources to create comprehensive JSON datasets. The package provides:

- Data scraping with caching
- Fuzzy search functionality
- TypeScript type definitions
- Built-in dataset access

## Installation

```bash
bun add @melon/kdapi
```

## Usage

### Command Line Interface

```bash
# Run scraper in debug mode (5 samples per category)
kdapi scrape --debug

# Run full scraper with caching
kdapi scrape --cache

# Force refresh all profiles
kdapi scrape --force

# Configure batch size and delays
kdapi scrape --batch-size 10 --delay 3000
```

### Using the API

```typescript
import { fuzzySearch, getItemById } from '@melon/kdapi';

// Search across idols and groups
const results = fuzzySearch('jennie', {
  type: 'all',      // 'idol' | 'group' | 'all'
  limit: 10,        // Max results
  threshold: 0.4    // Fuzzy match threshold
});

// Get specific idol/group by ID
const item = getItemById('some-uuid');
```

## Data Structure

### Core Types

```typescript
interface CoreProfile {
  id: string;
  profileUrl: string;
  imageUrl: string | null;
  active: boolean;
  status: 'active' | 'inactive';
  company: {
    current: string | null;
    history: Array<{
      name: string;
      period: {
        start: string;
        end?: string;
      };
    }>;
  } | null;
  socialMedia?: {
    facebook?: string;
    twitter?: string;
    instagram?: string;
    youtube?: string;
    tiktok?: string;
    spotify?: string;
    website?: string;
    fancafe?: string;
    weibo?: string;
    vlive?: string;
  };
  names: {
    stage: string;
    korean: string | null;
    japanese: string | null;
    chinese: string | null;
  };
}

interface Idol extends CoreProfile {
  personalInfo?: {
    mbti?: string;
  };
  physicalInfo?: {
    mbti: string;
    birthDate?: string;
    zodiacSign?: string;
    height?: number;
    weight?: number;
    bloodType?: 'A' | 'B' | 'O' | 'AB';
  };
  careerInfo?: {
    debutDate?: string;
    activeYears?: Array<{
      start: string;
      end?: string;
    }>;
  };
  groups?: Array<{
    name: string;
    status: 'current' | 'former';
    period?: {
      start: string;
      end?: string;
    };
  }>;
}

interface Group extends CoreProfile {
  type: 'girl' | 'boy' | 'coed';
  memberHistory: {
    currentMembers: Array<{
      name: string;
      profileUrl: string;
    }>;
    formerMembers: Array<{
      name: string;
      profileUrl: string;
    }>;
  };
  groupInfo?: {
    debutDate?: string;
    disbandmentDate?: string;
  };
}
```

## Development

### Prerequisites

- Bun
- TypeScript

### Setup

```bash
# Clone the repository
git clone https://github.com/your-username/melon-kdapi.git

# Install dependencies
bun install

# Run scraper in debug mode
bun run cli.ts scrape --debug
```

### Cache Management

HTML responses are cached in:

- `/cache/idols/` - Idol profile pages
- `/cache/groups/` - Group profile pages

Data is saved to:

- `/data/idols.json` - Idol data
- `/data/groups.json` - Group data
- `/data/metadata.json` - Dataset statistics

## License

MIT
