/**
 * MeowMap Main Entry Point
 * Initializes all modules and coordinates their interactions
 */

import { JSON_URL, SELECTORS, DEVICE_TODAY } from './constants.js';
import { makeEventId, extractTimeFromText, getTimeAgoText, parseDateForSorting, getLocalDateString } from './utils.js';
import { mapManager } from './map.js';
import { eventListManager } from './event-list.js';
import { searchManager } from './search.js';
import { calendarManager } from './calendar.js';

/**
 * Application state
 */
const appState = {
  allEvents: [],
  upcomingEvents: [],
  archiveEvents: [],
  isInitialized: false
};

/**
 * Initialize the application
 */
async function init() {
  if (appState.isInitialized) return;

  try {
    console.log('Initializing MeowMap...');

    // Initialize modules
    await initModules();

    // Load events data
    await loadEvents();

    // Setup inter-module communication
    setupEventCommunication();

    // Set initial date
    setInitialDate();

    appState.isInitialized = true;
    console.log('MeowMap initialized successfully');

  } catch (error) {
    console.error('Failed to initialize MeowMap:', error);
  }
}

/**
 * Initialize all modules
 */
async function initModules() {
  // Initialize map first (async)
  await mapManager.init();

  // Initialize other modules
  eventListManager.init();
  searchManager.init();
  calendarManager.init();
}

/**
 * Load events from JSON
 */
async function loadEvents() {
  try {
    console.log('Loading events...');

    const response = await fetch(JSON_URL);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const events = await response.json();

    if (!Array.isArray(events)) {
      throw new Error('Invalid events data format');
    }

    // Process events
    appState.allEvents = events.map(event => ({
      ...event,
      id: event.id || makeEventId(event),
      dateLabel: getEventDateLabel(event.date, event.text)
    }));

    // Expand multi-date events
    appState.allEvents = expandMultiDateEvents(appState.allEvents);

    // Split events into upcoming and archive
    const todayYmd = DEVICE_TODAY;
    appState.upcomingEvents = appState.allEvents.filter(event => {
      const eventYmd = getLocalDateString(parseDateForSorting(event.date));
      if (eventYmd > todayYmd) return true; // Future dates - always upcoming
      if (eventYmd < todayYmd) return false; // Past dates - always archive

      // For today's events, check time
      if (!event.text) return true; // No text - upcoming

      const timeInfo = extractTimeFromText(event.text);
      if (!timeInfo || !timeInfo.hasEndTime) return true; // No end time - upcoming

      // Check if event has ended
      const timeAgoText = getTimeAgoText(event.date, timeInfo.end, timeInfo.start);
      return !timeAgoText; // If has "ended" text, archive, else upcoming
    });

    appState.archiveEvents = appState.allEvents.filter(event => {
      const eventYmd = getLocalDateString(parseDateForSorting(event.date));
      if (eventYmd > todayYmd) return false; // Future dates - not archive
      if (eventYmd < todayYmd) return true; // Past dates - always archive

      // For today's events, check time
      if (!event.text) return false; // No text - not archive

      const timeInfo = extractTimeFromText(event.text);
      if (!timeInfo || !timeInfo.hasEndTime) return false; // No end time - not archive

      // Check if event has ended
      const timeAgoText = getTimeAgoText(event.date, timeInfo.end, timeInfo.start);
      return !!timeAgoText; // If has "ended" text, archive
    });

    // Sort upcoming events by date
    appState.upcomingEvents.sort((a, b) => parseDateForSorting(a.date) - parseDateForSorting(b.date));

    console.log(`Loaded ${appState.allEvents.length} events (${appState.upcomingEvents.length} upcoming, ${appState.archiveEvents.length} archive)`);

    // Update modules with events data
    eventListManager.setEvents(appState.allEvents, appState.upcomingEvents, appState.archiveEvents);
    searchManager.setEvents(appState.upcomingEvents); // Search shows only upcoming

    // Render initial map view with today's events
    handleDateChange(DEVICE_TODAY);

  } catch (error) {
    console.error('Failed to load events:', error);
    // Show error in UI
    showLoadError();
  }
}

/**
 * Expand multi-date events into separate events
 * @param {Array} events - Array of events
 * @returns {Array} Expanded events array
 */
