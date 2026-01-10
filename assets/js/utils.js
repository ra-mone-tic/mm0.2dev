/**
 * MeowMap Utility Functions
 * Shared utility functions used across modules
 */

import { DEVICE_TODAY, MESSAGES } from './constants.js';

/**
 * Debounce function calls
 * @param {Function} fn - Function to debounce
 * @param {number} delay - Delay in milliseconds
 * @returns {Function} Debounced function
 */
export function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Geocode cache for coordinates
 */
let geocodeCache = {};
let cacheLoaded = false;

/**
 * Load geocode cache from JSON
 * @returns {Promise<Object>} Cache object
 */
export async function loadGeocodeCache() {
  if (cacheLoaded) return geocodeCache;

  try {
    const response = await fetch('/geocode_cache.json');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    geocodeCache = await response.json();
    cacheLoaded = true;
    console.log(`Geocode cache loaded: ${Object.keys(geocodeCache).length} addresses`);
    return geocodeCache;
  } catch (error) {
    console.error('Failed to load geocode cache:', error);
    geocodeCache = {};
    cacheLoaded = true;
    return {};
  }
}

/**
 * Get coordinates from cache
 * @param {string} location - Location string
 * @returns {Array|null} [lat, lon] or null
 */
export function getCoordinatesFromCache(location) {
  if (!cacheLoaded || !location) return null;

  const normalizedLocation = location.trim();

  // Exact match
  if (geocodeCache[normalizedLocation]) {
    return geocodeCache[normalizedLocation];
  }

  // Partial match
  for (const [cachedLocation, coordinates] of Object.entries(geocodeCache)) {
    if (normalizedLocation.includes(cachedLocation) || cachedLocation.includes(normalizedLocation)) {
      return coordinates;
    }
  }

  return null;
}

/**
 * Update event coordinates from cache if missing
 * @param {Object} event - Event object
 * @returns {Object} Updated event
 */
export function updateEventCoordinates(event) {
  if (event.lat && event.lon) {
    return event;
  }

  const coordinates = getCoordinatesFromCache(event.location);
  if (coordinates) {
    event.lat = coordinates[0];
    event.lon = coordinates[1];
    console.log(`Found coordinates for "${event.location}": [${coordinates[0]}, ${coordinates[1]}]`);
  } else {
    console.warn(`Coordinates not found for "${event.location}"`);
  }

  return event;
}

/**
 * Format location string by removing city duplicates
 * @param {string} location - Location string
 * @returns {string} Formatted location
 */
export function formatLocation(location) {
  if (!location) return '';
  return location.replace(/,?\s*Калининград\s*$/i, '');
}

/**
 * Extract time information from event text
 * @param {string} text - Event description text
 * @returns {Object|null} Time information or null
 */
