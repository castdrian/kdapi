# @castdrian/kdapi

K-pop Data API and Dataset Generator

## Description

A TypeScript library that scrapes K-pop idol and group information from online sources to create comprehensive JSON datasets. The package provides:

- Data scraping with caching
- Fuzzy search functionality
- TypeScript type definitions
- Built-in dataset access

## Installation

```bash
bun add @castdrian/kdapi
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
import { fuzzySearch, getItemById } from '@castdrian/kdapi';

// Search across idols and groups
const results = fuzzySearch('stayc', {
  type: 'all',      // 'idol' | 'group' | 'all'
  limit: 10,        // Max results
  threshold: 0.4    // Fuzzy match threshold
});

// Get specific idol/group by ID
const item = getItemById('some-uuid');
```

## Development

### Prerequisites

- Bun
- TypeScript

### Setup

```bash
# Clone the repository
git clone https://github.com/castdrian/kdapi.git

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