function expandMultiDateEvents(events) {
  const expanded = [];

  events.forEach(event => {
    const dates = parseEventDates(event.date);
    const uniqueDates = new Set(dates);
    uniqueDates.forEach(singleDate => {
      const newEvent = { ...event };
      newEvent.date = singleDate;
      newEvent.id = makeEventId(newEvent); // New ID since date differs
      expanded.push(newEvent);
    });
  });

  return expanded;
}

/**
 * Parse multi-date string into array of single dates
 * Supports formats:
 * - Single: "12.11"
 * - Newline separated: "12.11\n13.11"
 * - Range: "14-15.11" -> ["14.11", "15.11"]
 * @param {string} dateStr - Date string
 * @returns {Array} Array of "DD.MM" strings
 */
function parseEventDates(dateStr) {
  if (!dateStr) return [];

  // Split by newline or comman
  const parts = dateStr.split(/[,\n]/).map(p => p.trim()).filter(p => p);

  const result = [];

  parts.forEach(part => {
    // Check if it's a range DD-DD.MM
    const rangeMatch = part.match(/^(\d{1,2})-(\d{1,2})\.(\d{2})$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1]);
      const end = parseInt(rangeMatch[2]);
      const month = rangeMatch[3];

      for (let d = start; d <= end; d++) {
        result.push(`${d.toString().padStart(2, '0')}.${month}`);
      }
    } else {
      // Assume single date DD.MM
      if (/^\d{1,2}\.\d{2}$/.test(part)) {
        result.push(part);
      }
    }
  });

  return result;
}

/**
 * Setup communication between modules
 */
function setupEventCommunication() {
  // Event selection from list/search
  document.addEventListener('event:selected', (event) => {
    const eventData = event.detail;
    handleEventSelection(eventData);
  });

  // Sidebar opening (close popups)
  document.addEventListener('sidebar:opening', () => {
    // Close map popups when sidebar opens
    // Note: Markers are kept to avoid disappearing on interface clicks
  });

  // Date changes from calendar
  const dateInput = document.getElementById(SELECTORS.eventDate);
  if (dateInput) {
    dateInput.addEventListener('change', (e) => {
      const dateStr = e.target.value;
      handleDateChange(dateStr);
    });

    // Prevent text selection highlight on click
    dateInput.addEventListener('mousedown', (e) => {
      e.preventDefault();
    });
  }

  // Search results interaction
  setupSearchResultsHandlers();
}

/**
 * Handle event selection from list or search
 */
function handleEventSelection(eventData) {
  // Close any open popups
  mapManager.closeAllPopups();

  // Show markers for the event's date
  handleDateChange(eventData.date);

  // Ensure correct list view
  eventListManager.ensureListForEvent(eventData);

  // Highlight in list
  eventListManager.highlightEvent(eventData.id);

  // Center map and open popup
  mapManager.flyTo(eventData.lon, eventData.lat);
  mapManager.openPopup(eventData.id);

  // Close search panel
  searchManager.closePanel();

  // Close sidebar on mobile
  if (window.innerWidth < 768) {
    eventListManager.closeSidebar();
  }
}

/**
 * Handle date change from calendar
 */
function handleDateChange(dateStr) {
  // Render markers for selected date
  const eventsForDate = eventListManager.getEventsForDate(dateStr);
  mapManager.clearMarkers();

  // Save current state for theme switching
  mapManager.currentDate = dateStr;
  mapManager.currentEvents = eventsForDate;
  mapManager.onShareCallback = (eventId) => {
    // Handle share link copy
    copyShareLink(eventId);
  };

  // Use grouped markers logic
  mapManager.addMarkersForGroupedEvents(eventsForDate, mapManager.onShareCallback);

  // Highlight first event in list
  eventListManager.highlightEvent(null); // Clear highlights
  if (eventsForDate.length > 0) {
    eventListManager.highlightEvent(eventsForDate[0].id);
  }

  // Close sidebar on mobile
  if (window.innerWidth < 768) {
    eventListManager.closeSidebar();
  }
}

/**
 * Setup search results click handlers
 */
