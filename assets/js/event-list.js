/**
 * MeowMap Event List Module
 * Handles event list display and sidebar management
 */

import { SELECTORS, CLASSES, DEVICE_TODAY, DURATIONS } from './constants.js';
import {
  getEventDateLabel,
  getDayOfWeekName,
  getDayOfWeekFromDate,
  getTimeAgoText,
  formatLocation,
  bindKeyboardActivation,
  sanitizeHtml,
  parseDateForSorting,
  getLocalDateString
} from './utils.js';
import { mapManager } from './map.js';

/**
 * Event list state and management
 */
class EventListManager {
  constructor() {
    this.allEvents = [];
    this.upcomingEvents = [];
    this.archiveEvents = [];
    this.showingArchive = false;
    this.listContainer = null;
    this.archiveButton = null;
    this.sidebar = null;
    this.burger = null;
    this.bottomBar = null;
    this.isInitialized = false;
  }

  /**
   * Initialize event list components
   */
  init() {
    this._cacheElements();
    this._setupEventListeners();
    this.isInitialized = true;
  }

  /**
   * Cache DOM elements
   * @private
   */
  _cacheElements() {
    this.listContainer = document.getElementById(SELECTORS.upcoming);
    this.archiveButton = document.getElementById(SELECTORS.archiveButton);
    this.sidebar = document.getElementById(SELECTORS.sidebar);
    this.burger = document.getElementById(SELECTORS.burger);
    this.bottomBar = document.getElementById(SELECTORS.bottomBar);
  }