export function extractTimeFromText(text) {
  if (!text) return null;

  // Look for time in formats: "18:00", "18:00-22:00"
  // Use stricter patterns to avoid confusing with dates dd.mm
  const timePatterns = [
    /(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/,  // 18:00 - 22:00 (with colon only)
    /(\d{1,2}):(\d{2})/   // 18:00 (with colon only)
  ];

  for (const pattern of timePatterns) {
    const match = text.match(pattern);
    if (match) {
      if (match.length === 5) {
        // Range format
        const startHour = parseInt(match[1]);
        const startMin = parseInt(match[2]);
        const endHour = parseInt(match[3]);
        const endMin = parseInt(match[4]);

        // Validate as time, not date
        if (startHour >= 0 && startHour <= 23 &&
            startMin >= 0 && startMin <= 59 &&
            endHour >= 0 && endHour <= 23 &&
            endMin >= 0 && endMin <= 59) {
          return {
            full: `${startHour.toString().padStart(2, '0')}:${startMin.toString().padStart(2, '0')}-${endHour.toString().padStart(2, '0')}:${endMin.toString().padStart(2, '0')}`,
            start: `${startHour.toString().padStart(2, '0')}:${startMin.toString().padStart(2, '0')}`,
            end: `${endHour.toString().padStart(2, '0')}:${endMin.toString().padStart(2, '0')}`,
            hasEndTime: true
          };
        }
      } else if (match.length === 3) {
        // Single time format
        const hour = parseInt(match[1]);
        const min = parseInt(match[2]);

        if (hour >= 0 && hour <= 23 && min >= 0 && min <= 59) {
          return {
            full: `${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`,
            start: `${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`,
            end: null,
            hasEndTime: false
          };
        }
      }
    }
  }

  return null;
}

/**
 * Generate event date label with time information
 * @param {string} dateStr - Date string (YYYY-MM-DD or DD.MM)
 * @param {string} eventText - Event description text
 * @param {boolean} showTimeAgo - Whether to show "ended X hours ago"
 * @param {boolean} showOnlyTimeForToday - Show only time for today's events
 * @returns {string} Formatted date label
 */
export function getEventDateLabel(dateStr, eventText = null, showTimeAgo = false, showOnlyTimeForToday = false) {
  const timeStr = eventText ? extractTimeFromText(eventText) : null;

  if (dateStr === DEVICE_TODAY) {
    if (showOnlyTimeForToday) {
      return timeStr ? `<span style="font-style: italic;">${timeStr.full}</span>` : '';
    } else {
      let result = '<span style="font-weight: bold; font-style: italic;">Сегодня</span>';

      if (timeStr) {
        result += ` <span style="font-style: italic;">${timeStr.full}</span>`;
      }

      if (showTimeAgo && timeStr && timeStr.hasEndTime) {
        const timeAgoText = getTimeAgoText(dateStr, timeStr.end, timeStr.start);
        if (timeAgoText) {
          result += `<br><span style="font-size: 11px; color: var(--text-2);">${timeAgoText}</span>`;
        }
      }

      return result;
    }
  }

  if (!dateStr) return '';

  let formattedDate = '';
  const today = new Date(DEVICE_TODAY + 'T00:00:00');

  // Try YYYY-MM-DD first
  const mYmd = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (mYmd) {
    const day = parseInt(mYmd[3]);
    const month = parseInt(mYmd[2]);
    const year = mYmd[1].slice(-2); // last 2 digits of year
    formattedDate = `${day.toString().padStart(2, '0')}.${month.toString().padStart(2, '0')}.${year}`;
  } else {
  // Try DD.MM.YYYY or DD.MM.YY format (year specified explicitly)
  const mDmY = dateStr.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (mDmY) {
    const day = parseInt(mDmY[1]);
    const month = parseInt(mDmY[2]);
    let year = parseInt(mDmY[3]);
    // Handle YY format (assume 20XX for years 00-99)
    if (year < 100) {
      year += 2000;
    }
    formattedDate = `${day.toString().padStart(2, '0')}.${month.toString().padStart(2, '0')}.${year.toString().slice(-2)}`;
  } else {
  // Try DD.MM format (no year specified - use universal logic)
  const mDm = dateStr.match(/^(\d{1,2})\.(\d{1,2})$/);
  if (mDm) {
    // Universal rule: dates without year are interpreted based on current month
    const day = parseInt(mDm[1]);
    let month = parseInt(mDm[2]) - 1; // 0-based
    let year = today.getFullYear();
    const currentMonth = today.getMonth(); // 0-11

    // If we're in the second half of the year (July-December),
    // dates from January-June belong to next year
    if (currentMonth >= 6 && month <= 5) { // July-December current year
      year += 1; // Next year for January-June dates
    }
    formattedDate = `${day.toString().padStart(2, '0')}.${(month + 1).toString().padStart(2, '0')}.${year.toString().slice(-2)}`;
  }
  }
  }

  let result = `<span style="font-weight: bold; font-style: italic;">${formattedDate}</span>`;

  if (timeStr) {
    result += ` <span style="font-style: italic;">${timeStr.full}</span>`;
  }

  if (showTimeAgo && timeStr && timeStr.hasEndTime) {
    const timeAgoText = getTimeAgoText(dateStr, timeStr.end, timeStr.start);
    if (timeAgoText) {
      result += `<br><span style="font-size: 11px; color: var(--text-2);">${timeAgoText}</span>`;
    }
  }

  return result;
}

/**
 * Get day of week name in Russian
 * @param {number} dayIndex - Day index (0 = Sunday, 1 = Monday, etc.)
 * @returns {string} Day name
 */
export function getDayOfWeekName(dayIndex) {
  const daysOfWeek = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
  return daysOfWeek[dayIndex] || '';
}

/**
 * Get day of week from date string
 * Supports YYYY-MM-DD and DD.MM formats with optional year
 * @param {string} dateStr - Date string
 * @returns {number} Day index (0 = Sunday, 1 = Monday, etc.)
 */
export function getDayOfWeekFromDate(dateStr) {
  if (!dateStr) return -1;

  const today = new Date(DEVICE_TODAY + 'T00:00:00');

  // Try YYYY-MM-DD first
  const mYmd = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (mYmd) {
    const year = parseInt(mYmd[1]);
    const month = parseInt(mYmd[2]) - 1;
    const day = parseInt(mYmd[3]);
    const date = new Date(year, month, day);
    return date.getDay();
  }

  // Try DD.MM.YYYY or DD.MM.YY format (year specified explicitly)
  const mDmY = dateStr.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (mDmY) {
    const day = parseInt(mDmY[1]);
    const month = parseInt(mDmY[2]) - 1; // 0-based
    let year = parseInt(mDmY[3]);
    // Handle YY format (assume 20XX for years 00-99)
    if (year < 100) {
      year += 2000;
    }
    const date = new Date(year, month, day);
    return date.getDay();
  }

  // Try DD.MM format (no year specified - use universal logic)
  const mDm = dateStr.match(/^(\d{1,2})\.(\d{1,2})$/);
  if (mDm) {
    // Universal rule: dates without year are interpreted based on current month
    const day = parseInt(mDm[1]);
    let month = parseInt(mDm[2]) - 1; // 0-based
    let year = today.getFullYear();
    const currentMonth = today.getMonth(); // 0-11

    // If we're in the second half of the year (July-December),
    // dates from January-June belong to next year
    if (currentMonth >= 6 && month <= 5) { // July-December current year
      year += 1; // Next year for January-June dates
    }
    const date = new Date(year, month, day);
    return date.getDay();
  }

  return -1;
}

/**
 * Parse date string for sorting purposes
 * Handles multi-date strings like "12.11\n13.11" by extracting first date
 * @param {string} dateStr - Date string
 * @returns {Date} Parsed Date object
 */
export function parseDateForSorting(dateStr) {
  if (!dateStr) return new Date(0);

  const today = new Date(DEVICE_TODAY + 'T00:00:00');

  // Try YYYY-MM-DD first
  const mYmd = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (mYmd) {
    const year = parseInt(mYmd[1]);
    const month = parseInt(mYmd[2]) - 1;
    const day = parseInt(mYmd[3]);
    return new Date(year, month, day);
  }

  // Try DD.MM.YYYY or DD.MM.YY format (year specified explicitly) - extract first match
  const mDmY = dateStr.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (mDmY) {
    const day = parseInt(mDmY[1]);
    const month = parseInt(mDmY[2]) - 1; // 0-based
    let year = parseInt(mDmY[3]);
    // Handle YY format (assume 20XX for years 00-99)
    if (year < 100) {
      year += 2000;
    }
    return new Date(year, month, day);
  }

  // Extract first DD.MM from string (no year specified - use universal logic)
  const mDm = dateStr.match(/(\d{1,2})\.(\d{1,2})/);
  if (mDm) {
    // Universal rule: dates without year are interpreted based on current month
    const day = parseInt(mDm[1]);
    let month = parseInt(mDm[2]) - 1; // 0-based
    let year = today.getFullYear();
    const currentMonth = today.getMonth(); // 0-11

    // If we're in the second half of the year (July-December),
    // dates from January-June belong to next year
    if (currentMonth >= 6 && month <= 5) { // July-December current year
      year += 1; // Next year for January-June dates
    }
    const date = new Date(year, month, day);
    return date;
  }

  // Fallback
  return new Date(dateStr);
}

/**
 * Calculate time ago text for ended events
 * @param {string} eventDateStr - Event date (YYYY-MM-DD)
 * @param {string} endTimeStr - End time (HH:MM)
 * @param {string} startTimeStr - Start time (HH:MM)
 * @returns {string|null} Time ago text or null
 */
export function getTimeAgoText(eventDateStr, endTimeStr, startTimeStr) {
  if (!endTimeStr || !eventDateStr) return null;

  // Calculate exact end time considering date and midnight rollover
  let endDateStr = eventDateStr;
  const startHour = startTimeStr ? parseInt(startTimeStr.split(':')[0]) : 0;
  const endHour = parseInt(endTimeStr.split(':')[0]);

  if (endHour < startHour) {
    // Event ends next day
    const date = new Date(eventDateStr);
    date.setDate(date.getDate() + 1);
    endDateStr = date.toISOString().slice(0, 10);
  }

  const endTime = new Date(endDateStr + 'T' + endTimeStr + ':00');
  const now = new Date();

  // Event hasn't ended yet
  if (endTime > now) return null;

  const diffInMs = now - endTime;
  const hours = Math.ceil(diffInMs / (1000 * 60 * 60));

  if (hours === 1) return 'Закончилось 1 час назад';
  if (hours < 5) return `Закончилось ${hours} часа назад`;
  return `Закончилось ${hours} часов назад`;
}

/**
 * Generate transliterations for search
 * @param {string} text - Text to transliterate
 * @returns {Set} Set of transliterations
 */
export function generateTransliterations(text) {
  const results = new Set([text]);

  // Basic transliterations
  if (/[а-яё]/i.test(text)) {
    results.add(transliterateToEnglish(text));
  }

  if (/[a-z]/i.test(text)) {
    results.add(transliterateToRussian(text));

    // For longer queries, also add partial transliterations
    if (text.length >= 4) {
      // Add transliteration of first few characters (for partial matches)
      const partialLength = Math.min(4, text.length);
      const partial = text.substring(0, partialLength);
      results.add(transliterateToRussian(partial));

      // Add transliteration of last few characters
      if (text.length > 4) {
        const lastPartial = text.substring(text.length - 4);
        results.add(transliterateToRussian(lastPartial));
      }
    }
  }

  // For Russian queries, also try removing soft signs and common variations
  if (/[а-яё]/i.test(text)) {
    // Remove soft signs (ь) as they might not be present in search
    results.add(text.replace(/[ьъ]/gi, ''));

    // For longer words, add versions without soft signs
    if (text.length > 3) {
      results.add(text.replace(/[ьъ]/gi, ''));
    }
  }

  return results;
}

/**
 * Transliterate Russian to English
 * @param {string} text - Russian text
 * @returns {string} English transliteration
 */
export function transliterateToEnglish(text) {
  const translitMap = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo', 'ж': 'zh',
    'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
    'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts',
    'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu',
    'я': 'ya', 'А': 'A', 'Б': 'B', 'В': 'V', 'Г': 'G', 'Д': 'D', 'Е': 'E', 'Ё': 'Yo',
    'Ж': 'Zh', 'З': 'Z', 'И': 'I', 'Й': 'Y', 'К': 'K', 'Л': 'L', 'М': 'M', 'Н': 'N',
    'О': 'O', 'П': 'P', 'Р': 'R', 'С': 'S', 'Т': 'T', 'У': 'U', 'Ф': 'F', 'Х': 'Kh',
    'Ц': 'Ts', 'Ч': 'Ch', 'Ш': 'Sh', 'Щ': 'Sch', 'Ъ': '', 'Ы': 'Y', 'Ь': '', 'Э': 'E',
    'Ю': 'Yu', 'Я': 'Ya'
  };

  return text.split('').map(char => translitMap[char] || char).join('');
}

