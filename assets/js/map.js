/**
 * MeowMap Map Module
 * Handles MapLibre GL map initialization and controls
 */

import { MAP_OPTIONS, CONTROLS, SELECTORS, CLASSES, DURATIONS } from './constants.js';
import { debounce, bindKeyboardActivation, sanitizeHtml } from './utils.js';
import { getTheme } from './theme.js';

/**
 * Custom navigation control for MapLibre
 */
class CustomNavigationControl {
  constructor() {
    this._container = null;
  }

  onAdd(map) {
    this._map = map;
    this._container = document.createElement('div');
    this._container.className = 'maplibregl-ctrl maplibregl-ctrl-group';

    // Zoom in button
    const zoomInButton = this._createButton('zoom-in', 'Увеличить масштаб', () => {
      this._map.zoomIn();
    });

    // Zoom out button
    const zoomOutButton = this._createButton('zoom-out', 'Уменьшить масштаб', () => {
      this._map.zoomOut();
    });

    this._container.appendChild(zoomInButton);
    this._container.appendChild(zoomOutButton);

    return this._container;
  }

  onRemove() {
    if (this._container && this._container.parentNode) {
      this._container.parentNode.removeChild(this._container);
    }
    this._map = undefined;
  }

  _createButton(className, title, fn) {
    const button = document.createElement('button');
    button.className = `maplibregl-ctrl-${className}`;
    button.type = 'button';
    button.title = title;
    button.setAttribute('aria-label', title);

    // Add icons
    if (className === 'zoom-in') {
      button.innerHTML = '<span style="font-size: 18px; line-height: 1; font-weight: bold;">+</span>';
    } else if (className === 'zoom-out') {
      button.innerHTML = '<span style="font-size: 18px; line-height: 1; font-weight: bold;">−</span>';
    }

    button.addEventListener('click', fn);

    return button;
  }
}

/**
 * Map state and markers management
 */
class MapManager {
  constructor() {
    this.map = null;
    this.markers = [];
    this.markerById = new Map();
    this.eventById = new Map();
    this.currentPopups = new Set();
    this.isInitialized = false;
    this.currentDate = null;
    this.currentEvents = [];
    this.onShareCallback = null;
  }

  /**
   * Initialize the map
   * @returns {Promise} Promise that resolves when map is ready
   */
  async init() {
    return new Promise((resolve, reject) => {
      const mapContainer = document.getElementById(SELECTORS.map);

      if (!window.maplibregl || !maplibregl.supported()) {
        mapContainer.innerHTML = '<p style="padding:16px; font-family: \'NTSomic\', Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;">MapLibre требует поддержки WebGL. Обновите браузер или включите аппаратное ускорение.</p>';
        reject(new Error('MapLibre is not supported'));
        return;
      }

      this.map = new maplibregl.Map(MAP_OPTIONS);

      this.map.on('error', event => {
        console.error('Map style load error', event.error);
        reject(event.error);
      });

      this.map.on('load', () => {
        this._setupControls();
        this._setupResizeHandler();
        this._setupThemeObserver();
        this.isInitialized = true;
        resolve(this.map);
      });
    });
  }

  /**
   * Setup map controls
   * @private
   */
  _setupControls() {
    // Setup custom controls
    this._setupCustomControls();

    // Disable rotation
    this.map.dragRotate.disable();
    this.map.touchZoomRotate.disableRotation();

    // Hide mini-markers on map click
    this.map.on('click', () => {
      this._hideAllMiniMarkers();
    });
  }