function setupSearchResultsHandlers() {
  const searchResults = document.getElementById(SELECTORS.searchResults);
  if (!searchResults) return;

  searchResults.addEventListener('click', (event) => {
    const item = event.target.closest('li');
    if (!item) return;

    const eventId = item.dataset.eventId;
    const eventData = appState.allEvents.find(ev => ev.id === eventId);

    if (eventData) {
      eventListManager.ensureListForEvent(eventData);
      handleEventSelection(eventData);
      searchManager.closePanel();
    }
  });

  // Keyboard navigation in search results
  searchResults.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const item = event.target;
      if (item.tagName === 'LI') {
        item.click();
      }
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = event.target.nextElementSibling;
      if (next) next.focus();
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const prev = event.target.previousElementSibling;
      if (prev) {
        prev.focus();
      } else {
        // Focus back to search input
        const searchInput = document.getElementById(SELECTORS.globalSearch);
        if (searchInput) searchInput.focus();
      }
    }
  });
}

/**
 * Set initial date to today
 */
function setInitialDate() {
  const dateInput = document.getElementById(SELECTORS.eventDate);
  if (dateInput && !dateInput.value) {
    dateInput.value = DEVICE_TODAY;
  }
}

/**
 * Show welcome modal
 */
function showWelcomeModal() {
  const modal = document.getElementById('welcome-modal');
  const content = document.getElementById('welcome-content');
  const help = document.getElementById(SELECTORS.help);

  if (!modal || !content) return;

  modal.style.display = 'block';
  setTimeout(() => {
    modal.classList.add('show');
  }, 0);

  showWelcomePage1();

  modal.onclick = (e) => {
    if (e.target === modal || e.target.classList.contains('welcome-modal__backdrop')) {
      closeWelcomeModal();
    }
  };

  document.addEventListener('keydown', welcomeEscapeHandler);
}

/**
 * Close welcome modal
 */
function closeWelcomeModal() {
  const modal = document.getElementById('welcome-modal');
  if (!modal) return;

  modal.classList.remove('show');
  setTimeout(() => {
    modal.style.display = 'none';
  }, 150);

  modal.setAttribute('aria-hidden', 'true');
  localStorage.setItem('welcome-shown', 'true');
  document.removeEventListener('keydown', welcomeEscapeHandler);
}

/**
 * Welcome modal escape handler
 */
function welcomeEscapeHandler(e) {
  if (e.key === 'Escape') {
    closeWelcomeModal();
  }
}

/**
 * Show welcome page 1
 */
function showWelcomePage1() {
  const content = document.getElementById('welcome-content');
  if (!content) return;

  const children = Array.from(content.children);
  children.forEach(el => el.style.opacity = 0);

  setTimeout(() => {
    const theme = document.documentElement.getAttribute('data-theme');
    const html = `<button class="welcome-close" onclick="closeWelcomeModal()"><img src="assets/Закрывашка.svg" alt="Закрыть"></button>
<img class="welcome-logo" src="${theme === 'neon' || theme === 'test2' ? 'assets/logo1.png' : 'assets/Vector.png'}" alt="Логотип"/>
<p>Привет! Это MEOW Карта, и здесь мы показываем <br> о мероприятиях Калининграда - культурных, познавательных, развлекательных и не очень. <br> Добро пожаловать!</p>
<div class="welcome-buttons">
<button class="welcome-btn" onclick="showWelcomePage2()">Расскажи о проекте</button>
<button class="welcome-btn" onclick="">Как этим пользоваться?</button>
<button class="welcome-btn" onclick="closeWelcomeModal()">Хочу сам потыкать!</button>
</div>`;
    content.innerHTML = html;

    const newChildren = Array.from(content.children);
    newChildren.forEach(el => el.style.opacity = 0);

    setTimeout(() => {
      newChildren.forEach(el => el.style.opacity = 1);
    }, 0);
  }, 70);
}

/**
 * Show welcome page 2
 */