  /**
   * Setup event listeners
   * @private
   */
  _setupEventListeners() {
    if (this.archiveButton) {
      this.archiveButton.addEventListener('click', () => this.toggleArchive());
    }

    if (this.burger) {
      this.burger.addEventListener('click', () => this.toggleSidebar());
      bindKeyboardActivation(this.burger, () => this.toggleSidebar());
    }

    // Close sidebar on outside click
    document.addEventListener('click', (event) => {
      if (this.sidebar?.classList.contains(CLASSES.open) &&
          !this.sidebar.contains(event.target) &&
          event.target !== this.burger) {
        this.closeSidebar();
      }
    });

    // Delegate click handlers for event items
    if (this.listContainer) {
      this.listContainer.addEventListener('click', (event) => {
        const item = event.target.closest('.item');
        if (item) {
          this._handleEventClick(item);
        }
      });

      this.listContainer.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          const item = event.target.closest('.item');
          if (item) {
            event.preventDefault();
            this._handleEventClick(item);
          }
        }
      });
    }
  }

  /**
   * Handle event item click
   * @param {HTMLElement} item - Event item element
   * @private
   */
  _handleEventClick(item) {
    const eventId = item.dataset.eventId;
    const eventData = this.allEvents.find(ev => ev.id === eventId);

    if (eventData) {
      // Emit event for other modules to handle
      const event = new CustomEvent('event:selected', { detail: eventData });
      document.dispatchEvent(event);
    }
  }

  /**
   * Set events data
   * @param {Array} allEvents - All events array
   * @param {Array} upcomingEvents - Upcoming events array
   * @param {Array} archiveEvents - Archive events array
   */
  setEvents(allEvents, upcomingEvents = null, archiveEvents = null) {
    this.allEvents = allEvents;

    if (upcomingEvents && archiveEvents) {
      // Use provided categorization
      this.upcomingEvents = upcomingEvents;
      this.archiveEvents = archiveEvents;
    } else {
      // Fallback to self-categorization
      this._categorizeEvents();
    }

    this._updateArchiveButtonLabel();
    this.renderList();
  }

  /**
   * Categorize events into upcoming and archive
   * @private
   */
  _categorizeEvents() {
    const todayYmd = DEVICE_TODAY;
    const now = new Date();

    this.upcomingEvents = this.allEvents.filter(event => {
      const eventYmd = getLocalDateString(parseDateForSorting(event.date));
      if (eventYmd > todayYmd) return true; // Future dates
      if (eventYmd < todayYmd) return false; // Past dates

      // Today's events - check if still active
      const timeInfo = event.text ? this._extractTimeFromText(event.text) : null;
      if (!timeInfo || !timeInfo.hasEndTime) return true; // No end time = upcoming

      const timeAgoText = getTimeAgoText(event.date, timeInfo.end, timeInfo.start);
      return !timeAgoText; // If no "ended ago" text, it's upcoming
    });

    this.archiveEvents = this.allEvents.filter(event => {
      const eventYmd = getLocalDateString(parseDateForSorting(event.date));
      if (eventYmd > todayYmd) return false; // Future dates
      if (eventYmd < todayYmd) return true; // Past dates

      // Today's events - check if ended
      const timeInfo = event.text ? this._extractTimeFromText(event.text) : null;
      if (!timeInfo || !timeInfo.hasEndTime) return false; // No end time = not archive

      const timeAgoText = getTimeAgoText(event.date, timeInfo.end, timeInfo.start);
      return !!timeAgoText; // If has "ended ago" text, it's archive
    });

    // If no upcoming events but archive exists, start with archive
    if (!this.upcomingEvents.length && this.archiveEvents.length) {
      this.showingArchive = true;
    }
  }

  /**
   * Extract time from text (local helper)
   * @param {string} text - Text to parse
   * @returns {Object|null} Time info
   * @private
   */
  _extractTimeFromText(text) {
    if (!text) return null;

    const timePatterns = [
      /(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/,
      /(\d{1,2}):(\d{2})/
    ];

    for (const pattern of timePatterns) {
      const match = text.match(pattern);
      if (match) {
        if (match.length === 5) {
          const startHour = parseInt(match[1]);
          const startMin = parseInt(match[2]);
          const endHour = parseInt(match[3]);
          const endMin = parseInt(match[4]);

          if (startHour >= 0 && startHour <= 23 && startMin >= 0 && startMin <= 59 &&
              endHour >= 0 && endHour <= 23 && endMin >= 0 && endMin <= 59) {
            return {
              start: `${startHour.toString().padStart(2, '0')}:${startMin.toString().padStart(2, '0')}`,
              end: `${endHour.toString().padStart(2, '0')}:${endMin.toString().padStart(2, '0')}`,
              hasEndTime: true
            };
          }
        } else if (match.length === 3) {
          const hour = parseInt(match[1]);
          const min = parseInt(match[2]);

          if (hour >= 0 && hour <= 23 && min >= 0 && min <= 59) {
            return {
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
   * Update archive button label
   * @private
   */
  _updateArchiveButtonLabel() {
    if (!this.archiveButton) return;
    this.archiveButton.textContent = this.showingArchive ? 'Назад' : 'Архив';
  }

  /**
   * Toggle archive view
   */
  toggleArchive() {
    if (!this.allEvents.length) return;
    this.showingArchive = !this.showingArchive;
    this._updateArchiveButtonLabel();
    this.renderList();
  }

  /**
   * Render event list
   */
  renderList() {
    if (!this.listContainer) return;

    const eventsToShow = this.showingArchive ? this.archiveEvents : this.upcomingEvents;

    if (!eventsToShow.length) {
      this.listContainer.innerHTML = this.showingArchive ? 'Архив пуст' : 'Нет ближайших событий';
      return;
    }

    if (this.showingArchive) {
      // Archive: sort by date descending, no grouping
      const sortedEvents = eventsToShow.sort((a, b) => b.date.localeCompare(a.date));
      this.listContainer.innerHTML = '';
      sortedEvents.forEach(event => {
        this.listContainer.appendChild(this._createEventItem(event));
      });
    } else {
      // Upcoming: group by date with headers
      this._renderUpcomingList(eventsToShow);
    }
  }

  /**
   * Render upcoming events with grouping
   * @param {Array} events - Events to render
   * @private
   */
  _renderUpcomingList(events) {
    this.listContainer.innerHTML = '';

    const today = new Date(DEVICE_TODAY + 'T00:00:00');
    const todayYmd = DEVICE_TODAY; // yyyy-mm-dd
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowYmd = getLocalDateString(tomorrow);

    // Helper to get ymd string for event
    const getEventYmd = (dateStr) => getLocalDateString(parseDateForSorting(dateStr));

    // Find nearest date for each day of week
    const nearestDatesByDayOfWeek = this._getNearestDatesByDayOfWeek(events);

    // Filter today's events (including recently ended)
    const todayEvents = events.filter(event => getEventYmd(event.date) === todayYmd).filter(event => {
      const timeInfo = event.text ? this._extractTimeFromText(event.text) : null;
      if (!timeInfo || !timeInfo.hasEndTime) return true;

      const now = new Date();
      const endTime = new Date(`${todayYmd}T${timeInfo.end}:00`);
      if (endTime > now) return true;

      const diffInMs = now - endTime;
      const hours = Math.ceil(diffInMs / (1000 * 60 * 60));
      return hours <= 6; // Show recently ended events
    });

    const tomorrowEvents = events.filter(event => getEventYmd(event.date) === tomorrowYmd);

    // Today's events
    if (todayEvents.length > 0) {
      this.listContainer.appendChild(this._createSectionHeader('Сегодня', true));
      todayEvents.forEach(event => {
        const timeInfo = event.text ? this._extractTimeFromText(event.text) : null;
        const showTimeAgo = timeInfo && timeInfo.hasEndTime &&
                           getTimeAgoText(event.date, timeInfo.end, timeInfo.start);
        this.listContainer.appendChild(this._createEventItem(event, showTimeAgo, true));
      });
    }

    // Tomorrow's events
    if (tomorrowEvents.length > 0) {
      this.listContainer.appendChild(this._createSectionHeader('Завтра'));
      tomorrowEvents.forEach(event => {
        this.listContainer.appendChild(this._createEventItem(event));
      });
    }

    // Other events grouped by nearest day of week
    const dayNames = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];

    dayNames.forEach(dayName => {
      const nearestDate = nearestDatesByDayOfWeek[dayName];
      if (nearestDate) {
        const dayEvents = events.filter(event => getEventYmd(event.date) === nearestDate);
        if (dayEvents.length > 0) {
          this.listContainer.appendChild(this._createSectionHeader(dayName));
          dayEvents.forEach(event => {
            this.listContainer.appendChild(this._createEventItem(event));
          });
        }
      }
    });
  }

  /**
   * Get nearest dates for each day of week
   * @param {Array} events - Events array
   * @returns {Object} Map of day names to nearest dates
   * @private
   */
  _getNearestDatesByDayOfWeek(events) {
    const today = new Date(DEVICE_TODAY + 'T00:00:00');
    const nearestDates = {};

    // Helper to get ymd string for event
    const getEventYmd = (dateStr) => getLocalDateString(parseDateForSorting(dateStr));

    events.forEach(event => {
      const eventDate = new Date(getEventYmd(event.date) + 'T00:00:00');
      const dayOfWeek = getDayOfWeekFromDate(event.date);
      const dayName = getDayOfWeekName(dayOfWeek);

      // Skip today and tomorrow as they are handled separately
      if (getEventYmd(event.date) === DEVICE_TODAY) return;
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      if (getEventYmd(event.date) === getLocalDateString(tomorrow)) return;

      // Check if this is the nearest date for this day of week
      if (!nearestDates[dayName] || eventDate < new Date(nearestDates[dayName] + 'T00:00:00')) {
        nearestDates[dayName] = getEventYmd(event.date);
      }
    });

    return nearestDates;
  }

  /**
   * Create section header
   * @param {string} title - Header title
   * @param {boolean} isToday - Is today section
   * @returns {HTMLElement} Header element
   * @private
   */
  _createSectionHeader(title, isToday = false) {
    const header = document.createElement('div');
    header.className = 'day-section-header';
    header.style.cssText = `
      margin: 16px 0 8px 0;
      padding: 4px 8px;
      background: var(--surface-2);
      border-radius: 9999px;
      font-size: 12px;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-1);
    `;
    header.textContent = title;
    return header;
  }

  /**
   * Create event item element
   * @param {Object} event - Event data
   * @param {boolean} showTimeAgo - Show time ago text
   * @param {boolean} showOnlyTimeForToday - Show only time for today
   * @returns {HTMLElement} Event item element
   * @private
   */
  _createEventItem(event, showTimeAgo = false, showOnlyTimeForToday = false) {
    const item = document.createElement('div');
    item.className = 'item';
    item.dataset.eventId = event.id;
    item.dataset.eventDate = event.date;
    item.setAttribute('role', 'button');
    item.tabIndex = 0;

    const dateLabel = getEventDateLabel(event.date, event.text, showTimeAgo, showOnlyTimeForToday);
    const location = formatLocation(event.location);

    item.innerHTML = `<strong>${sanitizeHtml(event.title)}</strong><br><span style="color:var(--text-1);">${sanitizeHtml(location)}</span><br><i style="color:var(--text-1);">${sanitizeHtml(dateLabel)}</i>`;

    return item;
  }

  /**
   * Highlight event in sidebar
   * @param {string} eventId - Event ID to highlight
   * @param {Object} options - Options
   */
  highlightEvent(eventId, options = {}) {
    const { scroll = true } = options;

    if (!this.listContainer) return;

    // Remove previous highlights
    this.listContainer.querySelectorAll('.item.is-active').forEach(el => {
      el.classList.remove('is-active');
    });

    if (!eventId) return;

    const target = this.listContainer.querySelector(`[data-event-id="${eventId}"]`);
    if (target) {
      target.classList.add('is-active');
      if (scroll) {
        target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }

  /**
   * Toggle sidebar visibility
   */
  toggleSidebar() {
    if (!this.sidebar) return;

    // Close popups when opening sidebar
    if (!this.sidebar.classList.contains(CLASSES.open)) {
      mapManager.closeAllPopups();
      document.dispatchEvent(new CustomEvent('sidebar:opening'));
    }

    this.sidebar.classList.toggle(CLASSES.open);
  }

  /**
   * Close sidebar
   */
  closeSidebar() {
    if (this.sidebar) {
      this.sidebar.classList.remove(CLASSES.open);
    }
  }

  /**
   * Ensure correct list view for event
   * @param {Object} eventData - Event data
   */
  ensureListForEvent(eventData) {
    if (!eventData) return;

    const eventYmd = getLocalDateString(parseDateForSorting(eventData.date));
    const needsArchive = eventYmd < DEVICE_TODAY;
    if (needsArchive !== this.showingArchive) {
      this.showingArchive = needsArchive;
      this._updateArchiveButtonLabel();
      this.renderList();
    }
  }

  /**
   * Get events for date
   * @param {string} dateStr - Date string (YYYY-MM-DD or DD.MM)
   * @returns {Array} Events for the date
   */
  getEventsForDate(dateStr) {
    const normalizedDateStr = getLocalDateString(parseDateForSorting(dateStr));
    return this.allEvents.filter(event => {
      const eventYmd = getLocalDateString(parseDateForSorting(event.date));
      return eventYmd === normalizedDateStr;
    });
  }
}

// Export singleton instance
export const eventListManager = new EventListManager();
