/**
 * MeowMap Calendar Module
 * Handles date picker and calendar functionality
 */

import { SELECTORS, KEYS } from './constants.js';
import { mapManager } from './map.js';

/**
 * Calendar state and management
 */
class CalendarManager {
  constructor() {
    this.dateInput = null;
    this.modal = null;
    this.monthYear = null;
    this.daysContainer = null;
    this.prevBtn = null;
    this.nextBtn = null;
    this.currentDate = new Date();
    this.selectedDate = null;
    this.isOpen = false;
    this.isInitialized = false;

    this.months = [
      'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
      'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
    ];
  }

  /**
   * Initialize calendar components
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
    this.dateInput = document.getElementById(SELECTORS.eventDate);
    this.modal = document.getElementById('calendar-modal');
    this.monthYear = document.querySelector('.calendar__month-year');
    this.daysContainer = document.querySelector('.calendar__days');
    this.prevBtn = document.getElementById('calendar-prev');
    this.nextBtn = document.getElementById('calendar-next');
  }

  /**
   * Setup event listeners
   * @private
   */
  _setupEventListeners() {
    if (this.dateInput) {
      // Toggle calendar on input click
      this.dateInput.addEventListener('click', (e) => {
        e.preventDefault();
        this.toggle();
      });

      // Handle keyboard activation
      this.dateInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === KEYS.space) {
          e.preventDefault();
          this.toggle();
        }
      });
    }

    if (this.prevBtn) {
      this.prevBtn.addEventListener('click', () => this.navigateMonth(-1));
    }

    if (this.nextBtn) {
      this.nextBtn.addEventListener('click', () => this.navigateMonth(1));
    }

    if (this.daysContainer) {
      this.daysContainer.addEventListener('click', (e) => {
        const day = e.target.closest('.calendar__day');
        if (day && !day.classList.contains('calendar__day--disabled')) {
          this.selectDate(day.dataset.date);
        }
      });
    }

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (this.isOpen && this.modal && !this.modal.contains(e.target) && e.target !== this.dateInput) {
        this.hide();
      }
    });

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (this.isOpen) {
        if (e.key === 'Escape') {
          this.hide();
        } else if (e.key === 'ArrowLeft') {
          this.navigateMonth(-1);
        } else if (e.key === 'ArrowRight') {
          this.navigateMonth(1);
        }
      }
    });
  }

  /**
   * Show calendar
   * @param {Date} date - Date to show
   */
  show(date = new Date()) {
    this.currentDate = new Date(date);
    this.render();
    this.positionCalendar();

    if (this.modal) {
      this.modal.hidden = false;
      this.modal.setAttribute('aria-hidden', 'false');
      this.isOpen = true;
    }
  }

  /**
   * Hide calendar
   */
  hide() {
    if (this.modal) {
      this.modal.hidden = true;
      this.modal.setAttribute('aria-hidden', 'true');
      this.isOpen = false;
    }
  }

  /**
   * Toggle calendar visibility
   */
  toggle() {
    if (this.isOpen) {
      this.hide();
    } else {
      mapManager.closeAllPopups();
      this.show(new Date(this.dateInput?.value || null));
    }
  }

  /**
   * Position calendar relative to input
   * @private
   */
  positionCalendar() {
    if (!this.dateInput || !this.modal) return;

    const inputRect = this.dateInput.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const controls = document.getElementById('controls');
    const controlsHeight = controls ? controls.offsetHeight : 93;
    const calendarHeight = inputRect.width; // Square calendar

    const calendar = this.modal;
    calendar.style.position = 'fixed';
    calendar.style.left = `${inputRect.left}px`;
    calendar.style.width = `${inputRect.width}px`;
    calendar.style.height = `${inputRect.width}px`;

    if (inputRect.bottom + calendarHeight > viewportHeight) {
      calendar.style.top = `${inputRect.top - calendarHeight}px`;
    } else {
      calendar.style.top = `${controlsHeight + 24}px`;
    }
  }

  /**
   * Navigate to different month
   * @param {number} delta - Month delta
   */
  navigateMonth(delta) {
    this.currentDate.setMonth(this.currentDate.getMonth() + delta);
    this.render();
  }

  /**
   * Select date
   * @param {string} dateStr - Date string (YYYY-MM-DD)
   */
  selectDate(dateStr) {
    if (!dateStr) return;

    const date = new Date(dateStr);
    this.selectedDate = date;

    // Update input
    if (this.dateInput) {
      const formattedDate = date.toISOString().slice(0, 10);
      this.dateInput.value = formattedDate;

      // Trigger change event
      this.dateInput.dispatchEvent(new Event('change', { bubbles: true }));
    }

    this.hide();
  }

  /**
   * Render calendar
   */
  render() {
    if (!this.monthYear || !this.daysContainer) return;

    const year = this.currentDate.getFullYear();
    const month = this.currentDate.getMonth();

    // Update header
    this.monthYear.textContent = `${this.months[month]}'${year.toString().slice(-2)}`;

    // Clear days
    this.daysContainer.innerHTML = '';

    // Get first day of month
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - firstDay.getDay() + 1); // Start from Monday

    // Today reference
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Render 35 days (5 weeks)
    for (let i = 0; i < 35; i++) {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + i);

      const day = document.createElement('button');
      day.className = 'calendar__day';
      day.textContent = date.getDate();
      const formattedDate = date.getFullYear().toString().padStart(4, '0') + '-' +
                           (date.getMonth() + 1).toString().padStart(2, '0') + '-' +
                           date.getDate().toString().padStart(2, '0');
      day.dataset.date = formattedDate;

      day.setAttribute('aria-label', date.toLocaleDateString('ru-RU', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }));

      // Mark other month days
      if (date.getMonth() !== month) {
        day.classList.add('calendar__day--other-month');
      }

      // Mark today
      if (date.getTime() === today.getTime()) {
        day.classList.add('calendar__day--today');
      }

      // Mark selected date
      if (this.selectedDate && date.toDateString() === this.selectedDate.toDateString()) {
        day.classList.add('calendar__day--selected');
      }

      this.daysContainer.appendChild(day);
    }
  }

  /**
   * Set selected date
   * @param {Date} date - Date to set
   */
  setSelectedDate(date) {
    this.selectedDate = new Date(date);
    this.currentDate = new Date(date);
    this.render();
  }
}

// Export singleton instance
export const calendarManager = new CalendarManager();