  /**
   * Setup custom controls
   * @private
   */
  _setupCustomControls() {
    const zoomInBtn = document.getElementById('zoom-in');
    const zoomOutBtn = document.getElementById('zoom-out');
    const locateBtn = document.getElementById('locate-btn');

    if (zoomInBtn) {
      zoomInBtn.addEventListener('click', () => {
        this.map.zoomIn();
      });
    }

    if (zoomOutBtn) {
      zoomOutBtn.addEventListener('click', () => {
        this.map.zoomOut();
      });
    }

    if (locateBtn) {
      locateBtn.addEventListener('click', () => {
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (position) => {
              const { latitude, longitude } = position.coords;
              this.flyTo(longitude, latitude, 14);
            },
            (error) => {
              console.error('Geolocation error:', error);
              // Could show a toast or alert here
            }
          );
        } else {
          console.error('Geolocation not supported');
        }
      });
    }
  }

  /**
   * Setup geolocate button dynamic descriptions
   * @private
   */
  _setupGeolocateButton() {
    const selectors = [
      '.maplibregl-ctrl-geolocate button',
      '.maplibregl-ctrl-geolocate',
      '[aria-label="Show my location"]',
      'button[title="Show my location"]'
    ];

    const setupButton = () => {
      for (const selector of selectors) {
        const button = document.querySelector(selector);
        if (button) {
          this._updateGeolocateButtonDescription(button);

          // Observe class changes
          const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
              if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                this._updateGeolocateButtonDescription(button);
              }
            });
          });

          observer.observe(button, {
            attributes: true,
            attributeFilter: ['class']
          });

          console.log('Кнопка геолокации настроена');
          return;
        }
      }

      // Retry if not found
      setTimeout(setupButton, 100);
      setTimeout(setupButton, 500);
      setTimeout(setupButton, 1000);
    };

    this.map.on('load', () => setTimeout(setupButton, 100));
  }

  /**
   * Update geolocate button description based on state
   * @param {HTMLElement} button - Button element
   * @private
   */
  _updateGeolocateButtonDescription(button) {
    if (!button) return;

    const currentAriaLabel = button.getAttribute('aria-label');
    const currentTitle = button.getAttribute('title');

    const isDisabled = button.disabled || button.classList.contains('maplibregl-ctrl-geolocate-disabled');
    const isActive = button.classList.contains('maplibregl-ctrl-geolocate-active');
    const isLoading = button.classList.contains('maplibregl-ctrl-geolocate-waiting');

    let newAriaLabel = '';
    let newTitle = '';

    if (isDisabled) {
      newAriaLabel = 'Геолокация недоступна';
      newTitle = 'Геолокация недоступна';
    } else if (isLoading) {
      newAriaLabel = 'Поиск местоположения...';
      newTitle = 'Поиск местоположения...';
    } else if (isActive) {
      newAriaLabel = 'Моё местоположение';
      newTitle = 'Моё местоположение';
    } else {
      newAriaLabel = 'Определить текущее местоположение на карте';
      newTitle = 'Определить текущее местоположение на карте';
    }

    if (currentAriaLabel !== newAriaLabel) {
      button.setAttribute('aria-label', newAriaLabel);
    }
    if (currentTitle !== newTitle) {
      button.setAttribute('title', newTitle);
    }
  }

  /**
   * Setup resize handler
   * @private
   */
  _setupResizeHandler() {
    const resizeViewport = debounce(() => {
      if (this.map) {
        this.map.resize();
      }
    }, DURATIONS.debounce);

    window.addEventListener('resize', resizeViewport);
  }

  /**
   * Setup theme change observer
   * @private
   */
  _setupThemeObserver() {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
          this.refreshMarkers();
        }
      });
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    });
  }

  /**
   * Refresh markers with current theme
   */
  refreshMarkers() {
    if (!this.currentEvents.length || !this.onShareCallback) return;

    this.clearMarkers();
    this.addMarkersForGroupedEvents(this.currentEvents, this.onShareCallback);
  }

  /**
   * Clear all markers from map
   */
  clearMarkers() {
    this.markers.forEach(marker => marker.remove());
    this.markers.length = 0;
    this.markerById.clear();
    this.eventById.clear();
  }

  /**
   * Close all open popups
   */
  closeAllPopups() {
    // Close marker popups
    this.markers.forEach(marker => {
      const popup = marker.getPopup();
      if (popup && popup.isOpen()) {
        marker.togglePopup();
      }
    });
    // Close standalone popups
    this.currentPopups.forEach(popup => popup.remove());
    this.currentPopups.clear();
    // Hide all mini-markers
    this._hideAllMiniMarkers();
  }

  /**
   * Add marker for event
   * @param {Object} event - Event data
   * @param {Function} onShare - Share callback
   */
  addMarker(event, onShare) {
    const popup = new maplibregl.Popup({
      offset: 120,
      closeButton: false,
      className: 'animated-popup'
    })
      .setHTML(this._createPopupContent(event, onShare));

    const currentTheme = getTheme();
    let markerOptions = {};

    if (currentTheme === 'test') {
      const img = document.createElement('img');
      img.src = 'assets/metka.png';
      img.style.width = '24px';
      img.style.height = 'auto';
      markerOptions.element = img;
      markerOptions.anchor = 'bottom';
    } else {
      markerOptions.color = '#22d3ee';
    }

    const marker = new maplibregl.Marker(markerOptions)
      .setLngLat([event.lon, event.lat])
      .setPopup(popup)
      .addTo(this.map);

    // Add click handler to zoom and center on marker using DOM element
    const markerElement = marker.getElement();
    markerElement.addEventListener('click', (e) => {
      console.log('Marker clicked, flying to:', event.lon, event.lat);
      // Prevent default MapLibre behavior
      e.stopPropagation();
      // Close any open popups first
      this.closeAllPopups();
      // Fly to location
      this.flyTo(event.lon, event.lat, 14);
      // Open popup after flyTo animation
      setTimeout(() => {
        marker.togglePopup();
      }, 300);
    });

    this.markers.push(marker);
    this.markerById.set(event.id, marker);
    this.eventById.set(event.id, event);

    // Setup popup expand/collapse
    this._setupPopupHandlers(popup, event);
  }

  /**
   * Group events by location and date
   * @param {Array} events - Array of event data
   * @returns {Map} Map of grouped events by location and date
   */
  groupEventsByLocationAndDate(events) {
    const groupedEvents = new Map();

    events.forEach(event => {
      const key = `${event.lat},${event.lon},${event.date}`;
      if (!groupedEvents.has(key)) {
        groupedEvents.set(key, []);
      }
      groupedEvents.get(key).push(event);
    });

    return groupedEvents;
  }

  /**
   * Add markers for grouped events
   * @param {Array} events - Array of event data
   * @param {Function} onShare - Share callback
   */
  addMarkersForGroupedEvents(events, onShare) {
    const groupedEvents = this.groupEventsByLocationAndDate(events);

    groupedEvents.forEach((eventsAtLocation, key) => {
      if (eventsAtLocation.length === 1) {
        this.addMarker(eventsAtLocation[0], onShare);
      } else {
        this._addGroupedMarker(eventsAtLocation, onShare);
      }
    });
  }

  /**
   * Add marker for grouped events
   * @param {Array} events - Array of event data
   * @param {Function} onShare - Share callback
   */
  _addGroupedMarker(events, onShare) {
    const currentTheme = getTheme();
    let markerOptions = {};

    if (currentTheme === 'test') {
      const img = document.createElement('img');
      img.src = 'assets/metka.png';
      img.style.width = '24px';
      img.style.height = 'auto';
      markerOptions.element = img;
      markerOptions.anchor = 'bottom';
    } else {
      markerOptions.color = '#22d3ee';
    }

    const marker = new maplibregl.Marker(markerOptions)
      .setLngLat([events[0].lon, events[0].lat])
      .addTo(this.map);

    // Create mini-markers for each event
    const miniMarkers = events.map((event, index) => {
      const miniCard = document.createElement('div');
      miniCard.innerHTML = this._createMiniCardContent(event, onShare);
      miniCard.style.pointerEvents = 'auto';
      miniCard.style.opacity = '0';
      miniCard.style.transform = 'translateY(10px) scale(0.95)';
      miniCard.style.transition = `opacity 0.3s ease-out ${index * 0.05}s, transform 0.3s ease-out ${index * 0.05}s`;

      const miniMarker = new maplibregl.Marker({
        element: miniCard,
        anchor: 'bottom',
        offset: [0, -index * 45 - 35] // Tighter spacing: 35px base, 45px between cards
      })
        .setLngLat([event.lon, event.lat]);

      // Add click handler for mini-card
      miniCard.addEventListener('click', (e) => {
        e.stopPropagation();
        this._showFullEventPopup(event, miniCard);
        // Hide mini-markers after showing full popup
        this._hideAllMiniMarkers();
      });

      return miniMarker;
    });

    // Store mini-markers reference
    marker._miniMarkers = miniMarkers;

    // Add click handler to zoom and center on marker using DOM element
    const markerElement = marker.getElement();
    markerElement.addEventListener('click', (e) => {
      console.log('Grouped marker clicked, flying to:', events[0].lon, events[0].lat);
      // Prevent default MapLibre behavior
      e.stopPropagation();
      // Close any open popups first
      this.closeAllPopups();
      // Hide any other mini-markers
      this._hideAllMiniMarkers();
      // Fly to location
      this.flyTo(events[0].lon, events[0].lat, 14);
      // Show mini-markers after flyTo animation
      setTimeout(() => {
        miniMarkers.forEach((miniMarker, index) => {
          miniMarker.addTo(this.map);
          // Trigger animation after adding to map
          setTimeout(() => {
            const element = miniMarker.getElement();
            if (element) {
              element.style.opacity = '1';
              element.style.transform = 'translateY(0) scale(1)';
            }
          }, 50);
        });
      }, 300);
    });

    this.markers.push(marker);
    events.forEach(event => {
      this.markerById.set(event.id, marker);
      this.eventById.set(event.id, event);
    });
  }



  /**
   * Create mini card HTML content
   * @param {Object} event - Event data
   * @param {Function} onShare - Share callback
   * @returns {string} HTML content
   * @private
   */
  _createMiniCardContent(event, onShare) {
    const header = `
      <div class="grouped-event-header">
        <strong>${sanitizeHtml(event.title)}</strong>
        <div class="grouped-event-time">${sanitizeHtml(event.time || '')}</div>
      </div>
    `;

    return `
      <div class="grouped-event-item" data-event-id="${event.id}" style="pointer-events: auto; cursor: pointer;">
        ${header}
      </div>
    `;
  }

  /**
   * Hide all mini-markers
   * @private
   */
  _hideAllMiniMarkers() {
    this.markers.forEach(marker => {
      if (marker._miniMarkers) {
        marker._miniMarkers.forEach(miniMarker => {
          miniMarker.remove();
        });
      }
    });
  }

  /**
   * Show full event popup
   * @param {Object} event - Event data
   * @param {HTMLElement} popupEl - Popup element
   * @private
   */
  _showFullEventPopup(event, popupEl) {
    // Close any existing popups and mini-markers before opening new one
    this.closeAllPopups();

    const fullPopup = new maplibregl.Popup({
      offset: 120,
      closeButton: false,
      className: 'animated-popup'
    })
      .setHTML(this._createPopupContent(event, this.onShareCallback))
      .setLngLat([event.lon, event.lat])
      .addTo(this.map);

    // Track the popup
    this.currentPopups.add(fullPopup);

    fullPopup.on('open', () => {
      this._setupPopupHandlers(fullPopup, event);
      // Check and adjust popup position after opening
      setTimeout(() => this._adjustPopupPosition(fullPopup.getElement(), fullPopup), 10);
    });

    fullPopup.on('close', () => {
      this.currentPopups.delete(fullPopup);
    });

    // For grouped events, no need to reopen mini-markers after closing full popup
  }

  /**
   * Create popup HTML content
   * @param {Object} event - Event data
   * @param {Function} onShare - Share callback
   * @returns {string} HTML content
   * @private
   */
  _createPopupContent(event, onShare) {
    const shareButton = `
      <button class="share-btn"
        type="button"
        onclick="window.copyShareLink('${event.id}')"
      >Поделиться</button>`;

    const header = `
      <div><strong>${sanitizeHtml(event.title)}</strong></div>
      <div style="color:var(--text-1);margin:4px 0;">${sanitizeHtml(event.location)}</div>
      <div style="color:var(--text-1);margin:4px 0;">${sanitizeHtml(event.date)}</div>
      ${event.time ? `<div style="color:var(--text-1);margin:4px 0;">${sanitizeHtml(event.time)}</div>` : ''}
    `;

    const shortDesc = sanitizeHtml(event.short_description || '');
    const fullDesc = sanitizeHtml(event.full_description || event.short_description || '');
    const tags = event.tags ? `<div style="color:var(--text-1);margin:4px 0;">${sanitizeHtml(event.tags)}</div>` : '';

    const expandButton = event.full_description && event.full_description.trim() ? `<button class="expand-btn" type="button" data-contacts="${event.contacts || ''}">Узнать больше</button>` : '';

    return `
      <div class="popup-content" style="font-family:var(--font-ui);padding-bottom:60px;">
        ${header}
        <div class="popup-text" style="margin:8px 0 -29px 0;max-height:72px;overflow-y:scroll;position:relative;">
          ${shortDesc.replace(/\n/g, '<br>')}
        </div>
        <div class="popup-text-expanded" style="display:none;">
          <div class="popup-text-full" style="max-height:200px;overflow:auto;margin:8px 0;">${fullDesc.replace(/\n/g, '<br>')}</div>
          ${tags}
        </div>
        <div style="position:absolute;bottom:6px;left:6px;right:6px;display:flex;justify-content:space-between;gap:6px;">
          ${expandButton}
          ${shareButton}
        </div>
      </div>
    `;
  }

  /**
   * Setup popup expand/collapse handlers
   * @param {maplibregl.Popup} popup - Popup instance
   * @param {Object} event - Event data
   * @private
   */
  _setupPopupHandlers(popup, event) {
    popup.on('open', () => {
      const popupEl = popup.getElement();
      if (!popupEl) return;

      // Reset popup to default position before checking
      if (popup._originalOptions) {
        popup.setOffset(popup._originalOptions.offset);
        popup.options.anchor = popup._originalOptions.anchor;
        // Force repositioning to default
        setTimeout(() => popup._update(), 0);
      }

      // Always reset to collapsed state on reopen
      const mainText = popupEl.querySelector('.popup-text');
      const expandedSection = popupEl.querySelector('.popup-text-expanded');
      const expandBtn = popupEl.querySelector('.expand-btn');
      if (mainText && expandedSection && expandBtn) {
        mainText.style.display = 'block';
        expandedSection.style.display = 'none';
        expandBtn.textContent = 'Узнать больше';
      }

      if (expandBtn) {
        expandBtn.onclick = () => {
          const btnText = expandBtn.textContent;
          if (btnText === 'Узнать больше') {
            // Expand popup
            this._togglePopupText(popupEl, popup);
            expandBtn.textContent = 'Контакты';
          } else if (btnText === 'Контакты') {
            // Open contacts link
            const contacts = expandBtn.dataset.contacts;
            if (contacts) {
              window.open(contacts, '_blank');
            }
          }
        };
      }

      // Check and adjust popup position after opening
      setTimeout(() => this._adjustPopupPosition(popupEl, popup), 20);
    });

    popup.on('close', () => {
      const popupEl = popup.getElement();
      if (!popupEl) return;

      // Animate close
      const content = popupEl.querySelector('.popup-content');
      if (content) {
        content.style.opacity = '0';
      }

      // Reset state after animation
      setTimeout(() => {
        const mainText = popupEl.querySelector('.popup-text');
        const expandedSection = popupEl.querySelector('.popup-text-expanded');
        const expandBtn = popupEl.querySelector('.expand-btn');
        if (mainText && expandedSection && expandBtn) {
          mainText.style.display = 'block';
          expandedSection.style.display = 'none';
          expandBtn.textContent = 'Узнать больше';
        }
      }, 300);
    });
  }

  /**
   * Toggle popup text expansion with adaptive positioning
   * @param {HTMLElement} popupEl - Popup element
   * @param {maplibregl.Popup} popup - Popup instance
   * @private
   */
  _togglePopupText(popupEl, popup) {
    const mainText = popupEl.querySelector('.popup-text');
    const expandedSection = popupEl.querySelector('.popup-text-expanded');

    if (!mainText || !expandedSection) return;

    const isExpanded = expandedSection.style.display === 'block';

    if (isExpanded) {
      // Collapsing - return to original position
      mainText.style.display = 'block';
      expandedSection.style.display = 'none';

      // Reset to original position if it was changed
      if (popup._originalOptions) {
        popup.setOffset(popup._originalOptions.offset);
        popup.options.anchor = popup._originalOptions.anchor;
        // Force repositioning
        setTimeout(() => popup._update(), 0);
      }
    } else {
      // Expanding - check if we need to reposition
      mainText.style.display = 'none';
      expandedSection.style.display = 'block';

      // Check if repositioning is needed after expansion
      setTimeout(() => this._adjustPopupPosition(popupEl, popup), 10);
    }
  }

  /**
   * Adjust popup position to avoid going behind top panel
   * @param {HTMLElement} popupEl - Popup element
   * @param {maplibregl.Popup} popup - Popup instance
   * @private
   */
  _adjustPopupPosition(popupEl, popup) {
    if (!popupEl || !popup) return;

    const popupRect = popupEl.getBoundingClientRect();
    const topPanelHeight = 93; // --popup-top-offset
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const popupHeight = popupRect.height;
    const popupWidth = popupRect.width;

    // Check if popup goes above top panel
    if (popupRect.top < topPanelHeight) {
      // Store original options
      if (!popup._originalOptions) {
        popup._originalOptions = {
          offset: popup.options.offset,
          anchor: popup.options.anchor
        };
      }

      // Check if there's enough space below the marker
      const spaceBelow = viewportHeight - popupRect.bottom;
      if (popupHeight <= spaceBelow) {
        // Position below the marker
        const newAnchor = 'bottom';
        const newOffset = [0, -10]; // Small gap from marker

        popup.options.anchor = newAnchor;
        popup.setOffset(newOffset);
      } else {
        // Not enough space below either - try centering or left/right positioning
        const spaceAbove = popupRect.top;
        const spaceLeft = popupRect.left;
        const spaceRight = viewportWidth - popupRect.right;

        if (spaceAbove >= popupHeight) {
          // Enough space above, adjust offset to fit
          const newOffset = [0, topPanelHeight - popupRect.top + 10];
          popup.setOffset(newOffset);
        } else if (spaceLeft >= popupWidth) {
          // Try left positioning
          const newAnchor = 'right';
          const newOffset = [-10, 0];
          popup.options.anchor = newAnchor;
          popup.setOffset(newOffset);
        } else if (spaceRight >= popupWidth) {
          // Try right positioning
          const newAnchor = 'left';
          const newOffset = [10, 0];
          popup.options.anchor = newAnchor;
          popup.setOffset(newOffset);
        } else {
          // No good position, just ensure top is visible
          const newOffset = [0, topPanelHeight - popupRect.top + 10];
          popup.setOffset(newOffset);
        }
      }

      // Force repositioning
      setTimeout(() => popup._update(), 0);
    } else if (popupRect.left < 0 || popupRect.right > viewportWidth) {
      // Also check horizontal boundaries
      if (!popup._originalOptions) {
        popup._originalOptions = {
          offset: popup.options.offset,
          anchor: popup.options.anchor
        };
      }

      // Adjust horizontal position if needed
      const spaceLeft = popupRect.left;
      const spaceRight = viewportWidth - popupRect.right;

      if (popupRect.left < 0 && spaceRight >= popupWidth) {
        // Move to right if left boundary violated and space available
        const newAnchor = 'left';
        const newOffset = [10, 0];
        popup.options.anchor = newAnchor;
        popup.setOffset(newOffset);
      } else if (popupRect.right > viewportWidth && spaceLeft >= popupWidth) {
        // Move to left if right boundary violated and space available
        const newAnchor = 'right';
        const newOffset = [-10, 0];
        popup.options.anchor = newAnchor;
        popup.setOffset(newOffset);
      }

      // Force repositioning
      setTimeout(() => popup._update(), 0);
    }
  }

  /**
   * Render markers for specific date
   * @param {string} dateStr - Date string
   * @param {Object} options - Options
   * @returns {Array} Events for the date
   */
  renderDay(dateStr, options = {}) {
    const { recenter = true } = options;

    if (!dateStr) {
      this.clearMarkers();
      return [];
    }

    this.clearMarkers();

    // This will be called from main module with events data
    // For now return empty array
    return [];
  }

  /**
   * Fly to event location
   * @param {number} lon - Longitude
   * @param {number} lat - Latitude
   * @param {number} zoom - Zoom level
   */
  flyTo(lon, lat, zoom = 14) {
    console.log('flyTo called with:', lon, lat, zoom, 'map exists:', !!this.map);
    if (this.map) {
      const paddingTop = Math.round(window.innerHeight * 0.25);
      this.map.flyTo({ center: [lon, lat], zoom, padding: { top: paddingTop } });
    } else {
      console.error('Map not initialized');
    }
  }

  /**
   * Open popup for event
   * @param {string} eventId - Event ID
   */
  openPopup(eventId) {
    const event = this.eventById.get(eventId);
    if (!event) return;

    // Close any existing popups before opening new one
    this.closeAllPopups();

    const marker = this.markerById.get(eventId);
    if (marker && marker.getPopup()) {
      marker.togglePopup();
    } else {
      // For grouped events, open full popup directly
      this._showFullEventPopup(event);
    }
  }

  /**
   * Get marker by event ID
   * @param {string} eventId - Event ID
   * @returns {maplibregl.Marker|null} Marker instance
   */
  getMarker(eventId) {
    return this.markerById.get(eventId) || null;
  }
}

// Export singleton instance
export const mapManager = new MapManager();
