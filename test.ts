import axios from 'axios';
import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { Idol, Group } from './types';

const TEST_PROFILES = {
	idol: 'https://kpopping.com/profiles/idol/IU',
	group: 'https://kpopping.com/profiles/group/TWICE'
};

async function extractProfileInfo($: cheerio.CheerioAPI): Promise<Record<string, any>> {
    const info: Record<string, any> = {
        meta: {},
        facts: [],
        socialMedia: {}
    };

    // Extract full description first
    const descriptions = [
        $('.profile-info p').first().text(),
        $('meta[property="og:description"]').attr('content'),
        $('.profile-description').text()
    ].filter(Boolean);
    info.description = descriptions[0] || '';

    // Extract member list with multiple strategies
    const members: { current: string[], former: string[] } = {
        current: [],
        former: []
    };

    // Try to find members in any section containing "Members"
    $('*:contains("Members")').each((_, section) => {
        const $section = $(section);
        const sectionText = $section.text().trim();
        
        if (sectionText.toLowerCase().includes('member')) {
            // Look for lists or paragraphs near this section
            const possibleLists = $section.find('ul li, ol li').add($section.next('ul, ol').find('li'));
            const possibleText = $section.next('p').text();

            possibleLists.each((_, item) => {
                const text = $(item).text().trim();
                if (text && !text.toLowerCase().includes('former')) {
                    members.current.push(text);
                } else if (text && text.toLowerCase().includes('former')) {
                    members.former.push(text.replace(/\(former.*?\)/i, '').trim());
                }
            });

            if (members.current.length === 0 && possibleText) {
                const names = possibleText
                    .split(/[,،]|\sand\s/)
                    .map(name => name.trim())
                    .filter(name => 
                        name.length > 0 && 
                        !name.toLowerCase().includes('member') &&
                        !/^\d+$/.test(name)
                    );
                members.current.push(...names);
            }
        }
    });

    // Try to extract members from description if still empty
    if (members.current.length === 0) {
        const memberMatch = info.description.match(/(?:consists of|includes|members:?|members are)\s+([^\.]+)/i);
        if (memberMatch) {
            const names = memberMatch[1]
                .split(/[,،]|\sand\s/)
                .map(name => name.trim())
                .filter(name => 
                    name.length > 0 && 
                    !name.toLowerCase().includes('member') &&
                    !/^\d+$/.test(name)
                );
            members.current.push(...names);
        }
    }

    if (members.current.length > 0 || members.former.length > 0) {
        info.members = {
            current: [...new Set(members.current)], // Remove duplicates
            former: [...new Set(members.former)]
        };
    }

    // Extract meta information
    $('meta').each((_, el) => {
        const property = $(el).attr('property');
        const name = $(el).attr('name');
        const content = $(el).attr('content');
        if (property && content) {
            info.meta[property] = content;
        } else if (name && content) {
            info.meta[name] = content;
        }
    });

    // Extract profile image with strict filtering
    const possibleImages = [
        ...Array.from($('meta[property="og:image"]')).map(el => $(el).attr('content')),
        ...Array.from($('link[rel="image_src"]')).map(el => $(el).attr('href')),
        ...Array.from($('img[src*="documents"]')).map(el => $(el).attr('src'))
    ].filter(url => url && !url.includes('favicon') && !url.includes('logo'));

    info.imageUrl = possibleImages[0];

    // Extract social media with strict filtering for official accounts
    $('a[href*="instagram.com"], a[href*="twitter.com"], a[href*="facebook.com"], a[href*="youtube.com"], a[href*="tiktok.com"]').each((_, el) => {
        const href = $(el).attr('href');
        if (!href || href.includes('kpopping.com')) return;

        if (href.includes('instagram.com')) info.socialMedia.instagram = href;
        else if (href.includes('twitter.com')) info.socialMedia.twitter = href;
        else if (href.includes('facebook.com')) info.socialMedia.facebook = href;
        else if (href.includes('youtube.com')) info.socialMedia.youtube = href;
        else if (href.includes('tiktok.com')) info.socialMedia.tiktok = href;
    });

    // Clean up social media if empty
    if (Object.keys(info.socialMedia).length === 0) {
        delete info.socialMedia;
    }

    // Extract facts from profile page
    $('.funfacts .fact, .profile-info p:contains("Fun Facts")').each((_, el) => {
        const $el = $(el);
        const text = $el.clone().children('a.btn').remove().end().text().trim();
        if (text && !text.toLowerCase().includes('fun fact')) {
            info.facts.push(text);
        }
    });

    // Extract profile data with better field mapping
    $('.data-grid section, .profile-info dt').each((_, el) => {
        const $section = $(el);
        const name = $section.find('.name').text().trim().toLowerCase() || $section.text().trim().toLowerCase();
        const value = $section.next('dd').text().trim() || $section.find('.value').text().trim();

        if (!name || !value) return;

        // Map common field names to standardized keys
        const fieldMap: Record<string, string> = {
            'birth': 'birth_date',
            'birthday': 'birth_date',
            'birthdate': 'birth_date',
            'height': 'height',
            'weight': 'weight',
            'blood type': 'blood_type',
            'mbti': 'mbti',
            'agency': 'agency',
            'position': 'position',
            'debut': 'debut_date',
            'status': 'status',
            'fandom name': 'fandom_name',
            'fandom color': 'fandom_color'
        };

        const key = fieldMap[name] || name.replace(/[^a-z0-9]/g, '_');

        // Format specific fields
        if (name.includes('height')) {
            const heightMatch = value.match(/(\d+)/);
            info[key] = heightMatch ? parseInt(heightMatch[1]) : value;
        } else if (name.includes('weight')) {
            const weightMatch = value.match(/(\d+)/);
            info[key] = weightMatch ? parseInt(weightMatch[1]) : value;
        } else if (name.includes('fandom')) {
            const nameValue = value.split(/\s+/)[0].trim();
            const colorValue = $section.next().find('[style*="color"]').attr('style')?.match(/color:\s*([^;]+)/)?.[1];
            info.fandom = {
                name: nameValue,
                color: colorValue
            };
        } else {
            info[key] = value;
        }
    });

    // Extract debut info from description with better parsing
    const debutMatches = [
        info.description.match(/debuted\s+(?:on\s+)?([^\.]+?)(?:\s+(?:with|through)\s+(.+?))?\.?$/mi),
        info.description.match(/debut(?:ed)?\s+(?:on\s+)?([^\.]+)/i)
    ];

    for (const match of debutMatches) {
        if (match && match[1]) {
            info.debut = {
                date: match[1].trim(),
                details: match[2]?.trim()
            };
            break;
        }
    }

    return info;
}