function showWelcomePage2() {
  const content = document.getElementById('welcome-content');
  if (!content) return;

  const children = Array.from(content.children);
  children.forEach(el => el.style.opacity = 0);

  setTimeout(() => {
    const html = `<button class="welcome-close" onclick="closeWelcomeModal()"><img src="assets/Закрывашка.svg" alt="Закрыть"></button>
<p class="welcome-text--page2">MEOW Карта - проект команды MEOW Records. Мы давно работаем с музыкальной сценой Калининграда, организуем мероприятия, оказываем техническую и информационную поддержку, выступаем сами.

Здесь мы собираем события любимого города, рассказываем о них в доступной форме и так, надеемся, развиваем интерес к культуре нашего региона внутри и за его пределами.

Итак, давай, покажу, как здесь всё устроено.</p>
<div class="welcome-buttons welcome-buttons--center">
<button class="welcome-btn" onclick="closeWelcomeModal()">Давай</button>
</div>`;
    content.innerHTML = html;

    const newChildren = Array.from(content.children);
    newChildren.forEach(el => el.style.opacity = 0);

    setTimeout(() => {
      newChildren.forEach(el => el.style.opacity = 1);
    }, 0);
  }, 70);
}

/**
 * Copy share link to clipboard
 */
async function copyShareLink(eventId) {
  const url = new URL(window.location.href);
  url.searchParams.set('event', eventId);
  const shareUrl = url.toString();

  const toast = document.getElementById('copy-toast');

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(shareUrl);
    } else {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = shareUrl;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '-9999px';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();

      const successful = document.execCommand('copy');
      document.body.removeChild(textarea);

      if (!successful) {
        throw new Error('Copy command failed');
      }
    }

    // Show success toast
    if (toast) {
      toast.textContent = 'Ссылка скопирована';
      toast.hidden = false;
      toast.classList.add('is-visible');
      setTimeout(() => {
        toast.classList.remove('is-visible');
        setTimeout(() => {
          if (!toast.classList.contains('is-visible')) {
            toast.hidden = true;
          }
        }, 200);
      }, 2000);
    }

  } catch (error) {
    console.error('Failed to copy link:', error);

    // Show error toast
    if (toast) {
      toast.textContent = 'Не удалось скопировать ссылку';
      toast.style.background = 'var(--surface-1)';
      toast.style.color = 'var(--text-0)';
      toast.classList.add('is-visible');

      setTimeout(() => {
        toast.classList.remove('is-visible');
        setTimeout(() => {
          if (!toast.classList.contains('is-visible')) {
            toast.hidden = true;
          }
        }, 200);
      }, 3000);

      // Reset text after error
      setTimeout(() => {
        toast.textContent = 'Ссылка скопирована';
      }, 3500);
    }
  }
}

/**
 * Show load error in UI
 */
function showLoadError() {
  const listContainer = document.getElementById(SELECTORS.upcoming);
  if (listContainer) {
    listContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-1);">Ошибка загрузки событий</div>';
  }

  const searchEmpty = document.getElementById(SELECTORS.searchEmpty);
  if (searchEmpty) {
    searchEmpty.textContent = 'Не удалось загрузить события';
    searchEmpty.hidden = false;
  }
}

/**
 * Get event date label (simplified for main)
 * Supports YYYY-MM-DD and DD.MM formats
 */
function getEventDateLabel(dateStr, eventText) {
  if (dateStr === DEVICE_TODAY) {
    return 'Сегодня';
  }

  // Check if dateStr is DD.MM
  const mDm = dateStr.match(/^(\d{1,2})\.(\d{1,2})$/);
  if (mDm) {
    return dateStr; // Already DD.MM
  }

  // Check YYYY-MM-DD
  const mYmd = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (mYmd) {
    const day = parseInt(mYmd[3]);
    const month = parseInt(mYmd[2]);
    return `${day.toString().padStart(2, '0')}.${month.toString().padStart(2, '0')}`;
  }

  return dateStr;
}

// Setup welcome modal trigger
document.addEventListener('DOMContentLoaded', () => {
  const help = document.getElementById(SELECTORS.help);
  if (help) {
    help.addEventListener('click', showWelcomeModal);
  }

  // Show welcome on first visit
  if (!localStorage.getItem('welcome-shown')) {
    setTimeout(() => showWelcomeModal(), 500);
  }
});

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Export functions for global access (needed for inline onclick handlers)
window.showWelcomePage2 = showWelcomePage2;
window.closeWelcomeModal = closeWelcomeModal;
window.copyShareLink = copyShareLink;