/**
 * Transliterate English to Russian (extended)
 * @param {string} text - English text
 * @returns {string} Russian transliteration
 */
export function transliterateToRussian(text) {
  // Handle multi-character combinations first (longest to shortest)
  const multiCharMap = {
    'yo': 'ё', 'zh': 'ж', 'kh': 'х', 'ts': 'ц', 'ch': 'ч', 'sh': 'ш', 'sch': 'щ',
    'yu': 'ю', 'ya': 'я', 'ye': 'е', 'yi': 'й',
    'YO': 'Ё', 'ZH': 'Ж', 'KH': 'Х', 'TS': 'Ц', 'CH': 'Ч', 'SH': 'Ш', 'SCH': 'Щ',
    'YU': 'Ю', 'YA': 'Я', 'YE': 'Е', 'YI': 'Й'
  };

  let result = text;

  // Replace multi-character combinations first
  for (const [eng, rus] of Object.entries(multiCharMap)) {
    result = result.split(eng).join(rus);
  }

  // Then replace single characters
  const singleCharMap = {
    'a': 'а', 'b': 'б', 'v': 'в', 'g': 'г', 'd': 'д', 'e': 'е', 'z': 'з', 'i': 'и',
    'y': 'й', 'k': 'к', 'l': 'л', 'm': 'м', 'n': 'н', 'o': 'о', 'p': 'п', 'r': 'р',
    's': 'с', 't': 'т', 'u': 'у', 'f': 'ф', 'h': 'х', 'c': 'к', 'w': 'в', 'q': 'к',
    'A': 'А', 'B': 'Б', 'V': 'В', 'G': 'Г', 'D': 'Д', 'E': 'Е', 'Z': 'З', 'I': 'И',
    'Y': 'Й', 'K': 'К', 'L': 'Л', 'M': 'М', 'N': 'Н', 'O': 'О', 'P': 'П', 'R': 'Р',
    'S': 'С', 'T': 'Т', 'U': 'У', 'F': 'Ф', 'H': 'Х', 'C': 'К', 'W': 'В', 'Q': 'К'
  };

  // Replace single characters
  for (const [eng, rus] of Object.entries(singleCharMap)) {
    result = result.split(eng).join(rus);
  }

  return result;
}