async function parseIdolProfile(html: string): Promise<Idol> {
    const $ = cheerio.load(html);
    console.log('Parsing idol profile...');

    const info = await extractProfileInfo($);

    // Create idol object with safer null checks
    const idol: Idol = {
        id: uuidv4(),
        name: info.schema?.name || info.meta?.['og:title']?.replace(/\s+profile.*$/i, '') || '',
        imageUrl: info.imageUrl,
        description: info.schema?.description || info.meta?.['og:description'],
        stageName: info.stageName,
        birthName: info.birth_name || info.schema?.alternateNames?.[0],
        koreanName: info.korean_name || info.schema?.alternateNames?.[1],
        nicknames: info.nicknames?.split(',').map(n => n.trim()),
        birthDate: info.birthday || info.birth_date || info.schema?.birthDate,
        birthplace: info.birthplace ? {
            city: info.birthplace.split(',')[0]?.trim(),
            country: info.birthplace.split(',').pop()?.trim()
        } : undefined,
        height: info.height || info.schema?.height,
        weight: info.weight,
        bloodType: info.blood_type,
        mbti: info.mbti,
        agency: info.agency?.replace(/Entertainment$/i, '').trim(),
        position: info.position,
        positions: info.position?.split(/[,;\/]/).map(p => p.trim()),
        debut: info.debut_date ? {
            date: info.debut_date,
            group: info.debut_group
        } : undefined,
        facts: Array.isArray(info.facts) ? info.facts.map(f => f.text || f) : [],
        socialMedia: info.socialMedia && Object.keys(info.socialMedia).length > 0 ? info.socialMedia : undefined
    };

    // Clean up undefined values
    Object.keys(idol).forEach(key => {
        if (idol[key] === undefined ||
            (Array.isArray(idol[key]) && idol[key].length === 0) ||
            (typeof idol[key] === 'object' && !Array.isArray(idol[key]) && Object.keys(idol[key]).length === 0)) {
            delete idol[key];
        }
    });

    return idol;
}

