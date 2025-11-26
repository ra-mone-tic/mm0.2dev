/**
 * MeowMap Constants and Configuration
 * Centralized configuration for the application
 */

// API and data URLs
export const JSON_URL = 'events.json';
export const CACHE_URL = 'geocode_cache.json';

// Map configuration
export const REGION_BBOX = [19.30, 54.00, 23.10, 55.60];
export const MAP_OPTIONS = {
  container: 'map',
  style: {
    version: 8,
    sources: {
      positron: {
        type: 'raster',
        tiles: [
          'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
          'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
          'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
          'https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'
        ],
        tileSize: 256,
        bounds: REGION_BBOX,
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
      }
    },
    layers: [
      { id: 'positron', type: 'raster', source: 'positron' }
    ]
  },
  center: [20.45, 54.71],
  zoom: 10,
  antialias: false,
  maxZoom: 17,
  maxBounds: [
    [REGION_BBOX[0], REGION_BBOX[1]],
    [REGION_BBOX[2], REGION_BBOX[3]]
  ],
  renderWorldCopies: false
};

// UI constants
const currentDate = new Date();
export const DEVICE_TODAY = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
export const BATCH_SIZE = 100;
export const WAIT_REQUEST = 1.1;
export const MAX_POSTS = 2000;

// DOM selectors
export const SELECTORS = {
  map: 'map',
  controls: 'controls',
  eventDate: 'event-date',
  upcoming: 'upcoming',
  archiveButton: 'toggleArchive',
  sidebar: 'sidebar',
  burger: 'burger',
  logo: 'logo',
  bottomBar: 'bottomBar',
  globalSearch: 'global-search',
  searchPanel: 'search-panel',
  searchResults: 'search-results',
  searchEmpty: 'search-empty',
  searchLabel: 'search-label',
  searchClear: 'search-clear',
  copyToast: 'copy-toast',
  welcomeModal: 'welcome-modal',
  welcomeContent: 'welcome-content',
  help: 'help'
};

// CSS classes
export const CLASSES = {
  open: 'open',
  isVisible: 'is-visible',
  isActive: 'is-active',
  show: 'show',
  expanded: 'expanded',
  collapsed: 'collapsed'
};

// Event types
export const EVENTS = {
  mapLoad: 'map:load',
  eventsLoaded: 'events:loaded',
  eventSelected: 'event:selected',
  searchQuery: 'search:query',
  dateChanged: 'date:changed',
  sidebarToggle: 'sidebar:toggle'
};

// Error messages
export const MESSAGES = {
  loading: 'Загрузка данных…',
  noResults: 'Ничего не найдено',
  loadError: 'Ошибка загрузки событий',
  geocodeError: 'Ошибка геокодинга',
  networkError: 'Ошибка сети'
};

// Theme configuration
export const THEMES = ['minimal', 'neon', 'test', 'test2'];
export const DEFAULT_THEME = 'minimal';

// Keyboard keys
export const KEYS = {
  enter: 'Enter',
  space: ' ',
  escape: 'Escape',
  arrowUp: 'ArrowUp',
  arrowDown: 'ArrowDown'
};

// Animation durations (ms)
export const DURATIONS = {
  fast: 150,
  slow: 280,
  debounce: 120
};

// MapLibre controls configuration
export const CONTROLS = {
  navigation: {
    showCompass: false,
    showZoom: true
  },
  geolocate: {
    positionOptions: { enableHighAccuracy: true },
    showUserLocation: true,
    trackUserLocation: false
  }
};