/**
 * Generate unique event ID from event data
 * @param {Object} event - Event object
 * @returns {string} Unique event ID
 */
export function makeEventId(event) {
  const source = `${event.date}|${event.title}|${event.lat}|${event.lon}`;
  let hash = 5381;
  for (let i = 0; i < source.length; i += 1) {
    hash = ((hash << 5) + hash) + source.charCodeAt(i);
  }
  return `e${(hash >>> 0).toString(16)}`;
}

/**
 * Bind keyboard activation for elements
 * @param {HTMLElement} element - Element to bind
 * @param {Function} handler - Handler function
 */
export function bindKeyboardActivation(element, handler) {
  if (!element) return;
  element.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handler();
    }
  });
}

/**
 * Get local date string in YYYY-MM-DD format
 * @param {Date} date - Date object
 * @returns {string} YYYY-MM-DD string in local time
 */
export function getLocalDateString(date) {
  if (!(date instanceof Date)) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Sanitize HTML content to prevent XSS attacks
 * Removes dangerous tags and attributes, allows only safe text formatting
 * @param {string} html - HTML content to sanitize
 * @returns {string} Sanitized HTML content
 */
export function sanitizeHtml(html) {
  if (!html || typeof html !== 'string') return '';

  // Create a temporary DOM element to parse HTML
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;

  // Remove dangerous elements
  const dangerousElements = tempDiv.querySelectorAll('script, style, iframe, object, embed, form, input, button, link, meta');
  dangerousElements.forEach(element => element.remove());

  // Remove dangerous attributes
  const allElements = tempDiv.querySelectorAll('*');
  allElements.forEach(element => {
    // Remove event handlers and dangerous atributes
    const dangerousAttrs = ['onclick', 'onload', 'onerror', 'onsubmit', 'onmouseover', 'onmouseout', 'onkeydown', 'onkeyup', 'onkeypress', 'onchange', 'onfocus', 'onblur', 'onselect', 'oncontextmenu', 'ondblclick', 'onmousedown', 'onmouseup', 'onmousemove', 'onmouseenter', 'onmouseleave', 'ontouchstart', 'ontouchend', 'ontouchmove', 'ontouchcancel', 'onscroll', 'onwheel', 'oncopy', 'oncut', 'onpaste', 'ondrag', 'ondragend', 'ondragenter', 'ondragleave', 'ondragover', 'ondragstart', 'ondrop', 'onabort', 'onbeforeunload', 'onhashchange', 'onloadstart', 'onprogress', 'onstalled', 'onsuspend', 'onemptied', 'onloadeddata', 'onloadedmetadata', 'oncanplay', 'oncanplaythrough', 'onplay', 'onpause', 'onvolumechange', 'onwaiting', 'onseeking', 'onseeked', 'ontimeupdate', 'onended', 'onratechange', 'ondurationchange'];
    dangerousAttrs.forEach(attr => {
      if (element.hasAttribute(attr)) {
        element.removeAttribute(attr);
      }
    });
  });

  return tempDiv.innerHTML;
}
