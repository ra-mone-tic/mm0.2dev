/**
 * MeowMap Search Module
 * Handles search functionality and panel management
 */

import { SELECTORS, CLASSES, MESSAGES, DURATIONS, DEVICE_TODAY } from './constants.js';
import { debounce, generateTransliterations, sanitizeHtml } from './utils.js';
import { mapManager } from './map.js';

/**
 * Search state and management
 */
class SearchManager {
  constructor() {
    this.searchInput = null;
    this.searchPanel = null;
    this.searchResults = null;
    this.searchEmpty = null;
    this.searchClear = null;
    this.searchHandle = null;
    this.bottomBar = null;
    this.allEvents = [];
    this.searchDragStartY = null;
    this.isPanelOpen = false;
    this.isInitialized = false;
  }

  /**
   * Initialize search components
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
    this.searchInput = document.getElementById(SELECTORS.globalSearch);
    this.searchPanel = document.getElementById(SELECTORS.searchPanel);
    this.searchResults = document.getElementById(SELECTORS.searchResults);
    this.searchEmpty = document.getElementById(SELECTORS.searchEmpty);
    this.searchClear = document.getElementById(SELECTORS.searchClear);
    this.searchLabel = document.getElementById(SELECTORS.searchLabel);
    this.searchHandle = this.searchPanel?.querySelector('.search-panel__handle');
    this.bottomBar = document.getElementById(SELECTORS.bottomBar);

    console.log('Search elements cached:', {
      searchInput: this.searchInput,
      searchPanel: this.searchPanel,
      searchResults: this.searchResults
    });
  }

  /**
   * Setup event listeners
   * @private
   */
  _setupEventListeners() {
    // Update bottom bar offset on resize
    this._updateBottomBarOffset();
    window.addEventListener('resize', () => this._updateBottomBarOffset());

    if (this.searchInput) {
      this.searchInput.addEventListener('focus', () => this.openPanel());
      this.searchInput.addEventListener('input', (event) => {
        this._handleInput(event.target.value);
      });
      this.searchInput.addEventListener('keydown', (event) => this._handleKeydown(event));
    }

    if (this.searchClear) {
      this.searchClear.addEventListener('click', () => this._clearSearch());
    }

    if (this.searchHandle) {
      this.searchHandle.addEventListener('click', () => this.closePanel());
    }

    if (this.searchPanel) {
      // Touch drag handling
      this.searchPanel.addEventListener('pointerdown', (event) => this._handlePointerDown(event));
      this.searchPanel.addEventListener('pointermove', (event) => this._handlePointerMove(event));
      this.searchPanel.addEventListener('pointerup', () => this._resetDrag());
      this.searchPanel.addEventListener('pointercancel', () => this._resetDrag());
    }

    // Close on outside click
    document.addEventListener('pointerdown', (event) => {
      if (this.isPanelOpen &&
          this.searchPanel &&
          !this.searchPanel.contains(event.target) &&
          !this.bottomBar?.contains(event.target)) {
        this.closePanel();
      }
    });

    // Close on escape
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.isPanelOpen) {
        this.closePanel();
        this.searchInput?.focus();
      }
    });
  }

  /**
   * Set events data
   * @param {Array} events - All events array
   */
  setEvents(events) {
    this.allEvents = events;
  }

  /**
   * Handle search input
   * @param {string} query - Search query
   * @private
   */
  _handleInput(query) {
    this._toggleClearButton(query);
    if (this.isPanelOpen) {
      this._renderResults(query);
    }
  }

  /**
   * Handle keyboard events
   * @param {KeyboardEvent} event - Keyboard event
   * @private
   */
  _handleKeydown(event) {
    if (event.key === 'Escape') {
      this.closePanel();
      return;
    }

    if (event.key === 'ArrowDown' && this.isPanelOpen) {
      event.preventDefault();
      const firstItem = this.searchResults?.firstElementChild;
      if (firstItem) {
        firstItem.focus();
      }
    }
  }

  /**
   * Handle pointer down for drag
   * @param {PointerEvent} event - Pointer event
   * @private
   */
  _handlePointerDown(event) {
    if (event.pointerType !== 'touch' || this.searchResults?.contains(event.target)) {
      this.searchDragStartY = null;
      return;
    }
    this.searchDragStartY = event.clientY;
  }

  /**
   * Handle pointer move for drag
   * @param {PointerEvent} event - Pointer event
   * @private
   */
  _handlePointerMove(event) {
    if (this.searchDragStartY === null || event.pointerType !== 'touch') return;

    const delta = event.clientY - this.searchDragStartY;
    if (delta > 80) {
      this.searchDragStartY = null;
      this.closePanel();
    }
  }

  /**
   * Reset drag state
   * @private
   */
  _resetDrag() {
    this.searchDragStartY = null;
  }

  /**
   * Update bottom bar offset for search panel positioning
   * @private
   */
  _updateBottomBarOffset() {
    if (!this.bottomBar) {
      document.documentElement.style.setProperty('--search-panel-offset', '0px');
      return;
    }
    const offset = this.bottomBar.offsetHeight;
    document.documentElement.style.setProperty('--search-panel-offset', `${offset}px`);
  }

  /**
   * Toggle clear button visibility
   * @param {string} query - Current query
   * @private
   */
  _toggleClearButton(query) {
    if (!this.searchClear) return;

    if (query.trim()) {
      this.searchClear.classList.add('is-visible');
    } else {
      this.searchClear.classList.remove('is-visible');
    }
  }

  /**
   * Clear search
   * @private
   */
  _clearSearch() {
    if (this.searchInput) {
      this.searchInput.value = '';
      this._toggleClearButton('');
      this._renderResults('');
      this.searchInput.focus();
    }
  }

  /**
   * Render search results
   * @param {string} query - Search query
   * @private
   */
  _renderResults(query = '') {
    if (!this.searchResults || !this.searchEmpty) return;

    const normalizedQuery = query.trim().toLowerCase();

    // Clear previous results
    this.searchResults.innerHTML = '';

    if (!this.allEvents.length) {
      this.searchEmpty.textContent = MESSAGES.loading;
      this.searchEmpty.hidden = false;
      return;
    }

    let matches;
    if (!normalizedQuery) {
      // Show hints - all upcoming events
      matches = this.allEvents;
      if (this.searchLabel) {
        this.searchLabel.textContent = 'Подсказки';
      }
    } else {
      // Search with transliteration
      const searchVariants = Array.from(generateTransliterations(query));

      matches = this.allEvents.filter(event => {
        const eventText = `${event.title} ${event.location}`.toLowerCase();
        return searchVariants.some(variant => {
          const normalizedVariant = variant.trim().toLowerCase();
          return eventText.includes(normalizedVariant);
        });
      });

      if (this.searchLabel) {
        this.searchLabel.textContent = 'Результаты';
      }
    }

    if (!matches.length) {
      this.searchEmpty.textContent = MESSAGES.noResults;
      this.searchEmpty.hidden = false;
      return;
    }

    this.searchEmpty.hidden = true;

    matches.forEach(event => {
      const item = document.createElement('li');
      item.dataset.eventId = event.id;
      item.setAttribute('role', 'option');
      item.tabIndex = 0;

      const dateLabel = this._getSimpleDateLabel(event.date, event.text);
      item.innerHTML = `<strong>${sanitizeHtml(event.title)}</strong><span>${sanitizeHtml(event.location)}</span><span>${sanitizeHtml(dateLabel)}</span>`;

      this.searchResults.appendChild(item);
    });
  }

  /**
   * Get simple date label for search results
   * @param {string} dateStr - Date string
   * @param {string} eventText - Event text
   * @returns {string} Formatted date
   * @private
   */
  _getSimpleDateLabel(dateStr, eventText) {
    // Check if today
    if (dateStr === DEVICE_TODAY) {
      return 'Сегодня';
    }

    // Check if YYYY-MM-DD
    const mYmd = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (mYmd) {
      const day = parseInt(mYmd[3]);
      const month = parseInt(mYmd[2]);
      const yearFull = parseInt(mYmd[1]);
      const year = yearFull % 100;
      return `${day.toString().padStart(2, '0')}.${month.toString().padStart(2, '0')}.${year.toString().padStart(2, '0')}`;
    }

    // Check if dd.mm
    const mDm = dateStr.match(/^(\d{1,2})\.(\d{1,2})$/);
    if (mDm) {
      const day = parseInt(mDm[1]);
      const month = parseInt(mDm[2]) - 1; // 0-based
      const todayDate = new Date(DEVICE_TODAY + 'T00:00:00');
      const eventDate = new Date(todayDate.getFullYear(), month, day);
      let year = todayDate.getFullYear() % 100;

      // If the date has passed this year, assume next year
      if (eventDate < todayDate) {
        year = (todayDate.getFullYear() + 1) % 100;
      }

      return `${day.toString().padStart(2, '0')}.${(month + 1).toString().padStart(2, '0')}.${year.toString().padStart(2, '0')}`;
    }

    return dateStr;
  }

  /**
   * Open search panel
   */
  openPanel() {
    if (!this.searchPanel || this.isPanelOpen) return;

    // Close popups
    mapManager.closeAllPopups();
    document.dispatchEvent(new CustomEvent('sidebar:opening'));

    this.searchPanel.classList.add('open');
    this.searchPanel.setAttribute('aria-hidden', 'false');
    this.isPanelOpen = true;

    this._renderResults(this.searchInput?.value ?? '');
  }

  /**
   * Close search panel
   * @param {Object} options - Options
   */
  closePanel(options = {}) {
    const { blur = true } = options;

    if (!this.searchPanel || !this.isPanelOpen) {
      if (blur && this.searchInput) {
        this.searchInput.blur();
      }
      return;
    }

    this.searchPanel.classList.remove('open');
    this.searchPanel.setAttribute('aria-hidden', 'true');
    this.isPanelOpen = false;

    if (blur && this.searchInput) {
      this.searchInput.blur();
    }
  }
}

// Export singleton instance
export const searchManager = new SearchManager();