async function parseGroupProfile(html: string): Promise<Group> {
    const $ = cheerio.load(html);
    console.log('Parsing group profile...');

    const info = await extractProfileInfo($);

    // Create group object with better data handling
    const group: Group = {
        id: uuidv4(),
        name: (info.schema?.name || info.meta?.['og:title'] || '')
            .replace(/\s+(?:profile|members|kpop).*$/i, '')
            .trim(),
        imageUrl: info.imageUrl,
        description: info.schema?.description || info.meta?.['og:description'],
        koreanName: info.korean_name,
        memberHistory: {
            currentMembers: info.members?.current?.map(name => ({ name: name.trim() })) || [],
            formerMembers: info.members?.former?.map(name => ({ name: name.trim() })) || []
        },
        formation: {
            debutDate: info.debut?.date || info.debut_date,
            company: info.agency?.replace(/Entertainment$/i, '').trim(),
            status: info.status?.toLowerCase() as any || 'active'
        },
        fandom: info.fandom?.name ? {
            name: info.fandom.name,
            color: info.fandom.color
        } : undefined,
        facts: Array.isArray(info.facts) ? info.facts.map(f => f.text || f) : [],
        socialMedia: info.socialMedia && Object.keys(info.socialMedia).length > 0 ? info.socialMedia : undefined
    };

    // Clean up undefined values and empty objects
    Object.keys(group).forEach(key => {
        if (group[key] === undefined ||
            (Array.isArray(group[key]) && group[key].length === 0) ||
            (typeof group[key] === 'object' && !Array.isArray(group[key]) && Object.keys(group[key]).length === 0)) {
            delete group[key];
        }
    });

    return group;
}

async function fetchWithRetry(url: string, maxRetries = 3): Promise<string> {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
        try {
            // Add random delay between requests
            if (i > 0) {
                const delay = Math.random() * 2000 + 1000; // 1-3 seconds
                await new Promise(resolve => setTimeout(resolve, delay));
            }
            
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36'
                },
                timeout: 10000
            });
            return response.data;
        } catch (error) {
            lastError = error;
            console.warn(`Attempt ${i + 1} failed:`, error.message);
        }
    }
    throw lastError;
}

async function main() {
    console.log('🔍 Testing profile parsing...');

    try {
        // Create data directory if it doesn't exist
        const dataDir = path.join(__dirname, 'data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        // Test idol profile
        console.log('\nTesting idol profile parsing...');
        const idolHtml = await fetchWithRetry(TEST_PROFILES.idol);
        const idol = await parseIdolProfile(idolHtml);
        fs.writeFileSync(
            path.join(dataDir, 'test_idol.json'),
            JSON.stringify(idol, null, 2)
        );
        console.log('✅ Successfully parsed idol profile');

        // Add delay between requests
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Test group profile
        console.log('\nTesting group profile parsing...');
        const groupHtml = await fetchWithRetry(TEST_PROFILES.group);
        const group = await parseGroupProfile(groupHtml);
        fs.writeFileSync(
            path.join(dataDir, 'test_group.json'),
            JSON.stringify(group, null, 2)
        );
        console.log('✅ Successfully parsed group profile');

    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

main();